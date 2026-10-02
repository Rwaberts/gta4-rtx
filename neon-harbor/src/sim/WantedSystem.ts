// Wanted level bookkeeping. Crimes only matter when witnessed: police see them directly,
// civilians phone them in. Units share the last known position (LKP) over the radio.
// When nobody has line of sight the police search; staying unseen for the level's search
// time (or leaving the search area) clears the level.

import { DISTRICTS } from '../data/districts';
import { CRIME_HEAT, HEAT_THRESHOLDS, RADIO_LINES, WANTED_LEVELS, type WantedLevelDef } from '../data/wanted';
import type { CrimeType } from './events';
import type { World } from './World';

export class WantedSystem {
	heat = 0;
	level = 0;
	lkpX = 0;
	lkpZ = 0;
	/** Someone (officer / helicopter) currently sees the player. */
	seen = false;
	sinceSeen = 0;
	/** Seconds the search has been running without a sighting. */
	searchTime = 0;
	/** 0..1 arrest progress (driven by officers in contact). */
	arrest = 0;
	arrestContact = false;
	private radioCooldown = 0;
	/** Set when the player is visibly armed / dangerous (affects lethal force). */
	armedThreat = 0;
	enabled = true;

	constructor(private readonly world: World) {
		const bus = world.bus;
		bus.on('crimeReported', (r) => this.report(r.type, r.x, r.z, r.reporter));
		bus.on('playerDied', () => this.clear(true));
		bus.on('playerArrested', () => this.clear(true));
	}

	get def(): WantedLevelDef {
		return WANTED_LEVELS[this.level];
	}

	get searching(): boolean {
		return this.level > 0 && !this.seen && this.sinceSeen > 3;
	}

	/** Seconds left before the search is called off (for the HUD). */
	get searchRemaining(): number {
		return Math.max(0, this.def.searchTime - this.searchTime);
	}

	levelForHeat(h: number): number {
		let l = 0;
		for (let i = 1; i < HEAT_THRESHOLDS.length; i++) if (h >= HEAT_THRESHOLDS[i]) l = i;
		return l;
	}

	/** A crime has been witnessed by police or reported by a civilian. */
	report(type: CrimeType, x: number, z: number, source: 'police' | 'civilian'): void {
		if (!this.enabled) return;
		const amount = CRIME_HEAT[type] * (source === 'civilian' ? 0.8 : 1);
		if (type === 'gunfire' || type === 'shootCivilian' || type === 'murder' || type === 'killPolice' || type === 'assaultPolice' || type === 'explosion') {
			this.armedThreat = 30;
		}
		this.heat += amount;
		if (source === 'civilian' && (this.level === 0 || this.searching)) {
			this.lkpX = x;
			this.lkpZ = z;
		}
		const target = Math.max(this.level, this.levelForHeat(this.heat));
		// A civilian phone call alone never jumps past level 2.
		const capped = source === 'civilian' && this.level < 2 ? Math.min(target, 2) : target;
		if (capped > this.level) this.setLevelInternal(capped);
		// Officers saw it happen: they know exactly where the player is.
		if (source === 'police') this.spotted();
		else if (this.level > 0) this.radio('report');
	}

	/** Forces a wanted level (missions, debug). */
	setLevel(level: number, x = this.world.player.px, z = this.world.player.pz): void {
		level = Math.max(0, Math.min(5, level));
		if (level === 0) {
			this.clear(false);
			return;
		}
		this.heat = Math.max(this.heat, HEAT_THRESHOLDS[level]);
		this.lkpX = x;
		this.lkpZ = z;
		this.setLevelInternal(level);
		this.spotted();
	}

	private setLevelInternal(level: number): void {
		const prev = this.level;
		if (level === prev) return;
		this.level = level;
		this.searchTime = 0;
		this.heat = Math.max(this.heat, HEAT_THRESHOLDS[level]);
		this.world.bus.emit('wantedChanged', { level, previous: prev });
		if (level > prev && prev > 0) this.radio('escalate', true);
	}

	/** Called by police AI when an officer / helicopter has line of sight. */
	spotted(): void {
		if (this.level === 0) return;
		const wasSearching = this.searching;
		this.seen = true;
		this.sinceSeen = 0;
		this.searchTime = 0;
		this.lkpX = this.world.player.px;
		this.lkpZ = this.world.player.pz;
		if (wasSearching) this.radio('spotted', true);
	}

	clear(silent: boolean): void {
		const prev = this.level;
		this.level = 0;
		this.heat = 0;
		this.seen = false;
		this.sinceSeen = 0;
		this.searchTime = 0;
		this.arrest = 0;
		this.armedThreat = 0;
		if (prev > 0) {
			this.world.bus.emit('wantedChanged', { level: 0, previous: prev });
			if (!silent) {
				this.radio('cleared', true);
				this.world.bus.emit('notify', { text: 'You lost the police.', kind: 'good' });
			}
		}
	}

	/** True when officers should use lethal force right now. */
	lethal(): boolean {
		const pol = this.def.lethal;
		if (pol === 'always') return true;
		if (pol === 'never') return false;
		return this.armedThreat > 0 || this.world.combat.recentFire > 0;
	}

	/** `seenThisTick` is the OR of all police line-of-sight checks in this update. */
	update(dt: number, seenThisTick: boolean): void {
		this.radioCooldown -= dt;
		this.armedThreat = Math.max(0, this.armedThreat - dt);
		if (this.level === 0) {
			this.arrest = 0;
			return;
		}
		if (seenThisTick) this.spotted();
		else {
			if (this.seen && this.sinceSeen > 0.5) this.seen = false;
			this.sinceSeen += dt;
			if (this.sinceSeen > 3 && this.sinceSeen - dt <= 3) this.radio('lost');
		}
		if (this.searching) {
			// Searching runs faster when the player is outside the search area.
			const p = this.world.player;
			const d = Math.hypot(p.px - this.lkpX, p.pz - this.lkpZ);
			const outside = d > this.def.searchRadius;
			this.searchTime += dt * (outside ? 2 : 1);
			if (this.searchTime >= this.def.searchTime) this.clear(false);
		}
		// Arrest progress decays without contact.
		if (!this.arrestContact) this.arrest = Math.max(0, this.arrest - dt * 0.6);
		this.arrestContact = false;
	}

	/** An officer in contact range advances the arrest. Returns true when complete. */
	advanceArrest(dt: number, seconds: number): boolean {
		this.arrestContact = true;
		this.arrest = Math.min(1, this.arrest + dt / seconds);
		return this.arrest >= 1;
	}

	radio(kind: keyof typeof RADIO_LINES, force = false): void {
		if (!force && this.radioCooldown > 0) return;
		this.radioCooldown = 6;
		const w = this.world;
		const lines = RADIO_LINES[kind];
		const place = DISTRICTS[w.city.districtAt(this.lkpX, this.lkpZ)].name;
		const unit = String(10 + Math.floor(w.rng.next() * 80));
		const text = lines[Math.floor(w.rng.next() * lines.length)].replace('{place}', place).replace('{unit}', unit);
		w.bus.emit('radio', { text });
	}

	serialize(): { level: number; heat: number } {
		return { level: this.level, heat: this.heat };
	}
}
