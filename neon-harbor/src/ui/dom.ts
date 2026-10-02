// Tiny DOM helpers for building UI without a framework.

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: { class?: string; text?: string; html?: string; id?: string } = {},
	...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (attrs.class) e.className = attrs.class;
	if (attrs.id) e.id = attrs.id;
	if (attrs.text !== undefined) e.textContent = attrs.text;
	if (attrs.html !== undefined) e.innerHTML = attrs.html;
	for (const c of children) e.append(c);
	return e;
}

export function button(label: string, onClick: () => void, cls = 'menu-btn'): HTMLButtonElement {
	const b = el('button', { class: cls, text: label });
	b.addEventListener('click', (ev) => {
		ev.stopPropagation();
		onClick();
	});
	return b;
}

/** Sets textContent only when it changed (avoids layout thrash). */
export function setText(e: HTMLElement, text: string): void {
	if (e.textContent !== text) e.textContent = text;
}

export function setWidth(e: HTMLElement, pct: number): void {
	const v = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
	if (e.style.width !== v) e.style.width = v;
}
