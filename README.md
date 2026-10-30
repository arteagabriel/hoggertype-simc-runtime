# SimulationCraft browser runtime

A standalone GPLv3 browser application for interactive combat using
[SimulationCraft](https://github.com/simulationcraft/simc). This repository
contains the C++ bridge, upstream patches, embedded profiles, browser worker,
message API, and a standalone command console. It has no dependency on Next.js,
React, Chakra, or the HoggerType frontend.

The current profiles cover 27 DPS specializations and their two hero talent
choices. Tanks and healers are excluded. Engine and profile behavior are pinned
to the SimC revision in `runtime.json`, rather than tracking upstream automatically.

See [LICENSE](LICENSE), [NOTICE](NOTICE), [API.md](API.md), and the public data
shapes in [api.d.ts](api.d.ts).

## Building the runtime

Requirements:

- Node 24 (`.nvmrc` is included).
- An activated Emscripten toolchain with `em++` on your PATH.
- Git, Make, and tar. The first build fetches the pinned upstream source.

From this checkout:

```sh
nvm install
nvm use
npm ci
npm run build
npm run check:startup
npm test
npm run dev
```

Open `http://localhost:3002` for the standalone command console. It starts with
a sample Assassination Rogue configuration; execute `start`, then use
`getMetadata`, `cast`, `advanceTo`, and `getState` to inspect the simulation.

`npm run build` applies all six patches, embeds the profiles, and produces the
WASM and browser application in `dist/`. `npm run dev` only stages the browser
files and starts a local static server; it does not compile missing WASM or
rebuild changed C++ code. Build artifacts and `.build/` caches are ignored by Git.

`npm run check:startup` checks all 54 spec/hero combinations, including initial
readiness and unused combat cooldowns. Permanent pets may attack at combat
initialization. `npm test` checks the JavaScript command dispatcher.

## Using the runtime from another application

The standalone console uses the runtime's own worker. Other applications embed
`frame.html` and connect through the versioned MessagePort API documented in
[API.md](API.md). Each frame owns one worker and one persistent simulation.
Consumers do not import the WASM or worker and do not share engine memory.

HoggerType's frontend uses `NEXT_PUBLIC_SIMC_RUNTIME_URL` to select a release's
`frame.html`. Its local default is `http://localhost:3002/frame.html`. That
environment variable belongs to the frontend; this runtime does not need it.

All simulation executes on the player's computer. The static host serves the
runtime files; it does not perform simulation or retain gameplay sessions.

## Combat behavior

The bridge deliberately makes foreground casts and full channels resolve
immediately and removes the global cooldown. Cooldowns, charges, resource costs,
damage, buffs, debuffs, and periodic effects still follow SimC. Empower ranks
come from the embedded APL action variants; Tip the Scales uses SimC's behavior.

Profiles provide preset talents, gear, raid buffs, and default consumables.
Precombat setup is restricted to buffs, forms, stealth, permanent pets,
consumables, and APL variables. Offensive casts and combat cooldowns require
client commands. The bridge cancels automatic player decision events.

The initialized foreground APL actions generate the runtime's ability catalog.
Consumers can filter or order that catalog for their own interface. Spell names,
IDs, costs, cooldowns, charges, aura state, and damage come from SimC. Icon
rendering, tooltips, typing, automatic Thistle Tea use, and ability-bar layouts
are responsibilities of the consuming application.

Combat state includes:

- `abilityReadiness`: SimC class readiness with APL priority expressions removed.
- `resourceAffordability`: dynamic resource costs, including free-cast effects.
- `refreshableDots`: SimC's refreshability calculation for periodic effects.
- Resource `gained` and `overflowed` totals, plus fractional resource values.
- Per-rune `segments` for Death Knight recharge progress.

The bridge owns the bounded event queue; `advanceTo` moves it to the requested
simulation timestamp, and `cast` injects the selected ability at that timestamp.
See [API.md](API.md) for the browser command and response format.

## Releases and corresponding source

`runtime.json` records the upstream revision, runtime version, and protocol
version. Bump the runtime version when the bridge, engine, profiles, or runtime
application changes. Change the protocol version for incompatible API changes.

Before distributing a binary release, build and validate it, then run:

```sh
npm run source
```

This produces `dist/source.tar.gz` containing the complete unmodified pinned
upstream source and notices, plus this application's bridge, patches, profiles,
browser code, and build instructions. It excludes build caches, generated
artifacts, Git history, and the separate frontend. Packaging requires the pinned
Git checkout populated by the build.

To build from an extracted source archive without fetching upstream, activate
Emscripten and run from the archive's root:

```sh
SIMC_SOURCE_DIR="$PWD/upstream" bash runtime/build-wasm.sh
```

Use a clean extracted upstream tree: the build applies the patches in place.

Serve the complete `dist/` directory, including the matching source archive and
license notices, under an immutable HTTPS release URL. `.mjs` and `.wasm` need
appropriate MIME types, and the host must allow consumers to embed `frame.html`.
See [hosting requirements](API.md#hosting).

The runtime is hosted on R2 through a Cloudflare Worker. The verified initial
release is available in the
[standalone console](https://hoggertype-simc-runtime.hoggertype-simc-runtime.workers.dev/releases/be38f13c1cf1358645137a4ce107dd6e568f25e0-2d9255799a881bc5/index.html).
Use the same release directory's `frame.html` when configuring a frontend.

GitHub Actions builds, checks, and publishes releases to R2 automatically on
pushes to `main`, excluding documentation-only changes. The workflow deploys
the serving Worker and verifies both first and cached WASM downloads. Existing
clients retain their pinned release URL until their own configuration changes.
The initial release above was published with the authenticated local CLI.

## R2 deployment

The bucket remains private. The small Worker in `hosting/worker.mjs` serves
only known release files, with correct MIME types, immutable cache headers,
and gzip-compressed WASM when the browser supports it. Simulation still runs
in the browser; the Worker only streams files from R2. A `workers.dev` address
can serve the initial deployment without buying or configuring a domain.

Install tooling with `npm ci`, create a Cloudflare account, enable R2 in the
dashboard, and authenticate:

```sh
npx wrangler login
npx wrangler r2 bucket create hoggertype-simc-runtime
```

Commit source changes, build, validate, and prepare the release:

```sh
npm run build
npm run check:startup
npm run check:warrior
npm test
npm run source
npm run release
npm run publish:r2
npm run deploy:host
npm run promote:stable
```

`release.json` records the source commit and SHA-256 checksums. The release ID
combines the source commit with a digest of the actual artifacts, so a rebuild
with different bytes gets a different URL. Publication verifies the checksums
and clean source checkout before uploading; `frame.html` is uploaded last.
Keep old release prefixes for existing frontend deployments.

Set the production frontend's `NEXT_PUBLIC_SIMC_RUNTIME_URL` once to:

```text
https://<worker-address>/stable/frame.html
```

The stable address sends an uncached redirect to an immutable release. Its
relative assets therefore remain pinned to one build for the whole browser
session. Promotion updates a single R2 pointer only after both live checksum
checks pass. Existing games continue using their loaded worker. Direct
`/releases/<release-id>/frame.html` URLs remain available for explicit pinning.

Warrior auto-attacks are armed as passive events and start when simulation time
advances. Charge remains a manual action; its opening-use state is consumed by
the class readiness patch. Periodic child actions such as `rend_dot` are reported
under their playable ability token, including duration and refreshability.
`npm run check:warrior` verifies both hero builds for Arms and Fury.

Player casts use SimC's virtual cast-start hooks and retain their natural
`execute_time()` and proc snapshots. The instant-cast patch schedules their
completion at the current timestamp without cast delays, spell queues, or
cast-based auto-attack delays. Background actions retain native timing. Druid
effects that normally wait for the next APL selection resolve immediately in
this mode because the APL does not drive player actions.
`npm run check:cast-procs` verifies actual WASM proc consumption and immediate
completion, including Fire Mage and Affliction Warlock.

For automatic deployment from GitHub Actions, configure repository variable
`CLOUDFLARE_ACCOUNT_ID` and secret `CLOUDFLARE_API_TOKEN` using a scoped token
with permission to upload to this R2 bucket and deploy the serving Worker.
Set repository variable `RUNTIME_BASE_URL` to the Worker's HTTPS origin so the
workflow can verify the actual hosted WASM after deployment.
Do not commit tokens, put them in the frontend, or store an expiring local
Wrangler OAuth token as the Actions secret. Without the account variable,
Actions only builds, tests, and uploads a downloadable release artifact.

To verify a hosted release, including its decompressed WASM checksum, run:

```sh
npm run verify:release -- https://<worker-address>/releases/<release-id>/
```

Run it twice to verify both the initial response and a cached download.
