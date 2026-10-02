// Owns all NPC humans: pooling, population management driven by district schedules, distance
// LOD tiers with staggered "think" ticks, movement + collision, vehicle hits, explosion damage,
// drivers inside vehicles, and event-driven reactions (gunshots, crimes) via spatial queries.

import { SpatialHash } from '../core/SpatialHash';
import { clamp, dampAngle, headingTo } from '../core/math';
import { SIM } from '../data/config';
import { DISTRICTS } from '../data/districts';
import { FACTION_STYLES, HAIR_COLORS, PANTS, SHIRTS, SKIN_TONES } from '../data/peds';
import { Actor, type ActorRole, type Faction, type ThreatKind } from './Actor';
import { CivilianBrain, cornerOf } from './ai/CivilianBrain';
import { CombatBrain } from './ai/CombatBrain';
import { armActor } from './ai/tactics';
import type { WeaponId } from '../data/weapons';
import { TrafficDriver } from './ai/TrafficDriver';
import type { Cell } from '../world/CityLayout';
import type { Attacker, CrimeType } from './events';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

const THINK_INTERVAL = [0.1, 0.45, 1.2];

export class ActorSystem {
	readonly list: Actor[] = [];
	private pool: Actor[] = [];
	readonly hash = new SpatialHash<Actor>(12);
	private popTimer = 0;
	private tierTimer = 0;
	private stepIndex = 0;
	/** Multiplier from settings. */
	density = 1;

	constructor(private readonly world: World) {
		const bus = world.bus;
		bus.on('gunshot', (e) => this.broadcast('gunshot', e.x, e.z, e.radius, e.shooter === 'player' ? 'gunfire' : undefined));
		bus.on('crime', (e) => {
			if (e.perpetrator !== 'player') return;
			this.witnesses(e.type, e.x, e.z);
		});
		world.onExplosion = (x, y, z, r, src) => this.explosion(x, y, z, r, src);
		world.onVehicleDespawn = (v) => {
			const d = v.driver;
			if (d && d !== 'player') this.despawn(d);
			for (const p of v.passengers) this.despawn(p);
			v.passengers.length = 0;
		};
	}

	get count(): number {
		return this.list.length;
	}

	countRole(role: ActorRole): number {
		let n = 0;
		for (const a of this.list) if (a.role === role && !a.vehicle) n++;
		return n;
	}

	// ----------------------------------------------------------------- spawning

	spawn(role: ActorRole, faction: Faction, x: number, z: number, heading = 0): Actor | null {
		if (this.list.length >= SIM.maxActors) return null;
		const a = this.pool.pop() ?? new Actor();
		a.reset();
		a.active = true;
		a.role = role;
		a.faction = faction;
		a.x = a.tx = x;
		a.z = a.tz = z;
		a.heading = heading;
		this.dress(a);
		this.list.push(a);
		this.hash.insert(a);
		return a;
	}

	despawn(a: Actor): void {
		const i = this.list.indexOf(a);
		if (i < 0) return;
		this.list.splice(i, 1);
		const v = a.vehicle;
		if (v) {
			if (v.driver === a) {
				v.driver = null;
				v.brain?.dispose?.(v);
				v.brain = null;
			}
			const pi = v.passengers.indexOf(a);
			if (pi >= 0) v.passengers.splice(pi, 1);
		}
		a.reset();
		this.pool.push(a);
	}

	/** Removes every actor (new game / load). */
	clear(): void {
		for (const a of [...this.list]) this.despawn(a);
		this.hash.clear();
	}

	private dress(a: Actor): void {
		const r = this.world.rng;
		const style = FACTION_STYLES[a.faction];
		a.skin = r.pick(SKIN_TONES);
		a.hair = r.pick(HAIR_COLORS);
		if (a.faction === 'civilian') {
			a.shirt = r.pick(SHIRTS);
			a.pants = r.pick(PANTS);
			a.sleeves = r.chance(0.6);
			a.scale = r.range(0.92, 1.08);
		} else {
			a.shirt = r.pick(style.shirt);
			a.pants = r.pick(style.pants);
			a.hat = style.hat;
			a.sleeves = true;
			a.scale = r.range(0.98, 1.08);
		}
	}

	spawnCivilian(x: number, z: number, cell: Cell | null = null, corner = 0): Actor | null {
		const a = this.spawn('civilian', 'civilian', x, z, this.world.rng.range(-Math.PI, Math.PI));
		if (!a) return null;
		a.cell = cell;
		a.corner = corner;
		a.dir = this.world.rng.chance(0.5) ? 1 : -1;
		a.brain = new CivilianBrain(a, this.world);
		return a;
	}

	/** Creates a (hidden) driver for a vehicle. */
	spawnDriver(v: Vehicle, role: ActorRole = 'civilian', faction: Faction = 'civilian'): Actor | null {
		const a = this.spawn(role, faction, v.x, v.z, v.heading);
		if (!a) return null;
		a.vehicle = v;
		v.driver = a;
		if (role === 'civilian' || role === 'mission') a.brain = new CivilianBrain(a, this.world);
		return a;
	}

	/** Spawns an armed gang member / mission enemy with a combat brain. */
	spawnFighter(faction: Faction, x: number, z: number, weapon: WeaponId, opts: { hostile?: boolean; accuracy?: number; health?: number; heading?: number } = {}): Actor | null {
		const a = this.spawn('gang', faction, x, z, opts.heading ?? 0);
		if (!a) return null;
		armActor(a, weapon, opts.accuracy ?? 0.45);
		a.hostile = opts.hostile ?? false;
		if (opts.health) a.health = a.maxHealth = opts.health;
		a.brain = new CombatBrain(a, this.world);
		return a;
	}

	/** Alerts every fighter of the same faction near `a` (group provocation). */
	provokeGroup(a: Actor): void {
		if (a.faction === 'civilian' || a.faction === 'police') return;
		this.hash.query(a.x, a.z, 40, (o) => {
			if (o.alive && o.faction === a.faction && o.brain instanceof CombatBrain) {
				o.hostile = true;
				o.brain.provoke();
			}
		});
		if (a.brain instanceof CombatBrain) {
			a.hostile = true;
			a.brain.provoke();
		}
	}

	/** An on-foot NPC takes a parked vehicle and drives off into traffic. */
	boardVehicle(a: Actor, v: Vehicle): void {
		const w = this.world;
		if (v.driver || v.destroyed) return;
		a.vehicle = v;
		v.driver = a;
		v.role = 'traffic';
		const lane = w.roads.nearestLane(v.x, v.z, v.forwardX, v.forwardZ) ?? w.roads.nearestLane(v.x, v.z);
		if (lane) v.brain = new TrafficDriver(w, lane.lane, w.rng.range(10, 14));
	}

	unboardPassenger(a: Actor): void {
		const v = a.vehicle;
		if (!v) return;
		const i = v.passengers.indexOf(a);
		if (i >= 0) v.passengers.splice(i, 1);
		a.vehicle = null;
		const door = v.doorPoint(1);
		const p = { x: door.x, z: door.z };
		this.world.collision.resolveCircle(p, a.radius, 0, 1.8);
		a.x = a.tx = p.x;
		a.z = a.tz = p.z;
	}

	/** Pulls the NPC driver out (carjack, crash, fire). */
	ejectDriver(v: Vehicle, carjacked: boolean): void {
		const d = v.driver;
		v.brain?.dispose?.(v);
		v.brain = null;
		if (!d || d === 'player') return;
		v.driver = null;
		d.vehicle = null;
		const door = v.doorPoint(-1);
		const p = { x: door.x, z: door.z };
		this.world.collision.resolveCircle(p, d.radius, 0, 1.8);
		d.x = d.tx = p.x;
		d.z = d.tz = p.z;
		d.heading = v.heading;
		if (carjacked) {
			d.knockdown = 1.2;
			d.vx = -v.forwardZ * 2;
			d.vz = v.forwardX * 2;
		}
		if (d.brain instanceof CivilianBrain) {
			const w = this.world;
			d.brain.react(d, w, carjacked ? 'attacked' : 'carDanger', w.player.x, w.player.z, carjacked ? 'carjack' : undefined);
		}
	}

	// ------------------------------------------------------------------- damage

	damage(a: Actor, amount: number, attacker: Attacker, weapon = 'melee'): void {
		if (!a.alive || amount <= 0) return;
		const w = this.world;
		const absorbed = Math.min(a.armor, amount * 0.6);
		a.armor -= absorbed;
		a.health -= amount - absorbed;
		if (attacker) a.lastDamagedBy = attacker;
		w.bus.emit('actorDamaged', { actor: a, amount, attacker });
		if (a.health <= 0) {
			this.kill(a, attacker, weapon);
			return;
		}
		if (attacker === 'player') {
			const type: CrimeType = a.role === 'police' ? 'assaultPolice' : weapon === 'melee' ? 'assault' : 'shootCivilian';
			w.bus.emit('crime', { type, x: a.x, z: a.z, perpetrator: 'player', victim: a });
		}
		if (attacker === 'player' && a.brain instanceof CombatBrain) this.provokeGroup(a);
		if (a.brain?.react) {
			const ax = attacker === 'player' ? w.player.px : attacker ? attacker.x : a.x;
			const az = attacker === 'player' ? w.player.pz : attacker ? attacker.z : a.z;
			a.brain.react(a, w, 'attacked', ax, az, weapon === 'melee' ? 'assault' : 'shootCivilian');
		}
	}

	kill(a: Actor, killer: Attacker, weapon: string): void {
		if (a.dead) return;
		const w = this.world;
		a.dead = true;
		a.health = 0;
		a.deadTime = 0;
		a.desiredSpeed = 0;
		a.phone = a.handsUp = a.crouch = 0;
		a.aiming = false;
		a.talking = false;
		if (a.vehicle && a.vehicle.driver === a) {
			const v = a.vehicle;
			v.brain?.dispose?.(v);
			v.brain = null;
			v.driver = null;
			a.vehicle = null;
			a.hidden = true;
		}
		w.bus.emit('actorKilled', { actor: a, killer, weapon });
		if (killer === 'player' && a.brain instanceof CombatBrain) this.provokeGroup(a);
		if (killer === 'player') {
			w.bus.emit('crime', { type: a.role === 'police' ? 'killPolice' : 'murder', x: a.x, z: a.z, perpetrator: 'player', victim: a });
		}
	}

	private explosion(x: number, _y: number, z: number, radius: number, src: Attacker): void {
		this.hash.query(x, z, radius * 1.2, (a, d2) => {
			if (!a.alive || a.vehicle || a.hidden) return;
			const d = Math.sqrt(d2);
			const f = Math.max(0, 1 - d / (radius * 1.2));
			this.damage(a, 160 * f * f + 20 * f, src, 'explosion');
			if (a.alive) {
				a.knockdown = 1.5 + f;
				const nx = d > 0.1 ? (a.x - x) / d : 0;
				const nz = d > 0.1 ? (a.z - z) / d : 1;
				a.vx = nx * 8 * f;
				a.vz = nz * 8 * f;
			}
		});
		this.broadcast('explosion', x, z, 60, 'explosion');
	}

	// ----------------------------------------------------------------- reactions

	/** Notifies civilians within radius (event-driven, no polling). */
	broadcast(kind: ThreatKind, x: number, z: number, radius: number, crime?: CrimeType): void {
		const w = this.world;
		this.hash.query(x, z, radius, (a) => {
			if (!a.alive) return;
			if (a.vehicle) {
				// Drivers floor it.
				if (a.vehicle.brain instanceof TrafficDriver && (kind === 'gunshot' || kind === 'explosion')) a.vehicle.brain.panic = 10;
				return;
			}
			if (a.brain?.react) a.brain.react(a, w, kind, x, z, crime);
			else if (a.brain instanceof CombatBrain && crime === 'gunfire' && (a.x - x) ** 2 + (a.z - z) ** 2 < 25 * 25) this.provokeGroup(a);
		});
	}

	/** Civilians with line of sight to a crime may flee and phone it in. */
	private witnesses(type: CrimeType, x: number, z: number): void {
		const w = this.world;
		let checked = 0;
		this.hash.query(x, z, 38, (a) => {
			if (checked > 12 || !a.alive || !a.onFoot || a.role !== 'civilian') return;
			if (!(a.brain instanceof CivilianBrain)) return;
			checked++;
			if (!w.collision.lineOfSight(a.x, 1.6, a.z, x, 1.2, z)) return;
			a.brain.react(a, w, 'crime', x, z, type);
		});
	}

	/** An NPC sees the player aiming at them: civilians panic, fighters take it as a threat. */
	aimedAt(a: Actor): void {
		if (a.brain?.react) a.brain.react(a, this.world, 'aimedAt', this.world.player.x, this.world.player.z);
		else if (a.brain instanceof CombatBrain && a.faction !== 'crew') this.provokeGroup(a);
	}

	// --------------------------------------------------------------------- step

	step(dt: number): void {
		const w = this.world;
		this.stepIndex++;
		this.tierTimer -= dt;
		if (this.tierTimer <= 0) {
			this.tierTimer = 0.25;
			this.updateTiers();
		}
		this.popTimer -= dt;
		if (this.popTimer <= 0) {
			this.popTimer = 0.5;
			this.managePopulation();
		}

		for (let i = 0; i < this.list.length; i++) {
			const a = this.list[i];
			if (a.dead) {
				a.deadTime += dt;
				a.vx *= Math.exp(-6 * dt);
				a.vz *= Math.exp(-6 * dt);
				a.x += a.vx * dt;
				a.z += a.vz * dt;
				continue;
			}
			if (a.vehicle) {
				a.x = a.vehicle.x;
				a.z = a.vehicle.z;
				// Passengers riding with the player get out when the player does.
				const v = a.vehicle;
				if (v.driver !== a && v.passengers.includes(a) && !(w.player.state === 'driving' && w.player.vehicle === v) && !(v.driver && v.driver !== 'player')) {
					this.unboardPassenger(a);
					continue;
				}
				// Drivers bail out of burning or sinking vehicles.
				if ((a.vehicle.burning || a.vehicle.sinking) && a.vehicle.driver === a) this.ejectDriver(a.vehicle, false);
				else if (a.vehicle.destroyed && a.vehicle.driver === a) this.kill(a, a.vehicle.lastDamagedBy, 'explosion');
				continue;
			}
			// Brain think at a tier-dependent rate (staggered by id).
			if (a.brain && !a.hidden) {
				a.thinkAccum += dt;
				a.thinkTimer -= dt;
				if (a.thinkTimer <= 0 && a.knockdown <= 0) {
					a.thinkTimer = THINK_INTERVAL[a.tier] * (0.85 + ((a.id * 37) % 30) / 100);
					a.brain.think(a, w, a.thinkAccum);
					a.thinkAccum = 0;
				}
			} else if (a.brain && a.hidden) {
				a.thinkAccum += dt;
				a.thinkTimer -= dt;
				if (a.thinkTimer <= 0) {
					a.thinkTimer = 0.5;
					a.brain.think(a, w, a.thinkAccum);
					a.thinkAccum = 0;
				}
				continue;
			}
			this.move(a, dt);
		}

		this.hash.clear();
		for (const a of this.list) if (a.onFoot) this.hash.insert(a);
		this.separate();
		this.vehicleHits();
	}

	private move(a: Actor, dt: number): void {
		const w = this.world;
		a.stateTime += dt;
		a.punch = Math.max(0, a.punch - dt * 3);
		if (a.knockdown > 0) {
			a.knockdown -= dt;
			a.vx *= Math.exp(-3 * dt);
			a.vz *= Math.exp(-3 * dt);
			a.x += a.vx * dt;
			a.z += a.vz * dt;
			a.speed = 0;
			return;
		}
		const dx = a.tx - a.x;
		const dz = a.tz - a.z;
		const dist = Math.hypot(dx, dz);
		let tvx = 0;
		let tvz = 0;
		if (a.desiredSpeed > 0 && dist > a.arriveRadius * 0.5) {
			const sp = Math.min(a.desiredSpeed, dist * 2.5);
			tvx = (dx / dist) * sp;
			tvz = (dz / dist) * sp;
		}
		const acc = 9 * dt;
		a.vx += clamp(tvx - a.vx, -acc, acc);
		a.vz += clamp(tvz - a.vz, -acc, acc);
		const px = a.x;
		const pz = a.z;
		a.x += a.vx * dt;
		a.z += a.vz * dt;
		a.speed = Math.hypot(a.vx, a.vz);
		if (a.speed > 0.25) a.heading = dampAngle(a.heading, headingTo(a.vx, a.vz), 10, dt);
		else if (a.faceHeading !== null) a.heading = dampAngle(a.heading, a.faceHeading, 6, dt);
		a.animPhase += a.speed * dt * 2.3;

		// Collision: every step when near, staggered when mid-range, none when far.
		if (a.tier === 0 || (a.tier === 1 && (this.stepIndex + a.id) % 4 === 0)) {
			w.collision.resolveCircle(a, a.radius, 0, 1.8, 1);
		}
		if (!w.city.isLand(a.x, a.z)) {
			a.x = px;
			a.z = pz;
			a.vx = a.vz = 0;
		}
	}

	/** Light-weight personal space for nearby actors. */
	private separate(): void {
		for (const a of this.list) {
			if (a.tier !== 0 || !a.onFoot || a.dead) continue;
			this.hash.query(a.x, a.z, 0.75, (b, d2) => {
				if (b === a || b.dead || d2 < 1e-6) return;
				const d = Math.sqrt(d2);
				const push = (0.72 - d) * 0.5;
				if (push <= 0) return;
				const nx = (a.x - b.x) / d;
				const nz = (a.z - b.z) / d;
				a.x += nx * push;
				a.z += nz * push;
				b.x -= nx * push;
				b.z -= nz * push;
			});
		}
	}

	/** Vehicles knock down / run over pedestrians in their path. */
	private vehicleHits(): void {
		const w = this.world;
		for (const v of w.vehicles.list) {
			const sp = v.speed;
			if (sp < 2.5 || v.sinking) continue;
			const fx = v.forwardX;
			const fz = v.forwardZ;
			this.hash.query(v.x, v.z, v.halfLength + 1.5, (a) => {
				if (a.dead || a.knockdown > 0 || !a.onFoot) return;
				const dx = a.x - v.x;
				const dz = a.z - v.z;
				const lx = dx * -fz + dz * fx;
				const lz = dx * fx + dz * fz;
				const ox = lx - clamp(lx, -v.halfWidth, v.halfWidth);
				const oz = lz - clamp(lz, -v.halfLength, v.halfLength);
				if (ox * ox + oz * oz > a.radius * a.radius) {
					// Not touching yet: pedestrians in front of fast cars try to dodge.
					if (lz > 0 && lz < v.halfLength + 8 && Math.abs(lx) < v.halfWidth + 1 && sp > 6 && a.brain instanceof CivilianBrain) {
						a.brain.react(a, w, 'carDanger', v.x, v.z);
					}
					return;
				}
				if (sp < 4) {
					// Gentle push.
					a.x += (lx >= 0 ? 1 : -1) * -fz * 0.2;
					a.z += (lx >= 0 ? 1 : -1) * fx * 0.2;
					return;
				}
				const dmg = sp * sp * 0.45;
				a.knockdown = 2.5;
				a.vx = v.vx * 0.8 + (lx >= 0 ? -fz : fz) * 2;
				a.vz = v.vz * 0.8 + (lx >= 0 ? fx : -fx) * 2;
				const by = v.driver === 'player' ? 'player' : null;
				if (by === 'player') w.bus.emit('crime', { type: 'hitPedestrian', x: a.x, z: a.z, perpetrator: 'player', victim: a });
				this.damage(a, dmg, by, 'vehicle');
				w.bus.emit('sound', { id: 'thud', x: a.x, z: a.z, volume: Math.min(1, sp / 15) });
				// Slow the car a little.
				v.vx *= 0.94;
				v.vz *= 0.94;
			});
		}
	}

	private updateTiers(): void {
		const p = this.world.player;
		const px = p.px;
		const pz = p.pz;
		for (const a of this.list) {
			const d = Math.hypot(a.x - px, a.z - pz);
			a.distToPlayer = d;
			a.tier = d < SIM.actorFullRadius ? 0 : d < SIM.actorMidRadius ? 1 : 2;
		}
	}

	/** Desired civilian population around the player for the current district and hour. */
	targetPopulation(): number {
		const w = this.world;
		const d = DISTRICTS[w.city.districtAt(w.player.px, w.player.pz)];
		const hourly = d.schedule[w.clock.hourInt];
		const rain = 1 - w.wetness * 0.55;
		return Math.round(75 * this.density * d.pedDensity * hourly * rain);
	}

	private managePopulation(): void {
		const w = this.world;
		const p = w.player;
		// Despawn far / stale actors.
		for (let i = this.list.length - 1; i >= 0; i--) {
			const a = this.list[i];
			if (a.persistent || a.vehicle) continue;
			const far = a.distToPlayer > SIM.actorDespawnRadius;
			const stale = a.dead && a.deadTime > 45 && a.distToPlayer > 35;
			if (far || stale) this.despawn(a);
		}
		const target = this.targetPopulation();
		let civilians = 0;
		for (const a of this.list) if (a.role === 'civilian' && !a.vehicle && !a.dead) civilians++;
		// Catch up quickly after teleports / new games, then trickle.
		let budget = civilians < target * 0.5 ? 16 : 5;
		for (let tries = 0; tries < budget * 3 && civilians < target && budget > 0; tries++) {
			const ang = w.rng.range(0, Math.PI * 2);
			const r = w.rng.range(SIM.pedSpawnMin, SIM.pedSpawnMax);
			const cell = w.city.cellAt(p.px + Math.cos(ang) * r, p.pz + Math.sin(ang) * r);
			if (!cell || cell.kind === 'airport') continue;
			const k = w.rng.int(0, 3);
			const c0 = cornerOf(cell, k);
			const c1 = cornerOf(cell, k + 1);
			const t = w.rng.next();
			const x = c0.x + (c1.x - c0.x) * t;
			const z = c0.z + (c1.z - c0.z) * t;
			// Do not pop in right in front of the camera.
			if ((x - w.view.x) * w.view.dirX + (z - w.view.z) * w.view.dirZ > 0 && Math.hypot(x - w.view.x, z - w.view.z) < 80) continue;
			const a = this.spawnCivilian(x, z, cell, (k + 1) & 3);
			if (!a) break;
			civilians++;
			budget--;
		}
	}
}
