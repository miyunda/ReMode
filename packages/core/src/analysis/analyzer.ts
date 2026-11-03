// Two-step mode analysis (spec §6, ADR-004):
//   1. PCD → compatible pitch-class collections (coverage, unused degrees),
//      smallest compatible collection wins;
//   2. tonic chosen inside that collection by named evidence.
// Results carry structural ambiguity codes, never a probability.

import type {
  Ambiguity,
  AnalysisConfig,
  CollectionMatch,
  MelodyNote,
  ModeAnalysis,
  ModeCandidate,
  ModeName,
  TimeSignatureEvent,
} from '../types.js';
import { pitchClass, pitchClassName } from '../theory/pitch.js';
import { getScale } from '../theory/scales.js';
import { ksBaseline } from './baseline.js';
import {
  COLLECTION_TYPES,
  collectionPitchClasses,
  collectionSize,
  matchAllCollections,
  modesOnTonic,
} from './collection.js';
import { computePcd } from './pcd.js';
import { segmentPhrases } from './phrases.js';
import { buildEvidenceContext, tonicEvidence } from './tonic.js';

/** Bump whenever defaults, evidence rules or ranking change (CLAUDE.md rule 6). */
export const ANALYSIS_VERSION = 'remode-mode-2step/0.1.0';

/** Initial, uncalibrated values (spec §6.4); to be calibrated in M4. */
export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  coverageThreshold: 0.95,
  evidencePoints: {
    FINAL_NOTE: 6,
    PHRASE_END: 4,
    LONG_NOTE: 3,
    STRONG_BEAT: 3,
    AMBITUS: 1,
    FIRST_NOTE: 1,
  },
  longNoteFactor: 1.5,
  phraseRestBeats: 0.5,
  phraseLongNoteFactor: 2,
  tonicMarginPoints: 2,
  minNotes: 6,
  minDistinctPitchClasses: 3,
};

export interface AnalyzeOptions {
  ppq: number;
  timeSignatures?: readonly TimeSignatureEvent[];
  config?: Partial<Omit<AnalysisConfig, 'evidencePoints'>> & {
    evidencePoints?: Partial<AnalysisConfig['evidencePoints']>;
  };
  /** Attach the Krumhansl–Schmuckler comparison baseline (default true). */
  baseline?: boolean;
}

const EPS = 1e-9;
const COLLECTION_ORDER = COLLECTION_TYPES.map((c) => c.id);

export function resolveConfig(override: AnalyzeOptions['config']): AnalysisConfig {
  return {
    ...DEFAULT_ANALYSIS_CONFIG,
    ...override,
    evidencePoints: { ...DEFAULT_ANALYSIS_CONFIG.evidencePoints, ...override?.evidencePoints },
  };
}

export function collectionLabel(
  m: Pick<CollectionMatch, 'collectionId' | 'transposition'>,
): string {
  const t = pitchClassName(m.transposition);
  switch (m.collectionId) {
    case 'pentatonic':
      return `${t} 宫五声音集`;
    case 'hexatonic':
      return `${t} 宫加清角 / ${pitchClassName(m.transposition + 5)} 宫加变宫六声音集`;
    case 'diatonic':
      return `${t} 自然七声音集（${t} Ionian）`;
  }
}

const unique = (xs: string[]) => [...new Set(xs)];

const byCollection = (a: CollectionMatch, b: CollectionMatch) =>
  COLLECTION_ORDER.indexOf(a.collectionId) - COLLECTION_ORDER.indexOf(b.collectionId) ||
  b.coverage - a.coverage ||
  a.transposition - b.transposition;

export function analyzeMode(notes: readonly MelodyNote[], options: AnalyzeOptions): ModeAnalysis {
  const config = resolveConfig(options.config);
  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_ANALYSIS_CONFIG);
  const analysisVersion = isDefault ? ANALYSIS_VERSION : `${ANALYSIS_VERSION}+custom`;
  const timeSignatures = options.timeSignatures ?? [];

  const sorted = [...notes].sort(
    (a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.id.localeCompare(b.id),
  );
  const pcd = computePcd(sorted);
  const phrases = segmentPhrases(sorted, {
    ppq: options.ppq,
    restBeats: config.phraseRestBeats,
    longNoteFactor: config.phraseLongNoteFactor,
  });

  // --- Step 1: collections ---------------------------------------------------
  const all = matchAllCollections(pcd);
  const compatible =
    sorted.length === 0
      ? []
      : all.filter((m) => m.coverage >= config.coverageThreshold - EPS).sort(byCollection);
  let selected: CollectionMatch[];
  let belowThreshold = false;
  if (compatible.length > 0) {
    const minSize = Math.min(...compatible.map((m) => collectionSize(m.collectionId)));
    selected = compatible.filter((m) => collectionSize(m.collectionId) === minSize);
  } else if (sorted.length > 0) {
    // Nothing reaches the threshold: fall back to the best-covering diatonic sets.
    const diatonic = all.filter((m) => m.collectionId === 'diatonic');
    const best = Math.max(...diatonic.map((m) => m.coverage));
    selected = diatonic.filter((m) => m.coverage >= best - EPS).sort(byCollection);
    belowThreshold = true;
  } else {
    selected = [];
  }

  // --- Step 2: tonic evidence ------------------------------------------------
  const ctx = buildEvidenceContext(sorted, phrases, options.ppq, timeSignatures, config);
  const candidates: ModeCandidate[] = [];
  if (ctx) {
    const evidenceByPc = new Map<number, ReturnType<typeof tonicEvidence>>();
    for (const match of selected) {
      for (const pc of collectionPitchClasses(match.collectionId, match.transposition)) {
        if ((pcd.durations[pc] as number) === 0) continue; // a tonic that never sounds
        const [primary, ...aliases] = modesOnTonic(match.collectionId, match.transposition, pc);
        if (!primary) continue;
        let evidence = evidenceByPc.get(pc);
        if (!evidence) {
          evidence = tonicEvidence(pc, ctx, config);
          evidenceByPc.set(pc, evidence);
        }
        const warnings: string[] = [];
        if (belowThreshold) warnings.push('BELOW_COVERAGE_THRESHOLD');
        if (match.outOfSet.length > 0) warnings.push('OUT_OF_SET_NOTES');
        if (!evidence.some((e) => e.kind === 'FINAL_NOTE')) warnings.push('NOT_FINAL_NOTE');
        candidates.push({
          rootPitchClass: pc,
          scaleId: primary.scaleId,
          name: primary.name,
          ...(primary.chinese ? { chinese: primary.chinese } : {}),
          aliases,
          collection: match,
          tonicEvidence: evidence,
          evidencePoints: evidence.reduce((s, e) => s + e.points, 0),
          rank: 0,
          warnings,
        });
      }
    }
  }
  candidates.sort(
    (a, b) =>
      b.evidencePoints - a.evidencePoints ||
      b.collection.coverage - a.collection.coverage ||
      byCollection(a.collection, b.collection) ||
      a.rootPitchClass - b.rootPitchClass,
  );
  candidates.forEach((c, i) => {
    const prev = candidates[i - 1];
    c.rank =
      prev &&
      prev.evidencePoints === c.evidencePoints &&
      Math.abs(prev.collection.coverage - c.collection.coverage) < EPS
        ? prev.rank
        : i + 1;
  });

  const ambiguities = findAmbiguities(
    sorted,
    pcd.durations,
    candidates,
    compatible,
    selected,
    belowThreshold,
    config,
  );

  const analysis: ModeAnalysis = {
    candidates,
    ambiguities,
    analysisVersion,
    config,
    noteCount: sorted.length,
    pcd,
    compatibleCollections: compatible,
    selectedCollections: selected,
    phrases: phrases.map((p) => ({
      startNoteId: (p.notes[0] as MelodyNote).id,
      endNoteId: (p.notes[p.notes.length - 1] as MelodyNote).id,
      noteCount: p.notes.length,
    })),
  };
  if (options.baseline !== false && sorted.length > 0) analysis.baseline = ksBaseline(pcd);
  return analysis;
}

function findAmbiguities(
  sorted: readonly MelodyNote[],
  durations: readonly number[],
  candidates: readonly ModeCandidate[],
  compatible: readonly CollectionMatch[],
  selected: readonly CollectionMatch[],
  belowThreshold: boolean,
  config: AnalysisConfig,
): Ambiguity[] {
  const out: Ambiguity[] = [];
  const allIds = unique(candidates.map((c) => c.scaleId));
  const distinctPcs = durations.filter((d) => d > 0).length;

  if (sorted.length < config.minNotes || distinctPcs < config.minDistinctPitchClasses) {
    out.push({
      code: 'TOO_SHORT',
      detail: `仅 ${sorted.length} 个音、${distinctPcs} 个音级，不足以可靠判断（阈值：${config.minNotes} 个音、${config.minDistinctPitchClasses} 个音级）`,
      affectedScaleIds: allIds,
    });
  }
  if (sorted.length === 0) return out;

  if (belowThreshold) {
    const best = selected[0] as CollectionMatch;
    out.push({
      code: 'CHROMATIC_HEAVY',
      detail: `没有音集达到覆盖阈值 ${config.coverageThreshold}；最佳为 ${collectionLabel(best)}，覆盖 ${best.coverage.toFixed(3)}，集外音 ${best.outOfSet.map((o) => pitchClassName(o.pitchClass)).join(' ')}`,
      affectedScaleIds: allIds,
    });
  }

  if (selected.length > 1) {
    out.push({
      code: 'MULTIPLE_COLLECTIONS',
      detail: `${selected.map(collectionLabel).join('、')} 同样兼容`,
      affectedScaleIds: allIds,
    });
  }

  const top = candidates.filter((c) => c.rank === 1);
  const topRoots = unique(top.map((c) => String(c.rootPitchClass))).map(Number);
  const best = top[0];
  if (best) {
    const rivals = candidates.filter(
      (c) =>
        c.rootPitchClass !== best.rootPitchClass &&
        best.evidencePoints - c.evidencePoints < config.tonicMarginPoints,
    );
    const lacksFinal = !best.tonicEvidence.some((e) => e.kind === 'FINAL_NOTE');
    if (rivals.length > 0 || lacksFinal) {
      const involved = [...top, ...rivals];
      const reasons: string[] = [];
      if (rivals.length > 0) {
        reasons.push(
          `${unique(involved.map((c) => pitchClassName(c.rootPitchClass))).join(' / ')} 的主音证据相差不足 ${config.tonicMarginPoints} 点`,
        );
      }
      if (lacksFinal) {
        const finalPc = pitchClass((sorted[sorted.length - 1] as MelodyNote).pitch);
        reasons.push(
          `尾音 ${pitchClassName(finalPc)} 不支持首选主音 ${pitchClassName(best.rootPitchClass)}`,
        );
      }
      out.push({
        code: 'TONIC_UNCLEAR',
        detail: reasons.join('；'),
        affectedScaleIds: unique(involved.map((c) => c.scaleId)),
        affectedModes: involved.map(toModeName),
      });
    }
  }

  for (const root of topRoots) {
    const modes: ModeName[] = compatible
      .filter(
        (m) =>
          m.collectionId === 'diatonic' &&
          collectionPitchClasses(m.collectionId, m.transposition).includes(root),
      )
      .flatMap((m) => modesOnTonic(m.collectionId, m.transposition, root));
    const church = modes.filter((m) => !getScale(m.scaleId).chinese);
    if (church.length < 2) continue;
    const missing: number[] = [];
    for (let degree = 1; degree <= 7; degree++) {
      const alters = new Set(
        church.map(
          (m) => getScale(m.scaleId).degreeIdentity.find((d) => d.degree === degree)?.alter,
        ),
      );
      if (alters.size > 1) missing.push(degree);
    }
    out.push({
      code: 'MISSING_DEGREES',
      detail: `旋律未确立第 ${missing.join('、')} 级，无法区分 ${church.map((m) => m.name).join(' / ')}`,
      affectedScaleIds: unique(modes.map((m) => m.scaleId)),
      affectedModes: modes,
      missingDegrees: missing,
    });
  }
  return out;
}

const toModeName = (c: ModeCandidate): ModeName => ({
  rootPitchClass: c.rootPitchClass,
  scaleId: c.scaleId,
  name: c.name,
  ...(c.chinese ? { chinese: c.chinese } : {}),
});
