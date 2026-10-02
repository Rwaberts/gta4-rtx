// Economy tuning: starting cash, shop catalogues, properties, penalties. All values are
// data so balancing never requires touching system code.

import type { WeaponId } from './weapons';

export const STARTING_CASH = 750;

/** Armor sold at Ironclad Outfitters. */
export const ARMOR = { price: 600, amount: 100 };

/** Snacks at QuikStop 24 (instant heal). */
export const SNACKS = [
	{ id: 'coffee', name: 'Harbor Roast Coffee', price: 6, heal: 10 },
	{ id: 'sandwich', name: 'Tidewater Club Sandwich', price: 15, heal: 30 },
	{ id: 'meal', name: 'Night-Shift Combo', price: 30, heal: 70 },
];

/** Weapons stocked by Ironclad Outfitters (prices in data/weapons.ts). */
export const GUN_SHOP_STOCK: WeaponId[] = ['pistol', 'smg', 'shotgun', 'rifle', 'grenade'];

/** Vehicles for sale at Coastline Motors (prices in data/vehicles.ts). */
export const DEALERSHIP_STOCK = ['hatch', 'sedan', 'suv', 'pickup', 'van', 'coupe', 'muscle', 'sport'];

/** Repair cost per missing health point at Wrench & Ratchet. */
export const REPAIR_COST_PER_HP = 0.9;
export const RESPRAY_PRICE = 250;

export interface PropertyDef {
	id: string;
	name: string;
	price: number;
	/** Paid every in-game day at 06:00. */
	dailyIncome: number;
	description: string;
}

export const PROPERTIES: PropertyDef[] = [
	{ id: 'prop_laundromat', name: 'Lucky Tern Laundromat', price: 18000, dailyIncome: 900, description: 'Clean clothes, cleaner books.' },
	{ id: 'prop_carwash', name: "Sudsy's Car Wash", price: 30000, dailyIncome: 1500, description: 'Every car in Westbrook needs a rinse.' },
	{ id: 'prop_nightclub', name: 'Afterglow Nightclub', price: 65000, dailyIncome: 3600, description: 'The hottest door on the Coral Mile.' },
	{ id: 'prop_warehouse', name: 'Pier 9 Warehouse', price: 90000, dailyIncome: 5200, description: 'Imports, exports, no questions.' },
];
