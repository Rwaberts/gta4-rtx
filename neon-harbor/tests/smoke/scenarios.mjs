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

	scenario('street-life', async () => {
		await game(() => {
			const g = window.__NH__;
			g.world.clock.setHour(12);
			const n = g.world.city.nearestNode(0, 150);
			g.world.player.teleport(n.x + 11, n.z + 30, Math.PI);
			g.cam.yaw = Math.PI;
			g.cam.pitch = 0.12;
		});
		await page.waitForFunction(
			() => {
				const w = window.__NH__.world;
				const p = w.player;
				const near = w.actors.list.filter((a) => !a.vehicle && Math.hypot(a.x - p.x, a.z - p.z) < 150).length;
				const cars = w.vehicles.list.filter((v) => v.role === 'traffic' && Math.hypot(v.x - p.x, v.z - p.z) < 260).length;
				return near > 20 && cars > 4;
			},
			null,
			{ timeout: 120000 },
		);
		await sleep(1500);
		await shot('20-street-life');
		const stats = await game(() => {
			const w = window.__NH__.world;
			return { actors: w.actors.count, vehicles: w.vehicles.count, drawn: window.__NH__.humans.rendered };
		});
		return `actors ${stats.actors}, vehicles ${stats.vehicles}, humanoids drawn ${stats.drawn}`;
	});

	scenario('gunshot-panic', async () => {
		await game(() => {
			const w = window.__NH__.world;
			w.bus.emit('gunshot', { x: w.player.x, y: 1.4, z: w.player.z, shooter: 'player', radius: 150 });
		});
		await sleep(2500);
		await shot('21-panic');
		const fleeing = await game(() => window.__NH__.world.actors.list.filter((a) => a.brain && (a.brain.state === 'flee' || a.brain.state === 'cower')).length);
		if (fleeing < 1) throw new Error('nobody reacted to the gunshot');
		return `${fleeing} civilians fleeing/cowering`;
	});

	scenario('firefight', async () => {
		await game(() => {
			const g = window.__NH__;
			const w = g.world;
			const p = w.player;
			p.invulnerable = true;
			w.combat.inventory.give('rifle', 120);
			w.combat.inventory.select('rifle');
			const yaw = g.cam.yaw;
			for (let i = 0; i < 3; i++) {
				const d = 14 + i * 3;
				w.actors.spawnFighter('saltline', p.x + Math.sin(yaw) * d + (i - 1) * 2.5, p.z + Math.cos(yaw) * d, 'pistol', { hostile: true });
			}
		});
		await page.mouse.move(640, 360);
		await page.mouse.down({ button: 'right' });
		await sleep(600);
		await page.mouse.down({ button: 'left' });
		await page
			.waitForFunction(() => window.__NH__.world.actors.list.some((a) => a.faction === 'saltline' && a.health < a.maxHealth), null, { timeout: 30000 })
			.catch(() => {});
		await shot('30-firefight');
		await page.mouse.up({ button: 'left' });
		await page.mouse.up({ button: 'right' });
		const r = await game(() => {
			const w = window.__NH__.world;
			const gang = w.actors.list.filter((a) => a.faction === 'saltline');
			return { hurt: gang.filter((a) => a.health < a.maxHealth).length, attacking: gang.filter((a) => a.brain && a.brain.state === 'attack').length, ammo: w.combat.inventory.totalAmmo('rifle') };
		});
		if (r.ammo >= 120) throw new Error('rifle did not fire');
		return `gang hurt ${r.hurt}, attacking ${r.attacking}, rifle ammo ${r.ammo}`;
	});

	scenario('grenade', async () => {
		await game(() => {
			const w = window.__NH__.world;
			w.combat.inventory.give('grenade', 2);
		});
		await page.keyboard.press('Digit6');
		await sleep(400);
		await page.mouse.down({ button: 'left' });
		await sleep(100);
		await page.mouse.up({ button: 'left' });
		await page.waitForFunction(() => window.__NH__.effects.liveParticles > 40, null, { timeout: 30000 });
		await shot('31-grenade');
		await game(() => (window.__NH__.world.player.invulnerable = false));
	});

	scenario('police-pursuit', async () => {
		const r = await game(() => {
			const g = window.__NH__;
			const w = g.world;
			const p = w.player;
			p.invulnerable = true;
			w.wanted.setLevel(3);
			// Fast-forward until a unit is close (rendering is far slower than the simulation here).
			for (let i = 0; i < 40; i++) {
				g.simulate(0.5);
				const near = w.police.units.some((u) => Math.hypot(u.x - p.px, u.z - p.pz) < 45);
				if (near) break;
			}
			const u = w.police.units.reduce((a, b) => (Math.hypot(a.x - p.px, a.z - p.pz) < Math.hypot(b.x - p.px, b.z - p.pz) ? a : b));
			g.cam.yaw = Math.atan2(u.x - p.px, u.z - p.pz);
			g.cam.pitch = 0.12;
			return { level: w.wanted.level, units: w.police.units.length, summary: w.police.summary() };
		});
		await sleep(2500);
		await shot('40-police-pursuit');
		if (r.units < 1) throw new Error('no police units');
		return `level ${r.level}, ${r.summary}`;
	});

	scenario('arrest', async () => {
		const ok = await game(() => {
			const g = window.__NH__;
			const w = g.world;
			const p = w.player;
			w.wanted.clear(true);
			g.simulate(1);
			p.invulnerable = false;
			w.combat.inventory.select('fists');
			w.wanted.setLevel(1);
			w.police.createUnit('police', p.x + 12, p.z + 4, 0, 'pursue', false, 2, false);
			for (let i = 0; i < 60 && p.state !== 'arrested'; i++) g.simulate(0.5);
			return p.state === 'arrested';
		});
		await sleep(400);
		await shot('41-in-custody');
		if (!ok) throw new Error('player was not arrested');
	});

	scenario('mission-start', async () => {
		await game(() => {
			const g = window.__NH__;
			const w = g.world;
			w.wanted.clear(true);
			w.player.invulnerable = true;
			const poi = w.city.poi('contact_rosa');
			w.player.teleport(poi.x + Math.sin(poi.facing) * 1.2, poi.z + Math.cos(poi.facing) * 1.2, poi.facing + Math.PI);
			g.cam.yaw = poi.facing + Math.PI;
		});
		await page.waitForFunction(() => !!window.__NH__.world.interactions.current, null, { timeout: 20000 });
		await page.keyboard.press('KeyE');
		await page.waitForFunction(() => !!window.__NH__.world.missions.active, null, { timeout: 20000 });
		await sleep(1200);
		await shot('50-mission-start');
		const title = await game(() => window.__NH__.world.missions.title);
		return `started "${title}"`;
	});

	scenario('mission-pier', async () => {
		await game(() => {
			const g = window.__NH__;
			const w = g.world;
			const pier = w.city.piers[1];
			w.player.teleport(pier.minX + 25, (pier.minZ + pier.maxZ) / 2 - 6, Math.PI / 2);
			g.cam.yaw = Math.PI / 2;
			g.cam.pitch = 0.2;
			g.simulate(0.5);
		});
		await sleep(2500);
		await shot('51-mission-pier');
		const idx = await game(() => window.__NH__.world.missions.active?.index ?? -1);
		if (idx !== 1) throw new Error('expected objective 1 (take the van), got ' + idx);
		await game(() => window.__NH__.world.missions.abandon());
	});

	scenario('interior', async () => {
		await game(() => {
			const w = window.__NH__.world;
			const inst = w.interiors.instanceFor('weapons_downtown');
			w.interiors.enter(inst);
		});
		await sleep(2500);
		await shot('52-interior');
		const inside = await game(() => !!window.__NH__.world.interiors.current);
		if (!inside) throw new Error('not inside');
		await game(() => window.__NH__.world.interiors.exit());
	});
}
