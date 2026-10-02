// Vehicle archetypes. All makes and models are original and fictional.
// Physics values are arcade-tuned: speeds in m/s, accelerations in m/s^2.

export type BodyStyle = 'hatch' | 'sedan' | 'coupe' | 'suv' | 'pickup' | 'van' | 'truck' | 'bus' | 'limo';

export interface VehicleDef {
	id: string;
	name: string;
	make: string;
	style: BodyStyle;
	length: number;
	width: number;
	height: number;
	mass: number;
	maxSpeed: number;
	accel: number;
	brake: number;
	reverseSpeed: number;
	/** Max front wheel angle (radians). */
	steer: number;
	/** Lateral grip (1/s); higher = less sliding. */
	grip: number;
	/** Lateral grip while the handbrake is held. */
	driftGrip: number;
	health: number;
	price: number;
	colors: number[];
	police?: boolean;
	/** Can be bought at Coastline Motors. */
	forSale?: boolean;
	wheelRadius: number;
}

const BASIC = [0xd8d8d8, 0x2a2a2e, 0x8a1c1c, 0x1c3c8a, 0x6a6a70, 0xe8e0c8, 0x2a5a3a, 0x7a5a3a, 0x9ab0c0];
const BRIGHT = [0xe83a3a, 0xf0c020, 0x2ac8e8, 0xf05ac8, 0x3ae86a, 0xf08a2a, 0xffffff, 0x101010];

export const VEHICLES: Record<string, VehicleDef> = {
	hatch: { id: 'hatch', name: 'Brisa', make: 'Kova', style: 'hatch', length: 3.9, width: 1.75, height: 1.45, mass: 1050, maxSpeed: 41, accel: 7.5, brake: 15, reverseSpeed: 8, steer: 0.62, grip: 9, driftGrip: 1.6, health: 800, price: 9000, colors: BASIC, forSale: true, wheelRadius: 0.32 },
	sedan: { id: 'sedan', name: 'Corvane', make: 'Aldine', style: 'sedan', length: 4.7, width: 1.85, height: 1.45, mass: 1400, maxSpeed: 46, accel: 7.8, brake: 15, reverseSpeed: 8, steer: 0.58, grip: 8.5, driftGrip: 1.5, health: 1000, price: 16000, colors: BASIC, forSale: true, wheelRadius: 0.34 },
	taxi: { id: 'taxi', name: 'Corvane Cab', make: 'Aldine', style: 'sedan', length: 4.7, width: 1.85, height: 1.45, mass: 1400, maxSpeed: 44, accel: 7.4, brake: 15, reverseSpeed: 8, steer: 0.58, grip: 8.5, driftGrip: 1.5, health: 1000, price: 0, colors: [0x9ae83a], wheelRadius: 0.34 },
	coupe: { id: 'coupe', name: 'Vela GT', make: 'Marisol', style: 'coupe', length: 4.4, width: 1.85, height: 1.3, mass: 1300, maxSpeed: 52, accel: 9.5, brake: 17, reverseSpeed: 8, steer: 0.56, grip: 9.5, driftGrip: 1.3, health: 900, price: 34000, colors: BRIGHT, forSale: true, wheelRadius: 0.33 },
	sport: { id: 'sport', name: 'Raptora S', make: 'Marisol', style: 'coupe', length: 4.5, width: 1.95, height: 1.18, mass: 1250, maxSpeed: 62, accel: 12, brake: 19, reverseSpeed: 8, steer: 0.52, grip: 10.5, driftGrip: 1.4, health: 850, price: 78000, colors: BRIGHT, forSale: true, wheelRadius: 0.34 },
	muscle: { id: 'muscle', name: 'Thunderjack', make: 'Brannock', style: 'coupe', length: 4.9, width: 1.95, height: 1.3, mass: 1550, maxSpeed: 55, accel: 10.5, brake: 14, reverseSpeed: 8, steer: 0.5, grip: 7.5, driftGrip: 1.2, health: 1100, price: 42000, colors: BRIGHT, forSale: true, wheelRadius: 0.36 },
	suv: { id: 'suv', name: 'Ridgeback', make: 'Kova', style: 'suv', length: 4.8, width: 2.0, height: 1.8, mass: 2000, maxSpeed: 43, accel: 7, brake: 13, reverseSpeed: 8, steer: 0.55, grip: 8, driftGrip: 1.6, health: 1300, price: 26000, colors: BASIC, forSale: true, wheelRadius: 0.4 },
	pickup: { id: 'pickup', name: 'Mesa Hauler', make: 'Brannock', style: 'pickup', length: 5.3, width: 2.0, height: 1.85, mass: 2100, maxSpeed: 42, accel: 6.8, brake: 13, reverseSpeed: 8, steer: 0.52, grip: 7.5, driftGrip: 1.6, health: 1400, price: 21000, colors: BASIC, forSale: true, wheelRadius: 0.42 },
	van: { id: 'van', name: 'Courier', make: 'Aldine', style: 'van', length: 5.2, width: 2.05, height: 2.3, mass: 2300, maxSpeed: 37, accel: 5.5, brake: 12, reverseSpeed: 7, steer: 0.52, grip: 7, driftGrip: 1.8, health: 1400, price: 18000, colors: [0xe8e8e8, 0xc8c8c0, 0x2a4a7a, 0x7a2a2a], forSale: true, wheelRadius: 0.38 },
	truck: { id: 'truck', name: 'Dockmaster', make: 'Brannock', style: 'truck', length: 7.6, width: 2.4, height: 3.2, mass: 6500, maxSpeed: 31, accel: 4, brake: 9, reverseSpeed: 6, steer: 0.48, grip: 7, driftGrip: 2.5, health: 2200, price: 0, colors: [0xd8d8d8, 0x3a6a9a, 0xb84a2a, 0x4a7a3a], wheelRadius: 0.5 },
	bus: { id: 'bus', name: 'Harbor Transit', make: 'Civitas', style: 'bus', length: 11, width: 2.55, height: 3.1, mass: 11000, maxSpeed: 27, accel: 3, brake: 8, reverseSpeed: 5, steer: 0.5, grip: 7, driftGrip: 3, health: 3000, price: 0, colors: [0x2ab4a8], wheelRadius: 0.52 },
	limo: { id: 'limo', name: 'Sovereign', make: 'Aldine', style: 'limo', length: 6.6, width: 1.95, height: 1.45, mass: 2400, maxSpeed: 44, accel: 6, brake: 12, reverseSpeed: 7, steer: 0.5, grip: 8, driftGrip: 1.6, health: 1600, price: 0, colors: [0x101012, 0xf0f0f0], wheelRadius: 0.36 },
	police: { id: 'police', name: 'Interceptor', make: 'NHPD', style: 'sedan', length: 4.9, width: 1.95, height: 1.5, mass: 1650, maxSpeed: 56, accel: 10, brake: 17, reverseSpeed: 9, steer: 0.58, grip: 9.5, driftGrip: 1.5, health: 1400, price: 0, colors: [0x1a2238], police: true, wheelRadius: 0.35 },
	swat: { id: 'swat', name: 'Tactical Response', make: 'NHPD', style: 'van', length: 5.8, width: 2.25, height: 2.5, mass: 4200, maxSpeed: 40, accel: 6.5, brake: 12, reverseSpeed: 7, steer: 0.5, grip: 8, driftGrip: 2, health: 2600, price: 0, colors: [0x20242a], police: true, wheelRadius: 0.45 },
};

export function vehicleDef(id: string): VehicleDef {
	const d = VEHICLES[id];
	if (!d) throw new Error('Unknown vehicle ' + id);
	return d;
}
