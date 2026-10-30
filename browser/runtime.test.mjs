import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDispatcher } from './runtime.mjs';

test('serializes commands during initialization and recovers after errors', async () => {
  let finishLoading;
  const calls = [];
  const execute = createDispatcher(
    () => new Promise((resolve) => (finishLoading = resolve))
  );
  const start = execute({ method: 'start', payload: { seed: 42 } });
  const cast = execute({ method: 'cast', payload: { spellId: 'mutilate' } });
  const rejected = assert.rejects(cast, /not ready/);
  const state = execute({ method: 'getState' });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  finishLoading({
    ccall(name, returnType, argumentTypes, args) {
      calls.push({ name, argumentTypes, args });

      return JSON.stringify(
        name === 'hoggertype_cast'
          ? { ok: false, error: 'not ready' }
          : { ok: true, result: { timeMs: 0 } }
      );
    }
  });

  await start;
  await rejected;
  assert.deepEqual(await state, { timeMs: 0 });
  assert.deepEqual(
    calls.map((call) => call.name),
    ['hoggertype_start', 'hoggertype_cast', 'hoggertype_get_state']
  );
  assert.deepEqual(calls[0].args, ['{"seed":42}']);
  assert.deepEqual(calls[2].argumentTypes, []);
});

test('rejects unknown methods before loading WASM', async () => {
  const execute = createDispatcher(() => assert.fail('should not load'));

  await assert.rejects(
    execute({ method: 'toString' }),
    /Unknown runtime method/
  );
});
