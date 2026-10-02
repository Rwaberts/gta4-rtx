import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { SIM } from '../../src/data/config';
import { ARMOR, PROPERTIES, STARTING_CASH } from '../../src/data/economy';
import { WEAPONS } from '../../src/data/weapons';
import { VEHICLES } from '../../src/data/vehicles';
import { MemoryStorage, SAVE_VERSION, migrate, newGameData, validate } from '../../src/sim/SaveSystem';

const DT = SIM.fixedDt;
function quiet(storage = new MemoryStorage()): World {
	const w = new World(undefined, storage);
	w.actors.density = 0;
	w.traffic.enabled = false;
	w.police.enabled = false;
	w.saves.apply(newGameData(w));
	return w;
}

describe('Economy & shops', () => {
	it('starts with the configured cash and refuses purchases it cannot afford', () => {
		const w = quiet();
		expect(w.economy.cash).toBe(STARTING_CASH);
		const r = w.shops.buyWeapon('rifle');
		expect(r.ok).toBe(false);
		expect(w.economy.cash).toBe(STARTING_CASH);
		expect(w.combat.inventory.has('rifle')).toBe(false);
	});

	it('buys weapons, ammo and armor at data-driven prices', () => {
		const w = quiet();
		w.economy.add(20000, 'test');
		const before = w.economy.cash;
		expect(w.shops.buyWeapon('smg').ok).toBe(true);
		expect(w.economy.cash).toBe(before - WEAPONS.smg.price);
		const ammo = w.combat.inventory.totalAmmo('smg');
		expect(w.shops.buyAmmo('smg').ok).toBe(true);
		expect(w.combat.inventory.totalAmmo('smg')).toBe(ammo + WEAPONS.smg.ammoPack);
		expect(w.shops.buyArmor().ok).toBe(true);
		expect(w.player.armor).toBe(ARMOR.amount);
		expect(w.shops.buyArmor().ok).toBe(false);
	});

	it('snacks heal; the dealership adds to the garage and spawns the car', () => {
		const w = quiet();
		w.economy.add(100000, 'test');
		w.player.health = 40;
		expect(w.shops.buySnack('meal').ok).toBe(true);
		expect(w.player.health).toBe(100);
		const cars = w.vehicles.count;
		expect(w.shops.buyVehicle('sport', 0xff0000).ok).toBe(true);
		expect(w.shops.garage.some((g) => g.model === 'sport')).toBe(true);
		expect(w.vehicles.count).toBe(cars + 1);
		expect(w.vehicles.list.find((v) => v.def.id === 'sport')!.role).toBe('owned');
		expect(VEHICLES.sport.price).toBeGreaterThan(0);
	});

	it('mechanic repairs for a price proportional to damage', () => {
		const w = quiet();
		const v = w.vehicles.list.find((x) => x.role === 'owned')!;
		v.health = v.def.health - 200;
		const cost = w.shops.repairCost(v);
		expect(cost).toBeGreaterThan(0);
		const before = w.economy.cash;
		expect(w.shops.repair(v).ok).toBe(true);
		expect(v.health).toBe(v.def.health);
		expect(w.economy.cash).toBe(before - cost);
	});

	it('properties pay daily income at 06:00', () => {
		const w = quiet();
		const prop = PROPERTIES[0];
		w.economy.add(prop.price, 'test');
		expect(w.shops.buyProperty(prop.id).ok).toBe(true);
		const before = w.economy.cash;
		w.clock.setHour(5.9);
		w.clock.totalMinutes += 24 * 60; // next day, just before six
		for (let i = 0; i < 30; i++) w.step(DT);
		w.clock.setHour(6.1);
		w.step(DT);
		expect(w.economy.cash).toBe(before + prop.dailyIncome);
		w.step(DT);
		expect(w.economy.cash).toBe(before + prop.dailyIncome);
	});

	it('death costs a hospital bill and arrest confiscates weapons', () => {
		const w = quiet();
		w.economy.add(5000, 'test');
		const c0 = w.economy.cash;
		w.killPlayer('test');
		for (let i = 0; i < 6 / DT; i++) w.step(DT);
		expect(w.economy.cash).toBeLessThan(c0);
		w.combat.inventory.give('smg', 60);
		w.wanted.setLevel(2);
		w.arrestPlayer(null);
		for (let i = 0; i < 5 / DT; i++) w.step(DT);
		expect(w.combat.inventory.has('smg')).toBe(false);
	});
});

describe('Save / load', () => {
	it('round-trips the full game state through storage', () => {
		const storage = new MemoryStorage();
		const w = quiet(storage);
		w.economy.add(12345, 'test');
		w.economy.properties.add('prop_carwash');
		w.missions.completed.add('low_tide');
		w.combat.inventory.give('shotgun', 12);
		w.clock.setHour(21.5);
		w.player.teleport(100, 150, 1);
		w.player.armor = 55;
		w.shops.garage.push({ model: 'suv', color: 0x123456 });
		const snap = w.saves.save('slot2');

		const w2 = new World(undefined, storage);
		expect(w2.saves.load('slot2')).toBe(true);
		expect(w2.economy.cash).toBe(snap.cash);
		expect(w2.economy.properties.has('prop_carwash')).toBe(true);
		expect(w2.missions.completed.has('low_tide')).toBe(true);
		expect(w2.combat.inventory.totalAmmo('shotgun')).toBe(w.combat.inventory.totalAmmo('shotgun'));
		expect(w2.clock.hour).toBeCloseTo(21.5);
		expect(w2.player.x).toBeCloseTo(100);
		expect(w2.player.armor).toBe(55);
		expect(w2.shops.garage.map((g) => g.model)).toEqual(['coupe', 'suv']);
		// Garage cars are parked at the safehouse.
		expect(w2.vehicles.list.filter((v) => v.role === 'owned').length).toBe(2);
		expect(w2.saves.latest()?.slot).toBe('slot2');
	});

	it('rejects garbage, sanitizes bad values and migrates old versions', () => {
		const w = quiet();
		expect(validate(null, w)).toBeNull();
		expect(validate('nope', w)).toBeNull();
		expect(validate({ version: SAVE_VERSION + 1 }, w)).toBeNull();
		const d = validate({ version: 2, cash: -50, player: { x: 99999, health: 1e9 }, weapons: [['laser', 1, 1], ['pistol', 99, 9999]], missions: ['nope', 'low_tide'] }, w)!;
		expect(d.cash).toBe(0);
		expect(d.player.health).toBe(100);
		expect(d.weapons).toEqual([['pistol', WEAPONS.pistol.clip, WEAPONS.pistol.maxAmmo]]);
		expect(d.missions).toEqual(['low_tide']);
		expect(w.city.isLand(d.player.x, d.player.z)).toBe(true);
		const old = migrate({ version: 1, vehicle: 'sedan' });
		expect(old.version).toBe(2);
		expect(old.garage).toEqual([{ model: 'sedan', color: 0xffffff }]);
	});

	it('corrupt JSON in storage is ignored', () => {
		const storage = new MemoryStorage();
		storage.setItem('neon-harbor:save:slot1', '{not json');
		const w = quiet(storage);
		expect(w.saves.read('slot1')).toBeNull();
		expect(w.saves.load('slot1')).toBe(false);
	});
});
