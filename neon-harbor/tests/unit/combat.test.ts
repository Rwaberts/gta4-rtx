import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { SIM } from '../../src/data/config';
import { WEAPONS } from '../../src/data/weapons';
import { Inventory } from '../../src/sim/Inventory';
import { Vehicle } from '../../src/sim/Vehicle';
import { vehicleDef } from '../../src/data/vehicles';
import { rayCylinder, rayVehicle } from '../../src/sim/CombatSystem';
import { CombatBrain } from '../../src/sim/ai/CombatBrain';

const DT = SIM.fixedDt;
function run(w: World, seconds: number, each?: () => void): void {
	for (let i = 0; i < Math.round(seconds / DT); i++) {
		each?.();
		w.step(DT);
	}
}

/** Quiet world, player standing on an open downtown road facing +x. */
function arena(): World {
	const w = new World();
	w.traffic.enabled = false;
	w.actors.density = 0;
	const e = w.city.edges.find((e) => e.horizontal && e.district === 'downtown')!;
	const a = w.city.nodes[e.a]!;
	w.player.teleport(a.x + 20, a.z, Math.PI / 2);
	w.controls.camYaw = Math.PI / 2;
	return w;
}

describe('ray primitives', () => {
	it('rayCylinder hits the near surface and respects height', () => {
		expect(rayCylinder(0, 1, 0, 1, 0, 0, 5, 0, 0.5, 0, 2)).toBeCloseTo(4.5);
		expect(rayCylinder(0, 3, 0, 1, 0, 0, 5, 0, 0.5, 0, 2)).toBe(Infinity);
		expect(rayCylinder(0, 1, 2, 1, 0, 0, 5, 0, 0.5, 0, 2)).toBe(Infinity);
	});
	it('rayVehicle respects orientation', () => {
		const v = new Vehicle().init(vehicleDef('sedan'), 10, 0, Math.PI / 2, 0);
		// Vehicle facing +x: its length lies along x.
		expect(rayVehicle(0, 1, 0, 1, 0, 0, v)).toBeCloseTo(10 - v.halfLength);
		expect(rayVehicle(0, 1, 3, 1, 0, 0, v)).toBe(Infinity);
	});
});

describe('Inventory', () => {
	it('gives, cycles, reloads and serializes', () => {
		const inv = new Inventory();
		inv.give('smg', 70);
		expect(inv.totalAmmo('smg')).toBe(70);
		inv.select('smg');
		expect(inv.state.clip).toBe(30);
		inv.state.clip = 5;
		inv.reload();
		expect(inv.state.clip).toBe(30);
		expect(inv.totalAmmo('smg')).toBe(45);
		inv.cycle(1);
		expect(inv.current).toBe('fists');
		const data = inv.serialize();
		const inv2 = new Inventory();
		inv2.load(data);
		expect(inv2.totalAmmo('smg')).toBe(45);
		// Ammo cap.
		expect(inv.give('smg', 10000)).toBe(WEAPONS.smg.maxAmmo - 45);
	});
});

describe('CombatSystem', () => {
	it('player pistol shot damages the civilian in front, uses ammo and is a crime', () => {
		const w = arena();
		const p = w.player;
		const a = w.actors.spawnCivilian(p.x + 10, p.z)!;
		a.brain = null;
		const crimes: string[] = [];
		w.bus.on('crime', (c) => crimes.push(c.type));
		w.combat.inventory.select('pistol');
		const clip0 = w.combat.inventory.state.clip;
		w.controls.aim = true;
		w.controls.firePressed = true;
		run(w, 0.1, () => (w.controls.aim = true));
		expect(a.health).toBeLessThan(100);
		expect(w.combat.inventory.state.clip).toBe(clip0 - 1);
		expect(crimes).toContain('gunfire');
		expect(crimes).toContain('shootCivilian');
	});

	it('headshots deal more damage than body shots', () => {
		const w = arena();
		const def = WEAPONS.pistol;
		const { x, z } = w.player;
		const body = w.actors.spawnCivilian(x + 10, z + 2)!;
		const head = w.actors.spawnCivilian(x + 10, z - 2)!;
		body.brain = head.brain = null;
		w.step(DT);
		w.combat.fireRay(x, 1.0, body.z, 1, 0, 0, def, null, 1);
		w.combat.fireRay(x, 1.7, head.z, 1, 0, 0, def, null, 1);
		expect(100 - head.health).toBeGreaterThan((100 - body.health) * 2);
	});

	it('reloads automatically and switches weapons', () => {
		const w = arena();
		const inv = w.combat.inventory;
		inv.give('smg', 60);
		w.controls.weaponSlot = 2;
		w.step(DT);
		expect(inv.current).toBe('smg');
		inv.state.clip = 0;
		run(w, WEAPONS.smg.reloadTime + 0.2);
		expect(inv.state.clip).toBe(30);
	});

	it('shotgun fires multiple pellets', () => {
		const w = arena();
		let shots = 0;
		w.bus.on('shot', () => shots++);
		w.combat.inventory.give('shotgun', 12);
		w.combat.inventory.select('shotgun');
		w.controls.firePressed = true;
		w.step(DT);
		expect(shots).toBe(WEAPONS.shotgun.pellets);
	});

	it('NPC fire can hit the player and armor absorbs damage', () => {
		const w = arena();
		const p = w.player;
		p.armor = 100;
		const g = w.actors.spawnFighter('saltline', p.x + 6, p.z, 'pistol', { accuracy: 1 })!;
		g.brain = null;
		g.heading = -Math.PI / 2;
		w.step(DT);
		let hits = 0;
		w.bus.on('playerDamaged', () => hits++);
		for (let i = 0; i < 10; i++) w.combat.npcFire(g, p.x, 1.2, p.z, 'pistol', 0);
		expect(hits).toBeGreaterThan(5);
		expect(p.armor).toBeLessThan(100);
		expect(p.health).toBeGreaterThan(50);
	});

	it('punching is assault and grenades explode after their fuse', () => {
		const w = arena();
		const p = w.player;
		const a = w.actors.spawnCivilian(p.x + 1.0, p.z)!;
		a.brain = null;
		w.step(DT);
		const crimes: string[] = [];
		w.bus.on('crime', (c) => crimes.push(c.type));
		w.combat.inventory.select('fists');
		w.controls.firePressed = true;
		w.step(DT);
		expect(a.health).toBe(100 - WEAPONS.fists.damage);
		expect(crimes).toContain('assault');

		let booms = 0;
		w.bus.on('explosion', () => booms++);
		w.combat.inventory.give('grenade', 2);
		w.combat.inventory.select('grenade');
		run(w, 0.6);
		w.controls.firePressed = true;
		w.step(DT);
		expect(w.combat.grenades.some((g) => g.active)).toBe(true);
		run(w, 3);
		expect(booms).toBe(1);
	});

	it('hostile gang members engage the player; neutral ones only when provoked', () => {
		const w = arena();
		const p = w.player;
		p.invulnerable = true;
		const hostile = w.actors.spawnFighter('saltline', p.x + 15, p.z, 'pistol', { hostile: true })!;
		let shotsAtPlayer = 0;
		w.bus.on('gunshot', (e) => {
			if (e.shooter === hostile) shotsAtPlayer++;
		});
		run(w, 4);
		expect((hostile.brain as CombatBrain).state).toBe('attack');
		expect(shotsAtPlayer).toBeGreaterThan(0);

		const neutral = w.actors.spawnFighter('rustline', p.x - 12, p.z, 'pistol')!;
		run(w, 2);
		expect((neutral.brain as CombatBrain).state).toBe('guard');
		w.actors.damage(neutral, 10, 'player', 'pistol');
		run(w, 0.5);
		expect((neutral.brain as CombatBrain).state).not.toBe('guard');
	});
});
