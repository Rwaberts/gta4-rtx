// Grid-accelerated static collision world. Every static collider is an axis-aligned box
// (minX, minZ, maxX, maxZ, y0, y1). Supports circle resolution (characters), oriented box
// resolution (vehicles), 3D raycasts (bullets, camera, line of sight) and ground height queries.

export interface RayHit {
	t: number;
	x: number;
	y: number;
	z: number;
	nx: number;
	ny: number;
	nz: number;
	/** Box id, or -1 for the ground plane. */
	box: number;
}

export interface Contact {
	/** Push-out normal (points away from the obstacle). */
	nx: number;
	nz: number;
	depth: number;
	/** Approximate contact point. */
	px: number;
	pz: number;
}

export class StaticCollision {
	private bx0: number[] = [];
	private bz0: number[] = [];
	private bx1: number[] = [];
	private bz1: number[] = [];
	private by0: number[] = [];
	private by1: number[] = [];
	private enabled: boolean[] = [];
	private stamp: number[] = [];
	private curStamp = 1;
	private grid = new Map<number, number[]>();
	private readonly inv: number;

	constructor(readonly cellSize = 16) {
		this.inv = 1 / cellSize;
	}

	get count(): number {
		return this.bx0.length;
	}

	private key(cx: number, cz: number): number {
		return ((cx + 32768) << 16) | (cz + 32768);
	}

	add(minX: number, minZ: number, maxX: number, maxZ: number, y0: number, y1: number): number {
		const id = this.bx0.length;
		this.bx0.push(minX);
		this.bz0.push(minZ);
		this.bx1.push(maxX);
		this.bz1.push(maxZ);
		this.by0.push(y0);
		this.by1.push(y1);
		this.enabled.push(true);
		this.stamp.push(0);
		const cx0 = Math.floor(minX * this.inv);
		const cx1 = Math.floor(maxX * this.inv);
		const cz0 = Math.floor(minZ * this.inv);
		const cz1 = Math.floor(maxZ * this.inv);
		for (let cx = cx0; cx <= cx1; cx++) {
			for (let cz = cz0; cz <= cz1; cz++) {
				const k = this.key(cx, cz);
				let list = this.grid.get(k);
				if (!list) {
					list = [];
					this.grid.set(k, list);
				}
				list.push(id);
			}
		}
		return id;
	}

	setEnabled(id: number, on: boolean): void {
		this.enabled[id] = on;
	}

	box(id: number): { minX: number; minZ: number; maxX: number; maxZ: number; y0: number; y1: number } {
		return { minX: this.bx0[id], minZ: this.bz0[id], maxX: this.bx1[id], maxZ: this.bz1[id], y0: this.by0[id], y1: this.by1[id] };
	}

	private nextStamp(): number {
		this.curStamp++;
		if (this.curStamp > 1e9) {
			this.stamp.fill(0);
			this.curStamp = 1;
		}
		return this.curStamp;
	}

	/** Visits each enabled box overlapping the XZ rectangle exactly once. */
	forEachInRect(minX: number, minZ: number, maxX: number, maxZ: number, fn: (id: number) => void): void {
		const s = this.nextStamp();
		const cx0 = Math.floor(minX * this.inv);
		const cx1 = Math.floor(maxX * this.inv);
		const cz0 = Math.floor(minZ * this.inv);
		const cz1 = Math.floor(maxZ * this.inv);
		for (let cx = cx0; cx <= cx1; cx++) {
			for (let cz = cz0; cz <= cz1; cz++) {
				const list = this.grid.get(this.key(cx, cz));
				if (!list) continue;
				for (let i = 0; i < list.length; i++) {
					const id = list[i];
					if (this.stamp[id] === s || !this.enabled[id]) continue;
					this.stamp[id] = s;
					if (this.bx1[id] < minX || this.bx0[id] > maxX || this.bz1[id] < minZ || this.bz0[id] > maxZ) continue;
					fn(id);
				}
			}
		}
	}

	/**
	 * Pushes a vertical capsule (circle in XZ spanning [y, y + height]) out of all boxes.
	 * Mutates `pos`. Returns true if any contact happened.
	 */
	resolveCircle(pos: { x: number; z: number }, r: number, y = 0, height = 1.8, iterations = 2): boolean {
		let hit = false;
		for (let it = 0; it < iterations; it++) {
			let moved = false;
			this.forEachInRect(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (id) => {
				if (this.by1[id] <= y + 0.05 || this.by0[id] >= y + height) return;
				const cx = Math.max(this.bx0[id], Math.min(pos.x, this.bx1[id]));
				const cz = Math.max(this.bz0[id], Math.min(pos.z, this.bz1[id]));
				let dx = pos.x - cx;
				let dz = pos.z - cz;
				const d2 = dx * dx + dz * dz;
				if (d2 >= r * r) return;
				if (d2 > 1e-8) {
					const d = Math.sqrt(d2);
					const push = r - d;
					pos.x += (dx / d) * push;
					pos.z += (dz / d) * push;
				} else {
					// Centre inside the box: exit through the nearest face.
					const l = pos.x - this.bx0[id];
					const rr = this.bx1[id] - pos.x;
					const t = pos.z - this.bz0[id];
					const b = this.bz1[id] - pos.z;
					const m = Math.min(l, rr, t, b);
					dx = dz = 0;
					if (m === l) pos.x = this.bx0[id] - r;
					else if (m === rr) pos.x = this.bx1[id] + r;
					else if (m === t) pos.z = this.bz0[id] - r;
					else pos.z = this.bz1[id] + r;
				}
				hit = moved = true;
			});
			if (!moved) break;
		}
		return hit;
	}

	/**
	 * Highest walkable surface under a circle: the top of any box below `maxY`.
	 * Returns 0 for open ground.
	 */
	groundHeight(x: number, z: number, r: number, maxY: number): number {
		let best = 0;
		this.forEachInRect(x - r, z - r, x + r, z + r, (id) => {
			const top = this.by1[id];
			if (top <= maxY && top > best && x + r * 0.5 > this.bx0[id] && x - r * 0.5 < this.bx1[id] && z + r * 0.5 > this.bz0[id] && z - r * 0.5 < this.bz1[id]) {
				best = top;
			}
		});
		return best;
	}

	/**
	 * Oriented box (vehicle footprint) against static boxes. Collects contacts into `out`.
	 * fx/fz = forward unit vector. Returns number of contacts.
	 */
	collideOBB(cx: number, cz: number, fx: number, fz: number, halfLen: number, halfWid: number, y0: number, y1: number, out: Contact[]): number {
		out.length = 0;
		const rx = -fz;
		const rz = fx;
		const ext = Math.abs(fx) * halfLen + Math.abs(rx) * halfWid;
		const extZ = Math.abs(fz) * halfLen + Math.abs(rz) * halfWid;
		this.forEachInRect(cx - ext, cz - extZ, cx + ext, cz + extZ, (id) => {
			if (this.by1[id] <= y0 + 0.3 || this.by0[id] >= y1) return;
			const bcx = (this.bx0[id] + this.bx1[id]) * 0.5;
			const bcz = (this.bz0[id] + this.bz1[id]) * 0.5;
			const ex = (this.bx1[id] - this.bx0[id]) * 0.5;
			const ez = (this.bz1[id] - this.bz0[id]) * 0.5;
			const dx = bcx - cx;
			const dz = bcz - cz;
			let minOverlap = Infinity;
			let nx = 0;
			let nz = 0;
			// Axes: world X, world Z, vehicle forward, vehicle right.
			const axes = [1, 0, 0, 1, fx, fz, rx, rz];
			for (let a = 0; a < 8; a += 2) {
				const ax = axes[a];
				const az = axes[a + 1];
				const rObb = halfLen * Math.abs(fx * ax + fz * az) + halfWid * Math.abs(rx * ax + rz * az);
				const rBox = ex * Math.abs(ax) + ez * Math.abs(az);
				const d = dx * ax + dz * az;
				const overlap = rObb + rBox - Math.abs(d);
				if (overlap <= 0) return;
				if (overlap < minOverlap) {
					minOverlap = overlap;
					// Normal points from box towards the vehicle.
					const s = d > 0 ? -1 : 1;
					nx = ax * s;
					nz = az * s;
				}
			}
			// Contact point: deepest vehicle corner inside the box, else the box point closest to the vehicle centre.
			let px = Math.max(this.bx0[id], Math.min(cx, this.bx1[id]));
			let pz = Math.max(this.bz0[id], Math.min(cz, this.bz1[id]));
			let deepest = -Infinity;
			for (const sl of [-1, 1]) {
				for (const sw of [-1, 1]) {
					const qx = cx + fx * halfLen * sl + rx * halfWid * sw;
					const qz = cz + fz * halfLen * sl + rz * halfWid * sw;
					if (qx > this.bx0[id] && qx < this.bx1[id] && qz > this.bz0[id] && qz < this.bz1[id]) {
						const pen = -(qx * nx + qz * nz);
						if (pen > deepest) {
							deepest = pen;
							px = qx;
							pz = qz;
						}
					}
				}
			}
			out.push({ nx, nz, depth: minOverlap, px, pz });
		});
		return out.length;
	}

	/**
	 * 3D raycast against boxes and the ground plane (y = 0). Direction need not be normalised;
	 * `maxT` is in units of the direction vector length.
	 */
	raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out?: RayHit, ignoreGround = false): RayHit | null {
		let bestT = maxT;
		let bestId = -2;
		let bnx = 0;
		let bny = 0;
		let bnz = 0;
		if (!ignoreGround && dy < 0) {
			const tg = -oy / dy;
			if (tg >= 0 && tg < bestT) {
				bestT = tg;
				bestId = -1;
				bny = 1;
			}
		}
		const s = this.nextStamp();
		// DDA over XZ grid.
		let cx = Math.floor(ox * this.inv);
		let cz = Math.floor(oz * this.inv);
		const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
		const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
		const tDeltaX = stepX !== 0 ? Math.abs(this.cellSize / dx) : Infinity;
		const tDeltaZ = stepZ !== 0 ? Math.abs(this.cellSize / dz) : Infinity;
		let tMaxX = stepX > 0 ? ((cx + 1) * this.cellSize - ox) / dx : stepX < 0 ? (cx * this.cellSize - ox) / dx : Infinity;
		let tMaxZ = stepZ > 0 ? ((cz + 1) * this.cellSize - oz) / dz : stepZ < 0 ? (cz * this.cellSize - oz) / dz : Infinity;
		let tCell = 0;
		for (let guard = 0; guard < 4096; guard++) {
			const list = this.grid.get(this.key(cx, cz));
			if (list) {
				for (let i = 0; i < list.length; i++) {
					const id = list[i];
					if (this.stamp[id] === s || !this.enabled[id]) continue;
					this.stamp[id] = s;
					// Slab test.
					let tmin = 0;
					let tmax = bestT;
					let nAxis = -1;
					let nSign = 0;
					let ok = true;
					for (let axis = 0; axis < 3 && ok; axis++) {
						const o = axis === 0 ? ox : axis === 1 ? oy : oz;
						const d = axis === 0 ? dx : axis === 1 ? dy : dz;
						const lo = axis === 0 ? this.bx0[id] : axis === 1 ? this.by0[id] : this.bz0[id];
						const hi = axis === 0 ? this.bx1[id] : axis === 1 ? this.by1[id] : this.bz1[id];
						if (Math.abs(d) < 1e-12) {
							if (o < lo || o > hi) ok = false;
							continue;
						}
						let t1 = (lo - o) / d;
						let t2 = (hi - o) / d;
						let sign = -1;
						if (t1 > t2) {
							const tmp = t1;
							t1 = t2;
							t2 = tmp;
							sign = 1;
						}
						if (t1 > tmin) {
							tmin = t1;
							nAxis = axis;
							nSign = sign;
						}
						if (t2 < tmax) tmax = t2;
						if (tmin > tmax) ok = false;
					}
					if (ok && tmin < bestT && nAxis >= 0) {
						bestT = tmin;
						bestId = id;
						bnx = nAxis === 0 ? nSign : 0;
						bny = nAxis === 1 ? nSign : 0;
						bnz = nAxis === 2 ? nSign : 0;
					}
				}
			}
			// Advance to next cell.
			if (tMaxX < tMaxZ) {
				tCell = tMaxX;
				tMaxX += tDeltaX;
				cx += stepX;
			} else {
				tCell = tMaxZ;
				tMaxZ += tDeltaZ;
				cz += stepZ;
			}
			if (tCell > bestT || tCell === Infinity) break;
		}
		if (bestId === -2) return null;
		const hit = out ?? ({} as RayHit);
		hit.t = bestT;
		hit.x = ox + dx * bestT;
		hit.y = oy + dy * bestT;
		hit.z = oz + dz * bestT;
		hit.nx = bnx;
		hit.ny = bny;
		hit.nz = bnz;
		hit.box = bestId;
		return hit;
	}

	/** True when nothing static blocks the segment a -> b. */
	lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
		return this.raycast(ax, ay, az, bx - ax, by - ay, bz - az, 0.999, undefined, true) === null;
	}
}
