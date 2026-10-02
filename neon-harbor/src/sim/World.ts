// Simulation root: owns all gameplay state and runs systems in a fixed order.
// Contains no rendering or DOM code so it can run headless in unit tests.

import { EventBus } from '../core/EventBus';
import { Random } from '../core/Random';
import { WORLD } from '../data/config';
import { DISTRICTS, type DistrictId } from '../data/districts';
import { generateCity, type CityLayout } from '../world/CityLayout';
import { StaticCollision } from '../world/StaticCollision';
import { RoadNetwork } from '../world/RoadNetwork';
import { ActorSystem } from './ActorSystem';
import { CombatSystem } from './CombatSystem';
import { PoliceSystem } from './PoliceSystem';
import { WantedSystem } from './WantedSystem';
import { Economy } from './Economy';
import { InteractionSystem } from './InteractionSystem';
import { InteriorSystem } from './InteriorSystem';
import { MissionSystem } from './MissionSystem';
import { STARTING_CASH } from '../data/economy';
import { ARREST_FINE, HOSPITAL_BILL } from '../data/wanted';
import { ShopSystem } from './ShopSystem';
import { MemoryStorage, SaveSystem, type KeyValueStorage } from './SaveSystem';
import { Weather } from './Weather';
import { AmbientEvents } from './AmbientEvents';
import type { Actor } from './Actor';
import { Clock } from './Clock';
import { TrafficSystem } from './TrafficSystem';
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
	readonly roads: RoadNetwork;
	readonly clock = new Clock(9);
	readonly actors: ActorSystem;
	readonly traffic: TrafficSystem;
	readonly combat: CombatSystem;
	readonly wanted: WantedSystem;
	readonly police: PoliceSystem;
	readonly economy: Economy;
	readonly interactions: InteractionSystem;
	readonly interiors: InteriorSystem;
	readonly missions: MissionSystem;
	readonly shops: ShopSystem;
	readonly saves: SaveSystem;
	readonly weather: Weather;
	readonly ambient: AmbientEvents;
	/**
	 * Aim ray (normally the camera's centre ray). `skip` ignores hits between camera and player.
	 * When `fromCamera` is false (headless) it is derived from the player's heading each step.
	 */
	readonly aim = { ox: 0, oy: 1.5, oz: 0, dx: 0, dy: 0, dz: 1, skip: 0, fromCamera: false };
	/** Camera position and look direction (spawners avoid popping objects into view). */
	readonly view = { x: 0, z: 0, dirX: 0, dirZ: 1 };
	/** Simulation seconds since start. */
	time = 0;
	/** 0..1 road wetness (set by weather). */
	wetness = 0;
	currentDistrict: DistrictId | null = null;
	private districtTimer = 0;
	private explosions: PendingExplosion[] = [];
	private deathTimer = 0;
	private arrestLevel = 0;
	/** Optional hooks installed by systems added in later phases. */
	onVehicleDespawn?: (v: Vehicle) => void;

	constructor(seed: number = WORLD.seed, storage: KeyValueStorage = new MemoryStorage()) {
		this.rng = new Random(seed ^ 0xabcdef);
		this.city = generateCity(seed);
		this.collision = new StaticCollision(16);
		this.city.forEachSolid((a, b, c, d, e, f) => this.collision.add(a, b, c, d, e, f));
		this.roads = new RoadNetwork(this.city);
		this.vehicles = new VehicleSystem(this);
		this.actors = new ActorSystem(this);
		this.traffic = new TrafficSystem(this);
		this.combat = new CombatSystem(this);
		this.wanted = new WantedSystem(this);
		this.police = new PoliceSystem(this);
		this.economy = new Economy(this, STARTING_CASH);
		this.interactions = new InteractionSystem(this);
		this.interiors = new InteriorSystem(this);
		this.missions = new MissionSystem(this);
		this.shops = new ShopSystem(this);
		this.weather = new Weather(this);
		this.ambient = new AmbientEvents(this);
		this.saves = new SaveSystem(this, storage);
		const home = this.city.poi('safehouse')!;
		this.player.teleport(home.x + Math.sin(home.facing) * 3, home.z + Math.cos(home.facing) * 3, home.facing);
	}

	step(dt: number): void {
		this.time += dt;
		this.clock.update(dt);
		this.weather.update(dt);
		this.processExplosions();
		const p = this.player;
		if (!this.aim.fromCamera) this.aimFromHeading();
		this.combat.preStep();
		if (p.state === 'onFoot') p.updateOnFoot(dt, this.controls, this);
		this.vehicles.step(dt);
		this.combat.step(dt);
		this.actors.step(dt);
		this.traffic.step(dt);
		this.police.step(dt);
		this.interactions.step();
		this.missions.update(dt);
		this.ambient.step(dt);
		this.shops.update();
		this.saves.stats.playTime += dt;
		p.updateVitals(dt);
		this.updateDeath(dt);
		this.updateDistrict(dt);
		clearEdges(this.controls);
	}

	private aimFromHeading(): void {
		const p = this.player;
		const a = this.aim;
		const h = this.controls.aim ? this.controls.camYaw : p.heading;
		const pitch = this.controls.camPitch;
		a.ox = p.px;
		a.oy = p.y + 1.5;
		a.oz = p.pz;
		a.dx = Math.sin(h) * Math.cos(pitch);
		a.dy = -Math.sin(pitch);
		a.dz = Math.cos(h) * Math.cos(pitch);
		a.skip = 0.5;
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

	/** Officers finished cuffing the player. */
	arrestPlayer(by: Actor | null): void {
		const p = this.player;
		if (!p.alive || p.state === 'arrested') return;
		if (p.state === 'driving' && p.vehicle) this.vehicles.ejectPlayer(p.vehicle, false);
		this.arrestLevel = this.wanted.level;
		p.state = 'arrested';
		p.vx = p.vz = 0;
		p.aiming = false;
		this.deathTimer = 0;
		this.bus.emit('playerArrested', { by });
	}

	private updateDeath(dt: number): void {
		const p = this.player;
		if (p.state !== 'dead' && p.state !== 'arrested') return;
		this.deathTimer += dt;
		if (this.deathTimer > (p.state === 'dead' ? 4.5 : 3.5)) this.respawn(p.state === 'dead' ? 'death' : 'arrest');
	}

	/** Respawns at the nearest hospital (death) or police precinct (arrest). */
	respawn(reason: 'death' | 'arrest'): void {
		const p = this.player;
		const kind = reason === 'death' ? 'hospital' : 'police';
		const inside = this.interiors.current;
		const fromX = inside ? inside.poi.x : p.x;
		const fromZ = inside ? inside.poi.z : p.z;
		let best = this.city.pois.find((x) => x.kind === kind)!;
		let bestD = Infinity;
		for (const poi of this.city.pois) {
			if (poi.kind !== kind) continue;
			const d = (poi.x - fromX) ** 2 + (poi.z - fromZ) ** 2;
			if (d < bestD) {
				bestD = d;
				best = poi;
			}
		}
		this.interiors.leaveSilently();
		p.resetVitals();
		p.teleport(best.x + Math.sin(best.facing) * 2.5, best.z + Math.cos(best.facing) * 2.5, best.facing);
		if (reason === 'death') {
			const bill = this.economy.charge(HOSPITAL_BILL, 'Hospital bill');
			this.bus.emit('notify', { text: `${best.name} patched you up. Bill: $${bill}.`, kind: 'bad', duration: 5 });
		} else {
			const fine = this.economy.charge(ARREST_FINE[this.arrestLevel] ?? 500, 'Bail');
			this.combat.inventory.clear();
			this.bus.emit('notify', { text: `Released on $${fine} bail. Your weapons were confiscated.`, kind: 'bad', duration: 5 });
		}
		this.bus.emit('playerRespawned', { where: best.name, reason });
	}

	/** Pulls an NPC driver out of a vehicle. */
	ejectDriver(v: Vehicle, carjacked: boolean): void {
		this.actors.ejectDriver(v, carjacked);
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
		if (this.districtTimer > 0 || this.interiors.current) return;
		this.districtTimer = 0.5;
		const d = this.city.districtAt(this.player.px, this.player.pz);
		if (d !== this.currentDistrict) {
			this.currentDistrict = d;
			const def = DISTRICTS[d];
			this.bus.emit('districtEntered', { id: d, name: def.name, tagline: def.tagline });
		}
	}
}
