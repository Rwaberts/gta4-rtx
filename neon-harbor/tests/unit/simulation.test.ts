import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/World';
import { SIM } from '../../src/data/config';
import { Clock } from '../../src/sim/Clock';
import { WEATHER_PARAMS } from '../../src/sim/Weather';
import { skyAt } from '../../src/render/Atmosphere';
import type { AmbientKind } from '../../src/sim/AmbientEvents';

const DT = SIM.fixedDt;
function run(w: World, seconds: number): void {
	for (let i = 0; i < Math.round(seconds / DT); i++) w.step(DT);
}

describe('Day / night', () => {
	it('clock night factor follows the day', () => {
		const c = new Clock(12);
		expect(c.nightFactor).toBe(0);
		c.setHour(2);
		expect(c.nightFactor).toBe(1);
		c.setHour(19);
		expect(c.nightFactor).toBeGreaterThan(0);
		expect(c.nightFactor).toBeLessThan(1);
		c.setHour(23);
		c.update(120); // two game hours at 1 min / s
		expect(c.hour).toBeCloseTo(1);
		expect(c.day).toBe(1);
		expect(c.format()).toBe('01:00');
	});

	it('sun rises in the east, peaks at noon and sets in the west', () => {
		const clear = WEATHER_PARAMS.clear;
		const morning = skyAt(7, clear);
		const noonSky = skyAt(12.25, clear);
		const evening = skyAt(17.5, clear);
		const night = skyAt(1, clear);
		expect(morning.dir.x).toBeGreaterThan(0.3);
		expect(evening.dir.x).toBeLessThan(-0.3);
		expect(noonSky.dir.y).toBeGreaterThan(0.85);
		expect(noonSky.sunIntensity).toBeGreaterThan(night.sunIntensity * 4);
		expect(night.daylight).toBe(false);
		expect(noonSky.top.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(night.top.getHSL({ h: 0, s: 0, l: 0 }).l);
	});

	it('clouds and storms dim the light', () => {
		const sunny = skyAt(12, WEATHER_PARAMS.clear);
		const storm = skyAt(12, WEATHER_PARAMS.storm);
		expect(storm.sunIntensity).toBeLessThan(sunny.sunIntensity * 0.5);
	});
});

describe('Weather', () => {
	it('rain wets the roads quickly and they dry slowly', () => {
		const w = new World();
		w.actors.density = 0;
		w.traffic.enabled = false;
		w.weather.locked = true;
		w.weather.set('rain');
		run(w, 30);
		expect(w.wetness).toBeGreaterThan(0.5);
		expect(w.weather.params.rain).toBeGreaterThan(0.5);
		w.weather.set('clear');
		run(w, 30);
		expect(w.wetness).toBeGreaterThan(0.2);
		expect(w.weather.params.rain).toBeLessThan(0.05);
	});

	it('the weather chain changes over a few in-game days and storms bring thunder', () => {
		const w = new World();
		w.actors.density = 0;
		w.traffic.enabled = false;
		w.police.enabled = false;
		w.clock.scale = 30; // 30 game minutes per second
		const seen = new Set<string>();
		w.bus.on('weatherChanged', (e) => seen.add(e.state));
		run(w, 360);
		expect(seen.size).toBeGreaterThanOrEqual(2);
		let thunder = 0;
		w.bus.on('sound', (e) => {
			if (e.id === 'thunder') thunder++;
		});
		w.weather.locked = true;
		w.weather.set('storm', true);
		run(w, 40);
		expect(thunder).toBeGreaterThan(0);
	});
});

describe('Ambient events', () => {
	function downtown(): World {
		const w = new World();
		w.clock.setHour(22);
		w.traffic.enabled = true;
		const n = w.city.nearestNode(20, 160)!;
		w.player.teleport(n.x + 12, n.z + 12, 0);
		run(w, 3);
		return w;
	}

	it('every ambient event type can spawn and is cleaned up when the player leaves', () => {
		const w = downtown();
		w.ambient.enabled = false;
		for (const k of ['gangHangout', 'mugging', 'brokenDown', 'trafficStop', 'streetRace', 'courier'] as AmbientKind[]) {
			let ok = false;
			for (let i = 0; i < 6 && !ok; i++) ok = w.ambient.debugSpawn(k);
			expect(ok, k).toBe(true);
		}
		expect(w.ambient.events.length).toBeGreaterThanOrEqual(6);
		const far = w.city.nearestNode(-1300, -1300)!;
		w.player.teleport(far.x, far.z, 0);
		run(w, 3);
		expect(w.ambient.events.length).toBe(0);
	});

	it('the courier side job pays on delivery', () => {
		const w = downtown();
		w.ambient.enabled = false;
		expect(w.ambient.debugSpawn('courier')).toBe(true);
		const job = w.ambient.events.find((e) => e.kind === 'courier')!;
		w.ambient.acceptCourier(job);
		expect(w.ambient.courierJob).toBe(job);
		expect(w.ambient.objectiveText()).toMatch(/Courier job/);
		const cash = w.economy.cash;
		w.player.teleport(job.dest!.x, job.dest!.z, 0);
		run(w, 0.2);
		expect(w.economy.cash).toBe(cash + job.reward!);
		expect(w.ambient.courierJob).toBeNull();
	});

	it('stopping a mugging earns a tip', () => {
		const w = downtown();
		w.ambient.enabled = false;
		expect(w.ambient.debugSpawn('mugging')).toBe(true);
		const ev = w.ambient.events.find((e) => e.kind === 'mugging')!;
		const cash = w.economy.cash;
		w.actors.kill(ev.actors[0], 'player', 'pistol');
		expect(w.economy.cash).toBeGreaterThan(cash);
	});

	it('ambient events appear on their own over time', () => {
		const w = downtown();
		run(w, 60);
		expect(w.ambient.events.length).toBeGreaterThan(0);
	});
});
