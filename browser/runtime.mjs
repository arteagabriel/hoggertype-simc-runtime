// SPDX-License-Identifier: GPL-3.0-only

const exportsByMethod = {
  start: 'hoggertype_start',
  advanceTo: 'hoggertype_advance_to',
  cast: 'hoggertype_cast',
  getMetadata: 'hoggertype_get_metadata',
  getState: 'hoggertype_get_state',
  reset: 'hoggertype_reset'
};

async function loadModule() {
  const { default: createModule } = await import('./hoggertype-simc.mjs');

  return createModule({
    locateFile: (path) => new URL(path, import.meta.url).href
  });
}

export function createDispatcher(load = loadModule) {
  let modulePromise;
  let tail = Promise.resolve();

  // Commands mutate one persistent simulation. Preserve order even while the
  // WASM module is loading, and keep accepting commands after a rejected cast.
  return (request) => {
    const task = tail.then(async () => {
      const name = Object.hasOwn(exportsByMethod, request.method)
        ? exportsByMethod[request.method]
        : undefined;

      if (!name) {
        throw new Error(`Unknown runtime method: ${request.method}`);
      }

      modulePromise ??= Promise.resolve()
        .then(load)
        .catch((error) => {
          modulePromise = undefined;

          throw error;
        });

      const simc = await modulePromise;
      const hasPayload = request.payload !== undefined;
      const raw = simc.ccall(
        name,
        'string',
        hasPayload ? ['string'] : [],
        hasPayload ? [JSON.stringify(request.payload)] : []
      );

      if (!raw) {
        return undefined;
      }

      const response = JSON.parse(raw);

      if (!response.ok) {
        throw new Error(response.error || `${name} failed.`);
      }

      return response.result;
    });

    tail = task.catch(() => {});

    return task;
  };
}
