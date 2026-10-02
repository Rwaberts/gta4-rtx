// At night, a handful of real point lights are moved to the street lamps nearest the camera,
// giving warm pools of light on the road without paying for thousands of lights.

import * as THREE from 'three';
import type { CityLayout } from '../world/CityLayout';

const COUNT = 4;

export class LampLights {
	private lights: THREE.PointLight[] = [];
	private timer = 0;

	constructor(
		scene: THREE.Scene,
		private readonly city: CityLayout,
	) {
		for (let i = 0; i < COUNT; i++) {
			const l = new THREE.PointLight(0xffd8a0, 0, 26, 1.6);
			l.castShadow = false;
			scene.add(l);
			this.lights.push(l);
		}
	}

	update(camX: number, camZ: number, night: number, indoors: boolean, dt: number): void {
		const on = night > 0.15 && !indoors;
		if (!on) {
			for (const l of this.lights) l.intensity = 0;
			return;
		}
		this.timer -= dt;
		if (this.timer > 0) return;
		this.timer = 0.4;
		// Nearest lamps (partial selection).
		const best: Array<{ d: number; i: number }> = [];
		const lamps = this.city.lamps;
		for (let i = 0; i < lamps.length; i++) {
			const l = lamps[i];
			const dx = l.x - camX;
			const dz = l.z - camZ;
			if (Math.abs(dx) > 70 || Math.abs(dz) > 70) continue;
			const d = dx * dx + dz * dz;
			if (best.length < COUNT) best.push({ d, i });
			else {
				let worst = 0;
				for (let k = 1; k < COUNT; k++) if (best[k].d > best[worst].d) worst = k;
				if (d < best[worst].d) best[worst] = { d, i };
			}
		}
		this.lights.forEach((light, k) => {
			const b = best[k];
			if (!b) {
				light.intensity = 0;
				return;
			}
			const l = lamps[b.i];
			light.position.set(l.x + Math.sin(l.heading) * 1.75, 6.0, l.z + Math.cos(l.heading) * 1.75);
			light.intensity = 70 * night;
		});
	}
}
