// Instanced low-poly humanoids. The whole crowd (player included) renders in 8 draw calls;
// procedural animation (walk cycle, crouch, aim, punch, phone, hands-up, death fall) is
// applied by composing per-part matrices each frame.

import * as THREE from 'three';

export interface HumanoidPose {
	x: number;
	y: number;
	z: number;
	heading: number;
	walkPhase: number;
	/** 0..1 stride amplitude. */
	walkAmount: number;
	crouch: number;
	aim: number;
	/** 0 none, 1 handgun, 2 long gun. */
	armed: number;
	punch: number;
	phone: number;
	handsUp: number;
	/** 0 standing .. 1 lying on the ground. */
	dead: number;
	shirt: number;
	pants: number;
	skin: number;
	hair: number;
	/** 0 hair, 1 police cap, 2 helmet/hood. */
	hat: number;
	scale: number;
	sleeves: boolean;
}

export function defaultPose(): HumanoidPose {
	return {
		x: 0,
		y: 0,
		z: 0,
		heading: 0,
		walkPhase: 0,
		walkAmount: 0,
		crouch: 0,
		aim: 0,
		armed: 0,
		punch: 0,
		phone: 0,
		handsUp: 0,
		dead: 0,
		shirt: 0x3a6ea8,
		pants: 0x2a2a30,
		skin: 0xc8946a,
		hair: 0x2a1a10,
		hat: 0,
		scale: 1,
		sleeves: true,
	};
}

const enum P {
	Torso,
	Head,
	Hair,
	LegL,
	LegR,
	ArmL,
	ArmR,
	Weapon,
	Count,
}

// Part size (w, h, d), pivot (x, y, z) and centre offset from pivot (x, y, z).
const PART_DEF: Array<{ size: [number, number, number]; pivot: [number, number, number]; off: [number, number, number] }> = [
	{ size: [0.46, 0.62, 0.26], pivot: [0, 0.88, 0], off: [0, 0.31, 0] },
	{ size: [0.24, 0.27, 0.26], pivot: [0, 1.5, 0], off: [0, 0.15, 0.01] },
	{ size: [0.26, 0.09, 0.28], pivot: [0, 1.5, 0], off: [0, 0.31, -0.005] },
	{ size: [0.17, 0.88, 0.2], pivot: [-0.12, 0.88, 0], off: [0, -0.44, 0] },
	{ size: [0.17, 0.88, 0.2], pivot: [0.12, 0.88, 0], off: [0, -0.44, 0] },
	{ size: [0.12, 0.64, 0.14], pivot: [-0.3, 1.46, 0], off: [0, -0.31, 0] },
	{ size: [0.12, 0.64, 0.14], pivot: [0.3, 1.46, 0], off: [0, -0.31, 0] },
	{ size: [0.08, 0.13, 0.3], pivot: [0.3, 1.46, 0], off: [0, -0.62, 0.12] },
];

export class HumanoidRenderer {
	private meshes: THREE.InstancedMesh[] = [];
	private count = 0;
	private weaponCount = 0;
	private readonly base = new THREE.Matrix4();
	private readonly local = new THREE.Matrix4();
	private readonly out = new THREE.Matrix4();
	private readonly q = new THREE.Quaternion();
	private readonly q2 = new THREE.Quaternion();
	private readonly v = new THREE.Vector3();
	private readonly s = new THREE.Vector3();
	private readonly c = new THREE.Color();
	private readonly axisX = new THREE.Vector3(1, 0, 0);
	private readonly axisY = new THREE.Vector3(0, 1, 0);
	private readonly axisZ = new THREE.Vector3(0, 0, 1);

	constructor(
		scene: THREE.Scene,
		readonly capacity: number,
	) {
		const geo = new THREE.BoxGeometry(1, 1, 1);
		const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
		for (let p = 0; p < P.Count; p++) {
			const m = new THREE.InstancedMesh(geo, p === P.Weapon ? new THREE.MeshLambertMaterial({ color: 0x1c1c1e }) : mat, capacity);
			m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			m.castShadow = true;
			m.receiveShadow = false;
			m.frustumCulled = false;
			m.count = 0;
			if (p !== P.Weapon) m.setColorAt(0, this.c.set(0xffffff));
			scene.add(m);
			this.meshes.push(m);
		}
	}

	begin(): void {
		this.count = 0;
		this.weaponCount = 0;
	}

	get rendered(): number {
		return this.count;
	}

	add(p: HumanoidPose): void {
		if (this.count >= this.capacity) return;
		const i = this.count++;
		// Base transform: position, heading, optional death fall, scale.
		this.q.setFromAxisAngle(this.axisY, p.heading);
		if (p.dead > 0) {
			this.q2.setFromAxisAngle(this.axisX, (-Math.PI / 2) * Math.min(1, p.dead));
			this.q.multiply(this.q2);
		}
		const crouchDrop = p.crouch * 0.42;
		this.base.compose(this.v.set(p.x, p.y + (p.dead > 0 ? 0.14 * p.dead : 0) - crouchDrop * (1 - p.dead), p.z), this.q, this.s.set(p.scale, p.scale, p.scale));

		const swing = Math.sin(p.walkPhase) * p.walkAmount;
		const legSwing = swing * 0.7;
		const armSwing = swing * 0.55;
		const crouchLeg = -p.crouch * 1.0;

		this.part(P.Torso, i, -p.crouch * 0.35 + p.aim * 0.05, 0, p.shirt);
		this.part(P.Head, i, 0, 0, p.skin);
		this.part(P.Hair, i, 0, 0, p.hat === 1 ? 0x1a2238 : p.hair);
		this.part(P.LegL, i, legSwing + crouchLeg, 0, p.pants);
		this.part(P.LegR, i, -legSwing + crouchLeg * 0.6, 0, p.pants);

		// Arms: blend between walk swing, aiming, punching, phone and hands-up.
		const armColor = p.sleeves ? p.shirt : p.skin;
		let rightX = -armSwing;
		let leftX = armSwing;
		let rightZ = 0;
		let leftZ = 0;
		const aimX = -Math.PI / 2 + 0.05;
		if (p.aim > 0) {
			rightX = rightX * (1 - p.aim) + aimX * p.aim;
			if (p.armed === 2) {
				leftX = leftX * (1 - p.aim) + (aimX + 0.15) * p.aim;
				leftZ = -0.55 * p.aim;
			}
		}
		if (p.punch > 0) rightX = rightX * (1 - p.punch) + aimX * p.punch;
		if (p.phone > 0) {
			rightX = rightX * (1 - p.phone) - 2.6 * p.phone;
			rightZ = -0.5 * p.phone;
		}
		if (p.handsUp > 0) {
			rightX = rightX * (1 - p.handsUp) - 2.9 * p.handsUp;
			leftX = leftX * (1 - p.handsUp) - 2.9 * p.handsUp;
		}
		this.part(P.ArmL, i, leftX, leftZ, armColor);
		this.part(P.ArmR, i, rightX, rightZ, armColor);

		if (p.armed > 0 && p.dead === 0) {
			const w = this.weaponCount++;
			const def = PART_DEF[P.Weapon];
			const len = p.armed === 2 ? 0.75 : 0.28;
			// Arm orientation (same composition as part()).
			this.q.setFromAxisAngle(this.axisX, rightX);
			this.q2.setFromAxisAngle(this.axisZ, rightZ);
			this.q2.multiply(this.q);
			// The weapon extends from the hand along the arm direction (arm-local -y).
			this.v.set(0, -0.62 - len * 0.32, 0.05).applyQuaternion(this.q2);
			this.v.x += def.pivot[0];
			this.v.y += def.pivot[1];
			this.v.z += def.pivot[2];
			// Box long axis (+z) mapped onto arm-local -y.
			this.q2.multiply(this.q.setFromAxisAngle(this.axisX, Math.PI / 2));
			this.local.compose(this.v, this.q2, this.s.set(def.size[0], def.size[1], len));
			this.out.multiplyMatrices(this.base, this.local);
			this.meshes[P.Weapon].setMatrixAt(w, this.out);
		}
	}

	private part(p: number, i: number, rotX: number, rotZ: number, color: number): void {
		const def = PART_DEF[p];
		this.q.setFromAxisAngle(this.axisX, rotX);
		if (rotZ !== 0) {
			this.q2.setFromAxisAngle(this.axisZ, rotZ);
			this.q.premultiply(this.q2);
		}
		this.v.set(def.off[0], def.off[1], def.off[2]).applyQuaternion(this.q);
		this.v.x += def.pivot[0];
		this.v.y += def.pivot[1];
		this.v.z += def.pivot[2];
		this.local.compose(this.v, this.q, this.s.set(def.size[0], def.size[1], def.size[2]));
		this.out.multiplyMatrices(this.base, this.local);
		const mesh = this.meshes[p];
		mesh.setMatrixAt(i, this.out);
		mesh.setColorAt(i, this.c.setHex(color));
	}

	end(): void {
		for (let p = 0; p < P.Count; p++) {
			const m = this.meshes[p];
			m.count = p === P.Weapon ? this.weaponCount : this.count;
			m.instanceMatrix.needsUpdate = true;
			if (m.instanceColor) m.instanceColor.needsUpdate = true;
		}
	}
}
