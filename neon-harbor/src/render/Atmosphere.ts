// Day/night cycle and weather presentation: sun/moon path, sky gradient, fog, light colours,
// exposure, wet roads, rain streaks and lightning. `skyAt()` is a pure function (unit-tested).

import * as THREE from 'three';
import type { WeatherParams } from '../sim/Weather';
import type { Graphics } from './Graphics';
import { sharedUniforms } from './materials';

interface Key {
	h: number;
	top: number;
	horizon: number;
	sun: number;
	sunI: number;
	hemiSky: number;
	hemiGround: number;
	hemiI: number;
	exposure: number;
}

// Keyframes over the day (hour 0..24).
const KEYS: Key[] = [
	{ h: 0, top: 0x050a18, horizon: 0x141c34, sun: 0x8aa0d0, sunI: 0.35, hemiSky: 0x2a3a66, hemiGround: 0x101014, hemiI: 0.55, exposure: 1.15 },
	{ h: 4.8, top: 0x081028, horizon: 0x1a2240, sun: 0x8aa0d0, sunI: 0.3, hemiSky: 0x2a3a66, hemiGround: 0x101014, hemiI: 0.55, exposure: 1.1 },
	{ h: 6.2, top: 0x34507e, horizon: 0xff9a6a, sun: 0xffa86a, sunI: 1.0, hemiSky: 0x8aa0c8, hemiGround: 0x4a3a30, hemiI: 0.8, exposure: 1.0 },
	{ h: 8, top: 0x3a78c8, horizon: 0xb8d4ec, sun: 0xfff0d8, sunI: 2.1, hemiSky: 0xbcd4ff, hemiGround: 0x5a5040, hemiI: 1.05, exposure: 1.0 },
	{ h: 12.5, top: 0x2a68c8, horizon: 0xc4dcf0, sun: 0xfffaf0, sunI: 2.5, hemiSky: 0xc4d8ff, hemiGround: 0x5a5040, hemiI: 1.15, exposure: 1.0 },
	{ h: 16.5, top: 0x3a70c0, horizon: 0xe2d4b4, sun: 0xffe2b4, sunI: 2.1, hemiSky: 0xbcd0f0, hemiGround: 0x5a4a3a, hemiI: 1.0, exposure: 1.0 },
	{ h: 18.4, top: 0x3a3a80, horizon: 0xff7a4a, sun: 0xff8a50, sunI: 1.1, hemiSky: 0xb08aa0, hemiGround: 0x4a3030, hemiI: 0.8, exposure: 1.05 },
	{ h: 19.6, top: 0x161838, horizon: 0x5a3458, sun: 0xa070a0, sunI: 0.45, hemiSky: 0x4a4a7a, hemiGround: 0x18141a, hemiI: 0.6, exposure: 1.15 },
	{ h: 21, top: 0x050a18, horizon: 0x141c34, sun: 0x8aa0d0, sunI: 0.35, hemiSky: 0x2a3a66, hemiGround: 0x101014, hemiI: 0.55, exposure: 1.15 },
	{ h: 24, top: 0x050a18, horizon: 0x141c34, sun: 0x8aa0d0, sunI: 0.35, hemiSky: 0x2a3a66, hemiGround: 0x101014, hemiI: 0.55, exposure: 1.15 },
];

export interface SkyState {
	top: THREE.Color;
	horizon: THREE.Color;
	sun: THREE.Color;
	sunIntensity: number;
	hemiSky: THREE.Color;
	hemiGround: THREE.Color;
	hemiIntensity: number;
	exposure: number;
	/** Direction towards the light source (sun by day, moon by night). */
	dir: THREE.Vector3;
	/** True when the dominant light is the sun. */
	daylight: boolean;
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
const GREY = new THREE.Color(0x8a9098);

/** Sky / lighting for an hour of the day, modulated by weather. Pure (no scene access). */
export function skyAt(hour: number, weather: WeatherParams, out?: SkyState): SkyState {
	const s: SkyState = out ?? {
		top: new THREE.Color(),
		horizon: new THREE.Color(),
		sun: new THREE.Color(),
		sunIntensity: 0,
		hemiSky: new THREE.Color(),
		hemiGround: new THREE.Color(),
		hemiIntensity: 0,
		exposure: 1,
		dir: new THREE.Vector3(),
		daylight: true,
	};
	const h = ((hour % 24) + 24) % 24;
	let i = 0;
	while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
	const a = KEYS[i];
	const b = KEYS[i + 1];
	const t = (h - a.h) / (b.h - a.h);
	const mix = (ca: number, cb: number, c: THREE.Color) => c.copy(tmpA.setHex(ca)).lerp(tmpB.setHex(cb), t);
	mix(a.top, b.top, s.top);
	mix(a.horizon, b.horizon, s.horizon);
	mix(a.sun, b.sun, s.sun);
	mix(a.hemiSky, b.hemiSky, s.hemiSky);
	mix(a.hemiGround, b.hemiGround, s.hemiGround);
	s.sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
	s.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;
	s.exposure = a.exposure + (b.exposure - a.exposure) * t;

	// Sun from the east (sunrise ~6:00) over the south to the west (~18:30); moon at night.
	const dayT = (h - 6) / 12.5;
	s.daylight = dayT > -0.02 && dayT < 1.02;
	const phase = s.daylight ? Math.min(1, Math.max(0, dayT)) : (((h - 18.5 + 24) % 24) / 11.5);
	const ang = Math.PI * phase;
	s.dir.set(Math.cos(ang), Math.max(0.08, Math.sin(ang)) * (s.daylight ? 1 : 0.8), s.daylight ? 0.35 * Math.sin(ang) : -0.25).normalize();

	// Weather: clouds desaturate and darken.
	const c = weather.cloud;
	s.top.lerp(GREY, c * 0.75);
	s.horizon.lerp(GREY, c * 0.6);
	s.sunIntensity *= weather.light * (1 - c * 0.35);
	s.hemiIntensity *= 0.75 + weather.light * 0.25;
	return s;
}

const RAIN_COUNT = 2600;

export class Atmosphere {
	private sky: SkyState = skyAt(12, { cloud: 0, rain: 0, fog: 0, light: 1, wind: 0 });
	private rain: THREE.LineSegments;
	private rainPos: Float32Array;
	private rainSpeed: Float32Array;
	private readonly box = { w: 44, h: 26 };

	constructor(private readonly g: Graphics) {
		this.rainPos = new Float32Array(RAIN_COUNT * 6);
		this.rainSpeed = new Float32Array(RAIN_COUNT);
		for (let i = 0; i < RAIN_COUNT; i++) {
			this.rainPos[i * 6] = (Math.random() - 0.5) * this.box.w;
			this.rainPos[i * 6 + 1] = Math.random() * this.box.h;
			this.rainPos[i * 6 + 2] = (Math.random() - 0.5) * this.box.w;
			this.rainSpeed[i] = 17 + Math.random() * 6;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
		this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaac4dd, transparent: true, opacity: 0.4, depthWrite: false }));
		this.rain.frustumCulled = false;
		this.rain.visible = false;
		g.scene.add(this.rain);
	}

	/**
	 * @param hour clock hour, @param weather blended weather params, @param lightning 0..1 flash,
	 * @param wet road wetness, @param indoors hide precipitation and use a neutral sky
	 */
	update(hour: number, weather: WeatherParams, lightning: number, wet: number, night: number, indoors: boolean, dt: number): void {
		const g = this.g;
		const s = skyAt(hour, weather, this.sky);
		const u = g.skyUniforms;
		u.uTop.value.copy(s.top);
		u.uHorizon.value.copy(s.horizon);
		u.uSunColor.value.copy(s.sun);
		u.uSunDir.value.copy(s.dir);
		u.uCloud.value = weather.cloud;
		sharedUniforms.uNight.value = night;
		sharedUniforms.uWet.value = wet;

		g.sun.color.copy(s.sun);
		g.sun.intensity = s.sunIntensity;
		g.hemi.color.copy(s.hemiSky);
		g.hemi.groundColor.copy(s.hemiGround);
		g.hemi.intensity = s.hemiIntensity + lightning * 2.5;
		g.ambient.intensity = 0.12 + night * 0.18 + lightning * 1.5;
		g.renderer.toneMappingExposure = s.exposure;

		// Fog: thicker in rain / sea fog, tinted by the horizon.
		const far = g.quality.drawDistance;
		const fogF = weather.fog;
		g.fog.color.copy(s.horizon).lerp(GREY, fogF * 0.5);
		if (lightning > 0) g.fog.color.lerp(tmpA.setRGB(0.8, 0.85, 1), lightning * 0.5);
		g.fog.near = indoors ? 30 : Math.max(15, 140 * (1 - fogF * 0.85));
		g.fog.far = indoors ? 120 : Math.max(110, far * (1 - fogF * 0.75));
		(g.scene.background as THREE.Color).copy(g.fog.color);

		// Rain streaks follow the camera.
		const intensity = indoors ? 0 : weather.rain;
		this.rain.visible = intensity > 0.02;
		if (this.rain.visible) this.updateRain(intensity, weather.wind, dt);
	}

	private updateRain(intensity: number, wind: number, dt: number): void {
		const cam = this.g.camera.position;
		const p = this.rainPos;
		const n = Math.floor(RAIN_COUNT * intensity);
		const len = 0.55;
		const wx = wind * 4;
		const half = this.box.w / 2;
		for (let i = 0; i < n; i++) {
			const o = i * 6;
			let x = p[o];
			let y = p[o + 1] - this.rainSpeed[i] * dt;
			let z = p[o + 2];
			x += wx * dt;
			if (y < 0) {
				y += this.box.h;
				x = (Math.random() - 0.5) * this.box.w;
				z = (Math.random() - 0.5) * this.box.w;
			}
			if (x > half) x -= this.box.w;
			p[o] = x;
			p[o + 1] = y;
			p[o + 2] = z;
			p[o + 3] = x - wx * 0.03;
			p[o + 4] = y + len;
			p[o + 5] = z;
		}
		this.rain.position.set(cam.x, cam.y - this.box.h * 0.45, cam.z);
		const geo = this.rain.geometry;
		geo.setDrawRange(0, n * 2);
		(geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
		(this.rain.material as THREE.LineBasicMaterial).opacity = 0.25 + intensity * 0.3;
	}
}
