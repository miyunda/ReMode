// Shared pieces of the pitch-only transforms (spec §7): structured issues,
// input checks and the copy-on-write note update that keeps Invariant B.

import type { MelodyNote, PitchChange } from '../types.js';
import { isValidMidiPitch } from '../theory/pitch.js';

export type TransformErrorCode =
  | 'INVALID_NOTE'
  | 'INVALID_SEMITONES'
  | 'INVALID_ROOT'
  | 'INVALID_RANGE'
  | 'UNKNOWN_SCALE'
  | 'PITCH_OUT_OF_RANGE'
  | 'ACCIDENTAL_REJECTED'
  | 'PRESERVE_REQUIRES_LOOSE_TARGET';

export type TransformWarningCode =
  | 'RANGE_SHIFTED'
  | 'RANGE_NO_FIT'
  | 'ACCIDENTALS_MAPPED'
  | 'ACCIDENTALS_PRESERVED'
  | 'NO_CHARACTERISTIC_DEGREE'
  | 'CONTOUR_REVERSED'
  | 'REPETITION_INTRODUCED';

export interface TransformIssue<C extends string> {
  code: C;
  message: string;
  noteIds?: string[];
}

export type TransformError = TransformIssue<TransformErrorCode>;
export type TransformWarning = TransformIssue<TransformWarningCode> & {
  /** NO_CHARACTERISTIC_DEGREE: the degrees that differ between source and target. */
  degrees?: string[];
};

/**
 * Reason codes of strict / transpose changes. `SCALE_CONSTRAINT` and
 * `RANGE_ADJUSTMENT` are shared with the Expressive log (spec §8.5).
 */
export type StrictReasonCode =
  'DEGREE_MAPPED' | 'SCALE_CONSTRAINT' | 'ACCIDENTAL_NEAREST' | 'TRANSPOSE' | 'RANGE_ADJUSTMENT';

/** Pitch-only transforms read nothing but `pitch`; everything else is copied untouched. */
export function checkNotes(notes: readonly MelodyNote[]): TransformError[] {
  const bad = notes.filter((n) => !isValidMidiPitch(n.pitch));
  if (bad.length === 0) return [];
  return [
    {
      code: 'INVALID_NOTE',
      message: `${bad.length} note(s) have a pitch outside the integers 0..127.`,
      noteIds: bad.map((n) => n.id),
    },
  ];
}

/** Indices of `notes` in time order (start tick, then id), ties stable. */
export function timeOrder(notes: readonly MelodyNote[]): number[] {
  return notes
    .map((_, i) => i)
    .sort((a, b) => {
      const x = notes[a] as MelodyNote;
      const y = notes[b] as MelodyNote;
      return x.startTick - y.startTick || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || a - b;
    });
}

/** New note objects with only `pitch` replaced (Invariants A and B). */
export const withPitches = (
  notes: readonly MelodyNote[],
  pitches: readonly number[],
): MelodyNote[] => notes.map((n, i) => ({ ...n, pitch: pitches[i] as number }));

export const change = (
  note: MelodyNote,
  toPitch: number,
  reasonCode: StrictReasonCode,
  explanation: string,
): PitchChange => ({ noteId: note.id, fromPitch: note.pitch, toPitch, reasonCode, explanation });

export const signedSemitones = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
