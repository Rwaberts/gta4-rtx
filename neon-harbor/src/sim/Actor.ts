// NPC humans: civilians, police officers, gang members, shop clerks and mission characters.
// Plain data + a pluggable brain; the ActorSystem owns movement, LOD and pooling.

import type { Cell } from '../world/CityLayout';
import type { CrimeType } from './events';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

export type ThreatKind = 'gunshot' | 'explosion' | 'crime' | 'aimedAt' | 'carDanger' | 'attacked';

export type ActorRole = 'civilian' | 'police' | 'gang' | 'mission' | 'clerk';
export type Faction = 'civilian' | 'police' | 'saltline' | 'velvet' | 'rustline' | 'crew';

export interface ActorBrain {
	/** Decision making; called at a tier-dependent rate with the accumulated dt. */
	think(a: Actor, w: World, dt: number): void;
	/** Debug label of the current state. */
	readonly state: string;
	dispose?(a: Actor): void;
	/** Event-driven reaction to threats (civilians, clerks). */
	react?(a: Actor, w: World, kind: ThreatKind, x: number, z: number, crime?: CrimeType): void;
}

let nextActorId = 1;

export class Actor {
	id = nextActorId++;
	active = false;
	role: ActorRole = 'civilian';
	faction: Faction = 'civilian';
	x = 0;
	y = 0;
	z = 0;
	vx = 0;
	vz = 0;
	heading = 0;
	speed = 0;
	radius = 0.35;
	health = 100;
	maxHealth = 100;
	armor = 0;
	dead = false;
	deadTime = 0;
	/** Knocked down (hit by car / explosion) for this many seconds. */
	knockdown = 0;

	// Appearance.
	shirt = 0x888888;
	pants = 0x333333;
	skin = 0xc8946a;
	hair = 0x2a1a10;
	hat = 0;
	sleeves = true;
	scale = 1;

	// Movement intent (written by brains, executed by ActorSystem).
	tx = 0;
	tz = 0;
	desiredSpeed = 0;
	/** When set, face this heading while stationary. */
	faceHeading: number | null = null;
	/** Arrived within this radius of (tx, tz). */
	arriveRadius = 0.6;

	brain: ActorBrain | null = null;
	thinkTimer = 0;
	thinkAccum = 0;
	/** 0 near (full), 1 mid, 2 far (coarse, not rendered). */
	tier = 0;
	distToPlayer = 0;

	vehicle: Vehicle | null = null;
	/** Hidden (e.g. inside a shop). */
	hidden = false;

	// Animation flags.
	animPhase = 0;
	aiming = false;
	phone = 0;
	handsUp = 0;
	crouch = 0;
	punch = 0;
	talking = false;

	// Combat.
	weapon: string | null = null;
	ammo = 0;
	clip = 0;
	fireCooldown = 0;
	reloadTimer = 0;
	accuracy = 0.5;
	/** Hostile towards the player. */
	hostile = false;
	target: 'player' | Actor | null = null;
	lastDamagedBy: 'player' | Actor | null = null;

	// Navigation (sidewalk loops).
	cell: Cell | null = null;
	corner = 0;
	dir: 1 | -1 = 1;

	// Perception.
	fear = 0;
	threatX = 0;
	threatZ = 0;
	/** Mission / scripted actors are never despawned by streaming. */
	persistent = false;
	tag = '';
	/** Show on the minimap with this colour. */
	blip: string | null = null;
	stateTime = 0;

	reset(): void {
		this.id = nextActorId++;
		this.active = false;
		this.role = 'civilian';
		this.faction = 'civilian';
		this.x = this.y = this.z = 0;
		this.vx = this.vz = 0;
		this.heading = 0;
		this.speed = 0;
		this.health = this.maxHealth = 100;
		this.armor = 0;
		this.dead = false;
		this.deadTime = 0;
		this.knockdown = 0;
		this.hat = 0;
		this.sleeves = true;
		this.scale = 1;
		this.tx = this.tz = 0;
		this.desiredSpeed = 0;
		this.faceHeading = null;
		this.arriveRadius = 0.6;
		this.brain?.dispose?.(this);
		this.brain = null;
		this.thinkTimer = 0;
		this.thinkAccum = 0;
		this.tier = 0;
		this.vehicle = null;
		this.hidden = false;
		this.animPhase = Math.random() * 6;
		this.aiming = false;
		this.phone = 0;
		this.handsUp = 0;
		this.crouch = 0;
		this.punch = 0;
		this.talking = false;
		this.weapon = null;
		this.ammo = 0;
		this.clip = 0;
		this.fireCooldown = 0;
		this.reloadTimer = 0;
		this.accuracy = 0.5;
		this.hostile = false;
		this.target = null;
		this.lastDamagedBy = null;
		this.cell = null;
		this.corner = 0;
		this.dir = 1;
		this.fear = 0;
		this.persistent = false;
		this.tag = '';
		this.blip = null;
		this.stateTime = 0;
	}

	get alive(): boolean {
		return this.active && !this.dead;
	}

	/** Can be seen / interacted with in the world (not inside a car or shop). */
	get onFoot(): boolean {
		return this.active && !this.vehicle && !this.hidden;
	}

	setTarget(x: number, z: number, speed: number, arrive = 0.6): void {
		this.tx = x;
		this.tz = z;
		this.desiredSpeed = speed;
		this.arriveRadius = arrive;
		this.faceHeading = null;
	}

	stop(face: number | null = null): void {
		this.tx = this.x;
		this.tz = this.z;
		this.desiredSpeed = 0;
		this.faceHeading = face;
	}

	atTarget(): boolean {
		return (this.tx - this.x) ** 2 + (this.tz - this.z) ** 2 <= this.arriveRadius * this.arriveRadius;
	}
}
