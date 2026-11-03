// Writes every catalog fixture plus manifest.json to fixtures/generated.
// Output is byte-for-byte deterministic; `pnpm test` verifies the committed
// files match a fresh generation.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtures } from './catalog.js';

export const OUTPUT_DIR = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));

export function manifestJson(): string {
  const entries = buildFixtures().map(({ file, description, expect, bytes }) => ({
    file,
    bytes: bytes.length,
    description,
    expect,
  }));
  return `${JSON.stringify({ generator: '@remode/fixtures', fixtures: entries }, null, 2)}\n`;
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const fixtures = buildFixtures();
  const keep = new Set([...fixtures.map((f) => f.file), 'manifest.json']);
  for (const existing of readdirSync(OUTPUT_DIR)) {
    if (!keep.has(existing)) rmSync(join(OUTPUT_DIR, existing));
  }
  for (const f of fixtures) writeFileSync(join(OUTPUT_DIR, f.file), f.bytes);
  writeFileSync(join(OUTPUT_DIR, 'manifest.json'), manifestJson());
  console.log(`Wrote ${fixtures.length} fixtures to ${OUTPUT_DIR}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
