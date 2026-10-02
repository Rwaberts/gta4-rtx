import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { Vehicle } from '../../src/sim/Vehicle';
import { SIM } from '../../src/data/config';
import { VEHICLES, vehicleDef } from '../../src/data/vehicles';

const DT = SIM.fixedDt;

function steps(seconds: number, fn: () => void): void {
	for (let i = 0; i < Math.round(seconds / DT); i++) fn();
}

/** A clear stretch of road: the middle of a long horizontal edge. */
function openRoad(w: World): { x: number; z: number } {
	const e = w.city.edges.find((e) => e.horizontal && e.district === 'downtown')!;
	const a = w.city.nodes[e.a]!;
	return { x: a.x + 50, z: a.z + 3.4 };
}

describe('Vehicle physics', () => {
	it('accelerates, respects top speed and brakes to a stop', () => {
		const v = new Vehicle().init(vehicleDef('sedan'), 0, 0, 0, 0xffffff);
		v.throttle = 1;
		steps(3, () => v.integrate(DT));
		const speed3 = v.forwardSpeed;
		expect(speed3).toBeGreaterThan(10);
		steps(30, () => v.integrate(DT));
		expect(v.forwardSpeed).toBeLessThanOrEqual(v.def.maxSpeed + 0.01);
		expect(v.forwardSpeed).toBeGreaterThan(v.def.maxSpeed * 0.85);
		v.throttle = 0;
		v.brake = 1;
		let t = 0;
		while (v.forwardSpeed > 0.5 && t < 10) {
			v.integrate(DT);
			t += DT;
		}
		expect(t).toBeLessThan(5);
	});

	it('steers in the requested direction', () => {
		const v = new Vehicle().init(vehicleDef('sedan'), 0, 0, 0, 0xffffff);
		v.throttle = 1;
		steps(2, () => v.integrate(DT));
		v.steer = 1; // right
		steps(1, () => v.integrate(DT));
		// Facing +z, turning right means heading decreases (towards -x).
		expect(v.heading).toBeLessThan(-0.2);
		expect(v.x).toBeLessThan(0);
	});

	it('handbrake lets the car slide sideways more', () => {
		const slide = (hand: boolean) => {
			const v = new Vehicle().init(vehicleDef('coupe'), 0, 0, 0, 0xffffff);
			v.vz = 30;
			v.steer = 1;
			v.handbrake = hand;
			let maxLat = 0;
			steps(0.8, () => {
				v.integrate(DT);
				const lat = Math.abs(v.vx * -Math.cos(v.heading) + v.vz * Math.sin(v.heading));
				maxLat = Math.max(maxLat, lat);
			});
			return maxLat;
		};
		expect(slide(true)).toBeGreaterThan(slide(false) * 1.5);
	});

	it('reverses when braking from standstill', () => {
		const v = new Vehicle().init(vehicleDef('hatch'), 0, 0, 0, 0xffffff);
		v.brake = 1;
		steps(2, () => v.integrate(DT));
		expect(v.forwardSpeed).toBeLessThan(-2);
		expect(v.forwardSpeed).toBeGreaterThanOrEqual(-v.def.reverseSpeed - 0.01);
	});

	it('all archetypes have sane data', () => {
		for (const d of Object.values(VEHICLES)) {
			expect(d.maxSpeed).toBeGreaterThan(20);
			expect(d.grip).toBeGreaterThan(d.driftGrip);
			expect(d.length).toBeGreaterThan(d.width);
		}
	});
});

/** World with ambient streaming off so isolated physics setups are not despawned. */
function quietWorld(): World {
	const w = new World();
	w.traffic.enabled = false;
	w.actors.density = 0;
	return w;
}

describe('VehicleSystem', () => {
	it('stops vehicles at buildings and damages them on hard impacts', () => {
		const w = quietWorld();
		const b = w.city.buildings.find((x) => x.h > 10 && x.y0 === 0 && x.maxZ - x.minZ > 12)!;
		const z = (b.minZ + b.maxZ) / 2;
		const v = w.vehicles.spawn('sedan', b.minX - 30, z, Math.PI / 2, 'parked')!;
		v.vx = 30;
		const impacts: number[] = [];
		w.bus.on('impact', (e) => impacts.push(e.speed));
		steps(2, () => w.step(DT));
		expect(v.x + v.halfLength).toBeLessThanOrEqual(b.minX + 0.2);
		expect(impacts.length).toBeGreaterThan(0);
		expect(v.health).toBeLessThan(v.def.health);
	});

	it('resolves vehicle-vehicle collisions with momentum transfer', () => {
		const w = quietWorld();
		const r = openRoad(w);
		const a = w.vehicles.spawn('sedan', r.x - 20, r.z, Math.PI / 2, 'parked')!;
		const b = w.vehicles.spawn('sedan', r.x, r.z, Math.PI / 2, 'parked')!;
		a.vx = 20;
		steps(1.5, () => w.step(DT));
		expect(b.x).toBeGreaterThan(r.x + 1);
		expect(a.x + a.halfLength).toBeLessThanOrEqual(b.x - b.halfLength + 0.3);
	});

	it('burns and explodes when health runs out, damaging nearby vehicles', () => {
		const w = quietWorld();
		const r = openRoad(w);
		const a = w.vehicles.spawn('sedan', r.x, r.z, Math.PI / 2, 'parked')!;
		const b = w.vehicles.spawn('hatch', r.x + 7, r.z, Math.PI / 2, 'parked')!;
		let explosions = 0;
		w.bus.on('explosion', () => explosions++);
		w.vehicles.damage(a, a.def.health * 0.9, 'player');
		expect(a.burning).toBe(true);
		steps(10, () => w.step(DT));
		expect(a.destroyed).toBe(true);
		expect(explosions).toBeGreaterThan(0);
		expect(b.health).toBeLessThan(b.def.health);
	});

	it('sinks in water', () => {
		const w = quietWorld();
		const v = w.vehicles.spawn('sedan', 0, w.city.land.maxZ + 20, 0, 'parked')!;
		steps(5, () => w.step(DT));
		expect(v.sinking).toBe(true);
		expect(v.destroyed).toBe(true);
	});

	it('player enters, drives and exits a vehicle; stealing is a crime', () => {
		const w = quietWorld();
		const r = openRoad(w);
		const v = w.vehicles.spawn('sedan', r.x, r.z, Math.PI / 2, 'parked')!;
		const p = w.player;
		p.teleport(r.x, r.z - 2.5, 0);
		const crimes: string[] = [];
		w.bus.on('crime', (c) => crimes.push(c.type));
		w.step(DT); // build spatial hash
		expect(w.vehicles.enterCandidate()).toBe(v);
		w.controls.enterExitPressed = true;
		steps(1, () => w.step(DT));
		expect(p.state).toBe('driving');
		expect(v.driver).toBe('player');
		expect(crimes).toContain('vehicleTheft');
		const x0 = v.x;
		steps(2, () => {
			w.controls.throttle = 1;
			w.step(DT);
		});
		expect(v.x).toBeGreaterThan(x0 + 5);
		expect(p.x).toBeCloseTo(v.x);
		w.controls.throttle = 0;
		steps(4, () => {
			w.controls.brake = 1;
			w.step(DT);
		});
		w.controls.brake = 0;
		w.controls.enterExitPressed = true;
		w.step(DT);
		expect(p.state).toBe('onFoot');
		expect(v.driver).toBeNull();
		// Player is placed beside, not inside, the vehicle.
		const lx = Math.abs((p.x - v.x) * -v.forwardZ + (p.z - v.z) * v.forwardX);
		expect(lx).toBeGreaterThan(v.halfWidth);
	});

	it('explosion kills an on-foot player at point blank', () => {
		const w = quietWorld();
		const p = w.player;
		let died = false;
		w.bus.on('playerDied', () => (died = true));
		w.queueExplosion(p.x, 1, p.z, 9, null);
		w.step(DT);
		expect(died).toBe(true);
		steps(5, () => w.step(DT));
		expect(p.state).toBe('onFoot');
		expect(p.health).toBe(100);
	});
});
