// "[E] Interact" hub. Systems register providers that list interactables near the player; the
// nearest one in range is offered as a prompt and triggered by the interact key.

import { PLAYER } from '../data/config';
import type { World } from './World';

export interface Interactable {
	label: string;
	x: number;
	z: number;
	radius?: number;
	/** Shown greyed-out with this reason instead of acting. */
	blocked?: string;
	act(): void;
}

export type InteractionProvider = (out: Interactable[]) => void;

export class InteractionSystem {
	private providers: InteractionProvider[] = [];
	private scratch: Interactable[] = [];
	current: Interactable | null = null;

	constructor(private readonly world: World) {}

	register(p: InteractionProvider): void {
		this.providers.push(p);
	}

	step(): void {
		const w = this.world;
		const p = w.player;
		this.current = null;
		if (p.state !== 'onFoot') return;
		this.scratch.length = 0;
		for (const prov of this.providers) prov(this.scratch);
		let best: Interactable | null = null;
		let bestD = Infinity;
		for (const it of this.scratch) {
			const r = it.radius ?? PLAYER.interactRange;
			const d = Math.hypot(it.x - p.x, it.z - p.z);
			if (d <= r && d < bestD) {
				bestD = d;
				best = it;
			}
		}
		this.current = best;
		if (best && w.controls.interactPressed) {
			if (best.blocked) w.bus.emit('notify', { text: best.blocked, kind: 'bad', duration: 3 });
			else best.act();
		}
	}
}
