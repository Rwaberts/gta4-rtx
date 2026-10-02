// Traffic driving brain: follows right-hand lanes on the road graph with pure-pursuit steering,
// obeys signals, keeps a following gap, brakes for pedestrians, recovers when stuck and can
// panic (run lights, speed) after gunfire. Also used for police patrols.

import { angleDiff, clamp, headingTo } from '../../core/math';
import type { Lane, Point } from '../../world/RoadNetwork';
import type { Vehicle, VehicleBrain } from '../Vehicle';
import type { World } from '../World';

const LOOK_MIN = 5;
const LOOK_MAX = 16;

export class TrafficDriver implements VehicleBrain {
	lane: Lane;
	next: Lane | null = null;
	turning = false;
	t = 0;
	turnLen = 1;
	cruise: number;
	panic = 0;
	private reverseTimer = 0;
	private stuck = 0;
	private blockedTime = 0;
	private readonly carrot: Point = { x: 0, z: 0 };
	/** Ignore signals (police patrols in a hurry, panicked drivers). */
	ignoreSignals = false;
	label = 'drive';
	/** Optional node route (A*); when exhausted `arrived` becomes true and driving goes random. */
	route: number[] | null = null;
	arrived = false;

	constructor(
		private readonly world: World,
		lane: Lane,
		cruise: number,
	) {
		this.lane = lane;
		this.cruise = cruise;
	}

	get state(): string {
		return this.label;
	}

	/** Plans a route over the road graph towards a world position. */
	setDestination(x: number, z: number): void {
		const goal = this.world.city.nearestNode(x, z);
		this.arrived = false;
		if (!goal) {
			this.route = null;
			return;
		}
		this.route = this.world.roads.findPath(this.lane.to, goal.id);
		if (this.route && this.route.length <= 1) {
			this.route = null;
			this.arrived = true;
		}
	}

	private chooseNext(): Lane | null {
		const opts = this.lane.next;
		if (!opts.length) return null;
		const roads = this.world.roads;
		if (this.route) {
			const i = this.route.indexOf(this.lane.to);
			const nextNode = i >= 0 ? this.route[i + 1] : undefined;
			if (nextNode !== undefined) {
				const l = roads.laneBetween(this.lane.to, nextNode);
				if (l && opts.includes(l.id)) return l;
			}
			// Route finished (or we fell off it).
			this.arrived = i >= 0 && nextNode === undefined;
			this.route = null;
		}
		// Prefer going straight.
		let straight: Lane | null = null;
		for (const id of opts) {
			const l = roads.lanes[id];
			if (l.dx * this.lane.dx + l.dz * this.lane.dz > 0.99) straight = l;
		}
		if (straight && this.world.rng.chance(0.55)) return straight;
		return roads.lanes[opts[Math.floor(this.world.rng.next() * opts.length)]];
	}

	private reacquire(v: Vehicle): void {
		const hit = this.world.roads.nearestLane(v.x, v.z, v.forwardX, v.forwardZ) ?? this.world.roads.nearestLane(v.x, v.z);
		if (hit) {
			this.lane = hit.lane;
			this.turning = false;
			this.next = null;
		}
	}

	update(v: Vehicle, dt: number): void {
		const w = this.world;
		const roads = w.roads;
		if (this.panic > 0) this.panic -= dt;
		const speed = v.forwardSpeed;

		// Reverse out of a jam.
		if (this.reverseTimer > 0) {
			this.reverseTimer -= dt;
			v.throttle = 0;
			v.brake = 1;
			v.handbrake = false;
			v.steer = v.steer >= 0 ? -0.6 : 0.6;
			if (this.reverseTimer <= 0) this.reacquire(v);
			this.label = 'reverse';
			return;
		}

		let s = 0;
		let distToStop = Infinity;
		const look = clamp(LOOK_MIN + Math.abs(speed) * 0.55, LOOK_MIN, LOOK_MAX);
		if (!this.turning) {
			const L = this.lane;
			s = (v.x - L.sx) * L.dx + (v.z - L.sz) * L.dz;
			const lat = Math.abs((v.x - L.sx) * -L.dz + (v.z - L.sz) * L.dx);
			if (lat > 14 || s < -20) {
				this.reacquire(v);
				return;
			}
			if (!this.next && s > L.len - 30) {
				this.next = this.chooseNext();
				if (this.next) this.turnLen = roads.turnLength(L, this.next);
			}
			distToStop = L.len - s - v.halfLength;
			const sc = s + look;
			if (sc <= L.len || !this.next) {
				this.carrot.x = L.sx + L.dx * Math.min(sc, L.len + 6);
				this.carrot.z = L.sz + L.dz * Math.min(sc, L.len + 6);
			} else {
				roads.turnPoint(L, this.next, Math.min(1, (sc - L.len) / this.turnLen), this.carrot);
			}
			if (s >= L.len && this.next) {
				this.turning = true;
				this.t = Math.min(1, (s - L.len) / this.turnLen);
			}
		} else {
			const L = this.lane;
			const N = this.next!;
			this.t += (Math.max(0, speed) * dt) / this.turnLen;
			const tc = this.t + look / this.turnLen;
			if (tc <= 1) roads.turnPoint(L, N, tc, this.carrot);
			else {
				const sn = (tc - 1) * this.turnLen;
				this.carrot.x = N.sx + N.dx * sn;
				this.carrot.z = N.sz + N.dz * sn;
			}
			if (this.t >= 1) {
				this.lane = N;
				this.next = null;
				this.turning = false;
			}
		}

		// Target speed.
		let target = this.cruise * (this.panic > 0 ? 1.5 : 1);
		const curving = this.next && Math.abs(this.next.dx * this.lane.dx + this.next.dz * this.lane.dz) < 0.5;
		if (curving && (this.turning || distToStop < 22)) target = Math.min(target, 7.5);

		// Signals.
		const node = w.city.nodes[this.lane.to]!;
		if (!this.turning && node.signal && !this.ignoreSignals && this.panic <= 0) {
			const sig = roads.signalAt(node, this.lane.axis, w.time);
			if ((sig === 'red' || (sig === 'yellow' && distToStop > 10)) && distToStop > -1) {
				target = Math.min(target, Math.sqrt(Math.max(0, 2 * 4.5 * (distToStop - 1.5))));
			}
		}

		// Obstacles ahead: vehicles, pedestrians, the player.
		const fx = v.forwardX;
		const fz = v.forwardZ;
		let gap = Infinity;
		let leaderSpeed = 0;
		w.vehicles.hash.query(v.x, v.z, 32, (o) => {
			if (o === v) return;
			const rx = o.x - v.x;
			const rz = o.z - v.z;
			const ahead = rx * fx + rz * fz;
			if (ahead <= 0) return;
			const lateral = Math.abs(rx * -fz + rz * fx);
			if (lateral > 2.4 + o.halfWidth * 0.5) return;
			const g = ahead - v.halfLength - o.halfLength;
			if (g < gap) {
				gap = g;
				leaderSpeed = Math.max(0, o.forwardX * fx * o.forwardSpeed + o.forwardZ * fz * o.forwardSpeed);
			}
		});
		const checkPed = (px: number, pz: number) => {
			const rx = px - v.x;
			const rz = pz - v.z;
			const ahead = rx * fx + rz * fz;
			if (ahead <= 0 || ahead > 18) return;
			if (Math.abs(rx * -fz + rz * fx) > 1.9) return;
			gap = Math.min(gap, ahead - v.halfLength - 0.5);
		};
		w.actors.hash.query(v.x + fx * 9, v.z + fz * 9, 10, (a) => {
			if (a.onFoot && !a.dead && a.knockdown <= 0) checkPed(a.x, a.z);
		});
		const p = w.player;
		if (p.state === 'onFoot') checkPed(p.x, p.z);
		if (gap < Infinity) {
			const follow = Math.max(0, gap - 3) * 0.9 + leaderSpeed * 0.6;
			target = Math.min(target, follow);
			if (gap < 2.5) target = 0;
		}
		if (this.panic > 0) target = Math.max(target, gap > 6 ? 8 : 0);

		// Steering (pure pursuit).
		const desired = headingTo(this.carrot.x - v.x, this.carrot.z - v.z);
		const err = angleDiff(v.heading, desired);
		v.steer = clamp(-err * 2.4, -1, 1);

		// Throttle / brake.
		const e = target - speed;
		v.handbrake = false;
		if (target < 0.3 && speed < 0.8) {
			v.throttle = 0;
			v.brake = 0;
			v.handbrake = true;
		} else if (e > 0.4) {
			v.throttle = clamp(e * 0.35, 0.25, 1);
			v.brake = 0;
		} else if (e < -0.8) {
			v.throttle = 0;
			v.brake = clamp(-e * 0.25, 0.15, 1);
		} else {
			v.throttle = 0.15;
			v.brake = 0;
		}
		this.label = target < 0.3 ? 'wait' : this.turning ? 'turn' : 'drive';

		// Stuck detection (pushed into a wall, blocked by wreck).
		if (v.throttle > 0.2 && Math.abs(speed) < 0.4) {
			this.stuck += dt;
			if (this.stuck > 2.5) {
				this.stuck = 0;
				this.reverseTimer = 1.4;
			}
		} else this.stuck = Math.max(0, this.stuck - dt);

		// Honk at whoever blocks the road for too long.
		if (target < 0.3 && gap < 6) {
			this.blockedTime += dt;
			if (this.blockedTime > 4) {
				this.blockedTime = 0;
				w.bus.emit('sound', { id: 'horn', x: v.x, z: v.z, volume: 0.6 });
			}
		} else this.blockedTime = 0;
	}
}
