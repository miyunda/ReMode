// Analyzer re-check (spec §8.6): run the mode analyzer on a transform's
// output and say whether the target mode is among the rank-1 candidates.
// A diagnostic and a test assertion only; never an optimisation target.
// "Not recognised" is a legitimate answer (e.g. the output lacks the degrees
// that would establish the target) and is reported as is.

import type { AmbiguityCode, MelodyNote, ModeName, TimeSignatureEvent } from '../types.js';
import { analyzeMode } from '../analysis/analyzer.js';
import { mod } from '../theory/pitch.js';
import { modeName } from '../theory/scales.js';
import type { ModeRef } from './scaleMapping.js';

export interface RecheckResult {
  analysisVersion: string;
  target: ModeName;
  /** The target is a rank-1 candidate, under its own name or as an alias (same set and tonic). */
  recognised: boolean;
  matchedAs: 'primary' | 'alias' | null;
  /** Every rank-1 candidate (primary names). */
  rank1: ModeName[];
  ambiguities: Array<{ code: AmbiguityCode; detail: string }>;
}

export function recheckTarget(
  notes: readonly MelodyNote[],
  target: ModeRef,
  options: { ppq: number; timeSignatures?: readonly TimeSignatureEvent[] },
): RecheckResult {
  const analysis = analyzeMode(notes, { ...options, baseline: false });
  const root = mod(target.root, 12);
  const top = analysis.candidates.filter((c) => c.rank === 1);
  const primary = top.some((c) => c.rootPitchClass === root && c.scaleId === target.scaleId);
  const alias =
    !primary &&
    top.some(
      (c) =>
        c.rootPitchClass === root &&
        c.aliases.some((a) => a.rootPitchClass === root && a.scaleId === target.scaleId),
    );
  return {
    analysisVersion: analysis.analysisVersion,
    target: { rootPitchClass: root, scaleId: target.scaleId, name: modeName(root, target.scaleId) },
    recognised: primary || alias,
    matchedAs: primary ? 'primary' : alias ? 'alias' : null,
    rank1: top.map((c) => ({
      rootPitchClass: c.rootPitchClass,
      scaleId: c.scaleId,
      name: c.name,
      ...(c.chinese ? { chinese: c.chinese } : {}),
    })),
    ambiguities: analysis.ambiguities.map((a) => ({ code: a.code, detail: a.detail })),
  };
}
