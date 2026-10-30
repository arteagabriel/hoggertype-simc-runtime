import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from './worker.mjs';

const revision = 'a'.repeat(40) + '-' + 'b'.repeat(16);
const base = `https://runtime.example.test/releases/${revision}/`;

test('streams WASM with the MIME type, embedding headers and immutable caching', async () => {
  let key;
  const result = await worker.fetch(
    new Request(base + 'hoggertype-simc.wasm'),
    {
      RUNTIME_BUCKET: {
        async get(requested) {
          key = requested;
          return {
            httpEtag: '"wasm"',
            size: 4,
            body: new Blob(['wasm']).stream()
          };
        }
      }
    }
  );

  assert.equal(key, `releases/${revision}/hoggertype-simc.wasm`);
  assert.equal(result.headers.get('Content-Type'), 'application/wasm');
  assert.equal(
    result.headers.get('Cache-Control'),
    'public, max-age=31536000, immutable'
  );
  assert.equal(result.headers.get('X-Frame-Options'), null);
  assert.equal(await result.text(), 'wasm');
});

test('serves precompressed WASM and handles HEAD without a body', async () => {
  let key;
  const result = await worker.fetch(
    new Request(base + 'hoggertype-simc.wasm', {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'gzip, br' }
    }),
    {
      RUNTIME_BUCKET: {
        async get(requested) {
          key = requested;
          return {
            httpEtag: '"gzip"',
            size: 3,
            body: new Blob(['zip']).stream()
          };
        }
      }
    }
  );

  assert.ok(key.endsWith('.wasm.gz'));
  assert.equal(result.headers.get('Content-Encoding'), 'gzip');
  assert.equal(result.headers.get('Content-Length'), '3');
  assert.equal(await result.text(), '');
});

test('preserves conditional request responses', async () => {
  const result = await worker.fetch(
    new Request(base + 'frame.html', {
      headers: { 'If-None-Match': '"frame"' }
    }),
    {
      RUNTIME_BUCKET: {
        async get() {
          return { httpEtag: '"frame"', size: 0 };
        }
      }
    }
  );

  assert.equal(result.status, 304);
  assert.equal(await result.text(), '');
});

test('rejects writes and unknown paths without touching the bucket', async () => {
  const env = {
    RUNTIME_BUCKET: {
      get() {
        assert.fail('must not read');
      }
    }
  };

  for (const file of ['.env', 'other.wasm', '../secret']) {
    assert.equal(
      (await worker.fetch(new Request(base + file), env)).status,
      404
    );
  }
  assert.equal(
    (
      await worker.fetch(
        new Request(base + 'frame.html', {
          method: 'POST'
        }),
        env
      )
    ).status,
    405
  );
});

test('does not send gzip to clients that explicitly disallow it', async () => {
  let key;
  const result = await worker.fetch(
    new Request(base + 'hoggertype-simc.wasm', {
      headers: { 'Accept-Encoding': 'gzip;q=0, br' }
    }),
    {
      RUNTIME_BUCKET: {
        async get(requested) {
          key = requested;
          return { httpEtag: '"wasm"', size: 0, body: new Blob([]).stream() };
        }
      }
    }
  );

  assert.ok(key.endsWith('.wasm'));
  assert.equal(result.headers.get('Content-Encoding'), null);
});

test('returns an uncached 404 for an unpublished release', async () => {
  const result = await worker.fetch(new Request(base + 'frame.html'), {
    RUNTIME_BUCKET: {
      async get() {
        return null;
      }
    }
  });

  assert.equal(result.status, 404);
  assert.equal(result.headers.get('Cache-Control'), null);
});
