// Krumhansl–Schmuckler key finding with Krumhansl–Kessler (1982) profiles.
// Comparison baseline ONLY (spec §6.5, ADR-004): the analyzer attaches its
// output as `baseline` after ranking and never reads it back.

import type { KsBaseline, KsBaselineResult, PitchClassDistribution } from '../types.js';
import { pitchClassName } from '../theory/pitch.js';

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Pearson correlation; null when either series is constant. */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export function ksBaseline(pcd: PitchClassDistribution, top = 3): KsBaseline {
  const results: KsBaselineResult[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      ['major', KK_MAJOR],
      ['minor', KK_MINOR],
    ] as const) {
      const rotated = profile.map((_, pc) => profile[(pc - tonic + 12) % 12] as number);
      const r = pearson(pcd.durations, rotated);
      if (r === null) continue;
      results.push({
        tonicPitchClass: tonic,
        mode,
        name: `${pitchClassName(tonic)} ${mode}`,
        correlation: Math.round(r * 10000) / 10000,
      });
    }
  }
  results.sort(
    (a, b) =>
      b.correlation - a.correlation ||
      a.tonicPitchClass - b.tonicPitchClass ||
      a.mode.localeCompare(b.mode),
  );
  return {
    method: 'krumhansl-schmuckler',
    profiles: 'krumhansl-kessler-1982',
    usedForRanking: false,
    top: results.slice(0, top),
  };
}
