// Chunked, instanced city renderer with time-sliced streaming and two LOD rings:
//  - base group (buildings, ground, large props) visible up to the draw distance
//  - detail group (trees, lamps, markings, small props) visible up to the detail distance
// Each chunk is ~10-20 draw calls regardless of how many objects it contains.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD } from '../data/config';
import { TreeKind, type CityLayout } from '../world/CityLayout';
import { createBuildingMaterial, createGroundMaterial, createNightGlowMaterial, updateGlowMaterial } from './materials';

const CHUNK = WORLD.chunkSize;

interface ChunkItems {
	buildings: number[];
	trees: number[];
	boxes: number[];
	cylinders: number[];
	lamps: number[];
	ground: number[];
	markings: number[];
}

interface Chunk {
	cx: number;
	cz: number;
	minX: number;
	minZ: number;
	items: ChunkItems;
	built: boolean;
	queued: boolean;
	base: THREE.Group | null;
	detail: THREE.Group | null;
}

function boxGeo(): THREE.BufferGeometry {
	const g = new THREE.BoxGeometry(1, 1, 1);
	g.translate(0, 0.5, 0);
	return g;
}

function prismGeo(): THREE.BufferGeometry {
	// Gable roof: ridge along X, base 1x1 at y=0, apex at y=1.
	const v = [
		-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // north slope
		0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, // south slope
	];
	const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6];
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
	g.setIndex(idx);
	const gables = new THREE.BufferGeometry();
	gables.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5], 3));
	const merged = mergeGeometries([g.toNonIndexed(), gables])!;
	merged.computeVertexNormals();
	return merged;
}

function palmCrownGeo(): THREE.BufferGeometry {
	const parts: THREE.BufferGeometry[] = [];
	for (let k = 0; k < 7; k++) {
		const leaf = new THREE.BoxGeometry(0.35, 0.05, 2.6);
		leaf.translate(0, 0, 1.2);
		leaf.rotateX(0.35);
		leaf.rotateY((k / 7) * Math.PI * 2);
		parts.push(leaf);
	}
	return mergeGeometries(parts)!;
}

function lampPostGeo(): THREE.BufferGeometry {
	const pole = new THREE.BoxGeometry(0.16, 6.5, 0.16);
	pole.translate(0, 3.25, 0);
	const arm = new THREE.BoxGeometry(0.1, 0.1, 1.8);
	arm.translate(0, 6.45, 0.85);
	return mergeGeometries([pole, arm])!;
}

function lampHeadGeo(): THREE.BufferGeometry {
	const head = new THREE.BoxGeometry(0.45, 0.16, 0.7);
	head.translate(0, 6.35, 1.75);
	return head;
}

export class CityRenderer {
	readonly root = new THREE.Group();
	private chunks = new Map<number, Chunk>();
	private chunkList: Chunk[] = [];
	private queue: Chunk[] = [];
	private visTimer = 0;

	// Shared resources.
	private readonly geo = {
		box: boxGeo(),
		prism: prismGeo(),
		cyl: (() => {
			const g = new THREE.CylinderGeometry(1, 1, 1, 14);
			g.translate(0, 0.5, 0);
			return g;
		})(),
		trunk: (() => {
			const g = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
			g.translate(0, 0.5, 0);
			return g;
		})(),
		oak: new THREE.IcosahedronGeometry(1, 1),
		pine: (() => {
			const g = new THREE.ConeGeometry(1, 1, 8);
			g.translate(0, 0.5, 0);
			return g;
		})(),
		palm: palmCrownGeo(),
		lampPost: lampPostGeo(),
		lampHead: lampHeadGeo(),
	};
	private readonly mat = {
		building: createBuildingMaterial(),
		roof: new THREE.MeshLambertMaterial({ color: 0xffffff }),
		ground: createGroundMaterial(),
		marking: createGroundMaterial(),
		prop: new THREE.MeshLambertMaterial({ color: 0xffffff }),
		trunk: new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
		foliage: new THREE.MeshLambertMaterial({ color: 0xffffff }),
		lampPost: new THREE.MeshLambertMaterial({ color: 0x3a3c40 }),
		lampHead: createNightGlowMaterial(0xffe2a8, 0.0, 2.2),
		neon: [createNightGlowMaterial(0xff3ad8, 0.35, 2.6), createNightGlowMaterial(0x2af0d0, 0.35, 2.6), createNightGlowMaterial(0xffa53a, 0.35, 2.6)],
		sign: new Map<number, THREE.MeshLambertMaterial>(),
	};
	readonly water: THREE.Mesh;

	constructor(
		private readonly city: CityLayout,
		scene: THREE.Scene,
	) {
		scene.add(this.root);
		this.bucket();

		// Asphalt base covering the land.
		const L = city.land;
		const landGeo = new THREE.PlaneGeometry(L.maxX - L.minX, L.maxZ - L.minZ);
		landGeo.rotateX(-Math.PI / 2);
		const land = new THREE.Mesh(landGeo, createGroundMaterial(0x3b3c40));
		land.position.set((L.minX + L.maxX) / 2, 0, (L.minZ + L.maxZ) / 2);
		land.receiveShadow = true;
		this.root.add(land);
		// Land "skirt" so the coast does not look paper-thin.
		const skirt = new THREE.Mesh(this.geo.box, new THREE.MeshLambertMaterial({ color: 0x6a6658 }));
		skirt.scale.set(L.maxX - L.minX, 3, L.maxZ - L.minZ);
		skirt.position.set((L.minX + L.maxX) / 2, -3.01, (L.minZ + L.maxZ) / 2);
		this.root.add(skirt);

		// Ocean.
		const waterGeo = new THREE.PlaneGeometry(14000, 14000);
		waterGeo.rotateX(-Math.PI / 2);
		this.water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({ color: 0x1d5a78, specular: 0x88aacc, shininess: 60 }));
		this.water.position.y = WORLD.waterLevel;
		this.water.receiveShadow = true;
		this.root.add(this.water);

		this.buildLandmarks();
		this.buildDistantHills();
		this.buildSigns();
	}

	private key(cx: number, cz: number): number {
		return (cx + 512) * 1024 + (cz + 512);
	}

	private chunkFor(x: number, z: number): Chunk {
		const cx = Math.floor(x / CHUNK);
		const cz = Math.floor(z / CHUNK);
		const k = this.key(cx, cz);
		let c = this.chunks.get(k);
		if (!c) {
			c = {
				cx,
				cz,
				minX: cx * CHUNK,
				minZ: cz * CHUNK,
				items: { buildings: [], trees: [], boxes: [], cylinders: [], lamps: [], ground: [], markings: [] },
				built: false,
				queued: false,
				base: null,
				detail: null,
			};
			this.chunks.set(k, c);
			this.chunkList.push(c);
		}
		return c;
	}

	private bucket(): void {
		const c = this.city;
		c.buildings.forEach((b, i) => this.chunkFor((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2).items.buildings.push(i));
		c.trees.forEach((t, i) => this.chunkFor(t.x, t.z).items.trees.push(i));
		c.boxes.forEach((b, i) => {
			if (b.visible) this.chunkFor((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2).items.boxes.push(i);
		});
		c.cylinders.forEach((t, i) => this.chunkFor(t.x, t.z).items.cylinders.push(i));
		c.lamps.forEach((t, i) => this.chunkFor(t.x, t.z).items.lamps.push(i));
		c.ground.forEach((g, i) => this.chunkFor((g.minX + g.maxX) / 2, (g.minZ + g.maxZ) / 2).items.ground.push(i));
		c.markings.forEach((m, i) => this.chunkFor(m.x, m.z).items.markings.push(i));
	}

	get builtCount(): number {
		return this.chunkList.filter((c) => c.built).length;
	}

	get totalChunks(): number {
		return this.chunkList.length;
	}

	/** Synchronously builds all chunks within radius (used during loading). */
	buildAround(x: number, z: number, radius: number): void {
		for (const c of this.chunkList) {
			if (!c.built && this.chunkDist(c, x, z) < radius) this.buildChunk(c);
		}
	}

	private chunkDist(c: Chunk, x: number, z: number): number {
		const dx = Math.max(c.minX - x, 0, x - (c.minX + CHUNK));
		const dz = Math.max(c.minZ - z, 0, z - (c.minZ + CHUNK));
		return Math.hypot(dx, dz);
	}

	update(camX: number, camZ: number, drawDistance: number, detailDistance: number, night: number, dt: number): void {
		updateGlowMaterial(this.mat.lampHead, night);
		for (const m of this.mat.neon) updateGlowMaterial(m, night);
		for (const m of this.mat.sign.values()) updateGlowMaterial(m, night);
		this.visTimer -= dt;
		if (this.visTimer <= 0) {
			this.visTimer = 0.2;
			for (const c of this.chunkList) {
				const d = this.chunkDist(c, camX, camZ);
				if (d < drawDistance) {
					if (!c.built && !c.queued) {
						c.queued = true;
						this.queue.push(c);
					}
				}
				if (c.base) c.base.visible = d < drawDistance;
				if (c.detail) c.detail.visible = d < detailDistance;
			}
			this.queue.sort((a, b) => this.chunkDist(a, camX, camZ) - this.chunkDist(b, camX, camZ));
		}
		// Time-sliced streaming: build until the frame budget is used.
		const t0 = performance.now();
		while (this.queue.length && performance.now() - t0 < 6) {
			const c = this.queue.shift()!;
			c.queued = false;
			if (!c.built) {
				this.buildChunk(c);
				const d = this.chunkDist(c, camX, camZ);
				c.base!.visible = d < drawDistance;
				c.detail!.visible = d < detailDistance;
			}
		}
	}

	private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, cast: boolean, receive: boolean): THREE.InstancedMesh {
		const m = new THREE.InstancedMesh(geo, mat, count);
		m.castShadow = cast;
		m.receiveShadow = receive;
		m.matrixAutoUpdate = false;
		return m;
	}

	private buildChunk(c: Chunk): void {
		const city = this.city;
		const base = new THREE.Group();
		const detail = new THREE.Group();
		base.matrixAutoUpdate = false;
		detail.matrixAutoUpdate = false;
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const pos = new THREE.Vector3();
		const scl = new THREE.Vector3();
		const col = new THREE.Color();
		const up = new THREE.Vector3(0, 1, 0);
		const it = c.items;

		// Buildings + roofs.
		if (it.buildings.length) {
			const geo = this.geo.box.clone();
			const styles = new Float32Array(it.buildings.length);
			const mesh = this.instanced(geo, this.mat.building, it.buildings.length, true, true);
			const roofs = it.buildings.filter((i) => city.buildings[i].roof !== 0);
			const roofMesh = roofs.length ? this.instanced(this.geo.prism, this.mat.roof, roofs.length, true, true) : null;
			let r = 0;
			it.buildings.forEach((bi, k) => {
				const b = city.buildings[bi];
				const w = b.maxX - b.minX;
				const d = b.maxZ - b.minZ;
				q.identity();
				m4.compose(pos.set((b.minX + b.maxX) / 2, b.y0, (b.minZ + b.maxZ) / 2), q, scl.set(w, b.h, d));
				mesh.setMatrixAt(k, m4);
				mesh.setColorAt(k, col.setHex(b.color));
				styles[k] = b.style;
				if (b.roof && roofMesh) {
					const alongX = b.roof === 1;
					q.setFromAxisAngle(up, alongX ? 0 : Math.PI / 2);
					m4.compose(pos.set((b.minX + b.maxX) / 2, b.y0 + b.h, (b.minZ + b.maxZ) / 2), q, scl.set(alongX ? w + 0.6 : d + 0.6, 2.5, alongX ? d + 0.6 : w + 0.6));
					roofMesh.setMatrixAt(r, m4);
					roofMesh.setColorAt(r, col.setHex([0x6a3a2a, 0x4a4a52, 0x7a5a3a, 0x3a4a5a][bi % 4]));
					r++;
				}
			});
			geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(styles, 1));
			mesh.computeBoundingSphere();
			base.add(mesh);
			if (roofMesh) {
				roofMesh.computeBoundingSphere();
				base.add(roofMesh);
			}
		}

		// Rooftop neon strips on some downtown / beachfront / financial buildings.
		const neon: number[][] = [[], [], []];
		for (const bi of it.buildings) {
			const b = city.buildings[bi];
			if (b.h < 12 || b.y0 > 0 || (b.district !== 'downtown' && b.district !== 'beachfront' && b.district !== 'financial')) continue;
			const r = ((bi * 2654435761) >>> 0) / 4294967296;
			if (r < 0.75) continue;
			neon[Math.floor(r * 1000) % 3].push(bi);
		}
		neon.forEach((list, ci) => {
			if (!list.length) return;
			const mesh = this.instanced(this.geo.box, this.mat.neon[ci], list.length * 4, false, false);
			let k = 0;
			for (const bi of list) {
				const b = city.buildings[bi];
				const y = b.y0 + b.h - 0.9;
				const cx = (b.minX + b.maxX) / 2;
				const cz = (b.minZ + b.maxZ) / 2;
				const w = b.maxX - b.minX;
				const d = b.maxZ - b.minZ;
				q.identity();
				for (const [px, pz, sx, sz] of [
					[cx, b.minZ - 0.08, w + 0.2, 0.18],
					[cx, b.maxZ + 0.08, w + 0.2, 0.18],
					[b.minX - 0.08, cz, 0.18, d + 0.2],
					[b.maxX + 0.08, cz, 0.18, d + 0.2],
				]) {
					m4.compose(pos.set(px, y, pz), q, scl.set(sx, 0.32, sz));
					mesh.setMatrixAt(k++, m4);
				}
			}
			mesh.computeBoundingSphere();
			base.add(mesh);
		});

		// Ground patches (lots, fields, sand, piers).
		if (it.ground.length) {
			const mesh = this.instanced(this.geo.box, this.mat.ground, it.ground.length, false, true);
			it.ground.forEach((gi, k) => {
				const g = city.ground[gi];
				q.identity();
				m4.compose(pos.set((g.minX + g.maxX) / 2, -1.2, (g.minZ + g.maxZ) / 2), q, scl.set(g.maxX - g.minX, g.y + 1.2, g.maxZ - g.minZ));
				mesh.setMatrixAt(k, m4);
				mesh.setColorAt(k, col.setHex(g.color));
			});
			mesh.computeBoundingSphere();
			base.add(mesh);
		}

		// Visible box props (containers, kiosks).
		if (it.boxes.length) {
			const mesh = this.instanced(this.geo.box, this.mat.prop, it.boxes.length, true, true);
			it.boxes.forEach((bi, k) => {
				const b = city.boxes[bi];
				q.identity();
				m4.compose(pos.set((b.minX + b.maxX) / 2, b.y0, (b.minZ + b.maxZ) / 2), q, scl.set(b.maxX - b.minX, b.h, b.maxZ - b.minZ));
				mesh.setMatrixAt(k, m4);
				mesh.setColorAt(k, col.setHex(b.color));
			});
			mesh.computeBoundingSphere();
			base.add(mesh);
		}

		if (it.cylinders.length) {
			const mesh = this.instanced(this.geo.cyl, this.mat.prop, it.cylinders.length, true, true);
			it.cylinders.forEach((ci, k) => {
				const cy = city.cylinders[ci];
				q.identity();
				m4.compose(pos.set(cy.x, 0, cy.z), q, scl.set(cy.r, cy.h, cy.r));
				mesh.setMatrixAt(k, m4);
				mesh.setColorAt(k, col.setHex(cy.color));
			});
			mesh.computeBoundingSphere();
			base.add(mesh);
		}

		// Trees (detail LOD).
		if (it.trees.length) {
			const trunks = this.instanced(this.geo.trunk, this.mat.trunk, it.trees.length, true, false);
			const oaks = it.trees.filter((i) => city.trees[i].kind === TreeKind.Oak);
			const pines = it.trees.filter((i) => city.trees[i].kind === TreeKind.Pine);
			const palms = it.trees.filter((i) => city.trees[i].kind === TreeKind.Palm);
			it.trees.forEach((ti, k) => {
				const t = city.trees[ti];
				const h = t.kind === TreeKind.Palm ? 7.5 * t.s : t.kind === TreeKind.Pine ? 2.5 * t.s : 3 * t.s;
				q.identity();
				m4.compose(pos.set(t.x, 0, t.z), q, scl.set(t.s, h, t.s));
				trunks.setMatrixAt(k, m4);
			});
			trunks.computeBoundingSphere();
			detail.add(trunks);
			const crown = (list: number[], geo: THREE.BufferGeometry, place: (ti: number) => void) => {
				if (!list.length) return;
				const mesh = this.instanced(geo, this.mat.foliage, list.length, true, false);
				list.forEach((ti, k) => {
					place(ti);
					mesh.setMatrixAt(k, m4);
					const t = city.trees[ti];
					const v = ((ti * 2654435761) >>> 0) / 4294967296;
					mesh.setColorAt(k, col.setHSL(t.kind === TreeKind.Pine ? 0.3 : 0.25 + v * 0.06, 0.45, 0.22 + v * 0.1));
				});
				mesh.computeBoundingSphere();
				detail.add(mesh);
			};
			crown(oaks, this.geo.oak, (ti) => {
				const t = city.trees[ti];
				q.identity();
				m4.compose(pos.set(t.x, 3 * t.s + 1.4 * t.s, t.z), q, scl.set(2.6 * t.s, 2.2 * t.s, 2.6 * t.s));
			});
			crown(pines, this.geo.pine, (ti) => {
				const t = city.trees[ti];
				q.identity();
				m4.compose(pos.set(t.x, 1.8 * t.s, t.z), q, scl.set(2 * t.s, 7 * t.s, 2 * t.s));
			});
			crown(palms, this.geo.palm, (ti) => {
				const t = city.trees[ti];
				q.setFromAxisAngle(up, ti * 1.7);
				m4.compose(pos.set(t.x, 7.5 * t.s, t.z), q, scl.set(t.s, t.s, t.s));
			});
		}

		// Street lamps (detail LOD).
		if (it.lamps.length) {
			const posts = this.instanced(this.geo.lampPost, this.mat.lampPost, it.lamps.length, true, false);
			const heads = this.instanced(this.geo.lampHead, this.mat.lampHead, it.lamps.length, false, false);
			it.lamps.forEach((li, k) => {
				const l = city.lamps[li];
				q.setFromAxisAngle(up, l.heading);
				m4.compose(pos.set(l.x, 0, l.z), q, scl.set(1, 1, 1));
				posts.setMatrixAt(k, m4);
				heads.setMatrixAt(k, m4);
			});
			posts.computeBoundingSphere();
			heads.computeBoundingSphere();
			detail.add(posts, heads);
		}

		// Road / field markings (detail LOD).
		if (it.markings.length) {
			const mesh = this.instanced(this.geo.box, this.mat.marking, it.markings.length, false, true);
			it.markings.forEach((mi, k) => {
				const mk = city.markings[mi];
				q.identity();
				m4.compose(pos.set(mk.x, mk.y - 0.01, mk.z), q, scl.set(mk.w, 0.02, mk.d));
				mesh.setMatrixAt(k, m4);
				mesh.setColorAt(k, col.setHex(mk.color));
			});
			mesh.computeBoundingSphere();
			detail.add(mesh);
		}

		this.root.add(base, detail);
		c.base = base;
		c.detail = detail;
		c.built = true;
	}

	/** Cranes and parked aircraft: few, unique meshes. */
	private buildLandmarks(): void {
		const craneMat = new THREE.MeshLambertMaterial({ color: 0xd8a020 });
		const parts: THREE.BufferGeometry[] = [];
		for (const sx of [-5, 5]) {
			for (const sz of [-6, 6]) {
				const leg = new THREE.BoxGeometry(1.2, 30, 1.2);
				leg.translate(sx, 15, sz);
				parts.push(leg);
			}
		}
		const beam = new THREE.BoxGeometry(12, 2.4, 70);
		beam.translate(0, 31, 14);
		parts.push(beam);
		const cab = new THREE.BoxGeometry(5, 4, 5);
		cab.translate(0, 28, 0);
		parts.push(cab);
		const craneGeo = mergeGeometries(parts)!;
		for (const cr of this.city.cranes) {
			const m = new THREE.Mesh(craneGeo, craneMat);
			m.position.set(cr.x, 0, cr.z);
			m.rotation.y = cr.heading;
			m.castShadow = true;
			this.root.add(m);
		}
		// Aircraft.
		const fus = new THREE.CylinderGeometry(2, 2, 34, 12);
		fus.rotateX(Math.PI / 2);
		fus.translate(0, 3.5, 0);
		const wing = new THREE.BoxGeometry(34, 0.6, 6);
		wing.translate(0, 3, 1);
		const tail = new THREE.BoxGeometry(0.5, 7, 4);
		tail.translate(0, 7.5, -15);
		const stab = new THREE.BoxGeometry(12, 0.4, 3);
		stab.translate(0, 4, -15);
		const nose = new THREE.SphereGeometry(2, 10, 8);
		nose.translate(0, 3.5, 17);
		const planeGeo = mergeGeometries([fus, wing, tail, stab, nose])!;
		for (const a of this.city.aircraft) {
			const m = new THREE.Mesh(planeGeo, new THREE.MeshLambertMaterial({ color: a.color }));
			m.position.set(a.x, 0, a.z);
			m.rotation.y = a.heading;
			m.castShadow = true;
			this.root.add(m);
		}
	}

	private buildDistantHills(): void {
		const mat = new THREE.MeshLambertMaterial({ color: 0x3f5a35, flatShading: true });
		const geo = new THREE.ConeGeometry(1, 1, 7);
		geo.translate(0, 0.5, 0);
		const L = this.city.land;
		const count = 60;
		const mesh = new THREE.InstancedMesh(geo, mat, count);
		const m4 = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		let k = 0;
		for (let i = 0; i < 30; i++) {
			const x = L.minX + (i / 29) * (L.maxX - L.minX + 400);
			const s = 160 + ((i * 97) % 120);
			m4.compose(new THREE.Vector3(x, -2, L.minZ - 160 - ((i * 53) % 140)), q, new THREE.Vector3(s, 70 + ((i * 31) % 90), s));
			mesh.setMatrixAt(k++, m4);
		}
		for (let i = 0; i < 30; i++) {
			const z = L.minZ + (i / 29) * (L.maxZ - L.minZ);
			const s = 160 + ((i * 89) % 120);
			m4.compose(new THREE.Vector3(L.minX - 160 - ((i * 41) % 140), -2, z), q, new THREE.Vector3(s, 70 + ((i * 37) % 90), s));
			mesh.setMatrixAt(k++, m4);
		}
		mesh.computeBoundingSphere();
		this.root.add(mesh);
	}

	/** Storefront signs with generated text textures. */
	private buildSigns(): void {
		for (const p of this.city.pois) {
			const canvas = document.createElement('canvas');
			canvas.width = 512;
			canvas.height = 96;
			const g = canvas.getContext('2d')!;
			const hex = '#' + p.sign.toString(16).padStart(6, '0');
			g.fillStyle = '#101018';
			g.fillRect(0, 0, 512, 96);
			g.strokeStyle = hex;
			g.lineWidth = 6;
			g.strokeRect(4, 4, 504, 88);
			g.fillStyle = hex;
			g.font = 'bold 40px "Trebuchet MS", "Segoe UI", sans-serif';
			g.textAlign = 'center';
			g.textBaseline = 'middle';
			const label = p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name;
			g.fillText(label.toUpperCase(), 256, 50);
			const tex = new THREE.CanvasTexture(canvas);
			tex.colorSpace = THREE.SRGBColorSpace;
			const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
			mat.userData.glow = { dayIntensity: 0.25, nightIntensity: 1.3 };
			this.mat.sign.set(this.mat.sign.size, mat);
			const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), mat);
			const fx = Math.sin(p.facing);
			const fz = Math.cos(p.facing);
			// Mounted on the facade above the door.
			const bx = p.x - fx * 1.9;
			const bz = p.z - fz * 1.9;
			sign.position.set(bx, 4.2, bz);
			sign.rotation.y = p.facing;
			this.root.add(sign);
		}
	}
}
