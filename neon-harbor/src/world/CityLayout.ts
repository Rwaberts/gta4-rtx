// Procedural, deterministic layout of Neon Harbor. Pure data (no Three.js) so it can be
// generated and unit-tested in Node. Renderers, collision, navigation and AI all read from it.

import { WORLD } from '../data/config';
import { AIRPORT_RECT, DISTRICTS, DISTRICT_SEEDS, WindowStyle, type DistrictId } from '../data/districts';
import { POI_DEFS, type InteriorId, type PoiKind } from '../data/pois';
import { Random } from '../core/Random';
import { clamp } from '../core/math';

export interface Rect {
	minX: number;
	minZ: number;
	maxX: number;
	maxZ: number;
}

export interface Building extends Rect {
	y0: number;
	h: number;
	color: number;
	style: WindowStyle;
	/** 0 = flat, 1 = gable roof along X, 2 = gable roof along Z. */
	roof: 0 | 1 | 2;
	district: DistrictId;
}

export const TreeKind = { Oak: 0, Palm: 1, Pine: 2 } as const;
export type TreeKind = (typeof TreeKind)[keyof typeof TreeKind];

export interface Tree {
	x: number;
	z: number;
	s: number;
	kind: TreeKind;
}

export interface BoxProp extends Rect {
	y0: number;
	h: number;
	color: number;
	solid: boolean;
	/** Invisible blockers (map edge) are not rendered. */
	visible: boolean;
}

export interface Cylinder {
	x: number;
	z: number;
	r: number;
	h: number;
	color: number;
}

export interface Lamp {
	x: number;
	z: number;
	/** Direction the lamp arm points (towards the road). */
	heading: number;
}

export interface GroundPatch extends Rect {
	y: number;
	color: number;
}

export interface Marking {
	x: number;
	z: number;
	w: number;
	d: number;
	y: number;
	color: number;
}

export interface Crane {
	x: number;
	z: number;
	heading: number;
}

export interface Aircraft {
	x: number;
	z: number;
	heading: number;
	color: number;
}

export interface RoadNode {
	id: number;
	i: number;
	j: number;
	x: number;
	z: number;
	/** Undirected edge ids. */
	edges: number[];
	signal: boolean;
	/** Signal phase offset in seconds. */
	phase: number;
	district: DistrictId;
}

export interface RoadEdge {
	id: number;
	a: number;
	b: number;
	horizontal: boolean;
	district: DistrictId;
}

export type CellKind = 'block' | 'park' | 'field' | 'airport' | 'poi';

export interface Cell {
	i: number;
	j: number;
	district: DistrictId;
	kind: CellKind;
	/** Lot area inside the curbs. */
	lot: Rect;
	/** Road presence on each side: north (-z), south (+z), west (-x), east (+x). */
	roads: { n: boolean; s: boolean; w: boolean; e: boolean };
}

export interface Poi {
	id: string;
	kind: PoiKind;
	name: string;
	/** Door / marker position on the sidewalk. */
	x: number;
	z: number;
	/** Heading that faces out of the building towards the road. */
	facing: number;
	interior?: InteriorId;
	sign: number;
	district: DistrictId;
	building: Building;
}

const CONTAINER_COLORS = [0xa8432f, 0x2f5fa8, 0x3f8a4a, 0xd8862a, 0x7a7f86, 0x8a2f5f, 0xc8b02a, 0x2a8a8a];
const FIELD_COLORS = [0x7d9a3e, 0xc8b25a, 0x8a6a42, 0x6a8a3a, 0xb8a050];
const SIDEWALK_COLOR = 0xa9a6a0;

function mod(a: number, n: number): number {
	return ((a % n) + n) % n;
}

export function rectOverlap(a: Rect, b: Rect, pad = 0): boolean {
	return a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
}

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
	return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

function inset(r: Rect, n: number, s: number, w: number, e: number): Rect {
	return { minX: r.minX + w, maxX: r.maxX - e, minZ: r.minZ + n, maxZ: r.maxZ - s };
}

export class CityLayout {
	readonly cellSize = WORLD.cell;
	readonly nx = WORLD.gridMaxX - WORLD.gridMinX + 1;
	readonly nz = WORLD.gridMaxZ - WORLD.gridMinZ + 1;

	readonly nodes: Array<RoadNode | null> = [];
	readonly nodeList: RoadNode[] = [];
	readonly edges: RoadEdge[] = [];
	readonly cells: Cell[] = [];
	readonly buildings: Building[] = [];
	readonly trees: Tree[] = [];
	readonly boxes: BoxProp[] = [];
	readonly cylinders: Cylinder[] = [];
	readonly lamps: Lamp[] = [];
	readonly ground: GroundPatch[] = [];
	readonly markings: Marking[] = [];
	readonly cranes: Crane[] = [];
	readonly aircraft: Aircraft[] = [];
	readonly piers: Rect[] = [];
	readonly pois: Poi[] = [];
	readonly land: Rect = { minX: WORLD.landMinX, minZ: WORLD.landMinZ, maxX: WORLD.landMaxX, maxZ: WORLD.landMaxZ };
	readonly runway: Rect = { minX: 560, maxX: 1240, minZ: -1190, maxZ: -1145 };

	private hEdge = new Map<number, number>();
	private vEdge = new Map<number, number>();
	private reserved = new Map<number, Rect[]>();

	constructor(readonly seed: number) {}

	// ------------------------------------------------------------------ queries

	districtAt(x: number, z: number): DistrictId {
		const a = AIRPORT_RECT;
		if (x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ) return 'airport';
		if (z > WORLD.gridMaxZ * this.cellSize) return x > 900 ? 'harbor' : 'beachfront';
		if (x > WORLD.gridMaxX * this.cellSize) return z < -800 ? 'airport' : z < 100 ? 'industrial' : 'harbor';
		let best: DistrictId = 'downtown';
		let bestD = Infinity;
		for (const s of DISTRICT_SEEDS) {
			const dx = x - s.x;
			const dz = z - s.z;
			const d = (dx * dx + dz * dz) / (s.w * s.w);
			if (d < bestD) {
				bestD = d;
				best = s.id;
			}
		}
		return best;
	}

	isLand(x: number, z: number): boolean {
		if (rectContains(this.land, x, z)) return true;
		// Interior rooms live far outside the city on solid ground.
		if (x > WORLD.interiorOrigin.x - 100 && z > WORLD.interiorOrigin.z - 100) return true;
		for (const p of this.piers) if (rectContains(p, x, z)) return true;
		return false;
	}

	nodeIndex(i: number, j: number): number {
		return i - WORLD.gridMinX + (j - WORLD.gridMinZ) * this.nx;
	}

	nodeAt(i: number, j: number): RoadNode | null {
		if (i < WORLD.gridMinX || i > WORLD.gridMaxX || j < WORLD.gridMinZ || j > WORLD.gridMaxZ) return null;
		return this.nodes[this.nodeIndex(i, j)] ?? null;
	}

	/** Undirected edge between grid nodes, if it exists. */
	edgeBetween(i0: number, j0: number, i1: number, j1: number): RoadEdge | null {
		let id: number | undefined;
		if (j0 === j1 && Math.abs(i1 - i0) === 1) id = this.hEdge.get(this.nodeIndex(Math.min(i0, i1), j0));
		else if (i0 === i1 && Math.abs(j1 - j0) === 1) id = this.vEdge.get(this.nodeIndex(i0, Math.min(j0, j1)));
		return id === undefined ? null : this.edges[id];
	}

	cellAt(x: number, z: number): Cell | null {
		const i = Math.floor(x / this.cellSize);
		const j = Math.floor(z / this.cellSize);
		if (i < WORLD.gridMinX || i >= WORLD.gridMaxX || j < WORLD.gridMinZ || j >= WORLD.gridMaxZ) return null;
		return this.cells[i - WORLD.gridMinX + (j - WORLD.gridMinZ) * (this.nx - 1)] ?? null;
	}

	/** Cell by grid indices (cell (i, j) spans x in [i, i+1) * cellSize). */
	cellIJ(i: number, j: number): Cell | null {
		if (i < WORLD.gridMinX || i >= WORLD.gridMaxX || j < WORLD.gridMinZ || j >= WORLD.gridMaxZ) return null;
		return this.cells[i - WORLD.gridMinX + (j - WORLD.gridMinZ) * (this.nx - 1)] ?? null;
	}

	/** Nearest existing road node to a world position. */
	nearestNode(x: number, z: number): RoadNode | null {
		let best: RoadNode | null = null;
		let bestD = Infinity;
		const ci = Math.round(x / this.cellSize);
		const cj = Math.round(z / this.cellSize);
		for (let r = 0; r <= 6 && !best; r++) {
			for (let di = -r; di <= r; di++) {
				for (let dj = -r; dj <= r; dj++) {
					if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
					const n = this.nodeAt(ci + di, cj + dj);
					if (!n) continue;
					const d = (n.x - x) ** 2 + (n.z - z) ** 2;
					if (d < bestD) {
						bestD = d;
						best = n;
					}
				}
			}
		}
		return best;
	}

	/** True when (x, z) lies on a road surface (including intersections). */
	isOnRoad(x: number, z: number): boolean {
		const c = this.cellSize;
		const h = WORLD.roadHalf;
		const i = Math.round(x / c);
		const j = Math.round(z / c);
		const dx = Math.abs(x - i * c);
		const dz = Math.abs(z - j * c);
		if (dx <= h && dz <= h) return this.nodeAt(i, j) !== null;
		if (dx <= h) {
			const j0 = Math.floor(z / c);
			return this.edgeBetween(i, j0, i, j0 + 1) !== null;
		}
		if (dz <= h) {
			const i0 = Math.floor(x / c);
			return this.edgeBetween(i0, j, i0 + 1, j) !== null;
		}
		return false;
	}

	/** Visits every solid collider as an axis-aligned box. */
	forEachSolid(fn: (minX: number, minZ: number, maxX: number, maxZ: number, y0: number, y1: number) => void): void {
		for (const b of this.buildings) fn(b.minX, b.minZ, b.maxX, b.maxZ, b.y0, b.y0 + b.h + (b.roof ? 2.5 : 0));
		for (const b of this.boxes) if (b.solid) fn(b.minX, b.minZ, b.maxX, b.maxZ, b.y0, b.y0 + b.h);
		for (const c of this.cylinders) fn(c.x - c.r * 0.85, c.z - c.r * 0.85, c.x + c.r * 0.85, c.z + c.r * 0.85, 0, c.h);
		for (const t of this.trees) {
			const r = t.kind === TreeKind.Palm ? 0.25 : 0.35 * t.s;
			fn(t.x - r, t.z - r, t.x + r, t.z + r, 0, 4 * t.s);
		}
		for (const c of this.cranes) {
			// Two leg pairs of a gantry crane.
			const fx = Math.sin(c.heading);
			const fz = Math.cos(c.heading);
			for (const s of [-1, 1]) {
				for (const f of [-6, 6]) {
					const px = c.x + fx * f + -fz * s * 5;
					const pz = c.z + fz * f + fx * s * 5;
					fn(px - 0.6, pz - 0.6, px + 0.6, pz + 0.6, 0, 30);
				}
			}
		}
	}

	poi(id: string): Poi | undefined {
		return this.pois.find((p) => p.id === id);
	}

	// --------------------------------------------------------------- generation

	generate(): this {
		this.buildRoads();
		this.buildCells();
		this.resolvePois();
		const rng = new Random(this.seed);
		for (const cell of this.cells) this.generateCell(cell, rng.fork(cell.i * 7919 + cell.j * 104729));
		this.generateMargins(rng.fork(17));
		this.generateAirport(rng.fork(23));
		this.generateStreetDetail(rng.fork(31));
		return this;
	}

	private buildRoads(): void {
		const c = this.cellSize;
		const { gridMinX, gridMaxX, gridMinZ, gridMaxZ } = WORLD;
		const a = AIRPORT_RECT;
		const insideAirport = (i: number, j: number) => {
			const x = i * c;
			const z = j * c;
			return x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ;
		};
		const keep = (i0: number, j0: number, i1: number, j1: number, horizontal: boolean): boolean => {
			const border = horizontal ? j0 === gridMinZ || j0 === gridMaxZ : i0 === gridMinX || i0 === gridMaxX;
			if (insideAirport(i0, j0) || insideAirport(i1, j1)) return false;
			if (border) return true;
			const d = this.districtAt(((i0 + i1) / 2) * c, ((j0 + j1) / 2) * c);
			if (d === 'rural') return horizontal ? mod(j0, 3) === 0 : mod(i0, 3) === 0;
			return true;
		};

		// Candidate edges.
		type Cand = { i0: number; j0: number; i1: number; j1: number; h: boolean; alive: boolean };
		const cands: Cand[] = [];
		for (let j = gridMinZ; j <= gridMaxZ; j++) {
			for (let i = gridMinX; i <= gridMaxX; i++) {
				if (i < gridMaxX && keep(i, j, i + 1, j, true)) cands.push({ i0: i, j0: j, i1: i + 1, j1: j, h: true, alive: true });
				if (j < gridMaxZ && keep(i, j, i, j + 1, false)) cands.push({ i0: i, j0: j, i1: i, j1: j + 1, h: false, alive: true });
			}
		}

		// Prune dead ends repeatedly so traffic never needs U-turns.
		const degree = new Map<number, number>();
		const k = (i: number, j: number) => this.nodeIndex(i, j);
		const recount = () => {
			degree.clear();
			for (const e of cands) {
				if (!e.alive) continue;
				degree.set(k(e.i0, e.j0), (degree.get(k(e.i0, e.j0)) ?? 0) + 1);
				degree.set(k(e.i1, e.j1), (degree.get(k(e.i1, e.j1)) ?? 0) + 1);
			}
		};
		for (let pass = 0; pass < 50; pass++) {
			recount();
			let removed = 0;
			for (const e of cands) {
				if (!e.alive) continue;
				if ((degree.get(k(e.i0, e.j0)) ?? 0) <= 1 || (degree.get(k(e.i1, e.j1)) ?? 0) <= 1) {
					e.alive = false;
					removed++;
				}
			}
			if (removed === 0) break;
		}

		// Keep the largest connected component.
		const adj = new Map<number, number[]>();
		for (const e of cands) {
			if (!e.alive) continue;
			const ka = k(e.i0, e.j0);
			const kb = k(e.i1, e.j1);
			(adj.get(ka) ?? adj.set(ka, []).get(ka)!).push(kb);
			(adj.get(kb) ?? adj.set(kb, []).get(kb)!).push(ka);
		}
		const comp = new Map<number, number>();
		let bestComp = -1;
		let bestSize = 0;
		let compId = 0;
		for (const start of adj.keys()) {
			if (comp.has(start)) continue;
			const stack = [start];
			comp.set(start, compId);
			let size = 0;
			while (stack.length) {
				const n = stack.pop()!;
				size++;
				for (const m of adj.get(n)!) {
					if (!comp.has(m)) {
						comp.set(m, compId);
						stack.push(m);
					}
				}
			}
			if (size > bestSize) {
				bestSize = size;
				bestComp = compId;
			}
			compId++;
		}

		this.nodes.length = this.nx * this.nz;
		this.nodes.fill(null);
		const ensureNode = (i: number, j: number): RoadNode => {
			const idx = k(i, j);
			let n = this.nodes[idx];
			if (!n) {
				n = { id: idx, i, j, x: i * c, z: j * c, edges: [], signal: false, phase: 0, district: this.districtAt(i * c, j * c) };
				this.nodes[idx] = n;
				this.nodeList.push(n);
			}
			return n;
		};
		for (const e of cands) {
			if (!e.alive || comp.get(k(e.i0, e.j0)) !== bestComp) continue;
			const na = ensureNode(e.i0, e.j0);
			const nb = ensureNode(e.i1, e.j1);
			const id = this.edges.length;
			const d = this.districtAt(((e.i0 + e.i1) / 2) * c, ((e.j0 + e.j1) / 2) * c);
			this.edges.push({ id, a: na.id, b: nb.id, horizontal: e.h, district: d });
			na.edges.push(id);
			nb.edges.push(id);
			(e.h ? this.hEdge : this.vEdge).set(k(e.i0, e.j0), id);
		}

		// Traffic signals at busy intersections.
		const rng = new Random(this.seed ^ 0x5151);
		for (const n of this.nodeList) {
			const deg = n.edges.length;
			const busy = n.district === 'downtown' || n.district === 'financial' || n.district === 'beachfront';
			const some = n.district === 'residential' || n.district === 'industrial' || n.district === 'harbor';
			n.signal = deg >= 3 && (busy || (some && deg === 4 && rng.chance(0.45)));
			n.phase = rng.range(0, 30);
		}
	}

	private buildCells(): void {
		const c = this.cellSize;
		const h = WORLD.roadHalf;
		for (let j = WORLD.gridMinZ; j < WORLD.gridMaxZ; j++) {
			for (let i = WORLD.gridMinX; i < WORLD.gridMaxX; i++) {
				const cellRect: Rect = { minX: i * c, maxX: (i + 1) * c, minZ: j * c, maxZ: (j + 1) * c };
				const side = (i0: number, j0: number, i1: number, j1: number) =>
					this.edgeBetween(i0, j0, i1, j1) !== null || this.nodeAt(i0, j0) !== null || this.nodeAt(i1, j1) !== null;
				const roads = {
					n: this.edgeBetween(i, j, i + 1, j) !== null,
					s: this.edgeBetween(i, j + 1, i + 1, j + 1) !== null,
					w: this.edgeBetween(i, j, i, j + 1) !== null,
					e: this.edgeBetween(i + 1, j, i + 1, j + 1) !== null,
				};
				const lot = inset(
					cellRect,
					side(i, j, i + 1, j) ? h : 0,
					side(i, j + 1, i + 1, j + 1) ? h : 0,
					side(i, j, i, j + 1) ? h : 0,
					side(i + 1, j, i + 1, j + 1) ? h : 0,
				);
				const cx = (i + 0.5) * c;
				const cz = (j + 0.5) * c;
				const district = this.districtAt(cx, cz);
				let kind: CellKind = 'block';
				if (district === 'airport') kind = 'airport';
				else if (district === 'rural') kind = 'field';
				this.cells.push({ i, j, district, kind, lot, roads });
			}
		}
		// Parks are chosen after POIs reserve their cells (see generateCell).
	}

	private resolvePois(): void {
		const sw = WORLD.sidewalk;
		for (const def of POI_DEFS) {
			const cell = this.cellAt(clamp(def.x, WORLD.gridMinX * 100 + 1, WORLD.gridMaxX * 100 - 1), clamp(def.z, WORLD.gridMinZ * 100 + 1, WORLD.gridMaxZ * 100 - 1));
			if (!cell) continue;
			const L = cell.lot;
			type Side = { key: 'n' | 's' | 'w' | 'e'; dist: number };
			const sides: Side[] = [
				{ key: 'n', dist: Math.abs(def.z - L.minZ) },
				{ key: 's', dist: Math.abs(def.z - L.maxZ) },
				{ key: 'w', dist: Math.abs(def.x - L.minX) },
				{ key: 'e', dist: Math.abs(def.x - L.maxX) },
			];
			const withRoad = sides.filter((s) => cell.roads[s.key]).sort((a, b) => a.dist - b.dist);
			const side = (withRoad[0] ?? sides.sort((a, b) => a.dist - b.dist)[0]).key;
			let x: number;
			let z: number;
			let facing: number;
			let bld: Rect;
			const halfW = 11;
			const depth = 18;
			if (side === 'n' || side === 's') {
				x = clamp(def.x, L.minX + 16, L.maxX - 16);
				z = side === 'n' ? L.minZ + sw / 2 : L.maxZ - sw / 2;
				facing = side === 'n' ? Math.PI : 0;
				const z0 = side === 'n' ? L.minZ + sw : L.maxZ - sw - depth;
				bld = { minX: x - halfW, maxX: x + halfW, minZ: z0, maxZ: z0 + depth };
			} else {
				z = clamp(def.z, L.minZ + 16, L.maxZ - 16);
				x = side === 'w' ? L.minX + sw / 2 : L.maxX - sw / 2;
				facing = side === 'w' ? -Math.PI / 2 : Math.PI / 2;
				const x0 = side === 'w' ? L.minX + sw : L.maxX - sw - depth;
				bld = { minX: x0, maxX: x0 + depth, minZ: z - halfW, maxZ: z + halfW };
			}
			const d = DISTRICTS[cell.district];
			const building: Building = {
				...bld,
				y0: 0,
				h: def.kind === 'hospital' || def.kind === 'police' ? 22 : 10 + (Math.abs(def.x * 7 + def.z * 13) % 4),
				color: d.buildingPalette[Math.abs(Math.floor(def.x + def.z)) % d.buildingPalette.length],
				style: def.kind === 'property' && def.id === 'prop_warehouse' ? WindowStyle.Industrial : WindowStyle.Office,
				roof: 0,
				district: cell.district,
			};
			this.buildings.push(building);
			if (cell.kind !== 'airport') cell.kind = cell.kind === 'field' ? 'field' : 'poi';
			const key = cell.i * 1000 + cell.j;
			const list = this.reserved.get(key) ?? [];
			list.push({ minX: bld.minX - 3, maxX: bld.maxX + 3, minZ: bld.minZ - 3, maxZ: bld.maxZ + 3 });
			// Keep the door area clear.
			list.push({ minX: x - 4, maxX: x + 4, minZ: z - 4, maxZ: z + 4 });
			this.reserved.set(key, list);
			this.pois.push({ id: def.id, kind: def.kind, name: def.name, x, z, facing, interior: def.interior, sign: def.sign, district: cell.district, building });
		}
	}

	// ----------------------------------------------------------- per-cell generators

	private addBuilding(cell: Cell, r: Rect, h: number, color: number, style: WindowStyle, roof: 0 | 1 | 2 = 0, y0 = 0): boolean {
		if (r.maxX - r.minX < 3 || r.maxZ - r.minZ < 3 || h <= 0) return false;
		const res = this.reserved.get(cell.i * 1000 + cell.j);
		if (res) for (const q of res) if (rectOverlap(r, q)) return false;
		this.buildings.push({ ...r, y0, h, color, style, roof, district: cell.district });
		return true;
	}

	private isReserved(cell: Cell, r: Rect, pad = 0): boolean {
		const res = this.reserved.get(cell.i * 1000 + cell.j);
		if (res) for (const q of res) if (rectOverlap(r, q, pad)) return true;
		return false;
	}

	private addTree(cell: Cell | null, x: number, z: number, s: number, kind: TreeKind): void {
		if (cell && this.isReserved(cell, { minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1 })) return;
		this.trees.push({ x, z, s, kind });
	}

	private generateCell(cell: Cell, rng: Random): void {
		const L = cell.lot;
		const d = DISTRICTS[cell.district];
		const sw = WORLD.sidewalk;
		// Sidewalk slab and inner ground.
		this.ground.push({ ...L, y: 0.14, color: cell.kind === 'field' ? d.groundColor : SIDEWALK_COLOR });
		const inner = inset(L, cell.roads.n ? sw : 1, cell.roads.s ? sw : 1, cell.roads.w ? sw : 1, cell.roads.e ? sw : 1);
		if (cell.kind === 'airport') return;
		if (cell.kind === 'block') {
			const parkChance = cell.district === 'downtown' ? 0.1 : cell.district === 'residential' ? 0.08 : cell.district === 'financial' ? 0.08 : cell.district === 'beachfront' ? 0.1 : 0;
			if (rng.chance(parkChance)) cell.kind = 'park';
		}
		if (cell.kind === 'park') {
			this.genPark(cell, inner, rng);
			return;
		}
		if (cell.kind !== 'field') this.ground.push({ ...inner, y: 0.16, color: d.groundColor });
		switch (cell.district) {
			case 'financial':
				this.genFinancial(cell, inner, rng);
				break;
			case 'downtown':
				this.genPerimeter(cell, inner, rng, 12, 48, 0.18, 55, 95);
				break;
			case 'beachfront':
				this.genPerimeter(cell, inner, rng, 6, 22, 0.08, 24, 36);
				break;
			case 'residential':
				if (rng.chance(0.14)) this.genApartments(cell, inner, rng);
				else this.genHouses(cell, inner, rng);
				break;
			case 'industrial':
				this.genIndustrial(cell, inner, rng);
				break;
			case 'harbor':
				this.genHarbor(cell, inner, rng);
				break;
			case 'rural':
				this.genRural(cell, L, rng);
				break;
			case 'airport':
				break;
		}
	}

	private genPark(cell: Cell, r: Rect, rng: Random): void {
		const beach = cell.district === 'beachfront';
		this.ground.push({ ...r, y: 0.17, color: beach ? 0xd9cfae : 0x5f8f45 });
		const cx = (r.minX + r.maxX) / 2;
		const cz = (r.minZ + r.maxZ) / 2;
		// Cross paths.
		this.markings.push({ x: cx, z: cz, w: r.maxX - r.minX, d: 3, y: 0.18, color: 0xb8b0a0 });
		this.markings.push({ x: cx, z: cz, w: 3, d: r.maxZ - r.minZ, y: 0.18, color: 0xb8b0a0 });
		if (cell.district !== 'residential') this.cylinders.push({ x: cx, z: cz, r: 4, h: 1.1, color: 0x9fb8c8 });
		const n = rng.int(8, 16);
		for (let k = 0; k < n; k++) {
			const x = rng.range(r.minX + 4, r.maxX - 4);
			const z = rng.range(r.minZ + 4, r.maxZ - 4);
			if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
			this.addTree(cell, x, z, rng.range(0.8, 1.4), beach ? TreeKind.Palm : TreeKind.Oak);
		}
	}

	private genFinancial(cell: Cell, r: Rect, rng: Random): void {
		const d = DISTRICTS.financial;
		const parts: Rect[] = [];
		const w = r.maxX - r.minX;
		const gap = 8;
		const roll = rng.next();
		if (roll < 0.35) parts.push(r);
		else if (roll < 0.7) {
			const mx = (r.minX + r.maxX) / 2;
			parts.push({ ...r, maxX: mx - gap / 2 }, { ...r, minX: mx + gap / 2 });
		} else {
			const mx = (r.minX + r.maxX) / 2;
			const mz = (r.minZ + r.maxZ) / 2;
			parts.push(
				{ minX: r.minX, maxX: mx - gap / 2, minZ: r.minZ, maxZ: mz - gap / 2 },
				{ minX: mx + gap / 2, maxX: r.maxX, minZ: r.minZ, maxZ: mz - gap / 2 },
				{ minX: r.minX, maxX: mx - gap / 2, minZ: mz + gap / 2, maxZ: r.maxZ },
				{ minX: mx + gap / 2, maxX: r.maxX, minZ: mz + gap / 2, maxZ: r.maxZ },
			);
		}
		const cx = (r.minX + r.maxX) / 2;
		const cz = (r.minZ + r.maxZ) / 2;
		const distToCore = Math.hypot(cx - 0, cz + 470);
		const boost = clamp(1.5 - distToCore / 500, 0.5, 1.5);
		for (const p of parts) {
			const ins = rng.range(1, 4);
			const pr = inset(p, ins, ins, ins, ins);
			const color = rng.pick(d.buildingPalette);
			const h = (35 + rng.range(0, 110)) * boost * (w < 60 ? 0.7 : 1);
			if (rng.chance(0.4)) {
				this.addBuilding(cell, pr, rng.range(9, 15), rng.pick(DISTRICTS.downtown.buildingPalette), WindowStyle.Office);
				const t = rng.range(4, 8);
				this.addBuilding(cell, inset(pr, t, t, t, t), h, color, WindowStyle.Glass);
			} else if (this.addBuilding(cell, pr, h, color, WindowStyle.Glass) && rng.chance(0.35)) {
				const t = rng.range(3, 6);
				this.addBuilding(cell, inset(pr, t, t, t, t), rng.range(8, 30), color, WindowStyle.Glass, 0, h);
			}
		}
	}

	/** Perimeter block: buildings line every side of the lot, leaving a courtyard. */
	private genPerimeter(cell: Cell, r: Rect, rng: Random, hMin: number, hMax: number, tallChance: number, tallMin: number, tallMax: number): void {
		const d = DISTRICTS[cell.district];
		const W = r.maxX - r.minX;
		const D = r.maxZ - r.minZ;
		const depthN = Math.min(rng.range(14, 24), D / 2 - 3);
		const depthS = Math.min(rng.range(14, 24), D / 2 - 3);
		const depthW = Math.min(rng.range(14, 22), W / 2 - 3);
		const depthE = Math.min(rng.range(14, 22), W / 2 - 3);
		const pickH = () => (rng.chance(tallChance) ? rng.range(tallMin, tallMax) : rng.range(hMin, hMax));
		const style = cell.district === 'beachfront' ? WindowStyle.Residential : WindowStyle.Office;
		const run = (from: number, to: number, place: (a: number, b: number) => void) => {
			let a = from;
			while (to - a > 6) {
				let b = Math.min(to, a + rng.range(14, 30));
				if (to - b < 10) b = to;
				place(a, b);
				a = b;
			}
		};
		run(r.minX, r.maxX, (a, b) => this.addBuilding(cell, { minX: a, maxX: b, minZ: r.minZ, maxZ: r.minZ + depthN }, pickH(), rng.pick(d.buildingPalette), rng.chance(0.25) ? WindowStyle.Residential : style));
		run(r.minX, r.maxX, (a, b) => this.addBuilding(cell, { minX: a, maxX: b, minZ: r.maxZ - depthS, maxZ: r.maxZ }, pickH(), rng.pick(d.buildingPalette), rng.chance(0.25) ? WindowStyle.Residential : style));
		run(r.minZ + depthN, r.maxZ - depthS, (a, b) => this.addBuilding(cell, { minX: r.minX, maxX: r.minX + depthW, minZ: a, maxZ: b }, pickH(), rng.pick(d.buildingPalette), style));
		run(r.minZ + depthN, r.maxZ - depthS, (a, b) => this.addBuilding(cell, { minX: r.maxX - depthE, maxX: r.maxX, minZ: a, maxZ: b }, pickH(), rng.pick(d.buildingPalette), style));
		if (cell.district === 'beachfront') {
			// Palms along the outer sidewalk.
			const L = cell.lot;
			for (let x = L.minX + 10; x < L.maxX - 6; x += 22) {
				if (cell.roads.s) this.addTree(cell, x, L.maxZ - 1.2, rng.range(0.9, 1.2), TreeKind.Palm);
				if (cell.roads.n) this.addTree(cell, x + 11, L.minZ + 1.2, rng.range(0.9, 1.2), TreeKind.Palm);
			}
		} else if (rng.chance(0.4)) {
			const cx = (r.minX + r.maxX) / 2;
			const cz = (r.minZ + r.maxZ) / 2;
			this.addTree(cell, cx, cz, 1.3, TreeKind.Oak);
		}
	}

	private genHouses(cell: Cell, r: Rect, rng: Random): void {
		const d = DISTRICTS.residential;
		const frontage = 24;
		const setback = 5;
		const placeRow = (alongX: boolean, edge: number, dir: 1 | -1, from: number, to: number) => {
			for (let a = from; a + frontage <= to + 0.01; a += frontage) {
				const w = rng.range(10, 15);
				const dd = rng.range(9, 12);
				const c = a + frontage / 2 + rng.range(-2, 2);
				const near = edge + dir * setback;
				const far = near + dir * dd;
				const rect: Rect = alongX
					? { minX: c - w / 2, maxX: c + w / 2, minZ: Math.min(near, far), maxZ: Math.max(near, far) }
					: { minX: Math.min(near, far), maxX: Math.max(near, far), minZ: c - w / 2, maxZ: c + w / 2 };
				const h = rng.range(4, 6.5) * (rng.chance(0.25) ? 1.6 : 1);
				this.addBuilding(cell, rect, h, rng.pick(d.buildingPalette), WindowStyle.Residential, alongX ? 1 : 2);
				// Driveway.
				if (alongX) this.markings.push({ x: c + w / 2 + 2, z: (edge + near) / 2, w: 3.2, d: setback, y: 0.17, color: 0x8a8a86 });
				else this.markings.push({ x: (edge + near) / 2, z: c + w / 2 + 2, w: setback, d: 3.2, y: 0.17, color: 0x8a8a86 });
				// Backyard tree.
				if (rng.chance(0.55)) {
					const back = far + dir * rng.range(4, 7);
					if (alongX) this.addTree(cell, c + rng.range(-4, 4), back, rng.range(0.8, 1.3), TreeKind.Oak);
					else this.addTree(cell, back, c + rng.range(-4, 4), rng.range(0.8, 1.3), TreeKind.Oak);
				}
			}
		};
		const W = r.maxX - r.minX;
		const D = r.maxZ - r.minZ;
		const margin = (W - Math.floor(W / frontage) * frontage) / 2;
		placeRow(true, r.minZ, 1, r.minX + margin, r.maxX - margin);
		placeRow(true, r.maxZ, -1, r.minX + margin, r.maxX - margin);
		if (D > 70) {
			const innerFrom = r.minZ + 26;
			const innerTo = r.maxZ - 26;
			const m2 = (innerTo - innerFrom - Math.floor((innerTo - innerFrom) / frontage) * frontage) / 2;
			placeRow(false, r.minX, 1, innerFrom + m2, innerTo - m2);
			placeRow(false, r.maxX, -1, innerFrom + m2, innerTo - m2);
		}
		// Street trees.
		const L = cell.lot;
		if (cell.roads.n) for (let x = L.minX + 14; x < L.maxX - 8; x += 26) this.addTree(cell, x, L.minZ + 1.3, rng.range(0.8, 1.1), TreeKind.Oak);
		if (cell.roads.s) for (let x = L.minX + 27; x < L.maxX - 8; x += 26) this.addTree(cell, x, L.maxZ - 1.3, rng.range(0.8, 1.1), TreeKind.Oak);
	}

	private genApartments(cell: Cell, r: Rect, rng: Random): void {
		const d = DISTRICTS.residential;
		const mz = (r.minZ + r.maxZ) / 2;
		this.addBuilding(cell, inset({ ...r, maxZ: mz - 6 }, 4, 2, 6, 6), rng.range(12, 22), rng.pick(d.buildingPalette), WindowStyle.Residential);
		this.addBuilding(cell, inset({ ...r, minZ: mz + 6 }, 2, 4, 6, 6), rng.range(12, 22), rng.pick(d.buildingPalette), WindowStyle.Residential);
		for (let x = r.minX + 8; x < r.maxX - 4; x += 12) this.addTree(cell, x, mz, rng.range(0.8, 1.2), TreeKind.Oak);
	}

	private genIndustrial(cell: Cell, r: Rect, rng: Random): void {
		const d = DISTRICTS.industrial;
		const mx = (r.minX + r.maxX) / 2;
		const left: Rect = { ...r, maxX: mx - 3 };
		const right: Rect = { ...r, minX: mx + 3 };
		this.addBuilding(cell, inset(left, rng.range(2, 8), rng.range(2, 8), 2, 2), rng.range(8, 14), rng.pick(d.buildingPalette), WindowStyle.Industrial);
		const roll = rng.next();
		if (roll < 0.45) {
			this.addBuilding(cell, inset(right, rng.range(2, 10), rng.range(2, 10), 2, 2), rng.range(7, 12), rng.pick(d.buildingPalette), WindowStyle.Industrial);
		} else if (roll < 0.8) {
			// Tank farm.
			const rr = rng.range(4.5, 6.5);
			for (let x = right.minX + rr + 3; x < right.maxX - rr - 2; x += rr * 2 + 4) {
				for (let z = right.minZ + rr + 3; z < right.maxZ - rr - 2; z += rr * 2 + 4) {
					if (this.isReserved(cell, { minX: x - rr, maxX: x + rr, minZ: z - rr, maxZ: z + rr })) continue;
					this.cylinders.push({ x, z, r: rr, h: rng.range(7, 13), color: rng.pick([0xc8c8c0, 0xb0b8b8, 0xd8d0b8]) });
				}
			}
		} else {
			this.genContainerYard(cell, right, rng, 2);
		}
		if (rng.chance(0.3)) {
			const x = mx;
			const z = rng.range(r.minZ + 6, r.maxZ - 6);
			if (!this.isReserved(cell, { minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2 })) this.cylinders.push({ x, z, r: 1.6, h: rng.range(26, 40), color: 0x8a5a4a });
		}
	}

	private genHarbor(cell: Cell, r: Rect, rng: Random): void {
		const d = DISTRICTS.harbor;
		if (rng.chance(0.4)) {
			const mz = (r.minZ + r.maxZ) / 2;
			this.addBuilding(cell, inset({ ...r, maxZ: mz - 2 }, 2, 2, 3, 3), rng.range(9, 15), rng.pick(d.buildingPalette), WindowStyle.Industrial);
			this.genContainerYard(cell, { ...r, minZ: mz + 2 }, rng, 3);
		} else {
			this.genContainerYard(cell, r, rng, 3);
		}
	}

	private genContainerYard(cell: Cell, r: Rect, rng: Random, maxStack: number): void {
		const cw = 2.6;
		const cl = 6.2;
		const ch = 2.6;
		for (let z = r.minZ + 3; z + cl < r.maxZ - 2; z += cl + 4) {
			for (let x = r.minX + 3; x + cw < r.maxX - 2; x += cw + 0.4) {
				if (rng.chance(0.18)) continue;
				const rect = { minX: x, maxX: x + cw, minZ: z, maxZ: z + cl };
				if (this.isReserved(cell, rect)) continue;
				const stack = rng.int(1, maxStack);
				for (let s = 0; s < stack; s++) {
					this.boxes.push({ ...rect, y0: s * ch, h: ch, color: rng.pick(CONTAINER_COLORS), solid: true, visible: true });
				}
			}
		}
	}

	private genRural(cell: Cell, L: Rect, rng: Random): void {
		const color = rng.pick(FIELD_COLORS);
		const f = inset(L, 2, 2, 2, 2);
		this.ground.push({ ...f, y: 0.16, color });
		// Crop rows.
		const alongX = rng.chance(0.5);
		const darker = ((color >> 1) & 0x7f7f7f) + 0x202020;
		if (alongX) {
			for (let z = f.minZ + 3; z < f.maxZ - 2; z += 5) this.markings.push({ x: (f.minX + f.maxX) / 2, z, w: f.maxX - f.minX - 4, d: 1.2, y: 0.17, color: darker });
		} else {
			for (let x = f.minX + 3; x < f.maxX - 2; x += 5) this.markings.push({ x, z: (f.minZ + f.maxZ) / 2, w: 1.2, d: f.maxZ - f.minZ - 4, y: 0.17, color: darker });
		}
		const roll = rng.next();
		if (roll < 0.22) {
			// Farmstead: house, barn, silo.
			const x0 = rng.chance(0.5) ? f.minX + 8 : f.maxX - 40;
			const z0 = rng.chance(0.5) ? f.minZ + 8 : f.maxZ - 34;
			this.ground.push({ minX: x0 - 4, maxX: x0 + 36, minZ: z0 - 4, maxZ: z0 + 30, y: 0.18, color: 0x8a8a5a });
			this.addBuilding(cell, { minX: x0, maxX: x0 + 11, minZ: z0, maxZ: z0 + 9 }, 5.5, rng.pick(DISTRICTS.rural.buildingPalette), WindowStyle.Residential, 1);
			this.addBuilding(cell, { minX: x0 + 16, maxX: x0 + 32, minZ: z0, maxZ: z0 + 12 }, 7, 0x9a3a2a, WindowStyle.None, 2);
			this.cylinders.push({ x: x0 + 34, z: z0 + 20, r: 3, h: 14, color: 0xb8b8b0 });
			for (let k = 0; k < 4; k++) this.addTree(cell, x0 + rng.range(-2, 34), z0 + rng.range(18, 28), rng.range(1, 1.5), TreeKind.Oak);
		} else if (roll < 0.45) {
			const cx = rng.range(f.minX + 12, f.maxX - 12);
			const cz = rng.range(f.minZ + 12, f.maxZ - 12);
			for (let k = 0; k < 7; k++) this.addTree(cell, cx + rng.range(-10, 10), cz + rng.range(-10, 10), rng.range(0.9, 1.6), rng.chance(0.5) ? TreeKind.Pine : TreeKind.Oak);
		}
	}

	// ------------------------------------------------------------ margins/special

	private generateMargins(rng: Random): void {
		const c = this.cellSize;
		const h = WORLD.roadHalf;
		const L = this.land;
		const southRoad = WORLD.gridMaxZ * c;
		const eastRoad = WORLD.gridMaxX * c;
		const westRoad = WORLD.gridMinX * c;
		const northRoad = WORLD.gridMinZ * c;

		// Beach (south) with a boardwalk.
		this.ground.push({ minX: L.minX, maxX: 900, minZ: southRoad + h, maxZ: L.maxZ, y: 0.1, color: 0xe2d4a8 });
		this.ground.push({ minX: L.minX, maxX: 900, minZ: southRoad + h, maxZ: southRoad + h + 6, y: 0.2, color: 0x9a7a5a });
		for (let x = L.minX + 20; x < 880; x += 24) {
			this.addTree(null, x, southRoad + h + 8.5, rng.range(1, 1.3), TreeKind.Palm);
		}
		for (let x = L.minX + 60; x < 880; x += 140) {
			// Lifeguard towers and beach kiosks.
			const z = southRoad + h + 70 + rng.range(-10, 10);
			this.boxes.push({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, y0: 2.2, h: 2.4, color: 0xf04a3a, solid: false, visible: true });
			this.boxes.push({ minX: x - 1.4, maxX: x - 1.1, minZ: z - 1.4, maxZ: z - 1.1, y0: 0, h: 2.2, color: 0xe8e8e8, solid: false, visible: true });
			this.boxes.push({ minX: x + 1.1, maxX: x + 1.4, minZ: z + 1.1, maxZ: z + 1.4, y0: 0, h: 2.2, color: 0xe8e8e8, solid: false, visible: true });
			const kx = x + 60;
			this.boxes.push({ minX: kx - 3, maxX: kx + 3, minZ: southRoad + h + 10, maxZ: southRoad + h + 15, y0: 0, h: 3, color: rng.pick([0x3ad8c8, 0xf0b040, 0xf06aa0]), solid: true, visible: true });
		}
		// Harbor concrete south-east and east docks.
		this.ground.push({ minX: 900, maxX: L.maxX, minZ: southRoad + h, maxZ: L.maxZ, y: 0.12, color: 0x707274 });
		this.ground.push({ minX: eastRoad + h, maxX: L.maxX, minZ: L.minZ, maxZ: southRoad + h, y: 0.12, color: 0x707274 });
		for (const zc of [260, 480, 700, 900]) {
			const pier: Rect = { minX: L.maxX - 1, maxX: L.maxX + 170, minZ: zc - 18, maxZ: zc + 18 };
			this.piers.push(pier);
			this.ground.push({ ...pier, y: 0.12, color: 0x6a6c6e });
			this.cranes.push({ x: L.maxX + 150, z: zc, heading: Math.PI / 2 });
			// Containers along the pier.
			for (let x = pier.minX + 20; x < pier.maxX - 40; x += 3.2) {
				if (rng.chance(0.25)) continue;
				const stack = rng.int(1, 3);
				for (let s = 0; s < stack; s++) {
					this.boxes.push({ minX: x, maxX: x + 2.6, minZ: zc + 6, maxZ: zc + 12.2, y0: s * 2.6, h: 2.6, color: rng.pick(CONTAINER_COLORS), solid: true, visible: true });
				}
			}
			// Bollards along the edge.
			for (let x = pier.minX + 10; x < pier.maxX; x += 15) {
				this.cylinders.push({ x, z: pier.minZ + 1, r: 0.35, h: 0.8, color: 0x2a2a2a });
			}
		}
		// Forest margins north and west.
		this.ground.push({ minX: L.minX, maxX: L.maxX, minZ: L.minZ, maxZ: northRoad - h, y: 0.1, color: 0x4f6f3a });
		this.ground.push({ minX: L.minX, maxX: westRoad - h, minZ: L.minZ, maxZ: southRoad + h, y: 0.1, color: 0x4f6f3a });
		for (let x = L.minX + 5; x < eastRoad; x += 9) {
			for (let row = 0; row < 3; row++) this.addTree(null, x + rng.range(-3, 3), L.minZ + 6 + row * 18 + rng.range(-3, 3), rng.range(1.2, 2), TreeKind.Pine);
		}
		for (let z = L.minZ + 5; z < southRoad; z += 9) {
			for (let row = 0; row < 3; row++) this.addTree(null, L.minX + 6 + row * 18 + rng.range(-3, 3), z + rng.range(-3, 3), rng.range(1.2, 2), TreeKind.Pine);
		}
		// Invisible map boundary blockers (land edge on N/W, open sea limits on S/E).
		const wall = (minX: number, minZ: number, maxX: number, maxZ: number) =>
			this.boxes.push({ minX, minZ, maxX, maxZ, y0: 0, h: 60, color: 0, solid: true, visible: false });
		wall(L.minX - 40, L.minZ - 40, L.maxX + 400, L.minZ);
		wall(L.minX - 40, L.minZ - 40, L.minX, L.maxZ + 400);
		wall(L.minX - 40, L.maxZ + 360, L.maxX + 400, L.maxZ + 400);
		wall(L.maxX + 360, L.minZ - 40, L.maxX + 400, L.maxZ + 400);
	}

	private generateAirport(rng: Random): void {
		const a = AIRPORT_RECT;
		const h = WORLD.roadHalf;
		const area: Rect = { minX: a.minX + h, maxX: a.maxX - h, minZ: a.minZ + h, maxZ: a.maxZ - h };
		this.ground.push({ ...area, y: 0.15, color: 0x7f8a6a });
		const rw = this.runway;
		this.ground.push({ ...rw, y: 0.17, color: 0x3a3a3e });
		// Centre-line dashes and threshold stripes.
		const rz = (rw.minZ + rw.maxZ) / 2;
		for (let x = rw.minX + 40; x < rw.maxX - 40; x += 30) this.markings.push({ x, z: rz, w: 14, d: 0.8, y: 0.18, color: 0xf0f0f0 });
		for (const tx of [rw.minX + 12, rw.maxX - 12]) {
			for (let k = -4; k <= 4; k++) this.markings.push({ x: tx, z: rz + k * 4.4, w: 16, d: 1.8, y: 0.18, color: 0xf0f0f0 });
		}
		// Taxiway and apron.
		this.ground.push({ minX: rw.minX + 60, maxX: rw.maxX - 60, minZ: rw.maxZ + 40, maxZ: rw.maxZ + 58, y: 0.17, color: 0x4a4a4e });
		const apron: Rect = { minX: 640, maxX: 1180, minZ: -1010, maxZ: -880 };
		this.ground.push({ ...apron, y: 0.17, color: 0x6a6a6e });
		// Terminal, tower, hangars.
		const cell = this.cellAt(800, -850)!;
		this.addBuilding(cell, { minX: 700, maxX: 1080, minZ: -880, maxZ: -830 }, 16, 0xc0c8d0, WindowStyle.Glass);
		this.addBuilding(cell, { minX: 760, maxX: 1020, minZ: -872, maxZ: -838 }, 7, 0xa0a8b0, WindowStyle.Glass, 0, 16);
		this.cylinders.push({ x: 1130, z: -860, r: 3, h: 34, color: 0xd0d0d0 });
		this.addBuilding(cell, { minX: 1124, maxX: 1136, minZ: -866, maxZ: -854 }, 5, 0x6a8aa8, WindowStyle.Glass, 0, 34);
		for (const hx of [560, 610]) this.addBuilding(cell, { minX: hx, maxX: hx + 40, minZ: -1060, maxZ: -1020 }, 14, 0x9aa0a6, WindowStyle.Industrial, 1);
		for (let k = 0; k < 4; k++) {
			this.aircraft.push({ x: 720 + k * 110, z: -950, heading: 0, color: rng.pick([0xf0f0f0, 0xe8e0d0, 0xd0e0f0]) });
		}
		// Perimeter fence (visual + solid) south of runway.
		for (let x = area.minX; x < area.maxX; x += 40) {
			this.boxes.push({ minX: x, maxX: Math.min(x + 40, area.maxX), minZ: area.minZ + 2, maxZ: area.minZ + 2.3, y0: 0, h: 2.2, color: 0x9a9a9a, solid: true, visible: true });
		}
	}

	private generateStreetDetail(rng: Random): void {
		const h = WORLD.roadHalf;
		for (const e of this.edges) {
			const a = this.nodes[e.a]!;
			const b = this.nodes[e.b]!;
			const len = this.cellSize;
			const run = len - 2 * h;
			const rural = e.district === 'rural';
			// Centre line (double yellow).
			const color = rural ? 0xd8d0a0 : 0xe8c43a;
			if (e.horizontal) {
				const cx = (a.x + b.x) / 2;
				this.markings.push({ x: cx, z: a.z - 0.18, w: run, d: 0.16, y: 0.02, color });
				this.markings.push({ x: cx, z: a.z + 0.18, w: run, d: 0.16, y: 0.02, color });
			} else {
				const cz = (a.z + b.z) / 2;
				this.markings.push({ x: a.x - 0.18, z: cz, w: 0.16, d: run, y: 0.02, color });
				this.markings.push({ x: a.x + 0.18, z: cz, w: 0.16, d: run, y: 0.02, color });
			}
			// Street lamps (alternating sides).
			if (e.district === 'airport') continue;
			const step = rural ? 50 : 32;
			let side = rng.chance(0.5) ? 1 : -1;
			for (let s = h + 10; s < len - h - 4; s += step) {
				const off = h + 0.7;
				if (e.horizontal) this.lamps.push({ x: a.x + s, z: a.z + side * off, heading: side > 0 ? Math.PI : 0 });
				else this.lamps.push({ x: a.x + side * off, z: a.z + s, heading: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
				side = -side as 1 | -1;
			}
		}
		// Crosswalks at signalled intersections.
		for (const n of this.nodeList) {
			if (!n.signal) continue;
			for (const eid of n.edges) {
				const e = this.edges[eid];
				const other = e.a === n.id ? e.b : e.a;
				const o = this.nodes[other]!;
				const dx = Math.sign(o.x - n.x);
				const dz = Math.sign(o.z - n.z);
				const s = h + 2.2;
				for (let k = -3; k <= 3; k++) {
					const t = k * 2;
					if (e.horizontal) this.markings.push({ x: n.x + dx * s, z: n.z + t, w: 3, d: 0.9, y: 0.02, color: 0xe8e8e8 });
					else this.markings.push({ x: n.x + t, z: n.z + dz * s, w: 0.9, d: 3, y: 0.02, color: 0xe8e8e8 });
				}
			}
		}
	}
}

export function generateCity(seed: number = WORLD.seed): CityLayout {
	return new CityLayout(seed).generate();
}
