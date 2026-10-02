// Simulation root: owns all gameplay state and runs systems in a fixed order.
// Contains no rendering or DOM code so it can run headless in unit tests.

import { EventBus } from '../core/EventBus';
import { Random } from '../core/Random';
import { WORLD } from '../data/config';
import { DISTRICTS, type DistrictId } from '../data/districts';
import { generateCity, type CityLayout } from '../world/CityLayout';
import { StaticCollision } from '../world/StaticCollision';
import { clearEdges, createControls, type PlayerControls } from './controls';
import type { GameEvents } from './events';
import { Player } from './Player';

export class World {
	readonly bus = new EventBus<GameEvents>();
	readonly city: CityLayout;
	readonly collision: StaticCollision;
	readonly player = new Player();
	readonly controls: PlayerControls = createControls();
	readonly rng: Random;
	/** Simulation seconds since start. */
	time = 0;
	currentDistrict: DistrictId | null = null;
	private districtTimer = 0;

	constructor(seed: number = WORLD.seed) {
		this.rng = new Random(seed ^ 0xabcdef);
		this.city = generateCity(seed);
		this.collision = new StaticCollision(16);
		this.city.forEachSolid((a, b, c, d, e, f) => this.collision.add(a, b, c, d, e, f));
		const home = this.city.poi('safehouse')!;
		this.player.teleport(home.x + Math.sin(home.facing) * 3, home.z + Math.cos(home.facing) * 3, home.facing);
	}

	step(dt: number): void {
		this.time += dt;
		const p = this.player;
		if (p.state === 'onFoot') p.updateOnFoot(dt, this.controls, this);
		p.updateVitals(dt);
		this.updateDistrict(dt);
		clearEdges(this.controls);
	}

	private updateDistrict(dt: number): void {
		this.districtTimer -= dt;
		if (this.districtTimer > 0) return;
		this.districtTimer = 0.5;
		const d = this.city.districtAt(this.player.px, this.player.pz);
		if (d !== this.currentDistrict) {
			this.currentDistrict = d;
			const def = DISTRICTS[d];
			this.bus.emit('districtEntered', { id: d, name: def.name, tagline: def.tagline });
		}
	}
}
