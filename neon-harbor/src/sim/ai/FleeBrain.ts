// Getaway driving: keeps re-routing to destinations away from the player, runs lights and
// drives at panic speed. Used by mission chase targets.

import type { Vehicle, VehicleBrain } from '../Vehicle';
import type { World } from '../World';
import { TrafficDriver } from './TrafficDriver';

export class FleeBrain implements VehicleBrain {
	readonly road: TrafficDriver;
	private timer = 0;

	constructor(
		private readonly world: World,
		v: Vehicle,
	) {
		const hit = world.roads.nearestLane(v.x, v.z, v.forwardX, v.forwardZ) ?? world.roads.nearestLane(v.x, v.z)!;
		this.road = new TrafficDriver(world, hit.lane, Math.min(24, v.def.maxSpeed * 0.75));
		this.road.ignoreSignals = true;
	}

	get state(): string {
		return 'flee';
	}

	update(v: Vehicle, dt: number): void {
		const w = this.world;
		this.timer -= dt;
		if (this.timer <= 0 || this.road.arrived) {
			this.timer = 4;
			const p = w.player;
			let dx = v.x - p.px;
			let dz = v.z - p.pz;
			const l = Math.hypot(dx, dz) || 1;
			dx /= l;
			dz /= l;
			const L = w.city.land;
			const tx = Math.max(L.minX + 50, Math.min(L.maxX - 50, v.x + dx * 600));
			const tz = Math.max(L.minZ + 50, Math.min(L.maxZ - 50, v.z + dz * 600));
			if (!w.city.isOnRoad(v.x, v.z)) {
				const hit = w.roads.nearestLane(v.x, v.z, v.forwardX, v.forwardZ) ?? w.roads.nearestLane(v.x, v.z);
				if (hit) {
					this.road.lane = hit.lane;
					this.road.turning = false;
					this.road.next = null;
				}
			}
			this.road.setDestination(tx, tz);
		}
		this.road.panic = 1;
		this.road.update(v, dt);
	}
}
