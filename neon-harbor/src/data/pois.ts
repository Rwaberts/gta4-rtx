// Points of interest. Positions are approximate; CityLayout snaps each one onto the nearest
// sidewalk facing a road and guarantees a storefront building behind it.

export type PoiKind =
	| 'safehouse'
	| 'hospital'
	| 'police'
	| 'weapons'
	| 'store'
	| 'dealership'
	| 'mechanic'
	| 'property'
	| 'contact'
	| 'exchange';

export type InteriorId = 'safehouse' | 'store' | 'weapons' | 'exchange';

export interface PoiDef {
	id: string;
	kind: PoiKind;
	name: string;
	x: number;
	z: number;
	/** Walk-in interior (teleport through the door). */
	interior?: InteriorId;
	/** Signage colour for the storefront. */
	sign: number;
}

export const POI_DEFS: PoiDef[] = [
	{ id: 'safehouse', kind: 'safehouse', name: 'Tidewater Flat', x: -560, z: 250, interior: 'safehouse', sign: 0x39f0d0 },
	{ id: 'hospital_central', kind: 'hospital', name: 'Harbor General Hospital', x: 260, z: 420, sign: 0xff5a6a },
	{ id: 'hospital_west', kind: 'hospital', name: 'Westbrook Clinic', x: -930, z: 320, sign: 0xff5a6a },
	{ id: 'police_central', kind: 'police', name: 'NHPD Central Precinct', x: -180, z: -120, sign: 0x5a8cff },
	{ id: 'police_east', kind: 'police', name: 'NHPD Eastside Precinct', x: 650, z: 250, sign: 0x5a8cff },
	{ id: 'weapons_downtown', kind: 'weapons', name: 'Ironclad Outfitters', x: -120, z: 330, interior: 'weapons', sign: 0xffa53a },
	{ id: 'weapons_rustline', kind: 'weapons', name: 'Ironclad Outfitters (Rustline)', x: 720, z: -520, interior: 'weapons', sign: 0xffa53a },
	{ id: 'store_coral', kind: 'store', name: 'QuikStop 24 - Coral Mile', x: 150, z: 930, interior: 'store', sign: 0x7cff6a },
	{ id: 'store_westbrook', kind: 'store', name: 'QuikStop 24 - Westbrook', x: -820, z: 430, interior: 'store', sign: 0x7cff6a },
	{ id: 'store_meridian', kind: 'store', name: 'QuikStop 24 - Meridian', x: 310, z: -240, interior: 'store', sign: 0x7cff6a },
	{ id: 'exchange', kind: 'exchange', name: 'Gilded Gull Exchange', x: 520, z: 930, interior: 'exchange', sign: 0xffd84a },
	{ id: 'dealership', kind: 'dealership', name: 'Coastline Motors', x: -420, z: -330, sign: 0x4ad8ff },
	{ id: 'mechanic_west', kind: 'mechanic', name: 'Wrench & Ratchet Garage', x: -380, z: 520, sign: 0xc0c0c0 },
	{ id: 'mechanic_east', kind: 'mechanic', name: 'Wrench & Ratchet Garage (East)', x: 900, z: 110, sign: 0xc0c0c0 },
	{ id: 'prop_carwash', kind: 'property', name: "Sudsy's Car Wash", x: -700, z: -80, sign: 0x6ac8ff },
	{ id: 'prop_nightclub', kind: 'property', name: 'Afterglow Nightclub', x: 60, z: 620, sign: 0xff4ad8 },
	{ id: 'prop_warehouse', kind: 'property', name: 'Pier 9 Warehouse', x: 1220, z: 740, sign: 0xa0a0ff },
	{ id: 'prop_laundromat', kind: 'property', name: 'Lucky Tern Laundromat', x: -300, z: 780, sign: 0xffffff },
	{ id: 'contact_rosa', kind: 'contact', name: "Calloway's Diner", x: -120, z: 880, sign: 0xff8a3a },
	{ id: 'contact_priya', kind: 'contact', name: 'Static Electronics', x: 900, z: -160, sign: 0x3affd8 },
	{ id: 'contact_marco', kind: 'contact', name: 'Saltline Harbor Office', x: 1150, z: 450, sign: 0x3ab4ff },
];
