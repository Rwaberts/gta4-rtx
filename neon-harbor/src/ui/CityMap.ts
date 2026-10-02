// Full-screen city map: pan (drag), zoom (wheel / buttons), POI legend, click to set a waypoint.

import type { Poi } from '../world/CityLayout';
import { button, el } from './dom';
import type { MapImage } from './mapImage';

export const POI_ICONS: Record<string, { letter: string; color: string; label: string }> = {
	safehouse: { letter: 'H', color: '#39f0d0', label: 'Safehouse (save)' },
	hospital: { letter: '+', color: '#ff5a6a', label: 'Hospital' },
	police: { letter: 'P', color: '#5a8cff', label: 'Police precinct' },
	weapons: { letter: 'W', color: '#ffa53a', label: 'Ironclad Outfitters' },
	store: { letter: 'S', color: '#7cff6a', label: 'QuikStop 24' },
	exchange: { letter: '$', color: '#ffd84a', label: 'Gilded Gull Exchange' },
	dealership: { letter: 'C', color: '#4ad8ff', label: 'Coastline Motors' },
	mechanic: { letter: 'R', color: '#c8c8c8', label: 'Wrench & Ratchet' },
	property: { letter: 'B', color: '#e8e8e8', label: 'Business for sale' },
	contact: { letter: 'M', color: '#ff4ad8', label: 'Mission contact' },
};

export interface CityMapOptions {
	map: MapImage;
	pois: readonly Poi[];
	player: () => { x: number; z: number; heading: number };
	waypoint: () => { x: number; z: number } | null;
	setWaypoint: (p: { x: number; z: number } | null) => void;
	markers: () => Array<{ x: number; z: number; color: string }>;
	ownedProperties: () => ReadonlySet<string>;
	back: () => void;
}

export function cityMapPanel(o: CityMapOptions): HTMLElement {
	const m = o.map;
	const canvas = document.createElement('canvas');
	const W = Math.max(320, Math.min(900, window.innerWidth - 340));
	const H = Math.max(240, Math.min(700, window.innerHeight - 190));
	canvas.width = W;
	canvas.height = H;
	canvas.className = 'citymap-canvas';
	const g = canvas.getContext('2d')!;
	const p0 = o.player();
	let cx = p0.x;
	let cz = p0.z;
	let zoom = 0.45; // px per metre
	let drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;

	const toScreen = (x: number, z: number) => ({ x: W / 2 + (x - cx) * zoom, y: H / 2 + (z - cz) * zoom });
	const toWorld = (sx: number, sy: number) => ({ x: cx + (sx - W / 2) / zoom, z: cz + (sy - H / 2) / zoom });

	const draw = () => {
		g.fillStyle = '#0e2a3c';
		g.fillRect(0, 0, W, H);
		const k = zoom / m.scale;
		const tl = toScreen(m.originX, m.originZ);
		g.imageSmoothingEnabled = true;
		g.drawImage(m.canvas, tl.x, tl.y, m.canvas.width * k, m.canvas.height * k);
		// POIs.
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		for (const p of o.pois) {
			const icon = POI_ICONS[p.kind];
			if (!icon) continue;
			const s = toScreen(p.x, p.z);
			const owned = p.kind === 'property' && o.ownedProperties().has(p.id);
			g.beginPath();
			g.arc(s.x, s.y, 9, 0, Math.PI * 2);
			g.fillStyle = 'rgba(5,8,13,0.9)';
			g.fill();
			g.strokeStyle = owned ? '#39f0d0' : icon.color;
			g.lineWidth = 2;
			g.stroke();
			g.fillStyle = owned ? '#39f0d0' : icon.color;
			g.font = 'bold 12px sans-serif';
			g.fillText(icon.letter, s.x, s.y + 0.5);
			if (zoom > 0.6) {
				g.font = '11px sans-serif';
				g.fillStyle = '#dfe';
				g.fillText(p.name, s.x, s.y + 17);
			}
		}
		for (const mk of o.markers()) {
			const s = toScreen(mk.x, mk.z);
			g.fillStyle = mk.color;
			g.beginPath();
			g.arc(s.x, s.y, 6, 0, Math.PI * 2);
			g.fill();
		}
		const wp = o.waypoint();
		if (wp) {
			const s = toScreen(wp.x, wp.z);
			g.strokeStyle = '#39f0d0';
			g.lineWidth = 3;
			g.beginPath();
			g.moveTo(s.x - 8, s.y - 8);
			g.lineTo(s.x + 8, s.y + 8);
			g.moveTo(s.x + 8, s.y - 8);
			g.lineTo(s.x - 8, s.y + 8);
			g.stroke();
		}
		const pl = o.player();
		const s = toScreen(pl.x, pl.z);
		g.save();
		g.translate(s.x, s.y);
		g.rotate(Math.atan2(Math.cos(pl.heading), Math.sin(pl.heading)) + Math.PI / 2);
		g.fillStyle = '#fff';
		g.beginPath();
		g.moveTo(0, -10);
		g.lineTo(7, 7);
		g.lineTo(0, 3);
		g.lineTo(-7, 7);
		g.closePath();
		g.fill();
		g.restore();
	};

	canvas.addEventListener('mousedown', (e) => {
		drag = { x: e.offsetX, y: e.offsetY, cx, cz, moved: false };
	});
	canvas.addEventListener('mousemove', (e) => {
		if (!drag) return;
		const dx = e.offsetX - drag.x;
		const dy = e.offsetY - drag.y;
		if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
		cx = drag.cx - dx / zoom;
		cz = drag.cz - dy / zoom;
		draw();
	});
	canvas.addEventListener('mouseup', (e) => {
		if (drag && !drag.moved) {
			if (e.button === 2) o.setWaypoint(null);
			else o.setWaypoint(toWorld(e.offsetX, e.offsetY));
			draw();
		}
		drag = null;
	});
	canvas.addEventListener('contextmenu', (e) => e.preventDefault());
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			const before = toWorld(e.offsetX, e.offsetY);
			zoom = Math.min(3, Math.max(0.2, zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
			const after = toWorld(e.offsetX, e.offsetY);
			cx += before.x - after.x;
			cz += before.z - after.z;
			draw();
		},
		{ passive: false },
	);

	const legend = el('div', { class: 'citymap-legend' });
	for (const icon of Object.values(POI_ICONS)) {
		legend.append(el('div', { class: 'item', html: `<span style="color:${icon.color}">${icon.letter}</span> ${icon.label}` }));
	}
	legend.append(el('div', { class: 'hint', text: 'Click: set waypoint · Right-click: clear · Drag: pan · Wheel: zoom' }));
	const panel = el(
		'div',
		{ class: 'menu-panel citymap' },
		el('div', { class: 'menu-title', text: 'Neon Harbor' }),
		el('div', { class: 'citymap-body' }, canvas, legend),
		el(
			'div',
			{ class: 'menu-list row' },
			button(
				'Centre on me',
				() => {
					const p = o.player();
					cx = p.x;
					cz = p.z;
					draw();
				},
				'menu-btn small',
			),
			button(
				'Clear waypoint',
				() => {
					o.setWaypoint(null);
					draw();
				},
				'menu-btn small',
			),
			button('Back', o.back, 'menu-btn small'),
		),
	);
	draw();
	return panel;
}
