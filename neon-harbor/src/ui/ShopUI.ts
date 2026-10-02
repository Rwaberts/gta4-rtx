// Shop / dealership / mechanic / property / safehouse panels. They call into ShopSystem and
// re-render after every purchase so prices, ammo and cash stay current.

import { ARMOR, PROPERTIES, RESPRAY_PRICE, SNACKS } from '../data/economy';
import { VEHICLES } from '../data/vehicles';
import { WEAPONS } from '../data/weapons';
import type { World } from '../sim/World';
import { formatMoney } from '../core/math';
import { button, el } from './dom';

const PAINTS = [0xe83a3a, 0xf0c020, 0x2ac8e8, 0xf05ac8, 0x3ae86a, 0xf08a2a, 0xf0f0f0, 0x141416, 0x2a4a8a, 0x6a3a8a];

function row(name: string, detail: string, price: string, action: HTMLElement): HTMLElement {
	return el('div', { class: 'shop-row' }, el('div', { class: 'info' }, el('div', { class: 'name', text: name }), el('div', { class: 'detail', text: detail })), el('div', { class: 'price', text: price }), action);
}

export function shopPanel(world: World, shop: string, poiId: string, close: () => void, onSave?: () => void): HTMLElement {
	const panel = el('div', { class: 'menu-panel shop' });
	const render = () => {
		panel.innerHTML = '';
		const s = world.shops;
		const poi = world.city.poi(poiId);
		panel.append(el('div', { class: 'menu-title', text: poi?.name ?? 'Shop' }), el('div', { class: 'shop-cash', text: `Cash: ${formatMoney(world.economy.cash)}` }));
		const list = el('div', { class: 'shop-list' });
		const buy = (label: string, fn: () => void) => button(label, () => {
			fn();
			render();
		}, 'menu-btn small');
		if (shop === 'weapons') {
			for (const id of s.stockWeapons()) {
				const d = WEAPONS[id];
				const owned = world.combat.inventory.has(id);
				const ammo = world.combat.inventory.totalAmmo(id);
				list.append(
					owned
						? row(d.name, `Ammo ${ammo}/${d.maxAmmo} · pack of ${d.ammoPack}`, formatMoney(d.ammoPrice), buy('Ammo', () => s.buyAmmo(id)))
						: row(d.name, `${d.damage} dmg · ${d.fireRate}/s · clip ${d.clip}`, formatMoney(d.price), buy('Buy', () => s.buyWeapon(id))),
				);
			}
			list.append(row('Body armor', `Absorbs most incoming damage (${Math.round(world.player.armor)}/100)`, formatMoney(ARMOR.price), buy('Buy', () => s.buyArmor())));
		} else if (shop === 'store') {
			for (const sn of SNACKS) list.append(row(sn.name, `+${sn.heal} health`, formatMoney(sn.price), buy('Buy', () => s.buySnack(sn.id))));
		} else if (shop === 'dealership') {
			for (const id of s.stockVehicles()) {
				const d = VEHICLES[id];
				const color = d.colors[0];
				list.append(row(`${d.make} ${d.name}`, `Top speed ${Math.round(d.maxSpeed * 3.6)} km/h · ${d.style}`, formatMoney(d.price), buy('Buy', () => s.buyVehicle(id, color))));
			}
		} else if (shop === 'mechanic') {
			const v = world.player.vehicle ?? null;
			if (!v) list.append(el('p', { text: 'Drive a vehicle into the garage for repairs or a respray.' }));
			else {
				const cost = s.repairCost(v);
				list.append(row(`Repair ${v.def.make} ${v.def.name}`, `Condition ${Math.round(v.healthFraction * 100)}%`, formatMoney(cost), buy('Repair', () => s.repair(v))));
				const swatches = el('div', { class: 'swatches' });
				for (const c of PAINTS) {
					const b = button('', () => {
						s.respray(v, c);
						render();
					}, 'swatch');
					b.style.background = '#' + c.toString(16).padStart(6, '0');
					swatches.append(b);
				}
				list.append(el('div', { class: 'shop-row' }, el('div', { class: 'info' }, el('div', { class: 'name', text: 'Respray' }), el('div', { class: 'detail', text: 'A fresh coat of paint.' })), el('div', { class: 'price', text: formatMoney(RESPRAY_PRICE) })), swatches);
			}
		} else if (shop === 'property') {
			const d = PROPERTIES.find((p) => p.id === poiId);
			if (d) {
				const owned = world.economy.properties.has(d.id);
				list.append(el('p', { text: d.description }));
				list.append(row(d.name, `Income ${formatMoney(d.dailyIncome)} per day`, owned ? 'Owned' : formatMoney(d.price), owned ? el('span') : buy('Buy', () => s.buyProperty(d.id))));
			}
		} else if (shop === 'safehouse') {
			list.append(
				el('p', { text: 'Home sweet home. Save your progress, or sleep to pass the time and recover.' }),
				button('Save game', () => onSave?.(), 'menu-btn small'),
				button('Sleep until morning (and save)', () => {
					s.sleep();
					onSave?.();
					render();
				}, 'menu-btn small'),
			);
		}
		panel.append(list, button('Leave', close));
	};
	render();
	return panel;
}
