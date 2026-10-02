// Phase-specific smoke scenarios registered by smoke.mjs.

export function register({ scenario, page, game, sleep, hold, shot }) {
	scenario('enter-vehicle', async () => {
		// Walk up to the owned car parked outside the safehouse.
		await game(() => {
			const g = window.__NH__;
			const v = g.world.vehicles.list.find((x) => x.role === 'owned');
			const d = v.doorPoint(-1);
			g.world.player.teleport(d.x, d.z, v.heading);
		});
		await sleep(400);
		await page.keyboard.press('KeyF');
		await page.waitForFunction(() => window.__NH__.world.player.state === 'driving', null, { timeout: 15000 });
		await sleep(300);
		await shot('10-in-vehicle');
	});

	scenario('drive', async () => {
		const before = await game(() => ({ x: window.__NH__.world.player.x, z: window.__NH__.world.player.z }));
		await page.keyboard.down('KeyW');
		// Software GL runs slower than real time, so wait on distance rather than wall clock.
		await page
			.waitForFunction(
				(b) => {
					const v = window.__NH__.world.player.vehicle;
					return v && Math.hypot(v.x - b.x, v.z - b.z) > 12;
				},
				before,
				{ timeout: 40000 },
			)
			.catch(() => {});
		await page.keyboard.up('KeyW');
		const after = await game(() => {
			const v = window.__NH__.world.player.vehicle;
			return { x: v.x, z: v.z, speed: v.speed };
		});
		await shot('11-driving');
		const moved = Math.hypot(after.x - before.x, after.z - before.z);
		if (moved < 10) throw new Error('vehicle did not move enough: ' + moved.toFixed(2));
		await page.keyboard.down('KeyS');
		await page.waitForFunction(() => window.__NH__.world.player.vehicle.speed < 1, null, { timeout: 30000 }).catch(() => {});
		await page.keyboard.up('KeyS');
		return `moved ${moved.toFixed(1)}m, top ${(after.speed * 3.6).toFixed(0)} km/h`;
	});

	scenario('exit-vehicle', async () => {
		await page.keyboard.press('KeyF');
		await page.waitForFunction(() => window.__NH__.world.player.state === 'onFoot', null, { timeout: 15000 });
		await sleep(200);
		await shot('12-exited');
	});

	scenario('vehicle-explosion', async () => {
		await game(() => {
			const g = window.__NH__;
			const v = g.world.vehicles.list.find((x) => x.role !== 'owned' && !x.destroyed);
			const p = g.world.player;
			// Stand across the road (the road is on the -x side of the parked car) looking back at it.
			p.teleport(v.x - 13, v.z, Math.PI / 2);
			g.cam.yaw = Math.PI / 2;
			g.cam.pitch = 0.15;
			g.world.vehicles.damage(v, v.def.health * 0.9, 'player');
			v.burnTimer = 1.2;
		});
		await page.waitForFunction(() => window.__NH__.world.vehicles.list.some((v) => v.burning), null, { timeout: 10000 }).catch(() => {});
		await shot('13-vehicle-burning');
		await page.waitForFunction(() => window.__NH__.world.vehicles.list.some((v) => v.destroyed), null, { timeout: 30000 });
		await sleep(150);
		await shot('14-vehicle-exploded');
	});
}
