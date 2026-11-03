// Step 1 of mode analysis (spec §6.3): which pitch-class collection does the melody use?

import type { CollectionId, CollectionMatch, ModeName, PitchClassDistribution } from '../types.js';
import { mod } from '../theory/pitch.js';
import {
  CHINESE_TONIC_DEGREES,
  CHURCH_MODES,
  ZHENGYIN,
  chineseModeRef,
  chineseScaleId,
  getScale,
  modeName,
} from '../theory/scales.js';
import type { ChineseScaleType } from '../types.js';

type Interpretation =
  { kind: 'church' } | { kind: 'chinese'; scaleType: ChineseScaleType; gongOffset: number };

interface CollectionType {
  id: CollectionId;
  /** Reference set relative to `transposition`. */
  set: readonly number[];
  /**
   * Named scale systems that realise this pitch set. Order is the naming
   * preference for a candidate's primary `scaleId`.
   */
  interpretations: readonly Interpretation[];
}

/**
 * Collection types, smallest first. Transposition conventions:
 * - pentatonic: transposition = 宫.
 * - hexatonic: set {0,2,4,5,7,9}; = 宫 + 清角 on T, or 宫 + 变宫 on T+5.
 * - diatonic: transposition = Ionian tonic; 清乐 宫 = T, 雅乐 宫 = T+5, 燕乐 宫 = T+7.
 */
export const COLLECTION_TYPES: readonly CollectionType[] = [
  {
    id: 'pentatonic',
    set: [0, 2, 4, 7, 9],
    interpretations: [{ kind: 'chinese', scaleType: 'pentatonic', gongOffset: 0 }],
  },
  {
    id: 'hexatonic',
    set: [0, 2, 4, 5, 7, 9],
    interpretations: [
      { kind: 'chinese', scaleType: 'hexa-qingjiao', gongOffset: 0 },
      { kind: 'chinese', scaleType: 'hexa-biangong', gongOffset: 5 },
    ],
  },
  {
    id: 'diatonic',
    set: [0, 2, 4, 5, 7, 9, 11],
    interpretations: [
      { kind: 'church' },
      { kind: 'chinese', scaleType: 'qingyue', gongOffset: 0 },
      { kind: 'chinese', scaleType: 'yayue', gongOffset: 5 },
      { kind: 'chinese', scaleType: 'yanyue', gongOffset: 7 },
    ],
  },
];

const typeOf = (id: CollectionId): CollectionType => {
  const t = COLLECTION_TYPES.find((c) => c.id === id);
  if (!t) throw new Error(`Unknown collection ${id}`);
  return t;
};

export const collectionSize = (id: CollectionId): number => typeOf(id).set.length;

export const collectionPitchClasses = (id: CollectionId, transposition: number): number[] =>
  typeOf(id).set.map((pc) => mod(pc + transposition, 12));

/** Coverage of every collection type at every transposition. */
export function matchAllCollections(pcd: PitchClassDistribution): CollectionMatch[] {
  const matches: CollectionMatch[] = [];
  for (const type of COLLECTION_TYPES) {
    for (let t = 0; t < 12; t++) {
      const members = new Set(collectionPitchClasses(type.id, t));
      let coverage = 0;
      const outOfSet: CollectionMatch['outOfSet'] = [];
      for (let pc = 0; pc < 12; pc++) {
        const share = pcd.shares[pc] as number;
        if (members.has(pc)) coverage += share;
        else if (share > 0) outOfSet.push({ pitchClass: pc, durationShare: share });
      }
      const unusedDegrees = [...members]
        .filter((pc) => (pcd.durations[pc] as number) === 0)
        .sort((a, b) => a - b);
      matches.push({ collectionId: type.id, transposition: t, coverage, outOfSet, unusedDegrees });
    }
  }
  return matches;
}

/**
 * Every named mode of `collection` whose tonic is `tonicPitchClass`. Chinese
 * interpretations only yield a mode when the tonic is one of the five 正音.
 */
export function modesOnTonic(
  collectionId: CollectionId,
  transposition: number,
  tonicPitchClass: number,
): ModeName[] {
  const out: ModeName[] = [];
  for (const interp of typeOf(collectionId).interpretations) {
    if (interp.kind === 'church') {
      const offset = mod(tonicPitchClass - transposition, 12);
      const church = CHURCH_MODES.find((m) => m.offset === offset);
      if (church) {
        out.push({
          rootPitchClass: tonicPitchClass,
          scaleId: church.id,
          name: modeName(tonicPitchClass, church.id),
        });
      }
      continue;
    }
    const gong = mod(transposition + interp.gongOffset, 12);
    const rel = mod(tonicPitchClass - gong, 12);
    const degree = CHINESE_TONIC_DEGREES.find((d) => ZHENGYIN[d] === rel);
    if (!degree) continue; // tonic would be a 偏音
    const scaleId = chineseScaleId(interp.scaleType, degree);
    const ref = chineseModeRef(getScale(scaleId), tonicPitchClass);
    out.push({
      rootPitchClass: tonicPitchClass,
      scaleId,
      name: modeName(tonicPitchClass, scaleId),
      ...(ref ? { chinese: ref } : {}),
    });
  }
  return out;
}
