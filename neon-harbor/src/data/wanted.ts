// Wanted system tuning: heat per crime and the police response for each level.

import type { CrimeType } from '../sim/events';

/** Heat added when a crime is witnessed (by police) or reported (by civilians). */
export const CRIME_HEAT: Record<CrimeType, number> = {
	assault: 25,
	carjack: 30,
	vehicleTheft: 18,
	policeVehicleTheft: 140,
	gunfire: 30,
	shootCivilian: 70,
	murder: 120,
	assaultPolice: 140,
	killPolice: 280,
	vehicleDestruction: 55,
	hitPedestrian: 40,
	robbery: 280,
	resistArrest: 90,
	explosion: 70,
};

/** Minimum heat for levels 1..5 (index = level). */
export const HEAT_THRESHOLDS = [0, 20, 100, 260, 540, 950];

export type LethalPolicy = 'never' | 'ifArmed' | 'always';

export interface WantedLevelDef {
	level: number;
	/** Police cars actively responding. */
	units: number;
	officersPerCar: number;
	lethal: LethalPolicy;
	/** Pursuing cars may ram the player's vehicle. */
	ram: boolean;
	roadblocks: number;
	/** Tactical response vans with rifles. */
	heavy: number;
	helicopter: boolean;
	/** Seconds without being seen before the search is called off. */
	searchTime: number;
	/** Radius around the last known position that units sweep. */
	searchRadius: number;
	accuracy: number;
	/** Delay before the first unit arrives after a report (seconds). */
	responseDelay: number;
	label: string;
}

export const WANTED_LEVELS: WantedLevelDef[] = [
	{ level: 0, units: 0, officersPerCar: 0, lethal: 'never', ram: false, roadblocks: 0, heavy: 0, helicopter: false, searchTime: 0, searchRadius: 0, accuracy: 0, responseDelay: 0, label: 'Clean' },
	{ level: 1, units: 1, officersPerCar: 2, lethal: 'never', ram: false, roadblocks: 0, heavy: 0, helicopter: false, searchTime: 14, searchRadius: 90, accuracy: 0.35, responseDelay: 6, label: 'Person of interest' },
	{ level: 2, units: 2, officersPerCar: 2, lethal: 'ifArmed', ram: false, roadblocks: 0, heavy: 0, helicopter: false, searchTime: 20, searchRadius: 140, accuracy: 0.42, responseDelay: 4, label: 'Active pursuit' },
	{ level: 3, units: 4, officersPerCar: 2, lethal: 'ifArmed', ram: true, roadblocks: 0, heavy: 0, helicopter: false, searchTime: 26, searchRadius: 190, accuracy: 0.5, responseDelay: 3, label: 'Multiple units' },
	{ level: 4, units: 5, officersPerCar: 2, lethal: 'always', ram: true, roadblocks: 2, heavy: 1, helicopter: false, searchTime: 32, searchRadius: 240, accuracy: 0.58, responseDelay: 2, label: 'Roadblocks & tactical' },
	{ level: 5, units: 6, officersPerCar: 2, lethal: 'always', ram: true, roadblocks: 3, heavy: 2, helicopter: true, searchTime: 40, searchRadius: 300, accuracy: 0.65, responseDelay: 1, label: 'Citywide response' },
];

/** Ambient patrol cars when the player is not wanted. */
export const PATROL_CARS = 2;
/** Ambient officers walking a beat in busy districts. */
export const FOOT_PATROLS = 2;
/** Seconds of continuous arrest contact needed to cuff the player. */
export const ARREST_TIME = 3;
/** Fine charged when arrested, per wanted level. */
export const ARREST_FINE = [0, 250, 600, 1200, 2500, 5000];
/** Hospital bill on death. */
export const HOSPITAL_BILL = 400;

export const RADIO_LINES = {
	report: ['Dispatch: reports of a disturbance near {place}.', 'Dispatch: caller reports a suspect near {place}.', 'All units, possible 10-31 near {place}.'],
	spotted: ['Unit {unit}: I have eyes on the suspect, {place}.', 'Unit {unit}: suspect sighted, moving in.', 'Unit {unit}: visual confirmed near {place}.'],
	lost: ['Unit {unit}: lost visual. Starting a sweep of {place}.', 'All units: suspect last seen near {place}. Set up a perimeter.'],
	escalate: ['Dispatch: suspect is armed and dangerous. Additional units en route.', 'Dispatch: upgrading response. All available units to {place}.'],
	cleared: ['Dispatch: search called off. Units return to patrol.', 'Dispatch: no sign of the suspect. Standing down.'],
	roadblock: ['Unit {unit}: roadblock in position on {place}.'],
	heli: ['Air One: overhead {place}, spotlight up.'],
};
