// SPDX-License-Identifier: GPL-3.0-only
import { cp, mkdir } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const dist = new URL('./dist/', root);

await mkdir(dist, { recursive: true });

for (const file of [
  'browser/',
  'runtime.json',
  'LICENSE',
  'NOTICE',
  'API.md',
  'api.d.ts'
]) {
  await cp(
    new URL(file, root),
    file === 'browser/' ? dist : new URL(file, dist),
    {
      recursive: true,
      filter: (path) => !path.endsWith('.test.mjs')
    }
  );
}
