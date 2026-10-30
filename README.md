# SimulationCraft browser runtime

This is a standalone GPLv3 browser application. It contains SimC integration,
the C++ bridge, patches, profiles,
worker, message API, and a command console. It does not depend on Next.js,
React, Chakra, or the HoggerType frontend. See [LICENSE](LICENSE), [NOTICE](NOTICE),
and [API.md](API.md).

Node 24 and Emscripten are required to build. No npm dependencies are required.
The public data contract is documented in `API.md` and `api.d.ts`.

HoggerType runs combat engines behind the same `CombatEngine` interface. The
SimulationCraft runtime supports every DPS specialization and both of its hero
talent trees. Tank and healer specializations are intentionally excluded. The
selected specialization chooses an embedded profile while the initialized
profile's APL continues to generate its playable ability catalog.

## Runtime contract

The runtime build produces:

```text
dist/index.html
dist/frame.html
dist/worker.mjs
dist/hoggertype-simc.mjs
dist/hoggertype-simc.wasm
```

The module must enable `ccall` and export these C functions:

```text
hoggertype_start(json_config)
hoggertype_advance_to(json_time)
hoggertype_cast(json_spell)
hoggertype_get_metadata()
hoggertype_get_state()
hoggertype_reset()
```

Each function returns a JSON envelope:

```json
{ "ok": true, "result": {} }
```

or:

```json
{ "ok": false, "error": "reason" }
```

The bridge owns one persistent `sim_t` for the entire run. `advance_to` must
process the SimulationCraft event queue only through the requested timestamp;
`cast` must inject one player-selected action without invoking the normal APL.
HoggerType deliberately removes foreground cast times, channel durations as
player locks, and the global cooldown. Completing a word therefore executes
its action immediately; cooldowns, charges, resources, damage, auras, and
periodic effects still use SimC's combat model. All remaining ticks of a
channeled ability resolve immediately at the current simulation timestamp.
The playable catalog is generated from the initialized foreground actions in
the profile's combat APL. SimC supplies each token, spell ID, display name,
description, resource cost, cooldown, DoT, buff, and debuff state. Adding a
spell to the APL therefore makes it available without a matching frontend
constant.

DoT state also includes a `refreshableDots` map generated through SimC's own
`dot_refreshable` calculation. The UI uses it for Pandemic-window styling so
talents, resources, and spell-specific refresh behavior remain authoritative
in SimC instead of being duplicated in frontend formulas.

Combat state exposes `abilityReadiness` through the class's virtual
`action_ready()` method with APL `if` and target-priority expressions removed
for the duration of the check. This retains class cast requirements even when
they live outside `ready()`. The UI uses this map instead of individual spell
requirements. `resourceAffordability` remains separate to support automatic
Thistle Tea and the resource-starvation icon styling.

Resource state includes cumulative `gained` and `overflowed` values from SimC.
The UI uses both values to surface resource-generation events even when a
refund occurs at the resource cap and the displayed amount does not change.

Point resources can also expose fractional fill. Death Knight runes include a
six-entry `segments` array sourced from each SimC rune slot's exact fill level.
Evoker Essence and Warlock Soul Shards use SimC's fractional aggregate value,
which the UI distributes across their point indicators. Combo Points, Chi, and
Holy Power remain discrete because they are granted as whole points rather
than continuously regenerated.

`runtime.json` pins upstream SimulationCraft revision
`710c2408bfd3ae4df71b8cd55cdf01f63fd6c926`, the bridge version, and API version.
Run replays require deterministic engine versioning. Bump the runtime version
whenever the engine, bridge, or embedded profiles change.

## Building the runtime

Activate Emscripten, then run:

```sh
npm run build
npm run check:startup
npm test
npm run source
npm run dev
```

The script checks out the pinned SimC revision, applies the bounded-event and
live-damage patch, embeds the DPS profiles, and writes both browser artifacts
to `dist/`. The worker loads that runtime lazily when a run starts.
Missing artifacts and unsupported specializations surface as setup errors;
there is no mock fallback.

Visit `http://localhost:3002` for the standalone console. `npm run dev` stages
the browser application without rebuilding WASM. For an archived source bundle,
set `SIMC_SOURCE_DIR` to its extracted `upstream/` directory before building;
this skips Git checkout and applies patches to that clean source tree.

`npm run source` packages the complete pinned upstream source (including its
licenses) together with the bridge, patches, profiles, and build scripts into
`dist/source.tar.gz`. It requires the pinned Git checkout from a build. Serve
that matching archive alongside every binary release. The generated artifacts
and local build cache are ignored by Git.

Deploy all of `dist/` to a versioned static HTTPS directory on R2. The client
embeds `frame.html` and talks over a private MessagePort; it does not import the
runtime's worker or WASM. See `API.md` for embedding and hosting headers.
The frontend's `NEXT_PUBLIC_SIMC_RUNTIME_URL` should point to that immutable
release's `frame.html`. Locally it defaults to `http://localhost:3002/frame.html`.

The embedded profiles enable SimC's optimal raid setup and their default
potions, flasks, food, augmentation runes, and weapon enchants. The bridge
filters the initialized precombat list to setup actions (raid buffs, forms,
stealth, permanent pets, consumables, and APL variables) before combat begins.
Damage spells and combat cooldowns require typed input. It then cancels
automatic decision events so player keystrokes control combat actions.

After rebuilding, run `node check-startup.mjs` to verify all
54 spec/hero combinations start with combat cooldowns unused and both Arcane
profiles start at full mana without automatically activating Arcane Surge.
Permanent pets may begin attacking when combat begins; their damage is
excluded from the zero-startup-damage assertion.

Spell and aura IDs come from SimC. The UI uses those IDs for Wowhead links and
powered tooltips; its icon route resolves Wowhead's icon name and redirects to
the corresponding `wow.zamimg.com` asset.

Upstream SimulationCraft does not currently expose a browser-ready persistent
combat API. Building these artifacts therefore requires a small upstream patch
for bounded event-queue execution plus the C bridge described above; a normal
CLI build cannot satisfy this contract.

Apply `patches/0001-add-bounded-event-execution.patch` to the pinned revision.
It adds `event_manager_t::execute_until(timespan_t)` while leaving the normal
full-simulation `execute()` behavior intact. The bridge should use only the
bounded method after combat initialization.
