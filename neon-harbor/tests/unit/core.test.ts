import { describe, expect, it } from 'vitest';
import { Random } from '../../src/core/Random';
import { EventBus } from '../../src/core/EventBus';
import { ObjectPool } from '../../src/core/ObjectPool';
import { StateMachine, type StateTable } from '../../src/core/StateMachine';
import { SpatialHash } from '../../src/core/SpatialHash';
import { angleDiff, approachAngle, clamp, damp, hash2, wrapAngle } from '../../src/core/math';

describe('math', () => {
	it('wraps angles into (-PI, PI]', () => {
		expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
		expect(wrapAngle(0.5)).toBeCloseTo(0.5);
		expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
	});
	it('approaches angles along the shortest arc', () => {
		const a = approachAngle(3, -3, 0.1);
		expect(a).toBeGreaterThan(3);
	});
	it('damps without overshoot', () => {
		expect(damp(0, 10, 5, 1 / 60)).toBeGreaterThan(0);
		expect(damp(0, 10, 5, 100)).toBeCloseTo(10);
		expect(clamp(5, 0, 1)).toBe(1);
	});
	it('hash2 is deterministic and in [0,1)', () => {
		const a = hash2(3, -7, 1);
		expect(a).toBe(hash2(3, -7, 1));
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThan(1);
		expect(hash2(3, -7, 2)).not.toBe(a);
	});
});

describe('Random', () => {
	it('is deterministic per seed', () => {
		const a = new Random(42);
		const b = new Random(42);
		for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
	});
	it('int is inclusive and weighted respects zero weights', () => {
		const r = new Random(7);
		const seen = new Set<number>();
		for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
		expect([...seen].sort()).toEqual([1, 2, 3]);
		for (let i = 0; i < 200; i++) expect(r.weighted({ a: 1, b: 0 })).toBe('a');
	});
});

describe('EventBus', () => {
	it('delivers typed events and supports unsubscribe/once', () => {
		const bus = new EventBus<{ ping: number }>();
		const got: number[] = [];
		const off = bus.on('ping', (v) => got.push(v));
		bus.once('ping', (v) => got.push(v * 10));
		bus.emit('ping', 1);
		bus.emit('ping', 2);
		off();
		bus.emit('ping', 3);
		expect(got).toEqual([1, 10, 2]);
	});
});

describe('ObjectPool', () => {
	it('reuses released objects and honours max size', () => {
		let made = 0;
		const pool = new ObjectPool(() => ({ id: made++, used: false }), (o) => (o.used = false), 2);
		const a = pool.acquire()!;
		const b = pool.acquire()!;
		expect(pool.acquire()).toBeNull();
		a.used = true;
		pool.release(a);
		const c = pool.acquire()!;
		expect(c).toBe(a);
		expect(c.used).toBe(false);
		expect(b.id).toBe(1);
		expect(pool.inUse).toBe(2);
	});
});

describe('StateMachine', () => {
	it('runs enter/update/exit and transitions by return value', () => {
		const log: string[] = [];
		type S = 'idle' | 'run';
		const ctx = { speed: 0 };
		const table: StateTable<typeof ctx, S> = {
			idle: {
				enter: () => log.push('enter idle'),
				update: (c) => (c.speed > 0 ? 'run' : undefined),
				exit: () => log.push('exit idle'),
			},
			run: { enter: (_c, from) => log.push(`enter run from ${from}`) },
		};
		const fsm = new StateMachine(table, 'idle', ctx);
		fsm.update(0.1, 0);
		expect(fsm.current).toBe('idle');
		ctx.speed = 1;
		fsm.update(0.1, 0);
		expect(fsm.current).toBe('run');
		expect(fsm.elapsed).toBe(0);
		expect(log).toEqual(['enter idle', 'exit idle', 'enter run from idle']);
	});
});

describe('SpatialHash', () => {
	it('finds items within radius across cells', () => {
		const h = new SpatialHash<{ x: number; z: number; n: string }>(10);
		h.insert({ x: 0, z: 0, n: 'a' });
		h.insert({ x: 9, z: 9, n: 'b' });
		h.insert({ x: 30, z: 0, n: 'c' });
		const found: string[] = [];
		h.query(5, 5, 8, (it) => void found.push(it.n));
		expect(found.sort()).toEqual(['a', 'b']);
		expect(h.nearest(28, 0, 5)?.n).toBe('c');
		h.clear();
		expect(h.nearest(28, 0, 5)).toBeNull();
	});
});
