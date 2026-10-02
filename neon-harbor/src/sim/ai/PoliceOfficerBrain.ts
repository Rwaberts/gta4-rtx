// On-foot police officer state machine:
//   patrol -> approach -> arrest | attack -> search -> returnToCar, plus guard (roadblocks).
// Arrest vs attack is decided from the wanted level's lethal-force policy and the player's
// behaviour (armed / shooting / resisting).

import { StateMachine, type StateTable } from '../../core/StateMachine';
import { headingTo } from '../../core/math';
import { ARREST_TIME } from '../../data/wanted';
import type { Actor, ActorBrain } from '../Actor';
import type { Vehicle } from '../Vehicle';
import type { World } from '../World';
import { canSeePlayer, engage, playerTarget, strafePoint } from './tactics';

export type OfficerState = 'patrol' | 'approach' | 'arrest' | 'attack' | 'search' | 'returnToCar' | 'guard';

/** The officer's unit (car + crew), implemented by PoliceSystem. */
export interface OfficerUnit {
	car(): Vehicle | null;
	board(a: Actor): void;
}

interface Ctx {
	a: Actor;
	w: World;
	b: PoliceOfficerBrain;
}

const TABLE: StateTable<Ctx, OfficerState> = {
	patrol: {
		enter: ({ a }) => {
			a.aiming = false;
		},
		update: ({ a, w, b }, dt) => {
			if (w.wanted.level > 0 && b.sees) return 'approach';
			b.timer -= dt;
			if (b.timer <= 0 || a.atTarget()) {
				b.timer = w.rng.range(6, 14);
				const ang = w.rng.range(0, Math.PI * 2);
				const r = w.rng.range(6, 22);
				let tx = b.homeX + Math.cos(ang) * r;
				let tz = b.homeZ + Math.sin(ang) * r;
				if (w.city.isOnRoad(tx, tz) || !w.city.isLand(tx, tz)) {
					tx = b.homeX;
					tz = b.homeZ;
				}
				a.setTarget(tx, tz, 1.3, 1);
			}
		},
	},
	approach: {
		enter: ({ a }) => {
			a.aiming = false;
		},
		update: ({ a, w, b }) => {
			const wanted = w.wanted;
			if (wanted.level === 0) return b.unit ? 'returnToCar' : 'patrol';
			const t = playerTarget(w);
			const d = Math.hypot(t.x - a.x, t.z - a.z);
			if (b.sees && wanted.lethal()) return 'attack';
			if (b.sees) {
				if (d < 2.3) return 'arrest';
				a.setTarget(t.x, t.z, d > 10 ? 5.6 : 3.6, 1.6);
			} else {
				a.setTarget(wanted.lkpX, wanted.lkpZ, 5, 3);
				if (a.atTarget()) return 'search';
			}
		},
	},
	arrest: {
		enter: ({ a }) => {
			a.aiming = true;
		},
		update: ({ a, w, b }, dt) => {
			const wanted = w.wanted;
			const p = w.player;
			if (wanted.level === 0) return b.unit ? 'returnToCar' : 'patrol';
			if (wanted.lethal()) return 'attack';
			const t = playerTarget(w);
			const d = Math.hypot(t.x - a.x, t.z - a.z);
			a.faceHeading = headingTo(t.x - a.x, t.z - a.z);
			if (d > 1.7) a.setTarget(t.x, t.z, 2.2, 1.5);
			else a.stop(a.faceHeading);
			const pv = p.state === 'driving' ? p.vehicle : null;
			const compliant = (p.state === 'onFoot' && p.speed < 2.8) || (pv !== null && pv.speed < 1 && d < 3.2);
			if (d > 4.5 || (pv && pv.speed > 4)) {
				if (wanted.arrest > 0.25) wanted.report('resistArrest', p.px, p.pz, 'police');
				return 'approach';
			}
			if (compliant && d < 2.6 && w.combat.recentFire <= 0) {
				if (wanted.advanceArrest(dt, ARREST_TIME)) w.arrestPlayer(a);
			}
		},
		exit: ({ a }) => {
			a.aiming = false;
		},
	},
	attack: {
		enter: ({ b }) => {
			b.timer = 0;
			b.lost = 0;
		},
		update: ({ a, w, b }, dt) => {
			const wanted = w.wanted;
			if (wanted.level === 0) return b.unit ? 'returnToCar' : 'patrol';
			if (!wanted.lethal()) return 'approach';
			const t = playerTarget(w);
			const d = Math.hypot(t.x - a.x, t.z - a.z);
			if (!b.sees) {
				b.lost += dt;
				if (b.lost > 2.5) return 'approach';
				a.setTarget(wanted.lkpX, wanted.lkpZ, 4.5, 3);
				a.aiming = false;
				return;
			}
			b.lost = 0;
			engage(a, w, t, dt, a.weapon === 'rifle' ? 3 : 1);
			b.timer -= dt;
			if (d > 24) a.setTarget(t.x, t.z, 5, 14);
			else if (d < 5) a.setTarget(a.x + (a.x - t.x), a.z + (a.z - t.z), 3, 1);
			else if (b.timer <= 0) {
				b.timer = w.rng.range(1.8, 3.5);
				const s = strafePoint(a, t.x, t.z, w);
				a.setTarget(s.x, s.z, 2.8, 0.8);
			}
			a.faceHeading = headingTo(t.x - a.x, t.z - a.z);
		},
		exit: ({ a }) => {
			a.aiming = false;
		},
	},
	search: {
		enter: ({ b }) => {
			b.timer = 0;
		},
		update: ({ a, w, b }, dt) => {
			const wanted = w.wanted;
			if (wanted.level === 0) return b.unit ? 'returnToCar' : 'patrol';
			if (b.sees) return 'approach';
			b.timer -= dt;
			if (b.timer <= 0 || a.atTarget()) {
				b.timer = w.rng.range(4, 8);
				const ang = w.rng.range(0, Math.PI * 2);
				const r = w.rng.range(5, 28);
				a.setTarget(wanted.lkpX + Math.cos(ang) * r, wanted.lkpZ + Math.sin(ang) * r, 2.6, 1.5);
			}
		},
	},
	returnToCar: {
		enter: ({ a }) => {
			a.aiming = false;
		},
		update: ({ a, w, b }) => {
			const car = b.unit?.car();
			if (!car || car.destroyed || car.driver === 'player') return w.wanted.level > 0 ? 'search' : 'patrol';
			if (w.wanted.level > 0 && b.sees && Math.hypot(w.player.px - a.x, w.player.pz - a.z) < 25) return 'approach';
			const door = car.doorPoint(b.seat);
			a.setTarget(door.x, door.z, 4.5, 1.2);
			if (a.atTarget()) b.unit!.board(a);
		},
	},
	guard: {
		update: ({ a, w, b }, dt) => {
			const wanted = w.wanted;
			if (wanted.level === 0) return b.unit ? 'returnToCar' : 'patrol';
			a.setTarget(b.homeX, b.homeZ, 3, 0.8);
			if (b.sees) {
				const t = playerTarget(w);
				if (wanted.lethal()) engage(a, w, t, dt, 3);
				else {
					a.aiming = true;
					a.faceHeading = headingTo(t.x - a.x, t.z - a.z);
				}
				// Step out to arrest a player who stops at the roadblock on foot.
				if (!wanted.lethal() && w.player.state === 'onFoot' && Math.hypot(t.x - a.x, t.z - a.z) < 15) return 'approach';
			} else a.aiming = false;
		},
	},
};

export class PoliceOfficerBrain implements ActorBrain {
	readonly fsm: StateMachine<Ctx, OfficerState>;
	/** Updated by PoliceSystem's perception pass. */
	sees = false;
	timer = 0;
	lost = 0;
	homeX: number;
	homeZ: number;
	/** -1 driver (left) door, 1 passenger door. */
	seat: -1 | 1 = -1;

	constructor(
		a: Actor,
		w: World,
		readonly unit: OfficerUnit | null,
		initial: OfficerState = 'patrol',
	) {
		this.homeX = a.x;
		this.homeZ = a.z;
		this.fsm = new StateMachine(TABLE, initial, { a, w, b: this });
	}

	get state(): OfficerState {
		return this.fsm.current;
	}

	think(_a: Actor, w: World, dt: number): void {
		this.fsm.update(dt, w.time);
	}

	order(state: OfficerState): void {
		this.fsm.change(state);
	}

	/** Line-of-sight check used by the perception pass. */
	look(a: Actor, w: World, range: number): boolean {
		this.sees = canSeePlayer(a, w, range);
		return this.sees;
	}
}
