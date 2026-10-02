// In-game HUD (DOM overlay). Elements are updated with change detection to avoid layout thrash.

import { PLAYER } from '../data/config';
import type { World } from '../sim/World';
import type { NotifyKind } from '../sim/events';
import { el, setText, setWidth } from './dom';

export class Hud {
	readonly root = el('div', { class: 'hud hidden' });
	private crosshair = el('div', { class: 'hud-crosshair' });
	private district = el('div', { class: 'hud-district' });
	private districtName = el('div', { class: 'name' });
	private districtTag = el('div', { class: 'tag' });
	private notifyBox = el('div', { class: 'hud-notify' });
	private debug = el('div', { class: 'hud-debug hidden' });
	private health = el('div');
	private healthBar = el('div', { class: 'bar health' }, this.health);
	private armor = el('div');
	private armorBar = el('div', { class: 'bar armor' }, this.armor);
	private stamina = el('div');
	private staminaBar = el('div', { class: 'bar stamina' }, this.stamina);
	private prompt = el('div', { class: 'hud-prompt hidden' });
	private promptKey = el('span', { class: 'key' });
	private promptText = el('span');
	private weapon = el('div', { class: 'hud-weapon' });
	private weaponName = el('div', { class: 'name' });
	private weaponAmmo = el('div', { class: 'ammo' });
	private hitTimer = 0;
	private districtTimer = 0;
	debugVisible = false;

	constructor(parent: HTMLElement, world: World) {
		this.district.append(this.districtName, this.districtTag);
		const vitals = el('div', { class: 'hud-vitals' }, this.healthBar, this.armorBar, this.staminaBar);
		this.prompt.append(this.promptKey, this.promptText);
		this.weapon.append(this.weaponName, this.weaponAmmo);
		this.root.append(this.weapon);
		this.root.append(this.crosshair, this.district, this.notifyBox, this.debug, vitals, this.prompt);
		parent.append(this.root);
		world.bus.on('notify', (n) => this.notify(n.text, n.kind, n.duration));
		world.bus.on('districtEntered', (d) => {
			setText(this.districtName, d.name);
			setText(this.districtTag, d.tagline);
			this.district.classList.add('show');
			this.districtTimer = 4;
		});
	}

	show(on: boolean): void {
		this.root.classList.toggle('hidden', !on);
	}

	toggleDebug(): void {
		this.debugVisible = !this.debugVisible;
		this.debug.classList.toggle('hidden', !this.debugVisible);
	}

	setWeapon(name: string, clip: number | null, reserve: number | null, reloading: boolean): void {
		setText(this.weaponName, name);
		setText(this.weaponAmmo, clip === null ? '' : reloading ? 'RELOADING' : `${clip} / ${reserve}`);
		this.weaponAmmo.classList.toggle('empty', clip === 0 && !reloading);
	}

	hitMarker(kill: boolean): void {
		this.hitTimer = kill ? 0.35 : 0.15;
		this.crosshair.classList.add('hit');
	}

	/** Context prompt such as "[F] Enter vehicle". Pass null to hide. */
	setPrompt(key: string | null, text = ''): void {
		this.prompt.classList.toggle('hidden', key === null);
		if (key === null) return;
		setText(this.promptKey, key);
		setText(this.promptText, text);
	}

	notify(text: string, kind: NotifyKind = 'info', duration = 4.5): void {
		const n = el('div', { class: 'notify ' + kind, text });
		this.notifyBox.append(n);
		while (this.notifyBox.children.length > 5) this.notifyBox.firstElementChild!.remove();
		setTimeout(() => n.classList.add('out'), duration * 1000);
		setTimeout(() => n.remove(), duration * 1000 + 450);
	}

	update(dt: number, world: World, debugText: string): void {
		const p = world.player;
		setWidth(this.health, (p.health / PLAYER.maxHealth) * 100);
		this.healthBar.classList.toggle('low', p.health < 30);
		setWidth(this.armor, (p.armor / PLAYER.maxArmor) * 100);
		this.armorBar.classList.toggle('hidden', p.armor <= 0);
		setWidth(this.stamina, (p.stamina / PLAYER.maxStamina) * 100);
		this.staminaBar.classList.toggle('hidden', p.stamina >= PLAYER.maxStamina - 0.1);
		this.crosshair.classList.toggle('on', (p.aiming && p.state === 'onFoot') || this.hitTimer > 0);
		if (this.hitTimer > 0) {
			this.hitTimer -= dt;
			if (this.hitTimer <= 0) this.crosshair.classList.remove('hit');
		}

		if (this.districtTimer > 0) {
			this.districtTimer -= dt;
			if (this.districtTimer <= 0) this.district.classList.remove('show');
		}
		if (this.debugVisible) setText(this.debug, debugText);
	}
}
