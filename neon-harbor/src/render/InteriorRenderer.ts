// Builds the (off-map) interior rooms: floor, walls with a door gap, ceiling with light panels,
// counters and shelving. Materials are partly self-lit so rooms read well without extra lights.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { InteriorInstance } from '../sim/InteriorSystem';

function lit(color: number, self = 0.35): THREE.MeshLambertMaterial {
	return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: self });
}

export class InteriorRenderer {
	readonly root = new THREE.Group();

	constructor(scene: THREE.Scene, instances: readonly InteriorInstance[]) {
		scene.add(this.root);
		for (const inst of instances) this.build(inst);
	}

	private build(inst: InteriorInstance): void {
		const d = inst.def;
		const g = new THREE.Group();
		g.position.set(inst.ox, 0, inst.oz);
		const W = d.width;
		const D = d.depth;
		const H = d.height;
		const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), lit(d.floor, 0.25));
		floor.position.y = -0.05;
		const walls: THREE.BufferGeometry[] = [];
		const wall = (w: number, h: number, dd: number, x: number, y: number, z: number) => {
			const b = new THREE.BoxGeometry(w, h, dd);
			b.translate(x, y, z);
			walls.push(b);
		};
		wall(0.3, H, D, -W / 2 - 0.15, H / 2, 0);
		wall(0.3, H, D, W / 2 + 0.15, H / 2, 0);
		wall(W, H, 0.3, 0, H / 2, D / 2 + 0.15);
		wall(W / 2 - 1, H, 0.3, -(W / 4 + 0.5), H / 2, -D / 2 - 0.15);
		wall(W / 2 - 1, H, 0.3, W / 4 + 0.5, H / 2, -D / 2 - 0.15);
		wall(2, H - 2.4, 0.3, 0, 2.4 + (H - 2.4) / 2, -D / 2 - 0.15);
		const wallMesh = new THREE.Mesh(mergeGeometries(walls)!, lit(d.wall, 0.3));
		const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.2, D + 0.6), lit(0x2a2a2e, 0.2));
		ceiling.position.y = H + 0.1;
		// Door (dark) and a glowing exit sign.
		const door = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 0.1), lit(0x2a1a10, 0.1));
		door.position.set(0, 1.2, -D / 2 - 0.62);
		const exit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: 0x3aff7a }));
		exit.position.set(0, 2.7, -D / 2 + 0.02);
		g.add(floor, wallMesh, ceiling, door, exit);
		// Ceiling light panels.
		const panelMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
		for (let x = -W / 2 + 3; x < W / 2 - 1; x += 4) {
			for (let z = -D / 2 + 2.5; z < D / 2 - 1; z += 4) {
				const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.5), panelMat);
				p.position.set(x, H - 0.03, z);
				g.add(p);
			}
		}
		for (const b of d.props) {
			const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), b.glow ? new THREE.MeshBasicMaterial({ color: b.color }) : lit(b.color, 0.25));
			m.position.set(b.x, (b.y ?? 0) + b.h / 2, b.z);
			g.add(m);
		}
		this.root.add(g);
	}
}
