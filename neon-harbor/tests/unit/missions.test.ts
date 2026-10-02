import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { SIM } from '../../src/data/config';
import { MISSIONS, type TargetDef } from '../../src/data/missions';
import { Vehicle } from '../../src/sim/Vehicle';
import { Actor } from '../../src/sim/Actor';

const DT = SIM.fixedDt;
function run(w: World, seconds: number, each?: () => boolean | void): void {
	for (let i = 0; i < Math.round(seconds / DT); i++) {
		if (each?.() === true) return;
		w.step(DT);
	}
}

function quiet(): World {
	const w = new World();
	w.actors.density = 0;
	w.traffic.enabled = false;
	w.police.enabled = false;
	w.player.invulnerable = true;
	return w;
}

type Running = { refs: Map<string, unknown>; index: number };
const active = (w: World) => w.missions.active as unknown as Running;
const ref = <T>(w: World, name: string) => active(w).refs.get(name) as T;

function at(w: World, t: TargetDef) {
	return w.missions.resolve(w.missions.active as never, t)!;
}

function drive(w: World, v: Vehicle) {
	v.driver = 'player';
	w.player.state = 'driving';
	w.player.vehicle = v;
}

describe('Mission data', () => {
	it('has at least five missions with valid requirements and resolvable targets', () => {
		const w = quiet();
		expect(MISSIONS.length).toBeGreaterThanOrEqual(5);
		const ids = new Set(MISSIONS.map((m) => m.id));
		for (const m of MISSIONS) {
			for (const r of m.requires) expect(ids.has(r), `${m.id} requires ${r}`).toBe(true);
			expect(w.city.poi(m.contact), m.contact).toBeTruthy();
			for (const o of m.objectives) {
				const targets: TargetDef[] = [];
				if ('target' in o) targets.push(o.target);
				for (const a of [...(o.setup ?? []), ...(o.checkpoint?.actions ?? [])]) if ('at' in a) targets.push(a.at);
				if (o.checkpoint) targets.push(o.checkpoint.player);
				for (const t of targets) {
					if ('ref' in t) continue;
					const r = w.missions.resolve(null, t);
					expect(r, `${m.id}: ${JSON.stringify(t)}`).not.toBeNull();
					expect(w.city.isLand(r!.x, r!.z) || w.interiors.isInterior(r!.x, r!.z), `${m.id} target on land`).toBe(true);
				}
			}
		}
	});

	it('only the first mission is available at the start; completing unlocks the next', () => {
		const w = quiet();
		expect(w.missions.available().map((m) => m.id)).toEqual(['low_tide']);
		w.missions.completed.add('low_tide');
		expect(w.missions.available().map((m) => m.id)).toEqual(['static']);
	});
});

describe('Missions', () => {
	it('Low Tide: recover the van and deliver it; reward is paid', () => {
		const w = quiet();
		const cash0 = w.economy.cash;
		expect(w.missions.start('low_tide')).toBe(true);
		const pier = at(w, { pier: 1, along: 0.12 });
		w.player.teleport(pier.x, pier.z, 0);
		run(w, 0.2);
		expect(active(w).index).toBe(1);
		const van = ref<Vehicle>(w, 'van');
		expect(van).toBeInstanceOf(Vehicle);
		drive(w, van);
		run(w, 0.2);
		expect(active(w).index).toBe(2);
		const diner = at(w, { poi: 'contact_rosa', fwd: 7 });
		van.x = diner.x;
		van.z = diner.z;
		run(w, 0.3);
		expect(w.missions.active).toBeNull();
		expect(w.missions.completed.has('low_tide')).toBe(true);
		expect(w.economy.cash).toBe(cash0 + 1500);
	});

	it('fails when the van is destroyed and retries from the checkpoint with a fresh van', () => {
		const w = quiet();
		w.missions.start('low_tide');
		const pier = at(w, { pier: 1, along: 0.12 });
		w.player.teleport(pier.x, pier.z, 0);
		run(w, 0.2);
		const van = ref<Vehicle>(w, 'van');
		const vanId = van.id;
		drive(w, van);
		run(w, 0.2);
		const failures: string[] = [];
		w.bus.on('missionFailed', (e) => failures.push(e.reason));
		w.vehicles.explode(van, null);
		run(w, 0.2);
		expect(failures[0]).toMatch(/destroyed/);
		expect(w.missions.active).toBeNull();
		expect(w.missions.lastFailed?.checkpoint).toBe(2);
		run(w, 6); // respawn after the explosion
		expect(w.missions.retry()).toBe(true);
		expect(active(w).index).toBe(2);
		const fresh = ref<Vehicle>(w, 'van');
		expect(fresh.id).not.toBe(vanId);
		expect(fresh.destroyed).toBe(false);
		expect(w.player.vehicle).toBe(fresh);
		expect(w.player.state).toBe('driving');
	});

	it('Static on the Line: pickup triggers police, losing them allows delivery', () => {
		const w = quiet();
		w.missions.completed.add('low_tide');
		w.missions.start('static');
		const drive0 = ref<{ x: number; z: number }>(w, 'drive');
		w.player.teleport(drive0.x, drive0.z, 0);
		run(w, 0.2);
		expect(w.wanted.level).toBe(2);
		expect(active(w).index).toBe(1);
		w.wanted.clear(true);
		run(w, 0.2);
		expect(active(w).index).toBe(2);
		const drop = at(w, { poi: 'store_meridian', fwd: 5 });
		w.player.teleport(drop.x, drop.z, 0);
		run(w, 0.2);
		expect(w.missions.completed.has('static')).toBe(true);
	});

	it('Velvet Rope: Priya rides along, and the mission fails if she dies', () => {
		const w = quiet();
		w.missions.completed.add('low_tide').add('static');
		w.missions.start('velvet_rope');
		const meet = at(w, { poi: 'contact_rosa', fwd: 3, side: 3 });
		w.player.teleport(meet.x, meet.z, 0);
		run(w, 0.3);
		expect(active(w).index).toBe(1);
		const priya = ref<Actor>(w, 'priya');
		expect(priya.faction).toBe('crew');
		// Priya boards the player's car.
		const car = w.vehicles.spawn('sedan', priya.x + 3, priya.z, 0, 'owned')!;
		drive(w, car);
		run(w, 4);
		expect(priya.vehicle).toBe(car);
		w.actors.kill(priya, null, 'pistol');
		run(w, 0.2);
		expect(w.missions.active).toBeNull();
		expect(w.missions.lastFailed?.reason).toMatch(/Priya/);
	});

	it('Paper Trail: the courier flees, can be disabled and drops the ledgers', () => {
		const w = quiet();
		w.missions.completed.add('low_tide').add('static').add('velvet_rope');
		w.missions.start('paper_trail');
		const start = at(w, { lane: [80, -560] });
		w.player.teleport(start.x, start.z, 0);
		run(w, 0.2);
		expect(active(w).index).toBe(1);
		const courier = ref<Vehicle>(w, 'courier');
		const x0 = courier.x;
		const z0 = courier.z;
		run(w, 3);
		expect(Math.hypot(courier.x - x0, courier.z - z0)).toBeGreaterThan(10);
		w.vehicles.damage(courier, courier.def.health * 0.7, 'player');
		run(w, 0.2);
		expect(active(w).index).toBe(2);
		const ledger = ref<{ x: number; z: number }>(w, 'ledger');
		w.player.state = 'onFoot';
		w.player.vehicle = null;
		w.player.teleport(ledger.x, ledger.z, 0);
		run(w, 0.2);
		expect(active(w).index).toBe(3);
	});

	it('The Gilded Gull: intimidate the clerk inside, escape the police', () => {
		const w = quiet();
		for (const id of ['low_tide', 'static', 'velvet_rope', 'paper_trail']) w.missions.completed.add(id);
		w.missions.start('gilded_gull');
		const inst = w.interiors.instanceFor('exchange')!;
		w.interiors.enter(inst);
		run(w, 0.2);
		expect(active(w).index).toBe(1);
		const counter = at(w, { interior: 'exchange', at: 'counter' });
		w.player.teleport(counter.x, counter.z, 0);
		const clerk = w.interiors.clerk!;
		run(w, 8, () => {
			w.controls.aim = true;
			w.actors.aimedAt(clerk);
		});
		expect(active(w).index).toBe(2);
		w.interiors.exit();
		run(w, 0.2);
		expect(w.wanted.level).toBe(3);
		expect(active(w).index).toBe(3);
	});

	it('Tidewater Rising: clearing the pier completes the story and unlocks the warehouse', () => {
		const w = quiet();
		for (const id of ['low_tide', 'static', 'velvet_rope', 'paper_trail', 'gilded_gull']) w.missions.completed.add(id);
		w.missions.start('tidewater_rising');
		const foot = at(w, { pier: 2, along: 0.06 });
		w.player.teleport(foot.x, foot.z, 0);
		run(w, 0.2);
		expect(active(w).index).toBe(1);
		for (const a of ref<Actor[]>(w, 'yard')) w.actors.kill(a, 'player', 'rifle');
		run(w, 0.2);
		expect(active(w).index).toBe(2);
		const boss = ref<Actor[]>(w, 'boss');
		expect(boss.some((a) => a.maxHealth >= 450)).toBe(true);
		for (const a of boss) w.actors.kill(a, 'player', 'rifle');
		run(w, 0.2);
		const marco = at(w, { poi: 'contact_marco', fwd: 3 });
		w.player.teleport(marco.x, marco.z, 0);
		run(w, 0.2);
		expect(w.missions.completed.has('tidewater_rising')).toBe(true);
		expect(w.economy.properties.has('prop_warehouse')).toBe(true);
	});
});
