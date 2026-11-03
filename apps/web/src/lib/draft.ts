// New-melody mode (spec §10.3): notes placed on an empty roll. The draft is
// freely editable (add / move / resize / delete) until the user finishes it;
// from then on it is the Original and the usual immutability rules apply.
// Every edit keeps the draft monophonic: an edit that would overlap another
// note is refused rather than trimmed.

import {
  JIANPU_PPQ,
  JIANPU_VELOCITY,
  pitchClassName,
  type MelodyNote,
  type MidiMetadata,
} from '@remode/core';

export interface DraftSettings {
  /** Pitch class of the key (`1=` in jianpu). */
  keyPc: number;
  numerator: number;
  denominator: number;
  bpm: number;
  /** Grid step in ticks (PPQ 480). */
  quantum: number;
}

export interface Draft {
  settings: DraftSettings;
  /** Kept sorted by start tick. */
  notes: readonly MelodyNote[];
  /** Next draft ID number; IDs are renumbered in time order when the draft is finished. */
  nextId: number;
}

export const DRAFT_PPQ = JIANPU_PPQ;

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  keyPc: 0,
  numerator: 4,
  denominator: 4,
  bpm: 96,
  quantum: DRAFT_PPQ / 2,
};

export const QUANTA: Array<{ ticks: number; label: string }> = [
  { ticks: DRAFT_PPQ, label: '四分音符' },
  { ticks: DRAFT_PPQ / 2, label: '八分音符' },
  { ticks: DRAFT_PPQ / 4, label: '十六分音符' },
];

export const TIME_SIGNATURES: Array<[number, number]> = [
  [2, 4],
  [3, 4],
  [4, 4],
  [6, 8],
];

/** Draft limits: the same note cap as imports; pitches stay inside the piano. */
export const DRAFT_LIMITS = { maxNotes: 5_000, minPitch: 21, maxPitch: 108 } as const;

export const emptyDraft = (settings: DraftSettings = DEFAULT_DRAFT_SETTINGS): Draft => ({
  settings,
  notes: [],
  nextId: 0,
});

const end = (n: Pick<MelodyNote, 'startTick' | 'durationTick'>) => n.startTick + n.durationTick;

/** True when `n` fits without overlapping any other note (ignoring `n.id` itself). */
export function fits(notes: readonly MelodyNote[], n: MelodyNote): boolean {
  if (n.startTick < 0 || n.durationTick <= 0) return false;
  if (!Number.isInteger(n.startTick) || !Number.isInteger(n.durationTick)) return false;
  if (n.pitch < DRAFT_LIMITS.minPitch || n.pitch > DRAFT_LIMITS.maxPitch) return false;
  return notes.every((o) => o.id === n.id || end(o) <= n.startTick || o.startTick >= end(n));
}

const sortByStart = (notes: MelodyNote[]) => notes.sort((a, b) => a.startTick - b.startTick);

export function addNote(
  draft: Draft,
  at: { pitch: number; startTick: number; durationTick?: number },
): Draft {
  if (draft.notes.length >= DRAFT_LIMITS.maxNotes) return draft;
  const note: MelodyNote = {
    id: `draft:${draft.nextId}`,
    pitch: at.pitch,
    startTick: at.startTick,
    durationTick: at.durationTick ?? draft.settings.quantum,
    velocity: JIANPU_VELOCITY,
  };
  if (!fits(draft.notes, note)) return draft;
  return { ...draft, notes: sortByStart([...draft.notes, note]), nextId: draft.nextId + 1 };
}

export function updateNote(
  draft: Draft,
  id: string,
  patch: Partial<Pick<MelodyNote, 'pitch' | 'startTick' | 'durationTick'>>,
): Draft {
  const current = draft.notes.find((n) => n.id === id);
  if (!current) return draft;
  const next = { ...current, ...patch };
  if (
    next.pitch === current.pitch &&
    next.startTick === current.startTick &&
    next.durationTick === current.durationTick
  )
    return draft;
  if (!fits(draft.notes, next)) return draft;
  return { ...draft, notes: sortByStart(draft.notes.map((n) => (n.id === id ? next : n))) };
}

export function deleteNote(draft: Draft, id: string): Draft {
  if (!draft.notes.some((n) => n.id === id)) return draft;
  return { ...draft, notes: draft.notes.filter((n) => n.id !== id) };
}

/** The draft as a melody: notes renumbered `new:n<k>` in time order, PPQ 480, one tempo and metre. */
export function draftMelody(draft: Draft): { notes: MelodyNote[]; metadata: MidiMetadata } {
  const { keyPc, numerator, denominator, bpm } = draft.settings;
  return {
    notes: draft.notes.map((n, k) => ({ ...n, id: `new:n${k}` })),
    metadata: {
      ppq: DRAFT_PPQ,
      tempoMap: [{ tick: 0, bpm }],
      timeSignatures: [{ tick: 0, numerator, denominator }],
      keySignatures: [{ tick: 0, key: pitchClassName(keyPc), scale: 'major' }],
      channel: 0,
      instrumentProgram: 0,
    },
  };
}
