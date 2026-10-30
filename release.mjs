// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import './stage.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const dist = new URL('./dist/', import.meta.url);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
}).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

if (dirty)
  throw new Error('Commit runtime changes before preparing a release.');

const metadata = JSON.parse(
  await readFile(new URL('runtime.json', dist), 'utf8')
);

await readFile(new URL('source.tar.gz', dist));
await pipeline(
  createReadStream(new URL('hoggertype-simc.wasm', dist)),
  createGzip({ level: 9 }),
  createWriteStream(new URL('hoggertype-simc.wasm.gz', dist))
);

const files = [];

for (const name of (await readdir(dist)).sort()) {
  if (name === 'release.json') continue;

  const hash = createHash('sha256');
  let bytes = 0;

  for await (const chunk of createReadStream(new URL(name, dist))) {
    hash.update(chunk);
    bytes += chunk.length;
  }

  files.push({ name, bytes, sha256: hash.digest('hex') });
}

const digest = createHash('sha256')
  .update(JSON.stringify(files))
  .digest('hex')
  .slice(0, 16);
const releaseId = `${sourceCommit}-${digest}`;

await writeFile(
  new URL('release.json', dist),
  JSON.stringify(
    {
      ...metadata,
      sourceCommit,
      releaseId,
      files
    },
    null,
    2
  ) + '\n'
);
console.log(`Prepared release ${releaseId}`);
