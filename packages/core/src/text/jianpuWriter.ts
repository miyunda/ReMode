// Melody → jianpu text in the `remode-jianpu/1.0.0` syntax (spec §10.8), the
// inverse of parseJianpu for what the syntax can express: one key, one time
// signature, one tempo, no overlaps, and durations made of a head (1, 1_, 1__,
// with an optional dot) plus whole-beat extenders `-`. Anything else is a
// structured error, never a silent rounding of the timing (CLAUDE.md rule 4).

import type { MelodyNote, MidiMetadata } from '../types.js';
import { mod, pitchClassName } from '../theory/pitch.js';
import { JIANPU_PARSER_VERSION, JIANPU_PPQ, JIANPU_REFERENCE_OCTAVE } from './jianpu.js';

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

export interface WriteJianpuOptions {
  /** Pitch class written as `1=`; default: the first key signature, else C. */
  keyPitchClass?: number;
  /** Bars per line; default 4. */
  barsPerLine?: number;
}

export type WriteJianpuResult =
  { ok: true; text: string; syntaxVersion: string } | { ok: false; errors: JianpuWriteError[] };

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

/** Rest pieces for a gap: whole beats as `0`, fractions as `0_` / `0__` / dotted. */
function restPieces(
  from: number,
  to: number,
  boundaries: (t: number) => number,
): Array<{ text: string; end: number }> | null {
  const out: Array<{ text: string; end: number }> = [];
  let t = from;
  while (t < to) {
    const end = Math.min(to, boundaries(t));
    let len = end - t;
    while (len > 0) {
      const head = HEADS.find(([h]) => h <= len && h <= JIANPU_PPQ);
      if (!head) return null;
      len -= head[0];
      t += head[0];
      out.push({ text: `0${head[1]}`, end: t });
    }
  }
  return out;
}

/** Melody → jianpu text that parseJianpu reads back to the same pitches and ticks. */
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
  // Rests break at every beat and every barline.
  const nextBoundary = (t: number) =>
    Math.min(
      (Math.floor(t / JIANPU_PPQ) + 1) * JIANPU_PPQ,
      (Math.floor(t / barTicks) + 1) * barTicks,
    );

  // Tokens with the tick they end at; barlines go between tokens on bar boundaries.
  const tokens: Array<{ text: string; end: number }> = [];
  let t = 0;
  for (const n of sorted) {
    const start = toTicks(n.startTick);
    const ticks = toTicks(n.durationTick);
    if (start > t) {
      const rests = restPieces(t, start, nextBoundary);
      if (!rests) {
        errors.push({
          code: 'UNREPRESENTABLE_REST',
          message: `The gap before ${n.id} is not a multiple of a sixteenth.`,
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
    tokens.push({ text: `${acc}${degree}${marks}${shape.suffix}`, end });
    for (let k = 0; k < shape.extenders; k++) {
      end += JIANPU_PPQ;
      tokens.push({ text: '-', end });
    }
    t = start + ticks;
  }
  if (errors.length > 0) return { ok: false, errors };

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
  };
}
