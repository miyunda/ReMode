import { describe, expect, it } from 'vitest';
import {
  JIANPU_PPQ,
  JIANPU_VELOCITY,
  parseJianpu,
  type JianpuMelody,
  type JianpuResult,
} from '../src/index.js';

const ok = (text: string): JianpuMelody => {
  const r = parseJianpu(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const errorsOf = (r: JianpuResult) => (r.ok ? [] : r.errors);
const Q = JIANPU_PPQ;

/** [pitch, startTick, durationTick] */
const shape = (m: JianpuMelody) => m.notes.map((n) => [n.pitch, n.startTick, n.durationTick]);

describe('parseJianpu', () => {
  it('parses the spec example (§10.8)', () => {
    const m = ok('1=C 4/4 | 5 3 2 1 | 6. 5_ 3 - |');
    expect(shape(m)).toEqual([
      [67, 0, Q],
      [64, Q, Q],
      [62, 2 * Q, Q],
      [60, 3 * Q, Q],
      [69, 4 * Q, 1.5 * Q],
      [67, 5.5 * Q, 0.5 * Q],
      [64, 6 * Q, 2 * Q],
    ]);
    expect(m.warnings).toEqual([]);
    expect(m.header).toEqual({
      key: 'C',
      keyPitch: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      bpm: 120,
    });
    expect(m.metadata).toEqual({
      ppq: 480,
      tempoMap: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      keySignatures: [{ tick: 0, key: 'C', scale: 'major' }],
      channel: 0,
      instrumentProgram: 0,
    });
    expect(m.bars).toEqual([
      { index: 1, startTick: 0, ticks: 4 * Q },
      { index: 2, startTick: 4 * Q, ticks: 4 * Q },
    ]);
  });

  it('gives stable, deterministic note IDs and a 7-bit velocity', () => {
    const text = '1=D 3/4 | 1 2 3 | 0 5 - |';
    const a = ok(text);
    const b = ok(text);
    expect(a).toEqual(b);
    expect(a.notes.map((n) => n.id)).toEqual(['jianpu:n0', 'jianpu:n1', 'jianpu:n2', 'jianpu:n3']);
    const custom = parseJianpu(text, { idPrefix: 'melody' });
    expect(custom.ok && custom.notes[0]!.id).toBe('melody:n0');
    expect(new Set(a.notes.map((n) => n.velocity))).toEqual(new Set([JIANPU_VELOCITY]));
    expect(Number.isInteger(JIANPU_VELOCITY * 127)).toBe(true);
  });

  it('places unmarked 1 on the key note in octave 4', () => {
    const first = (key: string) => ok(`1=${key} 1`).notes[0]!.pitch;
    expect(first('C')).toBe(60);
    expect(first('G')).toBe(67);
    expect(first('B')).toBe(71);
    expect(first('Bb')).toBe(70);
    expect(first('Cb')).toBe(59);
    expect(first('f#')).toBe(66);
  });

  it('applies accidentals and stackable octave marks', () => {
    const m = ok("1=C #4 b7 1' 1'' 5, 5,, 7");
    expect(m.notes.map((n) => n.pitch)).toEqual([66, 70, 72, 84, 55, 43, 71]);
    expect(ok('1=F# 1 #1 b1').notes.map((n) => n.pitch)).toEqual([66, 67, 65]);
  });

  it('handles eighths, sixteenths, dots, rests and extenders', () => {
    const m = ok('1=C 2/4 | 1_ 2__ 3__ 4._ 5__ | 0 - | 6 |');
    expect(shape(m)).toEqual([
      [60, 0, 240],
      [62, 240, 120],
      [64, 360, 120],
      [65, 480, 360],
      [67, 840, 120],
      [69, 1920, 480],
    ]);
    expect(m.warnings.map((w) => w.code)).toEqual(['BAR_DURATION_MISMATCH']);
  });

  it('lets an extender at the start of a bar lengthen the previous note', () => {
    const m = ok('1=C 2/4 | 1 2 | - 3 |');
    expect(shape(m)).toEqual([
      [60, 0, Q],
      [62, Q, 2 * Q],
      [64, 3 * Q, Q],
    ]);
    expect(m.warnings).toEqual([]);
  });

  it('accepts tempo headers, comments, Unicode accidentals and adjacent tokens', () => {
    const m = ok('// 测试\n1=E♭ 6/8 ♩=72\n|1_2_3_ 4_5_6_|');
    expect(m.header.bpm).toBe(72);
    expect(m.header.key).toBe('Eb');
    expect(m.notes.map((n) => n.pitch)).toEqual([63, 65, 67, 68, 70, 72]);
    expect(m.warnings).toEqual([]);
    expect(ok('bpm=90 1').metadata.tempoMap).toEqual([{ tick: 0, bpm: 90 }]);
  });

  it('defaults key and time signature with warnings, tempo silently', () => {
    const m = ok('1 2 3 4');
    expect(m.header.key).toBe('C');
    expect(m.header.bpm).toBe(120);
    expect(m.warnings.map((w) => w.code)).toEqual(['DEFAULT_KEY', 'DEFAULT_TIME_SIGNATURE']);
  });

  it('respells keys a MIDI key signature cannot hold', () => {
    const m = ok('1=A# 4/4 1 - - -');
    expect(m.notes[0]!.pitch).toBe(70);
    expect(m.metadata.keySignatures).toEqual([{ tick: 0, key: 'Bb', scale: 'major' }]);
    expect(m.warnings.map((w) => w.code)).toEqual(['KEY_SIGNATURE_RESPELLED']);
  });

  it('warns, but does not fail, on bars that do not match the time signature', () => {
    const m = ok('1=C 3/4\n| 1 2 3 |\n| 4 5 |');
    expect(m.warnings).toEqual([
      expect.objectContaining({
        code: 'BAR_DURATION_MISMATCH',
        line: 3,
        column: 3,
        bar: { index: 2, ticks: 2 * Q, expectedTicks: 3 * Q },
      }),
    ]);
  });

  it.each([
    ['1=C 4/4 (3 1 2 3)', 'UNSUPPORTED_TUPLET', 1, 9],
    ['1=C 1 ~2', 'UNSUPPORTED_ORNAMENT', 1, 7],
    ['1=C 1 tr2', 'UNSUPPORTED_ORNAMENT', 1, 7],
    ['1=C |: 1 2 :|', 'UNSUPPORTED_REPEAT', 1, 5],
    ['1=C 1 8', 'INVALID_DEGREE', 1, 7],
    ['1=C #0', 'INVALID_REST_MODIFIER', 1, 5],
    ["1=C 1',", 'MIXED_OCTAVE_MARKS', 1, 5],
    ['1=C 1___', 'UNSUPPORTED_DURATION', 1, 5],
    ['1=C 1..', 'UNSUPPORTED_DURATION', 1, 5],
    ['1=C ##1', 'UNSUPPORTED_ACCIDENTAL', 1, 5],
    ['1=C - 1', 'DANGLING_EXTENDER', 1, 5],
    ['1=C 1 #', 'DANGLING_ACCIDENTAL', 1, 7],
    ['1=H 1', 'INVALID_KEY', 1, 1],
    ['1=C 5/3 1', 'INVALID_TIME_SIGNATURE', 1, 5],
    ['1=C bpm=fast 1', 'INVALID_TEMPO', 1, 5],
    ['1=C 1=D 1', 'DUPLICATE_HEADER', 1, 5],
    ['1=C\n1 2\n3/4 3', 'HEADER_AFTER_NOTES', 3, 1],
    ["1=C 1''''''", 'PITCH_OUT_OF_RANGE', 1, 5],
    ['1=C x', 'UNEXPECTED_CHARACTER', 1, 5],
    ['1=C 4/4 | |', 'NO_NOTES', 1, 1],
  ])('rejects %j with %s at %i:%i', (text, code, line, column) => {
    const r = parseJianpu(text);
    expect(r.ok).toBe(false);
    expect(errorsOf(r)[0]).toEqual(expect.objectContaining({ code, line, column }));
  });

  it('reports every error, not just the first', () => {
    const r = parseJianpu('1=C 1 8 (2) ~3');
    expect(errorsOf(r).map((e) => e.code)).toEqual([
      'INVALID_DEGREE',
      'UNSUPPORTED_TUPLET',
      'UNSUPPORTED_TUPLET',
      'UNSUPPORTED_ORNAMENT',
    ]);
  });

  it('enforces size limits', () => {
    expect(errorsOf(parseJianpu('1 '.repeat(10), { limits: { maxChars: 5 } }))[0]?.code).toBe(
      'TEXT_TOO_LONG',
    );
    expect(errorsOf(parseJianpu('1 2 3', { limits: { maxNotes: 2 } }))[0]?.code).toBe(
      'TOO_MANY_NOTES',
    );
  });
});
