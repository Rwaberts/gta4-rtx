// Rotating radar-style minimap (camera-up), drawn from the pre-rendered city image.
// Blips for the player, police, mission targets, contacts and shops; a GPS route line.

import type { Point } from '../world/RoadNetwork';
import { el } from './dom';
import type { MapImage } from './mapImage';

export interface Blip {
	x: number;
	z: number;
	color: string;
	shape: 'dot' | 'square' | 'diamond' | 'letter';
	letter?: string;
	size?: number;
	/** Keep on the rim when out of range (mission targets, waypoint). */
	edge?: boolean;
	flash?: boolean;
}

export class Minimap {
	readonly root = el('div', { class: 'hud-minimap' });
	private canvas = document.createElement('canvas');
	private g: CanvasRenderingContext2D;
	private size = 210;
	private t = 0;

	constructor(
		parent: HTMLElement,
		private readonly map: MapImage,
	) {
		this.canvas.width = this.size;
		this.canvas.height = this.size;
		this.g = this.canvas.getContext('2d')!;
		this.root.append(this.canvas);
		parent.append(this.root);
	}

	/**
	 * @param yaw camera yaw (forward = (sin, cos)); the view is rotated so forward points up
	 * @param zoom pixels per metre
	 */
	draw(x: number, z: number, yaw: number, heading: number, zoom: number, blips: readonly Blip[], route: readonly Point[] | null, routeColor: string, dt: number): void {
		this.t += dt;
		const g = this.g;
		const S = this.size;
		const R = S / 2;
		const m = this.map;
		const theta = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
		g.save();
		g.clearRect(0, 0, S, S);
		g.beginPath();
		g.arc(R, R, R - 2, 0, Math.PI * 2);
		g.clip();
		g.fillStyle = '#0e2a3c';
		g.fillRect(0, 0, S, S);
		g.translate(R, R);
		g.rotate(theta);
		const k = zoom / m.scale;
		g.scale(k, k);
		g.translate(-(x - m.originX) * m.scale, -(z - m.originZ) * m.scale);
		g.imageSmoothingEnabled = true;
		// Only blit the part of the map image that can be visible.
		const half = (R / zoom) * 1.42 * m.scale;
		const cx = (x - m.originX) * m.scale;
		const cz = (z - m.originZ) * m.scale;
		const sx = Math.max(0, cx - half);
		const sy = Math.max(0, cz - half);
		const sw = Math.min(m.canvas.width - sx, half * 2);
		const sh = Math.min(m.canvas.height - sy, half * 2);
		if (sw > 0 && sh > 0) g.drawImage(m.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
		if (route && route.length > 1) {
			g.strokeStyle = routeColor;
			g.lineWidth = 3.5 / k;
			g.lineJoin = 'round';
			g.globalAlpha = 0.9;
			g.beginPath();
			g.moveTo((route[0].x - m.originX) * m.scale, (route[0].z - m.originZ) * m.scale);
			for (let i = 1; i < route.length; i++) g.lineTo((route[i].x - m.originX) * m.scale, (route[i].z - m.originZ) * m.scale);
			g.stroke();
			g.globalAlpha = 1;
		}
		g.restore();

		// Blips in screen space (they stay upright).
		const cos = Math.cos(theta);
		const sin = Math.sin(theta);
		for (const b of blips) {
			let bx = (b.x - x) * zoom;
			let bz = (b.z - z) * zoom;
			const rx = bx * cos - bz * sin;
			const rz = bx * sin + bz * cos;
			bx = rx;
			bz = rz;
			const d = Math.hypot(bx, bz);
			const lim = R - 9;
			if (d > lim) {
				if (!b.edge) continue;
				bx *= lim / d;
				bz *= lim / d;
			}
			if (b.flash && Math.floor(this.t * 4) % 2 === 0) continue;
			this.blip(R + bx, R + bz, b);
		}

		// Player arrow.
		const ha = theta + Math.atan2(Math.cos(heading), Math.sin(heading));
		g.save();
		g.translate(R, R);
		g.rotate(ha + Math.PI / 2);
		g.fillStyle = '#ffffff';
		g.strokeStyle = '#05080d';
		g.lineWidth = 2;
		g.beginPath();
		g.moveTo(0, -8);
		g.lineTo(6, 6);
		g.lineTo(0, 3);
		g.lineTo(-6, 6);
		g.closePath();
		g.stroke();
		g.fill();
		g.restore();

		// North marker on the rim.
		const north = { x: R + (R - 11) * Math.cos(theta - Math.PI / 2), y: R + (R - 11) * Math.sin(theta - Math.PI / 2) };
		g.fillStyle = '#39f0d0';
		g.font = 'bold 12px sans-serif';
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		g.fillText('N', north.x, north.y);
	}

	private blip(x: number, y: number, b: Blip): void {
		const g = this.g;
		const s = b.size ?? 4;
		g.fillStyle = b.color;
		g.strokeStyle = 'rgba(0,0,0,0.8)';
		g.lineWidth = 1.5;
		if (b.shape === 'letter') {
			g.beginPath();
			g.arc(x, y, s + 3, 0, Math.PI * 2);
			g.fillStyle = 'rgba(5,8,13,0.85)';
			g.fill();
			g.strokeStyle = b.color;
			g.stroke();
			g.fillStyle = b.color;
			g.font = `bold ${s + 5}px sans-serif`;
			g.textAlign = 'center';
			g.textBaseline = 'middle';
			g.fillText(b.letter ?? '?', x, y + 0.5);
			return;
		}
		g.beginPath();
		if (b.shape === 'square') g.rect(x - s, y - s, s * 2, s * 2);
		else if (b.shape === 'diamond') {
			g.moveTo(x, y - s - 1);
			g.lineTo(x + s + 1, y);
			g.lineTo(x, y + s + 1);
			g.lineTo(x - s - 1, y);
			g.closePath();
		} else g.arc(x, y, s, 0, Math.PI * 2);
		g.stroke();
		g.fill();
	}
}
