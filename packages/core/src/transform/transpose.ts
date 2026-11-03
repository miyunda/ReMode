// Chromatic transpose (spec §7.1, operation 2): add n semitones to every
// note, keeping every interval. Pitch-only: IDs, ticks, durations and
// velocities are copied (Invariant B); the input is never mutated (Invariant A).

import type { MelodyNote, MelodyVariant, PitchChange, TransformSettings } from '../types.js';
import { pitchName } from '../theory/pitch.js';
import {
  change,
  checkNotes,
  signedSemitones,
  withPitches,
  type TransformError,
  type TransformWarning,
} from './common.js';
import { findOctaveShift, type OctaveShift, type PitchRange } from './range.js';

/** Bump whenever transpose behaviour changes (CLAUDE.md rule 6). */
export const TRANSPOSE_VERSION = 'remode-transpose/1.0.0';

export interface TransposeOptions {
  /** Soft range (spec §7.4); `null` disables it. Default 21–108. */
  softRange?: PitchRange | null;
  /** `MelodyVariant.createdAt`; default `Date.now()`. */
  createdAt?: number;
}

export interface TransposeSettings extends TransformSettings {
  operation: 'transpose';
  version: string;
  semitones: number;
  softRange: PitchRange | null;
  /** Extra whole-octave shift applied by range handling (0 if none). */
  rangeShift: number;
}

export type TransposeResult =
  | {
      ok: true;
      /** A `custom` variant: transpose alone is not one of the named strategies. */
      variant: MelodyVariant & { transform: TransposeSettings };
      range: OctaveShift;
      warnings: TransformWarning[];
    }
  | { ok: false; errors: TransformError[] };

export function transpose(
  notes: readonly MelodyNote[],
  semitones: number,
  options: TransposeOptions = {},
): TransposeResult {
  const errors = checkNotes(notes);
  if (!Number.isInteger(semitones)) {
    errors.push({
      code: 'INVALID_SEMITONES',
      message: `Semitones must be an integer, got ${semitones}.`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const moved = notes.map((n) => n.pitch + semitones);
  // The transposed register is what the user asked for, so it is the centre to keep.
  const range = findOctaveShift(
    moved,
    options.softRange === undefined ? {} : { softRange: options.softRange },
  );
  if (!range.ok) return { ok: false, errors: range.errors };
  const { shift } = range.fit;
  const pitches = moved.map((p) => p + shift);
  const changes: PitchChange[] = [];
  notes.forEach((n, i) => {
    const to = pitches[i] as number;
    if (to === n.pitch) return;
    const octave = shift === 0 ? '' : `，再整体移动 ${shift / 12} 个八度（RANGE_ADJUSTMENT）`;
    changes.push(
      change(
        n,
        to,
        semitones === 0 ? 'RANGE_ADJUSTMENT' : 'TRANSPOSE',
        `${pitchName(n.pitch)} → ${pitchName(to)}：移调 ${signedSemitones(semitones)} 半音${octave}`,
      ),
    );
  });
  return {
    ok: true,
    variant: {
      id: 'custom',
      notes: withPitches(notes, pitches),
      createdAt: options.createdAt ?? Date.now(),
      transform: {
        operation: 'transpose',
        version: TRANSPOSE_VERSION,
        semitones,
        softRange: range.fit.softRange,
        rangeShift: shift,
      },
      changes,
    },
    range: range.fit,
    warnings: range.warnings,
  };
}
