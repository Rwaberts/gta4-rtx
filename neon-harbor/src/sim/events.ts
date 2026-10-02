// Every cross-system event in the game. Systems publish on World.bus instead of calling each other.

export type NotifyKind = 'info' | 'good' | 'bad' | 'mission';

export interface GameEvents {
	notify: { text: string; kind?: NotifyKind; duration?: number };
	districtEntered: { id: string; name: string; tagline: string };
}
