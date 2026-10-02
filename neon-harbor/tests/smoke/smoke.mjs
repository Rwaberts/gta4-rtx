// Headless browser smoke test: boots the game in Chromium (SwiftShader WebGL), drives it through
// scripted scenarios via real keyboard input and the window.__NH__ debug handle, captures
// screenshots and fails on any console error or uncaught exception.
//
// Usage: npm run smoke [-- --only=name1,name2] [-- --keep]

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'tests/smoke/output');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({
	executablePath,
	args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
	if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = (fn, arg) => page.evaluate(fn, arg);
const results = [];

async function shot(name) {
	await page.screenshot({ path: path.join(outDir, name + '.png') });
}

async function hold(key, ms) {
	await page.keyboard.down(key);
	await sleep(ms);
	await page.keyboard.up(key);
}

const scenarios = [];
export function scenario(name, fn) {
	scenarios.push({ name, fn });
}

// ------------------------------------------------------------------ scenarios

scenario('boot', async () => {
	await page.goto(url);
	await page.waitForFunction(() => !!window.__NH__, null, { timeout: 60000 });
	await sleep(1500);
	await shot('01-main-menu');
	const state = await game(() => window.__NH__.state);
	if (state !== 'menu') throw new Error('expected menu state, got ' + state);
});

scenario('new-game', async () => {
	await page.getByText('New Game', { exact: true }).click();
	await sleep(800);
	const state = await game(() => window.__NH__.state);
	if (state !== 'playing') throw new Error('expected playing, got ' + state);
	await shot('02-on-foot');
});

scenario('walk-and-sprint', async () => {
	const before = await game(() => ({ x: window.__NH__.world.player.x, z: window.__NH__.world.player.z }));
	await hold('KeyW', 1200);
	await page.keyboard.down('ShiftLeft');
	await hold('KeyW', 1200);
	await page.keyboard.up('ShiftLeft');
	const after = await game(() => ({ x: window.__NH__.world.player.x, z: window.__NH__.world.player.z, stamina: window.__NH__.world.player.stamina }));
	const moved = Math.hypot(after.x - before.x, after.z - before.z);
	if (moved < 2) throw new Error('player did not move: ' + moved.toFixed(2));
	await shot('03-after-walk');
	return `moved ${moved.toFixed(1)}m, stamina ${after.stamina.toFixed(0)}`;
});

scenario('jump-crouch', async () => {
	await page.keyboard.press('Space');
	await sleep(150);
	const y = await game(() => window.__NH__.world.player.y);
	if (y <= 0.05) throw new Error('jump did not lift player, y=' + y);
	await page.waitForFunction(() => window.__NH__.world.player.onGround, null, { timeout: 10000 });
	await page.keyboard.press('KeyC');
	await sleep(300);
	const crouch = await game(() => window.__NH__.world.player.crouching);
	if (!crouch) throw new Error('crouch toggle failed');
	await shot('04-crouch');
	await page.keyboard.press('KeyC');
});

scenario('pause-menu', async () => {
	await page.keyboard.press('Escape');
	await sleep(300);
	const state = await game(() => window.__NH__.state);
	if (state !== 'paused') throw new Error('expected paused, got ' + state);
	await shot('05-pause');
	await page.getByText('Resume', { exact: true }).click();
	await sleep(200);
});

// Additional scenarios are registered by later phases in scenarios.mjs.
try {
	const extra = await import('./scenarios.mjs');
	extra.register?.({ scenario, page, game, sleep, hold, shot });
} catch (e) {
	if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}

let failed = 0;
for (const s of scenarios) {
	if (only.length && !only.includes(s.name) && s.name !== 'boot' && s.name !== 'new-game') continue;
	const t0 = Date.now();
	try {
		const note = await s.fn();
		results.push(`  ok   ${s.name} (${Date.now() - t0}ms)${note ? ' - ' + note : ''}`);
	} catch (e) {
		failed++;
		results.push(`  FAIL ${s.name}: ${e.message}`);
		await shot('fail-' + s.name).catch(() => {});
	}
}

const perf = await game(() => ({ fps: window.__NH__.fps, calls: window.__NH__.graphics.renderer.info.render.calls })).catch(() => null);
console.log('\nSmoke test results:');
console.log(results.join('\n'));
if (perf) console.log(`  perf (SwiftShader, software GL): ${perf.fps.toFixed(1)} fps, ${perf.calls} draw calls`);
if (errors.length) {
	console.log('\nBrowser errors:');
	for (const e of errors.slice(0, 20)) console.log('  ' + e);
}
console.log(`Screenshots: ${path.relative(root, outDir)}/`);
await browser.close();
await server.close();
process.exit(failed || errors.length ? 1 : 0);
