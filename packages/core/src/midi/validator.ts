// Monophony validation (spec §5.2) and the explicit, audited safe repair.

import type { MelodyNote, MidiMetadata, TempoEvent } from '../types.js';
import { isValidMidiPitch, pitchName } from '../theory/pitch.js';
import type { ImportedTrack } from './import.js';

export type ValidationCode =
  | 'EMPTY_TRACK'
  | 'PERCUSSION_TRACK'
  | 'INVALID_PITCH'
  | 'INVALID_START'
  | 'INVALID_DURATION'
  | 'INVALID_VELOCITY'
  | 'SAME_TICK_CHORD'
  | 'DUPLICATE_NOTE'
  | 'OVERLAP'
  | 'PITCH_BEND_PRESENT'
  | 'SUSTAIN_PEDAL_PRESENT';

export interface ValidationIssue {
  code: ValidationCode;
  severity: 'error' | 'warning';
  message: string;
  noteIds: string[];
  tick?: number;
  pitches?: number[];
  overlapTicks?: number;
  overlapMs?: number;
  /** OVERLAP only: true when `repairLegatoOverlaps` may trim it. */
  repairable?: boolean;
  suggestion?: string;
}

export interface ValidationReport {
  /** No error-severity issues. */
  ok: boolean;
  /** No overlaps or simultaneous onsets of any severity. */
  monophonic: boolean;
  noteCount: number;
  issues: ValidationIssue[];
}

export interface ValidationOptions {
  /** Real-time tolerance for a repairable legato tail (spec §5.2: initially 15 ms). */
  legatoToleranceMs: number;
  /** Tick cap on that tolerance, as a fraction of a quarter note. */
  legatoToleranceMaxBeats: number;
}

export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  legatoToleranceMs: 15,
  legatoToleranceMaxBeats: 1 / 16,
};

export function bpmAt(tempoMap: readonly TempoEvent[], tick: number): number {
  let bpm = tempoMap[0]?.bpm ?? 120;
  for (const t of tempoMap) {
    if (t.tick <= tick) bpm = t.bpm;
    else break;
  }
  return bpm;
}

const msPerTick = (meta: Pick<MidiMetadata, 'ppq' | 'tempoMap'>, tick: number) =>
  60000 / (bpmAt(meta.tempoMap, tick) * meta.ppq);

/** Repairable overlap limit at `tick`: min(tolerance in ms → ticks, tick cap). */
export function legatoToleranceTicks(
  meta: Pick<MidiMetadata, 'ppq' | 'tempoMap'>,
  tick: number,
  opts: ValidationOptions = DEFAULT_VALIDATION_OPTIONS,
): number {
  return Math.min(
    Math.floor(opts.legatoToleranceMs / msPerTick(meta, tick)),
    Math.floor(meta.ppq * opts.legatoToleranceMaxBeats),
  );
}

const end = (n: MelodyNote) => n.startTick + n.durationTick;

function noteValidity(n: MelodyNote): ValidationIssue | null {
  const base = { severity: 'error' as const, noteIds: [n.id] };
  if (!isValidMidiPitch(n.pitch)) {
    return {
      ...base,
      code: 'INVALID_PITCH',
      message: `Note ${n.id}: pitch ${n.pitch} is not an integer in 0..127.`,
    };
  }
  if (!Number.isInteger(n.startTick) || n.startTick < 0) {
    return {
      ...base,
      code: 'INVALID_START',
      message: `Note ${n.id}: start tick ${n.startTick} is invalid.`,
    };
  }
  if (!Number.isInteger(n.durationTick) || n.durationTick <= 0) {
    return {
      ...base,
      code: 'INVALID_DURATION',
      tick: n.startTick,
      message: `Note ${n.id} at tick ${n.startTick}: duration ${n.durationTick} ticks is not positive.`,
      suggestion: 'Remove the zero-length note in the source and re-import.',
    };
  }
  if (!Number.isFinite(n.velocity) || n.velocity < 0 || n.velocity > 1) {
    return {
      ...base,
      code: 'INVALID_VELOCITY',
      message: `Note ${n.id}: velocity ${n.velocity} is outside 0..1.`,
    };
  }
  return null;
}

/**
 * Check that a note list is a playable monophonic line. Overlaps are found
 * against the running maximum end tick (not just the previous note), so a
 * long note sustaining under several later notes is caught.
 */
export function validateMelody(
  notes: readonly MelodyNote[],
  meta: Pick<MidiMetadata, 'ppq' | 'tempoMap'>,
  options: Partial<ValidationOptions> = {},
): ValidationReport {
  const opts = { ...DEFAULT_VALIDATION_OPTIONS, ...options };
  const issues: ValidationIssue[] = [];
  const valid: MelodyNote[] = [];
  for (const n of notes) {
    const problem = noteValidity(n);
    if (problem) issues.push(problem);
    else valid.push(n);
  }
  valid.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.id.localeCompare(b.id));

  let holder: MelodyNote | undefined; // note with the greatest end tick so far
  let prev: MelodyNote | undefined;
  for (let i = 0; i < valid.length;) {
    // Group simultaneous onsets.
    const group: MelodyNote[] = [];
    const tick = (valid[i] as MelodyNote).startTick;
    while (i < valid.length && (valid[i] as MelodyNote).startTick === tick)
      group.push(valid[i++] as MelodyNote);

    if (group.length > 1) {
      const pitches = group.map((n) => n.pitch);
      const distinct = new Set(pitches).size;
      issues.push({
        code: distinct === 1 ? 'DUPLICATE_NOTE' : 'SAME_TICK_CHORD',
        severity: 'error',
        tick,
        noteIds: group.map((n) => n.id),
        pitches,
        message:
          distinct === 1
            ? `Tick ${tick}: ${group.length} identical ${pitchName(pitches[0] as number)} notes start together.`
            : `Tick ${tick}: ${pitches.map(pitchName).join(', ')} start together (chord).`,
        suggestion:
          'Keep one note per onset in the source (trimming cannot make a chord monophonic).',
      });
    }

    const first = group[0] as MelodyNote;
    if (holder && first.startTick < end(holder)) {
      for (const n of group) {
        if (n.startTick >= end(holder)) break;
        const overlapTicks = Math.min(end(holder), end(n)) - n.startTick;
        const nested = end(holder) > end(n);
        const tolerance = legatoToleranceTicks(meta, n.startTick, opts);
        const repairable =
          !nested && group.length === 1 && holder === prev && overlapTicks <= tolerance;
        issues.push({
          code: 'OVERLAP',
          severity: repairable ? 'warning' : 'error',
          tick: n.startTick,
          noteIds: [holder.id, n.id],
          pitches: [holder.pitch, n.pitch],
          overlapTicks,
          overlapMs: Math.round(overlapTicks * msPerTick(meta, n.startTick) * 100) / 100,
          repairable,
          message: `Tick ${n.startTick}: ${pitchName(holder.pitch)} (${holder.id}) still sounds for ${overlapTicks} ticks when ${pitchName(n.pitch)} (${n.id}) starts${nested ? ' and outlasts it (nested)' : ''}.`,
          suggestion: repairable
            ? `Legato tail within ${tolerance} ticks: trim ${holder.id} to end at tick ${n.startTick} (safe repair).`
            : 'Overlap exceeds the legato tolerance or is nested; fix it in the source or choose the notes manually.',
        });
      }
    }

    for (const n of group) if (!holder || end(n) > end(holder)) holder = n;
    prev = group[group.length - 1];
  }

  const monophonic = !issues.some((x) =>
    ['OVERLAP', 'SAME_TICK_CHORD', 'DUPLICATE_NOTE'].includes(x.code),
  );
  return {
    ok: !issues.some((x) => x.severity === 'error'),
    monophonic,
    noteCount: notes.length,
    issues,
  };
}

/** Track-level checks (empty, percussion, pitch bend, CC64) plus `validateMelody`. */
export function validateTrack(
  track: ImportedTrack,
  meta: Pick<MidiMetadata, 'ppq' | 'tempoMap'>,
  options: Partial<ValidationOptions> = {},
): ValidationReport {
  const report = validateMelody(track.notes, meta, options);
  const extra: ValidationIssue[] = [];
  if (track.noteCount === 0) {
    extra.push({
      code: 'EMPTY_TRACK',
      severity: 'error',
      noteIds: [],
      message: `${track.id} has no notes.`,
    });
  }
  if (track.isPercussion) {
    extra.push({
      code: 'PERCUSSION_TRACK',
      severity: 'error',
      noteIds: [],
      message: `${track.id} is on MIDI channel 10 (percussion); note numbers are drum sounds, not pitches.`,
    });
  }
  if (track.hasPitchBend) {
    extra.push({
      code: 'PITCH_BEND_PRESENT',
      severity: 'warning',
      noteIds: [],
      message: 'Track contains pitch bend; analysis uses discrete note numbers and ignores bends.',
    });
  }
  if (track.hasSustainPedal) {
    extra.push({
      code: 'SUSTAIN_PEDAL_PRESENT',
      severity: 'warning',
      noteIds: [],
      message:
        'Track uses the sustain pedal (CC64); it may sound polyphonic even without note overlaps.',
    });
  }
  const issues = [...extra, ...report.issues];
  return { ...report, ok: !issues.some((x) => x.severity === 'error'), issues };
}

// --- Safe repair ---------------------------------------------------------------

export interface RepairRecord {
  noteId: string;
  action: 'TRIM_LEGATO_TAIL';
  field: 'durationTick';
  from: number;
  to: number;
  overlapTicks: number;
  overlapMs: number;
  /** The note whose onset the trimmed tail overlapped. */
  causedBy: string;
}

/** An audited, cleaned copy of a source; the source itself is never modified. */
export interface CleanedSource {
  kind: 'cleaned-source';
  notes: MelodyNote[];
  repairs: RepairRecord[];
  /** Error-severity issues the repair does not touch. */
  unrepaired: ValidationIssue[];
}

/**
 * Trim only overlaps the validator marked `repairable` (sequential legato tails
 * within tolerance). Everything else is left for the user. Returns new note
 * objects; `notes` is not mutated.
 */
export function repairLegatoOverlaps(
  notes: readonly MelodyNote[],
  report: ValidationReport,
): CleanedSource {
  const byId = new Map(notes.map((n) => [n.id, { ...n }]));
  const repairs: RepairRecord[] = [];
  for (const issue of report.issues) {
    if (issue.code !== 'OVERLAP' || !issue.repairable) continue;
    const [heldId, nextId] = issue.noteIds as [string, string];
    const held = byId.get(heldId);
    const next = byId.get(nextId);
    if (!held || !next) continue;
    const to = next.startTick - held.startTick;
    if (to <= 0 || to >= held.durationTick) continue;
    repairs.push({
      noteId: held.id,
      action: 'TRIM_LEGATO_TAIL',
      field: 'durationTick',
      from: held.durationTick,
      to,
      overlapTicks: issue.overlapTicks ?? held.durationTick - to,
      overlapMs: issue.overlapMs ?? 0,
      causedBy: next.id,
    });
    held.durationTick = to;
  }
  return {
    kind: 'cleaned-source',
    notes: notes.map((n) => byId.get(n.id) as MelodyNote),
    repairs,
    unrepaired: report.issues.filter((x) => x.severity === 'error'),
  };
}
