// Owns every active vehicle: pooling, physics stepping, collision response (static world and
// vehicle-vs-vehicle rigid body impulses), damage / fire / explosion / sinking, and the player's
// enter / exit / carjack flow.

import { SpatialHash } from '../core/SpatialHash';
import { clamp } from '../core/math';
import { PLAYER, SIM } from '../data/config';
import { VEHICLES, vehicleDef } from '../data/vehicles';
import type { Contact } from '../world/StaticCollision';
import type { Actor } from './Actor';
import type { Attacker } from './events';
import { Vehicle, type VehicleRole } from './Vehicle';
import type { World } from './World';

interface ObbHit {
	nx: number;
	nz: number;
	depth: number;
	px: number;
	pz: number;
}

const ENTER_TIME = 0.6;

export class VehicleSystem {
	readonly list: Vehicle[] = [];
	private pool: Vehicle[] = [];
	readonly hash = new SpatialHash<Vehicle>(16);
	private contacts: Contact[] = [];
	private hit: ObbHit = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };

	constructor(private readonly world: World) {}

	get count(): number {
		return this.list.length;
	}

	spawn(defId: string, x: number, z: number, heading: number, role: VehicleRole = 'parked', color?: number): Vehicle | null {
		if (this.list.length >= SIM.maxVehicles) return null;
		const def = vehicleDef(defId);
		const v = this.pool.pop() ?? new Vehicle();
		v.init(def, x, z, heading, color ?? def.colors[Math.floor(this.world.rng.next() * def.colors.length)]);
		v.role = role;
		if (def.police) v.role = role === 'parked' ? 'police' : role;
		this.list.push(v);
		return v;
	}

	despawn(v: Vehicle): void {
		const i = this.list.indexOf(v);
		if (i < 0) return;
		if (v.driver === 'player') return;
		v.brain?.dispose?.(v);
		v.brain = null;
		this.world.onVehicleDespawn?.(v);
		this.list.splice(i, 1);
		this.pool.push(v);
	}

	/** Removes every vehicle (new game / load). */
	clear(): void {
		const p = this.world.player;
		if (p.vehicle) {
			p.vehicle.driver = null;
			p.vehicle = null;
			if (p.state === 'driving' || p.state === 'entering') p.state = 'onFoot';
		}
		for (const v of [...this.list]) {
			v.persistent = false;
			this.despawn(v);
		}
		this.hash.clear();
	}

	nearest(x: number, z: number, r: number, filter?: (v: Vehicle) => boolean): Vehicle | null {
		return this.hash.nearest(x, z, r, filter);
	}

	damage(v: Vehicle, amount: number, by: Attacker): void {
		if (v.destroyed || amount <= 0) return;
		v.health -= amount;
		if (by) v.lastDamagedBy = by;
		if (v.health <= 0) {
			this.explode(v, by);
		} else if (v.health < v.def.health * 0.15 && v.burnTimer < 0) {
			v.burnTimer = 5 + this.world.rng.next() * 3;
		}
	}

	explode(v: Vehicle, by: Attacker): void {
		if (v.destroyed) return;
		v.destroyed = true;
		v.health = 0;
		v.burnTimer = -1;
		v.vy = 5;
		v.sirenOn = false;
		const blame = by ?? v.lastDamagedBy;
		this.world.bus.emit('vehicleDestroyed', { vehicle: v, by: blame });
		this.world.queueExplosion(v.x, 1, v.z, 9, blame);
		if (v.driver === 'player') {
			this.ejectPlayer(v, true);
			this.world.damagePlayer(140, blame);
		}
	}

	step(dt: number): void {
		const w = this.world;
		const grip = 1 - 0.28 * w.wetness;
		this.updatePlayerVehicle(dt);

		for (const v of this.list) {
			if (v.driver === 'player') {
				// Inputs already written by updatePlayerVehicle.
			} else if (v.brain && !v.destroyed) {
				v.brain.update(v, dt);
			} else {
				v.throttle = 0;
				v.brake = v.speed > 0.3 ? 0.4 : 0;
				v.steer = 0;
				v.handbrake = v.speed < 0.3;
			}
			v.integrate(dt, grip);
			this.collideStatic(v);
			this.updateState(v, dt);
		}

		this.hash.clear();
		for (const v of this.list) this.hash.insert(v);
		this.collidePairs();
		this.collidePlayerOnFoot();
		// Keep the driving player glued to the vehicle after physics.
		const p = w.player;
		if (p.state === 'driving' && p.vehicle) {
			p.x = p.vehicle.x;
			p.z = p.vehicle.z;
			p.heading = p.vehicle.heading;
		}
	}

	private updateState(v: Vehicle, dt: number): void {
		const w = this.world;
		// Water.
		if (!v.sinking && !w.city.isLand(v.x, v.z)) {
			v.sinking = true;
			v.sinkTime = 0;
			v.sirenOn = false;
			if (v.driver === 'player') {
				w.bus.emit('notify', { text: 'Your vehicle is sinking!', kind: 'bad' });
			}
		}
		if (v.sinking) {
			v.sinkTime += dt;
			v.y = Math.max(-4, v.y - dt * 0.9);
			v.vx *= Math.exp(-2 * dt);
			v.vz *= Math.exp(-2 * dt);
			if (v.sinkTime > 1.2 && v.driver === 'player') this.ejectPlayer(v, true);
			if (v.sinkTime > 4 && !v.destroyed) {
				v.destroyed = true;
				v.health = 0;
				w.bus.emit('vehicleDestroyed', { vehicle: v, by: v.lastDamagedBy });
			}
			return;
		}
		// Explosion pop.
		if (v.y > 0 || v.vy > 0) {
			v.vy += SIM.gravity * 0.5 * dt;
			v.y = Math.max(0, v.y + v.vy * dt);
			if (v.y === 0) v.vy = 0;
		}
		// Fire.
		if (v.burnTimer >= 0 && !v.destroyed) {
			v.burnTimer -= dt;
			v.health -= dt * v.def.health * 0.02;
			if (v.burnTimer <= 0) this.explode(v, v.lastDamagedBy);
		}
	}

	private collideStatic(v: Vehicle): void {
		const col = this.world.collision;
		const n = col.collideOBB(v.x, v.z, v.forwardX, v.forwardZ, v.halfLength, v.halfWidth, v.y, v.y + v.def.height, this.contacts);
		for (let i = 0; i < n; i++) {
			const c = this.contacts[i];
			v.x += c.nx * c.depth;
			v.z += c.nz * c.depth;
			this.applyImpulse(v, null, c.nx, c.nz, c.px, c.pz, 0.25);
		}
		if (n > 0) v.stuckTime += 1 / 60;
		else v.stuckTime = Math.max(0, v.stuckTime - 1 / 120);
	}

	/**
	 * Rigid-body impulse between `a` and `b` (or the static world when b is null). Normal points
	 * from b towards a. Applies damage proportional to the closing speed.
	 */
	private applyImpulse(a: Vehicle, b: Vehicle | null, nx: number, nz: number, px: number, pz: number, restitution: number): void {
		const rax = px - a.x;
		const raz = pz - a.z;
		let vax = a.vx + a.angVel * raz;
		let vaz = a.vz - a.angVel * rax;
		let rbx = 0;
		let rbz = 0;
		if (b) {
			rbx = px - b.x;
			rbz = pz - b.z;
			vax -= b.vx + b.angVel * rbz;
			vaz -= b.vz - b.angVel * rbx;
		}
		const vn = vax * nx + vaz * nz;
		if (vn >= 0) return;
		const ka = raz * nx - rax * nz;
		const kb = rbz * nx - rbx * nz;
		let denom = 1 / a.mass + (ka * ka) / a.inertia;
		if (b) denom += 1 / b.mass + (kb * kb) / b.inertia;
		const j = (-(1 + restitution) * vn) / denom;
		a.vx += (j * nx) / a.mass;
		a.vz += (j * nz) / a.mass;
		a.angVel += (ka * j) / a.inertia;
		if (b) {
			b.vx -= (j * nx) / b.mass;
			b.vz -= (j * nz) / b.mass;
			b.angVel -= (kb * j) / b.inertia;
		}
		// Tangential friction.
		const tx = -nz;
		const tz = nx;
		const vt = vax * tx + vaz * tz;
		const jt = clamp(-vt / denom, -0.3 * j, 0.3 * j);
		a.vx += (jt * tx) / a.mass;
		a.vz += (jt * tz) / a.mass;
		if (b) {
			b.vx -= (jt * tx) / b.mass;
			b.vz -= (jt * tz) / b.mass;
		}

		const impact = -vn;
		if (impact > 4) {
			const w = this.world;
			if (a.impactCooldown <= 0) {
				a.impactCooldown = 0.25;
				w.bus.emit('impact', { x: px, z: pz, speed: impact, vehicle: a, other: b });
			}
			const dmg = (impact - 4) * 9;
			// Heavier vehicles take less damage from the same hit.
			const blameA: Attacker = b?.driver ?? null;
			const blameB: Attacker = a.driver;
			this.damage(a, dmg * (b ? clamp(b.mass / a.mass, 0.3, 2.5) : 1), blameA);
			if (b) this.damage(b, dmg * clamp(a.mass / b.mass, 0.3, 2.5), blameB);
			if (a.driver === 'player' && impact > 12) w.damagePlayer((impact - 12) * 1.5, null);
		}
	}

	private collidePairs(): void {
		for (const a of this.list) {
			this.hash.query(a.x, a.z, a.halfLength + 6, (b) => {
				if (b.id <= a.id) return;
				if (!this.obbVsObb(a, b, this.hit)) return;
				const h = this.hit;
				const total = 1 / a.mass + 1 / b.mass;
				const sa = (1 / a.mass) / total;
				a.x += h.nx * h.depth * sa;
				a.z += h.nz * h.depth * sa;
				b.x -= h.nx * h.depth * (1 - sa);
				b.z -= h.nz * h.depth * (1 - sa);
				this.applyImpulse(a, b, h.nx, h.nz, h.px, h.pz, 0.2);
			});
		}
	}

	/** SAT test between two vehicle footprints. Normal points from b to a. */
	private obbVsObb(a: Vehicle, b: Vehicle, out: ObbHit): boolean {
		const afx = a.forwardX, afz = a.forwardZ, arx = -afz, arz = afx;
		const bfx = b.forwardX, bfz = b.forwardZ, brx = -bfz, brz = bfx;
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const axes = [afx, afz, arx, arz, bfx, bfz, brx, brz];
		let best = Infinity;
		let nx = 0;
		let nz = 0;
		for (let i = 0; i < 8; i += 2) {
			const ax = axes[i];
			const az = axes[i + 1];
			const ra = a.halfLength * Math.abs(afx * ax + afz * az) + a.halfWidth * Math.abs(arx * ax + arz * az);
			const rb = b.halfLength * Math.abs(bfx * ax + bfz * az) + b.halfWidth * Math.abs(brx * ax + brz * az);
			const d = dx * ax + dz * az;
			const o = ra + rb - Math.abs(d);
			if (o <= 0) return false;
			if (o < best) {
				best = o;
				nx = d > 0 ? -ax : ax;
				nz = d > 0 ? -az : az;
			}
		}
		out.nx = nx;
		out.nz = nz;
		out.depth = best;
		// Contact: average of corners penetrating the other box, else midpoint.
		let cx = 0;
		let cz = 0;
		let cn = 0;
		const inside = (o: Vehicle, px: number, pz: number) => {
			const lx = (px - o.x) * -o.forwardZ + (pz - o.z) * o.forwardX;
			const lz = (px - o.x) * o.forwardX + (pz - o.z) * o.forwardZ;
			return Math.abs(lx) <= o.halfWidth && Math.abs(lz) <= o.halfLength;
		};
		for (const [s, o] of [
			[a, b],
			[b, a],
		] as const) {
			for (const sl of [-1, 1]) {
				for (const sw of [-1, 1]) {
					const px = s.x + s.forwardX * s.halfLength * sl - s.forwardZ * s.halfWidth * sw;
					const pz = s.z + s.forwardZ * s.halfLength * sl + s.forwardX * s.halfWidth * sw;
					if (inside(o, px, pz)) {
						cx += px;
						cz += pz;
						cn++;
					}
				}
			}
		}
		out.px = cn ? cx / cn : (a.x + b.x) / 2;
		out.pz = cn ? cz / cn : (a.z + b.z) / 2;
		return true;
	}

	/** Keeps the on-foot player out of vehicles; fast vehicles knock the player down. */
	private collidePlayerOnFoot(): void {
		const p = this.world.player;
		if (p.state !== 'onFoot') return;
		this.hash.query(p.x, p.z, 10, (v) => {
			if (v.sinking) return;
			const fx = v.forwardX;
			const fz = v.forwardZ;
			const dx = p.x - v.x;
			const dz = p.z - v.z;
			const lx = dx * -fz + dz * fx;
			const lz = dx * fx + dz * fz;
			const cx = clamp(lx, -v.halfWidth, v.halfWidth);
			const cz = clamp(lz, -v.halfLength, v.halfLength);
			let ox = lx - cx;
			let oz = lz - cz;
			let d = Math.hypot(ox, oz);
			const r = p.radius;
			if (d >= r || p.y > v.def.height) return;
			if (d < 1e-4) {
				// Inside: push out sideways.
				ox = lx >= 0 ? 1 : -1;
				oz = 0;
				d = 0;
			} else {
				ox /= d;
				oz /= d;
			}
			const push = r - d;
			const wx = ox * -fz + oz * fx;
			const wz = ox * fx + oz * fz;
			p.x += wx * push;
			p.z += wz * push;
			const closing = -(v.vx * wx + v.vz * wz);
			const rel = Math.max(0, -closing);
			if (v.speed > 5 && rel > 4) {
				this.world.damagePlayer(rel * rel * 0.35, v.driver);
				p.vx = v.vx * 0.8 + wx * 4;
				p.vz = v.vz * 0.8 + wz * 4;
				p.vy = 3;
				p.onGround = false;
			}
		});
	}

	// ------------------------------------------------------------ player vehicle

	/** Vehicle the player could enter right now, if any. */
	enterCandidate(): Vehicle | null {
		const p = this.world.player;
		if (p.state !== 'onFoot') return null;
		return this.hash.nearest(p.x, p.z, PLAYER.vehicleEnterRange + 3, (v) => {
			if (v.destroyed || v.sinking) return false;
			const dx = p.x - v.x;
			const dz = p.z - v.z;
			const lx = Math.abs(dx * -v.forwardZ + dz * v.forwardX) - v.halfWidth;
			const lz = Math.abs(dx * v.forwardX + dz * v.forwardZ) - v.halfLength;
			return Math.max(lx, lz, 0) < PLAYER.vehicleEnterRange - 1.5;
		});
	}

	private updatePlayerVehicle(dt: number): void {
		const w = this.world;
		const p = w.player;
		const c = w.controls;
		if (p.state === 'onFoot' && c.enterExitPressed) {
			const v = this.enterCandidate();
			if (v) this.beginEnter(v);
		} else if (p.state === 'entering') {
			const v = p.vehicle!;
			if (v.destroyed || v.sinking) {
				p.state = 'onFoot';
				p.vehicle = null;
				return;
			}
			p.transition += dt / ENTER_TIME;
			const door = v.doorPoint(-1);
			const t = Math.min(1, p.transition);
			p.x = p.transitionFrom.x + (door.x - p.transitionFrom.x) * t;
			p.z = p.transitionFrom.z + (door.z - p.transitionFrom.z) * t;
			p.heading = v.heading;
			p.speed = 2;
			if (p.transition >= 1) this.finishEnter(v);
		} else if (p.state === 'driving' && p.vehicle) {
			const v = p.vehicle;
			v.throttle = c.throttle;
			v.brake = c.brake;
			v.steer = c.steer;
			v.handbrake = c.handbrake;
			v.horn = c.horn;
			p.x = v.x;
			p.z = v.z;
			p.y = 0;
			p.heading = v.heading;
			if (c.enterExitPressed) this.exitVehicle(v);
		}
	}

	private beginEnter(v: Vehicle): void {
		const w = this.world;
		const p = w.player;
		p.state = 'entering';
		p.vehicle = v;
		p.transition = 0;
		p.transitionFrom.x = p.x;
		p.transitionFrom.z = p.z;
		p.crouching = false;
		p.aiming = false;
		// Pull out an NPC driver (carjack).
		const d = v.driver;
		if (d && d !== 'player') {
			w.ejectDriver(v, true);
			w.bus.emit('crime', { type: 'carjack', x: v.x, z: v.z, perpetrator: 'player', victim: d as Actor });
		} else if (v.role !== 'owned' && v.role !== 'mission' && v.tag !== 'player-used') {
			w.bus.emit('crime', { type: v.def.police ? 'policeVehicleTheft' : 'vehicleTheft', x: v.x, z: v.z, perpetrator: 'player' });
		}
	}

	private finishEnter(v: Vehicle): void {
		const w = this.world;
		const p = w.player;
		const stolen = v.role !== 'owned' && v.role !== 'mission' && v.tag !== 'player-used';
		p.state = 'driving';
		v.brain?.dispose?.(v);
		v.brain = null;
		v.driver = 'player';
		v.tag = v.tag || 'player-used';
		if (v.role === 'traffic' || v.role === 'parked') v.role = 'abandoned';
		v.persistent = true;
		w.bus.emit('playerEnteredVehicle', { vehicle: v, stolen });
	}

	exitVehicle(v: Vehicle): void {
		const w = this.world;
		const p = w.player;
		if (v.speed > 7) {
			// Bail out of a moving vehicle.
			this.ejectPlayer(v, false);
			w.damagePlayer(Math.min(35, v.speed * 1.2), null);
			p.vx = v.vx * 0.5;
			p.vz = v.vz * 0.5;
			return;
		}
		this.ejectPlayer(v, false);
		v.handbrake = true;
	}

	/** Places the player beside the vehicle, preferring the driver side. */
	ejectPlayer(v: Vehicle, swim: boolean): void {
		const w = this.world;
		const p = w.player;
		if (p.vehicle !== v) return;
		let spot = v.doorPoint(-1);
		const test = { x: spot.x, z: spot.z };
		if (w.collision.resolveCircle(test, p.radius, 0, 1.8)) {
			const other = v.doorPoint(1);
			const t2 = { x: other.x, z: other.z };
			spot = w.collision.resolveCircle(t2, p.radius, 0, 1.8) ? test : other;
		}
		p.state = 'onFoot';
		p.vehicle = null;
		p.teleport(spot.x, spot.z, v.heading, swim ? p.y : 0);
		v.driver = null;
		v.throttle = 0;
		v.steer = 0;
		v.horn = false;
		if (v.role !== 'owned' && v.role !== 'mission') v.role = 'abandoned';
		v.persistent = v.role === 'owned' || v.role === 'mission';
		w.bus.emit('playerExitedVehicle', { vehicle: v });
	}

	/** Random vehicle archetype weighted by a mix table. */
	pickArchetype(mix: Record<string, number>): string {
		const id = this.world.rng.weighted(mix);
		return VEHICLES[id] ? id : 'sedan';
	}
}
