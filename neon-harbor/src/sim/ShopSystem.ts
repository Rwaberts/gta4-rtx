// Shops and businesses: Ironclad Outfitters (weapons, ammo, armor), QuikStop 24 (snacks),
// Coastline Motors (vehicles), Wrench & Ratchet (repair / respray), purchasable properties
// with daily income, and the safehouse bed (save + sleep). Pure logic; UI listens to events.

import { ARMOR, DEALERSHIP_STOCK, GUN_SHOP_STOCK, PROPERTIES, REPAIR_COST_PER_HP, RESPRAY_PRICE, SNACKS } from '../data/economy';
import { PLAYER } from '../data/config';
import { VEHICLES } from '../data/vehicles';
import { WEAPONS, type WeaponId } from '../data/weapons';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

export interface Result {
	ok: boolean;
	message: string;
}

export interface OwnedVehicle {
	model: string;
	color: number;
}

const ok = (message: string): Result => ({ ok: true, message });
const no = (message: string): Result => ({ ok: false, message });

export class ShopSystem {
	/** Vehicles the player owns; re-spawned outside the safehouse. */
	readonly garage: OwnedVehicle[] = [];

	constructor(private readonly world: World) {
		const w = world;
		w.interactions.register((out) => {
			const p = w.player;
			const inside = w.interiors.current;
			if (inside) {
				const d = inside.def;
				if (d.counter && (d.id === 'weapons' || d.id === 'store')) {
					const c = w.interiors.toWorld(inside, d.counter.x, d.counter.z);
					const busy = w.missions.active?.def.allowInterior === d.id;
					if (!busy) out.push({ label: `Shop at ${inside.poi.name}`, x: c.x, z: c.z, radius: 2, act: () => w.bus.emit('openShop', { shop: d.id, poi: inside.poi.id }) });
				}
				if (d.bed) {
					const b = w.interiors.toWorld(inside, d.bed.x, d.bed.z);
					out.push({ label: 'Rest: save game / sleep', x: b.x, z: b.z, radius: 2.2, act: () => w.bus.emit('requestSave', { where: inside.poi.name }) });
				}
				return;
			}
			for (const poi of w.city.pois) {
				if (Math.abs(poi.x - p.px) > 9 || Math.abs(poi.z - p.pz) > 9) continue;
				if (poi.kind === 'dealership') {
					out.push({ label: 'Browse vehicles at Coastline Motors', x: poi.x, z: poi.z, radius: 2.6, act: () => w.bus.emit('openShop', { shop: 'dealership', poi: poi.id }) });
				} else if (poi.kind === 'mechanic') {
					out.push({ label: 'Wrench & Ratchet: repair / respray', x: poi.x + Math.sin(poi.facing) * 5, z: poi.z + Math.cos(poi.facing) * 5, radius: 7, inVehicle: true, act: () => w.bus.emit('openShop', { shop: 'mechanic', poi: poi.id }) });
				} else if (poi.kind === 'property') {
					const def = PROPERTIES.find((x) => x.id === poi.id);
					if (!def) continue;
					const owned = w.economy.properties.has(def.id);
					out.push({
						label: owned ? `${def.name} (yours, +$${def.dailyIncome.toLocaleString('en-US')}/day)` : `Buy ${def.name} for $${def.price.toLocaleString('en-US')}`,
						x: poi.x,
						z: poi.z,
						radius: 2.6,
						act: () => {
							if (owned) return;
							w.bus.emit('openShop', { shop: 'property', poi: poi.id });
						},
					});
				}
			}
		});
	}

	private notify(r: Result): Result {
		this.world.bus.emit('notify', { text: r.message, kind: r.ok ? 'good' : 'bad', duration: 3 });
		if (r.ok) this.world.bus.emit('sound', { id: 'cash' });
		return r;
	}

	// ------------------------------------------------------------------ weapons

	stockWeapons(): WeaponId[] {
		return GUN_SHOP_STOCK;
	}

	buyWeapon(id: WeaponId): Result {
		const w = this.world;
		const def = WEAPONS[id];
		const inv = w.combat.inventory;
		if (inv.has(id)) return this.buyAmmo(id);
		if (!w.economy.spend(def.price, `Bought ${def.name}`)) return this.notify(no(`You can't afford the ${def.name}.`));
		inv.give(id, def.clip * 3);
		inv.select(id);
		w.bus.emit('itemPurchased', { kind: 'weapon', id, price: def.price });
		return this.notify(ok(`Bought ${def.name}.`));
	}

	buyAmmo(id: WeaponId): Result {
		const w = this.world;
		const def = WEAPONS[id];
		const inv = w.combat.inventory;
		if (!inv.has(id)) return this.notify(no(`You don't own a ${def.name}.`));
		if (inv.totalAmmo(id) >= def.maxAmmo) return this.notify(no(`${def.name} ammo is full.`));
		if (!w.economy.spend(def.ammoPrice, `${def.name} ammo`)) return this.notify(no("You can't afford that."));
		inv.give(id, def.ammoPack);
		w.bus.emit('itemPurchased', { kind: 'ammo', id, price: def.ammoPrice });
		return this.notify(ok(`+${def.ammoPack} rounds for the ${def.name}.`));
	}

	buyArmor(): Result {
		const w = this.world;
		const p = w.player;
		if (p.armor >= PLAYER.maxArmor) return this.notify(no('Your armor is already full.'));
		if (!w.economy.spend(ARMOR.price, 'Body armor')) return this.notify(no("You can't afford body armor."));
		p.armor = Math.min(PLAYER.maxArmor, p.armor + ARMOR.amount);
		w.bus.emit('itemPurchased', { kind: 'armor', id: 'armor', price: ARMOR.price });
		return this.notify(ok('Body armor equipped.'));
	}

	// ------------------------------------------------------------------- snacks

	buySnack(id: string): Result {
		const w = this.world;
		const s = SNACKS.find((x) => x.id === id);
		if (!s) return no('Unknown item.');
		if (w.player.health >= PLAYER.maxHealth) return this.notify(no("You're not hungry."));
		if (!w.economy.spend(s.price, s.name)) return this.notify(no("You can't afford that."));
		w.player.heal(s.heal);
		w.bus.emit('itemPurchased', { kind: 'snack', id, price: s.price });
		return this.notify(ok(`${s.name}: +${s.heal} health.`));
	}

	// ----------------------------------------------------------------- vehicles

	stockVehicles(): string[] {
		return DEALERSHIP_STOCK;
	}

	buyVehicle(model: string, color: number): Result {
		const w = this.world;
		const def = VEHICLES[model];
		if (!def || !def.forSale) return no('Not for sale.');
		if (!w.economy.spend(def.price, `Bought ${def.make} ${def.name}`)) return this.notify(no(`You can't afford the ${def.make} ${def.name}.`));
		this.garage.push({ model, color });
		const poi = w.city.pois.find((p) => p.kind === 'dealership')!;
		const v = this.spawnOwnedAt(model, color, poi.x + Math.sin(poi.facing) * 4.5, poi.z + Math.cos(poi.facing) * 4.5, poi.facing - Math.PI / 2);
		w.bus.emit('itemPurchased', { kind: 'vehicle', id: model, price: def.price });
		return this.notify(ok(v ? `Your new ${def.make} ${def.name} is parked out front.` : `${def.make} ${def.name} delivered to your safehouse.`));
	}

	spawnOwnedAt(model: string, color: number, x: number, z: number, heading: number): Vehicle | null {
		const w = this.world;
		w.vehicles.hash.query(x, z, 6, (o) => {
			if (!o.persistent && o.driver !== 'player') w.vehicles.despawn(o);
		});
		const v = w.vehicles.spawn(model, x, z, heading, 'owned', color);
		if (v) v.persistent = true;
		return v;
	}

	/** Parks every owned vehicle along the curb outside the safehouse. */
	spawnGarage(): void {
		const w = this.world;
		const home = w.city.poi('safehouse')!;
		const fx = Math.sin(home.facing);
		const fz = Math.cos(home.facing);
		const ax = Math.cos(home.facing);
		const az = -Math.sin(home.facing);
		this.garage.slice(0, 4).forEach((g, i) => {
			const along = (i % 2 === 0 ? 1 : -1) * (6 + Math.floor(i / 2) * 7);
			this.spawnOwnedAt(g.model, g.color, home.x + fx * 3.8 + ax * along, home.z + fz * 3.8 + az * along, home.facing - Math.PI / 2);
		});
	}

	repairCost(v: Vehicle): number {
		return Math.ceil((v.def.health - v.health) * REPAIR_COST_PER_HP);
	}

	repair(v: Vehicle | null): Result {
		const w = this.world;
		if (!v || v.destroyed) return this.notify(no('Bring a vehicle in for repairs.'));
		const cost = this.repairCost(v);
		if (cost <= 0) return this.notify(no("It's running fine."));
		if (!w.economy.spend(cost, 'Vehicle repair')) return this.notify(no("You can't afford the repairs."));
		v.health = v.def.health;
		v.burnTimer = -1;
		w.bus.emit('itemPurchased', { kind: 'repair', id: v.def.id, price: cost });
		return this.notify(ok(`Repaired for $${cost}.`));
	}

	respray(v: Vehicle | null, color: number): Result {
		const w = this.world;
		if (!v || v.destroyed) return this.notify(no('Bring a vehicle in for a respray.'));
		if (!w.economy.spend(RESPRAY_PRICE, 'Respray')) return this.notify(no("You can't afford a respray."));
		v.color = color;
		const owned = this.garage.find((g) => g.model === v.def.id && v.role === 'owned');
		if (owned) owned.color = color;
		return this.notify(ok('Fresh paint applied.'));
	}

	// --------------------------------------------------------------- properties

	buyProperty(id: string): Result {
		const w = this.world;
		const def = PROPERTIES.find((p) => p.id === id);
		if (!def) return no('Unknown property.');
		if (w.economy.properties.has(id)) return this.notify(no('You already own it.'));
		if (!w.economy.spend(def.price, `Bought ${def.name}`)) return this.notify(no(`You need $${def.price.toLocaleString('en-US')}.`));
		w.economy.properties.add(id);
		w.bus.emit('itemPurchased', { kind: 'property', id, price: def.price });
		return this.notify(ok(`You now own ${def.name}. Income: $${def.dailyIncome.toLocaleString('en-US')} per day.`));
	}

	dailyIncome(): number {
		let sum = 0;
		for (const id of this.world.economy.properties) sum += PROPERTIES.find((p) => p.id === id)?.dailyIncome ?? 0;
		return sum;
	}

	/** Pays property income once per in-game day at 06:00. */
	update(): void {
		const w = this.world;
		const e = w.economy;
		const day = w.clock.day;
		if (w.clock.hour >= 6 && day > e.lastPayday) {
			const missed = Math.min(3, day - e.lastPayday);
			e.lastPayday = day;
			const income = this.dailyIncome() * missed;
			if (income > 0) {
				e.add(income, 'Business income');
				w.bus.emit('notify', { text: `Your businesses earned $${income.toLocaleString('en-US')}.`, kind: 'good', duration: 5 });
			}
		}
	}

	/** Safehouse: sleep until the morning (or six hours). */
	sleep(): void {
		const w = this.world;
		const h = w.clock.hour;
		w.clock.advanceHours(h < 6 ? 6 - h + 1 : h >= 20 ? 24 - h + 7 : 6);
		w.player.heal(PLAYER.maxHealth);
	}
}
