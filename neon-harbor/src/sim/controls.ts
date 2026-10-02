// Device-independent control state consumed by the simulation. Edge-triggered fields
// ("pressed") are latched until the next simulation step consumes them.

export interface PlayerControls {
	/** -1..1, camera-relative (x = right, z = forward). */
	moveX: number;
	moveZ: number;
	camYaw: number;
	camPitch: number;
	sprint: boolean;
	walk: boolean;
	aim: boolean;
	fire: boolean;
	// Vehicle
	throttle: number;
	brake: number;
	steer: number;
	handbrake: boolean;
	horn: boolean;
	// Edges
	jumpPressed: boolean;
	crouchPressed: boolean;
	firePressed: boolean;
	reloadPressed: boolean;
	interactPressed: boolean;
	enterExitPressed: boolean;
	weaponDelta: number;
	weaponSlot: number;
}

export function createControls(): PlayerControls {
	return {
		moveX: 0,
		moveZ: 0,
		camYaw: 0,
		camPitch: 0,
		sprint: false,
		walk: false,
		aim: false,
		fire: false,
		throttle: 0,
		brake: 0,
		steer: 0,
		handbrake: false,
		horn: false,
		jumpPressed: false,
		crouchPressed: false,
		firePressed: false,
		reloadPressed: false,
		interactPressed: false,
		enterExitPressed: false,
		weaponDelta: 0,
		weaponSlot: -1,
	};
}

export function clearEdges(c: PlayerControls): void {
	c.jumpPressed = false;
	c.crouchPressed = false;
	c.firePressed = false;
	c.reloadPressed = false;
	c.interactPressed = false;
	c.enterExitPressed = false;
	c.weaponDelta = 0;
	c.weaponSlot = -1;
}
