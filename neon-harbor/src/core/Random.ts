// Seeded PRNG (mulberry32). Deterministic city generation and testable AI.

export class Random {
	private state: number;

	constructor(seed = 1) {
		this.state = seed >>> 0;
	}

	get seed(): number {
		return this.state;
	}

	/** Uniform float in [0, 1). */
	next(): number {
		let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	range(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	/** Integer in [min, max] inclusive. */
	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}

	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(arr: readonly T[]): T {
		return arr[Math.floor(this.next() * arr.length)];
	}

	/** Picks a key from a weight table. Zero/negative weights are never chosen. */
	weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
		let total = 0;
		for (const k in weights) total += Math.max(0, weights[k]);
		let r = this.next() * total;
		let last: K | undefined;
		for (const k in weights) {
			const w = Math.max(0, weights[k]);
			if (w <= 0) continue;
			last = k;
			r -= w;
			if (r < 0) return k;
		}
		return last as K;
	}

	fork(salt: number): Random {
		return new Random((this.state ^ Math.imul(salt, 0x9e3779b1)) >>> 0);
	}
}

/** Shared non-deterministic-ish RNG for gameplay noise (seeded per session). */
export const rng = new Random((Date.now() & 0xffffffff) >>> 0);
