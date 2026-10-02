// Uniform-grid spatial hash for dynamic entities (actors, vehicles).
// Rebuilt every simulation step; bucket arrays are reused to avoid allocations.

export interface Positioned {
	x: number;
	z: number;
}

export class SpatialHash<T extends Positioned> {
	private buckets = new Map<number, T[]>();
	private used: T[][] = [];
	private readonly inv: number;

	constructor(readonly cellSize = 16) {
		this.inv = 1 / cellSize;
	}

	private key(cx: number, cz: number): number {
		// 16-bit packed cell coords (supports +-32k cells).
		return ((cx + 32768) << 16) | (cz + 32768);
	}

	clear(): void {
		for (const b of this.used) b.length = 0;
		this.used.length = 0;
	}

	insert(item: T): void {
		const k = this.key(Math.floor(item.x * this.inv), Math.floor(item.z * this.inv));
		let b = this.buckets.get(k);
		if (!b) {
			b = [];
			this.buckets.set(k, b);
		}
		if (b.length === 0) this.used.push(b);
		b.push(item);
	}

	/** Calls fn for every item within radius r of (x, z). Return true from fn to stop early. */
	query(x: number, z: number, r: number, fn: (item: T, d2: number) => boolean | void): void {
		const r2 = r * r;
		const minX = Math.floor((x - r) * this.inv);
		const maxX = Math.floor((x + r) * this.inv);
		const minZ = Math.floor((z - r) * this.inv);
		const maxZ = Math.floor((z + r) * this.inv);
		for (let cx = minX; cx <= maxX; cx++) {
			for (let cz = minZ; cz <= maxZ; cz++) {
				const b = this.buckets.get(this.key(cx, cz));
				if (!b) continue;
				for (let i = 0; i < b.length; i++) {
					const it = b[i];
					const dx = it.x - x;
					const dz = it.z - z;
					const d2 = dx * dx + dz * dz;
					if (d2 <= r2 && fn(it, d2) === true) return;
				}
			}
		}
	}

	/** Nearest item within radius matching filter. */
	nearest(x: number, z: number, r: number, filter?: (item: T) => boolean): T | null {
		let best: T | null = null;
		let bestD = Infinity;
		this.query(x, z, r, (it, d2) => {
			if (d2 < bestD && (!filter || filter(it))) {
				best = it;
				bestD = d2;
			}
		});
		return best;
	}
}
