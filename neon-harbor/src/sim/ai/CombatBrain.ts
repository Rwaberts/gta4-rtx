// Hostile / territorial NPC brain (gang members, mission enemies, bodyguards):
//   guard -> attack <-> chase -> flee, with provocation, LOS tracking and strafing.

import { StateMachine, type StateTable } from '../../core/StateMachine';
import { headingTo } from '../../core/math';
import type { Actor, ActorBrain } from '../Actor';
import type { World } from '../World';
import { canSeePlayer, engage, playerTarget, strafePoint } from './tactics';

export type CombatState = 'guard' | 'attack' | 'chase' | 'flee' | 'follow';

interface Ctx {
	a: Actor;
	w: World;
	b: CombatBrain;
}

const TABLE: StateTable<Ctx, CombatState> = {
	guard: {
		enter: ({ a, b }) => {
			a.aiming = false;
			a.setTarget(b.homeX, b.homeZ, 1.4, 1.5);
		},
		update: ({ a, w, b }, dt) => {
			b.look -= dt;
			if (b.look <= 0) {
				b.look = w.rng.range(2, 5);
				if (a.atTarget()) a.stop(a.heading + w.rng.range(-1.2, 1.2));
			}
			if (b.provoked || a.hostile) {
				if (canSeePlayer(a, w, b.provoked ? b.detect * 1.6 : b.detect)) return 'attack';
				if (b.provoked) return 'chase';
			}
		},
	},
	attack: {
		enter: ({ b }) => {
			b.strafe = 0;
			b.lostTimer = 0;
		},
		update: ({ a, w, b }, dt) => {
			const t = playerTarget(w);
			if (!w.player.alive) return 'guard';
			const d = Math.hypot(t.x - a.x, t.z - a.z);
			if (a.health < a.maxHealth * 0.25 && b.canFlee && w.rng.chance(dt * 0.3)) return 'flee';
			if (!canSeePlayer(a, w, 70)) {
				b.lostTimer += dt;
				if (b.lostTimer > 1.5) return 'chase';
			} else {
				b.lostTimer = 0;
				b.lastX = t.x;
				b.lastZ = t.z;
				engage(a, w, t, dt, 3);
			}
			// Keep a fighting distance and strafe.
			b.strafe -= dt;
			if (d > 20) a.setTarget(t.x, t.z, 4.8, 12);
			else if (d < 5) a.setTarget(a.x + (a.x - t.x), a.z + (a.z - t.z), 3.5, 1);
			else if (b.strafe <= 0) {
				b.strafe = w.rng.range(1.5, 3.2);
				const s = strafePoint(a, t.x, t.z, w);
				a.setTarget(s.x, s.z, 3, 0.8);
			}
			a.faceHeading = headingTo(t.x - a.x, t.z - a.z);
		},
		exit: ({ a }) => {
			a.aiming = false;
		},
	},
	chase: {
		enter: ({ a, b }) => {
			a.setTarget(b.lastX, b.lastZ, 5, 2.5);
			b.timer = 18;
		},
		update: ({ a, w, b }, dt) => {
			b.timer -= dt;
			if (canSeePlayer(a, w, 45)) return 'attack';
			if (a.atTarget() || b.timer <= 0) {
				// Lost the target: go back to guarding (stay provoked for a while).
				b.provoked = b.timer > -20;
				return 'guard';
			}
		},
	},
	flee: {
		enter: ({ a, w }) => {
			const t = playerTarget(w);
			a.setTarget(a.x + (a.x - t.x) * 3, a.z + (a.z - t.z) * 3, 5.2, 2);
			a.aiming = false;
		},
		update: ({ a, b }, dt) => {
			b.timer -= dt;
			if (a.atTarget()) return 'guard';
		},
	},
	follow: {
		// Allies (mission escorts) follow the player, ride along as passengers and return fire.
		update: ({ a, w, b }, dt) => {
			const p = w.player;
			if (p.state === 'driving' && p.vehicle && !p.vehicle.destroyed) {
				const v = p.vehicle;
				const door = v.doorPoint(1);
				const dd = Math.hypot(door.x - a.x, door.z - a.z);
				if (dd < 2.2 && v.speed < 3) {
					a.vehicle = v;
					a.aiming = false;
					v.passengers.push(a);
					return;
				}
				a.setTarget(door.x, door.z, dd > 8 ? 5.2 : 3, 1.5);
				return;
			}
			const d = Math.hypot(p.px - a.x, p.pz - a.z);
			if (d > 4) a.setTarget(p.px, p.pz, d > 10 ? 5 : 2.2, 3);
			else a.stop();
			const enemy = b.findEnemy(a, w);
			if (enemy && a.weapon) {
				engage(a, w, { x: enemy.x, y: enemy.y + 1.2, z: enemy.z, speed: enemy.speed, inVehicle: false }, dt, 3);
			} else a.aiming = false;
		},
	},
};

export class CombatBrain implements ActorBrain {
	readonly fsm: StateMachine<Ctx, CombatState>;
	homeX: number;
	homeZ: number;
	detect = 28;
	provoked = false;
	canFlee = true;
	look = 0;
	strafe = 0;
	timer = 0;
	lostTimer = 0;
	lastX = 0;
	lastZ = 0;

	constructor(a: Actor, w: World, initial: CombatState = 'guard') {
		this.homeX = a.x;
		this.homeZ = a.z;
		this.fsm = new StateMachine(TABLE, initial, { a, w, b: this });
	}

	get state(): CombatState {
		return this.fsm.current;
	}

	think(_a: Actor, w: World, dt: number): void {
		this.fsm.update(dt, w.time);
	}

	/** The player attacked this NPC or its group. */
	provoke(): void {
		this.provoked = true;
		if (this.fsm.current === 'guard') this.fsm.change('attack');
	}

	/** Nearest hostile actor (for allies). */
	findEnemy(a: Actor, w: World): Actor | null {
		let best: Actor | null = null;
		let bestD = 35 * 35;
		w.actors.hash.query(a.x, a.z, 35, (o, d2) => {
			if (!o.alive || !o.hostile || o === a || d2 >= bestD) return;
			if (!w.collision.lineOfSight(a.x, 1.6, a.z, o.x, 1.4, o.z)) return;
			bestD = d2;
			best = o;
		});
		return best;
	}
}
