// Dynamic weather: a Markov chain over weather states with smooth blending. Produces cloud
// cover, rain intensity, fog density, wind, wetness (roads dry slowly) and lightning.

import type { World } from './World';

export type WeatherState = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog';

export interface WeatherParams {
	cloud: number;
	rain: number;
	fog: number;
	/** Sun / sky light multiplier. */
	light: number;
	wind: number;
}

export const WEATHER_PARAMS: Record<WeatherState, WeatherParams> = {
	clear: { cloud: 0.15, rain: 0, fog: 0, light: 1, wind: 0.2 },
	cloudy: { cloud: 0.45, rain: 0, fog: 0.05, light: 0.85, wind: 0.35 },
	overcast: { cloud: 0.8, rain: 0, fog: 0.15, light: 0.6, wind: 0.45 },
	rain: { cloud: 0.9, rain: 0.65, fog: 0.3, light: 0.5, wind: 0.6 },
	storm: { cloud: 1, rain: 1, fog: 0.45, light: 0.35, wind: 1 },
	fog: { cloud: 0.55, rain: 0, fog: 1, light: 0.65, wind: 0.05 },
};

/** Relative transition weights between states. */
const TRANSITIONS: Record<WeatherState, Partial<Record<WeatherState, number>>> = {
	clear: { clear: 4, cloudy: 3, fog: 0.5 },
	cloudy: { clear: 2.5, cloudy: 1.5, overcast: 2 },
	overcast: { cloudy: 2, overcast: 1, rain: 2.2, fog: 0.4 },
	rain: { overcast: 2, rain: 1.5, storm: 1 },
	storm: { rain: 2, storm: 0.5 },
	fog: { clear: 1.5, cloudy: 1 },
};

export const WEATHER_NAMES: Record<WeatherState, string> = {
	clear: 'Clear',
	cloudy: 'Cloudy',
	overcast: 'Overcast',
	rain: 'Rain',
	storm: 'Thunderstorm',
	fog: 'Sea fog',
};

export class Weather {
	state: WeatherState = 'clear';
	private from: WeatherParams = { ...WEATHER_PARAMS.clear };
	readonly params: WeatherParams = { ...WEATHER_PARAMS.clear };
	private blend = 1;
	/** Game minutes until the next weather roll. */
	private nextRoll = 90;
	wetness = 0;
	lightning = 0;
	private lightningTimer = 8;
	/** Freeze weather (missions / settings). */
	locked = false;

	constructor(private readonly world: World) {}

	set(state: string, instant = false): void {
		const s = (state in WEATHER_PARAMS ? state : 'clear') as WeatherState;
		this.from = { ...this.params };
		this.state = s;
		this.blend = instant ? 1 : 0;
		if (instant) Object.assign(this.params, WEATHER_PARAMS[s]);
		if (instant) this.wetness = WEATHER_PARAMS[s].rain > 0 ? 0.9 : 0;
		this.world.bus.emit('weatherChanged', { state: s });
	}

	update(dt: number): void {
		const w = this.world;
		const gameMinutes = dt * w.clock.scale;
		if (!this.locked) {
			this.nextRoll -= gameMinutes;
			if (this.nextRoll <= 0) {
				this.nextRoll = w.rng.range(60, 180);
				const next = w.rng.weighted(TRANSITIONS[this.state] as Record<WeatherState, number>);
				if (next !== this.state) this.set(next);
			}
		}
		// Blend over ~20 real seconds.
		if (this.blend < 1) {
			this.blend = Math.min(1, this.blend + dt / 20);
			const t = this.blend * this.blend * (3 - 2 * this.blend);
			const target = WEATHER_PARAMS[this.state];
			for (const k of Object.keys(target) as Array<keyof WeatherParams>) this.params[k] = this.from[k] + (target[k] - this.from[k]) * t;
		}
		// Roads get wet quickly and dry slowly.
		const rain = this.params.rain;
		this.wetness = rain > 0.05 ? Math.min(1, this.wetness + dt * 0.08 * rain) : Math.max(0, this.wetness - dt * 0.006);
		w.wetness = this.wetness;
		// Lightning during storms.
		this.lightning = Math.max(0, this.lightning - dt * 3);
		if (this.state === 'storm' && this.blend > 0.5) {
			this.lightningTimer -= dt;
			if (this.lightningTimer <= 0) {
				this.lightningTimer = w.rng.range(5, 16);
				this.lightning = 1;
				w.bus.emit('sound', { id: 'thunder', volume: w.rng.range(0.6, 1) });
			}
		}
	}
}
