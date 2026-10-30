// SPDX-License-Identifier: GPL-3.0-only
import { mkdtemp, mkdir, cp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import metadata from './runtime.json' with { type: 'json' };

const root = fileURLToPath(new URL('./', import.meta.url));
const upstream = process.env.SIMC_SOURCE_DIR ?? join(root, '.build/simc');
const temporary = await mkdtemp(join(tmpdir(), 'hoggertype-source-'));
const bundle = join(temporary, 'source');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      ...options
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with status ${code}`));
      }
    });
  });
}

try {
  await mkdir(join(bundle, 'upstream'), { recursive: true });
  await cp(root, join(bundle, 'runtime'), {
    recursive: true,
    filter: (path) => {
      const relative = path.slice(root.length);

      return (
        !['.build', 'dist', '.git', 'node_modules'].some(
          (name) => relative === name || relative.startsWith(`${name}/`)
        ) && !relative.startsWith('.env')
      );
    }
  });

  const archive = spawn('git', [
    '-C',
    upstream,
    'archive',
    metadata.simcRevision
  ]);
  const tarPath = join(temporary, 'upstream.tar');
  const exited = new Promise((resolve, reject) => {
    archive.on('error', reject);
    archive.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git archive exited with status ${code}`));
    });
  });

  archive.stderr.pipe(process.stderr);
  await Promise.all([
    pipeline(archive.stdout, createWriteStream(tarPath)),
    exited
  ]);
  await run('tar', ['-xf', tarPath, '-C', join(bundle, 'upstream')]);
  await writeFile(
    join(bundle, 'README.txt'),
    `Corresponding source for ${metadata.runtimeVersion}\n` +
      `SimulationCraft revision: ${metadata.simcRevision}\n\n` +
      'upstream/ contains the complete unmodified pinned source and notices.\n' +
      'runtime/ contains the bridge, patches, profiles, browser app and build scripts.\n' +
      'See runtime/README.md for build requirements. To build without fetching upstream:\n' +
      'SIMC_SOURCE_DIR="$PWD/upstream" bash runtime/build-wasm.sh\n'
  );
  await mkdir(join(root, 'dist'), { recursive: true });
  await run('tar', [
    '-czf',
    join(root, 'dist/source.tar.gz'),
    '-C',
    bundle,
    '.'
  ]);
  console.log(
    'Created dist/source.tar.gz with runtime and pinned upstream source.'
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
