// MIDI export (spec §11) on top of @tonejs/midi. One melody track from
// MelodyNote[] + MidiMetadata: PPQ, tempo map, time signatures, channel and
// program are written as given and ticks are never re-derived from seconds.
// Anything that cannot be written exactly is reported as a structured warning.

import tonejsMidi from '@tonejs/midi';
const { Midi } = tonejsMidi;

import type { KeySignatureEvent, MelodyNote, MidiMetadata, VariantId } from '../types.js';
import { isValidMidiPitch, mod, pitchClassName } from '../theory/pitch.js';
import { getScale, gongPitchClassOf, modeName, scalePitchClasses } from '../theory/scales.js';
import { encodeMidiText } from './text.js';

/**
 * Key-signature policy (spec §11.1):
 * - `source` (default): keep the source key signatures;
 * - `omit`: write none;
 * - `mode`: write the key signature of the mode's collection, and record the
 *   actual mode in a text meta event at tick 0.
 */
export type KeySignaturePolicy =
  { kind: 'source' } | { kind: 'omit' } | { kind: 'mode'; rootPitchClass: number; scaleId: string };

export interface ExportOptions {
  keySignature?: KeySignaturePolicy;
  /**
   * Facts about the source that the canonical model does not carry, so their
   * loss can be reported (e.g. from `ImportedTrack`).
   */
  source?: { hasPitchBend?: boolean; hasSustainPedal?: boolean; droppedTracks?: number };
}

export type ExportErrorCode =
  | 'INVALID_PPQ'
  | 'INVALID_TEMPO'
  | 'INVALID_TIME_SIGNATURE'
  | 'INVALID_KEY_SIGNATURE'
  | 'INVALID_CHANNEL'
  | 'INVALID_PROGRAM'
  | 'INVALID_NOTE'
  | 'UNKNOWN_SCALE';

export type ExportWarningCode =
  | 'VELOCITY_QUANTIZED'
  | 'VELOCITY_ZERO_RAISED'
  | 'TEMPO_ROUNDED'
  | 'KEY_SIGNATURE_DROPPED'
  | 'SOURCE_KEY_SIGNATURES_REPLACED'
  | 'PITCH_BEND_DROPPED'
  | 'SUSTAIN_PEDAL_DROPPED'
  | 'TRACKS_DROPPED';

export interface ExportIssue<C extends string> {
  code: C;
  message: string;
  noteIds?: string[];
  tick?: number;
}

export type ExportError = ExportIssue<ExportErrorCode>;
export type ExportWarning = ExportIssue<ExportWarningCode>;

export interface ExportReport {
  noteCount: number;
  ppq: number;
  keySignature: {
    policy: KeySignaturePolicy['kind'];
    written: KeySignatureEvent[];
    /** `mode` policy: the actual mode, also written as a text meta event. */
    mode?: { rootPitchClass: number; scaleId: string; name: string; text: string };
  };
  warnings: ExportWarning[];
}

export type ExportResult =
  { ok: true; bytes: Uint8Array; report: ExportReport } | { ok: false; errors: ExportError[] };

/** Major-key names a MIDI key-signature event can carry (-7..+7 accidentals). */
const KEY_NAMES = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * Key signature for a mode (spec §11.1): the 7-note collection it belongs to,
 * written as that collection's major key. Five- and six-note Chinese scales use
 * their 宫 system (D 徵调式, G 宫 → G major, one sharp); seven-note scales use
 * the collection they actually span (C 宫雅乐 contains F# → G major).
 */
export function collectionKeySignature(
  rootPitchClass: number,
  scaleId: string,
): { key: string; scale: 'major'; ionianPitchClass: number } {
  const scale = getScale(scaleId);
  let ionian: number | null = null;
  if (scale.chinese && scale.family !== 'diatonic') {
    ionian = gongPitchClassOf(scale, rootPitchClass);
  } else {
    const pcs = scalePitchClasses(scale, rootPitchClass);
    for (let t = 0; t < 12 && ionian === null; t++) {
      if (pcs.every((pc) => MAJOR.includes(mod(pc - t, 12)))) ionian = t;
    }
  }
  if (ionian === null) throw new Error(`${scaleId} does not fit a diatonic collection`);
  return { key: pitchClassName(ionian), scale: 'major', ionianPitchClass: ionian };
}

const isTick = (n: number) => Number.isInteger(n) && n >= 0;

function validate(notes: readonly MelodyNote[], meta: MidiMetadata): ExportError[] {
  const errors: ExportError[] = [];
  if (!Number.isInteger(meta.ppq) || meta.ppq < 1 || meta.ppq > 0x7fff) {
    errors.push({ code: 'INVALID_PPQ', message: `PPQ ${meta.ppq} is not an integer in 1..32767.` });
  }
  for (const t of meta.tempoMap) {
    if (!isTick(t.tick) || !Number.isFinite(t.bpm) || t.bpm <= 0 || 60_000_000 / t.bpm > 0xffffff) {
      errors.push({
        code: 'INVALID_TEMPO',
        message: `Tempo ${t.bpm} BPM at tick ${t.tick} cannot be written.`,
        tick: t.tick,
      });
    }
  }
  for (const s of meta.timeSignatures) {
    const ok =
      isTick(s.tick) &&
      Number.isInteger(s.numerator) &&
      s.numerator >= 1 &&
      s.numerator <= 255 &&
      Number.isInteger(s.denominator) &&
      s.denominator >= 1 &&
      s.denominator <= 128 &&
      (s.denominator & (s.denominator - 1)) === 0;
    if (!ok) {
      errors.push({
        code: 'INVALID_TIME_SIGNATURE',
        message: `Time signature ${s.numerator}/${s.denominator} at tick ${s.tick} cannot be written.`,
        tick: s.tick,
      });
    }
  }
  const channel = meta.channel ?? 0;
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
    errors.push({ code: 'INVALID_CHANNEL', message: `Channel ${channel} is not in 0..15.` });
  }
  const program = meta.instrumentProgram ?? 0;
  if (!Number.isInteger(program) || program < 0 || program > 127) {
    errors.push({ code: 'INVALID_PROGRAM', message: `Program ${program} is not in 0..127.` });
  }
  for (const n of notes) {
    const problems = [
      !isValidMidiPitch(n.pitch) && `pitch ${n.pitch}`,
      !isTick(n.startTick) && `startTick ${n.startTick}`,
      !(Number.isInteger(n.durationTick) && n.durationTick > 0) && `durationTick ${n.durationTick}`,
      !(Number.isFinite(n.velocity) && n.velocity >= 0 && n.velocity <= 1) &&
        `velocity ${n.velocity}`,
    ].filter(Boolean);
    if (problems.length > 0) {
      errors.push({
        code: 'INVALID_NOTE',
        message: `Note ${n.id} has invalid ${problems.join(', ')}.`,
        noteIds: [n.id],
        tick: n.startTick,
      });
    }
  }
  return errors;
}

/**
 * Encode one melody as a format 1 Standard MIDI File: a conductor track (tempo,
 * time and key signatures, optional mode text) and one note track. Re-importing
 * the bytes yields the same pitches, ticks, durations, 7-bit velocities, PPQ,
 * tempo map (to the microsecond) and time signatures.
 */
export function exportMidi(
  notes: readonly MelodyNote[],
  meta: MidiMetadata,
  options: ExportOptions = {},
): ExportResult {
  const errors = validate(notes, meta);
  const policy = options.keySignature ?? { kind: 'source' };
  let modeInfo: ExportReport['keySignature']['mode'];
  let written: KeySignatureEvent[] = [];
  const warnings: ExportWarning[] = [];

  if (policy.kind === 'mode') {
    try {
      const ks = collectionKeySignature(policy.rootPitchClass, policy.scaleId);
      written = [{ tick: 0, key: ks.key, scale: 'major' }];
      const name = modeName(policy.rootPitchClass, policy.scaleId);
      modeInfo = {
        rootPitchClass: mod(policy.rootPitchClass, 12),
        scaleId: policy.scaleId,
        name,
        text: `ReMode mode: ${name} [${policy.scaleId}]`,
      };
    } catch (e) {
      errors.push({ code: 'UNKNOWN_SCALE', message: (e as Error).message });
    }
    if ((meta.keySignatures ?? []).length > 0) {
      warnings.push({
        code: 'SOURCE_KEY_SIGNATURES_REPLACED',
        message: `${meta.keySignatures?.length} source key signature(s) replaced by the target collection's.`,
      });
    }
  } else if (policy.kind === 'source') {
    for (const k of meta.keySignatures ?? []) {
      if (!isTick(k.tick)) {
        errors.push({
          code: 'INVALID_KEY_SIGNATURE',
          message: `Key signature at tick ${k.tick} cannot be written.`,
          tick: k.tick,
        });
      } else if (!KEY_NAMES.includes(k.key) || (k.scale !== 'major' && k.scale !== 'minor')) {
        warnings.push({
          code: 'KEY_SIGNATURE_DROPPED',
          message: `Key signature "${k.key} ${k.scale}" at tick ${k.tick} has no MIDI encoding; omitted.`,
          tick: k.tick,
        });
      } else {
        written.push({ tick: k.tick, key: k.key, scale: k.scale });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // midi-file writes floor(60e6 / bpm) µs per quarter; aim for the nearest
  // integer so a tempo read from MIDI comes back unchanged.
  const tempos = meta.tempoMap.map((t) => {
    const us = Math.round(60_000_000 / t.bpm);
    if (Math.abs(60_000_000 / t.bpm - us) > 1e-6) {
      warnings.push({
        code: 'TEMPO_ROUNDED',
        message: `${t.bpm} BPM at tick ${t.tick} is stored as ${us} µs per quarter (${60_000_000 / us} BPM).`,
        tick: t.tick,
      });
    }
    return { ticks: t.tick, bpm: 60_000_000 / (us + 0.5) };
  });

  // Same idea for velocity: floor(v × 127) must land on the intended 7-bit value.
  const quantized: string[] = [];
  const raised: string[] = [];
  const sorted = [...notes].sort(
    (a, b) => a.startTick - b.startTick || a.pitch - b.pitch || (a.id < b.id ? -1 : 1),
  );
  const encoded = sorted.map((n) => {
    let v = Math.round(n.velocity * 127);
    if (Math.abs(n.velocity * 127 - v) > 1e-6) quantized.push(n.id);
    if (v === 0) {
      v = 1; // a note-on with velocity 0 is a note-off
      raised.push(n.id);
    }
    return {
      midi: n.pitch,
      ticks: n.startTick,
      durationTicks: n.durationTick,
      velocity: (v + 0.5) / 127,
      noteOffVelocity: 0,
    };
  });
  if (quantized.length > 0) {
    warnings.push({
      code: 'VELOCITY_QUANTIZED',
      message: `${quantized.length} velocities rounded to the nearest of 127 MIDI steps.`,
      noteIds: quantized,
    });
  }
  if (raised.length > 0) {
    warnings.push({
      code: 'VELOCITY_ZERO_RAISED',
      message: `${raised.length} notes with velocity 0 written with velocity 1/127.`,
      noteIds: raised,
    });
  }
  if (options.source?.hasPitchBend) {
    warnings.push({ code: 'PITCH_BEND_DROPPED', message: 'Pitch bend events are not exported.' });
  }
  if (options.source?.hasSustainPedal) {
    warnings.push({
      code: 'SUSTAIN_PEDAL_DROPPED',
      message: 'Sustain pedal (CC64) events are not exported.',
    });
  }
  if (options.source?.droppedTracks) {
    warnings.push({
      code: 'TRACKS_DROPPED',
      message: `${options.source.droppedTracks} other source track(s) are not exported.`,
    });
  }

  const midi = new Midi();
  midi.header.fromJSON({
    name: '',
    ppq: meta.ppq,
    tempos,
    timeSignatures: meta.timeSignatures.map((s) => ({
      ticks: s.tick,
      timeSignature: [s.numerator, s.denominator],
    })),
    keySignatures: written.map((k) => ({ ticks: k.tick, key: k.key, scale: k.scale })),
    meta: modeInfo ? [{ ticks: 0, type: 'text', text: encodeMidiText(modeInfo.text) }] : [],
  });
  const track = midi.addTrack();
  track.name = encodeMidiText(meta.trackName ?? '');
  track.channel = meta.channel ?? 0;
  track.instrument.number = meta.instrumentProgram ?? 0;
  for (const n of encoded) track.addNote(n);

  const keySignature: ExportReport['keySignature'] = { policy: policy.kind, written };
  if (modeInfo) keySignature.mode = modeInfo;
  return {
    ok: true,
    bytes: fixKeySignatureBytes(midi.toArray()),
    report: { noteCount: notes.length, ppq: meta.ppq, keySignature, warnings },
  };
}

/**
 * @tonejs/midi 2.0.28 encodes a key signature's sharps/flats count as
 * `index + 7` into its key list instead of `index - 7` (its decoder is right),
 * so every key signature lands 14 steps too high. Correct those bytes in the
 * conductor track, which holds only meta events.
 */
export function fixKeySignatureBytes(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const u32 = (at: number) =>
    (((out[at] as number) << 24) >>> 0) +
    (((out[at + 1] as number) << 16) | ((out[at + 2] as number) << 8) | (out[at + 3] as number));
  const vlq = (at: number): [number, number] => {
    let value = 0;
    let b: number;
    do {
      b = out[at++] as number;
      value = (value << 7) | (b & 0x7f);
    } while (b & 0x80);
    return [value, at];
  };
  let at = 8 + u32(4); // skip MThd
  const end = at + 8 + u32(at + 4);
  at += 8;
  while (at < end) {
    at = vlq(at)[1];
    if (out[at] !== 0xff) throw new Error('Unexpected non-meta event in the conductor track');
    const type = out[at + 1] as number;
    const [length, dataAt] = vlq(at + 2);
    if (type === 0x59 && length === 2) {
      const written = ((out[dataAt] as number) << 24) >> 24; // as int8
      out[dataAt] = (written - 14) & 0xff;
    }
    at = dataAt + length;
  }
  return out;
}

// --- File name (spec §11.1: <source>-<root>-<mode>-<variant>.mid) -------------

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function sanitizePart(part: string, maxLength = 60): string {
  return part
    .normalize('NFC')
    .replace(/#/g, 'sharp')
    .replace(/[^\p{L}\p{N}._]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength)
    .replace(/[-.]+$/g, '');
}

/**
 * `<source>-<root>-<mode>-<variant>.mid` with every part reduced to letters,
 * digits, `.`, `_` and `-` (`#` becomes `sharp`). Parts that are missing or
 * sanitize to nothing are left out; the source falls back to "melody".
 */
export function exportFileName(parts: {
  source?: string;
  rootPitchClass?: number;
  scaleId?: string;
  variant?: VariantId | string;
}): string {
  const source = sanitizePart((parts.source ?? '').replace(/\.(mid|midi|txt|jianpu)$/i, ''));
  const root =
    parts.rootPitchClass === undefined ? '' : sanitizePart(pitchClassName(parts.rootPitchClass));
  const rest = [root, sanitizePart(parts.scaleId ?? ''), sanitizePart(parts.variant ?? '')];
  let base = [source || 'melody', ...rest].filter(Boolean).join('-');
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  return `${base}.mid`;
}
