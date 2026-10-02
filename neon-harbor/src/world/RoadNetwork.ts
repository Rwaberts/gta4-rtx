// Directed lane graph built from the city road grid: right-hand traffic lanes, turn curves,
// signal phases and A* routing (used by traffic AI, police pursuit and the GPS route).

import { WORLD } from '../data/config';
import type { CityLayout, RoadNode } from './CityLayout';

export interface Lane {
	id: number;
	from: number;
	to: number;
	/** Unit direction. */
	dx: number;
	dz: number;
	/** Lane segment between the two intersections' stop lines. */
	sx: number;
	sz: number;
	ex: number;
	ez: number;
	len: number;
	/** 0 = north/south axis, 1 = east/west axis. */
	axis: 0 | 1;
	/** Lanes that can follow this one at `to` (U-turns excluded). */
	next: number[];
	district: string;
}

export type Signal = 'green' | 'yellow' | 'red';

export const SIGNAL_CYCLE = 26;

export interface Point {
	x: number;
	z: number;
}

export class RoadNetwork {
	readonly lanes: Lane[] = [];
	private outgoing = new Map<number, number[]>();

	constructor(readonly city: CityLayout) {
		const h = WORLD.roadHalf;
		const off = WORLD.laneOffset;
		for (const e of city.edges) {
			const a = city.nodes[e.a]!;
			const b = city.nodes[e.b]!;
			for (const [from, to] of [
				[a, b],
				[b, a],
			] as const) {
				const len = Math.hypot(to.x - from.x, to.z - from.z);
				const dx = (to.x - from.x) / len;
				const dz = (to.z - from.z) / len;
				// Right-hand side: right = (-dz, dx).
				const rx = -dz;
				const rz = dx;
				const lane: Lane = {
					id: this.lanes.length,
					from: from.id,
					to: to.id,
					dx,
					dz,
					sx: from.x + dx * h + rx * off,
					sz: from.z + dz * h + rz * off,
					ex: to.x - dx * h + rx * off,
					ez: to.z - dz * h + rz * off,
					len: len - 2 * h,
					axis: Math.abs(dz) > 0.5 ? 0 : 1,
					next: [],
					district: e.district,
				};
				this.lanes.push(lane);
				const list = this.outgoing.get(from.id) ?? [];
				list.push(lane.id);
				this.outgoing.set(from.id, list);
			}
		}
		for (const l of this.lanes) {
			l.next = (this.outgoing.get(l.to) ?? []).filter((id) => this.lanes[id].to !== l.from);
		}
	}

	lanesFrom(nodeId: number): number[] {
		return this.outgoing.get(nodeId) ?? [];
	}

	signalAt(node: RoadNode, axis: 0 | 1, time: number): Signal {
		if (!node.signal) return 'green';
		const c = (time + node.phase) % SIGNAL_CYCLE;
		const half = SIGNAL_CYCLE / 2;
		const local = axis === 0 ? c : (c + half) % SIGNAL_CYCLE;
		if (local < half - 3) return 'green';
		if (local < half - 0.8) return 'yellow';
		return 'red';
	}

	/** Point on the quadratic curve joining lane a's end to lane b's start. */
	turnPoint(a: Lane, b: Lane, t: number, out: Point): Point {
		// Control point: intersection of the two lane lines (or midpoint when straight).
		let cx: number;
		let cz: number;
		if (Math.abs(a.dx * b.dx + a.dz * b.dz) > 0.99) {
			cx = (a.ex + b.sx) / 2;
			cz = (a.ez + b.sz) / 2;
		} else if (a.axis === 0) {
			cx = a.ex;
			cz = b.sz;
		} else {
			cx = b.sx;
			cz = a.ez;
		}
		const u = 1 - t;
		out.x = u * u * a.ex + 2 * u * t * cx + t * t * b.sx;
		out.z = u * u * a.ez + 2 * u * t * cz + t * t * b.sz;
		return out;
	}

	turnLength(a: Lane, b: Lane): number {
		const straight = Math.abs(a.dx * b.dx + a.dz * b.dz) > 0.99;
		const d = Math.hypot(b.sx - a.ex, b.sz - a.ez);
		return straight ? d : d * 1.15;
	}

	/** Closest lane to a point (optionally only lanes whose direction roughly matches). */
	nearestLane(x: number, z: number, dirX?: number, dirZ?: number): { lane: Lane; s: number; dist: number } | null {
		const node = this.city.nearestNode(x, z);
		if (!node) return null;
		let best: { lane: Lane; s: number; dist: number } | null = null;
		const candidates = new Set<number>();
		for (const eid of node.edges) {
			const e = this.city.edges[eid];
			for (const nid of [e.a, e.b]) for (const lid of this.lanesFrom(nid)) candidates.add(lid);
		}
		for (const lid of candidates) {
			const l = this.lanes[lid];
			if (dirX !== undefined && dirZ !== undefined && l.dx * dirX + l.dz * dirZ < 0.3) continue;
			const s = Math.max(0, Math.min(l.len, (x - l.sx) * l.dx + (z - l.sz) * l.dz));
			const px = l.sx + l.dx * s;
			const pz = l.sz + l.dz * s;
			const d = Math.hypot(x - px, z - pz);
			if (!best || d < best.dist) best = { lane: l, s, dist: d };
		}
		return best;
	}

	/** A* over intersections. Returns node ids from start to goal (inclusive) or null. */
	findPath(startId: number, goalId: number): number[] | null {
		if (startId === goalId) return [startId];
		const nodes = this.city.nodes;
		const goal = nodes[goalId]!;
		const g = new Map<number, number>([[startId, 0]]);
		const came = new Map<number, number>();
		const open: Array<{ id: number; f: number }> = [{ id: startId, f: 0 }];
		const closed = new Set<number>();
		while (open.length) {
			// Binary-heap-free: open set stays small on a grid this size.
			let bi = 0;
			for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
			const cur = open[bi];
			open[bi] = open[open.length - 1];
			open.pop();
			if (cur.id === goalId) {
				const path = [goalId];
				let c = goalId;
				while (came.has(c)) {
					c = came.get(c)!;
					path.push(c);
				}
				return path.reverse();
			}
			if (closed.has(cur.id)) continue;
			closed.add(cur.id);
			for (const lid of this.lanesFrom(cur.id)) {
				const l = this.lanes[lid];
				const m = nodes[l.to]!;
				const cost = g.get(cur.id)! + l.len + 16 + (m.signal ? 4 : 0);
				if (cost < (g.get(l.to) ?? Infinity)) {
					g.set(l.to, cost);
					came.set(l.to, cur.id);
					const hcost = Math.abs(m.x - goal.x) + Math.abs(m.z - goal.z);
					open.push({ id: l.to, f: cost + hcost });
				}
			}
		}
		return null;
	}

	/** World-space polyline route between two arbitrary points (for GPS). */
	route(fromX: number, fromZ: number, toX: number, toZ: number): Point[] {
		const a = this.city.nearestNode(fromX, fromZ);
		const b = this.city.nearestNode(toX, toZ);
		if (!a || !b) return [];
		const path = this.findPath(a.id, b.id);
		if (!path) return [];
		const pts: Point[] = [{ x: fromX, z: fromZ }];
		for (const id of path) {
			const n = this.city.nodes[id]!;
			pts.push({ x: n.x, z: n.z });
		}
		pts.push({ x: toX, z: toZ });
		return pts;
	}

	laneBetween(fromId: number, toId: number): Lane | null {
		for (const lid of this.lanesFrom(fromId)) if (this.lanes[lid].to === toId) return this.lanes[lid];
		return null;
	}
}
