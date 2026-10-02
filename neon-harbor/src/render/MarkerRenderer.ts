// Mission beacons: light columns + ground rings at destinations, floating arrows over
// mission vehicles / enemies / allies, and spinning pickups. Pooled meshes.

import * as THREE from 'three';
import type { MissionMarker, Pickup } from '../sim/MissionSystem';

const COLORS: Record<MissionMarker['kind'], number> = {
	goto: 0xffd84a,
	vehicle: 0x4ad8ff,
	enemy: 0xff4a5a,
	ally: 0x39f0d0,
	pickup: 0xffd84a,
	contact: 0xff4ad8,
};

export class MarkerRenderer {
	private beams: THREE.Mesh[] = [];
	private rings: THREE.Mesh[] = [];
	private arrows: THREE.Mesh[] = [];
	private pickups: THREE.Mesh[] = [];
	private readonly beamGeo: THREE.CylinderGeometry;
	private readonly ringGeo: THREE.RingGeometry;
	private readonly arrowGeo: THREE.ConeGeometry;
	private readonly pickupGeo = new THREE.BoxGeometry(0.5, 0.35, 0.35);
	private mats = new Map<number, THREE.MeshBasicMaterial>();
	private t = 0;

	constructor(private readonly scene: THREE.Scene) {
		this.beamGeo = new THREE.CylinderGeometry(1, 1, 60, 16, 1, true);
		this.beamGeo.translate(0, 30, 0);
		this.ringGeo = new THREE.RingGeometry(0.85, 1, 40);
		this.ringGeo.rotateX(-Math.PI / 2);
		this.arrowGeo = new THREE.ConeGeometry(0.45, 0.9, 4);
		this.arrowGeo.rotateX(Math.PI);
	}

	private mat(color: number, opacity: number): THREE.MeshBasicMaterial {
		const key = color * 100 + Math.round(opacity * 99);
		let m = this.mats.get(key);
		if (!m) {
			m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false });
			this.mats.set(key, m);
		}
		return m;
	}

	private take(pool: THREE.Mesh[], i: number, geo: THREE.BufferGeometry): THREE.Mesh {
		let m = pool[i];
		if (!m) {
			m = new THREE.Mesh(geo, this.mat(0xffffff, 1));
			m.renderOrder = 5;
			this.scene.add(m);
			pool.push(m);
		}
		m.visible = true;
		return m;
	}

	update(markers: readonly MissionMarker[], pickups: readonly Pickup[], groundY: (x: number, z: number) => number, dt: number): void {
		this.t += dt;
		let b = 0;
		let r = 0;
		let a = 0;
		for (const mk of markers) {
			const color = COLORS[mk.kind];
			const y = groundY(mk.x, mk.z);
			if (mk.kind === 'goto' || mk.kind === 'contact') {
				const rad = mk.kind === 'contact' ? 1.2 : Math.min(mk.radius ?? 3, 8);
				const beam = this.take(this.beams, b++, this.beamGeo);
				beam.material = this.mat(color, 0.16);
				beam.position.set(mk.x, y, mk.z);
				beam.scale.set(rad * 0.35, 1, rad * 0.35);
				const ring = this.take(this.rings, r++, this.ringGeo);
				ring.material = this.mat(color, 0.75);
				ring.position.set(mk.x, y + 0.05, mk.z);
				const pulse = 1 + Math.sin(this.t * 3) * 0.06;
				ring.scale.set(rad * pulse, 1, rad * pulse);
			} else if (mk.kind !== 'pickup') {
				const arrow = this.take(this.arrows, a++, this.arrowGeo);
				arrow.material = this.mat(color, 0.9);
				const h = mk.kind === 'vehicle' ? 3.4 : 2.6;
				arrow.position.set(mk.x, y + h + Math.sin(this.t * 4) * 0.15, mk.z);
				arrow.rotation.y = this.t * 2;
			}
		}
		for (; b < this.beams.length; b++) this.beams[b].visible = false;
		for (; r < this.rings.length; r++) this.rings[r].visible = false;
		for (; a < this.arrows.length; a++) this.arrows[a].visible = false;
		let p = 0;
		for (const pk of pickups) {
			if (!pk.active) continue;
			const m = this.take(this.pickups, p++, this.pickupGeo);
			m.material = this.mat(pk.color, 1);
			m.position.set(pk.x, groundY(pk.x, pk.z) + 0.8 + Math.sin(this.t * 3) * 0.12, pk.z);
			m.rotation.y = this.t * 1.8;
		}
		for (; p < this.pickups.length; p++) this.pickups[p].visible = false;
	}
}
