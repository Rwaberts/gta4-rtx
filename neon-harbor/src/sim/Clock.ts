// In-game clock. By default one real second is one in-game minute (a 24-minute day).

export class Clock {
	/** Minutes since midnight of day 0. */
	totalMinutes: number;
	/** In-game minutes per real second. */
	scale = 1;
	paused = false;

	constructor(startHour = 9) {
		this.totalMinutes = startHour * 60;
	}

	get day(): number {
		return Math.floor(this.totalMinutes / 1440);
	}

	/** Fractional hour 0..24. */
	get hour(): number {
		return (this.totalMinutes % 1440) / 60;
	}

	get hourInt(): number {
		return Math.floor(this.hour);
	}

	/** 0 at noon, 1 deep night; smooth twilight transitions. */
	get nightFactor(): number {
		const h = this.hour;
		if (h >= 7 && h <= 18) return 0;
		if (h > 18 && h < 20.5) return (h - 18) / 2.5;
		if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
		return 1;
	}

	update(dt: number): void {
		if (!this.paused) this.totalMinutes += dt * this.scale;
	}

	setHour(h: number): void {
		this.totalMinutes = this.day * 1440 + ((h % 24) + 24) % 24 * 60;
	}

	advanceHours(h: number): void {
		this.totalMinutes += h * 60;
	}

	format(): string {
		const h = Math.floor(this.hour);
		const m = Math.floor((this.hour - h) * 60);
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}
}
