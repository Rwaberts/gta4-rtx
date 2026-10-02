// Walk-in interiors. Each POI with an interior gets its own room far outside the city
// (so streaming never overlaps), with collision walls, counters and a clerk. Doors teleport.

import { WORLD } from '../data/config';
import { INTERIORS, type InteriorDef } from '../data/interiors';
import type { Poi } from '../world/CityLayout';
import type { Actor } from './Actor';
import { ClerkBrain } from './ai/ClerkBrain';
import type { World } from './World';

export interface InteriorInstance {
	poi: Poi;
	def: InteriorDef;
	ox: number;
	oz: number;
}

export class InteriorSystem {
	readonly instances: InteriorInstance[] = [];
	current: InteriorInstance | null = null;
	clerk: Actor | null = null;

	constructor(private readonly world: World) {
		let k = 0;
		for (const poi of world.city.pois) {
			if (!poi.interior) continue;
			const def = INTERIORS[poi.interior];
			const inst: InteriorInstance = { poi, def, ox: WORLD.interiorOrigin.x + k * 60, oz: WORLD.interiorOrigin.z };
			this.instances.push(inst);
			this.buildCollision(inst);
			k++;
		}
		world.interactions.register((out) => {
			const p = world.player;
			if (this.current) {
				const ex = this.exitPoint(this.current);
				out.push({ label: `Leave ${this.current.poi.name}`, x: ex.x, z: ex.z, radius: 1.8, act: () => this.exit() });
				return;
			}
			for (const inst of this.instances) {
				const poi = inst.poi;
				if (Math.abs(poi.x - p.x) > 4 || Math.abs(poi.z - p.z) > 4) continue;
				const blocked = world.wanted.level > 0 && !world.missions.allowsInterior(inst.def.id) ? 'Lose the police before going inside.' : undefined;
				out.push({ label: `Enter ${poi.name}`, x: poi.x, z: poi.z, radius: 2.2, blocked, act: () => this.enter(inst) });
			}
		});
	}

	private buildCollision(inst: InteriorInstance): void {
		const c = this.world.collision;
		const { width: W, depth: D, height: H } = inst.def;
		const x0 = inst.ox - W / 2;
		const x1 = inst.ox + W / 2;
		const z0 = inst.oz - D / 2;
		const z1 = inst.oz + D / 2;
		const t = 0.4;
		c.add(x0 - t, z0 - t, x0, z1 + t, 0, H); // west
		c.add(x1, z0 - t, x1 + t, z1 + t, 0, H); // east
		c.add(x0 - t, z1, x1 + t, z1 + t, 0, H); // back
		c.add(x0 - t, z0 - t, inst.ox - 1, z0, 0, H); // front left of the door
		c.add(inst.ox + 1, z0 - t, x1 + t, z0, 0, H); // front right
		c.add(inst.ox - 1, z0 - t - 0.6, inst.ox + 1, z0 - 0.6, 0, H); // closed door behind the entry
		c.add(x0 - t, z0 - t, x1 + t, z1 + t, H, H + 0.3); // ceiling
		for (const b of inst.def.props) {
			if (b.glow || (b.y ?? 0) > 0.5) continue;
			c.add(inst.ox + b.x - b.w / 2, inst.oz + b.z - b.d / 2, inst.ox + b.x + b.w / 2, inst.oz + b.z + b.d / 2, b.y ?? 0, (b.y ?? 0) + b.h);
		}
	}

	/** World position of a local interior coordinate. */
	toWorld(inst: InteriorInstance, lx: number, lz: number): { x: number; z: number } {
		return { x: inst.ox + lx, z: inst.oz + lz };
	}

	entryPoint(inst: InteriorInstance): { x: number; z: number } {
		return { x: inst.ox, z: inst.oz - inst.def.depth / 2 + 2.8 };
	}

	exitPoint(inst: InteriorInstance): { x: number; z: number } {
		return { x: inst.ox, z: inst.oz - inst.def.depth / 2 + 0.5 };
	}

	instanceFor(poiId: string): InteriorInstance | undefined {
		return this.instances.find((i) => i.poi.id === poiId);
	}

	enter(inst: InteriorInstance): void {
		const w = this.world;
		const e = this.entryPoint(inst);
		this.current = inst;
		w.player.teleport(e.x, e.z, 0);
		w.player.crouching = false;
		if (inst.def.clerk) {
			const c = this.toWorld(inst, inst.def.clerk.x, inst.def.clerk.z);
			const a = w.actors.spawn('clerk', 'civilian', c.x, c.z, Math.PI);
			if (a) {
				a.persistent = true;
				a.brain = new ClerkBrain(c.x, c.z, e.x, e.z);
				this.clerk = a;
			}
		}
		w.bus.emit('interiorChanged', { id: inst.def.id, name: inst.poi.name });
	}

	exit(): void {
		const w = this.world;
		const inst = this.current;
		if (!inst) return;
		this.current = null;
		if (this.clerk) {
			if (this.clerk.active) w.actors.despawn(this.clerk);
			this.clerk = null;
		}
		const poi = inst.poi;
		w.player.teleport(poi.x + Math.sin(poi.facing) * 1.6, poi.z + Math.cos(poi.facing) * 1.6, poi.facing);
		w.bus.emit('interiorChanged', { id: null, name: poi.name });
	}

	/** Leaves the current interior without teleporting (respawn / load handles placement). */
	leaveSilently(): void {
		if (!this.current) return;
		const name = this.current.poi.name;
		this.current = null;
		if (this.clerk?.active) this.world.actors.despawn(this.clerk);
		this.clerk = null;
		this.world.bus.emit('interiorChanged', { id: null, name });
	}

	/** True when the given world position is inside any interior volume. */
	isInterior(x: number, z: number): boolean {
		return x > WORLD.interiorOrigin.x - 100 && z > WORLD.interiorOrigin.z - 100;
	}
}
