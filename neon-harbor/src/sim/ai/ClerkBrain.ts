// Shop clerk: stays behind the counter, raises hands when threatened, ducks at gunfire.

import { headingTo } from '../../core/math';
import type { Actor, ActorBrain, ThreatKind } from '../Actor';
import type { World } from '../World';

export class ClerkBrain implements ActorBrain {
	label = 'idle';
	private threat = 0;
	private duck = 0;

	constructor(
		private readonly postX: number,
		private readonly postZ: number,
		private readonly faceX: number,
		private readonly faceZ: number,
	) {}

	get state(): string {
		return this.label;
	}

	get threatened(): boolean {
		return this.threat > 0;
	}

	think(a: Actor, w: World, dt: number): void {
		this.threat = Math.max(0, this.threat - dt);
		this.duck = Math.max(0, this.duck - dt);
		a.setTarget(this.postX, this.postZ, 1, 0.3);
		if (this.duck > 0) {
			this.label = 'cower';
			a.crouch = 1;
			a.handsUp = 0;
		} else if (this.threat > 0) {
			this.label = 'handsUp';
			a.crouch = 0;
			a.handsUp = 1;
			a.faceHeading = headingTo(w.player.x - a.x, w.player.z - a.z);
		} else {
			this.label = 'idle';
			a.crouch = 0;
			a.handsUp = 0;
			a.faceHeading = headingTo(this.faceX - a.x, this.faceZ - a.z);
		}
	}

	react(_a: Actor, _w: World, kind: ThreatKind): void {
		if (kind === 'aimedAt') this.threat = 2;
		else if (kind === 'gunshot' || kind === 'explosion' || kind === 'attacked') {
			this.duck = 6;
			this.threat = 6;
		}
	}
}
