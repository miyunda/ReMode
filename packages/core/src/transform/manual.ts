// Manual pitch editing (spec §10.3): the user moves one note to another pitch.
// Pitch-only like every other transform: the note keeps its ID, ticks and
// velocity (Invariant B) and the input array is never mutated (Invariant A).
// Each edit is recorded as a PitchChange with reasonCode MANUAL_EDIT.

import type { DegreeIdentity, MelodyNote, PitchChange } from '../types.js';
import { isValidMidiPitch, mod, pitchName } from '../theory/pitch.js';
import { getScale } from '../theory/scales.js';
import { degreeLabel, type ModeRef } from './scaleMapping.js';

/** Bump whenever manual-edit behaviour changes (CLAUDE.md rule 6). 1.0.1: Chinese explanations. */
export const MANUAL_EDIT_VERSION = 'remode-manual/1.0.1';

export const MANUAL_EDIT = 'MANUAL_EDIT';

/** True when `pitch` belongs to the mode's scale. */
export function inMode(pitch: number, mode: ModeRef): boolean {
  return getScale(mode.scaleId).intervals.includes(mod(pitch - mode.root, 12));
}

export interface DegreeInfo {
  /** e.g. "♭3"; null for a note outside the scale. */
  label: string | null;
  identity: DegreeIdentity | null;
  /** Scale role, e.g. "tonic", "zhi"; null outside the scale. */
  role: string | null;
  isTonic: boolean;
  /** Semitones above the tonic, 0..11. */
  interval: number;
}

/** Degree of `pitch` in `mode`; `label` is null when the pitch is outside the scale. */
export function degreeOf(pitch: number, mode: ModeRef): DegreeInfo {
  const scale = getScale(mode.scaleId);
  const interval = mod(pitch - mode.root, 12);
  const i = scale.intervals.indexOf(interval);
  const identity = i >= 0 ? (scale.degreeIdentity[i] as DegreeIdentity) : null;
  return {
    label: identity ? degreeLabel(identity) : null,
    identity,
    role: i >= 0 ? (scale.degreeRoles[i] ?? null) : null,
    isTonic: interval === 0,
    interval,
  };
}

/**
 * The pitch `steps` scale tones above (positive) or below (negative) `pitch`.
 * Without a mode every semitone counts as a step. A pitch outside the scale
 * first moves to the next scale tone in the step's direction. Clamped to 0..127.
 */
export function stepPitch(pitch: number, steps: number, mode: ModeRef | null): number {
  const clamp = (p: number) => Math.max(0, Math.min(127, p));
  if (!mode || steps === 0) return clamp(pitch + steps);
  const dir = steps > 0 ? 1 : -1;
  let p = pitch;
  for (let k = 0; k < Math.abs(steps); k++) {
    let next = p + dir;
    while (next >= 0 && next <= 127 && !inMode(next, mode)) next += dir;
    if (next < 0 || next > 127) break;
    p = next;
  }
  return clamp(p);
}

/** The scale tone nearest to `pitch` (ties go down, as strict's `lower` rule). */
export function snapPitch(pitch: number, mode: ModeRef | null): number {
  if (!mode || inMode(pitch, mode)) return pitch;
  for (let d = 1; d < 12; d++) {
    if (pitch - d >= 0 && inMode(pitch - d, mode)) return pitch - d;
    if (pitch + d <= 127 && inMode(pitch + d, mode)) return pitch + d;
  }
  return pitch;
}

export type ManualEditResult =
  | { ok: true; notes: MelodyNote[]; change: PitchChange }
  | { ok: false; code: 'UNKNOWN_NOTE' | 'INVALID_PITCH' | 'NO_CHANGE'; message: string };

/**
 * Copy of `notes` with one note moved to `toPitch`. Only `pitch` changes; the
 * returned change records the pitch before this edit.
 */
export function applyManualEdit(
  notes: readonly MelodyNote[],
  noteId: string,
  toPitch: number,
  explanation?: string,
): ManualEditResult {
  const i = notes.findIndex((n) => n.id === noteId);
  const note = notes[i];
  if (!note) return { ok: false, code: 'UNKNOWN_NOTE', message: `No note with id ${noteId}.` };
  if (!isValidMidiPitch(toPitch)) {
    return { ok: false, code: 'INVALID_PITCH', message: `${toPitch} is not a MIDI pitch 0..127.` };
  }
  if (note.pitch === toPitch) {
    return { ok: false, code: 'NO_CHANGE', message: `Note ${noteId} is already ${toPitch}.` };
  }
  const next = notes.map((n, k) => (k === i ? { ...n, pitch: toPitch } : n));
  return {
    ok: true,
    notes: next,
    change: {
      noteId,
      fromPitch: note.pitch,
      toPitch,
      reasonCode: MANUAL_EDIT,
      explanation: explanation ?? `手动修改：${pitchName(note.pitch)} → ${pitchName(toPitch)}`,
    },
  };
}
