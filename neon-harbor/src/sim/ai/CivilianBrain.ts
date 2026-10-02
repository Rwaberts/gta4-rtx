// Civilian behaviour as a finite state machine:
//   wander (sidewalk loops + signal-aware street crossing), idle, talk, shop,
//   flee, cower, callPolice, enterVehicle.
// Reactions to gunshots / crimes / explosions arrive as events through react().

import { StateMachine, type StateTable } from '../../core/StateMachine';
import { headingTo } from '../../core/math';
import { WORLD } from '../../data/config';
import { DISTRICTS } from '../../data/districts';
import type { Cell, Poi } from '../../world/CityLayout';
import type { Actor, ActorBrain, ThreatKind } from '../Actor';
import type { CrimeType } from '../events';
import type { Vehicle } from '../Vehicle';
import type { World } from '../World';

export type CivState = 'wander' | 'idle' | 'talk' | 'shop' | 'flee' | 'cower' | 'callPolice' | 'enterVehicle';
export type { ThreatKind } from '../Actor';

interface Ctx {
	a: Actor;
	w: World;
	b: CivilianBrain;
}

const SEVERE: CrimeType[] = ['murder', 'shootCivilian', 'killPolice', 'assaultPolice', 'gunfire', 'explosion', 'robbery'];
const SHOP_KINDS = new Set(['store', 'weapons', 'exchange', 'contact', 'dealership', 'property']);

/** Sidewalk corner k (0 NW, 1 NE, 2 SE, 3 SW) of a cell's lot. */
export function cornerOf(cell: Cell, k: number): { x: number; z: number } {
	const L = cell.lot;
	const m = cell.kind === 'field' ? 1.5 : 2;
	switch (k & 3) {
		case 0:
			return { x: L.minX + m, z: L.minZ + m };
		case 1:
			return { x: L.maxX - m, z: L.minZ + m };
		case 2:
			return { x: L.maxX - m, z: L.maxZ - m };
		default:
			return { x: L.minX + m, z: L.maxZ - m };
	}
}

interface Crossing {
	di: number;
	dj: number;
	corner: number;
	/** Road side of the current cell that is crossed. */
	side: 'n' | 's' | 'w' | 'e';
	/** Movement axis while crossing: 0 = along z, 1 = along x. */
	axis: 0 | 1;
	/** Node at this corner (for signals). */
	ni: number;
	nj: number;
}

// For each corner, the two straight-across crossings.
const CROSSINGS: Crossing[][] = [
	[
		{ di: 0, dj: -1, corner: 3, side: 'n', axis: 0, ni: 0, nj: 0 },
		{ di: -1, dj: 0, corner: 1, side: 'w', axis: 1, ni: 0, nj: 0 },
	],
	[
		{ di: 0, dj: -1, corner: 2, side: 'n', axis: 0, ni: 1, nj: 0 },
		{ di: 1, dj: 0, corner: 0, side: 'e', axis: 1, ni: 1, nj: 0 },
	],
	[
		{ di: 0, dj: 1, corner: 1, side: 's', axis: 0, ni: 1, nj: 1 },
		{ di: 1, dj: 0, corner: 3, side: 'e', axis: 1, ni: 1, nj: 1 },
	],
	[
		{ di: 0, dj: 1, corner: 0, side: 's', axis: 0, ni: 0, nj: 1 },
		{ di: -1, dj: 0, corner: 2, side: 'w', axis: 1, ni: 0, nj: 1 },
	],
];

const TABLE: StateTable<Ctx, CivState> = {
	wander: {
		enter: ({ a, w, b }) => {
			b.ensureCell(a, w);
			b.crossing = null;
			b.waiting = false;
			a.setTarget(...b.cornerXZ(a), b.walkSpeed);
		},
		update: ({ a, w, b }, dt) => {
			if (!a.cell) return;
			if (b.waiting && b.crossing) {
				// Wait for the pedestrian phase at signalled intersections.
				if (b.canCross(w, a.cell, b.crossing)) {
					b.waiting = false;
					const target = w.city.cellIJ(a.cell.i + b.crossing.di, a.cell.j + b.crossing.dj)!;
					const c = cornerOf(target, b.crossing.corner);
					a.setTarget(c.x, c.z, b.walkSpeed * 1.25);
				} else {
					a.stop();
				}
				return;
			}
			if (a.atTarget()) {
				if (b.crossing) {
					a.cell = w.city.cellIJ(a.cell.i + b.crossing.di, a.cell.j + b.crossing.dj) ?? a.cell;
					a.corner = b.crossing.corner;
					b.crossing = null;
				} else if (w.rng.chance(0.3)) {
					const opts = CROSSINGS[a.corner].filter((c) => a.cell!.roads[c.side] && w.city.cellIJ(a.cell!.i + c.di, a.cell!.j + c.dj) !== null);
					if (opts.length) {
						b.crossing = opts[Math.floor(w.rng.next() * opts.length)];
						b.waiting = true;
						return;
					}
				}
				a.corner = (a.corner + a.dir + 4) & 3;
				a.setTarget(...b.cornerXZ(a), b.walkSpeed);
			}
			// Spontaneous activities, weighted by district and time of day.
			if (b.crossing) return;
			const act = DISTRICTS[a.cell.district].activities;
			const night = w.clock.nightFactor;
			if (w.rng.chance(dt * 0.035 * act.idle)) return 'idle';
			if (w.rng.chance(dt * 0.05 * act.talk * (1 + night)) && b.findPartner(a, w)) return 'talk';
			if (w.rng.chance(dt * 0.03 * act.shop * (1 - night * 0.6)) && b.findShop(a, w)) return 'shop';
			if (w.rng.chance(dt * 0.004) && b.findVehicle(a, w)) return 'enterVehicle';
		},
	},
	idle: {
		enter: ({ a, w, b }) => {
			b.timer = w.rng.range(3, 9);
			a.stop(a.heading + w.rng.range(-1.5, 1.5));
			a.phone = w.rng.chance(0.3) ? 1 : 0;
		},
		update: ({ b }, dt) => {
			b.timer -= dt;
			if (b.timer <= 0) return 'wander';
		},
		exit: ({ a }) => {
			a.phone = 0;
		},
	},
	talk: {
		enter: ({ a, w, b }) => {
			b.timer = w.rng.range(6, 14);
			a.talking = true;
		},
		update: ({ a, b }, dt) => {
			const p = b.partner;
			b.timer -= dt;
			if (!p || !p.alive || !(p.brain instanceof CivilianBrain) || p.brain.state !== 'talk' || b.timer <= 0) return 'wander';
			const d = Math.hypot(p.x - a.x, p.z - a.z);
			if (d > 1.5) a.setTarget(p.x, p.z, 1.2, 1.3);
			else a.stop(headingTo(p.x - a.x, p.z - a.z));
		},
		exit: ({ a, b }) => {
			a.talking = false;
			const p = b.partner;
			b.partner = null;
			if (p && p.brain instanceof CivilianBrain && p.brain.state === 'talk') p.brain.fsm.change('wander');
		},
	},
	shop: {
		enter: ({ a, b }) => {
			b.timer = 60;
			if (b.shop) a.setTarget(b.shop.x, b.shop.z, b.walkSpeed, 1.2);
		},
		update: ({ a, w, b }, dt) => {
			const s = b.shop;
			if (!s) return 'wander';
			b.timer -= dt;
			if (a.hidden) {
				if (b.timer <= 0) {
					a.hidden = false;
					a.x = s.x + Math.sin(s.facing) * 1.2;
					a.z = s.z + Math.cos(s.facing) * 1.2;
					a.cell = null;
					return 'wander';
				}
			} else if (a.atTarget()) {
				a.hidden = true;
				b.timer = w.rng.range(8, 22);
			} else if (b.timer <= 0) return 'wander';
		},
		exit: ({ a, b }) => {
			if (a.hidden && b.shop) {
				a.hidden = false;
				a.x = b.shop.x;
				a.z = b.shop.z;
			}
			b.shop = null;
		},
	},
	flee: {
		enter: ({ a, w, b }) => {
			b.timer = w.rng.range(7, 13);
			b.retarget = 0;
			a.phone = 0;
			a.handsUp = 0;
			a.crouch = 0;
		},
		update: ({ a, w, b }, dt) => {
			b.timer -= dt;
			b.retarget -= dt;
			if (b.retarget <= 0 || a.atTarget()) {
				b.retarget = 2;
				b.fleeTarget(a, w);
			}
			if (b.timer <= 0) {
				a.fear = 0;
				a.cell = null;
				return b.report ? 'callPolice' : 'wander';
			}
		},
	},
	cower: {
		enter: ({ a, w, b }) => {
			b.timer = w.rng.range(4, 8);
			a.stop();
			if (b.handsUpMode) a.handsUp = 1;
			else a.crouch = 1;
		},
		update: ({ b }, dt) => {
			b.timer -= dt;
			if (b.timer <= 0) return 'flee';
		},
		exit: ({ a, b }) => {
			a.handsUp = 0;
			a.crouch = 0;
			b.handsUpMode = false;
		},
	},
	callPolice: {
		enter: ({ a, w, b }) => {
			b.timer = w.rng.range(3.5, 5.5);
			a.stop();
			a.phone = 1;
		},
		update: ({ a, w, b }, dt) => {
			b.timer -= dt;
			if (b.timer <= 0) {
				const r = b.report;
				if (r) w.bus.emit('crimeReported', { type: r.type, x: r.x, z: r.z, reporter: 'civilian', witness: a });
				b.report = null;
				return 'wander';
			}
		},
		exit: ({ a }) => {
			a.phone = 0;
		},
	},
	enterVehicle: {
		enter: ({ b }) => {
			b.timer = 25;
		},
		update: ({ a, w, b }, dt) => {
			const v = b.vehicle;
			b.timer -= dt;
			if (!v || v.destroyed || v.driver || b.timer <= 0 || !w.vehicles.list.includes(v)) return 'wander';
			const d = v.doorPoint(-1);
			a.setTarget(d.x, d.z, b.walkSpeed, 0.9);
			if (a.atTarget()) {
				w.actors.boardVehicle(a, v);
				return 'wander';
			}
		},
		exit: ({ b }) => {
			b.vehicle = null;
		},
	},
};

export class CivilianBrain implements ActorBrain {
	readonly fsm: StateMachine<Ctx, CivState>;
	timer = 0;
	retarget = 0;
	walkSpeed: number;
	partner: Actor | null = null;
	shop: Poi | null = null;
	vehicle: Vehicle | null = null;
	crossing: Crossing | null = null;
	waiting = false;
	handsUpMode = false;
	report: { type: CrimeType; x: number; z: number } | null = null;

	constructor(a: Actor, w: World, initial: CivState = 'wander') {
		this.walkSpeed = w.rng.range(1.15, 1.7);
		this.fsm = new StateMachine(TABLE, initial, { a, w, b: this });
	}

	get state(): CivState {
		return this.fsm.current;
	}

	think(_a: Actor, w: World, dt: number): void {
		this.fsm.update(dt, w.time);
	}

	// ---------------------------------------------------------------- reactions

	react(a: Actor, w: World, kind: ThreatKind, x: number, z: number, crime?: CrimeType): void {
		if (!a.alive || a.vehicle) return;
		if (a.hidden) return;
		a.threatX = x;
		a.threatZ = z;
		const d = Math.hypot(a.x - x, a.z - z);
		const st = this.fsm.current;
		a.fear = Math.min(1, a.fear + (kind === 'crime' ? 0.3 : 0.7));
		switch (kind) {
			case 'gunshot':
			case 'explosion':
				if (crime && w.rng.chance(0.3)) this.report = { type: crime, x, z };
				if (st === 'cower') return;
				if (kind === 'gunshot' && d < 14 && w.rng.chance(0.35)) this.fsm.change('cower');
				else this.fsm.change('flee');
				return;
			case 'aimedAt':
				if (st === 'cower' || st === 'flee') return;
				if (d < 9 && w.rng.chance(0.6)) {
					this.handsUpMode = true;
					this.fsm.change('cower');
				} else this.fsm.change('flee');
				return;
			case 'carDanger':
				if (st !== 'flee') {
					this.fsm.change('flee');
					this.timer = 2;
				}
				return;
			case 'attacked':
				this.report = { type: crime ?? 'assault', x, z };
				this.fsm.change('flee');
				return;
			case 'crime': {
				const severe = crime ? SEVERE.includes(crime) : false;
				if (st === 'callPolice' || this.report) return;
				if (w.rng.chance(severe ? 0.45 : 0.55)) {
					this.report = { type: crime ?? 'assault', x, z };
					// Get some distance first if it is dangerous.
					this.fsm.change(severe || d < 12 ? 'flee' : 'callPolice');
					if (severe) this.timer = 3;
				} else if (severe) this.fsm.change('flee');
				return;
			}
		}
	}

	/** Called by another civilian who wants to chat. */
	acceptTalk(other: Actor): boolean {
		if (this.fsm.current !== 'wander' && this.fsm.current !== 'idle') return false;
		this.partner = other;
		this.fsm.change('talk');
		return true;
	}

	// ----------------------------------------------------------------- helpers

	ensureCell(a: Actor, w: World): void {
		if (a.cell) return;
		const c = w.city;
		const x = Math.max(c.cellSize * WORLD.gridMinX + 1, Math.min(a.x, c.cellSize * WORLD.gridMaxX - 1));
		const z = Math.max(c.cellSize * WORLD.gridMinZ + 1, Math.min(a.z, c.cellSize * WORLD.gridMaxZ - 1));
		a.cell = c.cellAt(x, z);
		if (!a.cell) return;
		// Nearest corner.
		let best = 0;
		let bestD = Infinity;
		for (let k = 0; k < 4; k++) {
			const p = cornerOf(a.cell, k);
			const d = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
			if (d < bestD) {
				bestD = d;
				best = k;
			}
		}
		a.corner = best;
	}

	cornerXZ(a: Actor): [number, number] {
		if (!a.cell) return [a.x, a.z];
		const p = cornerOf(a.cell, a.corner);
		return [p.x, p.z];
	}

	canCross(w: World, cell: Cell, c: Crossing): boolean {
		const node = w.city.nodeAt(cell.i + c.ni, cell.j + c.nj);
		if (!node || !node.signal) return true;
		return w.roads.signalAt(node, c.axis, w.time) === 'green';
	}

	findPartner(a: Actor, w: World): boolean {
		let found: Actor | null = null;
		w.actors.hash.query(a.x, a.z, 8, (o) => {
			if (found || o === a || !o.alive || o.role !== 'civilian' || !o.onFoot) return;
			if (o.brain instanceof CivilianBrain && o.brain.acceptTalk(a)) found = o;
		});
		if (found) this.partner = found;
		return found !== null;
	}

	findShop(a: Actor, w: World): boolean {
		let best: Poi | null = null;
		let bestD = 70 * 70;
		for (const p of w.city.pois) {
			if (!SHOP_KINDS.has(p.kind)) continue;
			const d = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
			if (d < bestD) {
				bestD = d;
				best = p;
			}
		}
		this.shop = best;
		return best !== null;
	}

	findVehicle(a: Actor, w: World): boolean {
		const v = w.vehicles.nearest(a.x, a.z, 25, (v) => v.role === 'parked' && !v.driver && !v.destroyed && !v.persistent && !v.def.police);
		this.vehicle = v;
		return v !== null;
	}

	fleeTarget(a: Actor, w: World): void {
		let ax = a.x - a.threatX;
		let az = a.z - a.threatZ;
		const l = Math.hypot(ax, az) || 1;
		ax /= l;
		az /= l;
		const side = w.rng.range(-0.6, 0.6);
		let tx = a.x + (ax - az * side) * 22;
		let tz = a.z + (az + ax * side) * 22;
		if (!w.city.isLand(tx, tz)) {
			tx = a.x - az * 20;
			tz = a.z + ax * 20;
		}
		a.setTarget(tx, tz, w.rng.range(4.4, 5.6), 1.5);
	}
}
