// Architecture rules that a passing build would not catch (CLAUDE.md rule 3).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));

const importsTone = (file: string) =>
  /(?:from\s+|import\s*\(\s*|import\s+)['"]tone(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8'));

describe('audio boundaries', () => {
  it('core has no Tone.js import and no such dependency', () => {
    const files = sources(join(root, 'packages/core/src'));
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter(importsTone)).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('tone');
  });

  it('in the web app only toneBackend.ts imports Tone.js, and never its root module', () => {
    const files = sources(join(root, 'apps/web/src'));
    expect(files.filter(importsTone).map((f) => f.split('/').pop())).toEqual(['toneBackend.ts']);
    const backend = readFileSync(join(root, 'apps/web/src/audio/toneBackend.ts'), 'utf8');
    // `tone` itself builds the default Context (a blob: Worker) on import: refused by the CSP.
    expect(backend).not.toMatch(/from 'tone'/);
    expect(backend).toMatch(/clockSource: 'timeout'/);
  });

  it('nothing outside the lazy host imports toneBackend statically', () => {
    const offenders = sources(join(root, 'apps/web/src')).filter((f) =>
      /from '[^']*toneBackend'/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
