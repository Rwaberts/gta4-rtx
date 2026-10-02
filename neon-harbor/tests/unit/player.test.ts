import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { PLAYER, SIM } from '../../src/data/config';

function run(world: World, seconds: number, setup?: () => void): void {
	const steps = Math.round(seconds / SIM.fixedDt);
	for (let i = 0; i < steps; i++) {
		setup?.();
		world.step(SIM.fixedDt);
	}
}

describe('Player controller', () => {
	it('moves relative to camera yaw and faces movement direction', () => {
		const w = new World();
		const p = w.player;
		p.teleport(0, 0, 0);
		// Camera facing +x (yaw = PI/2): forward input should move east.
		run(w, 1, () => {
			w.controls.camYaw = Math.PI / 2;
			w.controls.moveZ = 1;
		});
		expect(p.x).toBeGreaterThan(3);
		expect(Math.abs(p.z)).toBeLessThan(0.5);
		expect(p.heading).toBeCloseTo(Math.PI / 2, 1);
	});

	it('sprinting is faster and drains stamina, which regenerates', () => {
		const w = new World();
		const p = w.player;
		p.teleport(0, 0, 0);
		run(w, 1, () => {
			w.controls.moveZ = 1;
			w.controls.sprint = true;
		});
		expect(p.speed).toBeGreaterThan(PLAYER.runSpeed);
		expect(p.stamina).toBeLessThan(PLAYER.maxStamina);
		const drained = p.stamina;
		run(w, 3, () => {
			w.controls.moveZ = 0;
			w.controls.sprint = false;
		});
		expect(p.stamina).toBeGreaterThan(drained);
	});

	it('jumps and lands', () => {
		const w = new World();
		const p = w.player;
		p.teleport(0, 0, 0);
		w.controls.jumpPressed = true;
		run(w, 0.15);
		expect(p.y).toBeGreaterThan(0.5);
		expect(p.onGround).toBe(false);
		run(w, 1.5);
		expect(p.y).toBeCloseTo(0, 3);
		expect(p.onGround).toBe(true);
	});

	it('crouch toggles and slows movement', () => {
		const w = new World();
		const p = w.player;
		p.teleport(0, 0, 0);
		w.controls.crouchPressed = true;
		run(w, 1, () => (w.controls.moveZ = 1));
		expect(p.crouching).toBe(true);
		expect(p.speed).toBeLessThanOrEqual(PLAYER.crouchSpeed + 0.01);
	});

	it('cannot walk through buildings', () => {
		const w = new World();
		const p = w.player;
		const b = w.city.buildings.find((x) => x.h > 10 && x.y0 === 0 && x.maxX - x.minX > 10)!;
		// Start west of the building, walk east into it.
		const z = (b.minZ + b.maxZ) / 2;
		p.teleport(b.minX - 3, z, Math.PI / 2);
		run(w, 3, () => {
			w.controls.camYaw = Math.PI / 2;
			w.controls.moveZ = 1;
		});
		expect(p.x).toBeLessThanOrEqual(b.minX - p.radius + 0.05);
	});

	it('swims in water and armor absorbs damage', () => {
		const w = new World();
		const p = w.player;
		p.teleport(0, w.city.land.maxZ + 30, 0);
		run(w, 0.5);
		expect(p.swimming).toBe(true);
		p.armor = 50;
		const lost = p.damage(40);
		expect(lost).toBeLessThan(40);
		expect(p.armor).toBeLessThan(50);
	});

	it('announces the district on entry', () => {
		const w = new World();
		const seen: string[] = [];
		w.bus.on('districtEntered', (d) => seen.push(d.id));
		run(w, 1);
		expect(seen.length).toBe(1);
		expect(seen[0]).toBe(w.city.districtAt(w.player.x, w.player.z));
	});
});
