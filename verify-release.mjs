// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const input = process.argv[2];

if (!input)
  throw new Error('Usage: node verify-release.mjs <release-directory-url>');

const base = new URL(input.endsWith('/') ? input : `${input}/`);
const manifest = await fetch(new URL('release.json', base));

assert.equal(manifest.status, 200);

const release = await manifest.json();

for (const [file, mime] of [
  ['frame.html', 'text/html'],
  ['frame.mjs', 'text/javascript'],
  ['worker.mjs', 'text/javascript'],
  ['runtime.json', 'application/json'],
  ['source.tar.gz', 'application/gzip']
]) {
  const response = await fetch(new URL(file, base), { method: 'HEAD' });

  assert.equal(response.status, 200, file);
  assert.ok(response.headers.get('Content-Type')?.startsWith(mime), file);
  assert.equal(response.headers.get('X-Frame-Options'), null, file);
}

const expected = release.files.find(
  (file) => file.name === 'hoggertype-simc.wasm'
);
const response = await fetch(new URL('hoggertype-simc.wasm', base), {
  headers: { 'Accept-Encoding': 'gzip' }
});

assert.equal(response.status, 200);
assert.equal(response.headers.get('Content-Type'), 'application/wasm');
assert.equal(response.headers.get('Content-Encoding'), 'gzip');

const hash = createHash('sha256');
let bytes = 0;

for await (const chunk of response.body) {
  hash.update(chunk);
  bytes += chunk.length;
}

assert.equal(bytes, expected.bytes, 'Decoded WASM byte count');
assert.equal(hash.digest('hex'), expected.sha256, 'Decoded WASM checksum');
console.log(`Verified HTTPS release ${release.releaseId}`);
