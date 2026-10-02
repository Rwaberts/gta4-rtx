// Shared combat helpers for hostile NPC brains (gangs, police, mission enemies).

import { headingTo } from '../../core/math';
import { WEAPONS, type WeaponId } from '../../data/weapons';
import type { Actor } from '../Actor';
import type { World } from '../World';

export interface TargetInfo {
	x: number;
	y: number;
	z: number;
	speed: number;
	inVehicle: boolean;
}

const tmp: TargetInfo = { x: 0, y: 0, z: 0, speed: 0, inVehicle: false };

/** Where to aim at the player (chest, or the vehicle cabin). */
export function playerTarget(w: World, out: TargetInfo = tmp): TargetInfo {
	const p = w.player;
	if (p.state === 'driving' && p.vehicle) {
		out.x = p.vehicle.x;
		out.y = 1.1;
		out.z = p.vehicle.z;
		out.speed = p.vehicle.speed;
		out.inVehicle = true;
	} else {
		out.x = p.x;
		out.y = p.y + (p.crouching ? 0.9 : 1.25);
		out.z = p.z;
		out.speed = p.speed;
		out.inVehicle = false;
	}
	return out;
}

/** Line of sight from an actor's eyes to the player, within range. */
export function canSeePlayer(a: Actor, w: World, range: number): boolean {
	const p = w.player;
	if (!p.alive) return false;
	const t = playerTarget(w);
	const d = Math.hypot(t.x - a.x, t.z - a.z);
	if (d > range) return false;
	return w.collision.lineOfSight(a.x, a.y + 1.6, a.z, t.x, t.y + 0.2, t.z);
}

/** Faces the target, aims and fires when the cooldown allows. Handles reloading. */
export function engage(a: Actor, w: World, t: TargetInfo, dt: number, burst = 1): void {
	const id = (a.weapon ?? 'pistol') as WeaponId;
	const def = WEAPONS[id];
	a.faceHeading = headingTo(t.x - a.x, t.z - a.z);
	a.heading = a.faceHeading;
	a.aiming = true;
	a.fireCooldown -= dt;
	if (a.reloadTimer > 0) {
		a.reloadTimer -= dt;
		if (a.reloadTimer <= 0) a.clip = def.clip;
		return;
	}
	if (a.fireCooldown > 0) return;
	if (a.clip <= 0) {
		a.reloadTimer = def.reloadTime * 1.3;
		return;
	}
	a.clip--;
	w.combat.npcFire(a, t.x, t.y, t.z, id, t.speed);
	// Bursts for automatic weapons, measured pauses otherwise.
	const base = 1 / def.fireRate;
	a.fireCooldown = def.auto && burst > 1 && a.clip % burst !== 0 ? base : base * w.rng.range(2.2, 4.5);
}

export function armActor(a: Actor, weapon: WeaponId, accuracy: number): void {
	a.weapon = weapon;
	a.clip = WEAPONS[weapon].clip;
	a.accuracy = accuracy;
	a.fireCooldown = 0.5 + Math.random();
}

/** A point beside the actor, perpendicular to the target direction (strafing). */
export function strafePoint(a: Actor, tx: number, tz: number, w: World): { x: number; z: number } {
	const dx = tx - a.x;
	const dz = tz - a.z;
	const l = Math.hypot(dx, dz) || 1;
	const side = w.rng.chance(0.5) ? 1 : -1;
	const dist = w.rng.range(2.5, 6);
	let x = a.x + (-dz / l) * side * dist;
	let z = a.z + (dx / l) * side * dist;
	if (w.collision.resolveCircle({ x, z }, 0.4, 0, 1.8)) {
		x = a.x - (-dz / l) * side * dist;
		z = a.z - (dx / l) * side * dist;
	}
	return { x, z };
}
