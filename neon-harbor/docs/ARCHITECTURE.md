# Neon Harbor: Architecture and Key Decisions

## Layering

```
data/  ──►  world/  ──►  sim/ (World + systems + ai/)  ──►  game/ (Game, WorldView, UiController)
  ▲            ▲              │ events (EventBus)                 │
  └────────────┴──────────────┘                                  ├──► render/ (Three.js)
                                                                 ├──► ui/ (DOM)
                                                                 └──► audio/ (Web Audio)
```

* **`sim/` never imports Three.js or the DOM.** The whole game (traffic, police, missions, saves) runs headless in Node, which is how 102 unit tests drive real gameplay scenarios in about 4 s.
* **Presentation pulls, the simulation pushes events.** Renderers read sim state every frame. One-shot reactions arrive as typed events on `World.bus`: explosions → particles, `shot` → tracers, `sound` → audio, `missionCompleted` → banner and autosave.
* **Input becomes a `PlayerControls` struct.** Edge-triggered fields are latched until the next simulation step consumes them, so presses are never lost when a frame runs 0 or several sim steps.

## Main loop

`Game.frame` clamps the frame delta to 100 ms and splits it into equal sub-steps of at most 1/60 s. `World.step` then runs the systems in a fixed order:

clock → weather → explosions → combat pre-step → player → vehicles (+ their brains) → combat → actors → traffic streaming → police → interactions → missions → ambient events → shops → vitals / death → district

Rendering happens once per frame afterwards: `WorldView`, then audio, then `UiController`.

## World representation

* **CityLayout** is fully deterministic from a seed. Districts come from weighted Voronoi seeds plus explicit rectangles (airfield) and coast rules. Roads are a 100 m grid, sparser in rural areas, with dead ends pruned so traffic never needs U-turns. POIs are snapped onto sidewalks, with a guaranteed storefront behind them.
* **StaticCollision** stores every solid as an axis-aligned box in a 16 m uniform grid. It answers circle push-out (characters), SAT oriented-box contacts (vehicles), DDA raycasts (bullets, camera, line of sight) and ground height (standing on containers).
* **RoadNetwork** holds directed lanes with right-hand offsets, quadratic turn curves, two-phase signal timing and A* routing. A ring sampler lets spawners pick lanes near the player in O(1).

## Rendering decisions

* **Chunked instancing.** Every building, roof, tree, lamp, container and marking is an instance in a per-chunk `InstancedMesh` (400 m chunks). Chunks are built lazily from a time-sliced queue (about 6 ms per frame) and shown or hidden by two distance rings: base and detail LOD.
* **Shader facades.** Windows are computed in the fragment shader from world position and face normal, so one material renders all 2.7k buildings with correct window scale. Night lighting is a single uniform.
* **One crowd draw.** All humanoids, including the player, render through 8 `InstancedMesh` parts with per-instance colour. Animation is procedural, by composing per-part matrices.
* **Fixed light budget.** There is one shadowed sun, one hemisphere and one ambient light, one headlight spot, four lamp point lights repositioned to the nearest lamps, one explosion flash and one helicopter spotlight. They are always present (intensity 0 when idle), so shader programs never recompile at runtime.

## AI architecture

* **`StateMachine<Context, State>`** is a generic FSM with `enter`, `update` and `exit`. Transitions happen by returning a state name or calling `change()` from an event handler.
* **Brains are pluggable** (`ActorBrain`, `VehicleBrain`): CivilianBrain, CombatBrain, PoliceOfficerBrain, ClerkBrain, TrafficDriver, PoliceCarBrain and FleeBrain.
* **Distance tiers.** NPCs within 70 m think at 10 Hz with full collision. Out to 160 m they think at about 2 Hz with staggered collision. Out to 260 m they get a coarse 1 Hz update and are not rendered. Beyond that they are despawned. Think ticks are de-synchronised by actor id.
* **Event-driven perception.** Gunshots, explosions and crimes are broadcast with a radius. Only actors returned by the spatial hash react. Civilian witnesses do a capped number of line-of-sight raycasts.
* **Police split decision from execution.** Each police *unit* (car plus crew) runs a decision FSM: patrol, respond, pursue, dismounted, search, standDown, roadblock. Each car and each officer has its own executor brain. A rate-limited perception pass (12 raycasts per 0.2 s) feeds `WantedSystem.spotted()`, which shares the last known position with every unit, modelling radio communication.

## Wanted model

* Crimes add heat only when **witnessed**. Police who see it report instantly and know the player's exact position. Civilians phone it in after a delay, report where the crime happened, and are capped at level 2.
* Levels come from heat thresholds. Each level's response (units, crew size, lethal policy, ramming, roadblocks, tactical vans, helicopter, search radius and time) is a row in `data/wanted.ts`.
* No line of sight for 3 s switches to **search**. Searching runs twice as fast outside the search radius. When the search time is used up, the level clears.

## Missions

Missions are pure data (`data/missions.ts`):
* targets: POI, lane, pier, entity reference, interior
* setup actions
* objectives of 11 handler types
* fail conditions
* explicit checkpoints, each listing the actions needed to rebuild state for a retry

`MissionSystem` tracks every entity a mission spawned. On failure it removes them; on success it releases them back to the world.

## Persistence

`SaveSystem` writes versioned JSON. `validate()` treats input as untrusted: it clamps numbers, drops unknown weapons, missions and vehicles, and relocates positions that are off the map. `migrate()` upgrades old versions. Loading and "New Game" share one path: reset the world, then apply a snapshot (`newGameData()` for a new game).

## Performance (measured)

| Scenario (Node, headless simulation) | Cost per 60 Hz step |
|---|---|
| Downtown noon, wanted level 3: 105 NPCs, 41 vehicles, 4 police units | ~0.16 ms |
| Stress, at caps: 240 NPCs (44 / 125 / 71 by tier), 72 vehicles | ~0.24 ms |

Rendering is about 100–180 draw calls in typical scenes, thanks to instancing. The caps (`SIM.maxActors`, `SIM.maxVehicles`) and the distance rings live in `data/config.ts`.
