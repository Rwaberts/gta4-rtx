// Keyboard + mouse input with rebindable actions and pointer lock.
// Rendering/gameplay code reads actions, never raw key codes.

export type Action =
	| 'forward'
	| 'back'
	| 'left'
	| 'right'
	| 'sprint'
	| 'walk'
	| 'jump'
	| 'crouch'
	| 'interact'
	| 'enterVehicle'
	| 'fire'
	| 'aim'
	| 'reload'
	| 'nextWeapon'
	| 'prevWeapon'
	| 'handbrake'
	| 'horn'
	| 'lookBehind'
	| 'pause'
	| 'map'
	| 'slot1'
	| 'slot2'
	| 'slot3'
	| 'slot4'
	| 'slot5'
	| 'slot6'
	| 'debug';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
	forward: ['KeyW', 'ArrowUp'],
	back: ['KeyS', 'ArrowDown'],
	left: ['KeyA', 'ArrowLeft'],
	right: ['KeyD', 'ArrowRight'],
	sprint: ['ShiftLeft', 'ShiftRight'],
	walk: ['AltLeft'],
	jump: ['Space'],
	crouch: ['KeyC', 'ControlLeft'],
	interact: ['KeyE'],
	enterVehicle: ['KeyF'],
	fire: ['Mouse0'],
	aim: ['Mouse2'],
	reload: ['KeyR'],
	nextWeapon: ['WheelDown', 'KeyQ'],
	prevWeapon: ['WheelUp'],
	handbrake: ['Space'],
	horn: ['KeyH'],
	lookBehind: ['KeyB'],
	pause: ['Escape', 'KeyP'],
	map: ['KeyM'],
	slot1: ['Digit1'],
	slot2: ['Digit2'],
	slot3: ['Digit3'],
	slot4: ['Digit4'],
	slot5: ['Digit5'],
	slot6: ['Digit6'],
	debug: ['Backquote'],
};

export class Input {
	bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
	private down = new Set<string>();
	private pressedCodes = new Set<string>();
	private releasedCodes = new Set<string>();
	mouseDX = 0;
	mouseDY = 0;
	pointerLocked = false;
	/**
	 * Fallback when the page may not capture the mouse (some embedded / sandboxed pages):
	 * plain mouse movement over the game turns the camera instead.
	 */
	freeLook = false;
	/** When false (menus open) gameplay input is ignored. */
	enabled = true;
	private target: HTMLElement | null = null;
	private lockTime = 0;

	attach(target: HTMLElement): void {
		this.target = target;
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);
		target.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('mousemove', this.onMouseMove);
		target.addEventListener('wheel', this.onWheel, { passive: true });
		target.addEventListener('contextmenu', (e) => e.preventDefault());
		document.addEventListener('pointerlockchange', () => {
			this.pointerLocked = document.pointerLockElement === this.target;
			this.lockTime = performance.now();
			// Mouse releases can be lost while the lock changes hands.
			for (const c of [...this.down]) if (c.startsWith('Mouse')) this.release(c);
		});
		document.addEventListener('pointerlockerror', () => (this.freeLook = true));
	}

	requestPointerLock(): void {
		if (!this.target || this.pointerLocked) return;
		if (typeof this.target.requestPointerLock !== 'function') {
			this.freeLook = true;
			return;
		}
		try {
			const p = this.target.requestPointerLock() as unknown;
			if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => (this.freeLook = true));
		} catch {
			this.freeLook = true;
		}
	}

	exitPointerLock(): void {
		if (document.pointerLockElement) document.exitPointerLock();
	}

	private onKeyDown = (e: KeyboardEvent): void => {
		if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
		if (e.repeat) return;
		this.press(e.code);
	};

	private onKeyUp = (e: KeyboardEvent): void => this.release(e.code);

	private onMouseDown = (e: MouseEvent): void => {
		// A real mousedown is always a new press, even if a previous mouseup was missed.
		const code = 'Mouse' + e.button;
		this.down.delete(code);
		this.press(code);
	};

	private onMouseUp = (e: MouseEvent): void => this.release('Mouse' + e.button);

	private onMouseMove = (e: MouseEvent): void => {
		if (!this.pointerLocked && !(this.freeLook && e.target === this.target)) return;
		// Browsers can emit one large bogus delta right after the lock is acquired.
		if (performance.now() - this.lockTime < 150) return;
		if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
		this.mouseDX += e.movementX;
		this.mouseDY += e.movementY;
	};

	private onWheel = (e: WheelEvent): void => {
		const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
		this.pressedCodes.add(code);
		this.releasedCodes.add(code);
	};

	private onBlur = (): void => {
		for (const c of this.down) this.releasedCodes.add(c);
		this.down.clear();
	};

	/** Programmatic input (used by tests and touch overlays). */
	press(code: string): void {
		if (!this.down.has(code)) this.pressedCodes.add(code);
		this.down.add(code);
	}

	release(code: string): void {
		if (this.down.delete(code)) this.releasedCodes.add(code);
	}

	isDown(a: Action): boolean {
		if (!this.enabled && a !== 'pause') return false;
		for (const c of this.bindings[a]) if (this.down.has(c)) return true;
		return false;
	}

	wasPressed(a: Action): boolean {
		if (!this.enabled && a !== 'pause' && a !== 'map') return false;
		for (const c of this.bindings[a]) if (this.pressedCodes.has(c)) return true;
		return false;
	}

	axis(neg: Action, pos: Action): number {
		return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
	}

	/** Call once at the end of every rendered frame. */
	endFrame(): void {
		this.pressedCodes.clear();
		this.releasedCodes.clear();
		// Wheel is momentary.
		this.down.delete('WheelUp');
		this.down.delete('WheelDown');
		this.mouseDX = 0;
		this.mouseDY = 0;
	}
}
