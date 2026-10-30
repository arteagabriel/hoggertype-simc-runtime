// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const release = JSON.parse(
  await readFile(new URL('./dist/release.json', import.meta.url), 'utf8')
);
const prefix = `releases/${release.releaseId}`;
const bucket = 'hoggertype-simc-runtime';
const files = [...release.files.map((file) => file.name), 'release.json'];

if (!/^[a-f0-9]{40}-[a-f0-9]{16}$/.test(release.releaseId)) {
  throw new Error('Invalid release ID.');
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
}).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8'
}).trim();

if (dirty || commit !== release.sourceCommit) {
  throw new Error('The release must match the current clean source checkout.');
}

for (const file of release.files) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(file.name))
    throw new Error('Invalid filename.');

  const hash = createHash('sha256');
  let bytes = 0;

  for await (const chunk of createReadStream(
    new URL(`./dist/${file.name}`, import.meta.url)
  )) {
    hash.update(chunk);
    bytes += chunk.length;
  }

  if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) {
    throw new Error(`Release file changed: ${file.name}`);
  }
}

const digest = createHash('sha256')
  .update(JSON.stringify(release.files))
  .digest('hex')
  .slice(0, 16);

if (release.releaseId !== `${commit}-${digest}`)
  throw new Error('Release manifest changed.');

// Upload the frame last so newly published clients cannot start a partial release.
files.sort((a, b) => Number(a === 'frame.html') - Number(b === 'frame.html'));

for (const name of files) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name))
    throw new Error('Invalid release filename.');

  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'r2',
      'object',
      'put',
      `${bucket}/${prefix}/${name}`,
      '--remote',
      '--file',
      `dist/${name}`,
      '--cache-control',
      'public, max-age=31536000, immutable'
    ],
    { cwd: root, stdio: 'inherit' }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Upload failed for ${name}`);
}

console.log(`Uploaded ${prefix}/frame.html`);
