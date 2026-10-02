// Save / load slot browser.

import { SLOTS, type SaveSystem, type SlotId } from '../sim/SaveSystem';
import { formatMoney } from '../core/math';
import { button, el } from './dom';

export function saveLoadPanel(saves: SaveSystem, mode: 'save' | 'load', onLoad: (slot: SlotId) => void, back: () => void): HTMLElement {
	const panel = el('div', { class: 'menu-panel' });
	const render = () => {
		panel.innerHTML = '';
		panel.append(el('div', { class: 'menu-title', text: mode === 'save' ? 'Save Game' : 'Load Game' }));
		const list = el('div', { class: 'save-slots' });
		for (const slot of SLOTS) {
			if (mode === 'save' && slot === 'auto') continue;
			const d = saves.read(slot);
			const name = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(4)}`;
			const meta = d
				? `${new Date(d.savedAt).toLocaleString()} · ${d.location} · ${formatMoney(d.cash)} · ${d.missions.length} missions`
				: 'Empty';
			const actions = el('div');
			if (mode === 'save') {
				actions.append(
					button(d ? 'Overwrite' : 'Save', () => {
						saves.save(slot);
						render();
					}, 'menu-btn small'),
				);
			} else if (d) actions.append(button('Load', () => onLoad(slot), 'menu-btn small'));
			if (d && slot !== 'auto')
				actions.append(
					button('Delete', () => {
						saves.delete(slot);
						render();
					}, 'menu-btn small'),
				);
			list.append(el('div', { class: 'save-slot' }, el('div', {}, el('div', { text: name }), el('div', { class: 'meta', text: meta })), actions));
		}
		panel.append(list, button('Back', back));
	};
	render();
	return panel;
}
