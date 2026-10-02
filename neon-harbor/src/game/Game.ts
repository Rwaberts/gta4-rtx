// Composition root: wires simulation (World), rendering, input, camera and UI, and runs the loop.

import { SIM } from '../data/config';
import { Input } from '../core/Input';
import { World } from '../sim/World';
import { Graphics, QUALITY_PRESETS } from '../render/Graphics';
import { CityRenderer } from '../render/CityRenderer';
import { HumanoidRenderer, defaultPose, type HumanoidPose } from '../render/HumanoidRenderer';
import { sharedUniforms } from '../render/materials';
import { VehicleRenderer } from '../render/VehicleRenderer';
import { Effects } from '../render/Effects';
import { SignalRenderer } from '../render/SignalRenderer';
import { CameraController, type CameraTarget } from './CameraController';
import { Hud } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { button, el } from '../ui/dom';

export type GameState = 'menu' | 'playing' | 'paused';

export class Game {
	readonly world: World;
	readonly graphics: Graphics;
	readonly input = new Input();
	readonly city: CityRenderer;
	readonly humans: HumanoidRenderer;
	readonly cam: CameraController;
	readonly vehicleViews: VehicleRenderer;
	readonly effects: Effects;
	readonly signals: SignalRenderer;
	private readonly npcPose: HumanoidPose = defaultPose();
	readonly hud: Hud;
	readonly menus: Menus;
	state: GameState = 'menu';
	private last = performance.now();
	private fpsTime = 0;
	private fpsFrames = 0;
	fps = 0;
	private simMs = 0;
	private readonly playerPose: HumanoidPose = {
		...defaultPose(),
		shirt: 0x1f5a5a,
		pants: 0x24283a,
		skin: 0x8d5a3b,
		hair: 0x111111,
	};
	private surfaceOffset = 0;
	private readonly camTarget: CameraTarget = { x: 0, y: 0, z: 0, heading: 0, speed: 0, size: 4, aiming: false, crouching: false, lookBehind: false };
	private wasLocked = false;

	constructor(container: HTMLElement) {
		const viewport = container.querySelector('#viewport') as HTMLElement;
		const ui = container.querySelector('#ui') as HTMLElement;
		this.world = new World();
		this.graphics = new Graphics(viewport, QUALITY_PRESETS.medium);
		this.city = new CityRenderer(this.world.city, this.graphics.scene);
		this.humans = new HumanoidRenderer(this.graphics.scene, SIM.maxRenderedActors + 8);
		this.cam = new CameraController(this.graphics.camera, this.world.collision);
		this.vehicleViews = new VehicleRenderer(this.graphics.scene);
		this.effects = new Effects(this.graphics.scene);
		this.signals = new SignalRenderer(this.graphics.scene, this.world.roads);
		this.hookEffects();
		this.input.attach(this.graphics.renderer.domElement);
		this.hud = new Hud(ui, this.world);
		this.menus = new Menus(ui, {
			newGame: () => this.newGame(),
			resume: () => this.resume(),
			quitToMenu: () => this.quitToMenu(),
			hasSave: () => false,
			continueGame: () => this.newGame(),
			openSettings: (back) => this.placeholderPanel('Settings', back),
			openSaveLoad: (mode, back) => this.placeholderPanel(mode === 'save' ? 'Save Game' : 'Load Game', back),
			openMap: (back) => this.placeholderPanel('City Map', back),
		});

		this.graphics.renderer.domElement.addEventListener('click', () => {
			if (this.state === 'playing') this.input.requestPointerLock();
		});
		document.addEventListener('pointerlockchange', () => {
			const locked = document.pointerLockElement === this.graphics.renderer.domElement;
			// Browsers release pointer lock on Escape; treat that as a pause request.
			if (this.wasLocked && !locked && this.state === 'playing') this.pause();
			this.wasLocked = locked;
		});

		const p = this.world.player;
		this.city.buildAround(p.x, p.z, 500);
		this.spawnStarterVehicles();
	}

	/** Player-owned car parked outside the safehouse, plus a couple of street cars nearby. */
	private spawnStarterVehicles(): void {
		const w = this.world;
		const home = w.city.poi('safehouse')!;
		const fx = Math.sin(home.facing);
		const fz = Math.cos(home.facing);
		const along = { x: Math.cos(home.facing), z: -Math.sin(home.facing) };
		const heading = home.facing - Math.PI / 2;
		const own = w.vehicles.spawn('coupe', home.x + fx * 3.8 + along.x * 6, home.z + fz * 3.8 + along.z * 6, heading, 'owned', 0x2ac8e8);
		if (own) own.persistent = true;
		w.vehicles.spawn('pickup', home.x + fx * 3.8 - along.x * 8, home.z + fz * 3.8 - along.z * 8, heading, 'parked');
	}

	private hookEffects(): void {
		const bus = this.world.bus;
		bus.on('explosion', (e) => this.effects.explosion(e.x, e.y, e.z, e.radius));
		bus.on('impact', (e) => {
			this.effects.sparks(e.x, 0.6, e.z, 0, 0.5, 0, Math.min(16, Math.floor(e.speed)));
			if (e.vehicle.driver === 'player' || e.other?.driver === 'player') this.cam.addShake(Math.min(0.8, e.speed * 0.04));
		});
		bus.on('shake', (e) => this.cam.addShake(e.amount));
	}

	start(): void {
		const loading = document.getElementById('loading');
		loading?.classList.add('done');
		this.state = 'menu';
		this.cam.setMode('cinematic');
		this.menus.showMain();
		requestAnimationFrame(this.frame);
	}

	newGame(): void {
		this.menus.close();
		this.hud.show(true);
		this.state = 'playing';
		const p = this.world.player;
		this.cam.setMode('foot');
		this.fillCamTarget();
		this.cam.snapTo(this.camTarget);
		this.input.requestPointerLock();
		this.world.bus.emit('notify', { text: 'Welcome to Neon Harbor. Click to capture the mouse, WASD to move.', kind: 'info', duration: 6 });
		void p;
	}

	pause(): void {
		if (this.state !== 'playing') return;
		this.state = 'paused';
		this.input.exitPointerLock();
		this.menus.showPause();
	}

	resume(): void {
		this.menus.close();
		this.state = 'playing';
		this.input.requestPointerLock();
	}

	quitToMenu(): void {
		this.state = 'menu';
		this.hud.show(false);
		this.cam.setMode('cinematic');
		this.menus.showMain();
	}

	private placeholderPanel(title: string, back: () => void): HTMLElement {
		return el('div', { class: 'menu-panel' }, el('div', { class: 'menu-title', text: title }), el('p', { text: 'Coming soon.' }), button('Back', back));
	}

	private handleGlobalInput(): void {
		const inp = this.input;
		if (inp.wasPressed('pause')) {
			if (this.state === 'playing') this.pause();
			else if (this.state === 'paused') this.resume();
		}
		if (inp.wasPressed('debug')) this.hud.toggleDebug();
	}

	private gatherControls(): void {
		const inp = this.input;
		const c = this.world.controls;
		c.moveX = inp.axis('left', 'right');
		c.moveZ = inp.axis('back', 'forward');
		c.camYaw = this.cam.yaw;
		c.camPitch = this.cam.pitch;
		c.sprint = inp.isDown('sprint');
		c.walk = inp.isDown('walk');
		c.aim = inp.isDown('aim');
		c.fire = inp.isDown('fire');
		c.throttle = inp.isDown('forward') ? 1 : 0;
		c.brake = inp.isDown('back') ? 1 : 0;
		c.steer = inp.axis('left', 'right');
		c.handbrake = inp.isDown('handbrake');
		c.horn = inp.isDown('horn');
		c.jumpPressed ||= inp.wasPressed('jump');
		c.crouchPressed ||= inp.wasPressed('crouch');
		c.firePressed ||= inp.wasPressed('fire');
		c.reloadPressed ||= inp.wasPressed('reload');
		c.interactPressed ||= inp.wasPressed('interact');
		c.enterExitPressed ||= inp.wasPressed('enterVehicle');
		c.weaponDelta += (inp.wasPressed('nextWeapon') ? 1 : 0) - (inp.wasPressed('prevWeapon') ? 1 : 0);
		const slots = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'] as const;
		slots.forEach((s, i) => {
			if (inp.wasPressed(s)) c.weaponSlot = i;
		});
	}

	private fillCamTarget(): void {
		const p = this.world.player;
		const t = this.camTarget;
		const v = p.state === 'driving' ? p.vehicle : null;
		if (v) {
			t.x = v.x;
			t.y = v.y;
			t.z = v.z;
			t.heading = v.heading;
			t.speed = Math.abs(v.forwardSpeed);
			t.size = v.def.length;
			t.aiming = false;
			t.crouching = false;
		} else {
			t.x = p.x;
			t.y = p.y + this.surfaceOffset;
			t.z = p.z;
			t.heading = p.heading;
			t.speed = p.speed;
			t.size = 4;
			t.aiming = p.aiming;
			t.crouching = p.crouching;
		}
		t.lookBehind = this.input.isDown('lookBehind');
	}

	private frame = (now: number): void => {
		requestAnimationFrame(this.frame);
		let dt = (now - this.last) / 1000;
		this.last = now;
		if (dt > 0.1) dt = 0.1;
		if (dt <= 0) dt = 1 / 60;
		this.fpsTime += dt;
		this.fpsFrames++;
		if (this.fpsTime >= 0.5) {
			this.fps = this.fpsFrames / this.fpsTime;
			this.fpsTime = 0;
			this.fpsFrames = 0;
		}
		this.handleGlobalInput();

		if (this.state === 'playing') {
			this.gatherControls();
			const t0 = performance.now();
			const steps = Math.min(SIM.maxSubSteps + 1, Math.max(1, Math.ceil(dt / SIM.fixedDt - 0.01)));
			const h = dt / steps;
			for (let i = 0; i < steps; i++) this.world.step(h);
			this.simMs = performance.now() - t0;
		}

		this.updateView(dt);
		this.input.endFrame();
	};

	/** Advances the simulation without rendering (used by automated tests). */
	simulate(seconds: number): void {
		const steps = Math.round(seconds / SIM.fixedDt);
		for (let i = 0; i < steps; i++) this.world.step(SIM.fixedDt);
	}

	private updateView(dt: number): void {
		const w = this.world;
		const p = w.player;
		sharedUniforms.uTime.value += dt;

		// Actors stand on raised sidewalks visually.
		const targetOffset = p.y < 0.05 && !p.swimming && !w.city.isOnRoad(p.x, p.z) ? 0.15 : 0;
		this.surfaceOffset += (targetOffset - this.surfaceOffset) * Math.min(1, dt * 12);

		this.fillCamTarget();
		if (this.state !== 'menu') this.cam.setMode(p.state === 'driving' ? 'vehicle' : 'foot', this.camTarget);
		if (this.state === 'menu') {
			this.cam.update(dt, 0, 0, this.camTarget);
		} else if (this.state === 'playing') {
			this.cam.update(dt, this.input.mouseDX, this.input.mouseDY, this.camTarget);
		}
		const cam = this.graphics.camera;
		this.graphics.followShadows(cam.position.x, cam.position.z);
		const fwd = this.cam.forward;
		const fl = Math.hypot(fwd.x, fwd.z) || 1;
		w.view.x = cam.position.x;
		w.view.z = cam.position.z;
		w.view.dirX = fwd.x / fl;
		w.view.dirZ = fwd.z / fl;

		// Humanoids.
		this.humans.begin();
		if (this.state !== 'menu' && p.state !== 'driving') {
			const pose = this.playerPose;
			pose.x = p.x;
			pose.y = p.y + this.surfaceOffset;
			pose.z = p.z;
			pose.heading = p.heading;
			pose.walkPhase = p.animPhase;
			pose.walkAmount = Math.min(1, p.speed / 5) * (p.onGround || p.swimming ? 1 : 0.2);
			pose.crouch += ((p.crouching ? 1 : 0) - pose.crouch) * Math.min(1, dt * 10);
			pose.aim = p.aiming ? 1 : 0;
			pose.dead = p.state === 'dead' ? Math.min(1, pose.dead + dt * 2) : 0;
			this.humans.add(pose);
		}
		if (this.state !== 'menu') this.addActorPoses();
		this.humans.end();
		this.signals.update(cam.position.x, cam.position.z, w.time, dt);

		const q = this.graphics.quality;
		const night = sharedUniforms.uNight.value;
		this.city.update(cam.position.x, cam.position.z, q.drawDistance, q.detailDistance, night, dt);
		this.vehicleViews.update(w.vehicles.list, p.state === 'driving' ? p.vehicle : null, night, dt, cam.position.x, cam.position.z, Math.min(q.drawDistance, 450));
		this.updateEffects(dt);

		this.updatePrompt();
		this.hud.update(dt, w, this.debugText());
		this.graphics.render();
	}

	private addActorPoses(): void {
		const w = this.world;
		const pose = this.npcPose;
		for (const a of w.actors.list) {
			if (!a.active || a.vehicle || a.hidden || a.tier > 1) continue;
			pose.x = a.x;
			pose.z = a.z;
			pose.y = a.y + (w.city.isOnRoad(a.x, a.z) ? 0 : 0.15);
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

	private updatePrompt(): void {
		const w = this.world;
		const p = w.player;
		if (this.state !== 'playing' || p.state !== 'onFoot') {
			this.hud.setPrompt(null);
			return;
		}
		const v = w.vehicles.enterCandidate();
		if (v) {
			const name = `${v.def.make} ${v.def.name}`;
			const verb = v.role === 'owned' ? 'Get in your' : v.driver ? 'Carjack the' : v.role === 'mission' ? 'Get in the' : 'Steal the';
			this.hud.setPrompt('F', `${verb} ${name}`);
			return;
		}
		this.hud.setPrompt(null);
	}

	private updateEffects(dt: number): void {
		const cam = this.graphics.camera.position;
		if (this.state === 'playing') {
			for (const v of this.world.vehicles.list) {
				if (v.destroyed && !v.sinking) {
					if (v.age % 1 < 0.5 && (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 < 150 * 150) this.effects.vehicleSmoke(v.x, 1.2, v.z, 0, false, dt * 0.5);
					continue;
				}
				if (v.healthFraction > 0.4 || v.sinking) continue;
				if ((v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > 200 * 200) continue;
				const hx = v.x + v.forwardX * v.halfLength * 0.7;
				const hz = v.z + v.forwardZ * v.halfLength * 0.7;
				this.effects.vehicleSmoke(hx, v.def.height * 0.7, hz, v.healthFraction, v.burning, dt);
			}
			this.effects.update(dt);
		}
	}

	private debugText(): string {
		if (!this.hud.debugVisible) return '';
		const p = this.world.player;
		const info = this.graphics.renderer.info;
		return [
			`fps ${this.fps.toFixed(0)}  sim ${this.simMs.toFixed(2)}ms`,
			`calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
			`chunks ${this.city.builtCount}/${this.city.totalChunks}`,
			`pos ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}  ${this.world.currentDistrict ?? ''}`,
			`state ${p.state}  speed ${(p.vehicle ? Math.abs(p.vehicle.forwardSpeed) * 3.6 : p.speed).toFixed(1)}${p.vehicle ? ' km/h hp ' + p.vehicle.health.toFixed(0) : ''}`,
			`vehicles ${this.world.vehicles.count} (views ${this.vehicleViews.viewCount})  particles ${this.effects.liveParticles}`,
			`actors ${this.world.actors.count} (drawn ${this.humans.rendered})  peds target ${this.world.actors.targetPopulation()}  traffic target ${this.world.traffic.targetTraffic()}`,
			`time ${this.world.clock.format()}`,
		].join('\n');
	}
}
