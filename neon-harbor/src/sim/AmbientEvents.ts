// Ambient world events and random encounters that make the city feel alive outside missions:
// gang hangouts in their territory, muggings, broken-down cars, police traffic stops, street
// races and a courier side-job offered by strangers. Events spawn off-camera and clean up
// when the player leaves.

import { headingTo } from '../core/math';
import type { DistrictId } from '../data/districts';
import type { Actor, Faction } from './Actor';
import { ClerkBrain } from './ai/ClerkBrain';
import { CivilianBrain, cornerOf } from './ai/CivilianBrain';
import { CombatBrain } from './ai/CombatBrain';
import { PoliceOfficerBrain } from './ai/PoliceOfficerBrain';
import { TrafficDriver } from './ai/TrafficDriver';
import type { MissionMarker } from './MissionSystem';
import type { Vehicle } from './Vehicle';
import type { World } from './World';

export type AmbientKind = 'gangHangout' | 'mugging' | 'brokenDown' | 'trafficStop' | 'streetRace' | 'courier';

interface AmbientEvent {
	kind: AmbientKind;
	x: number;
	z: number;
	age: number;
	actors: Actor[];
	vehicles: Vehicle[];
	done: boolean;
	// Courier job state.
	stage?: 'offer' | 'deliver';
	dest?: { x: number; z: number; name: string };
	timeLeft?: number;
	reward?: number;
}

const TERRITORY: Partial<Record<DistrictId, Faction>> = { harbor: 'saltline', industrial: 'rustline', downtown: 'velvet', beachfront: 'velvet' };

export class AmbientEvents {
	readonly events: AmbientEvent[] = [];
	private timer = 15;
	enabled = true;

	constructor(private readonly world: World) {
		world.interactions.register((out) => {
			for (const e of this.events) {
				if (e.kind !== 'courier' || e.stage !== 'offer' || e.done) continue;
				const c = e.actors[0];
				if (!c?.alive) continue;
				out.push({ label: `Talk to the stranger: courier job ($${e.reward})`, x: c.x, z: c.z, radius: 2.4, act: () => this.acceptCourier(e) });
			}
		});
		world.bus.on('actorKilled', (k) => {
			for (const e of this.events) {
				if (e.kind === 'mugging' && !e.done && e.actors[0] === k.actor && k.killer === 'player') {
					const victim = e.actors[1];
					const tip = 100 + Math.floor(world.rng.next() * 150);
					if (victim?.alive) {
						world.economy.add(tip, 'Reward');
						world.bus.emit('notify', { text: `The mugging victim thanks you and hands you $${tip}.`, kind: 'good' });
					}
					e.done = true;
				}
			}
		});
	}

	get courierJob(): AmbientEvent | null {
		return this.events.find((e) => e.kind === 'courier' && e.stage === 'deliver' && !e.done) ?? null;
	}

	objectiveText(): string {
		const j = this.courierJob;
		if (!j || !j.dest) return '';
		const t = Math.max(0, j.timeLeft ?? 0);
		return `Courier job: deliver the package to ${j.dest.name}  (${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')})`;
	}

	appendMarkers(out: MissionMarker[]): void {
		for (const e of this.events) {
			if (e.done || e.kind !== 'courier') continue;
			if (e.stage === 'offer' && e.actors[0]?.alive && !this.world.missions.active) out.push({ x: e.actors[0].x, z: e.actors[0].z, kind: 'pickup', label: 'Courier job' });
			if (e.stage === 'deliver' && e.dest) out.push({ x: e.dest.x, z: e.dest.z, kind: 'goto', radius: 6 });
		}
	}

	step(dt: number): void {
		const w = this.world;
		for (const e of this.events) this.updateEvent(e, dt);
		for (let i = this.events.length - 1; i >= 0; i--) {
			const e = this.events[i];
			const far = Math.hypot(e.x - w.player.px, e.z - w.player.pz) > 300 && e.stage !== 'deliver';
			if (e.done || far || e.age > 240) {
				this.cleanup(e);
				this.events.splice(i, 1);
			}
		}
		if (!this.enabled || w.interiors.current) return;
		this.timer -= dt;
		if (this.timer > 0) return;
		this.timer = w.rng.range(18, 40);
		if (this.events.length >= 3) return;
		this.spawnRandom();
	}

	private spawnRandom(): void {
		const w = this.world;
		const d = w.city.districtAt(w.player.px, w.player.pz);
		const night = w.clock.nightFactor;
		const weights: Record<AmbientKind, number> = {
			gangHangout: TERRITORY[d] && (d !== 'downtown' && d !== 'beachfront' ? 1 : night) ? 2 : 0,
			mugging: (night * 2 + 0.4) * (d === 'rural' ? 0.2 : 1),
			brokenDown: 1,
			trafficStop: d === 'rural' || d === 'airport' ? 0.3 : 1.2,
			streetRace: night * 1.5 + 0.2,
			courier: w.missions.active || this.events.some((e) => e.kind === 'courier') ? 0 : 1.4,
		};
		const kind = w.rng.weighted(weights);
		const spot = this.sidewalkSpot(80, 190);
		if (!spot) return;
		switch (kind) {
			case 'gangHangout':
				this.spawnHangout(spot, TERRITORY[d] ?? 'rustline');
				break;
			case 'mugging':
				this.spawnMugging(spot);
				break;
			case 'brokenDown':
				this.spawnBrokenDown();
				break;
			case 'trafficStop':
				this.spawnTrafficStop();
				break;
			case 'streetRace':
				this.spawnRace();
				break;
			case 'courier':
				this.spawnCourier(spot);
				break;
		}
	}

	/** A sidewalk point at a distance band from the player, preferably out of view. */
	private sidewalkSpot(min: number, max: number): { x: number; z: number } | null {
		const w = this.world;
		for (let i = 0; i < 12; i++) {
			const ang = w.rng.range(0, Math.PI * 2);
			const r = w.rng.range(min, max);
			const cell = w.city.cellAt(w.player.px + Math.cos(ang) * r, w.player.pz + Math.sin(ang) * r);
			if (!cell || cell.kind === 'airport') continue;
			const c = cornerOf(cell, w.rng.int(0, 3));
			const v = w.view;
			const vd = Math.hypot(c.x - v.x, c.z - v.z);
			if (i < 8 && vd < 120 && ((c.x - v.x) * v.dirX + (c.z - v.z) * v.dirZ) / vd > 0.5) continue;
			return c;
		}
		return null;
	}

	private add(kind: AmbientKind, x: number, z: number): AmbientEvent {
		const e: AmbientEvent = { kind, x, z, age: 0, actors: [], vehicles: [], done: false };
		this.events.push(e);
		return e;
	}

	private spawnHangout(at: { x: number; z: number }, faction: Faction): void {
		const w = this.world;
		const e = this.add('gangHangout', at.x, at.z);
		const n = w.rng.int(3, 4);
		for (let i = 0; i < n; i++) {
			const a = w.actors.spawnFighter(faction, at.x + w.rng.range(-3, 3), at.z + w.rng.range(-3, 3), w.rng.chance(0.3) ? 'smg' : 'pistol', { accuracy: 0.35 });
			if (!a) break;
			a.persistent = true;
			a.faceHeading = headingTo(at.x - a.x, at.z - a.z);
			e.actors.push(a);
		}
	}

	private spawnMugging(at: { x: number; z: number }): void {
		const w = this.world;
		const e = this.add('mugging', at.x, at.z);
		const mugger = w.actors.spawnFighter(w.rng.pick(['rustline', 'saltline', 'velvet'] as Faction[]), at.x, at.z, 'pistol', { accuracy: 0.3 });
		const victim = w.actors.spawnCivilian(at.x + 1.6, at.z + 0.6);
		if (!mugger || !victim) {
			e.done = true;
			return;
		}
		mugger.persistent = victim.persistent = true;
		mugger.brain = null; // scripted until disturbed
		victim.brain = new ClerkBrain(victim.x, victim.z, mugger.x, mugger.z);
		(victim.brain as ClerkBrain).react(victim, w, 'aimedAt');
		e.actors.push(mugger, victim);
	}

	private spawnBrokenDown(): void {
		const w = this.world;
		const v = w.traffic.spawnParked();
		if (!v) return;
		const e = this.add('brokenDown', v.x, v.z);
		v.health = v.def.health * 0.3;
		v.persistent = true;
		const door = v.doorPoint(1);
		const driver = w.actors.spawnCivilian(door.x, door.z);
		if (driver) {
			driver.persistent = true;
			driver.brain = new ClerkBrain(door.x, door.z, v.x, v.z);
			driver.phone = 1;
			e.actors.push(driver);
		}
		e.vehicles.push(v);
	}

	private spawnTrafficStop(): void {
		const w = this.world;
		const car = w.traffic.spawnParked();
		if (!car) return;
		const e = this.add('trafficStop', car.x, car.z);
		car.persistent = true;
		e.vehicles.push(car);
		const bx = car.x - car.forwardX * (car.halfLength + 4);
		const bz = car.z - car.forwardZ * (car.halfLength + 4);
		const cop = w.vehicles.spawn('police', bx, bz, car.heading, 'police');
		if (cop) {
			cop.persistent = true;
			cop.sirenOn = true;
			e.vehicles.push(cop);
		}
		const win = car.doorPoint(-1);
		const officer = w.actors.spawn('police', 'police', win.x - car.forwardX, win.z - car.forwardZ);
		if (officer) {
			officer.persistent = true;
			officer.weapon = 'pistol';
			officer.clip = 12;
			officer.accuracy = 0.45;
			officer.brain = new PoliceOfficerBrain(officer, w, null, 'patrol');
			officer.faceHeading = headingTo(car.x - officer.x, car.z - officer.z);
			w.police.footPatrols.push(officer);
			e.actors.push(officer);
		}
	}

	private spawnRace(): void {
		const w = this.world;
		const a = w.traffic.spawnTraffic();
		if (!a || !(a.brain instanceof TrafficDriver)) return;
		const e = this.add('streetRace', a.x, a.z);
		const lane = a.brain.lane;
		const b = w.vehicles.spawn(w.rng.chance(0.5) ? 'sport' : 'muscle', a.x - lane.dx * 10, a.z - lane.dz * 10, a.heading, 'traffic');
		for (const v of [a, b]) {
			if (!v) continue;
			if (!v.driver) w.actors.spawnDriver(v);
			const d = new TrafficDriver(w, lane, 30);
			d.ignoreSignals = true;
			v.brain = d;
			v.persistent = true;
			e.vehicles.push(v);
		}
	}

	private spawnCourier(at: { x: number; z: number }): void {
		const w = this.world;
		const c = w.actors.spawnCivilian(at.x, at.z);
		if (!c) return;
		const e = this.add('courier', at.x, at.z);
		c.persistent = true;
		c.shirt = 0xffd84a;
		c.brain = new ClerkBrain(at.x, at.z, at.x + 5, at.z);
		c.blip = '#ffd84a';
		e.actors.push(c);
		e.stage = 'offer';
		// Destination: a business across town.
		const options = w.city.pois.filter((p) => (p.kind === 'store' || p.kind === 'property' || p.kind === 'mechanic') && Math.hypot(p.x - at.x, p.z - at.z) > 350);
		const dest = options[Math.floor(w.rng.next() * options.length)] ?? w.city.pois[0];
		const dist = Math.hypot(dest.x - at.x, dest.z - at.z);
		e.dest = { x: dest.x + Math.sin(dest.facing) * 4, z: dest.z + Math.cos(dest.facing) * 4, name: dest.name };
		e.reward = Math.round((150 + dist * 0.7) / 10) * 10;
		e.timeLeft = dist / 9 + 60;
	}

	acceptCourier(e: AmbientEvent): void {
		const w = this.world;
		if (w.missions.active) {
			w.bus.emit('notify', { text: 'Finish your current job first.', kind: 'bad', duration: 3 });
			return;
		}
		e.stage = 'deliver';
		const c = e.actors[0];
		if (c) {
			c.blip = null;
			c.brain = new CivilianBrain(c, w);
		}
		w.bus.emit('dialogue', { speaker: 'Stranger', text: `Take this to ${e.dest!.name}. Don't open it, don't be late.`, duration: 3.5 });
		w.bus.emit('sound', { id: 'pickup' });
	}

	private updateEvent(e: AmbientEvent, dt: number): void {
		const w = this.world;
		e.age += dt;
		if (e.kind === 'mugging' && !e.done) {
			const [mugger, victim] = e.actors;
			if (!mugger?.alive || !victim?.alive) {
				e.done = !mugger?.alive || e.age > 10;
				return;
			}
			if (mugger.brain === null) {
				mugger.aiming = true;
				mugger.faceHeading = headingTo(victim.x - mugger.x, victim.z - mugger.z);
				mugger.heading = mugger.faceHeading;
				// Disturbed (shot at / player close and armed) or done after 25 s: run off.
				const p = w.player;
				const near = Math.hypot(p.px - mugger.x, p.pz - mugger.z) < 8;
				if (e.age > 25 || near || mugger.lastDamagedBy) {
					mugger.aiming = false;
					mugger.brain = new CombatBrain(mugger, w, near ? 'attack' : 'flee');
					if (near) mugger.hostile = true;
					victim.brain = new CivilianBrain(victim, w, 'flee');
					victim.handsUp = 0;
					victim.threatX = mugger.x;
					victim.threatZ = mugger.z;
				}
			}
		}
		if (e.kind === 'brokenDown' && e.age > 90 && e.actors[0]?.alive) {
			const d = e.actors[0];
			if (d.brain instanceof ClerkBrain) {
				d.phone = 0;
				d.brain = new CivilianBrain(d, w);
			}
		}
		if (e.kind === 'courier') {
			if (e.stage === 'offer') {
				if (e.age > 150 || !e.actors[0]?.alive) e.done = true;
			} else if (e.stage === 'deliver' && e.dest) {
				e.timeLeft = (e.timeLeft ?? 0) - dt;
				const p = w.player;
				if (Math.hypot(p.px - e.dest.x, p.pz - e.dest.z) < 7) {
					w.economy.add(e.reward ?? 0, 'Courier job');
					w.bus.emit('notify', { text: `Package delivered. +$${e.reward}`, kind: 'good' });
					w.bus.emit('sound', { id: 'success' });
					e.done = true;
				} else if ((e.timeLeft ?? 0) <= 0 || !p.alive) {
					w.bus.emit('notify', { text: 'Courier job failed: too slow.', kind: 'bad' });
					e.done = true;
				}
			}
		}
	}

	private cleanup(e: AmbientEvent): void {
		const w = this.world;
		for (const a of e.actors) {
			if (!a.active) continue;
			a.persistent = false;
			a.blip = null;
			const i = w.police.footPatrols.indexOf(a);
			if (i >= 0) w.police.footPatrols.splice(i, 1);
			if (a.distToPlayer > 120 && !a.vehicle) w.actors.despawn(a);
		}
		for (const v of e.vehicles) {
			if (!w.vehicles.list.includes(v) || v.driver === 'player') continue;
			v.persistent = false;
			v.sirenOn = false;
			if (Math.hypot(v.x - w.player.px, v.z - w.player.pz) > 120) w.vehicles.despawn(v);
		}
	}

	/** Forces an event (debug / tests). */
	debugSpawn(kind: AmbientKind): boolean {
		const before = this.events.length;
		const spot = this.sidewalkSpot(60, 140) ?? { x: this.world.player.px + 40, z: this.world.player.pz };
		if (kind === 'gangHangout') this.spawnHangout(spot, 'rustline');
		else if (kind === 'mugging') this.spawnMugging(spot);
		else if (kind === 'brokenDown') this.spawnBrokenDown();
		else if (kind === 'trafficStop') this.spawnTrafficStop();
		else if (kind === 'streetRace') this.spawnRace();
		else this.spawnCourier(spot);
		return this.events.length > before;
	}

	reset(): void {
		for (const e of this.events) this.cleanup(e);
		this.events.length = 0;
	}
}
