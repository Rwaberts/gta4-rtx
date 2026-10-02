import { beforeAll, describe, expect, it } from 'vitest';
import { generateCity, rectOverlap, type CityLayout } from '../../src/world/CityLayout';
import { StaticCollision, type Contact } from '../../src/world/StaticCollision';
import { DISTRICT_IDS } from '../../src/data/districts';
import { POI_DEFS } from '../../src/data/pois';
import { WORLD } from '../../src/data/config';

let city: CityLayout;

beforeAll(() => {
	city = generateCity();
});

describe('CityLayout', () => {
	it('is deterministic for a seed', () => {
		const again = generateCity();
		expect(again.buildings.length).toBe(city.buildings.length);
		expect(again.buildings[100]).toEqual(city.buildings[100]);
		expect(again.edges.length).toBe(city.edges.length);
	});

	it('produces every district with buildings or features', () => {
		const seen = new Set(city.cells.map((c) => c.district));
		for (const d of DISTRICT_IDS) expect(seen.has(d), d).toBe(true);
		const byDistrict = new Map<string, number>();
		for (const b of city.buildings) byDistrict.set(b.district, (byDistrict.get(b.district) ?? 0) + 1);
		for (const d of ['downtown', 'financial', 'industrial', 'residential', 'beachfront', 'harbor', 'airport', 'rural']) {
			expect(byDistrict.get(d) ?? 0, d).toBeGreaterThan(0);
		}
		expect(city.buildings.length).toBeGreaterThan(1500);
		expect(city.buildings.length).toBeLessThan(15000);
	});

	it('financial towers are taller than suburban houses on average', () => {
		const avg = (d: string) => {
			const bs = city.buildings.filter((b) => b.district === d);
			return bs.reduce((s, b) => s + b.h, 0) / bs.length;
		};
		expect(avg('financial')).toBeGreaterThan(avg('downtown'));
		expect(avg('downtown')).toBeGreaterThan(avg('residential'));
	});

	it('road network is a single connected component without dead ends', () => {
		const nodes = city.nodeList;
		expect(nodes.length).toBeGreaterThan(300);
		for (const n of nodes) expect(n.edges.length).toBeGreaterThanOrEqual(2);
		const seen = new Set<number>([nodes[0].id]);
		const stack = [nodes[0]];
		while (stack.length) {
			const n = stack.pop()!;
			for (const eid of n.edges) {
				const e = city.edges[eid];
				const o = e.a === n.id ? e.b : e.a;
				if (!seen.has(o)) {
					seen.add(o);
					stack.push(city.nodes[o]!);
				}
			}
		}
		expect(seen.size).toBe(nodes.length);
	});

	it('rural roads are sparser than downtown roads', () => {
		const rural = city.cells.filter((c) => c.district === 'rural');
		const dt = city.cells.filter((c) => c.district === 'downtown');
		const roadSides = (cs: typeof rural) => cs.reduce((s, c) => s + +c.roads.n + +c.roads.s + +c.roads.w + +c.roads.e, 0) / cs.length;
		expect(roadSides(rural)).toBeLessThan(roadSides(dt));
	});

	it('no building overlaps a road surface', () => {
		let bad = 0;
		for (const b of city.buildings) {
			// Sample the footprint corners and centre (inset slightly).
			const pts = [
				[b.minX + 0.5, b.minZ + 0.5],
				[b.maxX - 0.5, b.minZ + 0.5],
				[b.minX + 0.5, b.maxZ - 0.5],
				[b.maxX - 0.5, b.maxZ - 0.5],
				[(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2],
			];
			for (const [x, z] of pts) if (city.isOnRoad(x, z)) bad++;
		}
		expect(bad).toBe(0);
	});

	it('resolves every POI onto a sidewalk off the road with a storefront', () => {
		expect(city.pois.length).toBe(POI_DEFS.length);
		for (const p of city.pois) {
			expect(city.isOnRoad(p.x, p.z), p.id).toBe(false);
			expect(city.isLand(p.x, p.z)).toBe(true);
			// Door is within a few metres of its building.
			const b = p.building;
			const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
			const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
			expect(Math.hypot(dx, dz), p.id).toBeLessThan(4);
			// A road is right in front of the door.
			const fx = Math.sin(p.facing);
			const fz = Math.cos(p.facing);
			expect(city.isOnRoad(p.x + fx * 6, p.z + fz * 6), p.id).toBe(true);
		}
		// No generated building overlaps another POI's storefront.
		for (const p of city.pois) {
			const others = city.buildings.filter((b) => b !== p.building && rectOverlap(b, p.building, -0.5) && b.y0 === 0);
			expect(others.length, p.id).toBe(0);
		}
	});

	it('land and water are consistent', () => {
		expect(city.isLand(0, 0)).toBe(true);
		expect(city.isLand(0, WORLD.landMaxZ + 50)).toBe(false);
		expect(city.isLand(WORLD.landMaxX + 50, 480)).toBe(true); // pier
		expect(city.isLand(WORLD.landMaxX + 50, 380)).toBe(false);
	});

	it('nearestNode returns an existing node near the query', () => {
		const n = city.nearestNode(12, 18)!;
		expect(n).not.toBeNull();
		expect(Math.hypot(n.x - 12, n.z - 18)).toBeLessThan(150);
	});
});

describe('StaticCollision', () => {
	function world() {
		const w = new StaticCollision(16);
		w.add(0, 0, 10, 10, 0, 20); // tall box
		w.add(20, 0, 22, 2, 0, 1); // low crate
		return w;
	}

	it('pushes circles out of boxes', () => {
		const w = world();
		const p = { x: 10.2, z: 5 };
		expect(w.resolveCircle(p, 0.5)).toBe(true);
		expect(p.x).toBeCloseTo(10.5);
		const inside = { x: 9.5, z: 5 };
		w.resolveCircle(inside, 0.4);
		expect(inside.x).toBeGreaterThanOrEqual(10.4 - 1e-6);
	});

	it('ignores boxes below the capsule (allows standing on top)', () => {
		const w = world();
		const p = { x: 21, z: 1 };
		expect(w.resolveCircle(p, 0.3, 1.0, 1.8)).toBe(false);
		expect(w.groundHeight(21, 1, 0.3, 1.2)).toBe(1);
		expect(w.groundHeight(21, 1, 0.3, 0.5)).toBe(0);
	});

	it('raycasts hit the nearest face with a correct normal', () => {
		const w = world();
		const hit = w.raycast(-10, 5, 5, 1, 0, 0, 100)!;
		expect(hit.t).toBeCloseTo(10);
		expect(hit.nx).toBe(-1);
		const down = w.raycast(50, 10, 50, 0, -1, 0, 100)!;
		expect(down.box).toBe(-1);
		expect(down.y).toBeCloseTo(0);
		expect(w.raycast(-10, 25, 5, 1, 0, 0, 100)).toBeNull();
	});

	it('raycasts across many grid cells', () => {
		const w = new StaticCollision(8);
		w.add(200, -1, 201, 1, 0, 5);
		const hit = w.raycast(0, 1, 0, 1, 0, 0.001, 500)!;
		expect(hit.t).toBeCloseTo(200, 0);
	});

	it('line of sight is blocked by boxes', () => {
		const w = world();
		expect(w.lineOfSight(-5, 1, 5, 15, 1, 5)).toBe(false);
		expect(w.lineOfSight(-5, 1, 15, 15, 1, 15)).toBe(true);
	});

	it('OBB collision yields push-out normal', () => {
		const w = world();
		const out: Contact[] = [];
		// Vehicle facing +x, nose penetrating the tall box's west face.
		const n = w.collideOBB(-1.5, 5, 1, 0, 2, 1, 0, 1.5, out);
		expect(n).toBe(1);
		expect(out[0].nx).toBeCloseTo(-1);
		expect(out[0].depth).toBeCloseTo(0.5);
		expect(w.collideOBB(-5, 5, 1, 0, 2, 1, 0, 1.5, out)).toBe(0);
	});

	it('builds from a full city quickly', () => {
		const t0 = performance.now();
		const w = new StaticCollision(16);
		city.forEachSolid((a, b, c, d, e, f) => w.add(a, b, c, d, e, f));
		const dt = performance.now() - t0;
		expect(w.count).toBeGreaterThan(2000);
		expect(dt).toBeLessThan(1500);
	});
});
