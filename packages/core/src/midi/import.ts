// MIDI import (spec §5.1) on top of @tonejs/midi. Bytes in, plain data out:
// no File/Blob/DOM APIs, so the same code runs in Node, the browser and a Worker.

// @tonejs/midi ships CommonJS/UMD only: Node's ESM loader cannot see its named
// exports, so take the namespace object as the default import.
import tonejsMidi from '@tonejs/midi';
const { Midi } = tonejsMidi;

import type {
  KeySignatureEvent,
  MelodyNote,
  MidiMetadata,
  TempoEvent,
  TimeSignatureEvent,
} from '../types.js';

export interface ImportLimits {
  maxFileBytes: number;
  maxNotes: number;
}

/** Initial limits; to be tuned after performance testing (spec §5.1). */
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 4 * 1024 * 1024,
  maxNotes: 20_000,
};

export type ImportErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_MIDI'
  | 'INVALID_HEADER'
  | 'TRUNCATED'
  | 'NO_TRACKS'
  | 'UNSUPPORTED_FORMAT'
  | 'SMPTE_TIMING'
  | 'TOO_MANY_NOTES'
  | 'PARSE_FAILED';

export interface ImportError {
  code: ImportErrorCode;
  message: string;
}

export type ImportWarningCode =
  | 'DEFAULT_TEMPO'
  | 'DEFAULT_TIME_SIGNATURE'
  | 'INVALID_TIME_SIGNATURE'
  | 'TRACK_COUNT_MISMATCH'
  | 'TRAILING_BYTES'
  | 'TYPE0_SPLIT_BY_CHANNEL';

export interface ImportWarning {
  code: ImportWarningCode;
  message: string;
}

export interface ImportedTrack {
  /** Stable ID within this parse, e.g. "track-1". */
  id: string;
  /** Index into the parsed track list (see README: tracks are split by channel/program). */
  index: number;
  name: string;
  /** 0-based MIDI channel; 9 is General MIDI percussion ("channel 10"). */
  channel: number;
  instrumentProgram: number;
  isPercussion: boolean;
  /** Sorted by (startTick, pitch); IDs are "<trackId>:n<k>". Not yet validated. */
  notes: MelodyNote[];
  noteCount: number;
  pitchRange: { min: number; max: number } | null;
  hasPitchBend: boolean;
  hasSustainPedal: boolean;
}

export interface ParsedMidi {
  format: 0 | 1;
  /** Track count declared in MThd. */
  declaredTrackCount: number;
  metadata: MidiMetadata;
  tracks: ImportedTrack[];
  warnings: ImportWarning[];
}

export type ImportResult = { ok: true; midi: ParsedMidi } | { ok: false; error: ImportError };

const fail = (code: ImportErrorCode, message: string): ImportResult => ({
  ok: false,
  error: { code, message },
});

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const u16 = (b: Uint8Array, at: number) => ((b[at] as number) << 8) | (b[at + 1] as number);
const u32 = (b: Uint8Array, at: number) =>
  (((b[at] as number) << 24) >>> 0) +
  (((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number));

interface Precheck {
  format: number;
  declaredTrackCount: number;
  trackChunks: number;
  trailingBytes: number;
}

/** Structural check of the SMF chunk layout before handing bytes to the parser. */
function precheck(bytes: Uint8Array, limits: ImportLimits): Precheck | ImportError {
  if (bytes.length === 0) return { code: 'EMPTY_FILE', message: 'File is empty.' };
  if (bytes.length > limits.maxFileBytes) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `File is ${bytes.length} bytes; the limit is ${limits.maxFileBytes}.`,
    };
  }
  if (bytes.length < 14 || ascii(bytes, 0) !== 'MThd') {
    return { code: 'NOT_MIDI', message: 'Missing "MThd" header: not a Standard MIDI File.' };
  }
  const headerLength = u32(bytes, 4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) {
    return { code: 'INVALID_HEADER', message: `Invalid MThd length ${headerLength}.` };
  }
  const format = u16(bytes, 8);
  const declaredTrackCount = u16(bytes, 10);
  const division = u16(bytes, 12);
  if (format === 2) {
    return {
      code: 'UNSUPPORTED_FORMAT',
      message: 'MIDI format 2 (independent sequences) is not supported.',
    };
  }
  if (format > 2) return { code: 'INVALID_HEADER', message: `Unknown MIDI format ${format}.` };
  if (division & 0x8000) {
    return {
      code: 'SMPTE_TIMING',
      message: 'SMPTE time division is not supported; only ticks-per-quarter-note files are.',
    };
  }
  if (division === 0) return { code: 'INVALID_HEADER', message: 'Division (PPQ) is 0.' };

  let at = 8 + headerLength;
  let trackChunks = 0;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at);
    const length = u32(bytes, at + 4);
    if (at + 8 + length > bytes.length) {
      return {
        code: 'TRUNCATED',
        message: `Chunk "${id}" at byte ${at} declares ${length} bytes but the file ends first.`,
      };
    }
    if (id === 'MTrk') trackChunks++;
    at += 8 + length;
  }
  if (trackChunks === 0) return { code: 'NO_TRACKS', message: 'File contains no MTrk chunks.' };
  return { format, declaredTrackCount, trackChunks, trailingBytes: bytes.length - at };
}

const isError = (x: Precheck | ImportError): x is ImportError => 'code' in x;

/**
 * Parse a Standard MIDI File. @tonejs/midi splits every source track by
 * (channel, program) and drops a note-less first track in format 1 files
 * (the conductor track), so a Type 0 file with several channels yields one
 * track per channel.
 */
export function importMidi(
  bytes: Uint8Array,
  options: { sourceFileName?: string; limits?: Partial<ImportLimits> } = {},
): ImportResult {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...options.limits };
  const pre = precheck(bytes, limits);
  if (isError(pre)) return { ok: false, error: pre };

  let midi: InstanceType<typeof Midi>;
  try {
    midi = new Midi(bytes);
  } catch (e) {
    return fail('PARSE_FAILED', `MIDI parser rejected the file: ${(e as Error).message}`);
  }

  const warnings: ImportWarning[] = [];
  if (pre.declaredTrackCount !== pre.trackChunks) {
    warnings.push({
      code: 'TRACK_COUNT_MISMATCH',
      message: `Header declares ${pre.declaredTrackCount} tracks; file contains ${pre.trackChunks}.`,
    });
  }
  if (pre.trailingBytes > 0) {
    warnings.push({
      code: 'TRAILING_BYTES',
      message: `${pre.trailingBytes} bytes after the last chunk were ignored.`,
    });
  }

  const ppq = midi.header.ppq;
  const tempoMap = dedupe(
    midi.header.tempos.map((t): TempoEvent => ({ tick: t.ticks, bpm: t.bpm })),
    (t) => `${t.tick}`,
  ).filter((t) => Number.isFinite(t.bpm) && t.bpm > 0);
  if (tempoMap.length === 0 || (tempoMap[0] as TempoEvent).tick > 0) {
    tempoMap.unshift({ tick: 0, bpm: 120 });
    warnings.push({
      code: 'DEFAULT_TEMPO',
      message: 'No tempo at tick 0; assuming 120 BPM (the MIDI default).',
    });
  }

  const rawSignatures = midi.header.timeSignatures.map((t): TimeSignatureEvent => ({
    tick: t.ticks,
    numerator: t.timeSignature[0] as number,
    denominator: t.timeSignature[1] as number,
  }));
  const timeSignatures = dedupe(
    rawSignatures.filter((t) => {
      const valid =
        Number.isInteger(t.numerator) &&
        t.numerator > 0 &&
        Number.isInteger(t.denominator) &&
        t.denominator > 0 &&
        (t.denominator & (t.denominator - 1)) === 0;
      if (!valid) {
        warnings.push({
          code: 'INVALID_TIME_SIGNATURE',
          message: `Ignored invalid time signature ${t.numerator}/${t.denominator} at tick ${t.tick}.`,
        });
      }
      return valid;
    }),
    (t) => `${t.tick}`,
  );
  if (timeSignatures.length === 0 || (timeSignatures[0] as TimeSignatureEvent).tick > 0) {
    timeSignatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
    warnings.push({
      code: 'DEFAULT_TIME_SIGNATURE',
      message: 'No time signature at tick 0; assuming 4/4 (the MIDI default).',
    });
  }
  const keySignatures = midi.header.keySignatures.map((k): KeySignatureEvent => ({
    tick: k.ticks,
    key: k.key,
    scale: k.scale as 'major' | 'minor',
  }));

  const tracks = midi.tracks.map((t, index): ImportedTrack => {
    const id = `track-${index}`;
    const notes = t.notes
      .map((n) => ({
        pitch: n.midi,
        startTick: n.ticks,
        durationTick: n.durationTicks,
        velocity: n.velocity,
      }))
      .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
      .map((n, k): MelodyNote => ({ id: `${id}:n${k}`, ...n }));
    const pitches = notes.map((n) => n.pitch);
    return {
      id,
      index,
      name: t.name,
      channel: t.channel,
      instrumentProgram: t.instrument.number,
      isPercussion: notes.length > 0 && t.channel === 9,
      notes,
      noteCount: notes.length,
      pitchRange: notes.length ? { min: Math.min(...pitches), max: Math.max(...pitches) } : null,
      hasPitchBend: t.pitchBends.length > 0,
      hasSustainPedal: (t.controlChanges[64]?.length ?? 0) > 0,
    };
  });

  const totalNotes = tracks.reduce((s, t) => s + t.noteCount, 0);
  if (totalNotes > limits.maxNotes) {
    return fail('TOO_MANY_NOTES', `File has ${totalNotes} notes; the limit is ${limits.maxNotes}.`);
  }
  if (pre.format === 0 && tracks.filter((t) => t.noteCount > 0).length > 1) {
    warnings.push({
      code: 'TYPE0_SPLIT_BY_CHANNEL',
      message: 'Type 0 file with several channels/programs: each is listed as its own track.',
    });
  }

  const metadata: MidiMetadata = { ppq, tempoMap, timeSignatures, keySignatures };
  if (options.sourceFileName !== undefined) metadata.sourceFileName = options.sourceFileName;
  return {
    ok: true,
    midi: {
      format: pre.format as 0 | 1,
      declaredTrackCount: pre.declaredTrackCount,
      metadata,
      tracks,
      warnings,
    },
  };
}

function dedupe<T extends { tick: number }>(events: T[], key: (e: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const e of [...events].sort((a, b) => a.tick - b.tick)) {
    seen.set(key(e), e); // last event at a tick wins, as in MIDI playback
  }
  return [...seen.values()];
}

/** Tracks worth offering as melodies: non-empty and not percussion. */
export const melodyCandidates = (midi: ParsedMidi): ImportedTrack[] =>
  midi.tracks.filter((t) => t.noteCount > 0 && !t.isPercussion);

/** Metadata for one selected track. */
export function trackMetadata(midi: ParsedMidi, track: ImportedTrack): MidiMetadata {
  const meta: MidiMetadata = {
    ...midi.metadata,
    channel: track.channel,
    instrumentProgram: track.instrumentProgram,
  };
  if (track.name) meta.trackName = track.name;
  return meta;
}
