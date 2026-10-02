# Neon Harbor: Technical Plan (Phase 1)

## 1. Repository inspection

| Question | Finding |
|---|---|
| Engine / framework | None. The repository root is **gta4-rtx**, a C++20 Win32 ASI plugin (premake5 + MSVC 2022, x86) that injects into `GTAIV.exe` 1.2.0.59 and adapts its D3D9 renderer for NVIDIA RTX Remix. |
| Project structure | `src/gta4` (render hooks, light translation, anti-culling, ImGui tweak menu), `src/shared` (hooking/memory utils), `src_installer` (Win32 installer), `assets` (Remix runtime DLLs, TOML configs), `deps` (imgui, minhook, toml11, Detours, dxsdk, Remix bridge API, ...). |
| Existing assets | Remix runtime binaries, configs and a few textures. All are tied to GTA IV and none are usable for an original game. |
| Current implementation | Renderer and lighting compatibility for a retail game. It has no gameplay code of its own: the gameplay *is* GTA IV. |
| Missing systems | Everything an original game needs: engine loop, world, player, vehicles, AI, combat, police, missions, UI, economy, save/load. |
| Run / test | Needs Windows, Visual Studio 2022 and a GTA IV install. There are no automated tests, and it cannot be built or run in a Linux CI container. |

### Decision: a standalone project in `neon-harbor/`

The brief asks to reuse the existing technology where possible. It also forbids using GTA's assets, characters, map, UI and so on. The existing code only works by running inside GTA IV's executable on GTA IV's assets, so building the game on it would break that rule. It also cannot be compiled or tested here.

The closest working option is a **standalone, original game** that lives next to the mod in `neon-harbor/`. The existing mod is left untouched.

**Stack:** TypeScript + Three.js (WebGL) + Vite.

* Runs anywhere with a browser. No native toolchain or proprietary engine is needed.
* Logic can be unit-tested in Node (Vitest). Rendering can be smoke-tested in headless Chromium (Playwright).
* Every asset is generated in code: procedural geometry, a procedural city, synthesized audio. No third-party art, music or logos.

## 2. Architecture

```
neon-harbor/
  index.html, vite.config.ts, tsconfig.json
  src/
    main.ts             bootstrap
    core/               engine-agnostic utilities (no Three.js)
      EventBus, Random, math, ObjectPool, StateMachine, SpatialHash, Input
    data/               data-driven definitions (tunable without touching code)
      config, districts, vehicles, weapons, economy, missions, wanted
    world/              city simulation data (pure, testable)
      CityLayout        procedural city: districts, road grid, lots, buildings, props, POIs
      RoadNetwork       intersection graph, lanes, A* routing, traffic lights
      StaticCollision   grid-accelerated AABB world: circle/OBB resolution, raycasts, LOS
    sim/                gameplay systems (logic; talk to views through interfaces)
      VehiclePhysics, Vehicle, Actor, Player, Weapons, Wanted, Police AI, Missions,
      Economy, SaveSystem, DayNight, Weather, Spawners, Ambient events
    render/             Three.js presentation only
      CityRenderer (chunked, instanced), HumanoidRenderer (instanced crowd),
      VehicleView, Effects (pooled), Sky/Lighting, Rain
    ui/                 DOM HUD, minimap (2D canvas), menus, shop, map
    game/Game.ts        composition root and fixed-step main loop
  tests/                Vitest unit tests + Playwright smoke script
```

### Main loop
* Fixed simulation step of **1/60 s** with an accumulator (at most 5 steps per frame, so a slow frame can't snowball). Rendering is decoupled.
* Update order: input → player → AI think (staggered) → vehicle physics → actor movement → collisions → combat → wanted/police → missions → world sim → views → HUD.

### Coordinates
* Y is up, +X is east, +Z is south. 1 unit = 1 metre.
* Heading `h`: forward = `(sin h, cos h)`, right = `(-cos h, sin h)`. Three.js `rotation.y = h`.
* The ground is flat (y = 0). Buildings are axis-aligned boxes. This keeps collision and raycasts cheap and exact.

### City (procedural, deterministic from a seed)
* About 2.9 km x 2.6 km of land on a 100 m road grid. The ocean lies to the south and east.
* District map: weighted Voronoi seeds with coast overrides.
  * **Financial district**: glass towers 60-190 m.
  * **Downtown**: dense perimeter blocks and plazas.
  * **Industrial**: warehouses, tanks, stacks.
  * **Harbor**: containers, cranes, piers.
  * **Beachfront**: pastel low-rise, sand, palms, boardwalk.
  * **Residential suburbs**: houses with roofs, lawns, trees.
  * **Airport**: runway, terminal, hangars, parked aircraft.
  * **Rural outskirts**: a sparse grid of 300 m blocks, fields and barns.
* Each district sets road density, building generator, palette, window style, traffic density, pedestrian density and schedule.

### Performance strategy
* **Instancing everywhere:** buildings, roofs, props and lane markings are `InstancedMesh` per 400 m chunk. One instanced humanoid renderer draws every NPC (about 7 draw calls in total).
* **Chunk streaming:** chunk meshes are built lazily from a time-sliced queue (a few ms per frame). Chunks beyond draw distance are hidden, and far chunks evicted.
* **Shader windows:** facades compute window grids from world position (no per-building textures). Night lighting is one uniform.
* **Distance-tiered AI:** full update near the player, reduced think rate mid-range, coarse simulation far away, despawn beyond that. Think ticks are staggered across frames.
* **Pools:** vehicles, actors, tracers, particles and decals are pooled. There is no per-frame allocation in hot loops.
* **Spatial hashing:** a uniform grid for static colliders, and a dynamic hash rebuilt per step for actors and vehicles.
* **Event-driven reactions:** gunshots, crimes and explosions are published on the EventBus. Only NPCs inside the event radius (from a spatial query) react, so there is no polling of global state.
* **Throttled HUD:** DOM writes only on change. The minimap redraws at about 20 Hz.

### AI architecture
* A generic `StateMachine<TContext>` (enter / update / exit plus transitions) is shared by civilians, police officers, police units and gang members.
* **Civilians:** Wander (sidewalk loops and crosswalks), Talk, Shop, Flee, Cower, CallPolice, EnterVehicle, Dead. A district schedule sets the mix and density by hour.
* **Traffic drivers:** follow lanes on the road graph, obey per-intersection signal phases, avoid obstacles, and get stuck/reverse recovery.
* **Police unit (car):** Patrol → Respond → Pursue → Dismount → Search → Return. Roadblock is a separate stationary role.
* **Police officer (on foot):** FollowUnit → Chase → Arrest | Attack → Search → ReturnToCar.
* **Wanted system:** heat from data-driven crime values. Crimes count only when witnessed: police witness instantly, civilians phone it in after a delay. Last-known-position sharing models radio communication. Lost line of sight starts search mode, with a search radius and a cooldown that grows with the level.

### Missions
* A declarative mission script is an ordered list of objectives. Each objective has a type handler (`goto`, `enterVehicle`, `deliverVehicle`, `eliminate`, `protect`, `chase`, `loseWanted`, `hold`, `collect`, `dialogue`, `wait`), plus setup actions (spawn, set wanted, give item) and failure conditions.
* Objectives can be flagged as checkpoints. On failure the player can retry from the last checkpoint, and the runner rebuilds that checkpoint's setup.
* Rewards (cash, unlocks) and story flags go through the economy and progression systems.

### Save / load
* JSON snapshots with a schema version, written to `localStorage`. There are 3 manual slots plus an autosave.
* A validator falls back safely on corrupt data, and migrations are applied by version.

## 3. Phases

1. Plan and scaffold, core utilities, city generation and collision, with tests.
2. Player controller, camera and city rendering.
3. Vehicles: physics, damage, enter/exit, vehicle camera.
4. Road network, traffic AI and pedestrians.
5. Combat.
6. Wanted levels and police AI.
7. Mission framework and missions.
8. HUD, minimap, menus, economy, shops, interiors, save/load.
9. Day/night, weather, ambient events, audio.
10. Polish, performance, smoke tests and documentation.

After each phase: `npm run typecheck`, `npm test`, and from Phase 2 onward a headless smoke run.
