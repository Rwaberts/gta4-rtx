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
	private wanted = el('div', { class: 'hud-wanted' });
	private chevrons: HTMLElement[] = [];
	private arrestBar = el('div', { class: 'hud-arrest hidden' });
	private arrestFill = el('div');
	private radio = el('div', { class: 'hud-radio' });
	private radioTimer = 0;
	private overlay = el('div', { class: 'hud-overlay hidden' });
	private overlayTitle = el('div', { class: 'title' });
	private overlaySub = el('div', { class: 'sub' });
	private objective = el('div', { class: 'hud-objective hidden' });
	private dialogue = el('div', { class: 'hud-dialogue' });
	private dialogueQueue: Array<{ speaker: string; text: string; duration: number }> = [];
	private dialogueTimer = 0;
	private banner = el('div', { class: 'hud-banner hidden' });
	private bannerTitle = el('div', { class: 'title' });
	private bannerSub = el('div', { class: 'sub' });
	private bannerTimer = 0;
	private progress = el('div', { class: 'hud-progress hidden' });
	private progressFill = el('div');
	private hitTimer = 0;
	private districtTimer = 0;
	debugVisible = false;

	constructor(parent: HTMLElement, world: World) {
		this.district.append(this.districtName, this.districtTag);
		const vitals = el('div', { class: 'hud-vitals' }, this.healthBar, this.armorBar, this.staminaBar);
		this.prompt.append(this.promptKey, this.promptText);
		this.weapon.append(this.weaponName, this.weaponAmmo);
		for (let i = 0; i < 5; i++) {
			const c = el('div', { class: 'chev' });
			this.chevrons.push(c);
			this.wanted.append(c);
		}
		this.arrestBar.append(el('span', { text: 'ARREST' }), el('div', { class: 'bar' }, this.arrestFill));
		this.overlay.append(this.overlayTitle, this.overlaySub);
		this.banner.append(this.bannerTitle, this.bannerSub);
		this.progress.append(el('div', { class: 'bar' }, this.progressFill));
		this.root.append(this.weapon, this.wanted, this.arrestBar, this.radio, this.objective, this.dialogue, this.banner, this.progress, this.overlay);
		world.bus.on('objective', (o) => {
			this.objective.classList.toggle('hidden', !o.text);
		});
		world.bus.on('dialogue', (d) => {
			this.dialogueQueue.push({ speaker: d.speaker, text: d.text, duration: d.duration });
		});
		world.bus.on('missionStarted', (m) => this.showBanner(m.title, 'Mission started', 'start'));
		world.bus.on('missionCompleted', (m) => this.showBanner('MISSION PASSED', `${m.title}  ·  +$${m.reward.toLocaleString('en-US')}`, 'passed'));
		world.bus.on('missionFailed', (m) => this.showBanner('MISSION FAILED', m.reason, 'failed'));
		world.bus.on('radio', (r) => {
			setText(this.radio, r.text);
			this.radio.classList.add('show');
			this.radioTimer = 5;
		});
		world.bus.on('playerDied', () => this.showOverlay('CRITICAL CONDITION', 'Rushed to the nearest hospital…', 'dead'));
		world.bus.on('playerArrested', () => this.showOverlay('IN CUSTODY', 'Booked at the nearest precinct…', 'busted'));
		world.bus.on('playerRespawned', () => this.overlay.classList.add('hidden'));
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

	showBanner(title: string, sub: string, kind: string): void {
		setText(this.bannerTitle, title);
		setText(this.bannerSub, sub);
		this.banner.className = 'hud-banner ' + kind;
		this.bannerTimer = 4.5;
	}

	setObjective(text: string): void {
		setText(this.objective, text);
		this.objective.classList.toggle('hidden', !text);
	}

	setProgress(v: number | null): void {
		this.progress.classList.toggle('hidden', v === null);
		if (v !== null) setWidth(this.progressFill, v * 100);
	}

	showOverlay(title: string, sub: string, kind: string): void {
		setText(this.overlayTitle, title);
		setText(this.overlaySub, sub);
		this.overlay.className = 'hud-overlay ' + kind;
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

		// Wanted chevrons: filled per level, pulsing while the police search.
		const wd = world.wanted;
		this.chevrons.forEach((c, i) => {
			c.classList.toggle('on', i < wd.level);
		});
		this.wanted.classList.toggle('searching', wd.searching);
		this.wanted.classList.toggle('active', wd.level > 0);
		this.arrestBar.classList.toggle('hidden', wd.arrest <= 0.01);
		setWidth(this.arrestFill, wd.arrest * 100);
		if (this.bannerTimer > 0) {
			this.bannerTimer -= dt;
			if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
		}
		// Dialogue subtitles play one line at a time.
		if (this.dialogueTimer > 0) this.dialogueTimer -= dt;
		if (this.dialogueTimer <= 0) {
			const next = this.dialogueQueue.shift();
			if (next) {
				this.dialogue.innerHTML = '';
				this.dialogue.append(el('span', { class: 'speaker', text: next.speaker + ': ' }), document.createTextNode(next.text));
				this.dialogue.classList.add('show');
				this.dialogueTimer = next.duration;
			} else this.dialogue.classList.remove('show');
		}
		if (this.radioTimer > 0) {
			this.radioTimer -= dt;
			if (this.radioTimer <= 0) this.radio.classList.remove('show');
		}

		if (this.districtTimer > 0) {
			this.districtTimer -= dt;
			if (this.districtTimer <= 0) this.district.classList.remove('show');
		}
		if (this.debugVisible) setText(this.debug, debugText);
	}
}
