// Generic object pool. Avoids GC churn for frequently spawned entities (traffic, peds, particles).

export class ObjectPool<T> {
	private free: T[] = [];
	private created = 0;

	constructor(
		private readonly factory: () => T,
		private readonly reset: (item: T) => void = () => {},
		readonly maxSize = Infinity,
	) {}

	get totalCreated(): number {
		return this.created;
	}

	get available(): number {
		return this.free.length;
	}

	get inUse(): number {
		return this.created - this.free.length;
	}

	/** Returns a pooled item, or null when the pool is exhausted. */
	acquire(): T | null {
		const item = this.free.pop();
		if (item !== undefined) return item;
		if (this.created >= this.maxSize) return null;
		this.created++;
		return this.factory();
	}

	release(item: T): void {
		this.reset(item);
		this.free.push(item);
	}

	prewarm(count: number): void {
		const items: T[] = [];
		for (let i = 0; i < count; i++) {
			const it = this.acquire();
			if (it === null) break;
			items.push(it);
		}
		for (const it of items) this.release(it);
	}
}
