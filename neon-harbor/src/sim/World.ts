// Simulation root: owns all gameplay state and runs systems in a fixed order.
// Contains no rendering or DOM code so it can run headless in unit tests.

import { EventBus } from '../core/EventBus';
import { Random } from '../core/Random';
import { WORLD } from '../data/config';
import { DISTRICTS, type DistrictId } from '../data/districts';
import { generateCity, type CityLayout } from '../world/CityLayout';
import { StaticCollision } from '../world/StaticCollision';
import { clearEdges, createControls, type PlayerControls } from './controls';
import type { Attacker, GameEvents } from './events';
import { Player } from './Player';
import type { Vehicle } from './Vehicle';
import { VehicleSystem } from './VehicleSystem';

interface PendingExplosion {
	x: number;
	y: number;
	z: number;
	radius: number;
	source: Attacker;
}

export class World {
	readonly bus = new EventBus<GameEvents>();
	readonly city: CityLayout;
	readonly collision: StaticCollision;
	readonly player = new Player();
	readonly controls: PlayerControls = createControls();
	readonly rng: Random;
	readonly vehicles: VehicleSystem;
	/** Simulation seconds since start. */
	time = 0;
	/** 0..1 road wetness (set by weather). */
	wetness = 0;
	currentDistrict: DistrictId | null = null;
	private districtTimer = 0;
	private explosions: PendingExplosion[] = [];
	private deathTimer = 0;
	/** Optional hooks installed by systems added in later phases. */
	onVehicleDespawn?: (v: Vehicle) => void;

	constructor(seed: number = WORLD.seed) {
		this.rng = new Random(seed ^ 0xabcdef);
		this.city = generateCity(seed);
		this.collision = new StaticCollision(16);
		this.city.forEachSolid((a, b, c, d, e, f) => this.collision.add(a, b, c, d, e, f));
		this.vehicles = new VehicleSystem(this);
		const home = this.city.poi('safehouse')!;
		this.player.teleport(home.x + Math.sin(home.facing) * 3, home.z + Math.cos(home.facing) * 3, home.facing);
	}

	step(dt: number): void {
		this.time += dt;
		this.processExplosions();
		const p = this.player;
		if (p.state === 'onFoot') p.updateOnFoot(dt, this.controls, this);
		this.vehicles.step(dt);
		p.updateVitals(dt);
		this.updateDeath(dt);
		this.updateDistrict(dt);
		clearEdges(this.controls);
	}

	// ------------------------------------------------------------- damage hub

	damagePlayer(amount: number, attacker: Attacker): void {
		const p = this.player;
		if (!p.alive) return;
		const lost = p.damage(amount);
		if (lost <= 0) return;
		this.bus.emit('playerDamaged', { amount: lost, attacker });
		if (p.health <= 0) this.killPlayer(attacker ? 'attacked' : 'injuries');
	}

	killPlayer(cause: string): void {
		const p = this.player;
		if (!p.alive) return;
		if (p.vehicle && p.state === 'driving') this.vehicles.ejectPlayer(p.vehicle, p.swimming);
		p.state = 'dead';
		p.health = 0;
		p.vx = p.vz = 0;
		this.deathTimer = 0;
		this.bus.emit('playerDied', { cause });
	}

	private updateDeath(dt: number): void {
		const p = this.player;
		if (p.state !== 'dead') return;
		this.deathTimer += dt;
		if (this.deathTimer > 4.5) this.respawn('death');
	}

	/** Respawns at the nearest hospital (death) or police precinct (arrest). */
	respawn(reason: 'death' | 'arrest'): void {
		const p = this.player;
		const kind = reason === 'death' ? 'hospital' : 'police';
		let best = this.city.pois.find((x) => x.kind === kind)!;
		let bestD = Infinity;
		for (const poi of this.city.pois) {
			if (poi.kind !== kind) continue;
			const d = (poi.x - p.x) ** 2 + (poi.z - p.z) ** 2;
			if (d < bestD) {
				bestD = d;
				best = poi;
			}
		}
		p.resetVitals();
		p.teleport(best.x + Math.sin(best.facing) * 2.5, best.z + Math.cos(best.facing) * 2.5, best.facing);
		this.bus.emit('playerRespawned', { where: best.name, reason });
	}

	/** Pulls an NPC driver out of a vehicle (implemented by the actor system). */
	ejectDriver(v: Vehicle, _carjacked: boolean): void {
		v.driver = null;
	}

	// --------------------------------------------------------------- explosions

	queueExplosion(x: number, y: number, z: number, radius: number, source: Attacker): void {
		this.explosions.push({ x, y, z, radius, source });
	}

	private processExplosions(): void {
		if (!this.explosions.length) return;
		const list = this.explosions;
		this.explosions = [];
		for (const e of list) {
			this.bus.emit('explosion', { x: e.x, y: e.y, z: e.z, radius: e.radius, source: e.source });
			this.bus.emit('shake', { amount: 0.9 });
			this.bus.emit('crime', { type: 'explosion', x: e.x, z: e.z, perpetrator: e.source });
			// Vehicles.
			this.vehicles.hash.query(e.x, e.z, e.radius + 3, (v, d2) => {
				const d = Math.sqrt(d2);
				const f = Math.max(0, 1 - d / (e.radius + 3));
				if (f <= 0) return;
				const nx = d > 0.1 ? (v.x - e.x) / d : 0;
				const nz = d > 0.1 ? (v.z - e.z) / d : 1;
				v.vx += nx * f * 12;
				v.vz += nz * f * 12;
				v.angVel += (this.rng.next() - 0.5) * f * 4;
				if (!v.destroyed) this.vehicles.damage(v, 700 * f, e.source);
			});
			// Player on foot.
			const p = this.player;
			if (p.state === 'onFoot') {
				const d = Math.hypot(p.x - e.x, p.z - e.z);
				if (d < e.radius) {
					const f = 1 - d / e.radius;
					this.damagePlayer(130 * f * f + 10 * f, e.source);
					const nx = d > 0.1 ? (p.x - e.x) / d : 0;
					const nz = d > 0.1 ? (p.z - e.z) / d : 1;
					p.vx += nx * 9 * f;
					p.vz += nz * 9 * f;
					p.vy = 5 * f;
					p.onGround = false;
				}
			}
			this.onExplosion?.(e.x, e.y, e.z, e.radius, e.source);
		}
	}

	/** Hook for actor damage (installed by the actor system). */
	onExplosion?: (x: number, y: number, z: number, radius: number, source: Attacker) => void;

	private updateDistrict(dt: number): void {
		this.districtTimer -= dt;
		if (this.districtTimer > 0) return;
		this.districtTimer = 0.5;
		const d = this.city.districtAt(this.player.px, this.player.pz);
		if (d !== this.currentDistrict) {
			this.currentDistrict = d;
			const def = DISTRICTS[d];
			this.bus.emit('districtEntered', { id: d, name: def.name, tagline: def.tagline });
		}
	}
}
