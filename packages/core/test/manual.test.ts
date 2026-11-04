import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  JIANPU_PPQ,
  JIANPU_VELOCITY,
  applyManualEdit,
  degreeOf,
  inMode,
  parseJianpu,
  snapPitch,
  stepPitch,
  writeJianpu,
  type MelodyNote,
  type MidiMetadata,
} from '../src/index.js';

const SEED = { seed: 20261103, numRuns: 300 };
const C_DORIAN = { root: 0, scaleId: 'dorian' };
const D_ZHI = { root: 2, scaleId: 'pentatonic-zhi' }; // G 宫: G A B D E

const note = (id: string, pitch: number, startTick: number, durationTick = 480): MelodyNote => ({
  id,
  pitch,
  startTick,
  durationTick,
  velocity: JIANPU_VELOCITY,
});

describe('manual edit helpers', () => {
  it('inMode / degreeOf follow the scale definition', () => {
    expect(inMode(63, C_DORIAN)).toBe(true);
    expect(inMode(64, C_DORIAN)).toBe(false);
    expect(degreeOf(63, C_DORIAN)).toMatchObject({ label: '♭3', role: 'mediant', isTonic: false });
    expect(degreeOf(48, C_DORIAN)).toMatchObject({ label: '1', isTonic: true });
    expect(degreeOf(64, C_DORIAN)).toMatchObject({ label: null, role: null, interval: 4 });
    expect(degreeOf(67, D_ZHI)).toMatchObject({ role: 'gong' });
  });

  it('stepPitch walks scale tones, or semitones without a mode, clamped to 0..127', () => {
    expect(stepPitch(60, 1, C_DORIAN)).toBe(62);
    expect(stepPitch(62, 1, C_DORIAN)).toBe(63);
    expect(stepPitch(60, -1, C_DORIAN)).toBe(58);
    expect(stepPitch(64, 1, C_DORIAN)).toBe(65); // off-scale E moves to the next tone up
    expect(stepPitch(64, -1, C_DORIAN)).toBe(63);
    expect(stepPitch(60, 7, C_DORIAN)).toBe(72);
    expect(stepPitch(60, 1, null)).toBe(61);
    expect(stepPitch(127, 1, null)).toBe(127);
    expect(stepPitch(0, -3, C_DORIAN)).toBe(0);
  });

  it('snapPitch picks the nearest scale tone, ties down', () => {
    expect(snapPitch(64, C_DORIAN)).toBe(63);
    expect(snapPitch(66, C_DORIAN)).toBe(65); // F# between F and G → lower
    expect(snapPitch(62, C_DORIAN)).toBe(62);
    expect(snapPitch(61, null)).toBe(61);
  });

  it('applyManualEdit changes only the pitch, never mutates, and logs MANUAL_EDIT', () => {
    const notes = Object.freeze(
      [note('a', 60, 0), note('b', 64, 480, 240)].map((n) => Object.freeze(n)),
    );
    const r = applyManualEdit(notes, 'b', 63);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes[1]).toEqual({ ...notes[1], pitch: 63 });
    expect(r.notes[0]).toBe(notes[0]);
    expect(notes[1]?.pitch).toBe(64);
    expect(r.change).toMatchObject({ noteId: 'b', fromPitch: 64, toPitch: 63 });
    expect(r.change.reasonCode).toBe('MANUAL_EDIT');
    expect(r.change.explanation).toBe('手动修改：E4 → Eb4');
    expect(applyManualEdit(notes, 'x', 60)).toMatchObject({ ok: false, code: 'UNKNOWN_NOTE' });
    expect(applyManualEdit(notes, 'a', 128)).toMatchObject({ ok: false, code: 'INVALID_PITCH' });
    expect(applyManualEdit(notes, 'a', 60)).toMatchObject({ ok: false, code: 'NO_CHANGE' });
  });

  it('applyManualEdit keeps Invariant B under random edits', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 127 }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 127 })), { maxLength: 30 }),
        (pitches, edits) => {
          const original = pitches.map((p, i) => note(`n${i}`, p, i * 480));
          let notes: readonly MelodyNote[] = original;
          for (const [k, p] of edits) {
            const r = applyManualEdit(notes, `n${k % pitches.length}`, p);
            if (r.ok) notes = r.notes;
          }
          const timing = (ns: readonly MelodyNote[]) =>
            ns.map((n) => [n.id, n.startTick, n.durationTick, n.velocity]);
          expect(timing(notes)).toEqual(timing(original));
        },
      ),
      SEED,
    );
  });
});

const META: Pick<MidiMetadata, 'ppq' | 'tempoMap' | 'timeSignatures' | 'keySignatures'> = {
  ppq: JIANPU_PPQ,
  tempoMap: [{ tick: 0, bpm: 96 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
};

describe('writeJianpu', () => {
  it('writes the parser example back', () => {
    const text = '1=C 4/4 bpm=96\n| 1 3 5 6 | 5 3 2 1 | 1. 2_ 3_ 0_ 0 | 1, - - - |\n';
    const parsed = parseJianpu(text);
    if (!parsed.ok) throw new Error('parse');
    const r = writeJianpu(parsed.notes, parsed.metadata);
    expect(r).toEqual({ ok: true, text, syntaxVersion: 'remode-jianpu/1.0.0', warnings: [] });
  });

  it('spells accidentals and octaves against the key', () => {
    const notes = [note('a', 66, 0), note('b', 70, 480), note('c', 79, 960), note('d', 54, 1440)];
    const r = writeJianpu(notes, META, { keyPitchClass: 7 });
    expect(r.ok && r.text).toBe("1=G 4/4 bpm=96\n| 7, b3 1' 7,, |\n");
  });

  it('refuses what jianpu cannot express', () => {
    expect(writeJianpu([note('a', 60, 0, 100)], META)).toMatchObject({
      ok: false,
      errors: [{ code: 'UNREPRESENTABLE_DURATION', noteIds: ['a'] }],
    });
    expect(writeJianpu([note('a', 60, 0), note('b', 62, 240)], META)).toMatchObject({
      ok: false,
      errors: [{ code: 'OVERLAP' }],
    });
    expect(
      writeJianpu([note('a', 60, 0)], {
        ...META,
        tempoMap: [
          { tick: 0, bpm: 96 },
          { tick: 480, bpm: 120 },
        ],
      }),
    ).toMatchObject({ ok: false, errors: [{ code: 'TEMPO_CHANGE' }] });
    expect(writeJianpu([note('a', 60, 0, 7)], { ...META, ppq: 960 })).toMatchObject({
      ok: false,
      errors: [{ code: 'PPQ_NOT_DIVISIBLE' }],
    });
    expect(writeJianpu([], META)).toMatchObject({ ok: false, errors: [{ code: 'NO_NOTES' }] });
  });

  it('round-trips random sixteenth-grid melodies through parseJianpu', () => {
    const SIXTEENTH = JIANPU_PPQ / 4;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 11 }),
        fc.constantFrom([4, 4], [3, 4], [6, 8], [2, 2]),
        fc.array(
          fc.record({
            pitch: fc.integer({ min: 30, max: 100 }),
            gap: fc.integer({ min: 0, max: 12 }),
            len: fc.integer({ min: 1, max: 20 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (keyPc, [num, den], raw) => {
          let t = 0;
          const notes = raw.map((r, i) => {
            const n = note(`x${i}`, r.pitch, t + r.gap * SIXTEENTH, r.len * SIXTEENTH);
            t = n.startTick + n.durationTick;
            return n;
          });
          const r = writeJianpu(
            notes,
            {
              ...META,
              timeSignatures: [{ tick: 0, numerator: num as number, denominator: den as number }],
            },
            { keyPitchClass: keyPc },
          );
          // Every multiple of a sixteenth is a head (1, 1_, 1__, dotted) plus whole beats.
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const back = parseJianpu(r.text);
          expect(back.ok).toBe(true);
          if (!back.ok) return;
          expect(back.notes.map((n) => [n.pitch, n.startTick, n.durationTick])).toEqual(
            notes.map((n) => [n.pitch, n.startTick, n.durationTick]),
          );
        },
      ),
      SEED,
    );
  });
});

describe('writeJianpu: review fixes', () => {
  const back = (text: string) => {
    const r = parseJianpu(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r;
  };
  const ticks = (ns: readonly MelodyNote[]) =>
    ns.map((n) => [n.pitch, n.startTick, n.durationTick]);

  it('warns once with every note whose velocity jianpu cannot carry', () => {
    const notes = [
      note('a', 60, 0),
      { ...note('b', 62, 480), velocity: 0.2 },
      { ...note('c', 64, 960), velocity: 1 },
    ];
    const r = writeJianpu(notes, META);
    if (!r.ok) throw new Error('write');
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: 'VELOCITY_DROPPED', noteIds: ['b', 'c'] }),
    ]);
    expect(back(r.text).notes.map((n) => n.velocity)).toEqual([
      JIANPU_VELOCITY,
      JIANPU_VELOCITY,
      JIANPU_VELOCITY,
    ]);
  });

  it('writes a 540-tick gap exactly (360 + 180), crossing the beat only because it must', () => {
    const notes = [note('a', 60, 0, 120), note('b', 62, 660, 120)];
    const r = writeJianpu(notes, META);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.text).toContain('1__ 0_. 0__. 2__');
    expect(ticks(back(r.text).notes)).toEqual(ticks(notes));
  });

  it('still refuses a gap with no decomposition, with an accurate message', () => {
    const r = writeJianpu([note('a', 60, 0, 120), note('b', 62, 180, 120)], META);
    expect(r).toMatchObject({
      ok: false,
      errors: [{ code: 'UNREPRESENTABLE_REST', noteIds: ['b'] }],
    });
    expect(!r.ok && r.errors[0]?.message).toMatch(
      /60-tick gap.*120–720 ticks in steps of 60.*barline/,
    );
  });

  it('rests never cross a barline', () => {
    // Gap 1800..2160 crosses the barline at 1920: 120 before, 240 after.
    const notes = [note('a', 60, 1680, 120), note('b', 62, 2160)];
    const r = writeJianpu(notes, META);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.text).toContain('1__ 0__ | 0_ 2');
    const parsed = back(r.text);
    expect(
      parsed.warnings.filter((w) => w.code === 'BAR_DURATION_MISMATCH').map((w) => w.bar?.index),
    ).toEqual([2]);
    expect(ticks(parsed.notes)).toEqual(ticks(notes));
  });

  it('a beat-aligned note across the barline keeps correct bars, with no warning', () => {
    const notes = [note('a', 60, 0, 1440), note('b', 62, 1440, 960), note('c', 64, 2400, 1440)];
    const r = writeJianpu(notes, META);
    if (!r.ok) throw new Error('write');
    expect(r.text).toBe('1=C 4/4 bpm=96\n| 1 - - 2 | - 3 - - |\n');
    expect(r.warnings).toEqual([]);
    expect(back(r.text).warnings).toEqual([]);
  });

  it('an off-beat note across the barline is exported with BAR_CROSSING_NOTE; ticks stay exact', () => {
    const notes = [note('a', 60, 0, 1800), note('b', 62, 1800, 480), note('c', 64, 2280, 1560)];
    const r = writeJianpu(notes, META);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings).toEqual([
      expect.objectContaining({ code: 'BAR_CROSSING_NOTE', noteIds: ['b'] }),
    ]);
    const parsed = back(r.text);
    expect(ticks(parsed.notes)).toEqual(ticks(notes));
    expect(parsed.warnings.some((w) => w.code === 'BAR_DURATION_MISMATCH')).toBe(true);
  });

  it('every gap of k·60 ≥ 120 ticks inside one bar round-trips exactly or is reported', () => {
    const BAR = 1920;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BAR / 60 - 1 }),
        fc.integer({ min: 2, max: BAR / 60 }),
        (s, g) => {
          const start = s * 60;
          const gapFrom = start + 120;
          const gap = g * 60;
          fc.pre(Math.floor(gapFrom / BAR) === Math.floor((gapFrom + gap - 1) / BAR));
          const notes = [note('a', 60, start, 120), note('b', 62, gapFrom + gap, 120)];
          const r = writeJianpu(notes, META);
          if (!r.ok) {
            // Only the leading rest before `a` (from tick 0) may be impossible, e.g. 60 ticks.
            expect(r.errors.map((e) => [e.code, e.noteIds])).toEqual([
              ['UNREPRESENTABLE_REST', ['a']],
            ]);
            return;
          }
          expect(ticks(back(r.text).notes)).toEqual(ticks(notes));
        },
      ),
      SEED,
    );
  });
});
