// Pooled GPU particles (two Points batches: additive glow and alpha smoke), bullet tracers and a
// single flash light. Fixed-size typed arrays: no allocations after construction.

import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
	vAlpha = aAlpha;
	vColor = aColor;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = aSize * (300.0 / max(1.0, -mv.z));
	gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
	vec2 c = gl_PointCoord - 0.5;
	float d = length(c);
	if (d > 0.5) discard;
	float a = smoothstep(0.5, 0.1, d) * vAlpha;
	gl_FragColor = vec4(vColor, a);
}`;

export type ParticleKind = 'smoke' | 'fire' | 'spark' | 'flash' | 'dust' | 'blood' | 'water' | 'debris';

class ParticleBatch {
	readonly points: THREE.Points;
	private pos: Float32Array;
	private vel: Float32Array;
	private col: Float32Array;
	private size: Float32Array;
	private alpha: Float32Array;
	private life: Float32Array;
	private maxLife: Float32Array;
	private grow: Float32Array;
	private gravity: Float32Array;
	private baseAlpha: Float32Array;
	private count = 0;
	private geo: THREE.BufferGeometry;

	constructor(
		readonly capacity: number,
		blending: THREE.Blending,
	) {
		this.pos = new Float32Array(capacity * 3);
		this.vel = new Float32Array(capacity * 3);
		this.col = new Float32Array(capacity * 3);
		this.size = new Float32Array(capacity);
		this.alpha = new Float32Array(capacity);
		this.life = new Float32Array(capacity);
		this.maxLife = new Float32Array(capacity);
		this.grow = new Float32Array(capacity);
		this.gravity = new Float32Array(capacity);
		this.baseAlpha = new Float32Array(capacity);
		this.geo = new THREE.BufferGeometry();
		this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
		this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
		this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
		this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
		const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending });
		this.points = new THREE.Points(this.geo, mat);
		this.points.frustumCulled = false;
		this.geo.setDrawRange(0, 0);
	}

	emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number, alpha: number, grow: number, gravity: number): void {
		let i = this.count;
		if (i >= this.capacity) {
			// Overwrite a random old particle when saturated.
			i = Math.floor(Math.random() * this.capacity);
		} else this.count++;
		const i3 = i * 3;
		this.pos[i3] = x;
		this.pos[i3 + 1] = y;
		this.pos[i3 + 2] = z;
		this.vel[i3] = vx;
		this.vel[i3 + 1] = vy;
		this.vel[i3 + 2] = vz;
		this.col[i3] = r;
		this.col[i3 + 1] = g;
		this.col[i3 + 2] = b;
		this.size[i] = size;
		this.life[i] = life;
		this.maxLife[i] = life;
		this.grow[i] = grow;
		this.gravity[i] = gravity;
		this.baseAlpha[i] = alpha;
		this.alpha[i] = alpha;
	}

	update(dt: number): void {
		let i = 0;
		while (i < this.count) {
			this.life[i] -= dt;
			if (this.life[i] <= 0) {
				// Swap-remove with the last live particle.
				const last = this.count - 1;
				this.copy(last, i);
				this.count--;
				continue;
			}
			const i3 = i * 3;
			this.vel[i3 + 1] += this.gravity[i] * dt;
			const drag = Math.exp(-1.2 * dt);
			this.vel[i3] *= drag;
			this.vel[i3 + 2] *= drag;
			this.pos[i3] += this.vel[i3] * dt;
			this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
			this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
			if (this.pos[i3 + 1] < 0.02 && this.gravity[i] < 0) {
				this.pos[i3 + 1] = 0.02;
				this.vel[i3 + 1] *= -0.3;
			}
			this.size[i] += this.grow[i] * dt;
			const t = this.life[i] / this.maxLife[i];
			this.alpha[i] = this.baseAlpha[i] * Math.min(1, t * 2.5);
			i++;
		}
		this.geo.setDrawRange(0, this.count);
		for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) this.geo.getAttribute(name).needsUpdate = true;
	}

	private copy(from: number, to: number): void {
		if (from === to) return;
		const f3 = from * 3;
		const t3 = to * 3;
		for (let k = 0; k < 3; k++) {
			this.pos[t3 + k] = this.pos[f3 + k];
			this.vel[t3 + k] = this.vel[f3 + k];
			this.col[t3 + k] = this.col[f3 + k];
		}
		this.size[to] = this.size[from];
		this.alpha[to] = this.alpha[from];
		this.life[to] = this.life[from];
		this.maxLife[to] = this.maxLife[from];
		this.grow[to] = this.grow[from];
		this.gravity[to] = this.gravity[from];
		this.baseAlpha[to] = this.baseAlpha[from];
	}

	get live(): number {
		return this.count;
	}
}

class TracerPool {
	readonly lines: THREE.LineSegments;
	private pos: Float32Array;
	private col: Float32Array;
	private life: Float32Array;
	private next = 0;
	private geo = new THREE.BufferGeometry();

	constructor(readonly capacity: number) {
		this.pos = new Float32Array(capacity * 6);
		this.col = new Float32Array(capacity * 6);
		this.life = new Float32Array(capacity);
		this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
		this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
		const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
		this.lines = new THREE.LineSegments(this.geo, mat);
		this.lines.frustumCulled = false;
	}

	add(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
		const i = this.next;
		this.next = (this.next + 1) % this.capacity;
		const p = i * 6;
		this.pos[p] = ax;
		this.pos[p + 1] = ay;
		this.pos[p + 2] = az;
		this.pos[p + 3] = bx;
		this.pos[p + 4] = by;
		this.pos[p + 5] = bz;
		this.life[i] = 0.07;
	}

	update(dt: number): void {
		for (let i = 0; i < this.capacity; i++) {
			const l = Math.max(0, (this.life[i] -= dt));
			const a = l / 0.07;
			const p = i * 6;
			this.col[p] = 1 * a;
			this.col[p + 1] = 0.85 * a;
			this.col[p + 2] = 0.5 * a;
			this.col[p + 3] = 0.6 * a;
			this.col[p + 4] = 0.4 * a;
			this.col[p + 5] = 0.2 * a;
		}
		this.geo.getAttribute('position').needsUpdate = true;
		this.geo.getAttribute('color').needsUpdate = true;
	}
}

export class Effects {
	private glow = new ParticleBatch(1200, THREE.AdditiveBlending);
	private smoke = new ParticleBatch(1600, THREE.NormalBlending);
	private tracers = new TracerPool(64);
	readonly flash = new THREE.PointLight(0xffaa55, 0, 30, 1.6);
	private flashLife = 0;

	constructor(scene: THREE.Scene) {
		this.smoke.points.renderOrder = 2;
		this.glow.points.renderOrder = 3;
		scene.add(this.smoke.points, this.glow.points, this.tracers.lines, this.flash);
	}

	get liveParticles(): number {
		return this.glow.live + this.smoke.live;
	}

	update(dt: number): void {
		this.glow.update(dt);
		this.smoke.update(dt);
		this.tracers.update(dt);
		if (this.flashLife > 0) {
			this.flashLife -= dt;
			this.flash.intensity = Math.max(0, this.flashLife) * 220;
		} else this.flash.intensity = 0;
	}

	private lightFlash(x: number, y: number, z: number, strength: number): void {
		this.flash.position.set(x, y + 1, z);
		this.flashLife = Math.max(this.flashLife, strength);
	}

	explosion(x: number, y: number, z: number, radius: number): void {
		this.lightFlash(x, y, z, 0.6);
		for (let i = 0; i < 40; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = Math.random() * radius * 1.4;
			this.glow.emit(x, y + 0.5, z, Math.cos(a) * s, Math.random() * radius * 1.2, Math.sin(a) * s, 3 + Math.random() * 3, 0.5 + Math.random() * 0.4, 1, 0.55 + Math.random() * 0.3, 0.15, 1, 4, -2);
		}
		for (let i = 0; i < 30; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = Math.random() * radius * 0.6;
			this.smoke.emit(x, y + 1, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 3 + Math.random() * 3, 2.5 + Math.random() * 2, 0.12, 0.11, 0.1, 0.75, 2.5, 0.3);
		}
		for (let i = 0; i < 24; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 8 + Math.random() * 14;
			this.glow.emit(x, y + 0.6, z, Math.cos(a) * s, 4 + Math.random() * 8, Math.sin(a) * s, 0.35, 0.8 + Math.random() * 0.6, 1, 0.8, 0.4, 1, -0.1, -18);
		}
	}

	/** Continuous emitters: call every frame for burning / damaged vehicles. */
	vehicleSmoke(x: number, y: number, z: number, health: number, burning: boolean, dt: number): void {
		const rate = burning ? 40 : health < 0.25 ? 18 : 8;
		const n = rate * dt + Math.random();
		for (let i = 1; i < n; i++) {
			const dark = burning || health < 0.25;
			const c = dark ? 0.1 : 0.55;
			this.smoke.emit(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8, 0.8, 1.6 + Math.random(), c, c, c, dark ? 0.7 : 0.4, 1.6, 0.4);
			if (burning) this.glow.emit(x + (Math.random() - 0.5) * 1.2, y - 0.2, z + (Math.random() - 0.5) * 1.2, 0, 2 + Math.random() * 2, 0, 1.2 + Math.random(), 0.35 + Math.random() * 0.3, 1, 0.45 + Math.random() * 0.3, 0.1, 0.9, -1.5, 0);
		}
	}

	sparks(x: number, y: number, z: number, nx: number, ny: number, nz: number, count = 8): void {
		for (let i = 0; i < count; i++) {
			const s = 3 + Math.random() * 5;
			this.glow.emit(x, y, z, (nx + (Math.random() - 0.5)) * s, (ny + Math.random() * 0.8) * s, (nz + (Math.random() - 0.5)) * s, 0.18, 0.25 + Math.random() * 0.2, 1, 0.75, 0.35, 1, -0.2, -15);
		}
	}

	impactPuff(x: number, y: number, z: number, kind: 'world' | 'flesh' | 'metal'): void {
		if (kind === 'flesh') {
			for (let i = 0; i < 6; i++) this.smoke.emit(x, y, z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.25, 0.35, 0.55, 0.05, 0.05, 0.9, 0.4, -6);
		} else {
			for (let i = 0; i < 4; i++) this.smoke.emit(x, y, z, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), 0.4, 0.6, 0.6, 0.58, 0.55, 0.6, 1.2, 0);
		}
	}

	muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
		this.glow.emit(x, y, z, dx * 2, dy * 2, dz * 2, 0.7, 0.05, 1, 0.8, 0.4, 1, 0, 0);
		this.lightFlash(x, y - 1, z, 0.05);
	}

	tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
		this.tracers.add(ax, ay, az, bx, by, bz);
	}

	dust(x: number, z: number, amount: number): void {
		for (let i = 0; i < amount; i++) this.smoke.emit(x + (Math.random() - 0.5) * 1.5, 0.2, z + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, 0.8, 0.8, 0.5, 0.48, 0.42, 0.35, 1.5, 0);
	}

	splash(x: number, z: number): void {
		for (let i = 0; i < 6; i++) this.smoke.emit(x + (Math.random() - 0.5) * 2, -0.5, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.6, 0.7, 0.8, 0.9, 1, 0.5, 0.8, -12);
	}
}
