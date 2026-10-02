// Player wallet, owned assets and passive business income. All prices live in data/economy.ts.

import type { World } from './World';

export class Economy {
	cash: number;
	/** Property ids owned by the player. */
	readonly properties = new Set<string>();
	/** Vehicle archetypes the player owns (re-spawned at the safehouse garage). */
	readonly garage: string[] = [];
	/** Last in-game day income was paid out. */
	lastPayday = 0;
	totalEarned = 0;

	constructor(
		private readonly world: World,
		startingCash: number,
	) {
		this.cash = startingCash;
	}

	canAfford(amount: number): boolean {
		return this.cash >= amount;
	}

	add(amount: number, reason: string): void {
		if (amount === 0) return;
		this.cash += amount;
		if (amount > 0) this.totalEarned += amount;
		this.world.bus.emit('moneyChanged', { cash: this.cash, delta: amount, reason });
	}

	/** Spends money if affordable. Returns false (and changes nothing) otherwise. */
	spend(amount: number, reason: string): boolean {
		if (amount < 0 || this.cash < amount) return false;
		this.add(-amount, reason);
		return true;
	}

	/** Takes up to `amount` (fines, hospital bills) without going negative. */
	charge(amount: number, reason: string): number {
		const take = Math.min(this.cash, amount);
		if (take > 0) this.add(-take, reason);
		return take;
	}
}
