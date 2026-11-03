// Jianpu (numbered notation) text parser, spec §10.8. Pure function from text to
// MelodyNote[] + MidiMetadata; no I/O. The accepted subset is closed: anything
// outside it is a structured error with line and column, never a guess.
//
// Conventions (recorded in docs/decisions/m1a-implementation-notes.md):
// - `1` without octave marks is the key note in scientific octave 4 (1=C → C4 = 60,
//   1=G → G4 = 67, 1=Bb → Bb4 = 70, 1=Cb → Cb4 = 59).
// - A bare digit is a quarter note (one beat = PPQ ticks) whatever the time
//   signature; `_` halves it, `__` quarters it, `.` adds half, `-` adds one beat.
// - PPQ is fixed at 480; every supported duration is a whole number of ticks.

import type {
  KeySignatureEvent,
  MelodyNote,
  MidiMetadata,
  TempoEvent,
  TimeSignatureEvent,
} from '../types.js';
import { mod, pitchClassName } from '../theory/pitch.js';

/** Bump whenever the accepted syntax or its meaning changes (spec §10.8). */
export const JIANPU_PARSER_VERSION = 'remode-jianpu/1.0.0';

export const JIANPU_PPQ = 480;
export const JIANPU_DEFAULT_BPM = 120;
/** 96/127: a 7-bit MIDI velocity, so export → re-import keeps it exactly. */
export const JIANPU_VELOCITY = 96 / 127;
/** Scientific octave of an unmarked `1` (MIDI 60 = C4). */
export const JIANPU_REFERENCE_OCTAVE = 4;

export interface JianpuLimits {
  maxChars: number;
  maxNotes: number;
}

export const DEFAULT_JIANPU_LIMITS: JianpuLimits = { maxChars: 100_000, maxNotes: 20_000 };

export type JianpuErrorCode =
  | 'TEXT_TOO_LONG'
  | 'TOO_MANY_NOTES'
  | 'INVALID_KEY'
  | 'INVALID_TIME_SIGNATURE'
  | 'INVALID_TEMPO'
  | 'DUPLICATE_HEADER'
  | 'HEADER_AFTER_NOTES'
  | 'INVALID_DEGREE'
  | 'INVALID_REST_MODIFIER'
  | 'MIXED_OCTAVE_MARKS'
  | 'UNSUPPORTED_DURATION'
  | 'UNSUPPORTED_ACCIDENTAL'
  | 'DANGLING_ACCIDENTAL'
  | 'DANGLING_EXTENDER'
  | 'PITCH_OUT_OF_RANGE'
  | 'UNSUPPORTED_TUPLET'
  | 'UNSUPPORTED_ORNAMENT'
  | 'UNSUPPORTED_REPEAT'
  | 'UNEXPECTED_CHARACTER'
  | 'NO_NOTES';

export type JianpuWarningCode =
  'DEFAULT_KEY' | 'DEFAULT_TIME_SIGNATURE' | 'BAR_DURATION_MISMATCH' | 'KEY_SIGNATURE_RESPELLED';

export interface JianpuIssue<C extends string> {
  code: C;
  message: string;
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units. */
  column: number;
}

export type JianpuError = JianpuIssue<JianpuErrorCode>;
export type JianpuWarning = JianpuIssue<JianpuWarningCode> & {
  /** BAR_DURATION_MISMATCH only. */
  bar?: { index: number; ticks: number; expectedTicks: number };
};

export interface JianpuHeader {
  /** As written, e.g. "Bb". */
  key: string;
  /** MIDI pitch of an unmarked `1`. */
  keyPitch: number;
  timeSignature: { numerator: number; denominator: number };
  bpm: number;
}

export interface JianpuMelody {
  parserVersion: string;
  header: JianpuHeader;
  notes: MelodyNote[];
  metadata: MidiMetadata;
  /** Bars delimited by `|` (empty bars dropped), with their written length in ticks. */
  bars: Array<{ index: number; startTick: number; ticks: number }>;
  warnings: JianpuWarning[];
}

export type JianpuResult =
  | ({ ok: true } & JianpuMelody)
  | { ok: false; parserVersion: string; errors: JianpuError[]; warnings: JianpuWarning[] };

export interface ParseJianpuOptions {
  sourceFileName?: string;
  /** Prefix for note IDs: `<prefix>:n<k>` (default "jianpu"). */
  idPrefix?: string;
  limits?: Partial<JianpuLimits>;
}

const LETTER_PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
/** Key names a MIDI key-signature event can carry (major keys, -7..+7 accidentals). */
const KEY_SIGNATURE_NAMES = new Set([
  'Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
]); // prettier-ignore

const SHARP = /[#♯]/;
const FLAT = /[b♭]/;

const UNSUPPORTED: ReadonlyArray<[RegExp, JianpuErrorCode, string]> = [
  [/[()[\]{}]/, 'UNSUPPORTED_TUPLET', 'Tuplets and slurs/ties are not supported.'],
  [/[~^*&@!]/, 'UNSUPPORTED_ORNAMENT', 'Ornaments are not supported.'],
  [/[:%$]/, 'UNSUPPORTED_REPEAT', 'Repeat signs are not supported.'],
];

const beats = (ticks: number) => {
  const n = ticks / JIANPU_PPQ;
  return `${n} beat${n === 1 ? '' : 's'}`;
};

interface Event {
  kind: 'note' | 'rest';
  /** Semitones above the key note (0 for rests). */
  offset: number;
  ticks: number;
  line: number;
  column: number;
}

/**
 * Parse jianpu text such as `1=C 4/4 | 5 3 2 1 | 6. 5_ 3 - |`.
 *
 * Headers (`1=<key>`, `<n>/<d>`, `bpm=<n>` or `♩=<n>`) must come before the
 * first note. `//` starts a comment that runs to the end of the line.
 */
export function parseJianpu(text: string, options: ParseJianpuOptions = {}): JianpuResult {
  const limits = { ...DEFAULT_JIANPU_LIMITS, ...options.limits };
  const errors: JianpuError[] = [];
  const warnings: JianpuWarning[] = [];
  const fail = (): JianpuResult => ({
    ok: false,
    parserVersion: JIANPU_PARSER_VERSION,
    errors,
    warnings,
  });

  if (text.length > limits.maxChars) {
    errors.push({
      code: 'TEXT_TOO_LONG',
      message: `Text is ${text.length} characters; the limit is ${limits.maxChars}.`,
      line: 1,
      column: 1,
    });
    return fail();
  }

  let key: { name: string; pitch: number } | null = null;
  let timeSig: { numerator: number; denominator: number } | null = null;
  let bpm: number | null = null;
  let headersClosed = false;

  const events: Event[] = [];
  /** Written length of each bar: notes, rests and extenders between barlines. */
  const bars: Array<{ ticks: number; line: number; column: number }> = [
    { ticks: 0, line: 1, column: 1 },
  ];
  const currentBar = () => bars[bars.length - 1] as (typeof bars)[number];
  const markBarStart = (line: number, column: number) => {
    const bar = currentBar();
    if (bar.ticks === 0) [bar.line, bar.column] = [line, column];
  };

  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((rawLine, li) => {
    const lineNo = li + 1;
    const commentAt = rawLine.indexOf('//');
    const line = commentAt >= 0 ? rawLine.slice(0, commentAt) : rawLine;
    let i = 0;
    const err = (code: JianpuErrorCode, message: string, at = i) =>
      errors.push({ code, message, line: lineNo, column: at + 1 });

    while (i < line.length) {
      const ch = line[i] as string;
      const rest = line.slice(i);
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // --- Headers ---------------------------------------------------------
      const keyMatch = /^1\s*=\s*([^\s|]*)/.exec(rest);
      if (keyMatch) {
        const spec = keyMatch[1] as string;
        const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(spec);
        if (headersClosed)
          err('HEADER_AFTER_NOTES', 'Key changes after the first note are not supported.');
        else if (key) err('DUPLICATE_HEADER', 'Key is given twice.');
        else if (!m) err('INVALID_KEY', `Invalid key "${spec}"; expected e.g. 1=C, 1=F#, 1=Bb.`);
        else {
          const letter = (m[1] as string).toUpperCase();
          const acc = SHARP.test(m[2] as string) ? 1 : FLAT.test(m[2] as string) ? -1 : 0;
          const name = `${letter}${acc === 1 ? '#' : acc === -1 ? 'b' : ''}`;
          key = {
            name,
            pitch: (LETTER_PC[letter] as number) + acc + (JIANPU_REFERENCE_OCTAVE + 1) * 12,
          };
        }
        i += keyMatch[0].length;
        continue;
      }
      const tempoMatch = /^(?:bpm|BPM|♩)\s*=\s*([^\s|]*)/.exec(rest);
      if (tempoMatch) {
        const value = Number(tempoMatch[1]);
        if (headersClosed)
          err('HEADER_AFTER_NOTES', 'Tempo changes after the first note are not supported.');
        else if (bpm !== null) err('DUPLICATE_HEADER', 'Tempo is given twice.');
        else if (!/^\d+(\.\d+)?$/.test(tempoMatch[1] as string) || value <= 0 || value > 1000)
          err('INVALID_TEMPO', `Invalid tempo "${tempoMatch[1]}"; expected a number in (0, 1000].`);
        else bpm = value;
        i += tempoMatch[0].length;
        continue;
      }
      const tsMatch = /^(\d+)\/(\d+)/.exec(rest);
      if (tsMatch) {
        const numerator = Number(tsMatch[1]);
        const denominator = Number(tsMatch[2]);
        if (headersClosed)
          err(
            'HEADER_AFTER_NOTES',
            'Time signature changes after the first note are not supported.',
          );
        else if (timeSig) err('DUPLICATE_HEADER', 'Time signature is given twice.');
        else if (numerator < 1 || numerator > 64 || ![1, 2, 4, 8, 16, 32].includes(denominator))
          err('INVALID_TIME_SIGNATURE', `Invalid time signature ${tsMatch[0]}.`);
        else timeSig = { numerator, denominator };
        i += tsMatch[0].length;
        continue;
      }

      // --- Barline ---------------------------------------------------------
      if (ch === '|') {
        if (line[i + 1] === ':') {
          err('UNSUPPORTED_REPEAT', 'Repeat signs are not supported.');
          i += 2;
          continue;
        }
        let j = i;
        while (line[j] === '|') j++; // `||` (double barline) counts as one barline
        bars.push({ ticks: 0, line: lineNo, column: i + 1 });
        i = j;
        continue;
      }

      // --- Extender --------------------------------------------------------
      if (ch === '-') {
        headersClosed = true;
        const last = events[events.length - 1];
        if (!last) err('DANGLING_EXTENDER', '"-" must follow a note or rest.');
        else {
          // The beat counts toward the bar the "-" is written in, even when it
          // lengthens a note from an earlier bar.
          markBarStart(lineNo, i + 1);
          last.ticks += JIANPU_PPQ;
          currentBar().ticks += JIANPU_PPQ;
        }
        i++;
        continue;
      }

      // --- Note or rest ----------------------------------------------------
      if (SHARP.test(ch) || FLAT.test(ch) || /\d/.test(ch)) {
        headersClosed = true;
        const start = i;
        let accidental = 0;
        while (SHARP.test(line[i] ?? '') || FLAT.test(line[i] ?? '')) {
          accidental += SHARP.test(line[i] as string) ? 1 : -1;
          i++;
        }
        if (i - start > 1) {
          err('UNSUPPORTED_ACCIDENTAL', 'Double accidentals are not supported.', start);
        }
        const digit = line[i];
        if (digit === undefined || !/\d/.test(digit)) {
          err('DANGLING_ACCIDENTAL', 'An accidental must be followed by a degree 1–7.', start);
          continue;
        }
        i++;
        const degree = Number(digit);
        let up = 0;
        let down = 0;
        let underscores = 0;
        let dots = 0;
        while (i < line.length && /['’,_.]/.test(line[i] as string)) {
          const s = line[i] as string;
          if (s === "'" || s === '’') up++;
          else if (s === ',') down++;
          else if (s === '_') underscores++;
          else dots++;
          i++;
        }
        if (degree > 7) {
          err('INVALID_DEGREE', `"${digit}" is not a degree; use 1–7, or 0 for a rest.`, start);
          continue;
        }
        if (degree === 0 && (accidental !== 0 || up || down)) {
          err('INVALID_REST_MODIFIER', 'A rest (0) takes no accidental or octave mark.', start);
          continue;
        }
        if (up && down) {
          err('MIXED_OCTAVE_MARKS', "Use either ' or , on one note, not both.", start);
          continue;
        }
        if (underscores > 2) {
          err('UNSUPPORTED_DURATION', 'Only _ (eighth) and __ (sixteenth) are supported.', start);
          continue;
        }
        if (dots > 1) {
          err('UNSUPPORTED_DURATION', 'Only a single dot is supported.', start);
          continue;
        }
        const base = JIANPU_PPQ / 2 ** underscores;
        const ticks = dots ? base + base / 2 : base;
        const offset =
          degree === 0 ? 0 : (MAJOR[degree - 1] as number) + accidental + 12 * (up - down);
        markBarStart(lineNo, start + 1);
        currentBar().ticks += ticks;
        events.push({
          kind: degree === 0 ? 'rest' : 'note',
          offset,
          ticks,
          line: lineNo,
          column: start + 1,
        });
        continue;
      }

      // --- Unsupported syntax ----------------------------------------------
      if (rest.startsWith('tr')) {
        err('UNSUPPORTED_ORNAMENT', 'Ornaments (tr) are not supported.');
        i += 2;
        continue;
      }
      const unsupported = UNSUPPORTED.find(([re]) => re.test(ch));
      if (unsupported) {
        err(unsupported[1], unsupported[2]);
        i++;
        continue;
      }
      err('UNEXPECTED_CHARACTER', `Unexpected "${ch}".`);
      i++;
    }
  });

  if (!key) {
    warnings.push({
      code: 'DEFAULT_KEY',
      message: 'No key given; assuming 1=C.',
      line: 1,
      column: 1,
    });
    key = { name: 'C', pitch: (JIANPU_REFERENCE_OCTAVE + 1) * 12 };
  }
  if (!timeSig) {
    warnings.push({
      code: 'DEFAULT_TIME_SIGNATURE',
      message: 'No time signature given; assuming 4/4.',
      line: 1,
      column: 1,
    });
    timeSig = { numerator: 4, denominator: 4 };
  }
  const tempo = bpm ?? JIANPU_DEFAULT_BPM;

  const noteEvents = events.filter((e) => e.kind === 'note');
  for (const e of noteEvents) {
    const pitch = key.pitch + e.offset;
    if (pitch < 0 || pitch > 127) {
      errors.push({
        code: 'PITCH_OUT_OF_RANGE',
        message: `Pitch ${pitch} is outside MIDI 0–127.`,
        line: e.line,
        column: e.column,
      });
    }
  }
  if (noteEvents.length > limits.maxNotes) {
    errors.push({
      code: 'TOO_MANY_NOTES',
      message: `${noteEvents.length} notes; the limit is ${limits.maxNotes}.`,
      line: 1,
      column: 1,
    });
  }
  if (errors.length === 0 && noteEvents.length === 0) {
    errors.push({ code: 'NO_NOTES', message: 'The text contains no notes.', line: 1, column: 1 });
  }
  if (errors.length > 0) return fail();

  // --- Lay out ticks ----------------------------------------------------------
  const startOf: number[] = [];
  let tick = 0;
  for (const e of events) {
    startOf.push(tick);
    tick += e.ticks;
  }
  const notes: MelodyNote[] = [];
  const prefix = options.idPrefix ?? 'jianpu';
  events.forEach((e, k) => {
    if (e.kind !== 'note') return;
    notes.push({
      id: `${prefix}:n${notes.length}`,
      pitch: (key as { pitch: number }).pitch + e.offset,
      startTick: startOf[k] as number,
      durationTick: e.ticks,
      velocity: JIANPU_VELOCITY,
    });
  });

  // --- Bar check: written durations between barlines -------------------------
  const expectedTicks = (timeSig.numerator * 4 * JIANPU_PPQ) / timeSig.denominator;
  const barReport: JianpuMelody['bars'] = [];
  let barStart = 0;
  for (const bar of bars) {
    if (bar.ticks === 0) continue; // leading `|`, trailing `|`, `| |`
    const index = barReport.length + 1;
    barReport.push({ index, startTick: barStart, ticks: bar.ticks });
    barStart += bar.ticks;
    if (bar.ticks !== expectedTicks) {
      warnings.push({
        code: 'BAR_DURATION_MISMATCH',
        message: `Bar ${index} lasts ${beats(bar.ticks)}; ${timeSig.numerator}/${timeSig.denominator} needs ${beats(expectedTicks)}.`,
        line: bar.line,
        column: bar.column,
        bar: { index, ticks: bar.ticks, expectedTicks },
      });
    }
  }

  const keySignatures: KeySignatureEvent[] = [];
  const ksName = KEY_SIGNATURE_NAMES.has(key.name) ? key.name : pitchClassName(mod(key.pitch, 12));
  if (ksName !== key.name) {
    warnings.push({
      code: 'KEY_SIGNATURE_RESPELLED',
      message: `1=${key.name} has no MIDI key signature; written as ${ksName} major.`,
      line: 1,
      column: 1,
    });
  }
  keySignatures.push({ tick: 0, key: ksName, scale: 'major' });

  const tempoMap: TempoEvent[] = [{ tick: 0, bpm: tempo }];
  const timeSignatures: TimeSignatureEvent[] = [{ tick: 0, ...timeSig }];
  const metadata: MidiMetadata = {
    ppq: JIANPU_PPQ,
    tempoMap,
    timeSignatures,
    keySignatures,
    channel: 0,
    instrumentProgram: 0,
  };
  if (options.sourceFileName !== undefined) metadata.sourceFileName = options.sourceFileName;

  return {
    ok: true,
    parserVersion: JIANPU_PARSER_VERSION,
    header: { key: key.name, keyPitch: key.pitch, timeSignature: timeSig, bpm: tempo },
    notes,
    metadata,
    bars: barReport,
    warnings,
  };
}
