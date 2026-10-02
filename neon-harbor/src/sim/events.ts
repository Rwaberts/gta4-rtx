// Every cross-system event in the game. Systems publish on World.bus instead of calling each other.

import type { Actor } from './Actor';
import type { Vehicle } from './Vehicle';

export type NotifyKind = 'info' | 'good' | 'bad' | 'mission';
export type Attacker = 'player' | Actor | null;

export type CrimeType =
	| 'assault'
	| 'carjack'
	| 'vehicleTheft'
	| 'policeVehicleTheft'
	| 'gunfire'
	| 'shootCivilian'
	| 'murder'
	| 'assaultPolice'
	| 'killPolice'
	| 'vehicleDestruction'
	| 'hitPedestrian'
	| 'robbery'
	| 'resistArrest'
	| 'explosion';

export interface GameEvents {
	notify: { text: string; kind?: NotifyKind; duration?: number };
	districtEntered: { id: string; name: string; tagline: string };

	// Crime & police
	crime: { type: CrimeType; x: number; z: number; perpetrator: Attacker; victim?: Actor | null };
	/** A witness (civilian phone call or police radio) reports a crime to dispatch. */
	crimeReported: { type: CrimeType; x: number; z: number; reporter: 'civilian' | 'police'; witness: Actor | null };
	wantedChanged: { level: number; previous: number };
	policeSpotted: { x: number; z: number };
	/** Police radio chatter shown as subtitles. */
	radio: { text: string };

	// Combat
	gunshot: { x: number; y: number; z: number; shooter: Attacker; radius: number };
	shot: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; weapon: string; shooter: Attacker; hit: 'none' | 'world' | 'flesh' | 'metal'; nx: number; ny: number; nz: number };
	explosion: { x: number; y: number; z: number; radius: number; source: Attacker };
	actorDamaged: { actor: Actor; amount: number; attacker: Attacker };
	actorKilled: { actor: Actor; killer: Attacker; weapon: string };
	playerDamaged: { amount: number; attacker: Attacker };
	hitConfirm: { kill: boolean };
	recoil: { amount: number };
	aimedAtActor: { actor: Actor };
	playerDied: { cause: string };
	playerArrested: { by: Actor | null };
	playerRespawned: { where: string; reason: 'death' | 'arrest' };

	// Vehicles
	impact: { x: number; z: number; speed: number; vehicle: Vehicle; other: Vehicle | null };
	vehicleDestroyed: { vehicle: Vehicle; by: Attacker };
	playerEnteredVehicle: { vehicle: Vehicle; stolen: boolean };
	playerExitedVehicle: { vehicle: Vehicle };

	// Economy & progression
	moneyChanged: { cash: number; delta: number; reason: string };
	itemPurchased: { kind: string; id: string; price: number };

	// Missions
	missionStarted: { id: string; title: string };
	missionCompleted: { id: string; title: string; reward: number };
	missionFailed: { id: string; title: string; reason: string };
	objective: { text: string };
	dialogue: { speaker: string; text: string; duration: number };

	// Places
	interiorChanged: { id: string | null; name: string };
	openShop: { shop: string; poi: string };
	requestSave: { where: string };

	// Presentation
	sound: { id: string; x?: number; z?: number; volume?: number };
	shake: { amount: number };
}
