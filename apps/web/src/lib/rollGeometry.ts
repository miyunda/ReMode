// Pure layout maths for the piano roll: the bar/beat grid from the
// time-signature map, the pitch range, coordinate transforms and hit testing.
// No DOM here, so it is unit-tested directly.

import type { MelodyNote, MidiMetadata } from '@remode/core';

/** Width of the keyboard gutter and height of the bar ruler, in CSS pixels. */
export const GUTTER = 64;
export const RULER = 22;

export interface GridLine {
  tick: number;
  kind: 'bar' | 'beat';
  /** 1-based bar number (bar lines only). */
  bar?: number;
}

/** Bar and beat lines in [from, to) following every time signature (spec §10.3). */
export function gridLines(
  meta: Pick<MidiMetadata, 'ppq' | 'timeSignatures'>,
  from: number,
  to: number,
): GridLine[] {
  const sigs = [...meta.timeSignatures].sort((a, b) => a.tick - b.tick);
  if (sigs.length === 0 || (sigs[0]?.tick ?? 0) > 0)
    sigs.unshift({ tick: 0, numerator: 4, denominator: 4 });
  const out: GridLine[] = [];
  let bar = 1;
  for (let s = 0; s < sigs.length; s++) {
    const sig = sigs[s] as (typeof sigs)[number];
    const segEnd = sigs[s + 1]?.tick ?? Infinity;
    const beat = (meta.ppq * 4) / sig.denominator;
    const barTicks = beat * sig.numerator;
    for (let t = sig.tick; t < segEnd && t < to; t += barTicks) {
      if (t + barTicks > from) {
        if (t >= from) out.push({ tick: t, kind: 'bar', bar });
        for (let k = 1; k < sig.numerator; k++) {
          const bt = t + k * beat;
          if (bt >= from && bt < to && bt < segEnd) out.push({ tick: bt, kind: 'beat' });
        }
      }
      bar++;
    }
    // A signature change mid-bar starts a new bar there.
    if (segEnd === Infinity) break;
  }
  return out;
}

export interface PitchRange {
  lo: number;
  hi: number;
}

/** Rows shown: the notes' range padded by `pad`, at least `minRows`, clamped to 0..127. */
export function pitchRange(
  pitches: readonly number[],
  pad = 12,
  minRows = 24,
  fallback = 60,
): PitchRange {
  let lo = Math.min(...pitches, Infinity);
  let hi = Math.max(...pitches, -Infinity);
  if (!Number.isFinite(lo)) lo = hi = fallback;
  lo -= pad;
  hi += pad;
  while (hi - lo + 1 < minRows) {
    lo--;
    hi++;
  }
  return { lo: Math.max(0, lo), hi: Math.min(127, hi) };
}

export interface View {
  pxPerTick: number;
  rowH: number;
  range: PitchRange;
  /** Content scroll offsets. */
  scrollX: number;
  scrollY: number;
}

export const tickToX = (v: View, tick: number) => GUTTER + tick * v.pxPerTick - v.scrollX;
export const xToTick = (v: View, x: number) => (x - GUTTER + v.scrollX) / v.pxPerTick;
export const pitchToY = (v: View, pitch: number) =>
  RULER + (v.range.hi - pitch) * v.rowH - v.scrollY;
export const yToPitch = (v: View, y: number) =>
  Math.max(
    v.range.lo,
    Math.min(v.range.hi, v.range.hi - Math.floor((y - RULER + v.scrollY) / v.rowH)),
  );

/** Full content size (scrollable area) in CSS pixels. */
export const contentSize = (v: Pick<View, 'pxPerTick' | 'rowH' | 'range'>, totalTicks: number) => ({
  width: GUTTER + totalTicks * v.pxPerTick,
  height: RULER + (v.range.hi - v.range.lo + 1) * v.rowH,
});

/** Zoom that fits the melody: whole length across, the used pitches (±2) down, within limits. */
export function fitView(
  notes: readonly Pick<MelodyNote, 'pitch' | 'startTick' | 'durationTick'>[],
  range: PitchRange,
  totalTicks: number,
  ppq: number,
  viewport: { width: number; height: number },
): Pick<View, 'pxPerTick' | 'rowH' | 'scrollX' | 'scrollY'> {
  const minPx = 6 / ppq; // 6 px per quarter note
  const maxPx = 160 / ppq;
  const pxPerTick = Math.max(
    minPx,
    Math.min(maxPx, (viewport.width - GUTTER - 8) / Math.max(totalTicks, ppq)),
  );
  const used = notes.length
    ? { lo: Math.min(...notes.map((n) => n.pitch)), hi: Math.max(...notes.map((n) => n.pitch)) }
    : { lo: 60, hi: 72 };
  const rows = used.hi - used.lo + 5;
  const rowH = Math.max(6, Math.min(22, Math.floor((viewport.height - RULER) / rows)));
  const scrollY = Math.max(0, (range.hi - (used.hi + 2)) * rowH);
  return { pxPerTick, rowH, scrollX: 0, scrollY };
}

/** Index of the note under (tick, pitch), preferring the one starting latest. */
export function hitNote(
  notes: readonly Pick<MelodyNote, 'pitch' | 'startTick' | 'durationTick'>[],
  tick: number,
  pitch: number,
): number {
  let best = -1;
  notes.forEach((n, i) => {
    if (n.pitch === pitch && tick >= n.startTick && tick < n.startTick + n.durationTick) {
      if (best < 0 || n.startTick >= (notes[best] as MelodyNote).startTick) best = i;
    }
  });
  return best;
}

/** Note indices in time order (start, then array order). */
export const timeOrderOf = (notes: readonly Pick<MelodyNote, 'startTick'>[]): number[] =>
  notes
    .map((_, i) => i)
    .sort((a, b) => (notes[a]?.startTick ?? 0) - (notes[b]?.startTick ?? 0) || a - b);

export const snapTick = (tick: number, quantum: number) =>
  Math.max(0, Math.floor(tick / quantum) * quantum);

/** Nearest grid tick (ruler seek and loop edges). */
export const nearestTick = (tick: number, quantum: number) =>
  Math.max(0, Math.round(tick / quantum) * quantum);
