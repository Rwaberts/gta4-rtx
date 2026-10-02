// Walk-in interior layouts (local coordinates, metres; door on the -z wall at x = 0).

import type { InteriorId } from './pois';

export interface InteriorBox {
	x: number;
	z: number;
	w: number;
	d: number;
	h: number;
	color: number;
	y?: number;
	/** Glows (signage, displays, lights). */
	glow?: boolean;
}

export interface InteriorDef {
	id: InteriorId;
	width: number;
	depth: number;
	height: number;
	floor: number;
	wall: number;
	props: InteriorBox[];
	/** Where the clerk stands (behind the counter), facing the door. */
	clerk: { x: number; z: number } | null;
	/** The "service" point in front of the counter (shop menu, robbery). */
	counter: { x: number; z: number } | null;
	/** Bed / save point. */
	bed?: { x: number; z: number };
}

export const INTERIORS: Record<InteriorId, InteriorDef> = {
	store: {
		id: 'store',
		width: 14,
		depth: 11,
		height: 3.6,
		floor: 0xd8d8d0,
		wall: 0xe8e4d8,
		props: [
			{ x: -4.5, z: 3.5, w: 3.2, d: 1, h: 1.05, color: 0x3a7a4a },
			{ x: -4.5, z: 4.1, w: 3.2, d: 0.2, h: 0.4, y: 1.05, color: 0xfff27a, glow: true },
			{ x: 1.5, z: 1.5, w: 0.8, d: 5, h: 1.6, color: 0xc84a3a },
			{ x: 4, z: 1.5, w: 0.8, d: 5, h: 1.6, color: 0x3a6ac8 },
			{ x: 6.4, z: 0, w: 0.8, d: 9, h: 2.2, color: 0xd8d8e8, glow: true },
			{ x: -6.4, z: -1, w: 0.8, d: 4, h: 1.8, color: 0xe8c84a },
		],
		clerk: { x: -4.5, z: 4.6 },
		counter: { x: -4.5, z: 2.4 },
	},
	weapons: {
		id: 'weapons',
		width: 14,
		depth: 11,
		height: 3.8,
		floor: 0x6a6056,
		wall: 0x8a7a68,
		props: [
			{ x: 0, z: 3.4, w: 8, d: 1, h: 1.05, color: 0x4a3a2a },
			{ x: 0, z: 5.1, w: 12, d: 0.3, h: 2.6, color: 0x2a2a2a },
			{ x: -4, z: 5.0, w: 2.6, d: 0.1, h: 0.25, y: 1.5, color: 0xffa53a, glow: true },
			{ x: 0, z: 5.0, w: 2.6, d: 0.1, h: 0.25, y: 1.5, color: 0xffa53a, glow: true },
			{ x: 4, z: 5.0, w: 2.6, d: 0.1, h: 0.25, y: 1.5, color: 0xffa53a, glow: true },
			{ x: -6.3, z: -1.5, w: 0.9, d: 4, h: 2, color: 0x3a4a3a },
			{ x: 6.3, z: -1.5, w: 0.9, d: 4, h: 2, color: 0x3a4a3a },
		],
		clerk: { x: 0, z: 4.3 },
		counter: { x: 0, z: 2.3 },
	},
	exchange: {
		id: 'exchange',
		width: 16,
		depth: 12,
		height: 4.2,
		floor: 0x2a2a30,
		wall: 0x6a5a3a,
		props: [
			{ x: 0, z: 3.6, w: 12, d: 1, h: 1.2, color: 0xb89a4a },
			{ x: 0, z: 3.6, w: 12, d: 0.08, h: 1.2, y: 1.2, color: 0x9ab8c8 },
			{ x: 0, z: 5.6, w: 3, d: 0.6, h: 2.6, color: 0x5a5a62 },
			{ x: 0, z: 5.25, w: 1.4, d: 0.1, h: 1.4, y: 0.5, color: 0xffd84a, glow: true },
			{ x: -6.8, z: 0, w: 0.6, d: 6, h: 0.6, color: 0x5a3a2a },
			{ x: 6.8, z: 0, w: 0.6, d: 6, h: 0.6, color: 0x5a3a2a },
		],
		clerk: { x: -2.5, z: 4.6 },
		counter: { x: -2.5, z: 2.4 },
	},
	safehouse: {
		id: 'safehouse',
		width: 12,
		depth: 10,
		height: 3.2,
		floor: 0x7a5a42,
		wall: 0x5a6a72,
		props: [
			{ x: 3.8, z: 3, w: 2.2, d: 3, h: 0.55, color: 0x2a3a5a },
			{ x: 3.8, z: 4.3, w: 2.2, d: 0.4, h: 0.9, color: 0x3a2a1a },
			{ x: -3.5, z: 3.5, w: 3, d: 1.2, h: 0.8, color: 0x4a3a2a },
			{ x: -3.5, z: 4.2, w: 2.2, d: 0.1, h: 1, y: 0.8, color: 0x39f0d0, glow: true },
			{ x: -4.8, z: -1.5, w: 1, d: 2.5, h: 0.75, color: 0x6a3a3a },
			{ x: 0, z: 0.5, w: 1.6, d: 1, h: 0.5, color: 0x8a6a4a },
		],
		clerk: null,
		counter: null,
		bed: { x: 3.8, z: 1.2 },
	},
};
