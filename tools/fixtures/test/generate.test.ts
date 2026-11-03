import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../src/catalog.js';
import { OUTPUT_DIR, manifestJson } from '../src/generate.js';

describe('fixture generator', () => {
  it('is deterministic', () => {
    const a = buildFixtures();
    const b = buildFixtures();
    expect(a.map((f) => [...f.bytes])).toEqual(b.map((f) => [...f.bytes]));
  });

  it('matches the committed fixtures (run `pnpm fixtures` after changing the catalog)', () => {
    const fixtures = buildFixtures();
    for (const f of fixtures) {
      expect([...readFileSync(join(OUTPUT_DIR, f.file))], f.file).toEqual([...f.bytes]);
    }
    expect(readFileSync(join(OUTPUT_DIR, 'manifest.json'), 'utf8')).toBe(manifestJson());
    expect(readdirSync(OUTPUT_DIR).sort()).toEqual(
      [...fixtures.map((f) => f.file), 'manifest.json'].sort(),
    );
  });

  it('has unique file names', () => {
    const names = buildFixtures().map((f) => f.file);
    expect(new Set(names).size).toBe(names.length);
  });
});
