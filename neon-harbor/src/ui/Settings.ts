// Player settings: persisted to localStorage (with safe fallbacks) and applied live.

import { button, el } from './dom';

export type QualityName = 'low' | 'medium' | 'high';

export interface Settings {
	quality: QualityName;
	drawDistance: number;
	shadows: boolean;
	sensitivity: number;
	invertY: boolean;
	fov: number;
	traffic: number;
	peds: number;
	volume: number;
	clockSpeed: number;
	showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	quality: 'medium',
	drawDistance: 750,
	shadows: true,
	sensitivity: 1,
	invertY: false,
	fov: 65,
	traffic: 1,
	peds: 1,
	volume: 0.7,
	clockSpeed: 1,
	showFps: false,
};

const KEY = 'neon-harbor:settings';

export function loadSettings(): Settings {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
		const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
		for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
			if (typeof raw[k] === typeof DEFAULT_SETTINGS[k]) s[k] = raw[k];
		}
		return s as unknown as Settings;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(s: Settings): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(s));
	} catch {
		/* storage unavailable */
	}
}

/** Builds the settings screen. `onChange` is called after every edit. */
export function settingsPanel(s: Settings, onChange: (s: Settings) => void, back: () => void): HTMLElement {
	const bag = s as unknown as Record<string, unknown>;
	const grid = el('div', { class: 'settings-grid' });
	const commit = () => {
		saveSettings(s);
		onChange(s);
	};
	const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
		const input = document.createElement('input');
		input.type = 'range';
		input.min = String(min);
		input.max = String(max);
		input.step = String(step);
		input.value = String(s[key]);
		const val = el('span', { class: 'val', text: fmt(s[key] as number) });
		input.addEventListener('input', () => {
			bag[key] = Number(input.value);
			val.textContent = fmt(Number(input.value));
			commit();
		});
		grid.append(el('label', { text: label }), input, val);
	};
	const toggle = (label: string, key: keyof Settings) => {
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = Boolean(s[key]);
		input.addEventListener('change', () => {
			bag[key] = input.checked;
			commit();
		});
		grid.append(el('label', { text: label }), input, el('span'));
	};
	const quality = document.createElement('select');
	for (const q of ['low', 'medium', 'high'] as const) {
		const o = document.createElement('option');
		o.value = q;
		o.textContent = q[0].toUpperCase() + q.slice(1);
		o.selected = s.quality === q;
		quality.append(o);
	}
	quality.addEventListener('change', () => {
		s.quality = quality.value as QualityName;
		commit();
	});
	grid.append(el('label', { text: 'Graphics quality' }), quality, el('span'));
	slider('Draw distance', 'drawDistance', 400, 1200, 50, (v) => `${v} m`);
	toggle('Shadows', 'shadows');
	slider('Field of view', 'fov', 55, 90, 1, (v) => `${v}°`);
	slider('Mouse sensitivity', 'sensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2));
	toggle('Invert mouse Y', 'invertY');
	slider('Traffic density', 'traffic', 0, 2, 0.1, (v) => `${Math.round(v * 100)}%`);
	slider('Pedestrian density', 'peds', 0, 2, 0.1, (v) => `${Math.round(v * 100)}%`);
	slider('Master volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
	slider('Day length', 'clockSpeed', 0.25, 4, 0.25, (v) => `${Math.round(24 / v)} min`);
	toggle('Show FPS / debug', 'showFps');
	return el('div', { class: 'menu-panel' }, el('div', { class: 'menu-title', text: 'Settings' }), grid, button('Back', back));
}
