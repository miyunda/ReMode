// Scale library (spec §6.2, §7.2): 7 church modes plus Chinese 五声 / 六声 / 七声
// scales on each of the five 正音. 偏音 (清角, 变徵, 变宫, 闰) are never tonics:
// no ScaleDefinition is generated with one as its tonic.

import type {
  ChineseModeRef,
  ChineseScaleType,
  ChineseTonicDegree,
  DegreeIdentity,
  ScaleDefinition,
} from '../types.js';
import { mod, pitchClassName } from './pitch.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

const rotate = (set: readonly number[], offset: number): number[] =>
  set.map((pc) => mod(pc - offset, 12)).sort((a, b) => a - b);

/** Ordinal degree identity of a 7-note scale, alteration measured against the major scale. */
function heptatonicIdentity(intervals: readonly number[]): DegreeIdentity[] {
  return intervals.map((interval, i) => {
    const alter = interval - (MAJOR[i] as number);
    if (alter < -1 || alter > 1) throw new Error(`Unsupported alteration ${alter} at degree ${i + 1}`);
    return { degree: (i + 1) as DegreeIdentity['degree'], alter: alter as DegreeIdentity['alter'] };
  });
}

// --- Church modes ------------------------------------------------------------

interface ChurchSpec {
  id: string;
  label: string;
  offset: number;
  characteristic: number[];
}

/** `offset` is the mode's tonic within the Ionian collection. */
export const CHURCH_MODES: readonly ChurchSpec[] = [
  { id: 'ionian', label: 'Ionian', offset: 0, characteristic: [4, 7] },
  { id: 'dorian', label: 'Dorian', offset: 2, characteristic: [6] },
  { id: 'phrygian', label: 'Phrygian', offset: 4, characteristic: [2] },
  { id: 'lydian', label: 'Lydian', offset: 5, characteristic: [4] },
  { id: 'mixolydian', label: 'Mixolydian', offset: 7, characteristic: [7] },
  { id: 'aeolian', label: 'Aeolian', offset: 9, characteristic: [6] },
  { id: 'locrian', label: 'Locrian', offset: 11, characteristic: [2, 5] },
];

const CHURCH_ROLES = ['tonic', 'supertonic', 'mediant', 'subdominant', 'dominant', 'submediant'];

function churchScale(spec: ChurchSpec): ScaleDefinition {
  const intervals = rotate(MAJOR, spec.offset);
  return {
    id: spec.id,
    label: spec.label,
    intervals,
    family: 'diatonic',
    degreeIdentity: heptatonicIdentity(intervals),
    degreeRoles: [...CHURCH_ROLES, intervals[6] === 11 ? 'leading-tone' : 'subtonic'],
    characteristicDegrees: spec.characteristic,
  };
}

// --- Chinese scales ----------------------------------------------------------

/** 正音 offsets above 宫. */
export const ZHENGYIN: Readonly<Record<ChineseTonicDegree, number>> = {
  gong: 0,
  shang: 2,
  jue: 4,
  zhi: 7,
  yu: 9,
};

export const CHINESE_TONIC_DEGREES: readonly ChineseTonicDegree[] = [
  'gong',
  'shang',
  'jue',
  'zhi',
  'yu',
];

export const PIANYIN_ROLES = ['qingjiao', 'bianzhi', 'biangong', 'run'] as const;

/** Tones of each scale type relative to 宫, with their role names. */
const CHINESE_TONES: Readonly<Record<ChineseScaleType, ReadonlyArray<readonly [number, string]>>> = {
  pentatonic: [
    [0, 'gong'],
    [2, 'shang'],
    [4, 'jue'],
    [7, 'zhi'],
    [9, 'yu'],
  ],
  'hexa-qingjiao': [
    [0, 'gong'],
    [2, 'shang'],
    [4, 'jue'],
    [5, 'qingjiao'],
    [7, 'zhi'],
    [9, 'yu'],
  ],
  'hexa-biangong': [
    [0, 'gong'],
    [2, 'shang'],
    [4, 'jue'],
    [7, 'zhi'],
    [9, 'yu'],
    [11, 'biangong'],
  ],
  qingyue: [
    [0, 'gong'],
    [2, 'shang'],
    [4, 'jue'],
    [5, 'qingjiao'],
    [7, 'zhi'],
    [9, 'yu'],
    [11, 'biangong'],
  ],
  yayue: [
    [0, 'gong'],
    [2, 'shang'],
    [4, 'jue'],
    [6, 'bianzhi'],
    [7, 'zhi'],
    [9, 'yu'],
    [11, 'biangong'],
  ],
  yanyue: [
    [0, 'gong'],
    [2, 'shang'],
    [4, 'jue'],
    [5, 'qingjiao'],
    [7, 'zhi'],
    [9, 'yu'],
    [10, 'run'],
  ],
};

export const CHINESE_SCALE_TYPES = Object.keys(CHINESE_TONES) as ChineseScaleType[];

export const CHINESE_SCALE_TYPE_LABELS: Readonly<Record<ChineseScaleType, string>> = {
  pentatonic: '五声',
  'hexa-qingjiao': '六声加清角',
  'hexa-biangong': '六声加变宫',
  qingyue: '七声清乐',
  yayue: '七声雅乐',
  yanyue: '七声燕乐',
};

export const CHINESE_DEGREE_LABELS: Readonly<Record<ChineseTonicDegree, string>> = {
  gong: '宫',
  shang: '商',
  jue: '角',
  zhi: '徵',
  yu: '羽',
};

export const chineseScaleId = (type: ChineseScaleType, degree: ChineseTonicDegree): string =>
  `${type}-${degree}`;

function chineseScale(type: ChineseScaleType, degree: ChineseTonicDegree): ScaleDefinition {
  const tonicOffset = ZHENGYIN[degree];
  const tones = CHINESE_TONES[type]
    .map(([pc, role]) => [mod(pc - tonicOffset, 12), role] as const)
    .sort((a, b) => a[0] - b[0]);
  const intervals = tones.map(([pc]) => pc);
  const degreeRoles = tones.map(([, role]) => role);

  // Degree identity: heptatonic scales use their own ordinals; five- and six-note
  // scales take each tone's ordinal from the 清乐 scale on the same tonic, so 徵
  // pentatonic reads 1 2 4 5 6 (spec §7.3).
  const parent = tones.length === 7 ? intervals : rotate(MAJOR, tonicOffset);
  const parentIdentity = heptatonicIdentity(parent);
  const degreeIdentity = intervals.map((interval) => {
    const identity = parentIdentity[parent.indexOf(interval)];
    if (!identity) throw new Error(`No degree identity for ${type}-${degree} interval ${interval}`);
    return identity;
  });

  const characteristicDegrees = degreeRoles.flatMap((role, i) =>
    (PIANYIN_ROLES as readonly string[]).includes(role)
      ? [(degreeIdentity[i] as DegreeIdentity).degree]
      : [],
  );

  return {
    id: chineseScaleId(type, degree),
    label: `${CHINESE_DEGREE_LABELS[degree]}调式（${CHINESE_SCALE_TYPE_LABELS[type]}）`,
    intervals,
    family: tones.length === 5 ? 'pentatonic' : tones.length === 6 ? 'hexatonic' : 'diatonic',
    degreeIdentity,
    degreeRoles,
    characteristicDegrees,
    chinese: { tonicDegree: degree, scaleType: type },
  };
}

// --- Registry ----------------------------------------------------------------

export const SCALES: readonly ScaleDefinition[] = [
  ...CHURCH_MODES.map(churchScale),
  ...CHINESE_SCALE_TYPES.flatMap((type) =>
    CHINESE_TONIC_DEGREES.map((degree) => chineseScale(type, degree)),
  ),
];

const SCALE_BY_ID = new Map(SCALES.map((s) => [s.id, s]));

export function getScale(id: string): ScaleDefinition {
  const scale = SCALE_BY_ID.get(id);
  if (!scale) throw new Error(`Unknown scale id: ${id}`);
  return scale;
}

/** Pitch class of 宫 for a Chinese scale with the given tonic. */
export function gongPitchClassOf(scale: ScaleDefinition, rootPitchClass: number): number | null {
  if (!scale.chinese) return null;
  return mod(rootPitchClass - ZHENGYIN[scale.chinese.tonicDegree], 12);
}

export function chineseModeRef(scale: ScaleDefinition, rootPitchClass: number): ChineseModeRef | null {
  const gong = gongPitchClassOf(scale, rootPitchClass);
  if (gong === null || !scale.chinese) return null;
  return { gongPitchClass: gong, ...scale.chinese };
}

/**
 * Dual-coordinate name (spec §6.2): "D Dorian", "D 徵调式（G 宫系统，五声）".
 */
export function modeName(rootPitchClass: number, scaleId: string): string {
  const scale = getScale(scaleId);
  const root = pitchClassName(rootPitchClass);
  const ref = chineseModeRef(scale, rootPitchClass);
  if (!ref) return `${root} ${scale.label}`;
  return `${root} ${CHINESE_DEGREE_LABELS[ref.tonicDegree]}调式（${pitchClassName(
    ref.gongPitchClass,
  )} 宫系统，${CHINESE_SCALE_TYPE_LABELS[ref.scaleType]}）`;
}

/** Absolute pitch classes of a scale on a given root. */
export const scalePitchClasses = (scale: ScaleDefinition, rootPitchClass: number): number[] =>
  scale.intervals.map((i) => mod(rootPitchClass + i, 12));
