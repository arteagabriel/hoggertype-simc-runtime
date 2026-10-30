// SPDX-License-Identifier: GPL-3.0-only
import { createDispatcher } from './runtime.mjs';

const execute = createDispatcher();

self.onmessage = async ({ data: request }) => {
  try {
    const result = await execute(request);

    self.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
