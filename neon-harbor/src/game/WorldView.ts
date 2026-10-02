// Presentation of the simulation: owns every Three.js renderer and syncs them with World state
// each frame (humanoids, vehicles, effects, signals, helicopter, mission markers, interiors).

import * as THREE from 'three';
import { SIM } from '../data/config';
import { CityRenderer } from '../render/CityRenderer';
import { Effects } from '../render/Effects';
import type { Graphics } from '../render/Graphics';
import { HeliRenderer } from '../render/HeliRenderer';
import { HumanoidRenderer, defaultPose, type HumanoidPose } from '../render/HumanoidRenderer';
import { InteriorRenderer } from '../render/InteriorRenderer';
import { MarkerRenderer } from '../render/MarkerRenderer';
import { SignalRenderer } from '../render/SignalRenderer';
import { VehicleRenderer } from '../render/VehicleRenderer';
import { Atmosphere } from '../render/Atmosphere';
import { sharedUniforms } from '../render/materials';
import type { MissionMarker } from '../sim/MissionSystem';
import type { World } from '../sim/World';
import type { CameraController } from './CameraController';

export class WorldView {
	readonly city: CityRenderer;
	readonly humans: HumanoidRenderer;
	readonly vehicles: VehicleRenderer;
	readonly effects: Effects;
	readonly signals: SignalRenderer;
	readonly heli: HeliRenderer;
	readonly markers: MarkerRenderer;
	readonly interiors: InteriorRenderer;
	readonly atmosphere: Atmosphere;
	readonly markerList: MissionMarker[] = [];
	/** Player feet offset when standing on raised sidewalks. */
	surfaceOffset = 0;
	private readonly playerPose: HumanoidPose = { ...defaultPose(), shirt: 0x1f5a5a, pants: 0x24283a, skin: 0x8d5a3b, hair: 0x111111 };
	private readonly npcPose: HumanoidPose = defaultPose();
	private grenadeMeshes: THREE.Mesh[] = [];
	private readonly grenadeGeo = new THREE.SphereGeometry(0.12, 8, 6);
	private readonly grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2a3a2a });

	constructor(
		private readonly world: World,
		private readonly graphics: Graphics,
		private readonly cam: CameraController,
	) {
		const scene = graphics.scene;
		this.city = new CityRenderer(world.city, scene);
		this.humans = new HumanoidRenderer(scene, SIM.maxRenderedActors + 8);
		this.vehicles = new VehicleRenderer(scene);
		this.effects = new Effects(scene);
		this.signals = new SignalRenderer(scene, world.roads);
		this.heli = new HeliRenderer(scene);
		this.markers = new MarkerRenderer(scene);
		this.interiors = new InteriorRenderer(scene, world.interiors.instances);
		this.atmosphere = new Atmosphere(graphics);
		this.hookEvents();
	}

	private hookEvents(): void {
		const bus = this.world.bus;
		bus.on('explosion', (e) => this.effects.explosion(e.x, e.y, e.z, e.radius));
		bus.on('impact', (e) => {
			this.effects.sparks(e.x, 0.6, e.z, 0, 0.5, 0, Math.min(16, Math.floor(e.speed)));
			if (e.vehicle.driver === 'player' || e.other?.driver === 'player') this.cam.addShake(Math.min(0.8, e.speed * 0.04));
		});
		bus.on('shake', (e) => this.cam.addShake(e.amount));
		bus.on('shot', (e) => {
			const fx = this.effects;
			fx.muzzle(e.fx, e.fy, e.fz, e.tx - e.fx, e.ty - e.fy, e.tz - e.fz);
			if (e.weapon !== 'shotgun' || Math.random() < 0.35) fx.tracer(e.fx, e.fy, e.fz, e.tx, e.ty, e.tz);
			if (e.hit === 'metal') fx.sparks(e.tx, e.ty, e.tz, e.nx, e.ny, e.nz, 5);
			else if (e.hit === 'world' || e.hit === 'flesh') fx.impactPuff(e.tx, e.ty, e.tz, e.hit);
		});
		bus.on('recoil', (e) => {
			this.cam.pitch -= e.amount * (0.6 + Math.random() * 0.6);
			this.cam.yaw += (Math.random() - 0.5) * e.amount * 0.6;
		});
	}

	/** Builds city chunks around a point synchronously (loading / teleports). */
	prewarm(x: number, z: number, radius: number): void {
		this.city.buildAround(x, z, radius);
	}

	update(dt: number, inGame: boolean, simulating: boolean): void {
		const w = this.world;
		const p = w.player;
		const cam = this.graphics.camera;
		const q = this.graphics.quality;
		const wx = w.weather;
		this.atmosphere.update(w.clock.hour, wx.params, wx.lightning, wx.wetness, w.clock.nightFactor, !!w.interiors.current, simulating ? dt : 0);
		const night = sharedUniforms.uNight.value;

		const targetOffset = p.y < 0.05 && !p.swimming && !w.city.isOnRoad(p.x, p.z) ? 0.15 : 0;
		this.surfaceOffset += (targetOffset - this.surfaceOffset) * Math.min(1, dt * 12);

		this.humans.begin();
		if (inGame && p.state !== 'driving') this.addPlayerPose(dt);
		if (inGame) this.addActorPoses();
		this.humans.end();

		this.signals.update(cam.position.x, cam.position.z, w.time, dt);
		const want = w.wanted;
		this.heli.update(w.police.heli, want.seen ? p.px : want.lkpX, want.seen ? p.pz : want.lkpZ, night, dt);
		this.city.update(cam.position.x, cam.position.z, q.drawDistance, q.detailDistance, night, dt);
		this.vehicles.update(w.vehicles.list, p.state === 'driving' ? p.vehicle : null, night, dt, cam.position.x, cam.position.z, Math.min(q.drawDistance, 450));

		w.missions.markers(this.markerList);
		if (!w.missions.active) w.ambient.appendMarkers(this.markerList);
		this.markers.update(inGame ? this.markerList : [], inGame ? w.missions.pickups : [], (x, z) => (w.interiors.isInterior(x, z) || w.city.isOnRoad(x, z) ? 0 : 0.16), dt);

		this.syncGrenades();
		if (simulating) this.vehicleEmitters(dt);
		this.effects.update(simulating ? dt : 0);
	}

	private addPlayerPose(dt: number): void {
		const w = this.world;
		const p = w.player;
		const pose = this.playerPose;
		pose.x = p.x;
		pose.y = p.y + this.surfaceOffset;
		pose.z = p.z;
		pose.heading = p.heading;
		pose.walkPhase = p.animPhase;
		pose.walkAmount = Math.min(1, p.speed / 5) * (p.onGround || p.swimming ? 1 : 0.2);
		pose.crouch += ((p.crouching ? 1 : 0) - pose.crouch) * Math.min(1, dt * 10);
		const wdef = w.combat.inventory.def;
		pose.armed = wdef.pose;
		pose.aim = p.aiming && wdef.kind === 'hitscan' ? 1 : 0;
		pose.punch = p.punchTimer > 0 ? Math.min(1, p.punchTimer / 0.15) : 0;
		pose.handsUp = p.state === 'arrested' ? 1 : 0;
		pose.dead = p.state === 'dead' ? Math.min(1, pose.dead + dt * 2) : 0;
		this.humans.add(pose);
	}

	private addActorPoses(): void {
		const w = this.world;
		const pose = this.npcPose;
		for (const a of w.actors.list) {
			if (!a.active || a.vehicle || a.hidden || a.tier > 1) continue;
			pose.x = a.x;
			pose.z = a.z;
			pose.y = a.y + (w.city.isOnRoad(a.x, a.z) || w.interiors.isInterior(a.x, a.z) ? 0 : 0.15);
			pose.heading = a.heading;
			pose.walkPhase = a.animPhase;
			pose.walkAmount = Math.min(1.25, a.speed / 4);
			pose.crouch = a.crouch;
			pose.aim = a.aiming ? 1 : 0;
			pose.armed = a.weapon ? (a.weapon === 'pistol' ? 1 : 2) : 0;
			pose.punch = a.punch;
			pose.phone = a.phone;
			pose.handsUp = a.handsUp;
			pose.dead = a.dead ? Math.min(1, a.deadTime * 2.5) : a.knockdown > 0 ? Math.min(1, a.knockdown / 0.6) : 0;
			pose.shirt = a.shirt;
			pose.pants = a.pants;
			pose.skin = a.skin;
			pose.hair = a.hair;
			pose.hat = a.hat;
			pose.scale = a.scale;
			pose.sleeves = a.sleeves;
			this.humans.add(pose);
		}
	}

	private syncGrenades(): void {
		const list = this.world.combat.grenades;
		while (this.grenadeMeshes.length < list.length) {
			const m = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
			this.graphics.scene.add(m);
			this.grenadeMeshes.push(m);
		}
		this.grenadeMeshes.forEach((m, i) => {
			const g = list[i];
			m.visible = !!g && g.active;
			if (m.visible) m.position.set(g.x, g.y, g.z);
		});
	}

	/** Smoke / fire from damaged and burning vehicles near the camera. */
	private vehicleEmitters(dt: number): void {
		const cam = this.graphics.camera.position;
		for (const v of this.world.vehicles.list) {
			const d2 = (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2;
			if (v.destroyed && !v.sinking) {
				if (v.age % 1 < 0.5 && d2 < 150 * 150) this.effects.vehicleSmoke(v.x, 1.2, v.z, 0, false, dt * 0.5);
				continue;
			}
			if (v.healthFraction > 0.4 || v.sinking || d2 > 200 * 200) continue;
			this.effects.vehicleSmoke(v.x + v.forwardX * v.halfLength * 0.7, v.def.height * 0.7, v.z + v.forwardZ * v.halfLength * 0.7, v.healthFraction, v.burning, dt);
		}
	}
}
