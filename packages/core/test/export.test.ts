import { describe, expect, it } from 'vitest';
import {
  collectionKeySignature,
  decodeMidiText,
  exportFileName,
  exportMidi,
  importMidi,
  parseJianpu,
  type MidiMetadata,
  type ParsedMidi,
} from '../src/index.js';
import { notesOf } from './helpers.js';

import tonejsMidi from '@tonejs/midi';
const { Midi } = tonejsMidi;

const META: MidiMetadata = {
  ppq: 480,
  tempoMap: [{ tick: 0, bpm: 120 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
};

const reimport = (bytes: Uint8Array): ParsedMidi => {
  const r = importMidi(bytes);
  if (!r.ok) throw new Error(r.error.code);
  return r.midi;
};

const exported = (...args: Parameters<typeof exportMidi>) => {
  const r = exportMidi(...args);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe('exportMidi', () => {
  it('writes a format 1 file with one melody track, channel and program', () => {
    const notes = notesOf([
      [62, 0, 1],
      [64, 1, 0.5],
    ]);
    const r = exported(notes, { ...META, channel: 3, instrumentProgram: 73, trackName: '笛子' });
    const m = reimport(r.bytes);
    expect(m.format).toBe(1);
    expect(m.warnings).toEqual([]);
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0]).toEqual(
      expect.objectContaining({ channel: 3, instrumentProgram: 73, name: '笛子', noteCount: 2 }),
    );
    expect(r.report.warnings).toEqual([]);
    expect(r.report.keySignature).toEqual({ policy: 'source', written: [] });
  });

  it('does not mutate its input', () => {
    const notes = notesOf([[60, 0, 1]]);
    const before = structuredClone(notes);
    exported(notes, META);
    expect(notes).toEqual(before);
  });

  it('keeps tempos that are not whole microseconds exact to the microsecond, and says so', () => {
    const r = exported(notesOf([[60, 0, 1]]), {
      ...META,
      tempoMap: [
        { tick: 0, bpm: 70 },
        { tick: 960, bpm: 60_000_000 / 666_667 },
      ],
    });
    const tempos = reimport(r.bytes).metadata.tempoMap;
    expect(tempos.map((t) => Math.round(60_000_000 / t.bpm))).toEqual([857_143, 666_667]);
    expect(tempos[1]!.bpm).toBe(60_000_000 / 666_667);
    expect(r.report.warnings.map((w) => w.code)).toEqual(['TEMPO_ROUNDED']);
  });

  it('writes 7-bit velocities exactly and reports quantization and zero velocity', () => {
    const notes = notesOf([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 1],
    ]);
    notes[0]!.velocity = 100 / 127;
    notes[1]!.velocity = 0.5;
    notes[2]!.velocity = 0;
    const r = exported(notes, META);
    const vs = reimport(r.bytes).tracks[0]!.notes.map((n) => Math.round(n.velocity * 127));
    expect(vs).toEqual([100, 64, 1]);
    expect(reimport(r.bytes).tracks[0]!.notes[0]!.velocity).toBe(100 / 127);
    expect(r.report.warnings).toEqual([
      expect.objectContaining({ code: 'VELOCITY_QUANTIZED', noteIds: [notes[1]!.id] }),
      expect.objectContaining({ code: 'VELOCITY_ZERO_RAISED', noteIds: [notes[2]!.id] }),
    ]);
  });

  it('reports source data it cannot carry', () => {
    const r = exported(notesOf([[60, 0, 1]]), META, {
      source: { hasPitchBend: true, hasSustainPedal: true, droppedTracks: 2 },
    });
    expect(r.report.warnings.map((w) => w.code)).toEqual([
      'PITCH_BEND_DROPPED',
      'SUSTAIN_PEDAL_DROPPED',
      'TRACKS_DROPPED',
    ]);
  });

  it('rejects data that cannot be encoded, with structured errors', () => {
    const bad = notesOf([
      [128, 0, 1],
      [60, 1.5, 0],
    ]);
    bad[1]!.startTick = 1.5;
    const r = exportMidi(bad, {
      ppq: 0,
      tempoMap: [{ tick: 0, bpm: Number.NaN }],
      timeSignatures: [{ tick: 0, numerator: 3, denominator: 3 }],
      channel: 16,
      instrumentProgram: 128,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual([
      'INVALID_PPQ',
      'INVALID_TEMPO',
      'INVALID_TIME_SIGNATURE',
      'INVALID_CHANNEL',
      'INVALID_PROGRAM',
      'INVALID_NOTE',
      'INVALID_NOTE',
    ]);
  });

  describe('key signature (spec §11.1)', () => {
    it('keeps source key signatures by default and drops unencodable ones with a warning', () => {
      const r = exported(notesOf([[60, 0, 1]]), {
        ...META,
        keySignatures: [
          { tick: 0, key: 'Bb', scale: 'major' },
          { tick: 480, key: 'A#', scale: 'major' },
        ],
      });
      expect(reimport(r.bytes).metadata.keySignatures).toEqual([
        { tick: 0, key: 'Bb', scale: 'major' },
      ]);
      expect(r.report.warnings.map((w) => w.code)).toEqual(['KEY_SIGNATURE_DROPPED']);
    });

    it('writes all 15 key signatures, major and minor, despite the @tonejs/midi encoder bug', () => {
      const keys = [
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
      const keySignatures = keys.flatMap((key, i) =>
        (['major', 'minor'] as const).map((scale, k) => ({ tick: (2 * i + k) * 480, key, scale })),
      );
      const r = exported(notesOf([[60, 0, 1]]), { ...META, keySignatures });
      expect(reimport(r.bytes).metadata.keySignatures).toEqual(keySignatures);
    });

    it('omits key signatures on request', () => {
      const r = exported(
        notesOf([[60, 0, 1]]),
        { ...META, keySignatures: [{ tick: 0, key: 'D', scale: 'major' }] },
        { keySignature: { kind: 'omit' } },
      );
      expect(reimport(r.bytes).metadata.keySignatures).toEqual([]);
    });

    it.each([
      [2, 'dorian', 'C'], // D Dorian → C major, no accidentals
      [7, 'pentatonic-zhi', 'C'], // G 徵 (C 宫) → C
      [2, 'pentatonic-zhi', 'G'], // D 徵 (G 宫) → one sharp
      [9, 'aeolian', 'C'],
      [0, 'yayue-gong', 'G'], // C 宫雅乐 has F#
      [0, 'yanyue-gong', 'F'], // C 宫燕乐 has Bb
      [0, 'hexa-biangong-gong', 'C'],
      [6, 'ionian', 'F#'],
      [1, 'ionian', 'Db'],
    ])('root %i %s → %s major', (root, scaleId, key) => {
      expect(collectionKeySignature(root, scaleId).key).toBe(key);
    });

    it('writes the collection key signature and the actual mode as a text event', () => {
      const r = exported(
        notesOf([[62, 0, 1]]),
        { ...META, keySignatures: [{ tick: 0, key: 'F', scale: 'major' }] },
        { keySignature: { kind: 'mode', rootPitchClass: 2, scaleId: 'pentatonic-zhi' } },
      );
      expect(reimport(r.bytes).metadata.keySignatures).toEqual([
        { tick: 0, key: 'G', scale: 'major' },
      ]);
      const text = new Midi(r.bytes).header.meta.map((e) => [e.type, decodeMidiText(e.text)]);
      expect(text).toEqual([['text', 'ReMode mode: D 徵调式（G 宫系统，五声） [pentatonic-zhi]']]);
      expect(r.report.keySignature.mode?.name).toBe('D 徵调式（G 宫系统，五声）');
      expect(r.report.warnings.map((w) => w.code)).toEqual(['SOURCE_KEY_SIGNATURES_REPLACED']);
    });

    it('rejects an unknown scale', () => {
      const r = exportMidi(notesOf([[60, 0, 1]]), META, {
        keySignature: { kind: 'mode', rootPitchClass: 0, scaleId: 'bogus' },
      });
      expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['UNKNOWN_SCALE']);
    });
  });

  it('round-trips a jianpu melody in a sharp key through the source key signature', () => {
    const j = parseJianpu('1=F# 3/4 | 5, 1 2 | 3 - 0 |');
    if (!j.ok) throw new Error('parse');
    const m = reimport(exported(j.notes, j.metadata).bytes);
    expect(m.metadata.keySignatures).toEqual([{ tick: 0, key: 'F#', scale: 'major' }]);
  });
});

describe('exportFileName', () => {
  it.each([
    [
      { source: 'song.mid', rootPitchClass: 2, scaleId: 'dorian', variant: 'strict' },
      'song-D-dorian-strict.mid',
    ],
    [
      { source: 'Tune.MIDI', rootPitchClass: 6, scaleId: 'pentatonic-zhi', variant: 'expressive' },
      'Tune-Fsharp-pentatonic-zhi-expressive.mid',
    ],
    [{ source: '茉莉花.jianpu', variant: 'original' }, '茉莉花-original.mid'],
    [{ source: '../../etc/passwd', variant: 'original' }, 'etc-passwd-original.mid'],
    [{ source: 'a<b>:c"d|e?*f\u0000g', variant: 'custom' }, 'a-b-c-d-e-f-g-custom.mid'],
    [{ source: '   ' }, 'melody.mid'],
    [{ source: 'CON' }, '_CON.mid'],
    [{ source: 'x'.repeat(200), variant: 'strict' }, `${'x'.repeat(60)}-strict.mid`],
  ])('%j → %s', (parts, name) => {
    expect(exportFileName(parts)).toBe(name);
  });
});
