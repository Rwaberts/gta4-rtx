// Composition root: owns the simulation (World), presentation (WorldView), camera, input and
// UI (UiController); runs the frame loop and the top-level game state machine
// (menu -> playing <-> paused).

import { SIM } from '../data/config';
import { Input } from '../core/Input';
import { World } from '../sim/World';
import type { KeyValueStorage, SlotId } from '../sim/SaveSystem';
import { Graphics, QUALITY_PRESETS } from '../render/Graphics';
import { sharedUniforms } from '../render/materials';
import { CameraController, type CameraTarget } from './CameraController';
import { WorldView } from './WorldView';
import { UiController } from './UiController';
import { loadSettings, type Settings } from '../ui/Settings';

export type GameState = 'menu' | 'playing' | 'paused';

/** localStorage wrapped so private browsing / blocked storage never crashes the game. */
function browserStorage(): KeyValueStorage {
	return {
		getItem: (k) => {
			try {
				return localStorage.getItem(k);
			} catch {
				return null;
			}
		},
		setItem: (k, v) => {
			try {
				localStorage.setItem(k, v);
			} catch {
				/* quota or disabled */
			}
		},
		removeItem: (k) => {
			try {
				localStorage.removeItem(k);
			} catch {
				/* ignore */
			}
		},
	};
}

export class Game {
	readonly world: World;
	readonly graphics: Graphics;
	readonly input = new Input();
	readonly cam: CameraController;
	readonly view: WorldView;
	readonly ui: UiController;
	settings: Settings;
	state: GameState = 'menu';
	fps = 0;
	private last = performance.now();
	private fpsTime = 0;
	private fpsFrames = 0;
	private simMs = 0;
	private wasLocked = false;
	private readonly camTarget: CameraTarget = { x: 0, y: 0, z: 0, heading: 0, speed: 0, size: 4, aiming: false, crouching: false, lookBehind: false };

	constructor(container: HTMLElement) {
		const viewport = container.querySelector('#viewport') as HTMLElement;
		const uiRoot = container.querySelector('#ui') as HTMLElement;
		this.settings = loadSettings();
		this.world = new World(undefined, browserStorage());
		this.graphics = new Graphics(viewport, QUALITY_PRESETS[this.settings.quality]);
		this.cam = new CameraController(this.graphics.camera, this.world.collision);
		this.view = new WorldView(this.world, this.graphics, this.cam);
		this.ui = new UiController(this, this.world, uiRoot);
		this.input.attach(this.graphics.renderer.domElement);
		this.applySettings(this.settings);

		this.world.bus.on('interiorChanged', () => this.snapCamera());
		this.world.bus.on('playerRespawned', () => this.snapCamera());
		this.graphics.renderer.domElement.addEventListener('click', () => {
			if (this.state === 'playing') this.input.requestPointerLock();
		});
		document.addEventListener('pointerlockchange', () => {
			const locked = document.pointerLockElement === this.graphics.renderer.domElement;
			// Browsers release pointer lock on Escape; treat that as a pause request.
			if (this.wasLocked && !locked && this.state === 'playing') this.pause();
			this.wasLocked = locked;
		});

		// Fresh world state so the menu backdrop has the starter car etc.
		this.ui.resetForNewGame();
		const p = this.world.player;
		this.view.prewarm(p.x, p.z, 500);
	}

	// ------------------------------------------------------------- game states

	start(): void {
		document.getElementById('loading')?.classList.add('done');
		this.toMenu();
		requestAnimationFrame(this.frame);
	}

	private toMenu(): void {
		this.state = 'menu';
		this.ui.hud.show(false);
		this.cam.setMode('cinematic');
		this.ui.menus.showMain();
	}

	private beginPlaying(): void {
		this.ui.menus.close();
		this.ui.hud.show(true);
		this.state = 'playing';
		this.snapCamera();
		this.view.prewarm(this.world.player.px, this.world.player.pz, 400);
		this.input.requestPointerLock();
	}

	newGame(): void {
		this.ui.resetForNewGame();
		this.beginPlaying();
		this.world.bus.emit('notify', { text: 'Welcome home to Neon Harbor, Kai. Visit Rosa at the diner (pink M on the radar).', kind: 'mission', duration: 7 });
		this.world.bus.emit('notify', { text: 'Click to capture the mouse. WASD to move, F for vehicles, E to interact, M for the map.', kind: 'info', duration: 7 });
	}

	loadSlot(slot: SlotId): void {
		if (this.ui.loadSlot(slot)) {
			this.beginPlaying();
			this.world.bus.emit('notify', { text: 'Game loaded.', kind: 'good', duration: 2.5 });
		}
	}

	pause(): void {
		if (this.state !== 'playing') return;
		this.state = 'paused';
		this.input.exitPointerLock();
		this.ui.menus.showPause();
	}

	/** Pauses with a custom panel (shops, map, retry). */
	pauseWith(panel: HTMLElement): void {
		this.state = 'paused';
		this.input.exitPointerLock();
		this.ui.menus.openPanel(panel);
	}

	resume(): void {
		this.ui.menus.close();
		this.state = 'playing';
		this.input.requestPointerLock();
	}

	quitToMenu(): void {
		this.world.saves.save('auto');
		this.toMenu();
	}

	applySettings(s: Settings): void {
		this.settings = s;
		const q = { ...QUALITY_PRESETS[s.quality], drawDistance: s.drawDistance, shadows: s.shadows && s.quality !== 'low' };
		q.detailDistance = Math.min(q.detailDistance, s.drawDistance * 0.55);
		this.graphics.applyQuality(q);
		this.cam.sensitivity = 0.0024 * s.sensitivity;
		this.cam.invertY = s.invertY;
		this.cam.baseFov = s.fov;
		this.world.traffic.density = s.traffic;
		this.world.actors.density = s.peds;
		this.world.clock.scale = s.clockSpeed;
		this.world.bus.emit('sound', { id: 'volume', volume: s.volume });
		if (s.showFps !== this.ui.hud.debugVisible) this.ui.hud.toggleDebug();
	}

	// --------------------------------------------------------------------- loop

	private handleGlobalInput(): void {
		const inp = this.input;
		if (inp.wasPressed('pause')) {
			if (this.state === 'playing') this.pause();
			else if (this.state === 'paused') this.resume();
		}
		if (inp.wasPressed('map') && this.state === 'playing') this.ui.openMapFromGame();
		if (inp.wasPressed('debug')) this.ui.hud.toggleDebug();
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
			t.y = p.y + this.view.surfaceOffset;
			t.z = p.z;
			t.heading = p.heading;
			t.speed = p.speed;
			t.size = 4;
			t.aiming = p.aiming;
			t.crouching = p.crouching;
		}
		t.lookBehind = this.input.isDown('lookBehind');
	}

	/** Puts the camera behind the player instantly (teleports, doors, respawns). */
	snapCamera(): void {
		this.fillCamTarget();
		const p = this.world.player;
		this.cam.setMode(p.state === 'driving' ? 'vehicle' : this.world.interiors.current ? 'interior' : 'foot', this.camTarget);
		this.cam.snapTo(this.camTarget);
	}

	private frame = (now: number): void => {
		requestAnimationFrame(this.frame);
		const raw = Math.max(1e-4, (now - this.last) / 1000);
		this.last = now;
		// Clamp simulation time so a stall (tab switch, GC) cannot explode the physics.
		const dt = Math.min(raw, 0.1);
		this.fpsTime += raw;
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
		this.render(dt);
		this.input.endFrame();
	};

	/** Advances the simulation without rendering (used by automated tests). */
	simulate(seconds: number): void {
		const steps = Math.round(seconds / SIM.fixedDt);
		for (let i = 0; i < steps; i++) this.world.step(SIM.fixedDt);
	}

	private render(dt: number): void {
		const w = this.world;
		const p = w.player;
		const playing = this.state === 'playing';
		sharedUniforms.uTime.value += dt;

		this.fillCamTarget();
		if (this.state !== 'menu') this.cam.setMode(p.state === 'driving' ? 'vehicle' : w.interiors.current ? 'interior' : 'foot', this.camTarget);
		if (this.state === 'menu') this.cam.update(dt, 0, 0, this.camTarget);
		else if (playing) this.cam.update(dt, this.input.mouseDX, this.input.mouseDY, this.camTarget);
		const cam = this.graphics.camera;
		this.graphics.followShadows(cam.position.x, cam.position.z);
		this.updateViewRay();

		this.view.update(dt, this.state !== 'menu', playing);
		this.ui.update(dt, playing, this.cam.yaw, this.debugText());
		this.graphics.render();
	}

	/** Shares the camera ray with the simulation (aiming, spawn culling). */
	private updateViewRay(): void {
		const w = this.world;
		const p = w.player;
		const cam = this.graphics.camera.position;
		const fwd = this.cam.forward;
		const fl = Math.hypot(fwd.x, fwd.z) || 1;
		w.view.x = cam.x;
		w.view.z = cam.z;
		w.view.dirX = fwd.x / fl;
		w.view.dirZ = fwd.z / fl;
		const aim = w.aim;
		aim.fromCamera = true;
		aim.ox = cam.x;
		aim.oy = cam.y;
		aim.oz = cam.z;
		aim.dx = fwd.x;
		aim.dy = fwd.y;
		aim.dz = fwd.z;
		aim.skip = Math.max(0.5, (p.px - cam.x) * fwd.x + (p.y + 1.4 - cam.y) * fwd.y + (p.pz - cam.z) * fwd.z);
	}

	private debugText(): string {
		if (!this.ui.hud.debugVisible) return '';
		const w = this.world;
		const p = w.player;
		const info = this.graphics.renderer.info;
		const v = this.view;
		return [
			`fps ${this.fps.toFixed(0)}  sim ${this.simMs.toFixed(2)}ms`,
			`calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
			`chunks ${v.city.builtCount}/${v.city.totalChunks}`,
			`pos ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}  ${w.currentDistrict ?? ''}`,
			`state ${p.state}${p.vehicle ? ' hp ' + p.vehicle.health.toFixed(0) : ''}`,
			`vehicles ${w.vehicles.count} (views ${v.vehicles.viewCount})  particles ${v.effects.liveParticles}`,
			`actors ${w.actors.count} (drawn ${v.humans.rendered})  peds target ${w.actors.targetPopulation()}  traffic target ${w.traffic.targetTraffic()}`,
			`time ${w.clock.format()}  weather ${w.weather.state}  wet ${w.wetness.toFixed(2)}`,
			`wanted ${w.wanted.level} heat ${w.wanted.heat.toFixed(0)} ${w.wanted.seen ? 'SEEN' : w.wanted.searching ? 'search ' + w.wanted.searchRemaining.toFixed(0) : ''}`,
			`police ${w.police.summary()}`,
		].join('\n');
	}
}
