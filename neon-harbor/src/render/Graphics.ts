// Renderer, scene, camera, sky and the sun/ambient lights. Quality settings live here.

import * as THREE from 'three';
import { sharedUniforms } from './materials';

export interface GraphicsQuality {
	shadows: boolean;
	shadowMapSize: number;
	pixelRatio: number;
	drawDistance: number;
	detailDistance: number;
	antialias: boolean;
}

export const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', GraphicsQuality> = {
	low: { shadows: false, shadowMapSize: 1024, pixelRatio: 0.75, drawDistance: 520, detailDistance: 200, antialias: false },
	medium: { shadows: true, shadowMapSize: 1024, pixelRatio: 1, drawDistance: 750, detailDistance: 300, antialias: false },
	high: { shadows: true, shadowMapSize: 2048, pixelRatio: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1), drawDistance: 1000, detailDistance: 420, antialias: true },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize(position);
	vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uCloud;
uniform float uTime;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
	vec3 d = normalize(vDir);
	float t = clamp(d.y * 1.4 + 0.08, 0.0, 1.0);
	vec3 col = mix(uHorizon, uTop, pow(t, 0.7));
	float sd = max(dot(d, uSunDir), 0.0);
	col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.25) * (1.0 - uCloud * 0.8);
	// Stars.
	if (uNight > 0.01 && d.y > 0.0) {
		vec2 sp = d.xz / (d.y + 0.3) * 180.0;
		float s = step(0.996, h21(floor(sp))) * uNight * (1.0 - uCloud);
		col += vec3(s);
	}
	// Moving cloud layer.
	if (d.y > 0.0) {
		vec2 cp = d.xz / (d.y + 0.15) * 2.2 + vec2(uTime * 0.004, uTime * 0.002);
		float c = noise(cp) * 0.6 + noise(cp * 2.3) * 0.3 + noise(cp * 5.1) * 0.1;
		float cov = smoothstep(0.75 - uCloud * 0.55, 1.0 - uCloud * 0.3, c) * smoothstep(0.0, 0.15, d.y);
		vec3 cloudCol = mix(uHorizon * 1.1 + 0.1, uHorizon * 0.55, uCloud) * (1.0 - uNight * 0.7);
		col = mix(col, cloudCol, cov * 0.9);
	}
	gl_FragColor = vec4(col, 1.0);
}`;

export class Graphics {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
	readonly hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a5040, 1.1);
	readonly ambient = new THREE.AmbientLight(0xffffff, 0.15);
	readonly sky: THREE.Mesh;
	readonly skyUniforms = {
		uTop: { value: new THREE.Color(0x3a78c8) },
		uHorizon: { value: new THREE.Color(0xb8d4ec) },
		uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
		uSunColor: { value: new THREE.Color(0xfff2d8) },
		uNight: sharedUniforms.uNight,
		uCloud: { value: 0.2 },
		uTime: sharedUniforms.uTime,
	};
	readonly fog: THREE.Fog;
	quality: GraphicsQuality;

	constructor(container: HTMLElement, quality: GraphicsQuality) {
		this.quality = { ...quality };
		this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(quality.pixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.shadowMap.enabled = quality.shadows;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		container.appendChild(this.renderer.domElement);
		this.renderer.domElement.id = 'game-canvas';

		this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, quality.drawDistance + 600);
		this.fog = new THREE.Fog(0xb8d4ec, 120, quality.drawDistance);
		this.scene.fog = this.fog;
		this.scene.background = new THREE.Color(0xb8d4ec);

		this.sun.castShadow = quality.shadows;
		this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
		const sc = this.sun.shadow.camera;
		sc.left = -90;
		sc.right = 90;
		sc.top = 90;
		sc.bottom = -90;
		sc.near = 1;
		sc.far = 600;
		this.sun.shadow.bias = -0.0006;
		this.sun.shadow.normalBias = 0.6;
		this.scene.add(this.sun, this.sun.target, this.hemi, this.ambient);

		const skyGeo = new THREE.SphereGeometry(1, 32, 16);
		const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false });
		this.sky = new THREE.Mesh(skyGeo, skyMat);
		this.sky.scale.setScalar(5000);
		this.sky.renderOrder = -1;
		this.sky.frustumCulled = false;
		this.scene.add(this.sky);

		window.addEventListener('resize', () => this.resize());
	}

	resize(): void {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	applyQuality(q: GraphicsQuality): void {
		const shadowsChanged = q.shadows !== this.renderer.shadowMap.enabled;
		this.quality = { ...q };
		this.renderer.setPixelRatio(q.pixelRatio);
		this.renderer.shadowMap.enabled = q.shadows;
		this.sun.castShadow = q.shadows;
		if (this.sun.shadow.mapSize.x !== q.shadowMapSize) {
			this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
			this.sun.shadow.map?.dispose();
			this.sun.shadow.map = null;
		}
		this.camera.far = q.drawDistance + 600;
		this.camera.updateProjectionMatrix();
		this.fog.far = q.drawDistance;
		// Shadow toggles require material recompiles (expensive, so only when they change).
		if (!shadowsChanged) return;
		this.scene.traverse((o) => {
			const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
			if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
			else if (m) m.needsUpdate = true;
		});
	}

	/** Keeps the shadow frustum centred on the focus point. */
	followShadows(x: number, z: number): void {
		const d = this.skyUniforms.uSunDir.value;
		// Snap to texel grid to reduce shimmering.
		const snap = 2;
		const fx = Math.round(x / snap) * snap;
		const fz = Math.round(z / snap) * snap;
		this.sun.target.position.set(fx, 0, fz);
		this.sun.position.set(fx + d.x * 300, Math.max(30, d.y * 300), fz + d.z * 300);
		this.sky.position.copy(this.camera.position);
	}

	render(): void {
		this.renderer.render(this.scene, this.camera);
	}
}
