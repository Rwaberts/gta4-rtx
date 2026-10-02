// Mission runner: interprets declarative MissionDefs (data/missions.ts). Each objective type
// has a handler (start / update / marker). Handles setup actions, dialogue, fail conditions,
// time limits, checkpoints with retry, rewards and cleanup of everything it spawned.

import { WEAPONS } from '../data/weapons';
import { MISSIONS, missionDef, type ActionDef, type DialogueLine, type FailDef, type MissionDef, type ObjectiveDef, type TargetDef } from '../data/missions';
import { Actor } from './Actor';
import { CivilianBrain } from './ai/CivilianBrain';
import { ClerkBrain } from './ai/ClerkBrain';
import { CombatBrain } from './ai/CombatBrain';
import { FleeBrain } from './ai/FleeBrain';
import { armActor } from './ai/tactics';
import { Vehicle } from './Vehicle';
import type { World } from './World';

export interface Pickup {
	ref: string;
	x: number;
	z: number;
	label: string;
	color: number;
	active: boolean;
}

export type MarkerKind = 'goto' | 'vehicle' | 'enemy' | 'ally' | 'pickup' | 'contact';

export interface MissionMarker {
	x: number;
	z: number;
	kind: MarkerKind;
	label?: string;
	radius?: number;
}

type RefValue = Vehicle | Actor | Actor[] | Pickup;

interface Running {
	def: MissionDef;
	index: number;
	objTime: number;
	refs: Map<string, RefValue>;
	progress: number;
	farTime: number;
	checkpoint: number;
	chaseDone: boolean;
}

interface Handler {
	start?(m: Running, o: ObjectiveDef): void;
	update(m: Running, o: ObjectiveDef, dt: number): boolean;
	markers(m: Running, o: ObjectiveDef, out: MissionMarker[]): void;
}

export class MissionSystem {
	readonly completed = new Set<string>();
	readonly pickups: Pickup[] = [];
	active: Running | null = null;
	lastFailed: { id: string; checkpoint: number; reason: string } | null = null;
	private handlers: Record<ObjectiveDef['type'], Handler>;

	constructor(private readonly world: World) {
		this.handlers = this.buildHandlers();
		const bus = world.bus;
		bus.on('playerDied', () => this.active && this.fail('You were taken out.'));
		bus.on('playerArrested', () => this.active && this.fail('You were arrested.'));
		world.interactions.register((out) => {
			if (this.active || world.wanted.level > 0 || world.interiors.current) return;
			for (const def of this.available()) {
				const poi = world.city.poi(def.contact);
				if (!poi) continue;
				out.push({ label: `Start mission: "${def.title}" (${def.contactName})`, x: poi.x, z: poi.z, radius: 2.6, act: () => this.start(def.id) });
			}
		});
	}

	get title(): string {
		return this.active?.def.title ?? '';
	}

	available(): MissionDef[] {
		return MISSIONS.filter((m) => !this.completed.has(m.id) && m.requires.every((r) => this.completed.has(r)));
	}

	allowsInterior(id: string): boolean {
		return this.active?.def.allowInterior === id;
	}

	/** Objective progress 0..1 for objectives that have one (hold). */
	get progress(): number {
		return this.active?.progress ?? 0;
	}

	// ------------------------------------------------------------------ lifecycle

	start(id: string, fromCheckpoint = 0): boolean {
		const def = missionDef(id);
		if (!def || this.active) return false;
		const w = this.world;
		this.lastFailed = null;
		const m: Running = { def, index: fromCheckpoint, objTime: 0, refs: new Map(), progress: 0, farTime: 0, checkpoint: 0, chaseDone: false };
		this.active = m;
		if (fromCheckpoint === 0) {
			w.bus.emit('missionStarted', { id: def.id, title: def.title });
			this.say(def.intro);
		} else {
			const cp = def.objectives[fromCheckpoint].checkpoint!;
			w.wanted.clear(true);
			for (const a of cp.actions ?? []) this.run(m, a);
			const t = this.resolve(m, cp.player);
			if (cp.inVehicle) {
				const v = m.refs.get(cp.inVehicle);
				if (v instanceof Vehicle) {
					w.player.teleport(v.x, v.z, v.heading);
					v.driver = 'player';
					v.role = 'mission';
					w.player.state = 'driving';
					w.player.vehicle = v;
				}
			} else if (t) w.player.teleport(t.x, t.z, cp.heading ?? w.player.heading);
			w.bus.emit('missionStarted', { id: def.id, title: def.title + ' (checkpoint)' });
			m.checkpoint = fromCheckpoint;
		}
		this.beginObjective(m);
		return true;
	}

	private beginObjective(m: Running): void {
		const o = m.def.objectives[m.index];
		m.objTime = 0;
		m.progress = 0;
		m.farTime = 0;
		m.chaseDone = false;
		if (o.checkpoint && m.index > 0) m.checkpoint = m.index;
		for (const a of o.setup ?? []) this.run(m, a);
		this.handlers[o.type].start?.(m, o);
		this.world.bus.emit('objective', { text: o.text });
	}

	retry(): boolean {
		const f = this.lastFailed;
		if (!f || this.active) return false;
		return this.start(f.id, f.checkpoint);
	}

	/** Clears all progress (new game / load). */
	reset(): void {
		if (this.active) {
			this.cleanup(this.active, true);
			this.active = null;
		}
		this.lastFailed = null;
		this.completed.clear();
		this.pickups.length = 0;
		this.world.bus.emit('objective', { text: '' });
	}

	abandon(): void {
		if (!this.active) return;
		this.fail('Mission abandoned.');
		this.lastFailed = null;
	}

	fail(reason: string): void {
		const m = this.active;
		if (!m) return;
		this.cleanup(m, true);
		this.active = null;
		this.lastFailed = { id: m.def.id, checkpoint: m.checkpoint, reason };
		this.world.bus.emit('missionFailed', { id: m.def.id, title: m.def.title, reason });
		this.world.bus.emit('objective', { text: '' });
	}

	private complete(m: Running): void {
		const w = this.world;
		this.cleanup(m, false);
		this.active = null;
		this.completed.add(m.def.id);
		w.economy.add(m.def.reward, `Mission: ${m.def.title}`);
		if (m.def.unlockProperty) w.economy.properties.add(m.def.unlockProperty);
		this.say(m.def.outro);
		w.bus.emit('missionCompleted', { id: m.def.id, title: m.def.title, reward: m.def.reward });
		w.bus.emit('objective', { text: '' });
	}

	/** Releases or removes everything the mission spawned. */
	private cleanup(m: Running, failed: boolean): void {
		const w = this.world;
		for (const [, v] of m.refs) {
			const list = Array.isArray(v) ? v : [v];
			for (const e of list) {
				if (e instanceof Actor) {
					if (!e.active) continue;
					e.blip = null;
					e.persistent = false;
					if (e.dead) continue;
					if (failed) w.actors.despawn(e);
					else if (e.brain instanceof CombatBrain && e.faction === 'crew') {
						// Allies go about their business.
						e.weapon = null;
						e.aiming = false;
						e.brain = new CivilianBrain(e, w);
					}
				} else if (e instanceof Vehicle) {
					if (!w.vehicles.list.includes(e)) continue;
					e.persistent = false;
					if (e.driver === 'player') e.role = 'abandoned';
					else if (failed) w.vehicles.despawn(e);
					else e.role = 'abandoned';
				} else {
					e.active = false;
				}
			}
		}
		this.pickups.splice(0, this.pickups.length, ...this.pickups.filter((p) => p.active));
	}

	// --------------------------------------------------------------------- update

	update(dt: number): void {
		const m = this.active;
		if (!m) return;
		m.objTime += dt;
		const o = m.def.objectives[m.index];
		const reason = this.checkFail(m, o, dt);
		if (reason) {
			this.fail(reason);
			return;
		}
		if (this.handlers[o.type].update(m, o, dt)) {
			for (const a of o.after ?? []) this.run(m, a);
			m.index++;
			if (m.index >= m.def.objectives.length) this.complete(m);
			else this.beginObjective(m);
		}
	}

	private checkFail(m: Running, o: ObjectiveDef, dt: number): string | null {
		if (o.timeLimit && m.objTime > o.timeLimit) return 'You ran out of time.';
		const checks: FailDef[] = [...(m.def.failIf ?? []), ...(o.failIf ?? [])];
		for (const f of checks) {
			const e = m.refs.get(f.ref);
			if (f.if === 'dead' && e instanceof Actor && (e.dead || !e.active)) return f.reason;
			if (f.if === 'destroyed' && e instanceof Vehicle && (e.destroyed || !this.world.vehicles.list.includes(e))) return f.reason;
			if (f.if === 'far' && e instanceof Vehicle) {
				const p = this.world.player;
				if (Math.hypot(e.x - p.px, e.z - p.pz) > f.distance) {
					m.farTime += dt;
					if (m.farTime > f.seconds) return f.reason;
				} else m.farTime = 0;
			}
		}
		return null;
	}

	/** Current objective text with context hints. */
	objectiveText(): string {
		const m = this.active;
		if (!m) return '';
		const o = m.def.objectives[m.index];
		const w = this.world;
		if (o.type === 'goto' && o.requireNoWanted && w.wanted.level > 0) return 'Lose the police first.';
		if (o.type === 'goto' && o.vehicle) {
			const v = m.refs.get(o.vehicle);
			if (v instanceof Vehicle && w.player.vehicle !== v) return 'Get back in the vehicle.';
		}
		if (o.type === 'goto' && o.withAlly) {
			const a = m.refs.get(o.withAlly);
			if (a instanceof Actor && Math.hypot(a.x - w.player.px, a.z - w.player.pz) > 12) return `Wait for ${a.tag || 'your partner'} to catch up.`;
		}
		if (o.timeLimit) {
			const left = Math.max(0, o.timeLimit - m.objTime);
			return `${o.text}  (${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')})`;
		}
		return o.text;
	}

	/** Markers for the HUD, minimap and 3D beacons. */
	markers(out: MissionMarker[]): MissionMarker[] {
		out.length = 0;
		const m = this.active;
		const w = this.world;
		if (!m) {
			if (w.wanted.level === 0) {
				for (const def of this.available()) {
					const poi = w.city.poi(def.contact);
					if (poi) out.push({ x: poi.x, z: poi.z, kind: 'contact', label: def.title });
				}
			}
			return out;
		}
		const o = m.def.objectives[m.index];
		this.handlers[o.type].markers(m, o, out);
		for (const [, v] of m.refs) {
			if (v instanceof Actor && v.alive && v.faction === 'crew') out.push({ x: v.x, z: v.z, kind: 'ally' });
		}
		return out;
	}

	// ---------------------------------------------------------------- resolution

	resolve(m: Running | null, t: TargetDef): { x: number; z: number; heading?: number } | null {
		const w = this.world;
		if ('poi' in t) {
			const p = w.city.poi(t.poi);
			if (!p) return null;
			const fx = Math.sin(p.facing);
			const fz = Math.cos(p.facing);
			const rx = -Math.cos(p.facing);
			const rz = Math.sin(p.facing);
			return { x: p.x + fx * (t.fwd ?? 0) + rx * (t.side ?? 0), z: p.z + fz * (t.fwd ?? 0) + rz * (t.side ?? 0), heading: p.facing };
		}
		if ('lane' in t) {
			const hit = w.roads.nearestLane(t.lane[0], t.lane[1]);
			if (!hit) return null;
			const L = hit.lane;
			const s = Math.max(2, Math.min(L.len - 2, hit.s + (t.ahead ?? 0)));
			return { x: L.sx + L.dx * s, z: L.sz + L.dz * s, heading: Math.atan2(L.dx, L.dz) };
		}
		if ('pier' in t) {
			const p = w.city.piers[t.pier];
			if (!p) return null;
			return { x: p.minX + (p.maxX - p.minX) * t.along, z: (p.minZ + p.maxZ) / 2 + (t.side ?? 0), heading: Math.PI / 2 };
		}
		if ('interior' in t) {
			const inst = w.interiors.instanceFor(t.interior);
			if (!inst) return null;
			if (t.at === 'counter' && inst.def.counter) return w.interiors.toWorld(inst, inst.def.counter.x, inst.def.counter.z);
			return t.at === 'exit' ? w.interiors.exitPoint(inst) : w.interiors.entryPoint(inst);
		}
		const e = m?.refs.get(t.ref);
		if (!e) return null;
		const ent = Array.isArray(e) ? e[0] : e;
		if (!ent) return null;
		if (ent instanceof Vehicle) {
			const side = t.side ?? 0;
			return { x: ent.x - Math.cos(ent.heading) * side, z: ent.z + Math.sin(ent.heading) * side, heading: ent.heading };
		}
		return { x: ent.x, z: ent.z };
	}

	// ------------------------------------------------------------------- actions

	private run(m: Running, a: ActionDef): void {
		const w = this.world;
		switch (a.do) {
			case 'spawnVehicle': {
				const t = this.resolve(m, a.at);
				if (!t) return;
				const old = m.refs.get(a.ref);
				if (old instanceof Vehicle && w.vehicles.list.includes(old) && old.driver !== 'player') w.vehicles.despawn(old);
				// Clear the spot of parked traffic.
				w.vehicles.hash.query(t.x, t.z, 7, (o) => {
					if (!o.persistent && o.driver !== 'player') w.vehicles.despawn(o);
				});
				const heading = a.heading === 'lane' ? t.heading ?? 0 : a.heading ?? t.heading ?? 0;
				const v = w.vehicles.spawn(a.model, t.x, t.z, heading, 'mission', a.color);
				if (!v) return;
				v.persistent = true;
				v.tag = 'mission:' + a.ref;
				m.refs.set(a.ref, v);
				return;
			}
			case 'spawnDriver': {
				const v = m.refs.get(a.ref);
				if (!(v instanceof Vehicle)) return;
				const d = w.actors.spawnDriver(v, 'mission', a.faction ?? 'civilian');
				if (d) d.persistent = true;
				return;
			}
			case 'flee': {
				const v = m.refs.get(a.ref);
				if (v instanceof Vehicle) v.brain = new FleeBrain(w, v);
				return;
			}
			case 'spawnGroup': {
				const t = this.resolve(m, a.at);
				if (!t) return;
				const list: Actor[] = [];
				for (let i = 0; i < a.count + (a.leader ? 1 : 0); i++) {
					const ang = (i / Math.max(1, a.count)) * Math.PI * 2 + w.rng.range(-0.3, 0.3);
					const r = i === 0 ? 0 : (a.spread ?? 4) * w.rng.range(0.4, 1);
					const pos = { x: t.x + Math.cos(ang) * r, z: t.z + Math.sin(ang) * r };
					w.collision.resolveCircle(pos, 0.5, 0, 1.8);
					if (!w.city.isLand(pos.x, pos.z)) {
						pos.x = t.x;
						pos.z = t.z;
					}
					const isLeader = !!a.leader && i === a.count;
					const actor = w.actors.spawnFighter(a.faction, pos.x, pos.z, isLeader ? a.leader!.weapon : a.weapon, {
						hostile: a.hostile,
						accuracy: a.accuracy,
						health: isLeader ? a.leader!.health : a.health,
						heading: w.rng.range(-Math.PI, Math.PI),
					});
					if (!actor) continue;
					actor.persistent = true;
					actor.role = 'mission';
					actor.blip = a.hostile ? '#ff4a5a' : '#ffa53a';
					if (isLeader) actor.scale = 1.15;
					list.push(actor);
				}
				m.refs.set(a.ref, list);
				return;
			}
			case 'spawnAlly': {
				const t = this.resolve(m, a.at);
				if (!t) return;
				const old = m.refs.get(a.ref);
				if (old instanceof Actor && old.active) w.actors.despawn(old);
				const actor = w.actors.spawn('mission', 'crew', t.x, t.z);
				if (!actor) return;
				actor.persistent = true;
				actor.tag = a.name ?? 'Ally';
				if (a.weapon) armActor(actor, a.weapon, 0.55);
				if (a.health) actor.health = actor.maxHealth = a.health;
				if (a.shirt !== undefined) actor.shirt = a.shirt;
				if (a.hair !== undefined) actor.hair = a.hair;
				actor.blip = '#39f0d0';
				actor.brain = new CombatBrain(actor, w, 'follow');
				m.refs.set(a.ref, actor);
				return;
			}
			case 'spawnPickup': {
				const t = this.resolve(m, a.at);
				if (!t) return;
				const p: Pickup = { ref: a.ref, x: t.x, z: t.z, label: a.label, color: a.color ?? 0xffd84a, active: true };
				this.pickups.push(p);
				m.refs.set(a.ref, p);
				return;
			}
			case 'setWanted':
				w.wanted.setLevel(a.level);
				return;
			case 'give':
				w.combat.inventory.give(a.weapon, a.ammo);
				if (w.combat.inventory.current === 'fists') w.combat.inventory.select(a.weapon);
				w.bus.emit('notify', { text: `Received ${WEAPONS[a.weapon].name} (+${a.ammo})`, kind: 'good' });
				return;
			case 'notify':
				w.bus.emit('notify', { text: a.text, kind: 'mission' });
				return;
			case 'say':
				this.say(a.lines);
				return;
			case 'remove': {
				const e = m.refs.get(a.ref);
				if (e instanceof Actor && e.active) w.actors.despawn(e);
				else if (e instanceof Vehicle && e.driver !== 'player') w.vehicles.despawn(e);
				m.refs.delete(a.ref);
				return;
			}
		}
	}

	private say(lines: DialogueLine[]): void {
		for (const l of lines) this.world.bus.emit('dialogue', { speaker: l.who, text: l.text, duration: l.time ?? Math.max(2.5, l.text.length * 0.065) });
	}

	// ------------------------------------------------------------------ handlers

	private buildHandlers(): Record<ObjectiveDef['type'], Handler> {
		const w = this.world;
		const near = (x: number, z: number, r: number) => Math.hypot(w.player.px - x, w.player.pz - z) <= r;
		const group = (m: Running, ref: string): Actor[] => {
			const g = m.refs.get(ref);
			return Array.isArray(g) ? g : [];
		};
		const enemyMarkers = (m: Running, ref: string, out: MissionMarker[]) => {
			for (const a of group(m, ref)) if (a.alive) out.push({ x: a.x, z: a.z, kind: 'enemy' });
		};
		return {
			goto: {
				update: (m, o) => {
					if (o.type !== 'goto') return false;
					const t = this.resolve(m, o.target);
					if (!t || !near(t.x, t.z, o.radius ?? 5)) return false;
					if (o.requireNoWanted && w.wanted.level > 0) return false;
					if (o.onFoot && w.player.state !== 'onFoot') return false;
					if (o.vehicle) {
						const v = m.refs.get(o.vehicle);
						if (!(v instanceof Vehicle) || w.player.vehicle !== v || w.player.state !== 'driving') return false;
					}
					if (o.withAlly) {
						const a = m.refs.get(o.withAlly);
						if (!(a instanceof Actor) || Math.hypot(a.x - w.player.px, a.z - w.player.pz) > 12) return false;
					}
					return true;
				},
				markers: (m, o, out) => {
					if (o.type !== 'goto') return;
					if (o.vehicle) {
						const v = m.refs.get(o.vehicle);
						if (v instanceof Vehicle && w.player.vehicle !== v) {
							out.push({ x: v.x, z: v.z, kind: 'vehicle' });
							return;
						}
					}
					const t = this.resolve(m, o.target);
					if (t) out.push({ x: t.x, z: t.z, kind: 'goto', radius: o.radius ?? 5 });
				},
			},
			enterVehicle: {
				update: (m, o) => o.type === 'enterVehicle' && w.player.state === 'driving' && w.player.vehicle === m.refs.get(o.vehicle),
				markers: (m, o, out) => {
					if (o.type !== 'enterVehicle') return;
					const v = m.refs.get(o.vehicle);
					if (v instanceof Vehicle) out.push({ x: v.x, z: v.z, kind: 'vehicle' });
				},
			},
			eliminate: {
				update: (m, o) => o.type === 'eliminate' && group(m, o.group).every((a) => !a.alive),
				markers: (m, o, out) => {
					if (o.type === 'eliminate') enemyMarkers(m, o.group, out);
				},
			},
			protect: {
				update: (m, o) => o.type === 'protect' && group(m, o.group).every((a) => !a.alive),
				markers: (m, o, out) => {
					if (o.type === 'protect') enemyMarkers(m, o.group, out);
				},
			},
			chase: {
				update: (m, o) => {
					if (o.type !== 'chase') return false;
					const v = m.refs.get(o.vehicle);
					if (!(v instanceof Vehicle)) return true;
					if (v.destroyed) return true;
					if (v.healthFraction < 0.35 || (v.speed < 1 && near(v.x, v.z, 12) && m.objTime > 5)) {
						// Disabled: the driver bails out and runs.
						if (v.driver && v.driver !== 'player') w.actors.ejectDriver(v, false);
						v.brain = null;
						return true;
					}
					return false;
				},
				markers: (m, o, out) => {
					if (o.type !== 'chase') return;
					const v = m.refs.get(o.vehicle);
					if (v instanceof Vehicle) out.push({ x: v.x, z: v.z, kind: 'enemy' });
				},
			},
			collect: {
				update: (m, o) => {
					if (o.type !== 'collect') return false;
					const p = m.refs.get(o.pickup) as Pickup | undefined;
					if (!p || !p.active) return true;
					const r = w.player.state === 'driving' ? 4 : 1.8;
					if (near(p.x, p.z, r)) {
						p.active = false;
						w.bus.emit('notify', { text: `Picked up: ${p.label}`, kind: 'good', duration: 2.5 });
						w.bus.emit('sound', { id: 'pickup' });
						return true;
					}
					return false;
				},
				markers: (m, o, out) => {
					if (o.type !== 'collect') return;
					const p = m.refs.get(o.pickup) as Pickup | undefined;
					if (p && p.active) out.push({ x: p.x, z: p.z, kind: 'pickup', label: p.label });
				},
			},
			loseWanted: {
				update: () => w.wanted.level === 0,
				markers: () => {},
			},
			hold: {
				update: (m, o, dt) => {
					if (o.type !== 'hold') return false;
					const t = this.resolve(m, o.target);
					const inRange = !!t && near(t.x, t.z, o.radius);
					let ok = inRange;
					if (ok && o.intimidate) {
						const clerk = w.interiors.clerk;
						ok = !!clerk && clerk.brain instanceof ClerkBrain && clerk.brain.threatened && w.controls.aim;
					}
					m.progress = Math.max(0, Math.min(1, m.progress + (ok ? dt / o.seconds : -dt * 0.25)));
					return m.progress >= 1;
				},
				markers: (m, o, out) => {
					if (o.type !== 'hold') return;
					const t = this.resolve(m, o.target);
					if (t) out.push({ x: t.x, z: t.z, kind: 'goto', radius: o.radius });
				},
			},
			wait: {
				update: (m, o) => o.type === 'wait' && m.objTime >= o.seconds,
				markers: () => {},
			},
			enterInterior: {
				update: (_m, o) => o.type === 'enterInterior' && w.interiors.current?.poi.id === o.poi,
				markers: (_m, o, out) => {
					if (o.type !== 'enterInterior') return;
					const poi = w.city.poi(o.poi);
					if (poi) out.push({ x: poi.x, z: poi.z, kind: 'goto', radius: 2 });
				},
			},
			exitInterior: {
				update: () => w.interiors.current === null,
				markers: (_m, _o, out) => {
					const cur = w.interiors.current;
					if (cur) {
						const e = w.interiors.exitPoint(cur);
						out.push({ x: e.x, z: e.z, kind: 'goto', radius: 1.5 });
					}
				},
			},
		};
	}

	serialize(): { completed: string[] } {
		return { completed: [...this.completed] };
	}
}
