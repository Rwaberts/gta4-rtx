// Main menu, pause menu and sub-screens. Menus are plain DOM screens swapped in and out.

import { button, el } from './dom';

export interface MenuActions {
	newGame(): void;
	resume(): void;
	quitToMenu(): void;
	hasSave(): boolean;
	continueGame(): void;
	openSettings(back: () => void): HTMLElement;
	openSaveLoad(mode: 'save' | 'load', back: () => void): HTMLElement;
	openMap(back: () => void): HTMLElement;
}

export const CONTROL_HELP: Array<[string, string]> = [
	['W A S D', 'Move / drive'],
	['Mouse', 'Look (click the game to capture the mouse)'],
	['Shift', 'Sprint (uses stamina)'],
	['Space', 'Jump / handbrake'],
	['C or Ctrl', 'Crouch toggle'],
	['F', 'Enter / exit / steal vehicle'],
	['E', 'Interact (shops, doors, contacts, save)'],
	['Left mouse', 'Fire / punch'],
	['Right mouse', 'Aim'],
	['R', 'Reload'],
	['Q / wheel / 1-6', 'Switch weapon'],
	['H', 'Horn'],
	['B', 'Look behind (vehicle)'],
	['M', 'City map / set waypoint'],
	['Esc or P', 'Pause'],
	['`', 'Debug overlay'],
];

export class Menus {
	readonly root = el('div');
	private current: HTMLElement | null = null;

	constructor(
		parent: HTMLElement,
		private readonly actions: MenuActions,
	) {
		parent.append(this.root);
	}

	get isOpen(): boolean {
		return this.current !== null;
	}

	close(): void {
		this.current?.remove();
		this.current = null;
	}

	private open(screen: HTMLElement): void {
		this.close();
		this.current = screen;
		this.root.append(screen);
		(screen.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
	}

	showMain(): void {
		const a = this.actions;
		const list = el('div', { class: 'menu-list' });
		if (a.hasSave()) list.append(button('Continue', () => a.continueGame()));
		list.append(
			button('New Game', () => a.newGame()),
			button('Load Game', () => this.open(this.wrap(a.openSaveLoad('load', () => this.showMain())))),
			button('Settings', () => this.open(this.wrap(a.openSettings(() => this.showMain())))),
			button('Controls', () => this.showControls(() => this.showMain())),
			button('Credits', () => this.showCredits()),
		);
		const panel = el(
			'div',
			{ class: 'menu-panel' },
			el('div', { class: 'logo', html: '<span class="logo-neon">NEON</span><span class="logo-harbor">HARBOR</span>' }),
			el('div', { class: 'menu-sub', text: 'Build an empire on the tide line' }),
			list,
			el('div', { class: 'menu-foot', text: 'Original prototype. All characters, places and organisations are fictional.' }),
		);
		this.open(el('div', { class: 'menu-screen' }, panel));
	}

	showPause(): void {
		const a = this.actions;
		const list = el(
			'div',
			{ class: 'menu-list' },
			button('Resume', () => a.resume()),
			button('City Map', () => this.open(this.wrap(a.openMap(() => this.showPause()), true))),
			button('Save Game', () => this.open(this.wrap(a.openSaveLoad('save', () => this.showPause()), true))),
			button('Load Game', () => this.open(this.wrap(a.openSaveLoad('load', () => this.showPause()), true))),
			button('Settings', () => this.open(this.wrap(a.openSettings(() => this.showPause()), true))),
			button('Controls', () => this.showControls(() => this.showPause(), true)),
			button('Quit to Main Menu', () => a.quitToMenu()),
		);
		const panel = el('div', { class: 'menu-panel' }, el('div', { class: 'menu-title', text: 'Paused' }), list);
		this.open(el('div', { class: 'menu-screen center' }, panel));
	}

	showControls(back: () => void, center = false): void {
		const table = el('div', { class: 'controls-table' });
		for (const [k, v] of CONTROL_HELP) table.append(el('div', { class: 'key', text: k }), el('div', { text: v }));
		const panel = el('div', { class: 'menu-panel' }, el('div', { class: 'menu-title', text: 'Controls' }), table, button('Back', back));
		this.open(el('div', { class: 'menu-screen' + (center ? ' center' : '') }, panel));
	}

	showCredits(): void {
		const panel = el(
			'div',
			{ class: 'menu-panel' },
			el('div', { class: 'menu-title', text: 'Credits' }),
			el('p', { text: 'Neon Harbor is an original prototype built with Three.js and TypeScript.' }),
			el('p', { text: 'All geometry, textures and audio are generated procedurally at runtime.' }),
			el('p', { text: 'Characters, locations, businesses and dialogue are fictional.' }),
			button('Back', () => this.showMain()),
		);
		this.open(el('div', { class: 'menu-screen' }, panel));
	}

	/** Wraps a sub-screen panel in a full-screen container. */
	private wrap(panel: HTMLElement, center = false): HTMLElement {
		return el('div', { class: 'menu-screen' + (center ? ' center' : '') }, panel);
	}

	/** Opens an arbitrary panel (used for shops and dialogs). */
	openPanel(panel: HTMLElement, center = true): void {
		this.open(this.wrap(panel, center));
	}
}
