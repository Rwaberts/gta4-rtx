// Police vehicle driving executor. The unit-level state machine (PoliceSystem) decides *what*
// the car does; this brain decides *how*: lane-following patrols, routed responses with sirens,
// direct pursuit with prediction / ramming and obstacle feelers, search sweeps and roadblocks.

import { angleDiff, clamp, headingTo } from '../../core/math';
import type { Vehicle, VehicleBrain } from '../Vehicle';
import type { World } from '../World';
import { TrafficDriver } from './TrafficDriver';

export type PoliceDriveMode = 'patrol' | 'respond' | 'pursue' | 'hold' | 'search';

export class PoliceCarBrain implements VehicleBrain {
	mode: PoliceDriveMode = 'patrol';
	readonly road: TrafficDriver;
	ram = false;
	/** Set by the unit when no officer is behind the wheel. */
	driverless = false;
	private destX = 0;
	private destZ = 0;
	private reverseTimer = 0;
	private stuck = 0;
	private replan = 0;

	constructor(
		private readonly world: World,
		v: Vehicle,
	) {
		const lane = world.roads.nearestLane(v.x, v.z, v.forwardX, v.forwardZ) ?? world.roads.nearestLane(v.x, v.z)!;
		this.road = new TrafficDriver(world, lane.lane, 13);
	}

	get state(): string {
		return this.mode;
	}

	setMode(mode: PoliceDriveMode, v: Vehicle): void {
		if (mode === this.mode) return;
		this.mode = mode;
		this.replan = 0;
		if (mode === 'patrol') {
			this.road.ignoreSignals = false;
			this.road.cruise = 13;
			this.road.route = null;
			this.reacquire(v);
		}
	}

	/** Destination for respond / search modes (re-routed periodically). */
	goTo(x: number, z: number): void {
		const moved = Math.hypot(x - this.destX, z - this.destZ) > 25;
		this.destX = x;
		this.destZ = z;
		if (moved) this.replan = 0;
	}

	get arrived(): boolean {
		return this.road.arrived;
	}

	private reacquire(v: Vehicle): void {
		const hit = this.world.roads.nearestLane(v.x, v.z, v.forwardX, v.forwardZ) ?? this.world.roads.nearestLane(v.x, v.z);
		if (hit) {
			this.road.lane = hit.lane;
			this.road.turning = false;
			this.road.next = null;
		}
	}

	update(v: Vehicle, dt: number): void {
		if (this.driverless || this.mode === 'hold') {
			v.throttle = 0;
			v.brake = v.speed > 0.5 ? 1 : 0;
			v.handbrake = v.speed <= 0.5;
			v.steer = 0;
			return;
		}
		v.sirenOn = this.mode !== 'patrol';
		if (this.mode === 'pursue') {
			this.pursue(v, dt);
			return;
		}
		// Road-following modes.
		if (this.mode === 'respond' || this.mode === 'search') {
			this.replan -= dt;
			if (this.replan <= 0) {
				this.replan = 4;
				// Leaving the road (after a chase) needs a fresh lane first.
				if (!this.world.city.isOnRoad(v.x, v.z) || this.road.arrived) this.reacquire(v);
				this.road.setDestination(this.destX, this.destZ);
			}
			this.road.ignoreSignals = true;
			this.road.cruise = this.mode === 'respond' ? Math.min(v.def.maxSpeed * 0.7, 26) : 12;
		}
		this.road.update(v, dt);
	}

	/** Off-road pursuit straight at (or just behind) the player with simple obstacle avoidance. */
	private pursue(v: Vehicle, dt: number): void {
		const w = this.world;
		const p = w.player;
		const pv = p.state === 'driving' ? p.vehicle : null;
		const tvx = pv ? pv.vx : p.vx;
		const tvz = pv ? pv.vz : p.vz;
		let tx = p.px + tvx * 0.7;
		let tz = p.pz + tvz * 0.7;
		const dx = tx - v.x;
		const dz = tz - v.z;
		const dist = Math.hypot(dx, dz) || 1;
		if (!this.ram || !pv) {
			// Hang back a few car lengths.
			tx -= (dx / dist) * 9;
			tz -= (dz / dist) * 9;
		}

		if (this.reverseTimer > 0) {
			this.reverseTimer -= dt;
			v.throttle = 0;
			v.brake = 1;
			v.handbrake = false;
			v.steer = v.steer >= 0 ? -0.8 : 0.8;
			return;
		}

		const desired = headingTo(tx - v.x, tz - v.z);
		let err = angleDiff(v.heading, desired);
		// Feelers against the static world.
		const look = 7 + v.speed * 0.7;
		const free = (a: number) => {
			const h = v.heading + a;
			const hit = w.collision.raycast(v.x, 1, v.z, Math.sin(h), 0, Math.cos(h), look);
			return hit ? hit.t : look;
		};
		const center = free(0);
		if (center < look * 0.7) {
			const l = free(0.5);
			const r = free(-0.5);
			err += l > r ? 0.6 : -0.6;
		}
		v.steer = clamp(-err * 2.2, -1, 1);

		const targetSpeed = dist < 14 && !this.ram ? Math.max(0, (pv ? pv.speed : p.speed) - 1) : clamp(dist * 0.9, 6, v.def.maxSpeed);
		const turnLimit = Math.abs(err) > 1.1 ? 9 : v.def.maxSpeed;
		const want = Math.min(targetSpeed, turnLimit);
		const speed = v.forwardSpeed;
		v.handbrake = Math.abs(err) > 1.7 && speed > 9;
		if (want < 0.5 && speed < 1) {
			v.throttle = 0;
			v.brake = 0;
			v.handbrake = true;
		} else if (speed < want - 0.5) {
			v.throttle = 1;
			v.brake = 0;
		} else if (speed > want + 2) {
			v.throttle = 0;
			v.brake = 0.7;
		} else {
			v.throttle = 0.3;
			v.brake = 0;
		}
		if (v.throttle > 0.5 && Math.abs(speed) < 0.6) {
			this.stuck += dt;
			if (this.stuck > 1.6) {
				this.stuck = 0;
				this.reverseTimer = 1.2;
			}
		} else this.stuck = Math.max(0, this.stuck - dt);
	}
}
