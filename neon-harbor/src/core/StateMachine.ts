// Minimal hierarchical-free finite state machine used by all AI brains.
// States are plain objects keyed by name; transitions happen by returning a new state
// name from update(), or by calling change() from outside (e.g. an event handler).

export interface State<C, S extends string> {
	enter?(ctx: C, from: S | null): void;
	/** Return a state name to transition, or void to stay. */
	update?(ctx: C, dt: number, time: number): S | void;
	exit?(ctx: C, to: S): void;
}

export type StateTable<C, S extends string> = Record<S, State<C, S>>;

export class StateMachine<C, S extends string> {
	current: S;
	/** Seconds spent in the current state. */
	elapsed = 0;
	previous: S | null = null;

	constructor(
		private readonly table: StateTable<C, S>,
		initial: S,
		private readonly ctx: C,
		private readonly onChange?: (from: S, to: S) => void,
	) {
		this.current = initial;
		this.table[initial].enter?.(ctx, null);
	}

	change(next: S): void {
		if (next === this.current) return;
		const from = this.current;
		this.table[from].exit?.(this.ctx, next);
		this.previous = from;
		this.current = next;
		this.elapsed = 0;
		this.table[next].enter?.(this.ctx, from);
		this.onChange?.(from, next);
	}

	update(dt: number, time: number): void {
		this.elapsed += dt;
		const next = this.table[this.current].update?.(this.ctx, dt, time);
		if (next && next !== this.current) this.change(next);
	}

	is(...states: S[]): boolean {
		return states.includes(this.current);
	}
}
