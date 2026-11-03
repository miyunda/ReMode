// Strict parallel remode (spec §7.1 operation 1, §7.3): same tonic, new mode.
// Every note is mapped by degree identity relative to the tonic, keeping its
// octave; timing, IDs and velocities are never touched (Invariant B).

import type {
  DegreeIdentity,
  MelodyNote,
  MelodyVariant,
  PitchChange,
  ScaleDefinition,
  TransformSettings,
} from '../types.js';
import { mod, pitchName } from '../theory/pitch.js';
import { getScale, modeName } from '../theory/scales.js';
import {
  change,
  checkNotes,
  signedSemitones,
  timeOrder,
  withPitches,
  type StrictReasonCode,
  type TransformError,
  type TransformWarning,
} from './common.js';
import { ambitusCentre, findOctaveShift, type OctaveShift, type PitchRange } from './range.js';
import { transpose, type TransposeResult, type TransposeSettings } from './transpose.js';

/** Bump whenever mapping rules, tie-breaks or diagnostics change (CLAUDE.md rule 6). */
export const STRICT_TRANSFORM_VERSION = 'remode-strict/1.1.0';

/**
 * Notes outside the source scale (spec §7.3):
 * - `nearest` (default): move to a neighbouring target-scale pitch by the
 *   same rule as a missing degree (kept as is if already in the target);
 * - `preserve`: keep the pitch; only allowed when the target is not strict;
 * - `reject`: refuse the whole transform.
 */
export type AccidentalPolicy = 'nearest' | 'preserve' | 'reject';

export interface ModeRef {
  /** Tonic pitch class 0..11. */
  root: number;
  scaleId: string;
}

export interface DiagnosticThresholds {
  /** REPETITION_INTRODUCED when the mapping turns at least this many steps into unisons… */
  repetitionMinCount: number;
  /** …and at least this share of all steps. */
  repetitionMinShare: number;
}

export const DEFAULT_DIAGNOSTIC_THRESHOLDS: DiagnosticThresholds = {
  repetitionMinCount: 2,
  repetitionMinShare: 0.1,
};

export interface StrictRemodeOptions {
  accidentals?: AccidentalPolicy;
  /**
   * The target is declared strict: every output pitch belongs to the target
   * scale (Invariant D). Default true; `accidentals: 'preserve'` needs false.
   */
  strictTarget?: boolean;
  /** Soft range (spec §7.4); `null` disables it. Default 21–108. */
  softRange?: PitchRange | null;
  diagnostics?: Partial<DiagnosticThresholds>;
  /** `MelodyVariant.createdAt`; default `Date.now()`. */
  createdAt?: number;
}

export interface StrictRemodeSettings extends TransformSettings {
  operation: 'parallel-remode';
  strategy: 'strict';
  version: string;
  source: ModeRef & { name: string };
  target: ModeRef & { name: string };
  accidentals: AccidentalPolicy;
  strictTarget: boolean;
  softRange: PitchRange | null;
  rangeShift: number;
  diagnostics: DiagnosticThresholds;
  /** Set on the final variant of `strictRemodeWithTonic`: the transpose that came first. */
  preTranspose?: { fromRoot: number; semitones: number };
}

/** One row of the degree table: how each degree number maps (labels such as "♭3"). */
export interface DegreeMapEntry {
  degree: DegreeIdentity['degree'];
  source: { label: string; interval: number } | null;
  target: { label: string; interval: number } | null;
  /** The interval differs, or only one of the two scales has the degree. */
  differs: boolean;
}

/**
 * How in-scale notes are mapped (spec §7.3.1):
 * - `degree-identity`: to the target degree with the same number (7→7, 5↔7, 6↔7, 5↔6, and
 *   六声 of different types); a missing number goes to a neighbour;
 * - `scale-position`: between two scales of the same Chinese type with five or six tones
 *   (五声 ↔ 五声, 六声加清角 ↔ 六声加清角, 六声加变宫 ↔ 六声加变宫), the k-th tone above the
 *   tonic maps to the target's k-th tone. Fully determined, bijective, order-preserving.
 */
export type MappingKind = 'degree-identity' | 'scale-position';

/** One row of the position table (`scale-position` only). */
export interface PositionMapEntry {
  /** 1-based position above the tonic. */
  position: number;
  source: { label: string; interval: number; role: string };
  target: { label: string; interval: number; role: string };
  differs: boolean;
}

export interface CharacteristicExposure {
  /**
   * Labels of degrees (or positions) that differ between source and target,
   * e.g. "4→♯4", "7 (目标新增)"; for `scale-position` "2→♭3".
   */
  differing: string[];
  /** Differing degrees the source melody actually sounds (in-scale notes only). */
  sounded: string[];
}

export interface ContourDiagnostics {
  /** Steps between consecutive notes (time order). */
  steps: number;
  /** Steps whose direction flipped (up ↔ down); ids are the [from, to] notes. */
  reversed: Array<[string, string]>;
  /** Steps that moved in the source and became unisons. */
  repeated: Array<[string, string]>;
}

export interface StrictRemodeReport {
  mapping: MappingKind;
  degreeMap: DegreeMapEntry[];
  /** The table actually used for in-scale notes when `mapping` is `scale-position`. */
  positionMap: PositionMapEntry[] | null;
  characteristic: CharacteristicExposure;
  contour: ContourDiagnostics;
  range: OctaveShift;
  /** Notes outside the source scale, and what happened to them. */
  accidentals: { policy: AccidentalPolicy; noteIds: string[] };
  outputEqualsInput: boolean;
}

export type StrictVariant = MelodyVariant & { id: 'strict'; transform: StrictRemodeSettings };

export type StrictRemodeResult =
  | { ok: true; variant: StrictVariant; report: StrictRemodeReport; warnings: TransformWarning[] }
  | { ok: false; errors: TransformError[] };

// ---------------------------------------------------------------------------

const ALTER_SIGN: Record<DegreeIdentity['alter'], string> = { [-1]: '♭', 0: '', 1: '♯' };
export const degreeLabel = (d: DegreeIdentity): string => `${ALTER_SIGN[d.alter]}${d.degree}`;

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

function resolveScale(id: string, errors: TransformError[]): ScaleDefinition | null {
  try {
    return getScale(id);
  } catch {
    errors.push({ code: 'UNKNOWN_SCALE', message: `Unknown scale id: ${id}` });
    return null;
  }
}

export function degreeMap(source: ScaleDefinition, target: ScaleDefinition): DegreeMapEntry[] {
  const entries: DegreeMapEntry[] = [];
  for (let degree = 1 as DegreeIdentity['degree']; degree <= 7; degree++) {
    const side = (scale: ScaleDefinition) => {
      const i = scale.degreeIdentity.findIndex((d) => d.degree === degree);
      if (i < 0) return null;
      return {
        label: degreeLabel(scale.degreeIdentity[i] as DegreeIdentity),
        interval: scale.intervals[i] as number,
      };
    };
    const s = side(source);
    const t = side(target);
    if (!s && !t) continue;
    entries.push({ degree, source: s, target: t, differs: s?.interval !== t?.interval });
  }
  return entries;
}

/** `scale-position` applies between five- or six-tone scales of the same Chinese type. */
export function mappingKind(source: ScaleDefinition, target: ScaleDefinition): MappingKind {
  return source.chinese &&
    target.chinese &&
    source.chinese.scaleType === target.chinese.scaleType &&
    source.intervals.length === target.intervals.length &&
    source.intervals.length <= 6
    ? 'scale-position'
    : 'degree-identity';
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  gong: '宫',
  shang: '商',
  jue: '角',
  zhi: '徵',
  yu: '羽',
  qingjiao: '清角',
  bianzhi: '变徵',
  biangong: '变宫',
  run: '闰',
};

export function positionMap(source: ScaleDefinition, target: ScaleDefinition): PositionMapEntry[] {
  const side = (scale: ScaleDefinition, i: number) => ({
    label: degreeLabel(scale.degreeIdentity[i] as DegreeIdentity),
    interval: scale.intervals[i] as number,
    role: ROLE_LABELS[scale.degreeRoles[i] as string] ?? (scale.degreeRoles[i] as string),
  });
  return source.intervals.map((interval, i) => ({
    position: i + 1,
    source: side(source, i),
    target: side(target, i),
    differs: interval !== target.intervals[i],
  }));
}

const differingLabel = (e: DegreeMapEntry): string =>
  e.source && e.target
    ? `${e.source.label}→${e.target.label}`
    : e.source
      ? `${e.source.label} (目标没有)`
      : `${e.target?.label} (目标新增)`;

/**
 * Neighbour choice for a pitch the target cannot hold as is (spec §7.3):
 * the nearest target pitches below and above, then
 *   1. the one whose step to the next note (already mapped) keeps the
 *      source step's direction (up / down / repeat);
 *   2. otherwise the nearer one;
 *   3. otherwise the one nearer to a tonic (any octave);
 *   4. otherwise the lower one.
 */
export function chooseNeighbour(
  pitch: number,
  root: number,
  targetIntervals: readonly number[],
  next: { sourcePitch: number; outputPitch: number } | null,
): { pitch: number; lower: number; upper: number; rule: NeighbourRule } {
  const isTarget = (p: number) => targetIntervals.includes(mod(p - root, 12));
  if (isTarget(pitch)) return { pitch, lower: pitch, upper: pitch, rule: 'in-target' };
  let lower = pitch - 1;
  while (!isTarget(lower)) lower--;
  let upper = pitch + 1;
  while (!isTarget(upper)) upper++;

  if (next) {
    const wanted = sign(next.sourcePitch - pitch);
    const keeps = [lower, upper].filter((c) => sign(next.outputPitch - c) === wanted);
    if (keeps.length === 1) return { pitch: keeps[0] as number, lower, upper, rule: 'direction' };
  }
  const dl = pitch - lower;
  const du = upper - pitch;
  if (dl !== du) return { pitch: dl < du ? lower : upper, lower, upper, rule: 'nearest' };
  const toTonic = (p: number) => {
    const r = mod(p - root, 12);
    return Math.min(r, 12 - r);
  };
  const tl = toTonic(lower);
  const tu = toTonic(upper);
  if (tl !== tu) return { pitch: tl < tu ? lower : upper, lower, upper, rule: 'tonic' };
  return { pitch: lower, lower, upper, rule: 'lower' };
}

export type NeighbourRule = 'in-target' | 'direction' | 'nearest' | 'tonic' | 'lower';

const RULE_TEXT: Record<NeighbourRule, string> = {
  'in-target': '已在目标音阶内',
  direction: '与下一音的进行方向一致',
  nearest: '距离最近',
  tonic: '距离相等，靠近主音',
  lower: '距离相等且离主音同样远，取下方',
};

// ---------------------------------------------------------------------------

/**
 * Strict parallel remode (spec §7.3): `source.root` stays the tonic; each
 * in-scale note keeps its octave relative to the tonic and moves to the
 * target's degree with the same number, or, between five- or six-tone scales
 * of the same type, to the tone in the same position (see `MappingKind`).
 * A degree the target lacks (偏音) goes to a neighbour (`SCALE_CONSTRAINT`, see `chooseNeighbour`); notes
 * outside the source scale follow `accidentals`. The whole result is then
 * shifted by at most one whole-octave amount for the range (spec §7.4).
 */
export function strictRemode(
  notes: readonly MelodyNote[],
  source: ModeRef,
  target: { scaleId: string },
  options: StrictRemodeOptions = {},
): StrictRemodeResult {
  const errors = checkNotes(notes);
  const accidentals = options.accidentals ?? 'nearest';
  const strictTarget = options.strictTarget ?? true;
  const thresholds = { ...DEFAULT_DIAGNOSTIC_THRESHOLDS, ...options.diagnostics };
  if (!Number.isInteger(source.root)) {
    errors.push({
      code: 'INVALID_ROOT',
      message: `Root must be an integer pitch class, got ${source.root}.`,
    });
  }
  const src = resolveScale(source.scaleId, errors);
  const tgt = resolveScale(target.scaleId, errors);
  if (accidentals === 'preserve' && strictTarget) {
    errors.push({
      code: 'PRESERVE_REQUIRES_LOOSE_TARGET',
      message:
        'Accidental policy "preserve" keeps notes outside the target scale; declare the target non-strict (strictTarget: false).',
    });
  }
  if (errors.length > 0 || !src || !tgt) return { ok: false, errors };

  const root = mod(source.root, 12);
  const sourceName = modeName(root, src.id);
  const targetName = modeName(root, tgt.id);
  const table = degreeMap(src, tgt);
  const byDegree = new Map(table.map((e) => [e.degree, e]));
  const kind = mappingKind(src, tgt);
  const positions = kind === 'scale-position' ? positionMap(src, tgt) : null;

  // Accidentals first: `reject` refuses before anything is mapped.
  const outside = notes.filter((n) => !src.intervals.includes(mod(n.pitch - root, 12)));
  if (accidentals === 'reject' && outside.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'ACCIDENTAL_REJECTED',
          message: `${outside.length} note(s) lie outside ${sourceName}: ${[...new Set(outside.map((n) => pitchName(n.pitch)))].join(' ')}.`,
          noteIds: outside.map((n) => n.id),
        },
      ],
    };
  }

  // Map in reverse time order so a neighbour choice can see the next note's output.
  const order = timeOrder(notes);
  const mapped: number[] = notes.map((n) => n.pitch);
  const reasons = new Map<number, { code: StrictReasonCode; text: string }>();
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k] as number;
    const note = notes[i] as MelodyNote;
    const nextIndex = order[k + 1];
    const next =
      nextIndex === undefined
        ? null
        : {
            sourcePitch: (notes[nextIndex] as MelodyNote).pitch,
            outputPitch: mapped[nextIndex] as number,
          };
    const rel = note.pitch - root;
    const octave = Math.floor(rel / 12);
    const sIndex = src.intervals.indexOf(mod(rel, 12));

    if (sIndex >= 0 && positions) {
      const entry = positions[sIndex] as PositionMapEntry;
      const to = root + 12 * octave + entry.target.interval;
      mapped[i] = to;
      if (to !== note.pitch) {
        reasons.set(i, {
          code: 'SCALE_POSITION_MAPPED',
          text: `第 ${entry.position} 音位：${entry.source.role}（${entry.source.label}）→ ${targetName} 的${entry.target.role}（${entry.target.label}）`,
        });
      }
      continue;
    }
    if (sIndex >= 0) {
      const identity = src.degreeIdentity[sIndex] as DegreeIdentity;
      const entry = byDegree.get(identity.degree) as DegreeMapEntry;
      if (entry.target) {
        const to = root + 12 * octave + entry.target.interval;
        mapped[i] = to;
        if (to !== note.pitch) {
          reasons.set(i, {
            code: 'DEGREE_MAPPED',
            text: `第 ${entry.source?.label} 级 → ${targetName} 的第 ${entry.target.label} 级`,
          });
        }
        continue;
      }
      const choice = chooseNeighbour(note.pitch, root, tgt.intervals, next);
      mapped[i] = choice.pitch;
      reasons.set(i, {
        code: 'SCALE_CONSTRAINT',
        text: `${targetName} 没有第 ${identity.degree} 级；候选 ${pitchName(choice.lower)} / ${pitchName(choice.upper)}，取 ${pitchName(choice.pitch)}（${RULE_TEXT[choice.rule]}）`,
      });
      continue;
    }

    if (accidentals === 'preserve') continue;
    const choice = chooseNeighbour(note.pitch, root, tgt.intervals, next);
    mapped[i] = choice.pitch;
    if (choice.pitch !== note.pitch) {
      reasons.set(i, {
        code: 'ACCIDENTAL_NEAREST',
        text: `调外音（不在 ${sourceName} 中）；候选 ${pitchName(choice.lower)} / ${pitchName(choice.upper)}，取 ${pitchName(choice.pitch)}（${RULE_TEXT[choice.rule]}）`,
      });
    }
  }

  const range = findOctaveShift(mapped, {
    ...(options.softRange === undefined ? {} : { softRange: options.softRange }),
    referenceCentre: ambitusCentre(notes.map((n) => n.pitch)) ?? 0,
  });
  if (!range.ok) return { ok: false, errors: range.errors };
  const { shift } = range.fit;
  const pitches = mapped.map((p) => p + shift);

  const changes: PitchChange[] = [];
  notes.forEach((n, i) => {
    const to = pitches[i] as number;
    if (to === n.pitch) return;
    const reason = reasons.get(i);
    const octave =
      shift === 0 ? '' : `；全曲整体移动 ${signedSemitones(shift / 12)} 个八度（音域）`;
    changes.push(
      reason
        ? change(
            n,
            to,
            reason.code,
            `${pitchName(n.pitch)} → ${pitchName(to)}：${reason.text}${octave}`,
          )
        : change(
            n,
            to,
            'RANGE_ADJUSTMENT',
            `${pitchName(n.pitch)} → ${pitchName(to)}：全曲整体移动 ${signedSemitones(shift / 12)} 个八度（音域）`,
          ),
    );
  });

  // Invariant D: a strict target holds every output pitch.
  if (strictTarget) {
    const stray = pitches.filter((p) => !tgt.intervals.includes(mod(p - root, 12)));
    if (stray.length > 0)
      throw new Error(`strictRemode produced pitches outside ${targetName}: ${stray.join(', ')}`);
  }

  const warnings: TransformWarning[] = [...range.warnings];
  if (outside.length > 0) {
    warnings.push({
      code: accidentals === 'preserve' ? 'ACCIDENTALS_PRESERVED' : 'ACCIDENTALS_MAPPED',
      message:
        accidentals === 'preserve'
          ? `${outside.length} 个调外音按 preserve 策略保留原音高，输出不全在 ${targetName} 内。`
          : `${outside.length} 个调外音按 nearest 策略移到 ${targetName} 的相邻音。`,
      noteIds: outside.map((n) => n.id),
    });
  }

  const outputEqualsInput = changes.length === 0;
  const characteristic = positions
    ? positionExposure(notes, root, src, positions)
    : exposure(notes, root, src, table);
  if (characteristic.sounded.length === 0) {
    const what =
      characteristic.differing.length === 0
        ? `${sourceName} 与 ${targetName} 的音级完全相同`
        : `本旋律未使用有差别的音级（${characteristic.differing.join('、')}）`;
    warnings.push({
      code: 'NO_CHARACTERISTIC_DEGREE',
      message: `${what}，${src.label} → ${tgt.label} 不会产生听感变化；${
        outputEqualsInput ? '输出与原曲相同' : '调内音未改变（变化只来自调外音或音域）'
      }。可在 Expressive 中引入特征音。`,
      degrees: characteristic.differing,
    });
  }

  const contour = contourDiagnostics(notes, pitches, order);
  if (contour.reversed.length > 0) {
    warnings.push({
      code: 'CONTOUR_REVERSED',
      message: `映射使 ${contour.reversed.length} 处旋律进行方向反转（上行 ↔ 下行）；仅为诊断，可交给 Expressive 处理。`,
      noteIds: [...new Set(contour.reversed.flat())],
    });
  }
  if (
    contour.repeated.length >= thresholds.repetitionMinCount &&
    contour.repeated.length >= thresholds.repetitionMinShare * contour.steps
  ) {
    warnings.push({
      code: 'REPETITION_INTRODUCED',
      message: `映射使 ${contour.repeated.length} / ${contour.steps} 处原本有进行的相邻音变成同音重复；仅为诊断，可交给 Expressive 处理。`,
      noteIds: [...new Set(contour.repeated.flat())],
    });
  }

  return {
    ok: true,
    variant: {
      id: 'strict',
      notes: withPitches(notes, pitches),
      createdAt: options.createdAt ?? Date.now(),
      transform: {
        operation: 'parallel-remode',
        strategy: 'strict',
        version: STRICT_TRANSFORM_VERSION,
        source: { root, scaleId: src.id, name: sourceName },
        target: { root, scaleId: tgt.id, name: targetName },
        accidentals,
        strictTarget,
        softRange: range.fit.softRange,
        rangeShift: shift,
        diagnostics: thresholds,
      },
      changes,
    },
    report: {
      mapping: kind,
      degreeMap: table,
      positionMap: positions,
      characteristic,
      contour,
      range: range.fit,
      accidentals: { policy: accidentals, noteIds: outside.map((n) => n.id) },
      outputEqualsInput,
    },
    warnings,
  };
}

function exposure(
  notes: readonly MelodyNote[],
  root: number,
  src: ScaleDefinition,
  table: readonly DegreeMapEntry[],
): CharacteristicExposure {
  const used = new Set<number>();
  for (const n of notes) {
    const i = src.intervals.indexOf(mod(n.pitch - root, 12));
    if (i >= 0) used.add((src.degreeIdentity[i] as DegreeIdentity).degree);
  }
  const differing = table.filter((e) => e.differs);
  return {
    differing: differing.map(differingLabel),
    sounded: differing.filter((e) => e.source && used.has(e.degree)).map(differingLabel),
  };
}

function positionExposure(
  notes: readonly MelodyNote[],
  root: number,
  src: ScaleDefinition,
  positions: readonly PositionMapEntry[],
): CharacteristicExposure {
  const used = new Set(notes.map((n) => src.intervals.indexOf(mod(n.pitch - root, 12))));
  const differing = positions.filter((e) => e.differs);
  const label = (e: PositionMapEntry) => `${e.source.label}→${e.target.label}`;
  return {
    differing: differing.map(label),
    sounded: differing.filter((e) => used.has(e.position - 1)).map(label),
  };
}

function contourDiagnostics(
  notes: readonly MelodyNote[],
  pitches: readonly number[],
  order: readonly number[],
): ContourDiagnostics {
  const reversed: Array<[string, string]> = [];
  const repeated: Array<[string, string]> = [];
  for (let k = 1; k < order.length; k++) {
    const a = order[k - 1] as number;
    const b = order[k] as number;
    const before = sign((notes[b] as MelodyNote).pitch - (notes[a] as MelodyNote).pitch);
    const after = sign((pitches[b] as number) - (pitches[a] as number));
    const ids: [string, string] = [(notes[a] as MelodyNote).id, (notes[b] as MelodyNote).id];
    if (before !== 0 && after === -before) reversed.push(ids);
    else if (before !== 0 && after === 0) repeated.push(ids);
  }
  return { steps: Math.max(0, order.length - 1), reversed, repeated };
}

// ---------------------------------------------------------------------------

export interface RemodeStep {
  operation: 'transpose' | 'parallel-remode';
  variant: MelodyVariant;
  warnings: TransformWarning[];
}

export type TonicRemodeResult =
  | {
      ok: true;
      /** Shown as two explicit steps (spec §7.1): transpose, then parallel remode. */
      steps: [
        RemodeStep & {
          operation: 'transpose';
          variant: MelodyVariant & { transform: TransposeSettings };
        },
        RemodeStep & {
          operation: 'parallel-remode';
          variant: StrictVariant;
          report: StrictRemodeReport;
        },
      ];
      /** The final variant; `changes` compare the original with the end result. */
      variant: StrictVariant;
      report: StrictRemodeReport;
      warnings: TransformWarning[];
    }
  | { ok: false; step: 'transpose' | 'parallel-remode'; errors: TransformError[] };

/** The transpose between two roots with the smallest move (-5..+6 semitones). */
export const nearestTransposition = (from: number, to: number): number => {
  const up = mod(to - from, 12);
  return up > 6 ? up - 12 : up;
};

/**
 * "Change tonic and mode" (spec §7.1): chromatic transpose from `source.root`
 * to `target.root`, then strict parallel remode on the new tonic. Without
 * `semitones` the smaller transposition (-5..+6) is used.
 */
export function strictRemodeWithTonic(
  notes: readonly MelodyNote[],
  source: ModeRef,
  target: ModeRef,
  options: StrictRemodeOptions & { semitones?: number } = {},
): TonicRemodeResult {
  const semitones = options.semitones ?? nearestTransposition(source.root, target.root);
  if (!Number.isInteger(target.root) || mod(source.root + semitones, 12) !== mod(target.root, 12)) {
    return {
      ok: false,
      step: 'transpose',
      errors: [
        {
          code: 'INVALID_SEMITONES',
          message: `Transposing by ${semitones} does not move root ${source.root} to ${target.root}.`,
        },
      ],
    };
  }
  const common = {
    ...(options.softRange === undefined ? {} : { softRange: options.softRange }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  };
  const moved: TransposeResult = transpose(notes, semitones, common);
  if (!moved.ok) return { ok: false, step: 'transpose', errors: moved.errors };
  const remoded = strictRemode(
    moved.variant.notes,
    { root: target.root, scaleId: source.scaleId },
    { scaleId: target.scaleId },
    options,
  );
  if (!remoded.ok) return { ok: false, step: 'parallel-remode', errors: remoded.errors };

  const transposeById = new Map(moved.variant.changes.map((c) => [c.noteId, c]));
  const remodeById = new Map(remoded.variant.changes.map((c) => [c.noteId, c]));
  const changes: PitchChange[] = [];
  notes.forEach((n, i) => {
    const to = (remoded.variant.notes[i] as MelodyNote).pitch;
    if (to === n.pitch) return;
    const parts = [transposeById.get(n.id), remodeById.get(n.id)].filter((c) => c !== undefined);
    const last = parts[parts.length - 1] as PitchChange;
    changes.push({
      noteId: n.id,
      fromPitch: n.pitch,
      toPitch: to,
      reasonCode: last.reasonCode,
      explanation: parts.map((c) => c.explanation).join('；然后 '),
    });
  });

  return {
    ok: true,
    steps: [
      { operation: 'transpose', variant: moved.variant, warnings: moved.warnings },
      {
        operation: 'parallel-remode',
        variant: remoded.variant,
        report: remoded.report,
        warnings: remoded.warnings,
      },
    ],
    variant: {
      ...remoded.variant,
      transform: {
        ...remoded.variant.transform,
        preTranspose: { fromRoot: mod(source.root, 12), semitones },
      },
      changes,
    },
    report: remoded.report,
    warnings: [...moved.warnings, ...remoded.warnings],
  };
}
