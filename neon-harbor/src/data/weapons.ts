// Weapon definitions (original names). Damage values are per bullet / pellet.

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'grenade';

export interface WeaponDef {
	id: WeaponId;
	name: string;
	kind: 'melee' | 'hitscan' | 'thrown';
	slot: number;
	damage: number;
	/** Shots per second. */
	fireRate: number;
	auto: boolean;
	clip: number;
	maxAmmo: number;
	reloadTime: number;
	range: number;
	/** Cone half-angle (radians) when hip-firing; aiming halves it. */
	spread: number;
	pellets: number;
	/** Radius in metres in which the shot is heard. */
	noise: number;
	/** Humanoid pose: 0 none, 1 handgun, 2 long gun. */
	pose: 0 | 1 | 2;
	/** Usable from a vehicle window. */
	driveBy: boolean;
	recoil: number;
	price: number;
	/** Price for one ammo pack. */
	ammoPrice: number;
	ammoPack: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
	fists: { id: 'fists', name: 'Fists', kind: 'melee', slot: 0, damage: 14, fireRate: 2.2, auto: false, clip: 0, maxAmmo: 0, reloadTime: 0, range: 1.7, spread: 0, pellets: 1, noise: 0, pose: 0, driveBy: false, recoil: 0, price: 0, ammoPrice: 0, ammoPack: 0 },
	pistol: { id: 'pistol', name: 'Kestrel P9', kind: 'hitscan', slot: 1, damage: 26, fireRate: 4, auto: false, clip: 12, maxAmmo: 180, reloadTime: 1.3, range: 70, spread: 0.035, pellets: 1, noise: 55, pose: 1, driveBy: true, recoil: 0.018, price: 900, ammoPrice: 60, ammoPack: 24 },
	smg: { id: 'smg', name: 'Wasp MX', kind: 'hitscan', slot: 2, damage: 18, fireRate: 11, auto: true, clip: 30, maxAmmo: 300, reloadTime: 1.6, range: 55, spread: 0.06, pellets: 1, noise: 60, pose: 2, driveBy: true, recoil: 0.012, price: 2800, ammoPrice: 120, ammoPack: 60 },
	shotgun: { id: 'shotgun', name: 'Thresher 12', kind: 'hitscan', slot: 3, damage: 15, fireRate: 1.3, auto: false, clip: 6, maxAmmo: 60, reloadTime: 2.2, range: 28, spread: 0.11, pellets: 8, noise: 70, pose: 2, driveBy: false, recoil: 0.06, price: 3500, ammoPrice: 140, ammoPack: 12 },
	rifle: { id: 'rifle', name: 'Halberd AR', kind: 'hitscan', slot: 4, damage: 32, fireRate: 8, auto: true, clip: 30, maxAmmo: 270, reloadTime: 1.9, range: 110, spread: 0.03, pellets: 1, noise: 80, pose: 2, driveBy: false, recoil: 0.016, price: 7500, ammoPrice: 220, ammoPack: 60 },
	grenade: { id: 'grenade', name: 'Breaker Frag', kind: 'thrown', slot: 5, damage: 0, fireRate: 1, auto: false, clip: 1, maxAmmo: 10, reloadTime: 0.6, range: 30, spread: 0, pellets: 1, noise: 0, pose: 1, driveBy: false, recoil: 0, price: 1200, ammoPrice: 400, ammoPack: 2 },
};

export const WEAPON_ORDER: WeaponId[] = ['fists', 'pistol', 'smg', 'shotgun', 'rifle', 'grenade'];
