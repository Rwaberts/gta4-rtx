// Police dispatch and unit AI.
//
// Unit state machine (one per car + crew):
//   patrol --(wanted)--> respond --(sees player)--> pursue --(player on foot / stopped)--> dismounted
//      ^                     |  ^                     |                                    |
//      |                     v  |                     v (lost LOS)                         v (player drives off)
//   standDown <--(cleared)-- search <------------- respond <------------------ officers return to car
//   roadblock: stationary cars across the road with guarding officers (levels 4-5).
//
// Officers on foot run their own FSM (PoliceOfficerBrain). A helicopter joins at level 5.

import { StateMachine, type StateTable } from '../core/StateMachine';
import { headingTo } from '../core/math';
import { DISTRICTS } from '../data/districts';
import { FOOT_PATROLS, PATROL_CARS, WANTED_LEVELS } from '../data/wanted';
import type { Lane } from '../world/RoadNetwork';
import type { Actor } from './Actor';
import { PoliceCarBrain } from './ai/PoliceCarBrain';
import { PoliceOfficerBrain, type OfficerUnit } from './ai/PoliceOfficerBrain';
import { armActor, playerTarget } from './ai/tactics';
import type { CrimeType } from './events';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

export type UnitState = 'patrol' | 'respond' | 'pursue' | 'dismounted' | 'search' | 'standDown' | 'roadblock';

interface UnitCtx {
	u: PoliceUnit;
	w: World;
	sys: PoliceSystem;
}

let unitIds = 1;

export class PoliceUnit implements OfficerUnit {
	readonly id = unitIds++;
	officers: Actor[] = [];
	seesPlayer = false;
	lostTime = 0;
	timer = 0;
	investigate: { x: number; z: number; t: number } | null = null;
	fsm!: StateMachine<UnitCtx, UnitState>;
	removed = false;

	constructor(
		readonly sys: PoliceSystem,
		public vehicle: Vehicle | null,
		public brain: PoliceCarBrain | null,
		readonly heavy: boolean,
	) {}

	get state(): UnitState {
		return this.fsm.current;
	}

	car(): Vehicle | null {
		const v = this.vehicle;
		if (!v || v.destroyed || v.sinking || v.driver === 'player' || v.brain !== this.brain) return null;
		return v;
	}

	board(a: Actor): void {
		this.sys.board(this, a);
	}

	get aliveOfficers(): Actor[] {
		return this.officers.filter((o) => o.alive);
	}

	get crewInside(): boolean {
		const v = this.vehicle;
		return this.aliveOfficers.length > 0 && this.aliveOfficers.every((o) => o.vehicle === v);
	}

	get x(): number {
		return this.car()?.x ?? this.aliveOfficers[0]?.x ?? 0;
	}

	get z(): number {
		return this.car()?.z ?? this.aliveOfficers[0]?.z ?? 0;
	}
}

const UNIT_TABLE: StateTable<UnitCtx, UnitState> = {
	patrol: {
		enter: ({ u }) => {
			const v = u.car();
			if (v && u.brain) u.brain.setMode('patrol', v);
		},
		update: ({ u, w }, dt) => {
			if (w.wanted.level > 0) return 'respond';
			const v = u.car();
			if (!v || !u.brain) return 'dismounted';
			if (u.investigate) {
				u.investigate.t -= dt;
				u.brain.setMode('respond', v);
				u.brain.goTo(u.investigate.x, u.investigate.z);
				if (u.investigate.t <= 0 || Math.hypot(v.x - u.investigate.x, v.z - u.investigate.z) < 25) {
					u.investigate = null;
					u.brain.setMode('patrol', v);
				}
			}
		},
	},
	respond: {
		enter: ({ u, w }) => {
			const v = u.car();
			if (v && u.brain) {
				u.brain.setMode('respond', v);
				u.brain.goTo(w.wanted.lkpX, w.wanted.lkpZ);
			}
		},
		update: ({ u, w }) => {
			const wd = w.wanted;
			if (wd.level === 0) return 'standDown';
			const v = u.car();
			if (!v || !u.brain || !u.crewInside) return 'dismounted';
			u.brain.goTo(wd.lkpX, wd.lkpZ);
			const dPlayer = Math.hypot(w.player.px - v.x, w.player.pz - v.z);
			if (u.seesPlayer && dPlayer < 110) return 'pursue';
			if (Math.hypot(wd.lkpX - v.x, wd.lkpZ - v.z) < 30 && !wd.seen) return 'search';
		},
	},
	pursue: {
		enter: ({ u, w }) => {
			const v = u.car();
			if (v && u.brain) {
				u.brain.setMode('pursue', v);
				u.brain.ram = WANTED_LEVELS[w.wanted.level].ram;
			}
			u.lostTime = 0;
		},
		update: ({ u, w }, dt) => {
			const wd = w.wanted;
			if (wd.level === 0) return 'standDown';
			const v = u.car();
			if (!v || !u.brain || !u.crewInside) return 'dismounted';
			u.brain.ram = WANTED_LEVELS[wd.level].ram;
			const p = w.player;
			const d = Math.hypot(p.px - v.x, p.pz - v.z);
			if (p.state === 'onFoot' && d < 28) return 'dismounted';
			if (p.state === 'driving' && p.vehicle && p.vehicle.speed < 1 && d < 16 && !wd.lethal()) return 'dismounted';
			if (!u.seesPlayer) {
				u.lostTime += dt;
				if (u.lostTime > 4) return 'respond';
			} else u.lostTime = 0;
		},
	},
	dismounted: {
		enter: ({ u, sys }) => {
			sys.dismount(u);
			u.timer = 0;
		},
		update: ({ u, w }) => {
			const wd = w.wanted;
			if (wd.level === 0) return 'standDown';
			const alive = u.aliveOfficers;
			if (!alive.length) return;
			const v = u.car();
			if (!v) return;
			const p = w.player;
			const dCar = Math.hypot(p.px - v.x, p.pz - v.z);
			// Player drives away: everybody back in the car.
			if (p.state === 'driving' && dCar > 35) {
				for (const o of alive) {
					const b = o.brain as PoliceOfficerBrain;
					if (!o.vehicle && b.state !== 'returnToCar') b.order('returnToCar');
				}
			}
			if (u.crewInside) return wd.seen ? 'pursue' : 'respond';
		},
	},
	search: {
		enter: ({ u }) => {
			const v = u.car();
			if (v && u.brain) u.brain.setMode('search', v);
			u.timer = 0;
		},
		update: ({ u, w }, dt) => {
			const wd = w.wanted;
			if (wd.level === 0) return 'standDown';
			const v = u.car();
			if (!v || !u.brain || !u.crewInside) return 'dismounted';
			if (u.seesPlayer) return 'pursue';
			u.timer -= dt;
			if (u.timer <= 0 || u.brain.arrived) {
				u.timer = 15;
				const r = wd.def.searchRadius;
				const ang = w.rng.range(0, Math.PI * 2);
				u.brain.goTo(wd.lkpX + Math.cos(ang) * r * w.rng.next(), wd.lkpZ + Math.sin(ang) * r * w.rng.next());
			}
		},
	},
	standDown: {
		enter: ({ u }) => {
			for (const o of u.aliveOfficers) if (!o.vehicle) (o.brain as PoliceOfficerBrain).order('returnToCar');
		},
		update: ({ u, w }) => {
			if (w.wanted.level > 0) return u.crewInside ? 'respond' : 'dismounted';
			const v = u.car();
			if (!v) return;
			if (u.crewInside) {
				if (u.brain) u.brain.driverless = false;
				return 'patrol';
			}
		},
	},
	roadblock: {
		enter: ({ u }) => {
			const v = u.vehicle;
			if (v && u.brain) {
				u.brain.setMode('hold', v);
				v.sirenOn = true;
			}
		},
		update: ({ u, w }) => {
			if (w.wanted.level === 0) {
				// Clear up: crew gets back in and drives off.
				for (const o of u.aliveOfficers) if (!o.vehicle && (o.brain as PoliceOfficerBrain).state !== 'returnToCar') (o.brain as PoliceOfficerBrain).order('returnToCar');
				if (u.crewInside) {
					if (u.brain) u.brain.driverless = false;
					return 'patrol';
				}
			}
		},
	},
};

export interface PoliceHeli {
	active: boolean;
	x: number;
	y: number;
	z: number;
	heading: number;
	orbit: number;
	sees: boolean;
	leaving: boolean;
}

export class PoliceSystem {
	readonly units: PoliceUnit[] = [];
	readonly footPatrols: Actor[] = [];
	readonly heli: PoliceHeli = { active: false, x: 0, y: 60, z: 0, heading: 0, orbit: 0, sees: false, leaving: false };
	private perceptionTimer = 0;
	private manageTimer = 0;
	private unitTimer = 0;
	private spawnCooldown = 0;
	private roadblockCooldown = 0;
	private seenFlag = false;
	enabled = true;

	constructor(private readonly world: World) {
		const bus = world.bus;
		bus.on('crime', (e) => {
			if (e.perpetrator === 'player') this.witness(e.type, e.x, e.z);
		});
		bus.on('gunshot', (e) => {
			if (e.shooter !== 'player' || world.wanted.level > 0) return;
			// Patrols within earshot go and take a look.
			for (const u of this.units) {
				if (u.state === 'patrol' && Math.hypot(u.x - e.x, u.z - e.z) < e.radius * 2.5) u.investigate = { x: e.x, z: e.z, t: 40 };
			}
		});
		bus.on('wantedChanged', (e) => {
			if (e.level > e.previous) this.spawnCooldown = Math.min(this.spawnCooldown, WANTED_LEVELS[e.level].responseDelay);
		});
	}

	/** Forgets all units (their vehicles/officers are cleared by the caller). */
	reset(): void {
		this.units.length = 0;
		this.footPatrols.length = 0;
		this.heli.active = false;
		this.heli.leaving = false;
		this.seenFlag = false;
		this.spawnCooldown = 0;
	}

	get activeUnits(): number {
		return this.units.filter((u) => !u.removed && u.state !== 'patrol' && u.state !== 'standDown').length;
	}

	step(dt: number): void {
		const w = this.world;
		this.spawnCooldown -= dt;
		this.roadblockCooldown -= dt;
		this.perceptionTimer -= dt;
		if (this.perceptionTimer <= 0) {
			this.perceptionTimer = 0.2;
			this.seenFlag = this.perceive();
		}
		w.wanted.update(dt, this.seenFlag);
		this.updateHeli(dt);
		this.unitTimer -= dt;
		if (this.unitTimer <= 0) {
			const udt = 0.2 - this.unitTimer;
			this.unitTimer = 0.2;
			for (const u of this.units) if (!u.removed) u.fsm.update(udt, w.time);
		}
		this.manageTimer -= dt;
		if (this.manageTimer <= 0) {
			this.manageTimer = 0.5;
			this.manage();
		}
	}

	// ---------------------------------------------------------------- perception

	/** Rate-limited line-of-sight checks from units, foot officers and the helicopter. */
	private perceive(): boolean {
		const w = this.world;
		const p = w.player;
		if (!p.alive) return false;
		let seen = false;
		let budget = 12;
		for (const u of this.units) {
			u.seesPlayer = false;
			if (u.removed) continue;
			for (const o of u.aliveOfficers) {
				if (o.vehicle) continue;
				if (budget-- <= 0) break;
				if ((o.brain as PoliceOfficerBrain).look(o, w, 85)) {
					u.seesPlayer = true;
					seen = true;
				}
			}
			const v = u.car();
			if (v && u.crewInside && budget-- > 0) {
				const t = playerTarget(w);
				if (Math.hypot(t.x - v.x, t.z - v.z) < 110 && w.collision.lineOfSight(v.x, 1.5, v.z, t.x, t.y + 0.2, t.z)) {
					u.seesPlayer = true;
					seen = true;
				}
			}
		}
		for (const o of this.footPatrols) {
			if (!o.alive || budget-- <= 0) continue;
			if ((o.brain as PoliceOfficerBrain).look(o, w, 70)) seen = true;
		}
		if (this.heli.active && !this.heli.leaving) {
			const h = this.heli;
			const t = playerTarget(w);
			h.sees = Math.hypot(t.x - h.x, t.z - h.z) < 150 && w.collision.lineOfSight(h.x, h.y, h.z, t.x, t.y + 0.5, t.z);
			if (h.sees) seen = true;
		}
		return seen && w.wanted.level > 0;
	}

	/** Officers who can see a crime report it immediately (and become active). */
	private witness(type: CrimeType, x: number, z: number): void {
		const w = this.world;
		const eyes: Array<{ x: number; z: number; y: number }> = [];
		for (const u of this.units) {
			if (u.removed) continue;
			for (const o of u.aliveOfficers) eyes.push({ x: o.x, z: o.z, y: 1.6 });
		}
		for (const o of this.footPatrols) if (o.alive) eyes.push({ x: o.x, z: o.z, y: 1.6 });
		for (const e of eyes) {
			if (Math.hypot(e.x - x, e.z - z) > 55) continue;
			if (!w.collision.lineOfSight(e.x, e.y, e.z, x, 1.2, z)) continue;
			w.wanted.report(type, x, z, 'police');
			w.wanted.radio('spotted', true);
			return;
		}
	}

	// ------------------------------------------------------------------ spawning

	private manage(): void {
		const w = this.world;
		if (!this.enabled) return;
		const p = w.player;
		// Remove dissolved units and far-away idle ones.
		for (const u of this.units) {
			if (u.removed) continue;
			const alive = u.aliveOfficers.length;
			const d = Math.hypot(u.x - p.px, u.z - p.pz);
			const idle = u.state === 'patrol' || u.state === 'standDown';
			if (alive === 0 || (idle && d > 340) || d > 520) this.removeUnit(u, alive === 0);
		}
		this.units.splice(0, this.units.length, ...this.units.filter((u) => !u.removed));
		for (let i = this.footPatrols.length - 1; i >= 0; i--) {
			const o = this.footPatrols[i];
			if (!o.active || o.distToPlayer > 260 || (o.dead && o.deadTime > 30)) {
				if (o.active && !o.dead) w.actors.despawn(o);
				else o.persistent = false;
				this.footPatrols.splice(i, 1);
			}
		}

		const level = w.wanted.level;
		const def = WANTED_LEVELS[level];
		if (level === 0) {
			const patrols = this.units.filter((u) => u.state === 'patrol').length;
			if (patrols < PATROL_CARS && this.spawnCooldown <= 0) {
				this.spawnUnit('patrol', false, 1);
				this.spawnCooldown = 6;
			}
			const district = w.city.districtAt(p.px, p.pz);
			const busy = district === 'downtown' || district === 'financial' || district === 'beachfront';
			if (busy && this.footPatrols.length < FOOT_PATROLS && w.rng.chance(0.3)) this.spawnFootPatrol();
			if (this.heli.active) this.heli.leaving = true;
			return;
		}
		// Wanted: keep the response at strength.
		const responding = this.units.filter((u) => !u.heavy && u.state !== 'roadblock').length;
		const heavy = this.units.filter((u) => u.heavy).length;
		if (this.spawnCooldown <= 0) {
			if (responding < def.units) {
				this.spawnUnit('respond', false, def.officersPerCar);
				this.spawnCooldown = 1.4;
			} else if (heavy < def.heavy) {
				this.spawnUnit('respond', true, 3);
				this.spawnCooldown = 2;
			}
		}
		const roadblocks = this.units.filter((u) => u.state === 'roadblock').length;
		if (def.roadblocks > 0 && roadblocks < def.roadblocks * 2 && this.roadblockCooldown <= 0 && p.state === 'driving' && p.vehicle && p.vehicle.speed > 8) {
			if (this.placeRoadblock()) this.roadblockCooldown = 18;
			else this.roadblockCooldown = 3;
		}
		if (def.helicopter && !this.heli.active) this.spawnHeli();
		if (!def.helicopter && this.heli.active) this.heli.leaving = true;
	}

	private pickSpawnLane(minD: number, maxD: number): { lane: Lane; s: number } | null {
		const w = this.world;
		const p = w.player;
		const rand = () => w.rng.next();
		for (let tries = 0; tries < 40; tries++) {
			const spot = w.roads.randomLaneNear(p.px, p.pz, minD, maxD, rand);
			if (!spot) continue;
			const { lane, s, x, z } = spot;
			// Avoid spawning in plain sight.
			const v = w.view;
			const vd = Math.hypot(x - v.x, z - v.z);
			if (tries < 30 && vd < 200 && ((x - v.x) * v.dirX + (z - v.z) * v.dirZ) / vd > 0.4) continue;
			let clear = true;
			w.vehicles.hash.query(x, z, 10, () => {
				clear = false;
				return true;
			});
			if (!clear) continue;
			return { lane, s };
		}
		return null;
	}

	spawnUnit(state: UnitState, heavy: boolean, crew: number): PoliceUnit | null {
		const spot = this.pickSpawnLane(state === 'patrol' ? 120 : 140, state === 'patrol' ? 260 : 230);
		if (!spot) return null;
		const { lane, s } = spot;
		const x = lane.sx + lane.dx * s;
		const z = lane.sz + lane.dz * s;
		return this.createUnit(heavy ? 'swat' : 'police', x, z, Math.atan2(lane.dx, lane.dz), state, heavy, crew, true);
	}

	createUnit(model: string, x: number, z: number, heading: number, state: UnitState, heavy: boolean, crew: number, moving: boolean): PoliceUnit | null {
		const w = this.world;
		const v = w.vehicles.spawn(model, x, z, heading, 'police');
		if (!v) return null;
		v.persistent = true;
		const brain = new PoliceCarBrain(w, v);
		v.brain = brain;
		const u = new PoliceUnit(this, v, brain, heavy);
		const def = WANTED_LEVELS[Math.max(1, w.wanted.level)];
		for (let i = 0; i < Math.max(1, crew); i++) {
			const a = w.actors.spawn('police', 'police', x, z, heading);
			if (!a) break;
			a.persistent = true;
			armActor(a, heavy ? 'rifle' : w.wanted.level >= 4 && i === 1 ? 'shotgun' : 'pistol', heavy ? def.accuracy + 0.08 : def.accuracy);
			if (heavy) {
				a.armor = 60;
				a.hat = 2;
				a.shirt = 0x202428;
			}
			a.health = a.maxHealth = 110;
			const b = new PoliceOfficerBrain(a, w, u, 'approach');
			b.seat = i === 0 ? -1 : 1;
			a.brain = b;
			a.vehicle = v;
			if (i === 0) v.driver = a;
			else v.passengers.push(a);
			u.officers.push(a);
		}
		if (!u.officers.length) {
			w.vehicles.despawn(v);
			return null;
		}
		if (moving) {
			v.vx = v.forwardX * 10;
			v.vz = v.forwardZ * 10;
		}
		u.fsm = new StateMachine(UNIT_TABLE, state, { u, w, sys: this });
		this.units.push(u);
		return u;
	}

	private spawnFootPatrol(): void {
		const w = this.world;
		const p = w.player;
		for (let tries = 0; tries < 8; tries++) {
			const ang = w.rng.range(0, Math.PI * 2);
			const r = w.rng.range(50, 130);
			const x = p.px + Math.cos(ang) * r;
			const z = p.pz + Math.sin(ang) * r;
			const cell = w.city.cellAt(x, z);
			if (!cell || cell.kind === 'field') continue;
			const sx = cell.lot.minX + 2;
			const sz = (cell.lot.minZ + cell.lot.maxZ) / 2;
			const a = w.actors.spawn('police', 'police', sx, sz, 0);
			if (!a) return;
			a.persistent = true;
			armActor(a, 'pistol', 0.45);
			a.health = a.maxHealth = 110;
			a.brain = new PoliceOfficerBrain(a, w, null, 'patrol');
			this.footPatrols.push(a);
			return;
		}
	}

	/** Two cars across the road ahead of the speeding player, with guards behind them. */
	private placeRoadblock(): boolean {
		const w = this.world;
		const pv = w.player.vehicle!;
		const start = w.roads.nearestLane(pv.x, pv.z, pv.forwardX, pv.forwardZ);
		if (!start || start.dist > 10) return false;
		// Walk forward along the most-straight lanes.
		let lane = start.lane;
		let travelled = lane.len - start.s;
		while (travelled < 130) {
			let next: Lane | null = null;
			for (const id of lane.next) {
				const l = w.roads.lanes[id];
				if (l.dx * lane.dx + l.dz * lane.dz > 0.99) next = l;
			}
			if (!next) next = w.roads.lanes[lane.next[0]];
			if (!next) return false;
			lane = next;
			travelled += lane.len + 16;
		}
		const s = lane.len * 0.5;
		const cx = lane.sx + lane.dx * s - -lane.dz * 3.4;
		const cz = lane.sz + lane.dz * s - lane.dx * 3.4;
		const view = w.view;
		const vd = Math.hypot(cx - view.x, cz - view.z);
		if (vd < 70) return false;
		const across = Math.atan2(-lane.dz, lane.dx);
		let placed = 0;
		for (const side of [-1, 1]) {
			const x = cx + -lane.dz * side * 3.2;
			const z = cz + lane.dx * side * 3.2;
			const u = this.createUnit('police', x, z, across, 'roadblock', false, 1, false);
			if (!u) continue;
			placed++;
			// Officer takes cover behind the car.
			for (const o of u.officers) {
				o.vehicle = null;
				// Behind the car as seen from the approaching player.
				const gx = x + lane.dx * 3.5;
				const gz = z + lane.dz * 3.5;
				o.x = o.tx = gx;
				o.z = o.tz = gz;
				const b = o.brain as PoliceOfficerBrain;
				b.homeX = gx;
				b.homeZ = gz;
				b.order('guard');
				o.heading = headingTo(-lane.dx, -lane.dz);
			}
			u.vehicle!.driver = null;
			u.vehicle!.passengers.length = 0;
			u.brain!.driverless = true;
		}
		if (placed) w.wanted.radio('roadblock', true);
		return placed > 0;
	}

	private spawnHeli(): void {
		const w = this.world;
		const h = this.heli;
		h.active = true;
		h.leaving = false;
		const ang = w.rng.range(0, Math.PI * 2);
		h.x = w.player.px + Math.cos(ang) * 320;
		h.z = w.player.pz + Math.sin(ang) * 320;
		h.y = 60;
		w.wanted.radio('heli', true);
	}

	private updateHeli(dt: number): void {
		const h = this.heli;
		if (!h.active) return;
		const w = this.world;
		const wd = w.wanted;
		let tx: number;
		let tz: number;
		if (h.leaving) {
			tx = h.x + Math.sin(h.heading) * 100;
			tz = h.z + Math.cos(h.heading) * 100;
			if (Math.hypot(h.x - w.player.px, h.z - w.player.pz) > 450) h.active = false;
		} else {
			h.orbit += dt * 0.35;
			const cx = wd.seen ? w.player.px : wd.lkpX;
			const cz = wd.seen ? w.player.pz : wd.lkpZ;
			tx = cx + Math.cos(h.orbit) * 35;
			tz = cz + Math.sin(h.orbit) * 35;
		}
		const dx = tx - h.x;
		const dz = tz - h.z;
		const d = Math.hypot(dx, dz);
		const sp = Math.min(26, d * 0.8);
		if (d > 0.1) {
			h.x += (dx / d) * sp * dt;
			h.z += (dz / d) * sp * dt;
			h.heading = Math.atan2(dx, dz);
		}
		// Sharpshooter at level 5.
		if (h.sees && wd.level >= 5 && w.rng.chance(dt * 0.5)) {
			const t = playerTarget(w);
			w.combat.fireFrom(h.x, h.y - 2, h.z, t.x, t.y, t.z, 'rifle', 0.55, t.speed, null);
		}
	}

	// ------------------------------------------------------------------ crew moves

	dismount(u: PoliceUnit): void {
		const w = this.world;
		const v = u.vehicle;
		if (u.brain) u.brain.driverless = true;
		for (const o of u.aliveOfficers) {
			if (!o.vehicle) continue;
			const b = o.brain as PoliceOfficerBrain;
			const door = v ? v.doorPoint(b.seat) : { x: o.x, z: o.z };
			const pos = { x: door.x, z: door.z };
			w.collision.resolveCircle(pos, o.radius, 0, 1.8);
			o.vehicle = null;
			o.x = o.tx = pos.x;
			o.z = o.tz = pos.z;
			b.order(w.wanted.level > 0 ? 'approach' : 'returnToCar');
		}
		if (v) {
			if (v.driver !== 'player') v.driver = null;
			v.passengers.length = 0;
		}
	}

	board(u: PoliceUnit, a: Actor): void {
		const v = u.car();
		if (!v || a.vehicle) return;
		a.vehicle = v;
		if (!v.driver) v.driver = a;
		else if (v.driver !== a) v.passengers.push(a);
		if (u.crewInside && u.brain) u.brain.driverless = false;
	}

	private removeUnit(u: PoliceUnit, keepCar: boolean): void {
		const w = this.world;
		u.removed = true;
		for (const o of u.officers) {
			if (o.active && !o.dead && o.vehicle === null) w.actors.despawn(o);
			else if (o.active && o.dead) o.persistent = false;
		}
		const v = u.vehicle;
		if (v && w.vehicles.list.includes(v) && v.driver !== 'player') {
			for (const o of u.officers) if (o.vehicle === v && o.active) w.actors.despawn(o);
			v.driver = null;
			v.passengers.length = 0;
			if (keepCar || v.destroyed) {
				v.brain = null;
				v.persistent = false;
				v.role = 'abandoned';
				v.sirenOn = false;
			} else w.vehicles.despawn(v);
		}
	}

	/** Debug / tests: police presence summary. */
	summary(): string {
		const states = this.units.map((u) => u.state[0]).join('');
		return `units ${this.units.length} [${states}] foot ${this.footPatrols.length} heli ${this.heli.active ? (this.heli.sees ? 'eyes-on' : 'search') : 'no'}`;
	}

	/** District label for UI. */
	place(x: number, z: number): string {
		return DISTRICTS[this.world.city.districtAt(x, z)].name;
	}
}

