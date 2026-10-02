// Player weapon inventory: owned weapons, clip + reserve ammo, current selection.

import { WEAPONS, WEAPON_ORDER, type WeaponDef, type WeaponId } from '../data/weapons';

export interface WeaponState {
	clip: number;
	reserve: number;
}

export class Inventory {
	readonly owned = new Map<WeaponId, WeaponState>([['fists', { clip: 0, reserve: 0 }]]);
	current: WeaponId = 'fists';

	get def(): WeaponDef {
		return WEAPONS[this.current];
	}

	get state(): WeaponState {
		return this.owned.get(this.current)!;
	}

	has(id: WeaponId): boolean {
		return this.owned.has(id);
	}

	/** Adds a weapon (or ammo for it). Returns rounds actually added. */
	give(id: WeaponId, rounds: number): number {
		const def = WEAPONS[id];
		let st = this.owned.get(id);
		if (!st) {
			st = { clip: 0, reserve: 0 };
			this.owned.set(id, st);
		}
		if (def.kind === 'melee') return 0;
		const total = st.clip + st.reserve;
		const add = Math.max(0, Math.min(rounds, def.maxAmmo - total));
		st.reserve += add;
		// Top up an empty clip immediately.
		if (st.clip === 0) {
			const take = Math.min(def.clip, st.reserve);
			st.clip = take;
			st.reserve -= take;
		}
		return add;
	}

	totalAmmo(id: WeaponId): number {
		const st = this.owned.get(id);
		return st ? st.clip + st.reserve : 0;
	}

	select(id: WeaponId): boolean {
		if (!this.owned.has(id)) return false;
		this.current = id;
		return true;
	}

	/** Cycles through owned weapons that have ammo (fists always). */
	cycle(delta: number): void {
		const owned = WEAPON_ORDER.filter((id) => this.owned.has(id) && (id === 'fists' || this.totalAmmo(id) > 0));
		const i = owned.indexOf(this.current);
		this.current = owned[(i + delta + owned.length * 4) % owned.length];
	}

	selectSlot(slot: number): void {
		const id = WEAPON_ORDER[slot];
		if (id && this.owned.has(id) && (id === 'fists' || this.totalAmmo(id) > 0)) this.current = id;
	}

	/** Moves ammo from reserve into the clip. */
	reload(): void {
		const def = this.def;
		const st = this.state;
		const need = def.clip - st.clip;
		const take = Math.min(need, st.reserve);
		st.clip += take;
		st.reserve -= take;
	}

	clear(): void {
		this.owned.clear();
		this.owned.set('fists', { clip: 0, reserve: 0 });
		this.current = 'fists';
	}

	serialize(): Array<[WeaponId, number, number]> {
		return [...this.owned.entries()].map(([id, s]) => [id, s.clip, s.reserve]);
	}

	load(data: Array<[WeaponId, number, number]>): void {
		this.clear();
		for (const [id, clip, reserve] of data) {
			if (!WEAPONS[id]) continue;
			this.owned.set(id, { clip, reserve });
		}
	}
}
