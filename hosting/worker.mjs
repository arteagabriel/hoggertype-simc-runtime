// SPDX-License-Identifier: GPL-3.0-only
const mimeTypes = {
  'index.html': 'text/html; charset=utf-8',
  'frame.html': 'text/html; charset=utf-8',
  'console.mjs': 'text/javascript; charset=utf-8',
  'frame.mjs': 'text/javascript; charset=utf-8',
  'worker.mjs': 'text/javascript; charset=utf-8',
  'runtime.mjs': 'text/javascript; charset=utf-8',
  'hoggertype-simc.mjs': 'text/javascript; charset=utf-8',
  'hoggertype-simc.wasm': 'application/wasm',
  'runtime.json': 'application/json',
  'release.json': 'application/json',
  'source.tar.gz': 'application/gzip',
  LICENSE: 'text/plain; charset=utf-8',
  NOTICE: 'text/plain; charset=utf-8',
  'API.md': 'text/plain; charset=utf-8',
  'api.d.ts': 'text/plain; charset=utf-8'
};

export default {
  async fetch(request, env, context) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/') {
      return Response.json({
        name: 'HoggerType SimulationCraft runtime',
        source: 'https://github.com/arteagabriel/hoggertype-simc-runtime',
        releases: '/releases/<release-id>/index.html'
      });
    }

    const match = /^\/releases\/([a-f0-9]{40}-[a-f0-9]{16})\/([^/]+)$/.exec(
      url.pathname
    );
    const file = match?.[2];

    if (!file || !Object.hasOwn(mimeTypes, file)) {
      return new Response('Not found', { status: 404 });
    }

    const gzip =
      file === 'hoggertype-simc.wasm' &&
      (request.headers.get('Accept-Encoding') ?? '').split(',').some((part) => {
        const [encoding, quality] = part.trim().split(';');

        return (
          encoding === 'gzip' &&
          (!quality || Number(quality.trim().replace(/^q=/, '')) > 0)
        );
      });
    const key = `releases/${match[1]}/${file}${gzip ? '.gz' : ''}`;
    const cacheUrl = new URL(url.origin + url.pathname);

    if (gzip) cacheUrl.search = '?encoding=gzip-v2';

    const cacheKey = new Request(cacheUrl);
    const conditional =
      request.headers.has('If-None-Match') ||
      request.headers.has('If-Modified-Since') ||
      request.headers.has('If-Match') ||
      request.headers.has('If-Unmodified-Since');
    const cache = typeof caches !== 'undefined' ? caches.default : undefined;

    if (request.method === 'GET' && !conditional) {
      const cached = await cache?.match(cacheKey);

      if (cached) {
        return new Response(cached.body, {
          status: cached.status,
          headers: cached.headers,
          encodeBody: 'manual'
        });
      }
    }

    const object = await env.RUNTIME_BUCKET.get(key, {
      onlyIf: request.headers
    });

    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers({
      'Content-Type': mimeTypes[file],
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding'
    });

    // Deliberately allow the public runtime frame to be embedded by clients.
    // No X-Frame-Options, COEP, or restrictive frame-ancestors header is added.
    if (gzip) headers.set('Content-Encoding', 'gzip');

    if (!('body' in object)) {
      const failedPrecondition =
        request.headers.has('If-Match') ||
        request.headers.has('If-Unmodified-Since');

      return new Response(null, {
        status: failedPrecondition ? 412 : 304,
        headers
      });
    }

    headers.set('Content-Length', String(object.size));

    if (request.method === 'HEAD') {
      await object.body.cancel();

      return new Response(null, { headers });
    }

    const response = new Response(object.body, {
      headers,
      encodeBody: gzip ? 'manual' : 'automatic'
    });

    if (cache && !conditional) {
      const stored = new Response(response.clone().body, {
        headers: response.headers,
        encodeBody: 'manual'
      });

      context.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
    }

    return response;
  }
};
