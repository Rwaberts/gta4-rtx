// Save / load. Snapshots are plain JSON with a schema version; loading validates every field
// (corrupt or hand-edited saves fall back to safe defaults) and migrates older versions.
// Storage is abstracted so tests can use memory and the game uses localStorage.

import { PLAYER } from '../data/config';
import { STARTING_CASH } from '../data/economy';
import { MISSIONS } from '../data/missions';
import { VEHICLES } from '../data/vehicles';
import { WEAPONS, type WeaponId } from '../data/weapons';
import type { World } from './World';

export const SAVE_VERSION = 2;
export const SLOTS = ['slot1', 'slot2', 'slot3', 'auto'] as const;
export type SlotId = (typeof SLOTS)[number];

export interface KeyValueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
	private map = new Map<string, string>();
	getItem(k: string): string | null {
		return this.map.get(k) ?? null;
	}
	setItem(k: string, v: string): void {
		this.map.set(k, v);
	}
	removeItem(k: string): void {
		this.map.delete(k);
	}
}

export interface SaveData {
	version: number;
	savedAt: number;
	location: string;
	player: { x: number; z: number; heading: number; health: number; armor: number };
	cash: number;
	properties: string[];
	garage: Array<{ model: string; color: number }>;
	lastPayday: number;
	weapons: Array<[WeaponId, number, number]>;
	currentWeapon: WeaponId;
	missions: string[];
	clockMinutes: number;
	weather: string;
	stats: { playTime: number; kills: number; distance: number };
}

const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

export function newGameData(world: World): SaveData {
	const home = world.city.poi('safehouse')!;
	return {
		version: SAVE_VERSION,
		savedAt: 0,
		location: home.name,
		player: { x: home.x + Math.sin(home.facing) * 3, z: home.z + Math.cos(home.facing) * 3, heading: home.facing, health: PLAYER.maxHealth, armor: 0 },
		cash: STARTING_CASH,
		properties: [],
		garage: [{ model: 'coupe', color: 0x2ac8e8 }],
		lastPayday: 0,
		weapons: [
			['fists', 0, 0],
			['pistol', 12, 24],
		],
		currentWeapon: 'fists',
		missions: [],
		clockMinutes: 9 * 60,
		weather: 'clear',
		stats: { playTime: 0, kills: 0, distance: 0 },
	};
}

/** Upgrades older save formats in place. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
	const v = num(raw.version, 1);
	if (v < 2) {
		// v1 stored a single `vehicle` string instead of a garage list and had no stats.
		if (!Array.isArray(raw.garage)) raw.garage = typeof raw.vehicle === 'string' ? [{ model: raw.vehicle, color: 0xffffff }] : [];
		if (typeof raw.stats !== 'object' || raw.stats === null) raw.stats = { playTime: 0, kills: 0, distance: 0 };
		raw.version = 2;
	}
	return raw;
}

/** Validates and sanitizes untrusted save data. Returns null when unusable. */
export function validate(input: unknown, world: World): SaveData | null {
	if (typeof input !== 'object' || input === null) return null;
	const raw = migrate({ ...(input as Record<string, unknown>) });
	if (num(raw.version, 0) > SAVE_VERSION) return null;
	const d = newGameData(world);
	const p = (raw.player ?? {}) as Record<string, unknown>;
	const L = world.city.land;
	d.player = {
		x: num(p.x, d.player.x, L.minX, L.maxX + 200),
		z: num(p.z, d.player.z, L.minZ, L.maxZ),
		heading: num(p.heading, d.player.heading),
		health: num(p.health, PLAYER.maxHealth, 1, PLAYER.maxHealth),
		armor: num(p.armor, 0, 0, PLAYER.maxArmor),
	};
	if (!world.city.isLand(d.player.x, d.player.z)) {
		const fresh = newGameData(world);
		d.player.x = fresh.player.x;
		d.player.z = fresh.player.z;
	}
	d.savedAt = num(raw.savedAt, 0);
	d.location = typeof raw.location === 'string' ? raw.location.slice(0, 60) : d.location;
	d.cash = Math.floor(num(raw.cash, STARTING_CASH, 0, 1e9));
	d.properties = Array.isArray(raw.properties) ? raw.properties.filter((x): x is string => typeof x === 'string') : [];
	d.garage = Array.isArray(raw.garage)
		? (raw.garage as Array<Record<string, unknown>>).filter((g) => g && typeof g.model === 'string' && VEHICLES[g.model as string]).map((g) => ({ model: g.model as string, color: num(g.color, 0xffffff, 0, 0xffffff) }))
		: d.garage;
	d.lastPayday = num(raw.lastPayday, 0, 0);
	d.weapons = Array.isArray(raw.weapons)
		? (raw.weapons as unknown[]).filter((w): w is [WeaponId, number, number] => Array.isArray(w) && typeof w[0] === 'string' && w[0] in WEAPONS).map(([id, c, r]) => [id, num(c, 0, 0, WEAPONS[id].clip), num(r, 0, 0, WEAPONS[id].maxAmmo)])
		: d.weapons;
	d.currentWeapon = typeof raw.currentWeapon === 'string' && raw.currentWeapon in WEAPONS ? (raw.currentWeapon as WeaponId) : 'fists';
	const known = new Set(MISSIONS.map((m) => m.id));
	d.missions = Array.isArray(raw.missions) ? raw.missions.filter((x): x is string => typeof x === 'string' && known.has(x)) : [];
	d.clockMinutes = num(raw.clockMinutes, d.clockMinutes, 0);
	d.weather = typeof raw.weather === 'string' ? raw.weather : 'clear';
	const st = (raw.stats ?? {}) as Record<string, unknown>;
	d.stats = { playTime: num(st.playTime, 0, 0), kills: num(st.kills, 0, 0), distance: num(st.distance, 0, 0) };
	return d;
}

export class SaveSystem {
	readonly prefix = 'neon-harbor:save:';
	stats = { playTime: 0, kills: 0, distance: 0 };

	constructor(
		private readonly world: World,
		readonly storage: KeyValueStorage,
	) {
		world.bus.on('actorKilled', (e) => {
			if (e.killer === 'player') this.stats.kills++;
		});
	}

	snapshot(): SaveData {
		const w = this.world;
		const p = w.player;
		// Inside an interior or a vehicle: save at the door / street position.
		let x = p.px;
		let z = p.pz;
		let heading = p.heading;
		const inside = w.interiors.current;
		if (inside) {
			x = inside.poi.x + Math.sin(inside.poi.facing) * 2;
			z = inside.poi.z + Math.cos(inside.poi.facing) * 2;
			heading = inside.poi.facing;
		}
		return {
			version: SAVE_VERSION,
			savedAt: Date.now(),
			location: inside ? inside.poi.name : w.currentDistrict ?? 'Neon Harbor',
			player: { x, z, heading, health: Math.max(1, p.health), armor: p.armor },
			cash: w.economy.cash,
			properties: [...w.economy.properties],
			garage: w.shops.garage.map((g) => ({ ...g })),
			lastPayday: w.economy.lastPayday,
			weapons: w.combat.inventory.serialize(),
			currentWeapon: w.combat.inventory.current,
			missions: [...w.missions.completed],
			clockMinutes: w.clock.totalMinutes,
			weather: w.weather.state,
			stats: { ...this.stats },
		};
	}

	save(slot: SlotId): SaveData {
		const data = this.snapshot();
		this.storage.setItem(this.prefix + slot, JSON.stringify(data));
		if (slot !== 'auto') this.world.bus.emit('notify', { text: 'Game saved.', kind: 'good', duration: 2.5 });
		return data;
	}

	read(slot: SlotId): SaveData | null {
		const text = this.storage.getItem(this.prefix + slot);
		if (!text) return null;
		try {
			return validate(JSON.parse(text), this.world);
		} catch {
			return null;
		}
	}

	delete(slot: SlotId): void {
		this.storage.removeItem(this.prefix + slot);
	}

	/** Most recent valid save across all slots. */
	latest(): { slot: SlotId; data: SaveData } | null {
		let best: { slot: SlotId; data: SaveData } | null = null;
		for (const slot of SLOTS) {
			const d = this.read(slot);
			if (d && (!best || d.savedAt > best.data.savedAt)) best = { slot, data: d };
		}
		return best;
	}

	load(slot: SlotId): boolean {
		const d = this.read(slot);
		if (!d) return false;
		this.apply(d);
		return true;
	}

	/** Resets the world and applies a snapshot (also used for "New Game"). */
	apply(d: SaveData): void {
		const w = this.world;
		w.missions.reset();
		w.ambient.reset();
		w.wanted.clear(true);
		if (w.interiors.current) w.interiors.exit();
		w.police.reset();
		w.vehicles.clear();
		w.actors.clear();
		w.combat.grenades.length = 0;
		const p = w.player;
		p.resetVitals();
		p.teleport(d.player.x, d.player.z, d.player.heading);
		p.health = d.player.health;
		p.armor = d.player.armor;
		const e = w.economy;
		e.cash = d.cash;
		e.properties.clear();
		for (const id of d.properties) e.properties.add(id);
		e.lastPayday = d.lastPayday;
		w.shops.garage.length = 0;
		w.shops.garage.push(...d.garage);
		w.combat.inventory.load(d.weapons);
		w.combat.inventory.select(d.currentWeapon);
		for (const id of d.missions) w.missions.completed.add(id);
		w.clock.totalMinutes = d.clockMinutes;
		w.weather.set(d.weather, true);
		this.stats = { ...d.stats };
		w.shops.spawnGarage();
		w.bus.emit('moneyChanged', { cash: e.cash, delta: 0, reason: 'load' });
	}
}
