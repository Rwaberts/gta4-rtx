// District definitions: architecture, density, palette and daily schedule.
// All of these are original, fictional districts of Neon Harbor.

export type DistrictId =
	| 'downtown'
	| 'financial'
	| 'industrial'
	| 'beachfront'
	| 'residential'
	| 'harbor'
	| 'airport'
	| 'rural';

/** Facade style used by the window shader. */
export const WindowStyle = {
	None: 0,
	Office: 1,
	Residential: 2,
	Glass: 3,
	Industrial: 4,
} as const;
export type WindowStyle = (typeof WindowStyle)[keyof typeof WindowStyle];

export interface DistrictDef {
	id: DistrictId;
	name: string;
	/** Minimap / full map tint. */
	mapColor: string;
	/** Lot ground colour (sidewalk / lawn / sand / concrete). */
	groundColor: number;
	buildingPalette: number[];
	windowStyle: WindowStyle;
	/** 0..1 multipliers applied on top of the global density settings. */
	trafficDensity: number;
	pedDensity: number;
	parkedDensity: number;
	/** Pedestrian density multiplier per hour (0..23). */
	schedule: number[];
	/** Relative weights of civilian activities. */
	activities: { wander: number; talk: number; shop: number; idle: number };
	/** Weighted vehicle archetypes for traffic in this district. */
	vehicleMix: Record<string, number>;
	/** Short flavour line shown when entering the district. */
	tagline: string;
}

// Hour-by-hour activity curves (index = hour).
const OFFICE_HOURS = [0.1, 0.05, 0.05, 0.05, 0.1, 0.2, 0.5, 0.9, 1, 1, 0.9, 1, 1, 1, 0.9, 0.9, 1, 1, 0.8, 0.5, 0.35, 0.25, 0.2, 0.15];
const NIGHTLIFE = [0.7, 0.6, 0.4, 0.2, 0.1, 0.1, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1, 1, 1, 1, 0.9, 0.8];
const BEACH = [0.2, 0.15, 0.1, 0.05, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 1, 1, 1, 1, 1, 1, 0.9, 0.9, 0.8, 0.8, 0.7, 0.5, 0.4, 0.3];
const HOME = [0.1, 0.05, 0.05, 0.05, 0.1, 0.3, 0.6, 0.8, 0.6, 0.5, 0.5, 0.6, 0.6, 0.6, 0.6, 0.7, 0.8, 0.9, 0.9, 0.8, 0.6, 0.4, 0.25, 0.15];
const SHIFT = [0.3, 0.3, 0.3, 0.3, 0.4, 0.6, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.9, 0.7, 0.5, 0.4, 0.35, 0.3, 0.3];
const QUIET = [0.05, 0.05, 0.05, 0.05, 0.1, 0.3, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.05];

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
	downtown: {
		id: 'downtown',
		name: 'Downtown',
		mapColor: '#3b3f63',
		groundColor: 0x8e8c88,
		buildingPalette: [0x9c8f86, 0x7d7a80, 0xb3a690, 0x6f6a72, 0xa89686, 0x8a8f9c, 0xc2b49c, 0x5f6470],
		windowStyle: WindowStyle.Office,
		trafficDensity: 1,
		pedDensity: 1,
		parkedDensity: 0.5,
		schedule: NIGHTLIFE,
		activities: { wander: 6, talk: 2, shop: 3, idle: 1 },
		vehicleMix: { sedan: 4, hatch: 3, taxi: 3, van: 1, coupe: 1, bus: 0.6 },
		tagline: 'Neon signs, late nights and old money turning new.',
	},
	financial: {
		id: 'financial',
		name: 'Meridian Financial District',
		mapColor: '#2d4a6b',
		groundColor: 0xa4a7ab,
		buildingPalette: [0x6f8fa8, 0x4f6f8c, 0x8aa6b8, 0x3d5468, 0x9fb4c0, 0x5c7488],
		windowStyle: WindowStyle.Glass,
		trafficDensity: 0.9,
		pedDensity: 0.9,
		parkedDensity: 0.2,
		schedule: OFFICE_HOURS,
		activities: { wander: 7, talk: 2, shop: 1, idle: 1 },
		vehicleMix: { sedan: 3, coupe: 2, limo: 1, taxi: 3, suv: 2 },
		tagline: 'Glass towers where the real crimes are legal.',
	},
	industrial: {
		id: 'industrial',
		name: 'Rustline Industrial Zone',
		mapColor: '#5a4a36',
		groundColor: 0x77736b,
		buildingPalette: [0x7a6a58, 0x8b8178, 0x5c5a55, 0x9a7d5e, 0x6c6f73, 0x857560],
		windowStyle: WindowStyle.Industrial,
		trafficDensity: 0.6,
		pedDensity: 0.35,
		parkedDensity: 0.3,
		schedule: SHIFT,
		activities: { wander: 5, talk: 2, shop: 0.5, idle: 2 },
		vehicleMix: { truck: 4, van: 3, pickup: 3, sedan: 1 },
		tagline: 'Smokestacks, chain-link and nobody asking questions.',
	},
	beachfront: {
		id: 'beachfront',
		name: 'Coral Mile Beachfront',
		mapColor: '#2f6f73',
		groundColor: 0xd9cfae,
		buildingPalette: [0xf2c6b4, 0xb8e0d2, 0xf6e3a1, 0xe8a9a2, 0xa8d0e6, 0xf0f0e0, 0xd8b8e8],
		windowStyle: WindowStyle.Residential,
		trafficDensity: 0.7,
		pedDensity: 1,
		parkedDensity: 0.45,
		schedule: BEACH,
		activities: { wander: 6, talk: 3, shop: 2, idle: 2 },
		vehicleMix: { coupe: 3, hatch: 2, sedan: 2, taxi: 1, pickup: 1, sport: 1 },
		tagline: 'Sun, surf and the Coral Mile boardwalk.',
	},
	residential: {
		id: 'residential',
		name: 'Westbrook Suburbs',
		mapColor: '#3d5a3a',
		groundColor: 0x6f8f55,
		buildingPalette: [0xd8cfc0, 0xc9b79c, 0xa8b8c8, 0xe0d6b8, 0xb89a84, 0xc8c8b8, 0x9fb59a],
		windowStyle: WindowStyle.Residential,
		trafficDensity: 0.45,
		pedDensity: 0.5,
		parkedDensity: 0.7,
		schedule: HOME,
		activities: { wander: 5, talk: 3, shop: 1, idle: 2 },
		vehicleMix: { hatch: 3, sedan: 3, suv: 3, pickup: 1, van: 1 },
		tagline: 'Lawns, cul-de-sacs and secrets behind the curtains.',
	},
	harbor: {
		id: 'harbor',
		name: 'Saltline Harbor',
		mapColor: '#2a4a5a',
		groundColor: 0x6e7072,
		buildingPalette: [0x6a7378, 0x7d6b5a, 0x56606a, 0x8a7d6a, 0x4f5a60],
		windowStyle: WindowStyle.Industrial,
		trafficDensity: 0.5,
		pedDensity: 0.3,
		parkedDensity: 0.25,
		schedule: SHIFT,
		activities: { wander: 5, talk: 2, shop: 0.2, idle: 3 },
		vehicleMix: { truck: 5, van: 2, pickup: 2 },
		tagline: 'Every container has a story. Most of them are lies.',
	},
	airport: {
		id: 'airport',
		name: 'Harbor Point Airfield',
		mapColor: '#4a4a58',
		groundColor: 0x8a8d84,
		buildingPalette: [0xb8bcc0, 0x9aa0a6, 0xd0d4d8, 0x7a8088],
		windowStyle: WindowStyle.Glass,
		trafficDensity: 0.4,
		pedDensity: 0.25,
		parkedDensity: 0.4,
		schedule: SHIFT,
		activities: { wander: 6, talk: 1, shop: 1, idle: 2 },
		vehicleMix: { taxi: 4, van: 2, sedan: 2, bus: 1 },
		tagline: 'Arrivals, departures and quiet cargo.',
	},
	rural: {
		id: 'rural',
		name: 'Greywater Outskirts',
		mapColor: '#4a5a32',
		groundColor: 0x7d8f4e,
		buildingPalette: [0x9a5a48, 0xb8a888, 0x8a7a68, 0xc8bca0, 0x6a5a4a],
		windowStyle: WindowStyle.Residential,
		trafficDensity: 0.25,
		pedDensity: 0.12,
		parkedDensity: 0.3,
		schedule: QUIET,
		activities: { wander: 4, talk: 2, shop: 0.2, idle: 4 },
		vehicleMix: { pickup: 5, truck: 2, suv: 2, hatch: 1 },
		tagline: 'Long roads, open fields and nowhere to hide.',
	},
};

export const DISTRICT_IDS = Object.keys(DISTRICTS) as DistrictId[];

/** Weighted Voronoi seeds (x, z, weight). Larger weight = larger region. */
export const DISTRICT_SEEDS: Array<{ id: DistrictId; x: number; z: number; w: number }> = [
	{ id: 'financial', x: 0, z: -470, w: 1 },
	{ id: 'downtown', x: 20, z: 160, w: 1.15 },
	{ id: 'beachfront', x: -350, z: 960, w: 0.75 },
	{ id: 'beachfront', x: 380, z: 960, w: 0.75 },
	{ id: 'residential', x: -950, z: 150, w: 1 },
	{ id: 'residential', x: -880, z: 700, w: 0.9 },
	{ id: 'residential', x: -650, z: -520, w: 0.85 },
	{ id: 'industrial', x: 820, z: -300, w: 1 },
	{ id: 'harbor', x: 1050, z: 620, w: 1 },
	{ id: 'rural', x: -1000, z: -1150, w: 1.1 },
	{ id: 'rural', x: -200, z: -1250, w: 1 },
];

/** Airfield is an explicit rectangle so the runway always fits. */
export const AIRPORT_RECT = { minX: 500, maxX: 1300, minZ: -1400, maxZ: -800 };
