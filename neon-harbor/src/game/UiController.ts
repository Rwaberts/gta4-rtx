// UI orchestration: HUD sync, minimap + GPS route, full map and waypoint, menus, shops,
// save/load, settings and the mission retry flow.

import { WEAPONS } from '../data/weapons';
import { WEATHER_NAMES } from '../sim/Weather';
import { newGameData, type SlotId } from '../sim/SaveSystem';
import type { World } from '../sim/World';
import type { Point } from '../world/RoadNetwork';
import { POI_ICONS, cityMapPanel } from '../ui/CityMap';
import { Hud } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { Minimap, type Blip } from '../ui/Minimap';
import { saveLoadPanel } from '../ui/SaveLoadUI';
import { settingsPanel } from '../ui/Settings';
import { shopPanel } from '../ui/ShopUI';
import { button, el } from '../ui/dom';
import { renderMapImage, type MapImage } from '../ui/mapImage';
import type { Game } from './Game';

const MARKER_COLORS = { goto: '#ffd84a', vehicle: '#4ad8ff', enemy: '#ff4a5a', ally: '#39f0d0', pickup: '#ffd84a', contact: '#ff4ad8' } as const;

export class UiController {
	readonly hud: Hud;
	readonly menus: Menus;
	readonly minimap: Minimap;
	readonly mapImage: MapImage;
	waypoint: { x: number; z: number } | null = null;
	private route: Point[] | null = null;
	private routeColor = '#ffd84a';
	private routeTimer = 0;
	private routeKey = '';
	private minimapTimer = 0;
	private retryPending = false;
	private blips: Blip[] = [];
	private zoom = 1.1;

	constructor(
		private readonly game: Game,
		private readonly world: World,
		root: HTMLElement,
	) {
		this.hud = new Hud(root, world);
		this.mapImage = renderMapImage(world.city);
		this.minimap = new Minimap(this.hud.root, this.mapImage);
		this.menus = new Menus(root, {
			newGame: () => game.newGame(),
			resume: () => game.resume(),
			quitToMenu: () => game.quitToMenu(),
			hasSave: () => world.saves.latest() !== null,
			continueGame: () => {
				const latest = world.saves.latest();
				if (latest) game.loadSlot(latest.slot);
				else game.newGame();
			},
			openSettings: (back) => settingsPanel(game.settings, (s) => game.applySettings(s), back),
			openSaveLoad: (mode, back) => saveLoadPanel(world.saves, mode, (slot) => game.loadSlot(slot), back),
			openMap: (back) => this.mapPanel(back),
		});
		const bus = world.bus;
		bus.on('hitConfirm', (e) => this.hud.hitMarker(e.kill));
		bus.on('missionFailed', () => (this.retryPending = true));
		bus.on('openShop', (e) => this.openShop(e.shop, e.poi));
		bus.on('requestSave', () => {
			const inst = world.interiors.current;
			this.openShop('safehouse', inst?.poi.id ?? 'safehouse');
		});
		bus.on('missionCompleted', () => world.saves.save('auto'));
		bus.on('itemPurchased', (e) => {
			if (e.kind === 'property' || e.kind === 'vehicle') world.saves.save('auto');
		});
	}

	private mapPanel(back: () => void): HTMLElement {
		const w = this.world;
		return cityMapPanel({
			map: this.mapImage,
			pois: w.city.pois,
			player: () => ({ x: w.player.px, z: w.player.pz, heading: w.player.state === 'driving' && w.player.vehicle ? w.player.vehicle.heading : w.player.heading }),
			waypoint: () => this.waypoint,
			setWaypoint: (p) => {
				this.waypoint = p;
				this.routeKey = '';
			},
			markers: () => w.missions.markers([]).map((m) => ({ x: m.x, z: m.z, color: MARKER_COLORS[m.kind] })),
			ownedProperties: () => w.economy.properties,
			back,
		});
	}

	openMapFromGame(): void {
		this.game.pauseWith(this.mapPanel(() => this.game.resume()));
	}

	openShop(shop: string, poi: string): void {
		const close = () => this.game.resume();
		const onSave = () => this.game.pauseWith(saveLoadPanel(this.world.saves, 'save', (slot) => this.game.loadSlot(slot), () => this.openShop(shop, poi)));
		this.game.pauseWith(shopPanel(this.world, shop, poi, close, onSave));
		if (shop === 'safehouse') this.world.saves.save('auto');
	}

	private showRetry(): void {
		const f = this.world.missions.lastFailed;
		if (!f) return;
		const panel = el(
			'div',
			{ class: 'menu-panel' },
			el('div', { class: 'menu-title', text: 'Mission Failed' }),
			el('p', { text: f.reason }),
			el(
				'div',
				{ class: 'menu-list' },
				button(f.checkpoint > 0 ? 'Retry from checkpoint' : 'Retry mission', () => {
					this.game.resume();
					this.world.missions.retry();
					this.game.snapCamera();
				}),
				button('Not now', () => this.game.resume()),
			),
		);
		this.game.pauseWith(panel);
	}

	/** Called by Game when starting a fresh game. */
	resetForNewGame(): void {
		this.waypoint = null;
		this.route = null;
		this.routeKey = '';
		this.retryPending = false;
		this.world.saves.apply(newGameData(this.world));
	}

	loadSlot(slot: SlotId): boolean {
		this.waypoint = null;
		this.route = null;
		this.routeKey = '';
		return this.world.saves.load(slot);
	}

	update(dt: number, playing: boolean, camYaw: number, debugText: string): void {
		const w = this.world;
		const p = w.player;
		this.updatePrompt(playing);
		const inv = w.combat.inventory;
		const wd = WEAPONS[inv.current];
		this.hud.setWeapon(wd.name, wd.kind === 'melee' ? null : inv.state.clip, wd.kind === 'melee' ? null : inv.state.reserve, w.combat.reloading);
		this.hud.setObjective(w.missions.active ? w.missions.objectiveText() : '');
		const act = w.missions.active;
		const o = act ? act.def.objectives[act.index] : null;
		this.hud.setProgress(o && o.type === 'hold' ? w.missions.progress : null);
		this.hud.setClock(`${w.clock.format()}  ·  ${WEATHER_NAMES[w.weather.state]}`);
		const v = p.state === 'driving' ? p.vehicle : null;
		this.hud.setVehicle(v ? `${v.def.make} ${v.def.name}` : null, v ? Math.abs(v.forwardSpeed) * 3.6 : 0, v ? v.healthFraction : 0);
		this.hud.update(dt, w, debugText);

		// Minimap at ~20 Hz.
		this.minimapTimer -= dt;
		this.routeTimer -= dt;
		if (this.minimapTimer <= 0) {
			this.minimapTimer = 0.05;
			const targetZoom = v ? 1.1 - Math.min(0.6, Math.abs(v.forwardSpeed) / 60) : 1.25;
			this.zoom += (targetZoom - this.zoom) * 0.15;
			const heading = v ? v.heading : p.heading;
			this.updateRoute();
			this.minimap.draw(p.px, p.pz, camYaw, heading, this.zoom, this.collectBlips(), this.route, this.routeColor, 0.05);
		}

		if (this.retryPending && playing && p.alive && p.state !== 'arrested') {
			this.retryPending = false;
			this.showRetry();
		}
	}

	private updatePrompt(playing: boolean): void {
		const w = this.world;
		const p = w.player;
		if (!playing || (p.state !== 'onFoot' && p.state !== 'driving')) {
			this.hud.setPrompt(null);
			return;
		}
		const it = w.interactions.current;
		if (it) {
			this.hud.setPrompt('E', it.blocked ? `${it.label} — ${it.blocked}` : it.label);
			return;
		}
		if (p.state === 'onFoot') {
			const veh = w.vehicles.enterCandidate();
			if (veh) {
				const name = `${veh.def.make} ${veh.def.name}`;
				const verb = veh.role === 'owned' ? 'Get in your' : veh.driver ? 'Carjack the' : veh.role === 'mission' ? 'Get in the' : 'Steal the';
				this.hud.setPrompt('F', `${verb} ${name}`);
				return;
			}
		}
		this.hud.setPrompt(null);
	}

	/** GPS: route to the active mission destination, else to the waypoint. */
	private updateRoute(): void {
		const w = this.world;
		const p = w.player;
		let target: { x: number; z: number } | null = null;
		let color = '#39f0d0';
		const markers = w.missions.markers([]);
		const dest = markers.find((m) => m.kind === 'goto' || m.kind === 'vehicle' || m.kind === 'pickup') ?? markers.find((m) => m.kind === 'enemy');
		if (dest && !w.interiors.current) {
			target = dest;
			color = '#ffd84a';
		} else if (this.waypoint) {
			target = this.waypoint;
			if (Math.hypot(this.waypoint.x - p.px, this.waypoint.z - p.pz) < 12) {
				this.waypoint = null;
				target = null;
				w.bus.emit('notify', { text: 'You reached your waypoint.', kind: 'info', duration: 2 });
			}
		}
		if (!target || w.interiors.current) {
			this.route = null;
			return;
		}
		const key = `${Math.round(target.x / 10)},${Math.round(target.z / 10)}`;
		if (key === this.routeKey && this.routeTimer > 0) return;
		this.routeKey = key;
		this.routeTimer = 1.5;
		this.route = Math.hypot(target.x - p.px, target.z - p.pz) < 60 ? [{ x: p.px, z: p.pz }, target] : w.roads.route(p.px, p.pz, target.x, target.z);
		this.routeColor = color;
	}

	private collectBlips(): Blip[] {
		const w = this.world;
		const b = this.blips;
		b.length = 0;
		const p = w.player;
		// Points of interest within radar range.
		for (const poi of w.city.pois) {
			if (Math.abs(poi.x - p.px) > 260 || Math.abs(poi.z - p.pz) > 260) continue;
			const icon = POI_ICONS[poi.kind];
			if (!icon) continue;
			if (poi.kind === 'contact') continue;
			const owned = poi.kind === 'property' && w.economy.properties.has(poi.id);
			b.push({ x: poi.x, z: poi.z, color: owned ? '#39f0d0' : icon.color, shape: 'letter', letter: icon.letter, size: 5 });
		}
		// Police.
		const flash = Math.floor(w.time * 4) % 2 === 0;
		for (const u of w.police.units) {
			if (u.removed) continue;
			b.push({ x: u.x, z: u.z, color: w.wanted.level > 0 ? (flash ? '#ff4a5a' : '#4a8cff') : '#4a8cff', shape: 'square', size: 3.5 });
			for (const o of u.officers) if (o.alive && !o.vehicle) b.push({ x: o.x, z: o.z, color: '#4a8cff', shape: 'dot', size: 2.5 });
		}
		for (const o of w.police.footPatrols) if (o.alive) b.push({ x: o.x, z: o.z, color: '#4a8cff', shape: 'dot', size: 2.5 });
		if (w.police.heli.active) b.push({ x: w.police.heli.x, z: w.police.heli.z, color: '#4a8cff', shape: 'diamond', size: 5, edge: true });
		// Mission markers and contacts.
		for (const m of w.missions.markers([])) {
			if (m.kind === 'contact') b.push({ x: m.x, z: m.z, color: MARKER_COLORS.contact, shape: 'letter', letter: 'M', size: 5, edge: true });
			else b.push({ x: m.x, z: m.z, color: MARKER_COLORS[m.kind], shape: m.kind === 'goto' ? 'diamond' : 'dot', size: m.kind === 'goto' ? 6 : 4, edge: m.kind !== 'enemy' && m.kind !== 'ally' });
		}
		if (this.waypoint) b.push({ x: this.waypoint.x, z: this.waypoint.z, color: '#39f0d0', shape: 'diamond', size: 5, edge: true });
		return b;
	}
}

