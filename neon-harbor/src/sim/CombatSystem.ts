// Weapons and damage: hitscan tracing against the static world, actors (vertical capsules with
// headshots), vehicles (oriented boxes) and the player; melee; thrown grenades with bouncing
// physics; reloads, weapon switching, drive-bys; noise + crime events. Shared by player and NPCs.

import { clamp } from '../core/math';
import { WEAPONS, type WeaponDef, type WeaponId } from '../data/weapons';
import type { Actor } from './Actor';
import type { Attacker } from './events';
import { Inventory } from './Inventory';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

export interface TraceHit {
	t: number;
	x: number;
	y: number;
	z: number;
	nx: number;
	ny: number;
	nz: number;
	kind: 'none' | 'world' | 'flesh' | 'metal';
	actor: Actor | null;
	vehicle: Vehicle | null;
	player: boolean;
	headshot: boolean;
}

export interface Grenade {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	fuse: number;
	owner: Attacker;
	active: boolean;
}

/** NPC bullets are scaled down so firefights are survivable. */
const NPC_DAMAGE_SCALE = 0.45;

function emptyHit(): TraceHit {
	return { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: 'none', actor: null, vehicle: null, player: false, headshot: false };
}

export class CombatSystem {
	readonly inventory = new Inventory();
	readonly grenades: Grenade[] = [];
	private cooldown = 0;
	/** Semi-auto presses are remembered briefly so clicks during cooldowns are not lost. */
	private fireBuffer = 0;
	reloadTimer = 0;
	private aimHold = 0;
	private aimCheck = 0;
	private crimeCooldown = 0;
	private hit = emptyHit();
	/** Seconds the player has been firing recently (police threat assessment). */
	recentFire = 0;

	constructor(private readonly world: World) {
		this.inventory.give('pistol', 36);
	}

	get reloading(): boolean {
		return this.reloadTimer > 0;
	}

	/** Called before the player controller so hip-fire turns the player towards the aim. */
	preStep(): void {
		const c = this.world.controls;
		if (this.aimHold > 0 && this.inventory.def.kind === 'hitscan') c.aim = true;
	}

	step(dt: number): void {
		this.cooldown -= dt;
		this.fireBuffer -= dt;
		this.aimHold -= dt;
		this.crimeCooldown -= dt;
		this.recentFire = Math.max(0, this.recentFire - dt);
		this.updatePlayerWeapon(dt);
		this.updateGrenades(dt);
	}

	// ------------------------------------------------------------- player gun

	private updatePlayerWeapon(dt: number): void {
		const w = this.world;
		const p = w.player;
		const c = w.controls;
		const inv = this.inventory;
		if (p.state !== 'onFoot' && p.state !== 'driving') return;

		if (c.weaponSlot >= 0 || c.weaponDelta !== 0) {
			const before = inv.current;
			if (c.weaponSlot >= 0) inv.selectSlot(c.weaponSlot);
			else inv.cycle(Math.sign(c.weaponDelta));
			if (inv.current !== before) {
				this.reloadTimer = 0;
				this.cooldown = 0.25;
				w.bus.emit('sound', { id: 'switch' });
			}
		}
		const def = inv.def;
		const st = inv.state;
		if (this.reloadTimer > 0) {
			this.reloadTimer -= dt;
			if (this.reloadTimer <= 0) inv.reload();
		}
		const canReload = def.kind !== 'melee' && st.clip < def.clip && st.reserve > 0 && this.reloadTimer <= 0;
		if (c.reloadPressed && canReload) this.startReload(def);

		const driving = p.state === 'driving';
		if (driving && !def.driveBy) return;
		if (c.firePressed) this.fireBuffer = 0.35;
		const wants = def.auto ? c.fire : this.fireBuffer > 0;
		if (wants && this.cooldown <= 0 && this.reloadTimer <= 0) {
			this.fireBuffer = 0;
			if (def.kind === 'melee') {
				if (!driving) this.punch();
				this.cooldown = 1 / def.fireRate;
			} else if (st.clip > 0) {
				st.clip--;
				this.cooldown = 1 / def.fireRate;
				if (def.kind === 'thrown') this.throwGrenade();
				else this.firePlayer(def);
			} else if (st.reserve > 0) {
				this.startReload(def);
			} else {
				w.bus.emit('sound', { id: 'empty' });
				this.cooldown = 0.3;
				inv.cycle(1);
			}
		}
		if (st.clip === 0 && st.reserve > 0 && this.reloadTimer <= 0 && def.kind !== 'melee') this.startReload(def);

		// Civilians react to being aimed at.
		this.aimCheck -= dt;
		if (c.aim && !driving && def.kind === 'hitscan' && this.aimCheck <= 0) {
			this.aimCheck = 0.3;
			const a = w.aim;
			const h = this.trace(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 30, 'player', this.hit);
			if (h.actor && h.actor.alive) {
				w.actors.aimedAt(h.actor);
				w.bus.emit('aimedAtActor', { actor: h.actor });
			}
		}
	}

	private startReload(def: WeaponDef): void {
		this.reloadTimer = def.reloadTime;
		this.world.bus.emit('sound', { id: 'reload' });
	}

	/** Aim point under the crosshair (camera ray), skipping anything between camera and player. */
	private aimPoint(range: number): { x: number; y: number; z: number } {
		const w = this.world;
		const a = w.aim;
		const h = this.trace(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, range + a.skip, 'player', this.hit, a.skip);
		if (h.kind !== 'none') return { x: h.x, y: h.y, z: h.z };
		const r = range + a.skip;
		return { x: a.ox + a.dx * r, y: a.oy + a.dy * r, z: a.oz + a.dz * r };
	}

	private muzzle(): { x: number; y: number; z: number } {
		const p = this.world.player;
		if (p.state === 'driving' && p.vehicle) {
			// Out of the driver's (left) window.
			const v = p.vehicle;
			const lx = Math.cos(v.heading);
			const lz = -Math.sin(v.heading);
			const off = v.halfWidth + 0.3;
			return { x: v.x + lx * off + v.forwardX * 0.3, y: 1.4, z: v.z + lz * off + v.forwardZ * 0.3 };
		}
		const fx = Math.sin(p.heading);
		const fz = Math.cos(p.heading);
		return { x: p.x + fx * 0.75 - fz * 0.28, y: p.y + 1.42 - (p.crouching ? 0.4 : 0), z: p.z + fz * 0.75 + fx * 0.28 };
	}

	private firePlayer(def: WeaponDef): void {
		const w = this.world;
		const m = this.muzzle();
		const target = this.aimPoint(def.range);
		let dx = target.x - m.x;
		let dy = target.y - m.y;
		let dz = target.z - m.z;
		const l = Math.hypot(dx, dy, dz) || 1;
		dx /= l;
		dy /= l;
		dz /= l;
		const aiming = w.controls.aim && this.aimHold <= 0.55;
		const spread = def.spread * (aiming ? 0.5 : 1) * (w.player.state === 'driving' ? 1.6 : 1) * (w.player.speed > 3 ? 1.4 : 1);
		let anyHit = false;
		let kill = false;
		for (let i = 0; i < def.pellets; i++) {
			const [sx, sy, sz] = this.jitter(dx, dy, dz, spread);
			const r = this.fireRay(m.x, m.y, m.z, sx, sy, sz, def, 'player', 1);
			if (r.actor || r.vehicle) anyHit = true;
			if (r.actor && r.actor.dead) kill = true;
		}
		this.aimHold = 0.6;
		this.recentFire = Math.min(10, this.recentFire + 1.5);
		w.bus.emit('gunshot', { x: m.x, y: m.y, z: m.z, shooter: 'player', radius: def.noise });
		w.bus.emit('recoil', { amount: def.recoil });
		w.bus.emit('sound', { id: 'shot_' + def.id, x: m.x, z: m.z });
		if (anyHit) w.bus.emit('hitConfirm', { kill });
		if (this.crimeCooldown <= 0) {
			this.crimeCooldown = 1.5;
			w.bus.emit('crime', { type: 'gunfire', x: m.x, z: m.z, perpetrator: 'player' });
		}
	}

	private jitter(dx: number, dy: number, dz: number, spread: number): [number, number, number] {
		if (spread <= 0) return [dx, dy, dz];
		const r = this.world.rng;
		const a = r.range(0, Math.PI * 2);
		const s = Math.sqrt(r.next()) * spread;
		// Orthonormal basis around the direction.
		let ux = -dz;
		let uz = dx;
		const ul = Math.hypot(ux, uz) || 1;
		ux /= ul;
		uz /= ul;
		const vx = dy * uz;
		const vy = dz * ux - dx * uz;
		const vz = -dy * ux;
		const ox = (ux * Math.cos(a) + vx * Math.sin(a)) * s;
		const oy = vy * Math.sin(a) * s;
		const oz = (uz * Math.cos(a) + vz * Math.sin(a)) * s;
		const l = Math.hypot(dx + ox, dy + oy, dz + oz);
		return [(dx + ox) / l, (dy + oy) / l, (dz + oz) / l];
	}

	/** Traces one bullet and applies its damage. */
	fireRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, def: WeaponDef, shooter: Attacker, scale: number): TraceHit {
		const w = this.world;
		const h = this.trace(ox, oy, oz, dx, dy, dz, def.range, shooter, this.hit);
		const end = h.kind === 'none' ? def.range : h.t;
		const falloff = h.t > def.range * 0.6 ? 1 - ((h.t - def.range * 0.6) / (def.range * 0.4)) * 0.5 : 1;
		const dmg = def.damage * scale * falloff * (h.headshot ? 2.5 : 1);
		if (h.actor) w.actors.damage(h.actor, dmg, shooter, def.id);
		else if (h.vehicle) {
			w.vehicles.damage(h.vehicle, dmg * 1.2, shooter);
			if (h.vehicle.driver === 'player' && shooter !== 'player') w.damagePlayer(dmg * 0.3, shooter);
			else if (h.vehicle.driver && h.vehicle.driver !== 'player' && w.rng.chance(0.15)) w.actors.damage(h.vehicle.driver, dmg, shooter, def.id);
		} else if (h.player) w.damagePlayer(dmg, shooter);
		w.bus.emit('shot', {
			fx: ox,
			fy: oy,
			fz: oz,
			tx: ox + dx * end,
			ty: oy + dy * end,
			tz: oz + dz * end,
			weapon: def.id,
			shooter,
			hit: h.kind,
			nx: h.nx,
			ny: h.ny,
			nz: h.nz,
		});
		return h;
	}

	/**
	 * Finds the first thing a ray hits: static world, actors, vehicles or the player.
	 * `skip` ignores hits closer than that distance (camera rays).
	 */
	trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, shooter: Attacker, out: TraceHit, skip = 0): TraceHit {
		const w = this.world;
		out.kind = 'none';
		out.actor = null;
		out.vehicle = null;
		out.player = false;
		out.headshot = false;
		out.nx = out.ny = out.nz = 0;
		let best = range;
		const sh = w.collision.raycast(ox, oy, oz, dx, dy, dz, range);
		if (sh && sh.t > skip) {
			best = sh.t;
			out.kind = 'world';
			out.nx = sh.nx;
			out.ny = sh.ny;
			out.nz = sh.nz;
		}
		const shooterVehicle = shooter === 'player' ? (w.player.state === 'driving' ? w.player.vehicle : null) : shooter?.vehicle ?? null;
		// Actors near the segment.
		const mx = ox + dx * best * 0.5;
		const mz = oz + dz * best * 0.5;
		w.actors.hash.query(mx, mz, best * 0.5 + 1.5, (a) => {
			if (a === shooter || a.dead || !a.onFoot) return;
			const top = a.knockdown > 0 ? 0.5 : 1.85 - a.crouch * 0.45;
			const t = rayCylinder(ox, oy, oz, dx, dy, dz, a.x, a.z, a.radius + 0.05, a.y, a.y + top);
			if (t > skip && t < best) {
				best = t;
				out.kind = 'flesh';
				out.actor = a;
				out.vehicle = null;
				out.player = false;
				out.headshot = oy + dy * t - a.y > 1.52 && a.knockdown <= 0;
			}
		});
		w.vehicles.hash.query(mx, mz, best * 0.5 + 6, (v) => {
			if (v === shooterVehicle || v.sinking) return;
			const t = rayVehicle(ox, oy, oz, dx, dy, dz, v);
			if (t > skip && t < best) {
				best = t;
				out.kind = 'metal';
				out.vehicle = v;
				out.actor = null;
				out.player = false;
				out.headshot = false;
			}
		});
		const p = w.player;
		if (shooter !== 'player' && p.state === 'onFoot' && p.alive) {
			const top = p.crouching ? 1.2 : 1.85;
			const t = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, p.radius + 0.05, p.y, p.y + top);
			if (t > skip && t < best) {
				best = t;
				out.kind = 'flesh';
				out.player = true;
				out.actor = null;
				out.vehicle = null;
				out.headshot = false;
			}
		}
		out.t = best;
		out.x = ox + dx * best;
		out.y = oy + dy * best;
		out.z = oz + dz * best;
		return out;
	}

	// ------------------------------------------------------------------- melee

	private punch(): void {
		const w = this.world;
		const p = w.player;
		p.punchTimer = 0.3;
		const fx = Math.sin(p.heading);
		const fz = Math.cos(p.heading);
		let target: Actor | null = null;
		let bestD = WEAPONS.fists.range;
		w.actors.hash.query(p.x + fx * 0.8, p.z + fz * 0.8, 1.6, (a) => {
			if (!a.alive || !a.onFoot) return;
			const dx = a.x - p.x;
			const dz = a.z - p.z;
			const d = Math.hypot(dx, dz);
			if (d > bestD || (dx * fx + dz * fz) / (d || 1) < 0.4) return;
			bestD = d;
			target = a;
		});
		w.bus.emit('sound', { id: 'swing' });
		if (target) {
			const a = target as Actor;
			w.actors.damage(a, WEAPONS.fists.damage, 'player', 'melee');
			if (a.alive && w.rng.chance(0.3)) a.knockdown = 1.2;
			a.vx += fx * 2.5;
			a.vz += fz * 2.5;
			w.bus.emit('sound', { id: 'punch', x: a.x, z: a.z });
			w.bus.emit('hitConfirm', { kill: a.dead });
		}
	}

	/** NPC melee against the player (arrest scuffles, brawls). */
	npcPunch(a: Actor): void {
		const w = this.world;
		const p = w.player;
		a.punch = 1;
		if (p.state !== 'onFoot') return;
		if (Math.hypot(p.x - a.x, p.z - a.z) < 1.8) {
			w.damagePlayer(9, a);
			w.bus.emit('sound', { id: 'punch', x: p.x, z: p.z });
		}
	}

	// ----------------------------------------------------------------- NPC fire

	/**
	 * NPC shoots at a world point. Accuracy combines the actor's skill, distance and how fast
	 * the target moves; misses still fly and can hit bystanders.
	 */
	npcFire(a: Actor, tx: number, ty: number, tz: number, weaponId: WeaponId, targetSpeed: number): void {
		const fx = Math.sin(a.heading);
		const fz = Math.cos(a.heading);
		const mx = a.x + fx * 0.7 - fz * 0.25;
		const my = a.y + 1.42 - a.crouch * 0.4;
		const mz = a.z + fz * 0.7 + fx * 0.25;
		this.fireFrom(mx, my, mz, tx, ty, tz, weaponId, a.accuracy, targetSpeed, a);
	}

	/** Fires from an arbitrary muzzle position (NPCs, helicopter marksman, turrets). */
	fireFrom(mx: number, my: number, mz: number, tx: number, ty: number, tz: number, weaponId: WeaponId, accuracy: number, targetSpeed: number, shooter: Actor | null): void {
		const w = this.world;
		const def = WEAPONS[weaponId];
		let dx = tx - mx;
		let dy = ty - my;
		let dz = tz - mz;
		const dist = Math.hypot(dx, dy, dz) || 1;
		dx /= dist;
		dy /= dist;
		dz /= dist;
		const spread = def.spread + (1 - accuracy) * 0.07 + clamp(targetSpeed / 40, 0, 0.12) + clamp(dist / 400, 0, 0.08);
		for (let i = 0; i < def.pellets; i++) {
			const [sx, sy, sz] = this.jitter(dx, dy, dz, spread);
			this.fireRay(mx, my, mz, sx, sy, sz, def, shooter, NPC_DAMAGE_SCALE);
		}
		w.bus.emit('gunshot', { x: mx, y: my, z: mz, shooter, radius: def.noise });
		w.bus.emit('sound', { id: 'shot_' + def.id, x: mx, z: mz });
	}

	// ----------------------------------------------------------------- grenades

	private throwGrenade(): void {
		const w = this.world;
		const p = w.player;
		const a = w.aim;
		const g = this.grenades.find((x) => !x.active) ?? ({} as Grenade);
		if (!this.grenades.includes(g)) this.grenades.push(g);
		g.active = true;
		g.x = p.x + Math.sin(p.heading) * 0.5;
		g.y = p.y + 1.7;
		g.z = p.z + Math.cos(p.heading) * 0.5;
		const up = clamp(-a.dy + 0.35, 0.15, 0.9);
		g.vx = a.dx * 15 + p.vx;
		g.vy = up * 11;
		g.vz = a.dz * 15 + p.vz;
		g.fuse = 2.4;
		g.owner = 'player';
		p.punchTimer = 0.3;
		w.bus.emit('sound', { id: 'swing' });
	}

	private updateGrenades(dt: number): void {
		const w = this.world;
		for (const g of this.grenades) {
			if (!g.active) continue;
			g.fuse -= dt;
			g.vy += -22 * dt;
			const hit = w.collision.raycast(g.x, g.y, g.z, g.vx * dt, g.vy * dt, g.vz * dt, 1);
			if (hit) {
				g.x = hit.x + hit.nx * 0.05;
				g.y = Math.max(0.08, hit.y + hit.ny * 0.05);
				g.z = hit.z + hit.nz * 0.05;
				// Reflect with energy loss.
				const vn = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz;
				g.vx = (g.vx - 2 * vn * hit.nx) * 0.45;
				g.vy = (g.vy - 2 * vn * hit.ny) * 0.4;
				g.vz = (g.vz - 2 * vn * hit.nz) * 0.45;
			} else {
				g.x += g.vx * dt;
				g.y += g.vy * dt;
				g.z += g.vz * dt;
			}
			if (g.fuse <= 0) {
				g.active = false;
				w.queueExplosion(g.x, Math.max(0.3, g.y), g.z, 7, g.owner);
			}
		}
	}
}

/** Ray vs vertical cylinder. Returns distance or Infinity. */
export function rayCylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, y0: number, y1: number): number {
	const px = ox - cx;
	const pz = oz - cz;
	const a = dx * dx + dz * dz;
	if (a < 1e-9) return Infinity;
	const b = 2 * (px * dx + pz * dz);
	const c = px * px + pz * pz - r * r;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return Infinity;
	const sq = Math.sqrt(disc);
	let t = (-b - sq) / (2 * a);
	if (t < 0) t = (-b + sq) / (2 * a);
	if (t < 0) return Infinity;
	const y = oy + dy * t;
	return y >= y0 && y <= y1 ? t : Infinity;
}

/** Ray vs a vehicle's oriented bounding box. */
export function rayVehicle(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, v: Vehicle): number {
	const fx = v.forwardX;
	const fz = v.forwardZ;
	const rx = -fz;
	const rz = fx;
	const px = ox - v.x;
	const pz = oz - v.z;
	const lo = [px * rx + pz * rz, oy - v.y, px * fx + pz * fz];
	const ld = [dx * rx + dz * rz, dy, dx * fx + dz * fz];
	const mn = [-v.halfWidth, 0.25, -v.halfLength];
	const mx = [v.halfWidth, v.def.height, v.halfLength];
	let tmin = 0;
	let tmax = Infinity;
	for (let i = 0; i < 3; i++) {
		if (Math.abs(ld[i]) < 1e-9) {
			if (lo[i] < mn[i] || lo[i] > mx[i]) return Infinity;
			continue;
		}
		let t1 = (mn[i] - lo[i]) / ld[i];
		let t2 = (mx[i] - lo[i]) / ld[i];
		if (t1 > t2) [t1, t2] = [t2, t1];
		tmin = Math.max(tmin, t1);
		tmax = Math.min(tmax, t2);
		if (tmin > tmax) return Infinity;
	}
	return tmin;
}
