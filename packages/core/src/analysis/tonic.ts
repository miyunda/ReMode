// Step 2 of mode analysis (spec §6.4): named evidence for each tonic candidate.

import type {
  AnalysisConfig,
  MelodyNote,
  TimeSignatureEvent,
  TonicEvidence,
  TonicEvidenceKind,
} from '../types.js';
import { mod, pitchClass, pitchClassName } from '../theory/pitch.js';
import { metricWeight } from './meter.js';
import type { Phrase } from './phrases.js';

export interface EvidenceContext {
  first: MelodyNote;
  final: MelodyNote;
  /** Last note of every phrase except the final one (that is FINAL_NOTE). */
  phraseEnds: MelodyNote[];
  longNotes: MelodyNote[];
  strongBeatNotes: MelodyNote[];
  lowest: MelodyNote;
  highest: MelodyNote;
}

export function buildEvidenceContext(
  sorted: readonly MelodyNote[],
  phrases: readonly Phrase[],
  ppq: number,
  timeSignatures: readonly TimeSignatureEvent[],
  config: AnalysisConfig,
): EvidenceContext | null {
  const first = sorted[0];
  const final = sorted[sorted.length - 1];
  if (!first || !final) return null;
  const mean = sorted.reduce((a, n) => a + n.durationTick, 0) / sorted.length;
  let lowest = first;
  let highest = first;
  for (const n of sorted) {
    if (n.pitch < lowest.pitch) lowest = n;
    if (n.pitch > highest.pitch) highest = n;
  }
  return {
    first,
    final,
    phraseEnds: phrases.slice(0, -1).flatMap((p) => p.notes.slice(-1)),
    longNotes: sorted.filter((n) => n.durationTick >= config.longNoteFactor * mean),
    strongBeatNotes: sorted.filter(
      (n) => metricWeight(n.startTick, ppq, timeSignatures) !== 'weak',
    ),
    lowest,
    highest,
  };
}

const ids = (notes: readonly MelodyNote[]) => notes.map((n) => n.id);

function scaled(
  kind: TonicEvidenceKind,
  pool: readonly MelodyNote[],
  tonic: number,
  maxPoints: number,
  describe: (matched: number, of: number) => string,
): TonicEvidence | null {
  const hits = pool.filter((n) => pitchClass(n.pitch) === tonic);
  if (hits.length === 0) return null;
  const points = Math.round((maxPoints * hits.length) / pool.length);
  if (points === 0) return null;
  return {
    kind,
    noteIds: ids(hits),
    points,
    matched: hits.length,
    of: pool.length,
    detail: describe(hits.length, pool.length),
  };
}

/**
 * Evidence that `tonic` is the tonic. Binary kinds (FINAL_NOTE, FIRST_NOTE,
 * AMBITUS) score their configured points; count-based kinds score
 * round(points × matched / of). Only evidence worth at least one point is
 * returned, so a count-based kind that rounds to 0 is omitted.
 */
export function tonicEvidence(
  tonic: number,
  ctx: EvidenceContext,
  config: AnalysisConfig,
): TonicEvidence[] {
  const name = pitchClassName(tonic);
  const pts = config.evidencePoints;
  const out: TonicEvidence[] = [];

  if (pitchClass(ctx.final.pitch) === tonic) {
    out.push({
      kind: 'FINAL_NOTE',
      noteIds: [ctx.final.id],
      points: pts.FINAL_NOTE,
      matched: 1,
      of: 1,
      detail: `尾音为 ${name}`,
    });
  }

  const optional = [
    scaled(
      'PHRASE_END',
      ctx.phraseEnds,
      tonic,
      pts.PHRASE_END,
      (m, of) => `${of} 个非末句中 ${m} 个结束于 ${name}`,
    ),
    scaled(
      'LONG_NOTE',
      ctx.longNotes,
      tonic,
      pts.LONG_NOTE,
      (m, of) => `${of} 个长音中 ${m} 个为 ${name}`,
    ),
    scaled(
      'STRONG_BEAT',
      ctx.strongBeatNotes,
      tonic,
      pts.STRONG_BEAT,
      (m, of) => `${of} 个强拍/次强拍音中 ${m} 个为 ${name}`,
    ),
  ];
  for (const e of optional) if (e) out.push(e);

  const low = pitchClass(ctx.lowest.pitch);
  const high = pitchClass(ctx.highest.pitch);
  if (low === tonic || high === tonic) {
    out.push({
      kind: 'AMBITUS',
      noteIds: [low === tonic ? ctx.lowest.id : ctx.highest.id],
      points: pts.AMBITUS,
      matched: 1,
      of: 1,
      detail: `音域以 ${name} 为${low === tonic ? '下' : '上'}界（正格）`,
    });
  } else if (low === mod(tonic + 7, 12)) {
    out.push({
      kind: 'AMBITUS',
      noteIds: [ctx.lowest.id],
      points: pts.AMBITUS,
      matched: 1,
      of: 1,
      detail: `音域下界为 ${name} 的属音 ${pitchClassName(low)}（变格）`,
    });
  }

  if (pitchClass(ctx.first.pitch) === tonic) {
    out.push({
      kind: 'FIRST_NOTE',
      noteIds: [ctx.first.id],
      points: pts.FIRST_NOTE,
      matched: 1,
      of: 1,
      detail: `首音为 ${name}`,
    });
  }
  return out;
}
