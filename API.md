# Browser runtime API v1

The runtime is an independent browser application. Its own worker owns a single
persistent simulation and loads WASM from the runtime release directory. There
are no imports from a consuming frontend and no shared memory with it.

Open `index.html` to use the standalone command console, or embed `frame.html`
from another application. One frame represents one session. Only the frame's
parent can connect, and a frame accepts one connection.

## Connecting

```js
const runtimeUrl = new URL(
  'https://runtime.example.com/releases/VERSION/frame.html'
);
const frame = document.createElement('iframe');
const channel = new MessageChannel();

frame.hidden = true;
frame.src = runtimeUrl.href;
frame.onload = () => {
  frame.contentWindow.postMessage(
    { type: 'connect', protocolVersion: 1 },
    runtimeUrl.origin,
    [channel.port2]
  );
};

channel.port1.onmessage = ({ data }) => {
  console.log(data);
};

document.body.append(frame);
```

Wait for `{ type: 'ready', protocolVersion: 1, runtimeVersion, simcRevision }`
on the private port before sending commands. Messages after connecting use this
port exclusively. The ready message also includes `runtimeUrl`, the resolved
immutable frame URL; clients can use it to link the matching license and source
even when they connected through `/stable/frame.html`. New sessions resolve
the stable channel again; active workers keep their existing release.

No wildcard target origin or global broadcast is required.
`{ type: 'error', error }` indicates a connection/worker failure; discard the
frame and reject outstanding commands.

## Commands

Request: `{ id: number, method: string, payload?: object }`.

| Method        | Payload                                                | Result                                             |
| ------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `start`       | `{ specializationId, heroTalentId, durationMs, seed }` | No result; call `getState` after initialization    |
| `advanceTo`   | `{ timeMs }`                                           | No result; call `getState` after advancing         |
| `cast`        | `{ spellId }` (SimC action token, e.g. `mutilate`)     | `{ status: 'executed' }` or rejected/queued result |
| `getMetadata` | None                                                   | `{ abilities: [...] }`                             |
| `getState`    | None                                                   | Current combat state                               |
| `reset`       | None                                                   | No result                                          |

Responses: `{ id, ok: true, result }` or `{ id, ok: false, error }`.
Commands execute in received order, including while WASM loads. A command error
does not prevent later commands from executing. See `api.d.ts` for the data
shapes; these describe the wire format, not objects shared with the frontend.

`timeMs` is absolute simulation time since the session started. The client owns
the clock and sends monotonically increasing timestamps. `cast` executes at
the current simulation timestamp; send `advanceTo` first when needed. Resource
costs, readiness, damage, cooldowns, and aura durations come from the engine.

Remove the frame to dispose its worker and simulation. The runtime has no
server session and sends no gameplay data to a server.

## Hosting

Serve the complete `dist/` directory on a static HTTPS origin. `.mjs` files
need a JavaScript MIME type and `.wasm` needs `application/wasm`. Allow embedding
by consuming applications: do not use `X-Frame-Options: DENY/SAMEORIGIN`; if
using CSP `frame-ancestors`, include their origins. Permit the runtime's own
module worker and WASM execution in its CSP. The consumer's CSP must allow
the runtime in `frame-src`.

No CORS permission to expose WASM to the frontend is needed: the frame loads
its own assets on its own origin. R2 holds the static release files; the
runtime worker and engine still execute on the player's computer.
