import type { MelodyNote } from '../types.js';

export interface PhraseSegmentationOptions {
  ppq: number;
  /** A rest of at least this many beats ends a phrase. */
  restBeats: number;
  /** A note of >= factor × median duration (and >= 1 beat) ends a phrase. */
  longNoteFactor: number;
}

export interface Phrase {
  notes: MelodyNote[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * Heuristic phrase boundaries from rests and long notes (spec §8.2). Expects
 * notes sorted by onset. Manual phrase marks arrive with the UI (M3).
 */
export function segmentPhrases(
  notes: readonly MelodyNote[],
  opts: PhraseSegmentationOptions,
): Phrase[] {
  if (notes.length === 0) return [];
  const med = median(notes.map((n) => n.durationTick));
  const restTicks = opts.restBeats * opts.ppq;
  const phrases: Phrase[] = [];
  let current: MelodyNote[] = [];
  notes.forEach((note, i) => {
    current.push(note);
    const next = notes[i + 1];
    if (!next) return;
    const gap = next.startTick - (note.startTick + note.durationTick);
    const long = note.durationTick >= opts.longNoteFactor * med && note.durationTick >= opts.ppq;
    if (gap >= restTicks || long) {
      phrases.push({ notes: current });
      current = [];
    }
  });
  phrases.push({ notes: current });
  return phrases;
}
