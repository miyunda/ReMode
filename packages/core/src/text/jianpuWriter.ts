// Melody → jianpu text in the `remode-jianpu/1.0.0` syntax (spec §10.8).
// Pitches and ticks read back exactly through parseJianpu: one key, one time
// signature, one tempo, no overlaps, note durations made of a head (1, 1_, 1__,
// with an optional dot) plus whole-beat extenders `-`, and rests that add up
// exactly. Timing that cannot be written is a structured error, never a
// rounding (CLAUDE.md rule 4). What the syntax cannot carry but the timing
// survives is a structured warning: velocities (jianpu has no dynamics here,
// every note reads back as JIANPU_VELOCITY) and notes that cross a barline
// off the beat (no tie syntax, so that bar's barline cannot be placed).

import type { MelodyNote, MidiMetadata } from '../types.js';
import { mod, pitchClassName } from '../theory/pitch.js';
import {
  JIANPU_PARSER_VERSION,
  JIANPU_PPQ,
  JIANPU_REFERENCE_OCTAVE,
  JIANPU_VELOCITY,
} from './jianpu.js';

export type JianpuWriteErrorCode =
  | 'NO_NOTES'
  | 'TEMPO_CHANGE'
  | 'TIME_SIGNATURE_CHANGE'
  | 'UNSUPPORTED_TIME_SIGNATURE'
  | 'INVALID_TEMPO'
  | 'PPQ_NOT_DIVISIBLE'
  | 'OVERLAP'
  | 'UNREPRESENTABLE_DURATION'
  | 'UNREPRESENTABLE_REST';

export interface JianpuWriteError {
  code: JianpuWriteErrorCode;
  message: string;
  noteIds?: string[];
}

export type JianpuWriteWarningCode = 'VELOCITY_DROPPED' | 'BAR_CROSSING_NOTE';

export interface JianpuWriteWarning {
  code: JianpuWriteWarningCode;
  message: string;
  noteIds: string[];
}

export interface WriteJianpuOptions {
  /** Pitch class written as `1=`; default: the first key signature, else C. */
  keyPitchClass?: number;
  /** Bars per line; default 4. */
  barsPerLine?: number;
}

export type WriteJianpuResult =
  | { ok: true; text: string; syntaxVersion: string; warnings: JianpuWriteWarning[] }
  | { ok: false; errors: JianpuWriteError[] };

const KEY_PC: Readonly<Record<string, number>> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7,
  'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
}; // prettier-ignore

/** Semitones above `1` → written degree and accidental. */
const SPELLING: ReadonlyArray<readonly [number, '' | '#' | 'b']> = [
  [1, ''], [1, '#'], [2, ''], [3, 'b'], [3, ''], [4, ''],
  [4, '#'], [5, ''], [6, 'b'], [6, ''], [7, 'b'], [7, ''],
]; // prettier-ignore
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

/** Written head lengths (ticks at PPQ 480) and their suffix. */
const HEADS: ReadonlyArray<readonly [number, string]> = [
  [720, '.'],
  [480, ''],
  [360, '_.'],
  [240, '_'],
  [180, '__.'],
  [120, '__'],
];

/** Head + extender count for a note of `ticks`, or null. */
function noteShape(ticks: number): { suffix: string; extenders: number } | null {
  for (const [head, suffix] of HEADS) {
    const rest = ticks - head;
    if (rest >= 0 && rest % JIANPU_PPQ === 0) return { suffix, extenders: rest / JIANPU_PPQ };
  }
  return null;
}

/** Every head length is a multiple of this. */
const REST_UNIT = 60;

/**
 * Exact rest pieces for [from, to) inside one bar: the fewest pieces that
 * break on beats, and only when no such split exists a piece that crosses a
 * beat. Null when no combination of heads adds up to the gap.
 */
function restSegment(from: number, to: number): Array<{ text: string; end: number }> | null {
  const len = to - from;
  if (len % REST_UNIT !== 0) return null;
  const n = len / REST_UNIT;
  const crossesBeat = (p: number, h: number) =>
    Math.floor(p / JIANPU_PPQ) !== Math.floor((p + h - 1) / JIANPU_PPQ);
  // best[i]: cost of filling from + i·unit to `to`; a beat crossing outweighs any piece count.
  const best = new Array<number>(n + 1).fill(Infinity);
  const pick = new Array<number>(n + 1).fill(-1);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    const p = from + i * REST_UNIT;
    HEADS.forEach(([h], k) => {
      const j = i + h / REST_UNIT;
      if (j > n) return;
      const cost = (best[j] as number) + 1 + (crossesBeat(p, h) ? 1000 : 0);
      if (cost < (best[i] as number)) {
        best[i] = cost;
        pick[i] = k;
      }
    });
  }
  if (!Number.isFinite(best[0])) return null;
  const out: Array<{ text: string; end: number }> = [];
  for (let i = 0; i < n;) {
    const [h, suffix] = HEADS[pick[i] as number] as (typeof HEADS)[number];
    i += h / REST_UNIT;
    out.push({ text: `0${suffix}`, end: from + i * REST_UNIT });
  }
  return out;
}

/** Rests for a gap, split at every barline (a rest never crosses one). */
function restPieces(
  from: number,
  to: number,
  barTicks: number,
): Array<{ text: string; end: number }> | null {
  const out: Array<{ text: string; end: number }> = [];
  for (let t = from; t < to;) {
    const end = Math.min(to, (Math.floor(t / barTicks) + 1) * barTicks);
    const piece = restSegment(t, end);
    if (!piece) return null;
    out.push(...piece);
    t = end;
  }
  return out;
}

/**
 * Melody → jianpu text that parseJianpu reads back to the same pitches and
 * ticks. Velocities are not written (see `VELOCITY_DROPPED`), so the round
 * trip is exact for pitch and timing only.
 */
export function writeJianpu(
  notes: readonly MelodyNote[],
  metadata: Pick<MidiMetadata, 'ppq' | 'tempoMap' | 'timeSignatures' | 'keySignatures'>,
  options: WriteJianpuOptions = {},
): WriteJianpuResult {
  const errors: JianpuWriteError[] = [];
  if (notes.length === 0) errors.push({ code: 'NO_NOTES', message: 'There are no notes.' });

  const tempos = new Set(metadata.tempoMap.map((t) => t.bpm));
  if (tempos.size > 1) {
    errors.push({ code: 'TEMPO_CHANGE', message: 'Jianpu text has a single tempo.' });
  }
  const bpm = metadata.tempoMap[0]?.bpm ?? 120;
  const bpmText = Number.isInteger(bpm) ? String(bpm) : String(Math.round(bpm * 1000) / 1000);
  if (!(bpm > 0 && bpm <= 1000) || Number(bpmText) !== bpm) {
    errors.push({ code: 'INVALID_TEMPO', message: `Tempo ${bpm} cannot be written exactly.` });
  }
  const sigs = new Set(metadata.timeSignatures.map((s) => `${s.numerator}/${s.denominator}`));
  if (sigs.size > 1) {
    errors.push({ code: 'TIME_SIGNATURE_CHANGE', message: 'Jianpu text has one time signature.' });
  }
  const sig = metadata.timeSignatures[0] ?? { tick: 0, numerator: 4, denominator: 4 };
  if (sig.numerator < 1 || sig.numerator > 64 || ![1, 2, 4, 8, 16, 32].includes(sig.denominator)) {
    errors.push({
      code: 'UNSUPPORTED_TIME_SIGNATURE',
      message: `${sig.numerator}/${sig.denominator} is not a jianpu time signature.`,
    });
  }
  const scale = JIANPU_PPQ / metadata.ppq;
  const toTicks = (t: number) => t * scale;
  if (
    notes.some((n) => ![n.startTick, n.durationTick].every((x) => Number.isInteger(toTicks(x))))
  ) {
    errors.push({
      code: 'PPQ_NOT_DIVISIBLE',
      message: `Ticks at PPQ ${metadata.ppq} do not convert exactly to PPQ ${JIANPU_PPQ}.`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as MelodyNote;
    const b = sorted[i] as MelodyNote;
    if (a.startTick + a.durationTick > b.startTick) {
      errors.push({
        code: 'OVERLAP',
        message: 'Jianpu text cannot write overlapping notes.',
        noteIds: [a.id, b.id],
      });
    }
  }

  const ks = metadata.keySignatures?.[0]?.key;
  const keyPc = mod(options.keyPitchClass ?? (ks !== undefined ? (KEY_PC[ks] ?? 0) : 0), 12);
  const reference = keyPc + (JIANPU_REFERENCE_OCTAVE + 1) * 12;
  const barTicks = (sig.numerator * 4 * JIANPU_PPQ) / sig.denominator;
  const warnings: JianpuWriteWarning[] = [];
  const crossing: string[] = [];

  // Tokens with the tick they end at; barlines go between tokens on bar boundaries.
  const tokens: Array<{ text: string; end: number }> = [];
  let t = 0;
  for (const n of sorted) {
    const start = toTicks(n.startTick);
    const ticks = toTicks(n.durationTick);
    if (start > t) {
      const rests = restPieces(t, start, barTicks);
      if (!rests) {
        errors.push({
          code: 'UNREPRESENTABLE_REST',
          message: `The ${start - t}-tick gap before ${n.id} (PPQ ${JIANPU_PPQ}) cannot be written as rests: rest pieces (0, 0_, 0__, optionally dotted) are 120–720 ticks in steps of 60 and may not cross a barline.`,
          noteIds: [n.id],
        });
        return { ok: false, errors };
      }
      tokens.push(...rests);
    }
    const shape = noteShape(ticks);
    if (!shape) {
      errors.push({
        code: 'UNREPRESENTABLE_DURATION',
        message: `${n.id} lasts ${ticks} ticks at PPQ ${JIANPU_PPQ}; jianpu needs a head of 1, 1_, 1__ (optionally dotted) plus whole beats.`,
        noteIds: [n.id],
      });
      continue;
    }
    const offset = n.pitch - reference;
    const [degree, acc] = SPELLING[mod(offset, 12)] as (typeof SPELLING)[number];
    const octave =
      (offset - (MAJOR[degree - 1] as number) - (acc === '#' ? 1 : acc === 'b' ? -1 : 0)) / 12;
    const marks = octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
    let end = start + ticks - shape.extenders * JIANPU_PPQ;
    const ends = [end];
    tokens.push({ text: `${acc}${degree}${marks}${shape.suffix}`, end });
    for (let k = 0; k < shape.extenders; k++) {
      end += JIANPU_PPQ;
      ends.push(end);
      tokens.push({ text: '-', end });
    }
    // A barline inside the note is written only where a token ends on it.
    for (let b = (Math.floor(start / barTicks) + 1) * barTicks; b < start + ticks; b += barTicks) {
      if (!ends.includes(b)) {
        crossing.push(n.id);
        break;
      }
    }
    t = start + ticks;
  }
  if (errors.length > 0) return { ok: false, errors };

  const loud = notes.filter((n) => Math.abs(n.velocity - JIANPU_VELOCITY) > 1e-9).map((n) => n.id);
  if (loud.length > 0) {
    warnings.push({
      code: 'VELOCITY_DROPPED',
      message: `${loud.length} note(s) have a velocity other than ${Math.round(JIANPU_VELOCITY * 127)}/127; jianpu text has no dynamics, so they read back at ${Math.round(JIANPU_VELOCITY * 127)}/127.`,
      noteIds: loud,
    });
  }
  if (crossing.length > 0) {
    warnings.push({
      code: 'BAR_CROSSING_NOTE',
      message: `${crossing.length} note(s) cross a barline off the beat; without tie syntax that barline cannot be written, so the bars around them merge (ticks are unchanged, parseJianpu reports BAR_DURATION_MISMATCH).`,
      noteIds: crossing,
    });
  }

  const barsPerLine = options.barsPerLine ?? 4;
  const lines: string[] = [];
  let line = '|';
  let bars = 0;
  tokens.forEach((tok, i) => {
    line += ` ${tok.text}`;
    const last = i === tokens.length - 1;
    if (tok.end % barTicks === 0 || last) {
      line += ' |';
      bars++;
      if (bars % barsPerLine === 0 || last) {
        lines.push(line);
        line = '|';
      }
    }
  });
  const header = `1=${pitchClassName(keyPc)} ${sig.numerator}/${sig.denominator} bpm=${bpmText}`;
  return {
    ok: true,
    text: [header, ...lines].join('\n') + '\n',
    syntaxVersion: JIANPU_PARSER_VERSION,
    warnings,
  };
}
