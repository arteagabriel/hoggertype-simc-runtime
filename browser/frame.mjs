// SPDX-License-Identifier: GPL-3.0-only
import metadata from './runtime.json' with { type: 'json' };

let connected = false;

window.addEventListener('message', (event) => {
  if (
    connected ||
    event.source !== window.parent ||
    event.data?.type !== 'connect' ||
    event.ports.length !== 1
  ) {
    return;
  }

  const port = event.ports[0];

  if (event.data.protocolVersion !== metadata.protocolVersion) {
    port.postMessage({ type: 'error', error: 'Unsupported protocol version.' });
    port.close();

    return;
  }

  connected = true;

  try {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (response) => port.postMessage(response.data);
    worker.onerror = (error) => {
      port.postMessage({
        type: 'error',
        error: error.message || 'The SimulationCraft worker crashed.'
      });
    };
    port.onmessage = (request) => worker.postMessage(request.data);
    port.start();
    port.postMessage({
      type: 'ready',
      ...metadata,
      runtimeUrl: new URL('./frame.html', import.meta.url).href
    });
    window.addEventListener('pagehide', () => {
      worker.terminate();
      port.close();
    });
  } catch (error) {
    port.postMessage({ type: 'error', error: error.message });
    port.close();
  }
});
