// Vehicle state and arcade physics (bicycle model with lateral grip and handbrake drift).
// Collision response lives in VehicleSystem; this class only integrates one body.

import { approach, clamp } from '../core/math';
import type { VehicleDef } from '../data/vehicles';
import type { Actor } from './Actor';

export type VehicleRole = 'parked' | 'traffic' | 'police' | 'mission' | 'owned' | 'abandoned';
export type Driver = 'player' | Actor | null;

/** Pluggable driving brain (traffic AI, police AI, mission scripts). */
export interface VehicleBrain {
	update(v: Vehicle, dt: number): void;
	/** Called when the brain is detached (driver left, vehicle despawned). */
	dispose?(v: Vehicle): void;
}

let nextVehicleId = 1;

export class Vehicle {
	id = nextVehicleId++;
	def!: VehicleDef;
	color = 0xffffff;
	role: VehicleRole = 'parked';
	x = 0;
	y = 0;
	z = 0;
	vx = 0;
	vz = 0;
	vy = 0;
	heading = 0;
	angVel = 0;
	/** Current front-wheel angle (positive = turning left / heading increasing). */
	steerAngle = 0;
	// Control inputs written by the driver each step.
	throttle = 0;
	brake = 0;
	steer = 0;
	handbrake = false;
	horn = false;
	health = 1000;
	destroyed = false;
	/** Seconds until a burning vehicle explodes (<0 = not burning). */
	burnTimer = -1;
	sinking = false;
	sinkTime = 0;
	driver: Driver = null;
	passengers: Actor[] = [];
	brain: VehicleBrain | null = null;
	sirenOn = false;
	lightsOn = false;
	/** Mission/owned vehicles are never despawned by streaming. */
	persistent = false;
	/** Who last damaged it (crime attribution). */
	lastDamagedBy: 'player' | Actor | null = null;
	/** Seconds since spawned / last seen near the player (despawn heuristics). */
	age = 0;
	tag = '';
	/** Visual helpers. */
	wheelSpin = 0;
	braking = false;
	reversing = false;
	impactCooldown = 0;
	stuckTime = 0;

	get forwardX(): number {
		return Math.sin(this.heading);
	}

	get forwardZ(): number {
		return Math.cos(this.heading);
	}

	/** Signed forward speed (m/s). */
	get forwardSpeed(): number {
		return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
	}

	get speed(): number {
		return Math.hypot(this.vx, this.vz);
	}

	get halfLength(): number {
		return this.def.length * 0.5;
	}

	get halfWidth(): number {
		return this.def.width * 0.5;
	}

	get mass(): number {
		return this.def.mass;
	}

	get inertia(): number {
		const d = this.def;
		return (d.mass * (d.length * d.length + d.width * d.width)) / 12;
	}

	get burning(): boolean {
		return this.burnTimer >= 0;
	}

	get healthFraction(): number {
		return clamp(this.health / this.def.health, 0, 1);
	}

	init(def: VehicleDef, x: number, z: number, heading: number, color: number): this {
		this.def = def;
		this.color = color;
		this.x = x;
		this.z = z;
		this.y = 0;
		this.heading = heading;
		this.vx = this.vz = this.vy = 0;
		this.angVel = 0;
		this.steerAngle = 0;
		this.throttle = this.brake = this.steer = 0;
		this.handbrake = false;
		this.horn = false;
		this.health = def.health;
		this.destroyed = false;
		this.burnTimer = -1;
		this.sinking = false;
		this.sinkTime = 0;
		this.driver = null;
		this.passengers.length = 0;
		this.brain = null;
		this.sirenOn = false;
		this.lightsOn = false;
		this.persistent = false;
		this.lastDamagedBy = null;
		this.age = 0;
		this.tag = '';
		this.wheelSpin = 0;
		this.braking = false;
		this.reversing = false;
		this.impactCooldown = 0;
		this.stuckTime = 0;
		this.role = 'parked';
		return this;
	}

	/** Point beside the driver door (left side in this right-hand-traffic city). */
	doorPoint(side: -1 | 1 = -1): { x: number; z: number } {
		const rx = -Math.cos(this.heading);
		const rz = Math.sin(this.heading);
		const off = this.halfWidth + 0.7;
		return { x: this.x + rx * off * side + this.forwardX * 0.4, z: this.z + rz * off * side + this.forwardZ * 0.4 };
	}

	/** Integrates one physics step. `gripScale` < 1 on wet roads. */
	integrate(dt: number, gripScale = 1): void {
		const d = this.def;
		const fx = Math.sin(this.heading);
		const fz = Math.cos(this.heading);
		const rx = -fz;
		const rz = fx;
		let vF = this.vx * fx + this.vz * fz;
		let vL = this.vx * rx + this.vz * rz;
		const alive = !this.destroyed && !this.sinking;
		const throttle = alive ? this.throttle : 0;
		const brakeIn = alive ? this.brake : 0;
		const steerIn = alive ? this.steer : 0;

		// Steering: less lock at speed, smooth wheel motion.
		const speedT = clamp(Math.abs(vF) / d.maxSpeed, 0, 1);
		const maxSteer = d.steer * (1 - speedT * 0.55);
		this.steerAngle = approach(this.steerAngle, -steerIn * maxSteer, 3.2 * dt);

		// Longitudinal forces.
		let a = 0;
		this.braking = false;
		this.reversing = false;
		if (throttle > 0) {
			if (vF < -0.5) {
				a += d.brake * throttle;
				this.braking = true;
			} else {
				const taper = 1 - (vF / d.maxSpeed) ** 2;
				a += d.accel * throttle * Math.max(0, taper);
			}
		}
		if (brakeIn > 0) {
			if (vF > 0.5) {
				a -= d.brake * brakeIn;
				this.braking = true;
			} else if (vF > -d.reverseSpeed) {
				a -= d.accel * 0.6 * brakeIn;
				this.reversing = true;
			}
		}
		// Rolling resistance and aero drag.
		a -= vF * 0.015 + vF * Math.abs(vF) * 0.00025;
		if (throttle === 0 && brakeIn === 0) a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 1.4);
		if (this.handbrake) {
			a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 6);
			this.braking = true;
		}
		vF += a * dt;
		if (this.reversing && vF < -d.reverseSpeed) vF = -d.reverseSpeed;
		if (!alive) vF *= Math.exp(-1.5 * dt);

		// Lateral grip (sliding).
		const grip = (this.handbrake ? d.driftGrip : d.grip) * gripScale;
		vL *= Math.exp(-grip * dt);

		// Yaw from the bicycle model; looser while drifting.
		const wheelbase = d.length * 0.62;
		let targetYaw = (vF * Math.tan(this.steerAngle)) / wheelbase;
		if (this.handbrake && Math.abs(vF) > 6) targetYaw *= 1.45;
		const yawGrip = (this.handbrake ? 4 : 10) * gripScale;
		this.angVel += (targetYaw - this.angVel) * Math.min(1, yawGrip * dt);
		this.heading += this.angVel * dt;

		// Recompose world velocity in the pre-rotation frame: momentum keeps its direction and
		// the heading change shows up as lateral slip next step, which grip then removes.
		this.vx = fx * vF + rx * vL;
		this.vz = fz * vF + rz * vL;
		this.x += this.vx * dt;
		this.z += this.vz * dt;
		this.wheelSpin += (vF / d.wheelRadius) * dt;
		this.age += dt;
		if (this.impactCooldown > 0) this.impactCooldown -= dt;
	}
}
