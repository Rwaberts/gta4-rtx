// Streams ambient traffic and curb-parked cars around the player. Density follows the district
// table and time of day; vehicles and their drivers are pooled and despawned out of range.

import { SIM, WORLD } from '../data/config';
import { DISTRICTS } from '../data/districts';
import { TrafficDriver } from './ai/TrafficDriver';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

/** Hour-of-day traffic multiplier. */
const TRAFFIC_HOURLY = [0.35, 0.25, 0.2, 0.2, 0.25, 0.45, 0.75, 1, 1, 0.9, 0.85, 0.9, 0.95, 0.9, 0.85, 0.9, 1, 1, 0.95, 0.8, 0.65, 0.55, 0.5, 0.42];

export class TrafficSystem {
	private timer = 0;
	/** Multiplier from settings. */
	density = 1;
	/** When false, no streaming happens at all (no spawns, no despawns). */
	enabled = true;

	constructor(private readonly world: World) {}

	targetTraffic(): number {
		const w = this.world;
		const d = DISTRICTS[w.city.districtAt(w.player.px, w.player.pz)];
		return Math.round(30 * this.density * d.trafficDensity * TRAFFIC_HOURLY[w.clock.hourInt] * (1 - w.wetness * 0.2));
	}

	targetParked(): number {
		const w = this.world;
		const d = DISTRICTS[w.city.districtAt(w.player.px, w.player.pz)];
		return Math.round(16 * this.density * d.parkedDensity);
	}

	step(dt: number): void {
		this.timer -= dt;
		if (this.timer > 0) return;
		this.timer = 0.4;
		this.manage();
	}

	private manage(): void {
		if (!this.enabled) return;
		const w = this.world;
		const p = w.player;
		const px = p.px;
		const pz = p.pz;
		let traffic = 0;
		let parked = 0;
		for (let i = w.vehicles.list.length - 1; i >= 0; i--) {
			const v = w.vehicles.list[i];
			if (v.persistent || v.driver === 'player') continue;
			const d = Math.hypot(v.x - px, v.z - pz);
			const limit = v.role === 'parked' ? SIM.parkedDespawn : SIM.trafficDespawn;
			const stuck = v.brain instanceof TrafficDriver && v.stuckTime > 12 && d > 60;
			if (d > limit || stuck || (v.destroyed && d > 120 && v.age > 60)) {
				w.vehicles.despawn(v);
				continue;
			}
			if (v.role === 'traffic') traffic++;
			else if (v.role === 'parked') parked++;
		}
		const tTarget = this.targetTraffic();
		for (let n = 0; n < 2 && traffic < tTarget; n++) if (this.spawnTraffic()) traffic++;
		const pTarget = this.targetParked();
		for (let n = 0; n < 2 && parked < pTarget; n++) if (this.spawnParked()) parked++;
	}

	private clearAround(x: number, z: number, r: number): boolean {
		let clear = true;
		this.world.vehicles.hash.query(x, z, r, () => {
			clear = false;
			return true;
		});
		const p = this.world.player;
		if (Math.hypot(p.x - x, p.z - z) < r) clear = false;
		return clear;
	}

	/** Prefers spawning outside the camera's view when close. */
	private visible(x: number, z: number): boolean {
		const v = this.world.view;
		const dx = x - v.x;
		const dz = z - v.z;
		const d = Math.hypot(dx, dz);
		if (d > 200) return false;
		return (dx * v.dirX + dz * v.dirZ) / d > 0.35;
	}

	spawnTraffic(): Vehicle | null {
		const w = this.world;
		const lanes = w.roads.lanes;
		const p = w.player;
		for (let tries = 0; tries < 16; tries++) {
			const lane = lanes[Math.floor(w.rng.next() * lanes.length)];
			const s = w.rng.range(8, lane.len - 8);
			const x = lane.sx + lane.dx * s;
			const z = lane.sz + lane.dz * s;
			const d = Math.hypot(x - p.px, z - p.pz);
			if (d < SIM.trafficSpawnMin || d > SIM.trafficSpawnMax) continue;
			if (this.visible(x, z) && tries < 12) continue;
			if (!this.clearAround(x, z, 14)) continue;
			const district = DISTRICTS[w.city.districtAt(x, z)];
			const id = w.vehicles.pickArchetype(district.vehicleMix);
			const heading = Math.atan2(lane.dx, lane.dz);
			const v = w.vehicles.spawn(id, x, z, heading, 'traffic');
			if (!v) return null;
			const driver = w.actors.spawnDriver(v);
			if (!driver) {
				w.vehicles.despawn(v);
				return null;
			}
			const cruise = (lane.district === 'rural' ? 17 : lane.district === 'downtown' || lane.district === 'financial' ? 12 : 14) * w.rng.range(0.85, 1.1);
			v.brain = new TrafficDriver(w, lane, Math.min(cruise, v.def.maxSpeed * 0.8));
			v.vx = lane.dx * cruise * 0.7;
			v.vz = lane.dz * cruise * 0.7;
			return v;
		}
		return null;
	}

	spawnParked(): Vehicle | null {
		const w = this.world;
		const p = w.player;
		const c = w.city.cellSize;
		for (let tries = 0; tries < 10; tries++) {
			const ang = w.rng.range(0, Math.PI * 2);
			const r = w.rng.range(55, SIM.parkedSpawnMax);
			const cell = w.city.cellAt(p.px + Math.cos(ang) * r, p.pz + Math.sin(ang) * r);
			if (!cell || cell.kind === 'airport' || cell.kind === 'field') continue;
			const sides = (['n', 's', 'w', 'e'] as const).filter((s) => cell.roads[s]);
			if (!sides.length) continue;
			const side = sides[Math.floor(w.rng.next() * sides.length)];
			const t = w.rng.range(16, c - 16);
			const off = WORLD.parkingOffset;
			let x: number;
			let z: number;
			let heading: number;
			// Parked on the curb side, facing the direction of the adjacent lane.
			if (side === 'n') {
				x = cell.i * c + t;
				z = cell.j * c + off;
				heading = Math.PI / 2;
			} else if (side === 's') {
				x = cell.i * c + t;
				z = (cell.j + 1) * c - off;
				heading = -Math.PI / 2;
			} else if (side === 'w') {
				x = cell.i * c + off;
				z = cell.j * c + t;
				heading = Math.PI;
			} else {
				x = (cell.i + 1) * c - off;
				z = cell.j * c + t;
				heading = 0;
			}
			if (!this.clearAround(x, z, 7)) continue;
			if (this.visible(x, z) && Math.hypot(x - p.px, z - p.pz) < 90) continue;
			const id = w.vehicles.pickArchetype(DISTRICTS[cell.district].vehicleMix);
			if (id === 'bus' || id === 'taxi') continue;
			return w.vehicles.spawn(id, x, z, heading, 'parked');
		}
		return null;
	}
}
