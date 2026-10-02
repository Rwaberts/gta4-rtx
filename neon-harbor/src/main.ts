import './ui/styles.css';
import { Game } from './game/Game';

declare global {
	interface Window {
		__NH__?: Game;
	}
}

function boot(): void {
	const app = document.getElementById('app')!;
	try {
		const game = new Game(app);
		window.__NH__ = game;
		game.start();
	} catch (err) {
		const text = document.getElementById('loading-text');
		if (text) text.textContent = 'Failed to start: ' + (err instanceof Error ? err.message : String(err));
		throw err;
	}
}

// Let the loading screen paint before the (synchronous) city generation runs.
requestAnimationFrame(() => setTimeout(boot, 20));
