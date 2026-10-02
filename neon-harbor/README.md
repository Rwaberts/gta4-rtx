# Neon Harbor

An original open-world crime-action prototype set in the fictional coastal city of **Neon Harbor**. You play **Kai Delacroix**, back in town after three years away, building the Tidewater crew between the Saltline Crew (harbor smugglers), the Velvet Kings (nightclub owners) and Councilman Edmund Thale.

Everything in the game is original and generated at runtime:
* procedural city geometry and textures
* synthesized audio
* original characters, businesses, dialogue and missions

No third-party game assets are used.

> **Why this lives next to a GTA IV mod:** the host repository is an RTX Remix compatibility mod for GTA IV. It is a Windows DLL that runs *inside* the retail game. An original game cannot be built on that without GTA IV's engine and assets, so Neon Harbor is a standalone TypeScript + Three.js project in this folder. The mod is untouched. See [`docs/TECHNICAL_PLAN.md`](docs/TECHNICAL_PLAN.md).

## Run it

Requires Node.js 20+ and a WebGL2 browser (Chrome, Edge, Firefox or Safari).

```bash
cd neon-harbor
npm install
npm run dev        # http://localhost:5173
```

Production build: `npm run build` writes static files to `dist/`. Serve that folder with any static file server, for example `npx serve dist`.

### Tests

```bash
npm run typecheck  # strict TypeScript
npm test           # 102 Vitest unit tests (simulation runs headless in Node)
npm run smoke      # headless Chromium end-to-end run with screenshots (tests/smoke/output)
```

The smoke test needs a Playwright Chromium. If none is installed, run `npx playwright install chromium`, or set `CHROMIUM_PATH`. Use `npm run smoke -- --only=drive,firefight` to run selected scenarios.

## Controls

| Action | Keys |
|---|---|
| Move / drive | `W A S D` (or arrow keys) |
| Look | Mouse. Click the game to capture the cursor |
| Sprint (uses stamina) / walk | `Shift` / `Alt` |
| Jump / handbrake | `Space` |
| Crouch | `C` or `Ctrl` |
| Enter, exit, steal or carjack a vehicle | `F` |
| Interact: shops, doors, missions, save, courier jobs | `E` |
| Fire / punch, aim | Left mouse, right mouse |
| Reload | `R` |
| Switch weapon | `Q`, mouse wheel, `1`–`6` |
| Horn / look behind (driving) | `H` / `B` |
| City map, set a waypoint | `M` (click the map) |
| Pause | `Esc` or `P` |
| Debug overlay | `` ` `` |

## What's in the game

| System | Highlights |
|---|---|
| **City** | About 2.9 × 2.6 km, generated deterministically. Eight districts, each with its own architecture, palette, density and daily schedule: Downtown, Meridian Financial, Rustline Industrial, Coral Mile Beachfront, Westbrook Suburbs, Saltline Harbor (piers, cranes, containers), Harbor Point Airfield and the Greywater rural outskirts. Lit windows and neon at night, ocean on two sides. |
| **Player** | Camera-relative movement, walk, run, sprint with stamina, jump, crouch, swimming. Health, armor, fall damage and regeneration. Interaction system. |
| **Camera** | Orbit camera with wall collision, over-the-shoulder aiming, a speed-aware vehicle chase cam, an interior mode and a menu flyover. |
| **Vehicles** | 14 original models (sedans, coupes, sports cars, SUVs, pickups, vans, trucks, buses, a limo, police interceptor, tactical van). Arcade physics with grip, drift and handbrake. Rigid-body collisions, damage, smoke, fire, explosions, sinking. Enter, exit, bail out and carjack. Headlights, brake lights, police light bars. |
| **Traffic** | Right-hand lanes on a road graph, traffic lights, car following, braking for pedestrians, recovery when stuck, panic driving. Streams in and out around the player. |
| **Pedestrians** | Wander sidewalks and cross at signals, idle, chat in pairs, shop (go inside), board parked cars and drive off. Flee or cower from gunfire, raise their hands at gunpoint, phone in crimes they witness. Density follows district and hour. |
| **Combat** | Fists, Kestrel P9 pistol, Wasp MX SMG, Thresher 12 shotgun, Halberd AR rifle and Breaker Frag grenades. Hitscan with headshots, spread and falloff, reloads, drive-bys, tracers, impacts, recoil and hit markers. |
| **Gangs** | Territorial Saltline / Velvet / Rustline crews. Neutral until provoked, then they fight as a group with strafing and burst fire. |
| **Police** | Wanted levels 0–5 driven by crimes, which only count when witnessed. The last known position is shared by radio, and losing line of sight starts a search that eventually ends. Police patrol, respond, pursue (ramming at level 3+), dismount, arrest or use lethal force, search, set up roadblocks (level 4+) and send a helicopter (level 5). |
| **Missions** | A declarative mission framework with 11 objective types, checkpoints and retry, dialogue, fail conditions, rewards and unlocks. **Six story missions:** *Low Tide*, *Static on the Line*, *Velvet Rope*, *Paper Trail*, *The Gilded Gull* (a robbery) and *Tidewater Rising*. |
| **Economy** | Cash and mission rewards. Shops: gun store, convenience store, car dealership, mechanic. Four businesses for sale that pay daily income. Hospital bills, bail, and weapons confiscated on arrest. |
| **World life** | A 24-minute day/night cycle (adjustable). Weather moves through clear, cloudy, overcast, rain, storm and sea fog, with wet roads and lightning. Random encounters: gang hangouts, muggings, broken-down cars, police traffic stops, street races and courier side jobs. |
| **UI** | Health/armor/stamina, money, heat chevrons, weapon and ammo, rotating minimap with GPS, full city map with waypoints, objectives, dialogue, interaction prompts, pause, settings, save/load and shops. |
| **Saves** | Three slots plus an autosave in `localStorage`, versioned, validated and migrated. Settings persist separately. |
| **Audio** | All synthesized with Web Audio, with distance falloff and panning: weapons, explosions, crashes, engine, sirens, rain, thunder, city ambience. |

## How to play

1. Start a **New Game** at the Tidewater Flat safehouse. Your cyan coupe is parked outside.
2. The pink **M** on the radar is Rosa at Calloway's Diner on the beachfront. Walk up and press `E` to start *Low Tide*.
3. Earn money from missions, courier jobs (strangers in yellow, shown as yellow dots on the radar) and businesses. Spend it at Ironclad Outfitters (**W**), QuikStop (**S**), Coastline Motors (**C**) and Wrench & Ratchet (**R**).
4. Save at the safehouse bed (go through the door with `E`), from the pause menu, or rely on the autosave.

## Project layout

```
src/
  core/      engine-agnostic utilities: event bus, RNG, pools, FSM, spatial hash, input
  data/      all tuning and content: districts, vehicles, weapons, wanted, economy, missions, POIs
  world/     procedural city layout, road network + A*, static collision
  sim/       gameplay simulation (no Three.js or DOM): World and all systems, ai/ brains
  render/    Three.js presentation: city chunks, crowds, vehicles, effects, sky/weather
  audio/     procedural Web Audio
  ui/        DOM HUD, menus, minimap, city map, shops, settings, save/load
  game/      composition root (Game), WorldView (sim -> render), UiController
tests/unit   Vitest suites (headless simulation)
tests/smoke  Playwright end-to-end scenarios + screenshots
docs/        technical plan and architecture notes
```

More detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Known limitations

* **Flat world.** There is no terrain elevation. Buildings and props are axis-aligned boxes, which keeps collision exact and cheap. The ground does not visually deform, and vehicles cannot jump ramps.
* **Simplified physics.** Cars use a 2D arcade model, so they can be knocked about in the plane but never flip or roll. Characters have no ragdolls: they play a procedural fall.
* **Placeholder art.** Characters, cars and buildings are low-poly procedural shapes with no skeletal animation or textures beyond the facade shader. There are no motorbikes, boats or flyable aircraft. The airfield planes are props.
* **Grid roads only.** No curved roads, highways, lane changes or overtaking. Traffic uses one lane per direction.
* **AI scope.** Police and gangs have no cover system and no proper path-finding on foot: they steer directly, collide and slide along walls. Police vehicles use the road graph when far away and direct steering up close.
* **Interiors.** Only four interior types, as separate rooms reached through doors (a teleport).
* **Performance on software GL.** Headless smoke tests run on SwiftShader at 1–3 fps, so their timing-based checks are generous. On a real GPU the default "Medium" preset targets 60 fps. Simulation cost was measured at about 0.25 ms per 60 Hz step with 240 NPCs and 72 vehicles.
* **Input.** Keyboard and mouse only: no gamepad or touch.
* **Saves.** Saved in the browser's `localStorage`, so they are per browser and per origin.

## Recommended next steps

1. **Content and art:** skinned character models with animation blending, glTF vehicle models and textured facades, ideally behind an asset pipeline with LOD swaps.
2. **Terrain and roads:** a heightfield with elevation-aware collision, plus curved roads and highways, which needs spline lanes in `RoadNetwork`.
3. **Physics:** a physics engine (for example Rapier, WASM) for 3D vehicle dynamics, ragdolls and destructible props.
4. **AI:** a navmesh for on-foot path-finding, cover selection for police and gangs, lane changes and overtaking for traffic.
5. **Systems:** gamepad support with key rebinding UI, a phone/contacts UI, radio stations, more interiors, a property management screen, more side activities (races, taxi and paramedic jobs).
6. **Rendering:** post-processing (bloom for neon, SSAO), cascaded shadows, reflections on wet roads, and offloading chunk generation to Web Workers.
7. **Story:** expand the six-mission arc into branching chapters, with gang turf control driven by the existing faction data.
