// SPDX-License-Identifier: GPL-3.0-only
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const base = process.env.RUNTIME_BASE_URL;

if (!base)
  throw new Error('Set RUNTIME_BASE_URL to the serving Worker origin.');

const local = JSON.parse(
  await readFile(new URL('./dist/release.json', import.meta.url), 'utf8')
);
const releaseId = process.argv[2] ?? local.releaseId;

if (!/^[a-f0-9]{40}-[a-f0-9]{16}$/.test(releaseId))
  throw new Error('Invalid release ID.');

const releaseUrl = new URL(`/releases/${releaseId}/`, base);

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Stable promotion failed.');
}

// Verify both first and cached downloads before changing the single pointer.
run(['verify-release.mjs', releaseUrl.href]);
run(['verify-release.mjs', releaseUrl.href]);

const response = await fetch(new URL('release.json', releaseUrl));
const release = await response.json();

if (release.releaseId !== releaseId || release.protocolVersion !== 1) {
  throw new Error('Release metadata does not match this channel.');
}

await mkdir(new URL('./.build/', import.meta.url), { recursive: true });
await writeFile(
  new URL('./.build/stable.json', import.meta.url),
  JSON.stringify({
    releaseId,
    runtimeVersion: release.runtimeVersion,
    protocolVersion: release.protocolVersion
  }) + '\n'
);

run([
  'node_modules/wrangler/bin/wrangler.js',
  'r2',
  'object',
  'put',
  'hoggertype-simc-runtime/channels/stable.json',
  '--remote',
  '--file',
  '.build/stable.json',
  '--content-type',
  'application/json',
  '--cache-control',
  'no-store'
]);

const stable = await fetch(new URL('/stable/frame.html', base), {
  redirect: 'manual'
});

if (
  stable.status !== 307 ||
  stable.headers.get('Location') !== new URL('frame.html', releaseUrl).href
) {
  throw new Error('Stable redirect did not resolve to the promoted release.');
}

console.log(`Stable runtime: ${new URL('/stable/frame.html', base).href}`);
console.log(`Promoted ${releaseId}`);
