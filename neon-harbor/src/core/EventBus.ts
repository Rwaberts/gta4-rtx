// Typed publish/subscribe bus. Systems communicate through events instead of polling each other.

export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends { [K in keyof Events]: unknown }> {
	private listeners = new Map<keyof Events, Set<Listener<any>>>();

	on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(fn);
		return () => this.off(type, fn);
	}

	once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
		const off = this.on(type, (p) => {
			off();
			fn(p);
		});
		return off;
	}

	off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
		this.listeners.get(type)?.delete(fn);
	}

	emit<K extends keyof Events>(type: K, payload: Events[K]): void {
		const set = this.listeners.get(type);
		if (!set || set.size === 0) return;
		// Copy so listeners can unsubscribe while being notified.
		for (const fn of Array.from(set)) fn(payload);
	}

	clear(): void {
		this.listeners.clear();
	}
}
