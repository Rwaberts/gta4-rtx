// Traffic signal heads for signalled intersections near the camera (instanced, refreshed at 4 Hz).

import * as THREE from 'three';
import { WORLD } from '../data/config';
import type { RoadNetwork } from '../world/RoadNetwork';

const MAX_HEADS = 320;
const COLORS = { green: new THREE.Color(0x3aff7a), yellow: new THREE.Color(0xffc23a), red: new THREE.Color(0xff3a3a) };

export class SignalRenderer {
	private poles: THREE.InstancedMesh;
	private housings: THREE.InstancedMesh;
	private lamps: THREE.InstancedMesh;
	private timer = 0;

	constructor(
		scene: THREE.Scene,
		private readonly roads: RoadNetwork,
	) {
		const pole = new THREE.BoxGeometry(0.16, 4.6, 0.16);
		pole.translate(0, 2.3, 0);
		const housing = new THREE.BoxGeometry(0.4, 1.05, 0.35);
		housing.translate(0, 4.2, 0);
		const lamp = new THREE.BoxGeometry(0.26, 0.26, 0.06);
		lamp.translate(0, 4.2, 0.2);
		this.poles = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x2a2c30 }), MAX_HEADS);
		this.housings = new THREE.InstancedMesh(housing, new THREE.MeshLambertMaterial({ color: 0x1a1a1c }), MAX_HEADS);
		this.lamps = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_HEADS);
		for (const m of [this.poles, this.housings, this.lamps]) {
			m.count = 0;
			m.frustumCulled = false;
			scene.add(m);
		}
		this.poles.castShadow = true;
	}

	update(camX: number, camZ: number, time: number, dt: number): void {
		this.timer -= dt;
		if (this.timer > 0) return;
		this.timer = 0.25;
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		const pos = new THREE.Vector3();
		const one = new THREE.Vector3(1, 1, 1);
		const off = WORLD.roadHalf + 0.9;
		let n = 0;
		for (const node of this.roads.city.nodeList) {
			if (!node.signal) continue;
			if ((node.x - camX) ** 2 + (node.z - camZ) ** 2 > 190 * 190) continue;
			for (const eid of node.edges) {
				if (n >= MAX_HEADS) break;
				const e = this.roads.city.edges[eid];
				const other = this.roads.city.nodes[e.a === node.id ? e.b : e.a]!;
				const lane = this.roads.laneBetween(other.id, node.id);
				if (!lane) continue;
				// Far-right corner of the intersection, facing the approaching driver.
				const rx = -lane.dz;
				const rz = lane.dx;
				pos.set(node.x + lane.dx * off + rx * off, 0, node.z + lane.dz * off + rz * off);
				q.setFromAxisAngle(up, Math.atan2(-lane.dx, -lane.dz));
				m4.compose(pos, q, one);
				this.poles.setMatrixAt(n, m4);
				this.housings.setMatrixAt(n, m4);
				this.lamps.setMatrixAt(n, m4);
				this.lamps.setColorAt(n, COLORS[this.roads.signalAt(node, lane.axis, time)]);
				n++;
			}
		}
		for (const m of [this.poles, this.housings, this.lamps]) {
			m.count = n;
			m.instanceMatrix.needsUpdate = true;
		}
		if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
	}
}
