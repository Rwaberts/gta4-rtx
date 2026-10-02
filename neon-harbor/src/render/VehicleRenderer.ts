// Procedural vehicle meshes (merged boxes per body style) with pooled views, wheel spin/steer,
// body roll, brake lights, police light bars, night headlights, wreck and sinking visuals.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleDef } from '../data/vehicles';
import type { Vehicle } from '../sim/Vehicle';
import { createNightGlowMaterial, updateGlowMaterial } from './materials';

interface Model {
	paint: THREE.BufferGeometry;
	trim: THREE.BufferGeometry;
	head: THREE.BufferGeometry;
	tail: THREE.BufferGeometry;
	barRed: THREE.BufferGeometry | null;
	barBlue: THREE.BufferGeometry | null;
	wheels: Array<[number, number, number]>;
	wheel: THREE.BufferGeometry;
}

class VehicleView {
	readonly group = new THREE.Group();
	readonly body = new THREE.Group();
	paint!: THREE.Mesh;
	trim!: THREE.Mesh;
	head!: THREE.Mesh;
	tail!: THREE.Mesh;
	barRed: THREE.Mesh | null = null;
	barBlue: THREE.Mesh | null = null;
	wheels: THREE.Object3D[] = [];
	frontPivots: THREE.Object3D[] = [];
	lastVF = 0;
	lastHeading = 0;
	roll = 0;
	pitch = 0;
	constructor(readonly defId: string) {
		this.group.add(this.body);
	}
}

const GLASS = 0x18222e;
const DARK = 0x1c1c20;
const CHROME = 0x9aa0a8;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color?: number): THREE.BufferGeometry {
	const g = new THREE.BoxGeometry(w, h, d);
	g.translate(x, y, z);
	g.deleteAttribute('uv');
	if (color !== undefined) {
		const c = new THREE.Color(color);
		const n = g.getAttribute('position').count;
		const arr = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			arr[i * 3] = c.r;
			arr[i * 3 + 1] = c.g;
			arr[i * 3 + 2] = c.b;
		}
		g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	}
	return g;
}

function buildModel(def: VehicleDef): Model {
	const L = def.length;
	const W = def.width;
	const H = def.height;
	const r = def.wheelRadius;
	const base = r * 0.55;
	const paint: THREE.BufferGeometry[] = [];
	const trim: THREE.BufferGeometry[] = [];
	const head: THREE.BufferGeometry[] = [];
	const tail: THREE.BufferGeometry[] = [];
	let barRed: THREE.BufferGeometry | null = null;
	let barBlue: THREE.BufferGeometry | null = null;
	let lowerTop = base + H * 0.42;
	let roofY = 0;

	const car = (lowerFrac: number, cabFrac: number, cabLen: number, cabZ: number) => {
		const lh = H * lowerFrac;
		lowerTop = base + lh;
		paint.push(box(W, lh, L, 0, base + lh / 2, 0));
		const ch = H * cabFrac;
		trim.push(box(W * 0.86, ch, L * cabLen, 0, lowerTop + ch / 2, cabZ, GLASS));
		roofY = lowerTop + ch;
		paint.push(box(W * 0.88, 0.07, L * cabLen * 0.92, 0, roofY + 0.035, cabZ));
		// Pillars.
		for (const sx of [-1, 1]) paint.push(box(0.08, ch, 0.1, sx * W * 0.43, lowerTop + ch / 2, cabZ + L * cabLen * 0.46));
	};

	switch (def.style) {
		case 'hatch':
			car(0.44, 0.38, 0.52, -L * 0.1);
			break;
		case 'sedan':
			car(0.42, 0.36, 0.46, -L * 0.05);
			break;
		case 'limo':
			car(0.42, 0.34, 0.66, -L * 0.04);
			break;
		case 'coupe':
			car(0.46, 0.32, 0.38, -L * 0.08);
			// Spoiler.
			paint.push(box(W * 0.8, 0.06, 0.3, 0, lowerTop + 0.18, -L / 2 + 0.2));
			trim.push(box(0.06, 0.16, 0.06, -W * 0.3, lowerTop + 0.08, -L / 2 + 0.2, DARK), box(0.06, 0.16, 0.06, W * 0.3, lowerTop + 0.08, -L / 2 + 0.2, DARK));
			break;
		case 'suv':
			car(0.5, 0.36, 0.62, -L * 0.07);
			trim.push(box(W * 0.8, 0.05, L * 0.4, 0, roofY + 0.1, -L * 0.07, CHROME));
			break;
		case 'pickup': {
			const lh = H * 0.48;
			lowerTop = base + lh;
			paint.push(box(W, lh, L, 0, base + lh / 2, 0));
			const ch = H * 0.36;
			trim.push(box(W * 0.88, ch, L * 0.3, 0, lowerTop + ch / 2, L * 0.08, GLASS));
			roofY = lowerTop + ch;
			paint.push(box(W * 0.9, 0.07, L * 0.28, 0, roofY + 0.035, L * 0.08));
			// Bed walls.
			for (const sx of [-1, 1]) paint.push(box(0.08, 0.35, L * 0.4, sx * (W / 2 - 0.04), lowerTop + 0.17, -L * 0.28));
			paint.push(box(W, 0.35, 0.08, 0, lowerTop + 0.17, -L / 2 + 0.04));
			trim.push(box(W * 0.9, 0.04, L * 0.4, 0, lowerTop + 0.01, -L * 0.28, DARK));
			break;
		}
		case 'van': {
			const bh = H * 0.86;
			paint.push(box(W, bh, L * 0.82, 0, base + bh / 2, -L * 0.09));
			const nh = H * 0.5;
			paint.push(box(W, nh, L * 0.2, 0, base + nh / 2, L * 0.4));
			trim.push(box(W * 0.92, H * 0.3, 0.12, 0, base + nh + H * 0.15, L * 0.31, GLASS));
			for (const sx of [-1, 1]) trim.push(box(0.04, H * 0.22, L * 0.18, sx * (W / 2 + 0.01), base + bh * 0.75, L * 0.2, GLASS));
			lowerTop = base + nh;
			roofY = base + bh;
			break;
		}
		case 'truck': {
			const cabH = H * 0.66;
			const cabL = L * 0.24;
			paint.push(box(W, cabH, cabL, 0, base + cabH / 2, L / 2 - cabL / 2));
			trim.push(box(W * 0.9, cabH * 0.35, 0.1, 0, base + cabH * 0.72, L / 2 + 0.01, GLASS));
			const cargoL = L * 0.72;
			trim.push(box(W * 1.02, H * 0.92, cargoL, 0, base + 0.2 + (H * 0.92) / 2, -L / 2 + cargoL / 2, 0xe0ddd5));
			trim.push(box(W * 0.9, 0.25, L, 0, base + 0.1, 0, DARK));
			lowerTop = base + cabH * 0.5;
			roofY = base + H;
			break;
		}
		case 'bus': {
			const bh = H * 0.9;
			paint.push(box(W, bh, L, 0, base + bh / 2, 0));
			trim.push(box(W * 1.01, H * 0.28, L * 0.86, 0, base + bh * 0.66, -L * 0.03, GLASS));
			trim.push(box(W * 0.94, H * 0.45, 0.06, 0, base + bh * 0.6, L / 2 + 0.01, GLASS));
			trim.push(box(W * 0.8, 0.3, 0.06, 0, base + bh - 0.2, L / 2 + 0.02, 0x101010));
			lowerTop = base + bh * 0.35;
			roofY = base + bh;
			break;
		}
	}

	// Bumpers, grille, lights.
	const by = base + 0.12;
	trim.push(box(W * 0.98, 0.18, 0.14, 0, by, L / 2 + 0.02, DARK), box(W * 0.98, 0.18, 0.14, 0, by, -L / 2 - 0.02, DARK));
	if (def.style !== 'bus' && def.style !== 'truck') trim.push(box(W * 0.36, 0.14, 0.04, 0, lowerTop - 0.16, L / 2 + 0.01, 0x101012));
	const ly = Math.min(lowerTop - 0.12, base + 0.55);
	for (const sx of [-1, 1]) {
		head.push(box(0.34, 0.12, 0.05, sx * W * 0.33, ly, L / 2 + 0.02));
		tail.push(box(0.3, 0.12, 0.05, sx * W * 0.34, ly, -L / 2 - 0.02));
		// Mirrors.
		if (def.style !== 'bus') trim.push(box(0.08, 0.1, 0.16, sx * (W / 2 + 0.06), lowerTop + 0.12, L * 0.16, DARK));
	}
	if (def.id === 'taxi') trim.push(box(0.6, 0.18, 0.24, 0, roofY + 0.16, -L * 0.05, 0xfff27a));
	if (def.police) {
		// Livery stripe and light bar.
		for (const sx of [-1, 1]) trim.push(box(0.02, 0.22, L * 0.7, sx * (W / 2 + 0.005), base + (lowerTop - base) * 0.55, 0, 0xe8e8e8));
		barRed = box(W * 0.3, 0.13, 0.28, -W * 0.16, roofY + 0.13, -L * 0.03);
		barBlue = box(W * 0.3, 0.13, 0.28, W * 0.16, roofY + 0.13, -L * 0.03);
		trim.push(box(W * 0.66, 0.05, 0.3, 0, roofY + 0.06, -L * 0.03, DARK));
	}

	const wheel = new THREE.CylinderGeometry(r, r, 0.26, 12);
	wheel.rotateZ(Math.PI / 2);
	const wz = L / 2 - Math.max(0.75, L * 0.18);
	const wx = W / 2 - 0.13;
	const wheels: Array<[number, number, number]> = [
		[-wx, r, wz],
		[wx, r, wz],
		[-wx, r, -wz],
		[wx, r, -wz],
	];
	if (def.style === 'bus' || def.style === 'truck') wheels.push([-wx, r, -wz + 1.4], [wx, r, -wz + 1.4]);

	return {
		paint: mergeGeometries(paint)!,
		trim: mergeGeometries(trim)!,
		head: mergeGeometries(head)!,
		tail: mergeGeometries(tail)!,
		barRed,
		barBlue,
		wheels,
		wheel,
	};
}

export class VehicleRenderer {
	readonly root = new THREE.Group();
	private models = new Map<string, Model>();
	private views = new Map<Vehicle, VehicleView>();
	private pool = new Map<string, VehicleView[]>();
	private paints = new Map<number, THREE.MeshPhongMaterial>();
	private readonly mats = {
		trim: new THREE.MeshLambertMaterial({ vertexColors: true }),
		wheel: new THREE.MeshLambertMaterial({ color: 0x151517 }),
		head: createNightGlowMaterial(0xfff4d8, 0.15, 3),
		tailOff: createNightGlowMaterial(0xff2020, 0.15, 0.9),
		tailOn: new THREE.MeshLambertMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 2.5 }),
		redOn: new THREE.MeshLambertMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 3 }),
		blueOn: new THREE.MeshLambertMaterial({ color: 0x000040, emissive: 0x2a4aff, emissiveIntensity: 3 }),
		redOff: new THREE.MeshLambertMaterial({ color: 0x5a1010 }),
		blueOff: new THREE.MeshLambertMaterial({ color: 0x10105a }),
		wreck: new THREE.MeshLambertMaterial({ color: 0x18181a }),
	};
	/** Headlight beams follow the player's vehicle only (kept in-scene to avoid shader recompiles). */
	readonly beam = new THREE.SpotLight(0xfff0d0, 0, 60, 0.55, 0.5, 1.2);
	private time = 0;

	constructor(scene: THREE.Scene) {
		scene.add(this.root);
		this.beam.castShadow = false;
		scene.add(this.beam, this.beam.target);
	}

	private model(def: VehicleDef): Model {
		let m = this.models.get(def.id);
		if (!m) {
			m = buildModel(def);
			this.models.set(def.id, m);
		}
		return m;
	}

	private paint(color: number): THREE.MeshPhongMaterial {
		let m = this.paints.get(color);
		if (!m) {
			m = new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x555555 });
			this.paints.set(color, m);
		}
		return m;
	}

	private acquire(v: Vehicle): VehicleView {
		const list = this.pool.get(v.def.id);
		const reused = list?.pop();
		if (reused) {
			this.root.add(reused.group);
			return reused;
		}
		const view = new VehicleView(v.def.id);
		const m = this.model(v.def);
		view.paint = new THREE.Mesh(m.paint, this.paint(v.color));
		view.trim = new THREE.Mesh(m.trim, this.mats.trim);
		view.head = new THREE.Mesh(m.head, this.mats.head);
		view.tail = new THREE.Mesh(m.tail, this.mats.tailOff);
		view.paint.castShadow = true;
		view.trim.castShadow = true;
		view.body.add(view.paint, view.trim, view.head, view.tail);
		if (m.barRed && m.barBlue) {
			view.barRed = new THREE.Mesh(m.barRed, this.mats.redOff);
			view.barBlue = new THREE.Mesh(m.barBlue, this.mats.blueOff);
			view.body.add(view.barRed, view.barBlue);
		}
		m.wheels.forEach(([x, y, z], i) => {
			const wheel = new THREE.Mesh(m.wheel, this.mats.wheel);
			const pivot = new THREE.Object3D();
			pivot.position.set(x, y, z);
			pivot.add(wheel);
			view.group.add(pivot);
			view.wheels.push(wheel);
			if (i < 2) view.frontPivots.push(pivot);
		});
		this.root.add(view.group);
		return view;
	}

	/** Syncs all views with simulation state. */
	update(vehicles: readonly Vehicle[], playerVehicle: Vehicle | null, night: number, dt: number, camX: number, camZ: number, maxDist: number): void {
		this.time += dt;
		updateGlowMaterial(this.mats.head, night);
		updateGlowMaterial(this.mats.tailOff, night);
		const flash = Math.floor(this.time * 6) % 2 === 0;

		// Release views of vehicles that no longer exist.
		const alive = new Set(vehicles);
		for (const [v, view] of this.views) {
			if (!alive.has(v)) this.release(v, view);
		}

		const max2 = maxDist * maxDist;
		for (const v of vehicles) {
			const d2 = (v.x - camX) ** 2 + (v.z - camZ) ** 2;
			let view = this.views.get(v);
			if (d2 > max2) {
				if (view) this.release(v, view);
				continue;
			}
			if (!view || view.defId !== v.def.id) {
				if (view) this.release(v, view);
				view = this.acquire(v);
				this.views.set(v, view);
				view.lastHeading = v.heading;
				view.lastVF = v.forwardSpeed;
			}
			const g = view.group;
			g.position.set(v.x, v.y, v.z);
			g.rotation.y = v.heading;
			// Body roll/pitch from accelerations.
			const vF = v.forwardSpeed;
			const accel = (vF - view.lastVF) / Math.max(dt, 1e-3);
			const yawRate = (v.heading - view.lastHeading) / Math.max(dt, 1e-3);
			view.lastVF = vF;
			view.lastHeading = v.heading;
			const k = 1 - Math.exp(-8 * dt);
			view.pitch += (Math.max(-0.06, Math.min(0.06, -accel * 0.006)) - view.pitch) * k;
			view.roll += (Math.max(-0.07, Math.min(0.07, yawRate * vF * 0.004)) - view.roll) * k;
			view.body.rotation.set(view.pitch, 0, view.roll);
			if (v.sinking) view.body.rotation.x = Math.min(0.5, v.sinkTime * 0.15);
			for (const w of view.wheels) w.rotation.x = v.wheelSpin;
			for (const p of view.frontPivots) p.rotation.y = v.steerAngle;

			const paint = v.destroyed ? this.mats.wreck : this.paint(v.color);
			if (view.paint.material !== paint) view.paint.material = paint;
			view.head.visible = !v.destroyed;
			view.tail.material = v.braking && !v.destroyed ? this.mats.tailOn : this.mats.tailOff;
			if (view.barRed && view.barBlue) {
				view.barRed.material = v.sirenOn && flash ? this.mats.redOn : this.mats.redOff;
				view.barBlue.material = v.sirenOn && !flash ? this.mats.blueOn : this.mats.blueOff;
			}
		}

		// Headlight beam on the player's vehicle at night.
		if (playerVehicle && !playerVehicle.destroyed && night > 0.2) {
			const v = playerVehicle;
			this.beam.intensity = 40 * night;
			this.beam.position.set(v.x + v.forwardX * v.halfLength, 1.0, v.z + v.forwardZ * v.halfLength);
			this.beam.target.position.set(v.x + v.forwardX * 25, 0, v.z + v.forwardZ * 25);
		} else {
			this.beam.intensity = 0;
		}
	}

	private release(v: Vehicle, view: VehicleView): void {
		this.views.delete(v);
		this.root.remove(view.group);
		let list = this.pool.get(view.defId);
		if (!list) {
			list = [];
			this.pool.set(view.defId, list);
		}
		list.push(view);
	}

	get viewCount(): number {
		return this.views.size;
	}
}
