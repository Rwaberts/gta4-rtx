// Third-person camera: free orbit on foot (pointer-lock mouse look), over-the-shoulder when aiming,
// smoothed chase camera in vehicles that recentres after the mouse goes idle, and a slow
// cinematic orbit for the main menu. Collides with the static world so walls never block view.

import * as THREE from 'three';
import { CAMERA } from '../data/config';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math';
import type { StaticCollision } from '../world/StaticCollision';

export type CameraMode = 'foot' | 'vehicle' | 'cinematic' | 'interior';

export interface CameraTarget {
	x: number;
	y: number;
	z: number;
	heading: number;
	/** Vehicle speed (m/s) for FOV / distance effects. */
	speed: number;
	/** Vehicle length used to scale chase distance. */
	size: number;
	aiming: boolean;
	crouching: boolean;
	lookBehind: boolean;
}

export class CameraController {
	yaw = Math.PI;
	pitch = 0.25;
	mode: CameraMode = 'foot';
	sensitivity = 0.0024;
	invertY = false;
	baseFov: number = CAMERA.baseFov;
	private dist: number = CAMERA.footDistance;
	private shoulder = 0;
	private idleMouse = 0;
	private fov: number = CAMERA.baseFov;
	private cinematicT = 0;
	private shake = 0;
	private readonly pivot = new THREE.Vector3();
	private readonly smoothedPivot = new THREE.Vector3();
	private pivotInit = false;
	readonly forward = new THREE.Vector3();

	constructor(
		private readonly camera: THREE.PerspectiveCamera,
		private readonly collision: StaticCollision,
	) {}

	addShake(amount: number): void {
		this.shake = Math.min(1.2, this.shake + amount);
	}

	setMode(mode: CameraMode, target?: CameraTarget): void {
		if (mode === this.mode) return;
		this.mode = mode;
		if (target && mode === 'vehicle') {
			this.yaw = target.heading;
			this.pitch = 0.18;
		}
		this.idleMouse = 0;
	}

	snapTo(target: CameraTarget): void {
		this.pivotInit = false;
		this.yaw = target.heading;
		this.update(1, 0, 0, target);
	}

	update(dt: number, mouseDX: number, mouseDY: number, t: CameraTarget): void {
		const inv = this.invertY ? -1 : 1;
		const sens = this.sensitivity * (t.aiming ? 0.6 : 1);
		this.yaw = wrapAngle(this.yaw - mouseDX * sens);
		this.pitch = clamp(this.pitch + mouseDY * sens * inv, CAMERA.minPitch, CAMERA.maxPitch);
		const mouseActive = Math.abs(mouseDX) + Math.abs(mouseDY) > 0.5;
		this.idleMouse = mouseActive ? 0 : this.idleMouse + dt;

		let targetDist: number = CAMERA.footDistance;
		let targetShoulder = 0;
		let targetFov = this.baseFov;
		let pivotY = t.y + CAMERA.footHeight - (t.crouching ? 0.45 : 0);
		let pivotLambda = 30;

		if (this.mode === 'cinematic') {
			this.cinematicT += dt;
			const a = this.cinematicT * 0.05;
			this.camera.position.set(t.x + Math.sin(a) * 260, 140, t.z + Math.cos(a) * 260);
			this.camera.lookAt(t.x, 30, t.z);
			this.camera.fov = 55;
			this.camera.updateProjectionMatrix();
			return;
		}

		if (this.mode === 'vehicle') {
			targetDist = 5 + t.size * 0.9 + Math.min(t.speed, 40) * 0.05;
			pivotY = t.y + 1.4 + t.size * 0.12;
			targetFov = this.baseFov + clamp(t.speed / 45, 0, 1) * CAMERA.vehicleFovBoost;
			pivotLambda = 12;
			// Recentre behind the vehicle when the mouse is idle and the car is moving.
			if (this.idleMouse > 1.2 && t.speed > 2) {
				const behind = t.lookBehind ? wrapAngle(t.heading + Math.PI) : t.heading;
				this.yaw = dampAngle(this.yaw, behind, 2.5, dt);
				this.pitch = damp(this.pitch, 0.16, 2, dt);
			}
			if (t.lookBehind) this.yaw = wrapAngle(t.heading + Math.PI);
		} else if (this.mode === 'interior') {
			targetDist = 3.2;
			if (t.aiming) {
				targetDist = CAMERA.aimDistance * 0.8;
				targetShoulder = CAMERA.aimShoulder * 0.8;
				targetFov = CAMERA.aimFov;
			}
		} else if (t.aiming) {
			targetDist = CAMERA.aimDistance;
			targetShoulder = CAMERA.aimShoulder;
			targetFov = CAMERA.aimFov;
		}

		this.dist = damp(this.dist, targetDist, 8, dt);
		this.shoulder = damp(this.shoulder, targetShoulder, 10, dt);
		this.fov = damp(this.fov, targetFov, 6, dt);

		this.pivot.set(t.x, pivotY, t.z);
		if (!this.pivotInit) {
			this.smoothedPivot.copy(this.pivot);
			this.pivotInit = true;
		} else {
			const k = 1 - Math.exp(-pivotLambda * dt);
			this.smoothedPivot.lerp(this.pivot, k);
			// Never lag more than a few metres behind (fast vehicles).
			const lag = this.smoothedPivot.distanceTo(this.pivot);
			if (lag > 3) this.smoothedPivot.lerp(this.pivot, 1 - 3 / lag);
		}

		// Forward vector from yaw/pitch (pitch > 0 looks down).
		const cp = Math.cos(this.pitch);
		this.forward.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
		const rx = -Math.cos(this.yaw);
		const rz = Math.sin(this.yaw);
		const px = this.smoothedPivot.x + rx * this.shoulder;
		const py = this.smoothedPivot.y;
		const pz = this.smoothedPivot.z + rz * this.shoulder;
		let dx = -this.forward.x * this.dist;
		let dy = -this.forward.y * this.dist;
		let dz = -this.forward.z * this.dist;
		// Keep the camera above ground.
		if (py + dy < 0.4) dy = 0.4 - py;
		const hit = this.collision.raycast(px, py, pz, dx, dy, dz, 1, undefined, true);
		let frac = 1;
		if (hit) frac = Math.max(0.08, hit.t - 0.25 / this.dist);
		dx *= frac;
		dy *= frac;
		dz *= frac;

		let sx = 0;
		let sy = 0;
		if (this.shake > 0) {
			this.shake = Math.max(0, this.shake - dt * 2.5);
			sx = (Math.random() - 0.5) * this.shake * 0.3;
			sy = (Math.random() - 0.5) * this.shake * 0.3;
		}
		this.camera.position.set(px + dx + sx, py + dy + sy, pz + dz);
		this.camera.lookAt(px + this.forward.x * 20, py + this.forward.y * 20, pz + this.forward.z * 20);
		if (Math.abs(this.camera.fov - this.fov) > 0.05) {
			this.camera.fov = this.fov;
			this.camera.updateProjectionMatrix();
		}
	}
}
