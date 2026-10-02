// Fully procedural audio (Web Audio API): no audio files. One-shot SFX are synthesized from
// noise / oscillators on demand; loops (engine, sirens, rain, city hum) are continuous nodes
// whose gains follow the game state. Positional sounds attenuate and pan relative to the camera.

import type { World } from '../sim/World';

interface Loop {
	gain: GainNode;
	osc?: OscillatorNode;
	filter?: BiquadFilterNode;
}

export class AudioSystem {
	private ctx: AudioContext | null = null;
	private master!: GainNode;
	private sfx!: GainNode;
	private noise!: AudioBuffer;
	private engine: Loop | null = null;
	private siren: Loop | null = null;
	private rain: Loop | null = null;
	private city: Loop | null = null;
	private volume = 0.7;
	private listener = { x: 0, z: 0, yaw: 0 };
	private sirenPhase = 0;
	private lastShot = 0;

	constructor(private readonly world: World) {
		world.bus.on('sound', (e) => {
			if (e.id === 'volume') {
				this.setVolume(e.volume ?? 0.7);
				return;
			}
			this.play(e.id, e.x, e.z, e.volume ?? 1);
		});
		world.bus.on('explosion', (e) => this.play('explosion', e.x, e.z, 1));
		world.bus.on('impact', (e) => this.play('crash', e.x, e.z, Math.min(1, e.speed / 20)));
		world.bus.on('hitConfirm', () => this.play('hit', undefined, undefined, 0.5));
		world.bus.on('missionCompleted', () => this.play('success'));
		world.bus.on('missionFailed', () => this.play('fail'));
		world.bus.on('wantedChanged', (e) => {
			if (e.level > e.previous) this.play('alert');
		});
	}

	/** Must be called from a user gesture (browsers block autoplay). */
	unlock(): void {
		if (this.ctx) {
			if (this.ctx.state === 'suspended') void this.ctx.resume();
			return;
		}
		const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AC) return;
		try {
			this.ctx = new AC();
		} catch {
			return;
		}
		const ctx = this.ctx;
		this.master = ctx.createGain();
		this.master.gain.value = this.volume;
		this.master.connect(ctx.destination);
		this.sfx = ctx.createGain();
		this.sfx.connect(this.master);
		this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const d = this.noise.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
		this.engine = this.makeOscLoop('sawtooth', 60, 'lowpass', 400);
		this.siren = this.makeOscLoop('square', 700, 'lowpass', 2200);
		this.rain = this.makeNoiseLoop('highpass', 1200);
		this.city = this.makeNoiseLoop('lowpass', 260);
	}

	setVolume(v: number): void {
		this.volume = v;
		if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
	}

	suspend(on: boolean): void {
		if (!this.ctx) return;
		if (on) void this.ctx.suspend();
		else void this.ctx.resume();
	}

	private makeOscLoop(type: OscillatorType, freq: number, filterType: BiquadFilterType, cutoff: number): Loop {
		const ctx = this.ctx!;
		const osc = ctx.createOscillator();
		osc.type = type;
		osc.frequency.value = freq;
		const filter = ctx.createBiquadFilter();
		filter.type = filterType;
		filter.frequency.value = cutoff;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		osc.connect(filter).connect(gain).connect(this.master);
		osc.start();
		return { gain, osc, filter };
	}

	private makeNoiseLoop(filterType: BiquadFilterType, cutoff: number): Loop {
		const ctx = this.ctx!;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		src.loop = true;
		const filter = ctx.createBiquadFilter();
		filter.type = filterType;
		filter.frequency.value = cutoff;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		src.connect(filter).connect(gain).connect(this.master);
		src.start();
		return { gain, filter };
	}

	/** Distance attenuation + stereo pan relative to the camera. */
	private spatial(x?: number, z?: number, range = 120): { gain: number; pan: number } {
		if (x === undefined || z === undefined) return { gain: 1, pan: 0 };
		const dx = x - this.listener.x;
		const dz = z - this.listener.z;
		const d = Math.hypot(dx, dz);
		if (d > range) return { gain: 0, pan: 0 };
		const g = Math.max(0, 1 - d / range) ** 1.5;
		// Right vector of the camera: (-cos yaw, sin yaw).
		const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * -Math.cos(this.listener.yaw) + dz * Math.sin(this.listener.yaw)) / d)) : 0;
		return { gain: g, pan };
	}

	private out(pan: number): AudioNode {
		const ctx = this.ctx!;
		if (!ctx.createStereoPanner) return this.sfx;
		const p = ctx.createStereoPanner();
		p.pan.value = pan;
		p.connect(this.sfx);
		return p;
	}

	private noiseBurst(dest: AudioNode, t: number, dur: number, vol: number, filterType: BiquadFilterType, freq: number, q = 1): void {
		const ctx = this.ctx!;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = filterType;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
		src.connect(f).connect(g).connect(dest);
		src.start(t, Math.random() * 1.5);
		src.stop(t + dur + 0.05);
	}

	private tone(dest: AudioNode, t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1 = f0): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
		o.connect(g).connect(dest);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	play(id: string, x?: number, z?: number, volume = 1): void {
		const ctx = this.ctx;
		if (!ctx || ctx.state !== 'running') return;
		const loud = id.startsWith('shot') || id === 'explosion' || id === 'thunder';
		const sp = this.spatial(x, z, loud ? 260 : 90);
		const v = sp.gain * volume;
		if (v < 0.01) return;
		const t = ctx.currentTime;
		// Rate-limit very dense gunfire.
		if (id.startsWith('shot')) {
			if (t - this.lastShot < 0.025) return;
			this.lastShot = t;
		}
		const dest = this.out(sp.pan);
		switch (id) {
			case 'shot_pistol':
				this.noiseBurst(dest, t, 0.18, 0.9 * v, 'bandpass', 1800, 0.8);
				this.tone(dest, t, 0.08, 0.4 * v, 'square', 220, 60);
				break;
			case 'shot_smg':
				this.noiseBurst(dest, t, 0.1, 0.7 * v, 'bandpass', 2400, 0.9);
				break;
			case 'shot_shotgun':
				this.noiseBurst(dest, t, 0.35, 1.0 * v, 'lowpass', 1400, 0.7);
				this.tone(dest, t, 0.15, 0.5 * v, 'sine', 120, 40);
				break;
			case 'shot_rifle':
				this.noiseBurst(dest, t, 0.22, 0.9 * v, 'bandpass', 1300, 0.7);
				this.tone(dest, t, 0.1, 0.45 * v, 'square', 160, 50);
				break;
			case 'explosion':
				this.noiseBurst(dest, t, 1.6, 1.2 * v, 'lowpass', 500, 0.6);
				this.tone(dest, t, 0.9, 0.9 * v, 'sine', 90, 25);
				break;
			case 'thunder':
				this.noiseBurst(this.sfx, t + 0.4, 2.8, 0.9 * volume, 'lowpass', 180, 0.5);
				break;
			case 'crash':
				this.noiseBurst(dest, t, 0.35, 0.8 * v, 'lowpass', 900, 0.8);
				this.tone(dest, t, 0.2, 0.4 * v, 'triangle', 140, 70);
				break;
			case 'thud':
			case 'punch':
				this.tone(dest, t, 0.12, 0.6 * v, 'sine', 140, 55);
				this.noiseBurst(dest, t, 0.06, 0.3 * v, 'lowpass', 600);
				break;
			case 'swing':
				this.noiseBurst(dest, t, 0.15, 0.25 * v, 'bandpass', 900, 2);
				break;
			case 'reload':
				this.tone(dest, t, 0.04, 0.25 * v, 'square', 1800, 1200);
				this.tone(dest, t + 0.25, 0.05, 0.25 * v, 'square', 1400, 900);
				break;
			case 'empty':
			case 'switch':
				this.tone(dest, t, 0.03, 0.2 * v, 'square', 2200, 1600);
				break;
			case 'horn':
				this.tone(dest, t, 0.45, 0.25 * v, 'square', 420, 410);
				this.tone(dest, t, 0.45, 0.2 * v, 'square', 530, 520);
				break;
			case 'cash':
				this.tone(dest, t, 0.08, 0.25 * v, 'sine', 1320);
				this.tone(dest, t + 0.08, 0.14, 0.25 * v, 'sine', 1760);
				break;
			case 'pickup':
				[880, 1100, 1320].forEach((f, i) => this.tone(dest, t + i * 0.06, 0.12, 0.22 * v, 'triangle', f));
				break;
			case 'hit':
				this.tone(dest, t, 0.05, 0.2 * v, 'square', 2600, 2000);
				break;
			case 'alert':
				this.tone(dest, t, 0.18, 0.2 * v, 'sawtooth', 880, 660);
				break;
			case 'success':
				[523, 659, 784, 1047].forEach((f, i) => this.tone(dest, t + i * 0.12, 0.35, 0.22, 'triangle', f));
				break;
			case 'fail':
				[392, 330, 262].forEach((f, i) => this.tone(dest, t + i * 0.18, 0.4, 0.22, 'triangle', f));
				break;
		}
	}

	/** Per-frame update of loops and the listener. */
	update(dt: number, camX: number, camZ: number, camYaw: number, active: boolean): void {
		const ctx = this.ctx;
		if (!ctx) return;
		this.listener.x = camX;
		this.listener.z = camZ;
		this.listener.yaw = camYaw;
		const t = ctx.currentTime;
		const w = this.world;
		const p = w.player;
		const k = 0.12;
		// Engine follows the player's vehicle.
		if (this.engine) {
			const v = active && p.state === 'driving' ? p.vehicle : null;
			const sp = v ? Math.abs(v.forwardSpeed) : 0;
			const rpm = v ? 40 + (sp / v.def.maxSpeed) * 120 + v.throttle * 25 : 40;
			this.engine.osc!.frequency.setTargetAtTime(rpm, t, k);
			this.engine.filter!.frequency.setTargetAtTime(300 + rpm * 4, t, k);
			this.engine.gain.gain.setTargetAtTime(v && !v.destroyed ? 0.08 + v.throttle * 0.05 : 0, t, 0.08);
		}
		// Nearest siren wails.
		if (this.siren) {
			let best = Infinity;
			for (const v of w.vehicles.list) {
				if (!v.sirenOn) continue;
				best = Math.min(best, Math.hypot(v.x - camX, v.z - camZ));
			}
			this.sirenPhase += dt;
			const g = active && best < 220 ? (1 - best / 220) ** 1.5 * 0.09 : 0;
			const f = 650 + Math.sin(this.sirenPhase * Math.PI * 1.6) * 230;
			this.siren.osc!.frequency.setTargetAtTime(f, t, 0.03);
			this.siren.gain.gain.setTargetAtTime(g, t, 0.1);
		}
		const indoors = !!w.interiors.current;
		if (this.rain) this.rain.gain.gain.setTargetAtTime(active && !indoors ? w.weather.params.rain * 0.12 : 0, t, 0.5);
		if (this.city) {
			const busy = Math.min(1, (w.actors.count + w.vehicles.count) / 120);
			this.city.gain.gain.setTargetAtTime(active && !indoors ? 0.02 + busy * 0.05 : 0, t, 0.8);
		}
	}
}
