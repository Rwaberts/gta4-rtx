import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { SIM } from '../../src/data/config';
import { WANTED_LEVELS } from '../../src/data/wanted';
import { PoliceOfficerBrain } from '../../src/sim/ai/PoliceOfficerBrain';

const DT = SIM.fixedDt;
function run(w: World, seconds: number, each?: () => boolean | void): void {
	for (let i = 0; i < Math.round(seconds / DT); i++) {
		if (each?.() === true) return;
		w.step(DT);
	}
}

/** Player on a quiet residential street; ambient crowds off to keep tests deterministic. */
function street(): World {
	const w = new World();
	w.actors.density = 0;
	w.traffic.enabled = false;
	const lane = w.roads.lanes.find((l) => l.district === 'residential' && l.axis === 1)!;
	w.player.teleport(lane.sx + lane.dx * 40, lane.sz + lane.dz * 40 + 5.5, Math.PI / 2);
	return w;
}

function footOfficer(w: World, x: number, z: number) {
	const a = w.actors.spawn('police', 'police', x, z)!;
	a.persistent = true;
	a.weapon = 'pistol';
	a.clip = 12;
	a.brain = new PoliceOfficerBrain(a, w, null, 'patrol');
	w.police.footPatrols.push(a);
	return a;
}

describe('Wanted system', () => {
	it('police witnessing a crime raises the level immediately', () => {
		const w = street();
		const p = w.player;
		footOfficer(w, p.x + 8, p.z);
		w.step(DT);
		w.bus.emit('crime', { type: 'assault', x: p.x, z: p.z, perpetrator: 'player' });
		expect(w.wanted.level).toBeGreaterThanOrEqual(1);
		expect(w.wanted.seen).toBe(true);
	});

	it('unwitnessed crimes do nothing; civilian reports are capped at level 2', () => {
		const w = street();
		const p = w.player;
		w.police.enabled = false;
		w.bus.emit('crime', { type: 'murder', x: p.x, z: p.z, perpetrator: 'player' });
		expect(w.wanted.level).toBe(0);
		w.wanted.report('murder', p.x + 30, p.z, 'civilian');
		w.wanted.report('murder', p.x + 30, p.z, 'civilian');
		expect(w.wanted.level).toBe(2);
		expect(w.wanted.lkpX).toBeCloseTo(p.x + 30);
	});

	it('dispatch sends the configured number of units, and they close in', () => {
		const w = street();
		w.wanted.setLevel(2);
		run(w, 6);
		const units = w.police.units.filter((u) => u.state !== 'patrol');
		expect(units.length).toBeGreaterThanOrEqual(WANTED_LEVELS[2].units);
		const p = w.player;
		const d0 = Math.min(...units.map((u) => Math.hypot(u.x - p.x, u.z - p.z)));
		run(w, 15);
		const d1 = Math.min(...w.police.units.map((u) => Math.hypot(u.x - p.x, u.z - p.z)));
		expect(d1).toBeLessThan(d0);
	});

	it('breaking line of sight leads to a search and eventually clears the level', () => {
		const w = street();
		w.wanted.setLevel(1);
		w.step(DT);
		// Vanish to the far side of the city.
		const n = w.city.nearestNode(-1300, -1300)!;
		w.player.teleport(n.x + 12, n.z + 12, 0);
		let searching = false;
		run(w, 40, () => {
			if (w.wanted.searching) searching = true;
			return w.wanted.level === 0;
		});
		expect(searching).toBe(true);
		expect(w.wanted.level).toBe(0);
	});

	it('officers arrest a compliant player at level 1 and the player respawns at a precinct', () => {
		const w = street();
		const p = w.player;
		w.wanted.setLevel(1);
		const u = w.police.createUnit('police', p.x + 30, p.z, -Math.PI / 2, 'pursue', false, 2, false)!;
		expect(u).not.toBeNull();
		let arrested = false;
		let respawned = '';
		w.bus.on('playerArrested', () => (arrested = true));
		w.bus.on('playerRespawned', (e) => (respawned = e.reason));
		run(w, 40, () => respawned !== '');
		expect(arrested).toBe(true);
		expect(respawned).toBe('arrest');
		expect(w.wanted.level).toBe(0);
		const station = w.city.pois.filter((x) => x.kind === 'police').some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 6);
		expect(station).toBe(true);
	});

	it('uses lethal force at level 4', () => {
		const w = street();
		const p = w.player;
		p.invulnerable = true;
		w.wanted.setLevel(4);
		w.police.createUnit('police', p.x + 25, p.z, -Math.PI / 2, 'pursue', false, 2, false);
		let policeShots = 0;
		w.bus.on('gunshot', (e) => {
			if (e.shooter && e.shooter !== 'player' && e.shooter.role === 'police') policeShots++;
		});
		run(w, 12);
		expect(policeShots).toBeGreaterThan(0);
	});

	it('places roadblocks ahead of a speeding player at level 4', () => {
		const w = street();
		const lane = w.roads.lanes.find((l) => l.district === 'residential' && l.axis === 1)!;
		const v = w.vehicles.spawn('sedan', lane.sx + lane.dx * 10, lane.sz + lane.dz * 10, Math.atan2(lane.dx, lane.dz), 'owned')!;
		v.driver = 'player';
		w.player.state = 'driving';
		w.player.vehicle = v;
		v.vx = lane.dx * 20;
		v.vz = lane.dz * 20;
		w.wanted.setLevel(4);
		const placed = (w.police as unknown as { placeRoadblock(): boolean }).placeRoadblock();
		expect(placed).toBe(true);
		const blocks = w.police.units.filter((u) => u.state === 'roadblock');
		expect(blocks.length).toBe(2);
		for (const b of blocks) {
			// Ahead of the player along the lane.
			expect((b.x - v.x) * lane.dx + (b.z - v.z) * lane.dz).toBeGreaterThan(60);
		}
	});

	it('sends a helicopter at level 5 that spots the player in the open', () => {
		const w = street();
		w.player.invulnerable = true;
		w.wanted.setLevel(5);
		let heliSaw = false;
		run(w, 30, () => {
			if (w.police.heli.sees) heliSaw = true;
			return heliSaw;
		});
		expect(w.police.heli.active).toBe(true);
		expect(heliSaw).toBe(true);
	});

	it('pursuing cars chase down a player vehicle', () => {
		const w = street();
		const p = w.player;
		const v = w.vehicles.spawn('sedan', p.x, p.z - 5.5, Math.PI / 2, 'owned')!;
		v.driver = 'player';
		p.state = 'driving';
		p.vehicle = v;
		w.wanted.setLevel(2);
		let closest = Infinity;
		run(w, 45, () => {
			for (const u of w.police.units) {
				const c = u.car();
				if (c && u.state === 'pursue') closest = Math.min(closest, Math.hypot(c.x - v.x, c.z - v.z));
			}
			return closest < 25;
		});
		expect(closest).toBeLessThan(25);
	});
});
