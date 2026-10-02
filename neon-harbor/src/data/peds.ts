// Appearance palettes for procedurally dressed NPCs (all original).

import type { Faction } from '../sim/Actor';

export const SKIN_TONES = [0xf1c8a8, 0xe0ac88, 0xc8946a, 0xa8754e, 0x8d5a3b, 0x6a4028, 0x4a2c1c];
export const HAIR_COLORS = [0x111111, 0x2a1a10, 0x4a2a14, 0x7a5a3a, 0xc8a060, 0x8a8a8a, 0xb84a2a];
export const SHIRTS = [0xe8e8e8, 0x2a4a8a, 0x8a2a2a, 0x2a6a4a, 0xd8b84a, 0x6a3a8a, 0x3a3a3a, 0xe87a3a, 0x4ab8c8, 0xf0a0b8, 0x7a8a3a, 0x1a1a1a];
export const PANTS = [0x2a2a30, 0x24304a, 0x5a4a3a, 0x3a3a3a, 0x7a6a5a, 0x1a1a24, 0x4a5a6a];

export interface FactionStyle {
	name: string;
	shirt: number[];
	pants: number[];
	hat: number;
	blip: string;
}

export const FACTION_STYLES: Record<Faction, FactionStyle> = {
	civilian: { name: 'Civilian', shirt: SHIRTS, pants: PANTS, hat: 0, blip: '#ffffff' },
	police: { name: 'NHPD', shirt: [0x1c2a4a], pants: [0x161c2a], hat: 1, blip: '#4a8cff' },
	saltline: { name: 'Saltline Crew', shirt: [0x1a6a7a, 0x0f4a5a], pants: [0x1a1a24], hat: 2, blip: '#ff4a5a' },
	velvet: { name: 'Velvet Kings', shirt: [0x5a1a7a, 0x3a0f4a], pants: [0x101010], hat: 0, blip: '#ff4a5a' },
	rustline: { name: 'Rustline Boys', shirt: [0xb8601a, 0x8a4a14], pants: [0x3a2a1a], hat: 2, blip: '#ff4a5a' },
	crew: { name: 'Tidewater Crew', shirt: [0x1f5a5a], pants: [0x24283a], hat: 0, blip: '#39f0d0' },
};
