// Shared materials. Facade windows are generated in the fragment shader from world position,
// so a single instanced unit box can render every building with correct window scale and
// time-of-day lighting (one uniform), without per-building textures.

import * as THREE from 'three';

export const sharedUniforms = {
	uNight: { value: 0 },
	uTime: { value: 0 },
	uWet: { value: 0 },
};

const HASH_GLSL = /* glsl */ `
float nhHash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
`;

export function createBuildingMaterial(): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
	m.onBeforeCompile = (shader) => {
		shader.uniforms.uNight = sharedUniforms.uNight;
		shader.uniforms.uWet = sharedUniforms.uWet;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
attribute float aStyle;
varying float vStyle;
varying vec3 vWPos;
varying vec3 vWNormal;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vStyle = aStyle;
mat4 nhModel = modelMatrix;
#ifdef USE_INSTANCING
nhModel = modelMatrix * instanceMatrix;
#endif
vWPos = (nhModel * vec4(position, 1.0)).xyz;
vWNormal = normalize(mat3(nhModel) * normal);`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
uniform float uNight;
uniform float uWet;
varying float vStyle;
varying vec3 vWPos;
varying vec3 vWNormal;
${HASH_GLSL}`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
float nhWin = 0.0;
float nhLit = 0.0;
float nhTint = 0.0;
if (vStyle > 0.5 && abs(vWNormal.y) < 0.5) {
	bool xFace = abs(vWNormal.x) > 0.5;
	float u = xFace ? vWPos.z : vWPos.x;
	float plane = xFace ? vWPos.x : vWPos.z;
	float v = vWPos.y;
	vec2 cellSize = vec2(3.4, 3.6);
	vec2 winSize = vec2(0.62, 0.55);
	if (vStyle > 1.5 && vStyle < 2.5) { cellSize = vec2(3.6, 3.0); winSize = vec2(0.42, 0.5); }
	else if (vStyle > 2.5 && vStyle < 3.5) { cellSize = vec2(1.8, 3.7); winSize = vec2(0.92, 0.8); }
	else if (vStyle > 3.5) { cellSize = vec2(6.0, 4.0); winSize = vec2(0.6, 0.3); }
	vec2 g = vec2(u, v - 0.9) / cellSize;
	vec2 id = floor(g);
	vec2 f = fract(g) - 0.5;
	nhWin = step(abs(f.x), winSize.x * 0.5) * step(abs(f.y), winSize.y * 0.5) * step(0.0, g.y);
	if (vStyle > 3.5) nhWin *= step(0.5, id.y) * step(id.y, 1.5);
	float seed = floor(plane * 0.37) * 17.0;
	float r = nhHash(id + vec2(seed, seed * 0.31));
	nhLit = step(0.52, r);
	nhTint = nhHash(id.yx + seed);
	vec3 glass = vStyle > 2.5 && vStyle < 3.5 ? vec3(0.30, 0.44, 0.56) : vec3(0.16, 0.2, 0.25);
	glass *= 0.75 + 0.5 * fract(id.y * 0.37 + id.x * 0.11 + seed);
	diffuseColor.rgb = mix(diffuseColor.rgb, glass, nhWin);
}
// Fake ambient occlusion at the base of walls and darker roofs.
diffuseColor.rgb *= mix(0.62, 1.0, clamp(vWPos.y / 3.5, 0.0, 1.0));
if (vWNormal.y > 0.5) diffuseColor.rgb *= 0.72;
diffuseColor.rgb *= 1.0 - uWet * 0.25;`,
			)
			.replace(
				'#include <emissivemap_fragment>',
				`#include <emissivemap_fragment>
vec3 nhLitCol = mix(vec3(1.0, 0.78, 0.48), vec3(0.7, 0.85, 1.0), step(0.72, nhTint));
totalEmissiveRadiance += nhLitCol * nhWin * nhLit * uNight * 0.85;`,
			);
	};
	m.customProgramCacheKey = () => 'nh-building';
	return m;
}

/** Ground / road material that darkens when wet. */
export function createGroundMaterial(color = 0xffffff): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial({ color });
	m.onBeforeCompile = (shader) => {
		shader.uniforms.uWet = sharedUniforms.uWet;
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform float uWet;')
			.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uWet * 0.35;');
	};
	m.customProgramCacheKey = () => 'nh-ground';
	return m;
}

/** Lamp heads, signage, vehicle lights: emissive scaled by night factor. */
export function createNightGlowMaterial(color: number, dayIntensity = 0.05, nightIntensity = 1.6): THREE.MeshLambertMaterial {
	const m = new THREE.MeshLambertMaterial({ color: 0x333333, emissive: color, emissiveIntensity: dayIntensity });
	m.userData.glow = { dayIntensity, nightIntensity };
	return m;
}

export function updateGlowMaterial(m: THREE.MeshLambertMaterial, night: number): void {
	const g = m.userData.glow as { dayIntensity: number; nightIntensity: number } | undefined;
	if (g) m.emissiveIntensity = g.dayIntensity + (g.nightIntensity - g.dayIntensity) * night;
}
