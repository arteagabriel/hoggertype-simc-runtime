// SPDX-License-Identifier: GPL-3.0-only
import './stage.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.PORT ?? 3002);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.md': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip'
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = resolve(
      root,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`
    );

    if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      response.writeHead(403).end();

      return;
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();

      return;
    }

    const info = await stat(path);

    if (!info.isFile()) {
      response.writeHead(404).end();

      return;
    }

    response.writeHead(200, {
      'Content-Type': mime[extname(path)] ?? 'text/plain; charset=utf-8',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    if (request.method === 'HEAD') {
      response.end();
    } else {
      createReadStream(path).pipe(response);
    }
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`SimulationCraft runtime: http://localhost:${port}`);
});
