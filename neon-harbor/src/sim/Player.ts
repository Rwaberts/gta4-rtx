// On-foot player controller: camera-relative movement, sprint/stamina, jump, crouch, swimming,
// health/armor and damage. Vehicle driving is delegated to the vehicle system.

import { PLAYER, SIM, WORLD } from '../data/config';
import { approachAngle, clamp, dampAngle, headingTo } from '../core/math';
import type { PlayerControls } from './controls';
import type { World } from './World';
import type { Vehicle } from './Vehicle';

export type PlayerState = 'onFoot' | 'entering' | 'driving' | 'exiting' | 'dead' | 'arrested';

export class Player {
	x = 0;
	y = 0;
	z = 0;
	vx = 0;
	vy = 0;
	vz = 0;
	heading = 0;
	onGround = true;
	crouching = false;
	sprinting = false;
	swimming = false;
	health: number = PLAYER.maxHealth;
	armor = 0;
	stamina: number = PLAYER.maxStamina;
	private staminaCooldown = 0;
	state: PlayerState = 'onFoot';
	vehicle: Vehicle | null = null;
	/** Animation helpers read by the renderer. */
	animPhase = 0;
	speed = 0;
	aiming = false;
	punchTimer = 0;
	/** Seconds since the player last took damage. */
	sinceDamage = 99;
	/** Vehicle entry animation. */
	transition = 0;
	transitionFrom = { x: 0, z: 0 };
	invulnerable = false;
	readonly radius = PLAYER.radius;

	get alive(): boolean {
		return this.state !== 'dead';
	}

	get inVehicle(): boolean {
		return this.state === 'driving' && this.vehicle !== null;
	}

	/** Position used for AI targeting (vehicle position when driving). */
	get px(): number {
		return this.inVehicle ? this.vehicle!.x : this.x;
	}

	get pz(): number {
		return this.inVehicle ? this.vehicle!.z : this.z;
	}

	teleport(x: number, z: number, heading = this.heading, y = 0): void {
		this.x = x;
		this.z = z;
		this.y = y;
		this.vx = this.vy = this.vz = 0;
		this.heading = heading;
	}

	resetVitals(): void {
		this.health = PLAYER.maxHealth;
		this.stamina = PLAYER.maxStamina;
		this.state = 'onFoot';
		this.vehicle = null;
		this.crouching = false;
		this.sinceDamage = 99;
	}

	/** Applies damage through armor first. Returns actual health lost. */
	damage(amount: number): number {
		if (!this.alive || this.invulnerable || amount <= 0) return 0;
		this.sinceDamage = 0;
		const absorbed = Math.min(this.armor, amount * 0.7);
		this.armor -= absorbed;
		const hp = amount - absorbed;
		this.health = Math.max(0, this.health - hp);
		return hp;
	}

	heal(amount: number): void {
		this.health = Math.min(PLAYER.maxHealth, this.health + amount);
	}

	updateOnFoot(dt: number, c: PlayerControls, world: World): void {
		const col = world.collision;
		if (c.crouchPressed && this.onGround && !this.swimming) this.crouching = !this.crouching;
		this.aiming = c.aim;

		// Camera-relative wish direction.
		const fx = Math.sin(c.camYaw);
		const fz = Math.cos(c.camYaw);
		const rx = -fz;
		const rz = fx;
		let wx = rx * c.moveX + fx * c.moveZ;
		let wz = rz * c.moveX + fz * c.moveZ;
		const wl = Math.hypot(wx, wz);
		if (wl > 1) {
			wx /= wl;
			wz /= wl;
		}
		const moving = wl > 0.05;

		// Sprint and stamina.
		const wantsSprint = c.sprint && moving && !this.crouching && !this.swimming && !this.aiming;
		if (wantsSprint && this.stamina > 0) {
			this.sprinting = true;
			this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
			this.staminaCooldown = PLAYER.staminaRegenDelay;
		} else {
			this.sprinting = false;
			this.staminaCooldown -= dt;
			if (this.staminaCooldown <= 0) this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
		}
		if (this.sprinting) this.crouching = false;

		let maxSpeed: number = PLAYER.runSpeed;
		if (this.swimming) maxSpeed = PLAYER.swimSpeed;
		else if (this.crouching) maxSpeed = PLAYER.crouchSpeed;
		else if (this.sprinting) maxSpeed = PLAYER.sprintSpeed;
		else if (c.walk || this.aiming) maxSpeed = PLAYER.walkSpeed;

		const control = this.onGround || this.swimming ? 1 : PLAYER.airControl;
		const tvx = wx * maxSpeed;
		const tvz = wz * maxSpeed;
		const accel = PLAYER.accel * control * dt;
		this.vx += clamp(tvx - this.vx, -accel, accel);
		this.vz += clamp(tvz - this.vz, -accel, accel);

		// Facing: towards camera when aiming, otherwise towards movement.
		if (this.aiming) this.heading = approachAngle(this.heading, c.camYaw, 14 * dt);
		else if (moving) this.heading = dampAngle(this.heading, headingTo(wx, wz), 12, dt);

		// Jump & gravity.
		if (c.jumpPressed && this.onGround && !this.swimming) {
			this.vy = PLAYER.jumpVelocity * (this.crouching ? 0.6 : 1);
			this.onGround = false;
			this.crouching = false;
		}
		this.vy += SIM.gravity * dt;

		const pos = { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
		const height = this.crouching ? 1.1 : PLAYER.height;
		col.resolveCircle(pos, this.radius, this.y, height);
		this.x = pos.x;
		this.z = pos.z;

		// Water: float at the surface.
		const land = world.city.isLand(this.x, this.z);
		if (!land) {
			this.swimming = true;
			this.crouching = false;
			const surface = WORLD.waterLevel - 1.1;
			this.y = Math.max(surface, this.y + this.vy * dt);
			if (this.y <= surface) {
				this.y = surface;
				this.vy = 0;
			}
			this.onGround = false;
		} else {
			this.swimming = false;
			this.y += this.vy * dt;
			const ground = col.groundHeight(this.x, this.z, this.radius, Math.max(this.y, 0) + 0.55);
			if (this.y <= ground) {
				// Fall damage.
				if (this.vy < -14) this.damage((-this.vy - 14) * 6);
				this.y = ground;
				this.vy = 0;
				this.onGround = true;
			} else {
				this.onGround = this.y - ground < 0.05;
			}
		}

		this.speed = Math.hypot(this.vx, this.vz);
		this.animPhase += this.speed * dt * 2.1;
		this.punchTimer = Math.max(0, this.punchTimer - dt);
	}

	updateVitals(dt: number): void {
		this.sinceDamage += dt;
		// Slow regeneration up to half health when out of combat.
		if (this.alive && this.sinceDamage > 8 && this.health < PLAYER.maxHealth * 0.5) this.heal(2 * dt);
	}
}
