// Police helicopter mesh with spinning rotor and a night spotlight that tracks its target.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PoliceHeli } from '../sim/PoliceSystem';

export class HeliRenderer {
	private group = new THREE.Group();
	private rotor: THREE.Mesh;
	private tailRotor: THREE.Mesh;
	private beacon: THREE.Mesh;
	readonly spot = new THREE.SpotLight(0xe8f0ff, 0, 140, 0.28, 0.4, 1);
	private t = 0;

	constructor(scene: THREE.Scene) {
		const body = new THREE.BoxGeometry(2.2, 2, 4.6);
		body.translate(0, 0, 0.4);
		const tail = new THREE.BoxGeometry(0.5, 0.6, 5);
		tail.translate(0, 0.4, -4);
		const fin = new THREE.BoxGeometry(0.15, 1.6, 1);
		fin.translate(0, 1.1, -6.3);
		const skidL = new THREE.BoxGeometry(0.15, 0.15, 3.6);
		skidL.translate(-1, -1.3, 0.4);
		const skidR = skidL.clone();
		skidR.translate(2, 0, 0);
		const hull = new THREE.Mesh(mergeGeometries([body, tail, fin, skidL, skidR])!, new THREE.MeshLambertMaterial({ color: 0x1a2238 }));
		const glass = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 1.4), new THREE.MeshLambertMaterial({ color: 0x18222e }));
		glass.position.set(0, 0.3, 2.4);
		this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.35), new THREE.MeshLambertMaterial({ color: 0x111111 }));
		this.rotor.position.y = 1.25;
		this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.2), new THREE.MeshLambertMaterial({ color: 0x111111 }));
		this.tailRotor.position.set(0.25, 1, -6.3);
		this.beacon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xff3a3a }));
		this.beacon.position.set(0, -1, 0);
		this.group.add(hull, glass, this.rotor, this.tailRotor, this.beacon);
		this.group.visible = false;
		scene.add(this.group, this.spot, this.spot.target);
	}

	update(h: PoliceHeli, targetX: number, targetZ: number, night: number, dt: number): void {
		this.group.visible = h.active;
		if (!h.active) {
			this.spot.intensity = 0;
			return;
		}
		this.t += dt;
		this.group.position.set(h.x, h.y + Math.sin(this.t * 1.3) * 0.4, h.z);
		this.group.rotation.set(0.12, h.heading, Math.sin(this.t * 0.7) * 0.05);
		this.rotor.rotation.y += dt * 38;
		this.tailRotor.rotation.x += dt * 50;
		this.beacon.visible = Math.floor(this.t * 2) % 2 === 0;
		this.spot.position.set(h.x, h.y - 1.5, h.z);
		this.spot.target.position.set(targetX, 0, targetZ);
		this.spot.intensity = night > 0.15 ? 3000 * night : 0;
	}
}
