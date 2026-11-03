// Range control (spec §7.4): one whole-octave shift 12k for the entire
// melody, chosen to fit the soft range and stay closest to the original
// centre. Octaves are never folded locally.

import type { TransformError, TransformWarning } from './common.js';

export interface PitchRange {
  low: number;
  high: number;
}

/** Piano range A0–C8, the default soft limit. */
export const DEFAULT_SOFT_RANGE: PitchRange = { low: 21, high: 108 };
export const MIDI_RANGE: PitchRange = { low: 0, high: 127 };

export interface OctaveShiftOptions {
  /** Soft range; `null` disables it so only MIDI 0..127 applies. Default 21–108. */
  softRange?: PitchRange | null;
  /** Pitch the shifted melody's centre should stay closest to. Default: the input's own centre. */
  referenceCentre?: number;
}

export interface OctaveShift {
  /** Semitones added to every pitch; a multiple of 12. */
  shift: number;
  /** Which range the shifted melody lies in: the soft range, or only 0..127. */
  fits: 'soft' | 'midi';
  softRange: PitchRange | null;
  /** Lowest and highest pitch after the shift; null for an empty melody. */
  ambitus: PitchRange | null;
}

export type OctaveShiftResult =
  | { ok: true; fit: OctaveShift; warnings: TransformWarning[] }
  | { ok: false; errors: TransformError[] };

/** Middle of the ambitus; null for no pitches. */
export function ambitusCentre(pitches: readonly number[]): number | null {
  if (pitches.length === 0) return null;
  return (Math.min(...pitches) + Math.max(...pitches)) / 2;
}

const validRange = (r: PitchRange) =>
  Number.isInteger(r.low) &&
  Number.isInteger(r.high) &&
  r.low >= 0 &&
  r.high <= 127 &&
  r.low <= r.high;

/** The k (shift 12k) that fits `range` with the centre closest to `ref`; null if none fits. */
function bestK(low: number, high: number, range: PitchRange, centre: number, ref: number) {
  const kMin = Math.ceil((range.low - low) / 12) || 0; // never -0
  const kMax = Math.floor((range.high - high) / 12) || 0;
  let best: number | null = null;
  for (let k = kMin; k <= kMax; k++) {
    if (best === null) {
      best = k;
      continue;
    }
    const d = Math.abs(centre + 12 * k - ref);
    const bd = Math.abs(centre + 12 * best - ref);
    // Ties: the smaller shift, then the lower one (k ascends, so keep `best`).
    if (d < bd || (d === bd && Math.abs(k) < Math.abs(best))) best = k;
  }
  return best;
}

/**
 * Find one octave shift for the whole melody (spec §7.4). `pitches` may lie
 * outside 0..127 (e.g. straight after a mapping); the result never does.
 *
 * - Fits the soft range → that shift (`fits: 'soft'`), `RANGE_SHIFTED` if non-zero.
 * - Otherwise, fits 0..127 → that shift (`fits: 'midi'`) plus `RANGE_NO_FIT`.
 * - Otherwise → `PITCH_OUT_OF_RANGE`.
 * With the soft range disabled, any pitch outside 0..127 is an error: the
 * caller asked for no range handling, so nothing is shifted.
 */
export function findOctaveShift(
  pitches: readonly number[],
  options: OctaveShiftOptions = {},
): OctaveShiftResult {
  const softRange = options.softRange === undefined ? DEFAULT_SOFT_RANGE : options.softRange;
  if (softRange && !validRange(softRange)) {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_RANGE',
          message: `Soft range ${softRange.low}..${softRange.high} must be integers with 0 <= low <= high <= 127.`,
        },
      ],
    };
  }
  if (pitches.length === 0) {
    return { ok: true, fit: { shift: 0, fits: 'soft', softRange, ambitus: null }, warnings: [] };
  }
  const low = Math.min(...pitches);
  const high = Math.max(...pitches);
  const centre = (low + high) / 2;
  const ref = options.referenceCentre ?? centre;
  const fit = (k: number, fits: OctaveShift['fits']): OctaveShift => ({
    shift: 12 * k,
    fits,
    softRange,
    ambitus: { low: low + 12 * k, high: high + 12 * k },
  });
  const shifted = (k: number): TransformWarning[] =>
    k === 0
      ? []
      : [
          {
            code: 'RANGE_SHIFTED',
            message: `全曲整体移动 ${k > 0 ? '+' : ''}${k} 个八度以落入音域 ${softRange?.low}..${softRange?.high}（${low}..${high} → ${low + 12 * k}..${high + 12 * k}）。`,
          },
        ];

  if (!softRange) {
    if (low >= MIDI_RANGE.low && high <= MIDI_RANGE.high) {
      return { ok: true, fit: fit(0, 'midi'), warnings: [] };
    }
    return {
      ok: false,
      errors: [
        {
          code: 'PITCH_OUT_OF_RANGE',
          message: `Pitches ${low}..${high} leave MIDI 0..127 and range handling is disabled.`,
        },
      ],
    };
  }

  const soft = bestK(low, high, softRange, centre, ref);
  if (soft !== null) return { ok: true, fit: fit(soft, 'soft'), warnings: shifted(soft) };

  const midi = bestK(low, high, MIDI_RANGE, centre, ref);
  if (midi !== null) {
    return {
      ok: true,
      fit: fit(midi, 'midi'),
      warnings: [
        {
          code: 'RANGE_NO_FIT',
          message: `音域 ${low}..${high}（跨 ${high - low} 个半音）无法通过整八度移位落入软限制 ${softRange.low}..${softRange.high}；${
            midi === 0 ? '保持原八度' : `整体移动 ${midi > 0 ? '+' : ''}${midi} 个八度`
          }，仅保证 MIDI 0..127。`,
        },
      ],
    };
  }
  return {
    ok: false,
    errors: [
      {
        code: 'PITCH_OUT_OF_RANGE',
        message: `Pitches ${low}..${high} span ${high - low} semitones; no octave shift fits MIDI 0..127.`,
      },
    ],
  };
}
