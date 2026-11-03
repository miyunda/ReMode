import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_VERSION,
  analyzeMode,
  computePcd,
  importMidi,
  ksBaseline,
  matchAllCollections,
  pitchClassName,
} from '../src/index.js';
import { fixtureBytes, manifest, notesOf } from './helpers.js';

const opts = { ppq: 480, timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] };

const allAnalyses = () =>
  manifest().flatMap(({ file }) => {
    const r = importMidi(fixtureBytes(file));
    if (!r.ok) return [];
    return r.midi.tracks.map((t) => analyzeMode(t.notes, r.midi.metadata));
  });

describe('collection detection', () => {
  it('C D E G A is compatible with the C, F and G diatonic sets', () => {
    const pcd = computePcd(
      notesOf([
        [60, 0, 1],
        [62, 1, 1],
        [64, 2, 1],
        [67, 3, 1],
        [69, 4, 1],
      ]),
    );
    const diatonic = matchAllCollections(pcd)
      .filter((m) => m.collectionId === 'diatonic' && m.coverage === 1)
      .map((m) => pitchClassName(m.transposition));
    expect(diatonic.sort()).toEqual(['C', 'F', 'G']);
    const c = matchAllCollections(pcd).find(
      (m) => m.collectionId === 'diatonic' && m.transposition === 0,
    )!;
    expect(c.unusedDegrees).toEqual([5, 11]);
  });

  it('falls back to the best diatonic set and flags CHROMATIC_HEAVY when nothing reaches the threshold', () => {
    const chromatic = notesOf(
      Array.from({ length: 12 }, (_, i) => [60 + i, i, 1] as [number, number, number]),
    );
    const a = analyzeMode(chromatic, opts);
    expect(a.compatibleCollections).toEqual([]);
    expect(a.ambiguities.map((x) => x.code)).toContain('CHROMATIC_HEAVY');
    expect(a.candidates.every((c) => c.warnings.includes('BELOW_COVERAGE_THRESHOLD'))).toBe(true);
  });
});

describe('analyzeMode invariants', () => {
  it('handles an empty melody', () => {
    const a = analyzeMode([], opts);
    expect(a.candidates).toEqual([]);
    expect(a.ambiguities.map((x) => x.code)).toEqual(['TOO_SHORT']);
    expect(a.baseline).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const notes = notesOf([
      [62, 0, 1],
      [60, 1, 1],
      [64, 2, 2],
    ]).map((n) => Object.freeze(n));
    const before = JSON.stringify(notes);
    analyzeMode(Object.freeze([...notes].reverse()), opts);
    expect(JSON.stringify(notes)).toBe(before);
  });

  it('records the analysis version and config; custom config is marked', () => {
    const notes = notesOf([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 2],
    ]);
    expect(analyzeMode(notes, opts).analysisVersion).toBe(ANALYSIS_VERSION);
    const custom = analyzeMode(notes, { ...opts, config: { coverageThreshold: 0.9 } });
    expect(custom.analysisVersion).toBe(`${ANALYSIS_VERSION}+custom`);
    expect(custom.config.coverageThreshold).toBe(0.9);
    expect(custom.config.evidencePoints.FINAL_NOTE).toBe(6);
  });

  it('evidence points are integers and evidencePoints is their plain sum', () => {
    for (const a of allAnalyses()) {
      for (const c of a.candidates) {
        for (const e of c.tonicEvidence) expect(Number.isInteger(e.points)).toBe(true);
        expect(c.evidencePoints).toBe(c.tonicEvidence.reduce((s, e) => s + e.points, 0));
      }
    }
  });

  it('every ambiguity carries a code and affected scale IDs (Invariant G)', () => {
    for (const a of allAnalyses()) {
      for (const amb of a.ambiguities) {
        expect(amb.code).toMatch(/^[A-Z_]+$/);
        if (a.candidates.length > 0) expect(amb.affectedScaleIds.length).toBeGreaterThan(0);
      }
    }
  });

  it('never reports a percentage or probability (Invariant G)', () => {
    for (const a of allAnalyses()) {
      const json = JSON.stringify(a);
      expect(json).not.toMatch(/%|％|百分/);
      expect(json).not.toMatch(/"(confidence|probability|likelihood)"/i);
    }
  });
});

describe('K-S baseline', () => {
  it('is reported but never changes the ranking', () => {
    for (const { file } of manifest()) {
      const r = importMidi(fixtureBytes(file));
      if (!r.ok) continue;
      for (const t of r.midi.tracks) {
        const withBaseline = analyzeMode(t.notes, r.midi.metadata);
        const without = analyzeMode(t.notes, { ...r.midi.metadata, baseline: false });
        const { baseline, ...rest } = withBaseline;
        expect(rest).toEqual(without);
        if (t.noteCount > 0) expect(baseline?.usedForRanking).toBe(false);
      }
    }
  });

  it('finds C major for a C major scale', () => {
    const pcd = computePcd(
      notesOf([0, 2, 4, 5, 7, 9, 11, 12].map((d, i) => [60 + d, i, d === 0 || d === 12 ? 2 : 1])),
    );
    expect(ksBaseline(pcd).top[0]).toMatchObject({ name: 'C major' });
  });
});

describe('core purity', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it('imports nothing from Node, the DOM, React, Tone.js or Cloudflare', () => {
    for (const file of files(srcDir)) {
      const src = readFileSync(file, 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, file).toMatch(/^(\.{1,2}\/|@tonejs\/midi$)/);
      }
      expect(src, file).not.toMatch(/\b(window|document|navigator)\./);
    }
  });
});
