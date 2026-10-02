import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { SIM } from '../../src/data/config';
import { TrafficDriver } from '../../src/sim/ai/TrafficDriver';
import { CivilianBrain } from '../../src/sim/ai/CivilianBrain';

const DT = SIM.fixedDt;
function run(w: World, seconds: number, each?: () => void): void {
	for (let i = 0; i < Math.round(seconds / DT); i++) {
		each?.();
		w.step(DT);
	}
}

/** Downtown street-level spawn point at noon. */
function downtownWorld(): World {
	const w = new World();
	w.clock.setHour(12);
	const n = w.city.nearestNode(0, 150)!;
	w.player.teleport(n.x + 12, n.z + 12, 0);
	return w;
}

describe('RoadNetwork', () => {
	it('builds two lanes per edge and never offers U-turns', () => {
		const w = new World();
		expect(w.roads.lanes.length).toBe(w.city.edges.length * 2);
		for (const l of w.roads.lanes) {
			expect(l.next.length).toBeGreaterThan(0);
			for (const id of l.next) expect(w.roads.lanes[id].to).not.toBe(l.from);
			// Right-hand traffic: lane line is offset to the right of the centre line.
			const from = w.city.nodes[l.from]!;
			const rx = -l.dz;
			const rz = l.dx;
			expect((l.sx - from.x) * rx + (l.sz - from.z) * rz).toBeGreaterThan(3);
		}
	});

	it('A* finds a route across the city', () => {
		const w = new World();
		const a = w.city.nearestNode(-1300, -1300)!;
		const b = w.city.nearestNode(1250, 950)!;
		const path = w.roads.findPath(a.id, b.id)!;
		expect(path).not.toBeNull();
		expect(path[0]).toBe(a.id);
		expect(path[path.length - 1]).toBe(b.id);
		for (let i = 1; i < path.length; i++) expect(w.roads.laneBetween(path[i - 1], path[i])).not.toBeNull();
		const route = w.roads.route(-1300, -1300, 1250, 950);
		expect(route.length).toBe(path.length + 2);
	});

	it('signals give perpendicular axes opposite phases', () => {
		const w = new World();
		const n = w.city.nodeList.find((x) => x.signal)!;
		let conflicts = 0;
		let greens = 0;
		for (let t = 0; t < 60; t += 0.5) {
			const ns = w.roads.signalAt(n, 0, t);
			const ew = w.roads.signalAt(n, 1, t);
			if (ns === 'green' && ew !== 'red') conflicts++;
			if (ew === 'green' && ns !== 'red') conflicts++;
			if (ns === 'green') greens++;
		}
		expect(conflicts).toBe(0);
		expect(greens).toBeGreaterThan(10);
	});
});

describe('Traffic', () => {
	it('a traffic driver follows lanes through intersections and stays on the road', () => {
		const w = new World();
		w.traffic.enabled = false;
		w.actors.density = 0;
		const lane = w.roads.lanes.find((l) => l.district === 'residential')!;
		const v = w.vehicles.spawn('sedan', lane.sx, lane.sz, Math.atan2(lane.dx, lane.dz), 'traffic')!;
		v.brain = new TrafficDriver(w, lane, 12);
		w.player.teleport(lane.sx + 30, lane.sz + 30, 0);
		let off = 0;
		let samples = 0;
		const startLane = lane.id;
		let changedLane = false;
		run(w, 40, () => {
			w.player.teleport(v.x + 25, v.z + 25, 0); // keep it in range of the streamer
			if (++samples % 30 === 0 && !w.city.isOnRoad(v.x, v.z)) off++;
			if ((v.brain as TrafficDriver).lane.id !== startLane) changedLane = true;
		});
		expect(changedLane).toBe(true);
		expect(off / (samples / 30)).toBeLessThan(0.05);
		expect(v.health).toBeGreaterThan(v.def.health * 0.8);
	});

	it('streams traffic and parked cars around the player', () => {
		const w = downtownWorld();
		run(w, 20);
		const traffic = w.vehicles.list.filter((v) => v.role === 'traffic');
		const parked = w.vehicles.list.filter((v) => v.role === 'parked');
		expect(traffic.length).toBeGreaterThan(5);
		expect(parked.length).toBeGreaterThan(3);
		// Every traffic vehicle has a driver actor.
		for (const v of traffic) expect(v.driver && v.driver !== 'player').toBeTruthy();
		const moving = traffic.filter((v) => v.speed > 1).length;
		expect(moving).toBeGreaterThan(traffic.length * 0.3);
	});

	it('despawns traffic when the player leaves', () => {
		const w = downtownWorld();
		run(w, 10);
		const before = w.vehicles.list.filter((v) => v.role === 'traffic').length;
		expect(before).toBeGreaterThan(0);
		w.player.teleport(-1300, -1300, 0);
		run(w, 2);
		const near = w.vehicles.list.filter((v) => v.role === 'traffic' && Math.hypot(v.x - 0, v.z - 150) < 200).length;
		expect(near).toBe(0);
	});
});

describe('Pedestrians', () => {
	it('populates the district towards the scheduled target and keeps peds on land', () => {
		const w = downtownWorld();
		run(w, 15);
		const peds = w.actors.list.filter((a) => a.role === 'civilian' && !a.vehicle);
		expect(peds.length).toBeGreaterThan(w.actors.targetPopulation() * 0.6);
		for (const a of peds) expect(w.city.isLand(a.x, a.z)).toBe(true);
		// Wandering peds actually walk.
		const walking = peds.filter((a) => a.speed > 0.5).length;
		expect(walking).toBeGreaterThan(peds.length * 0.3);
	});

	it('night and rural areas are quieter than downtown at noon', () => {
		const w = downtownWorld();
		const noon = w.actors.targetPopulation();
		w.clock.setHour(3);
		const night = w.actors.targetPopulation();
		w.clock.setHour(12);
		const n = w.city.nearestNode(-900, -1100)!;
		w.player.teleport(n.x, n.z, 0);
		const rural = w.actors.targetPopulation();
		expect(night).toBeLessThan(noon * 0.5);
		expect(rural).toBeLessThan(noon * 0.3);
	});

	it('civilians flee from gunshots and witnesses phone crimes in', () => {
		const w = downtownWorld();
		run(w, 12);
		const p = w.player;
		const near = w.actors.list.filter((a) => a.role === 'civilian' && a.onFoot && Math.hypot(a.x - p.x, a.z - p.z) < 40);
		expect(near.length).toBeGreaterThan(0);
		const reports: string[] = [];
		w.bus.on('crimeReported', (r) => reports.push(r.type));
		w.bus.emit('gunshot', { x: p.x, y: 1.4, z: p.z, shooter: 'player', radius: 60 });
		run(w, 0.5);
		const scared = near.filter((a) => a.brain instanceof CivilianBrain && (a.brain.state === 'flee' || a.brain.state === 'cower')).length;
		expect(scared).toBeGreaterThan(near.length * 0.6);
		// Witnessed crime: some civilians call the police within ~20 seconds.
		for (let i = 0; i < 4; i++) {
			w.bus.emit('crime', { type: 'assault', x: p.x, z: p.z, perpetrator: 'player' });
			run(w, 5);
		}
		expect(reports.length).toBeGreaterThan(0);
	});

	it('vehicles knock down pedestrians and the player is blamed', () => {
		const w = downtownWorld();
		w.actors.density = 0;
		w.traffic.enabled = false;
		const lane = w.roads.lanes.find((l) => l.district === 'downtown' && l.axis === 1)!;
		const a = w.actors.spawnCivilian(lane.sx + lane.dx * 40, lane.sz + lane.dz * 40)!;
		a.brain = null;
		const v = w.vehicles.spawn('suv', lane.sx, lane.sz, Math.atan2(lane.dx, lane.dz), 'parked')!;
		v.driver = 'player';
		w.player.state = 'driving';
		w.player.vehicle = v;
		const crimes: string[] = [];
		w.bus.on('crime', (c) => crimes.push(c.type));
		run(w, 5, () => {
			w.controls.throttle = 1;
		});
		expect(a.health).toBeLessThan(100);
		expect(crimes).toContain('hitPedestrian');
	});

	it('simulates a full district crowd within budget', () => {
		const w = downtownWorld();
		run(w, 15);
		const t0 = performance.now();
		const steps = 300;
		for (let i = 0; i < steps; i++) w.step(DT);
		const ms = (performance.now() - t0) / steps;
		expect(w.actors.count + w.vehicles.count).toBeGreaterThan(60);
		// Generous bound for CI machines; typically well under 1 ms per step.
		expect(ms).toBeLessThan(6);
	});
});
