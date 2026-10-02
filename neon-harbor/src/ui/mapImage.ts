// Pre-renders the whole city (land, districts, lots, roads, water) into one canvas at startup.
// The minimap and the full map then just blit / transform this image.

import { DISTRICTS } from '../data/districts';
import type { CityLayout } from '../world/CityLayout';

export interface MapImage {
	canvas: HTMLCanvasElement;
	/** Pixels per metre. */
	scale: number;
	/** World coordinate of pixel (0, 0). */
	originX: number;
	originZ: number;
}

export function renderMapImage(city: CityLayout, scale = 0.5): MapImage {
	const L = city.land;
	const originX = L.minX - 200;
	const originZ = L.minZ - 200;
	const w = Math.ceil((L.maxX + 400 - originX) * scale);
	const h = Math.ceil((L.maxZ + 300 - originZ) * scale);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const g = canvas.getContext('2d')!;
	const X = (x: number) => (x - originX) * scale;
	const Z = (z: number) => (z - originZ) * scale;
	// Water.
	g.fillStyle = '#0e2a3c';
	g.fillRect(0, 0, w, h);
	// Land base (road colour) and piers.
	g.fillStyle = '#2b2f36';
	g.fillRect(X(L.minX), Z(L.minZ), (L.maxX - L.minX) * scale, (L.maxZ - L.minZ) * scale);
	for (const p of city.piers) g.fillRect(X(p.minX), Z(p.minZ), (p.maxX - p.minX) * scale, (p.maxZ - p.minZ) * scale);
	// Lots tinted by district.
	for (const c of city.cells) {
		const col = c.kind === 'park' ? '#2f5a34' : c.kind === 'field' ? '#4a5a2c' : DISTRICTS[c.district].mapColor;
		g.fillStyle = col;
		g.fillRect(X(c.lot.minX), Z(c.lot.minZ), (c.lot.maxX - c.lot.minX) * scale, (c.lot.maxZ - c.lot.minZ) * scale);
	}
	// Margins (beach, forest, docks).
	g.globalAlpha = 0.85;
	for (const gp of city.ground) {
		if (gp.y > 0.13) continue;
		g.fillStyle = '#' + gp.color.toString(16).padStart(6, '0');
		g.fillRect(X(gp.minX), Z(gp.minZ), (gp.maxX - gp.minX) * scale, (gp.maxZ - gp.minZ) * scale);
	}
	g.globalAlpha = 1;
	// Building footprints.
	g.fillStyle = 'rgba(0,0,0,0.28)';
	for (const b of city.buildings) {
		if (b.y0 > 0) continue;
		g.fillRect(X(b.minX), Z(b.minZ), Math.max(1, (b.maxX - b.minX) * scale), Math.max(1, (b.maxZ - b.minZ) * scale));
	}
	// Roads on top so they read clearly.
	g.strokeStyle = '#4a505a';
	g.lineWidth = Math.max(2, 14 * scale);
	g.lineCap = 'square';
	g.beginPath();
	for (const e of city.edges) {
		const a = city.nodes[e.a]!;
		const b = city.nodes[e.b]!;
		g.moveTo(X(a.x), Z(a.z));
		g.lineTo(X(b.x), Z(b.z));
	}
	g.stroke();
	// Runway.
	const r = city.runway;
	g.fillStyle = '#3a3a40';
	g.fillRect(X(r.minX), Z(r.minZ), (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
	return { canvas, scale, originX, originZ };
}
