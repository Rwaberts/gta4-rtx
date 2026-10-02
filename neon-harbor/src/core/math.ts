// Small, allocation-free math helpers shared by simulation and rendering.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
	return a === b ? 0 : clamp((v - a) / (b - a), 0, 1);
}

export function smoothstep(a: number, b: number, v: number): number {
	const t = invLerp(a, b, v);
	return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
	return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Move `current` towards `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
	if (current < target) return Math.min(current + maxDelta, target);
	return Math.max(current - maxDelta, target);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
	a = (a + Math.PI) % TAU;
	if (a < 0) a += TAU;
	return a - Math.PI;
}

/** Shortest signed difference b - a. */
export function angleDiff(a: number, b: number): number {
	return wrapAngle(b - a);
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
	return current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));
}

export function approachAngle(current: number, target: number, maxDelta: number): number {
	const d = angleDiff(current, target);
	if (Math.abs(d) <= maxDelta) return target;
	return wrapAngle(current + Math.sign(d) * maxDelta);
}

/** Heading convention: forward = (sin h, cos h) on the XZ plane. */
export function headingTo(dx: number, dz: number): number {
	return Math.atan2(dx, dz);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = bx - ax;
	const dz = bz - az;
	return dx * dx + dz * dz;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
	return Math.sqrt(dist2(ax, az, bx, bz));
}

export function len2d(x: number, z: number): number {
	return Math.sqrt(x * x + z * z);
}

/** Integer hash (deterministic) usable for per-cell randomness. Returns [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
	let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
	h = (h ^ (h >>> 16)) >>> 0;
	return h / 4294967296;
}

/** Distance from point to segment, squared. */
export function pointSegDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
	const abx = bx - ax;
	const abz = bz - az;
	const l2 = abx * abx + abz * abz;
	let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
	t = clamp(t, 0, 1);
	return dist2(px, pz, ax + abx * t, az + abz * t);
}

export function formatMoney(v: number): string {
	const sign = v < 0 ? '-' : '';
	return sign + '$' + Math.floor(Math.abs(v)).toLocaleString('en-US');
}
