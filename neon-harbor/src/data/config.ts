// Global tuning values. Everything gameplay-relevant that is a "magic number" lives here or
// in the other data/ modules so it can be tweaked without touching system code.

export const WORLD = {
	seed: 0x4e48_2026,
	/** Road grid spacing (centre line to centre line). */
	cell: 100,
	roadHalf: 8,
	sidewalk: 4,
	laneOffset: 3.4,
	parkingOffset: 6.4,
	/** Road line indices: vertical roads at x = i * cell, horizontal roads at z = j * cell. */
	gridMinX: -14,
	gridMaxX: 13,
	gridMinZ: -14,
	gridMaxZ: 10,
	landMinX: -1470,
	landMaxX: 1362,
	landMinZ: -1470,
	landMaxZ: 1170,
	waterLevel: -0.7,
	chunkSize: 400,
	/** Interiors live far away from the city so they never overlap streamed chunks. */
	interiorOrigin: { x: 4000, z: 4000 },
} as const;

export const SIM = {
	fixedDt: 1 / 60,
	maxSubSteps: 5,
	gravity: -22,
	/** Actor simulation tiers by distance from the player (metres). */
	actorFullRadius: 70,
	actorMidRadius: 160,
	actorDespawnRadius: 260,
	pedSpawnMin: 28,
	pedSpawnMax: 170,
	trafficSpawnMin: 110,
	trafficSpawnMax: 240,
	trafficDespawn: 320,
	parkedSpawnMax: 140,
	parkedDespawn: 220,
	maxActors: 240,
	maxRenderedActors: 200,
	maxVehicles: 72,
} as const;

export const PLAYER = {
	radius: 0.38,
	height: 1.8,
	walkSpeed: 2.4,
	runSpeed: 5.6,
	sprintSpeed: 8.2,
	crouchSpeed: 1.5,
	accel: 30,
	airControl: 0.25,
	jumpVelocity: 7.2,
	maxHealth: 100,
	maxArmor: 100,
	maxStamina: 100,
	staminaDrain: 16,
	staminaRegen: 22,
	staminaRegenDelay: 0.8,
	swimSpeed: 2.2,
	vehicleEnterRange: 3.6,
	interactRange: 2.4,
} as const;

export const CAMERA = {
	footDistance: 4.6,
	footHeight: 1.65,
	aimDistance: 2.4,
	aimShoulder: 0.65,
	minPitch: -1.1,
	maxPitch: 1.25,
	baseFov: 65,
	aimFov: 52,
	vehicleFovBoost: 14,
} as const;
