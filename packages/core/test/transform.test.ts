// M1b strict transforms (spec §7, §12.2 item 6–7, §12.3).

import { describe, expect, it } from 'vitest';
import {
  CHURCH_MODES,
  SCALES,
  chooseNeighbour,
  exportFileName,
  exportMidi,
  findOctaveShift,
  getScale,
  importMidi,
  melodyCandidates,
  mod,
  nearestTransposition,
  parseJianpu,
  pitchName,
  recheckTarget,
  strictRemode,
  strictRemodeWithTonic,
  transpose,
  trackMetadata,
  type MelodyNote,
  type MidiMetadata,
  type StrictRemodeOptions,
} from '../src/index.js';
import { fixtureBytes, fixtureText, notesOf } from './helpers.js';

const jianpu = (text: string) => {
  const r = parseJianpu(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const fixtureJianpu = (file: string) => jianpu(fixtureText(file));
const fixtureMidi = (file: string) => {
  const r = importMidi(fixtureBytes(file));
  if (!r.ok) throw new Error(r.error.code);
  const track = melodyCandidates(r.midi)[0]!;
  return { notes: track.notes, metadata: trackMetadata(r.midi, track) };
};
const names = (notes: readonly MelodyNote[]) => notes.map((n) => pitchName(n.pitch)).join(' ');
const at = { createdAt: 0 } satisfies StrictRemodeOptions;

function remode(
  notes: readonly MelodyNote[],
  root: number,
  from: string,
  to: string,
  options: StrictRemodeOptions = {},
) {
  const r = strictRemode(notes, { root, scaleId: from }, { scaleId: to }, { ...at, ...options });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

const C_IONIAN = fixtureJianpu('mode-church-c-ionian.jianpu');

describe('transpose', () => {
  it('adds n semitones (n may be negative) and keeps everything else', () => {
    const src = C_IONIAN.notes;
    const before = structuredClone(src);
    for (const n of [5, -7, 0, 12, -12]) {
      const r = transpose(src, n, at);
      if (!r.ok) throw new Error();
      expect(r.variant.notes.map((x) => x.pitch)).toEqual(src.map((x) => x.pitch + n));
      expect(r.variant.notes.map((x) => ({ ...x, pitch: 0 }))).toEqual(
        src.map((x) => ({ ...x, pitch: 0 })),
      );
      expect(r.variant.changes).toHaveLength(n === 0 ? 0 : src.length);
      expect(r.variant.id).toBe('custom');
      expect(r.variant.transform).toMatchObject({ operation: 'transpose', semitones: n });
    }
    expect(src).toEqual(before);
    const r = transpose(src, -3, at);
    expect(r.ok && r.variant.changes[0]).toEqual({
      noteId: 'jianpu:n0',
      fromPitch: 60,
      toPitch: 57,
      reasonCode: 'TRANSPOSE',
      explanation: 'C4 → A3：移调 -3 半音',
    });
  });

  it('resolves out-of-range results with one octave shift, or reports an error', () => {
    const high = notesOf([
      [100, 0, 1],
      [105, 1, 1],
    ]);
    const r = transpose(high, 5, at); // 105..110 does not fit 21..108
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variant.notes.map((n) => n.pitch)).toEqual([93, 98]);
    expect(r.range).toMatchObject({ shift: -12, fits: 'soft' });
    expect(r.warnings.map((w) => w.code)).toEqual(['RANGE_SHIFTED']);
    expect(r.variant.transform.rangeShift).toBe(-12);

    const off = transpose(high, 5, { ...at, softRange: null }); // 110 is legal MIDI
    expect(off.ok && off.variant.notes.map((n) => n.pitch)).toEqual([105, 110]);
    const over = transpose(high, 25, { ...at, softRange: null });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.errors[0]?.code).toBe('PITCH_OUT_OF_RANGE');
  });

  it('rejects non-integer semitones and invalid notes', () => {
    const r = transpose(C_IONIAN.notes, 1.5);
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['INVALID_SEMITONES']);
    const bad = transpose([{ ...C_IONIAN.notes[0]!, pitch: 128 }], 0);
    expect(!bad.ok && bad.errors[0]).toMatchObject({
      code: 'INVALID_NOTE',
      noteIds: ['jianpu:n0'],
    });
  });
});

describe('findOctaveShift (spec §7.4)', () => {
  it('keeps a fitting melody where it is', () => {
    const r = findOctaveShift([60, 72]);
    expect(r.ok && r.fit).toEqual({
      shift: 0,
      fits: 'soft',
      softRange: { low: 21, high: 108 },
      ambitus: { low: 60, high: 72 },
    });
  });

  it('moves the whole melody by octaves towards the reference centre', () => {
    expect(findOctaveShift([10, 20]).ok && findOctaveShift([10, 20])).toMatchObject({
      fit: { shift: 12 },
    });
    // 30..50 fits at k = 0..4; the reference centre 90 picks k = 4 (centre 88).
    const r = findOctaveShift([30, 50], { referenceCentre: 90 });
    expect(r.ok && r.fit.shift).toBe(48);
    const narrow = findOctaveShift([60, 64], { softRange: { low: 70, high: 80 } });
    expect(narrow.ok && narrow.fit.shift).toBe(12);
  });

  it('warns RANGE_NO_FIT when only MIDI 0..127 can be met, and errors beyond', () => {
    const wide = findOctaveShift([10, 115]);
    expect(wide.ok && wide.fit).toMatchObject({ shift: 0, fits: 'midi' });
    expect(wide.ok && wide.warnings.map((w) => w.code)).toEqual(['RANGE_NO_FIT']);
    const shifted = findOctaveShift([-2, 100]);
    expect(shifted.ok && shifted.fit).toMatchObject({ shift: 12, fits: 'midi' });
    const none = findOctaveShift([-1, 128]);
    expect(!none.ok && none.errors[0]?.code).toBe('PITCH_OUT_OF_RANGE');
    const disabled = findOctaveShift([-1, 20], { softRange: null });
    expect(!disabled.ok && disabled.errors[0]?.code).toBe('PITCH_OUT_OF_RANGE');
    const invalid = findOctaveShift([60], { softRange: { low: 50, high: 40 } });
    expect(!invalid.ok && invalid.errors[0]?.code).toBe('INVALID_RANGE');
  });
});

describe('strictRemode: 7 → 7', () => {
  const sources = CHURCH_MODES.map(
    (m) => [m.id, fixtureMidi(`mode-church-c-${m.id}.mid`)] as const,
  );

  it.each(CHURCH_MODES.flatMap((s) => CHURCH_MODES.map((t) => [s.id, t.id] as const)))(
    'C %s → C %s maps every note to the same-numbered degree (Invariant F)',
    (from, to) => {
      const src = getScale(from);
      const tgt = getScale(to);
      const notes = sources.find(([id]) => id === from)![1].notes;
      const r = remode(notes, 0, from, to);
      const changed = new Set(r.variant.changes.map((c) => c.noteId));
      notes.forEach((n, i) => {
        const rel = n.pitch;
        const degree = src.intervals.indexOf(mod(rel, 12));
        expect(degree).toBeGreaterThanOrEqual(0);
        const expected = 12 * Math.floor(rel / 12) + tgt.intervals[degree]!;
        expect(r.variant.notes[i]!.pitch).toBe(expected);
        // Invariant F: a note changes iff its degree's interval differs.
        expect(changed.has(n.id)).toBe(src.intervals[degree] !== tgt.intervals[degree]);
      });
      expect(r.variant.changes.every((c) => c.reasonCode === 'DEGREE_MAPPED')).toBe(true);
      expect(r.warnings.map((w) => w.code)).toEqual(
        from === to ? ['NO_CHARACTERISTIC_DEGREE'] : [],
      );
      // Analyzer re-check (spec §8.6): diagnostic, asserted here as a regression test.
      const recheck = recheckTarget(r.variant.notes, { root: 0, scaleId: to }, { ppq: 480 });
      expect(recheck).toMatchObject({ recognised: true, matchedAs: 'primary' });
    },
  );

  it('degree identity equals scale position on every heptatonic pair', () => {
    const heptatonic = SCALES.filter((x) => x.intervals.length === 7);
    // A three-octave run through each source scale on tonic D.
    for (const s of heptatonic) {
      expect(s.degreeIdentity.map((d) => d.degree)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      const run = notesOf(
        [-12, 0, 12].flatMap((o) =>
          s.intervals.map((i, k) => [62 + o + i, k, 1] as [number, number, number]),
        ),
      );
      for (const t of heptatonic) {
        const r = remode(run, 2, s.id, t.id);
        expect(r.report.mapping).toBe('degree-identity');
        const ordinal = run.map((n) => {
          const rel = n.pitch - 2;
          const k = s.intervals.indexOf(mod(rel, 12));
          return 2 + 12 * Math.floor(rel / 12) + t.intervals[k]!;
        });
        expect(r.variant.notes.map((n) => n.pitch)).toEqual(ordinal);
      }
    }
  });

  it('C Ionian (jianpu) → Dorian, Lydian with explained changes', () => {
    const dorian = remode(C_IONIAN.notes, 0, 'ionian', 'dorian');
    expect(names(dorian.variant.notes)).toBe(
      'C4 Eb4 G4 F4 Eb4 D4 C4 G4 A4 Bb4 C5 Bb4 A4 G4 F4 Eb4 D4 C4',
    );
    expect(dorian.variant.changes[0]).toEqual({
      noteId: 'jianpu:n1',
      fromPitch: 64,
      toPitch: 63,
      reasonCode: 'DEGREE_MAPPED',
      explanation: 'E4 → Eb4：第 3 级 → C Dorian 的第 ♭3 级',
    });
    expect(dorian.report.characteristic).toEqual({
      differing: ['3→♭3', '7→♭7'],
      sounded: ['3→♭3', '7→♭7'],
    });
    const lydian = remode(C_IONIAN.notes, 0, 'ionian', 'lydian');
    expect(lydian.variant.changes.map((c) => [c.noteId, pitchName(c.toPitch)])).toEqual([
      ['jianpu:n3', 'F#4'],
      ['jianpu:n14', 'F#4'],
    ]);
    expect(lydian.variant.transform).toMatchObject({
      operation: 'parallel-remode',
      strategy: 'strict',
      version: 'remode-strict/1.1.0',
      source: { root: 0, scaleId: 'ionian', name: 'C Ionian' },
      target: { root: 0, scaleId: 'lydian', name: 'C Lydian' },
      accidentals: 'nearest',
      strictTarget: true,
      rangeShift: 0,
    });
  });

  it('Chinese seven-note scales: 清乐 → 雅乐 changes only 清角 → 变徵', () => {
    const r = remode(C_IONIAN.notes, 0, 'qingyue-gong', 'yayue-gong');
    expect(r.variant.changes.map((c) => [pitchName(c.fromPitch), pitchName(c.toPitch)])).toEqual([
      ['F4', 'F#4'],
      ['F4', 'F#4'],
    ]);
    const yan = remode(C_IONIAN.notes, 0, 'qingyue-gong', 'yanyue-gong');
    expect(new Set(yan.variant.changes.map((c) => pitchName(c.toPitch)))).toEqual(new Set(['Bb4']));
  });
});

describe('strictRemode: notes below the tonic and across octaves', () => {
  it('uses floor division for negative offsets from the tonic', () => {
    // A Aeolian source with notes from B1 to E6, many below A.
    const notes = notesOf([
      [35, 0, 1], // B1: 2nd degree, octave -3
      [43, 1, 1], // G2: ♭7, octave -2
      [53, 2, 1], // F3: ♭6, octave -1
      [56, 3, 1], // Ab3: outside A Aeolian
      [57, 4, 1], // A3: tonic
      [69, 5, 1], // A4
      [77, 6, 1], // F5: ♭6
      [88, 7, 1], // E6: 5
    ]);
    const r = remode(notes, 9, 'aeolian', 'dorian', {
      accidentals: 'preserve',
      strictTarget: false,
    });
    expect(names(r.variant.notes)).toBe('B1 G2 F#3 Ab3 A3 A4 F#5 E6');
    const phry = remode(notes, 9, 'aeolian', 'phrygian', {
      accidentals: 'preserve',
      strictTarget: false,
    });
    expect(names(phry.variant.notes)).toBe('Bb1 G2 F3 Ab3 A3 A4 F5 E6');
  });
});

describe('strictRemode: 5 → 5 and same-type 6 → 6 by scale position', () => {
  const CDEGA = fixtureJianpu('missing-degrees-cdega.jianpu');
  const PENTATONIC = ['gong', 'shang', 'jue', 'zhi', 'yu'].map((d) => `pentatonic-${d}`);

  it('宫 → 羽: 1→1, 2→♭3, 3→4, 5→5, 6→♭7, no collapse', () => {
    const r = remode(CDEGA.notes, 0, 'pentatonic-gong', 'pentatonic-yu');
    // Source: 1 3 5 6 | 5 3 2 1 | - 3 5 6 | 1' 6 5 3 | 2 1
    expect(names(r.variant.notes)).toBe('C4 F4 G4 Bb4 G4 F4 Eb4 C4 F4 G4 Bb4 C5 Bb4 G4 F4 Eb4 C4');
    expect(r.report.mapping).toBe('scale-position');
    expect(r.report.positionMap?.map((e) => `${e.source.label}→${e.target.label}`)).toEqual([
      '1→1',
      '2→♭3',
      '3→4',
      '5→5',
      '6→♭7',
    ]);
    const d = r.variant.changes.find((c) => c.noteId === 'jianpu:n6')!;
    expect(d).toEqual({
      noteId: 'jianpu:n6',
      fromPitch: 62,
      toPitch: 63,
      reasonCode: 'SCALE_POSITION_MAPPED',
      explanation: 'D4 → Eb4：第 2 音位：商（2）→ C 羽调式（Eb 宫系统，五声） 的宫（♭3）',
    });
    expect(r.variant.changes.every((c) => c.reasonCode === 'SCALE_POSITION_MAPPED')).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.report.contour).toMatchObject({ reversed: [], repeated: [] });
    expect(r.report.characteristic.sounded).toEqual(['2→♭3', '3→4', '6→♭7']);
    const recheck = recheckTarget(
      r.variant.notes,
      { root: 0, scaleId: 'pentatonic-yu' },
      { ppq: 480 },
    );
    expect(recheck.recognised).toBe(true);
  });

  it.each(PENTATONIC.flatMap((s) => PENTATONIC.filter((t) => t !== s).map((t) => [s, t])))(
    '%s → %s is bijective and keeps the contour exactly',
    (from, to) => {
      const src = getScale(from);
      const tgt = getScale(to);
      // A three-octave run up and back down through the source scale on tonic D.
      const up = [-12, 0, 12].flatMap((o) => src.intervals.map((i) => 62 + o + i));
      const notes = notesOf([...up, ...[...up].reverse()].map((p, k) => [p, k, 1]));
      const r = remode(notes, 2, from, to);
      expect(r.report.mapping).toBe('scale-position');
      const out = r.variant.notes.map((n) => n.pitch);
      notes.forEach((n, i) => {
        const k = src.intervals.indexOf(mod(n.pitch - 2, 12));
        expect(out[i]! - n.pitch).toBe(tgt.intervals[k]! - src.intervals[k]!);
      });
      // Bijective: distinct source pitches stay distinct, so no step becomes a unison.
      const pairs = new Map(notes.map((n, i) => [n.pitch, out[i]!]));
      expect(new Set(pairs.values()).size).toBe(pairs.size);
      for (let i = 1; i < notes.length; i++) {
        expect(Math.sign(out[i]! - out[i - 1]!)).toBe(
          Math.sign(notes[i]!.pitch - notes[i - 1]!.pitch),
        );
      }
      expect(r.warnings.map((w) => w.code)).not.toContain('REPETITION_INTRODUCED');
      expect(r.warnings.map((w) => w.code)).not.toContain('CONTOUR_REVERSED');
      expect(r.variant.changes.every((c) => c.reasonCode === 'SCALE_POSITION_MAPPED')).toBe(true);
    },
  );

  it('accidentals inside 5 → 5 still follow the accidental policy', () => {
    const { notes } = jianpu('1=C 4/4 | 1 #4 5 3 | 2 1 - - |');
    const r = remode(notes, 0, 'pentatonic-gong', 'pentatonic-yu');
    // F# is outside C 宫: nearest neighbour in C 羽 (F or G); next note G → F keeps the rise.
    expect(names(r.variant.notes)).toBe('C4 F4 G4 F4 Eb4 C4');
    expect(r.variant.changes[0]).toMatchObject({
      noteId: 'jianpu:n1',
      reasonCode: 'ACCIDENTAL_NEAREST',
    });
    const rejected = strictRemode(
      notes,
      { root: 0, scaleId: 'pentatonic-gong' },
      { scaleId: 'pentatonic-yu' },
      { accidentals: 'reject' },
    );
    expect(!rejected.ok && rejected.errors[0]?.code).toBe('ACCIDENTAL_REJECTED');
  });

  it('6 → 6 by position within one type; across types by degree identity', () => {
    const same = remode(C_IONIAN.notes, 0, 'hexa-qingjiao-gong', 'hexa-qingjiao-yu');
    expect(same.report.mapping).toBe('scale-position');
    expect(same.report.positionMap?.map((e) => `${e.source.label}→${e.target.label}`)).toEqual([
      '1→1',
      '2→♭3',
      '3→4',
      '4→5',
      '5→♭6',
      '6→♭7',
    ]);
    const cross = remode(C_IONIAN.notes, 0, 'hexa-qingjiao-gong', 'hexa-biangong-gong');
    expect(cross.report.mapping).toBe('degree-identity');
    expect(cross.report.positionMap).toBeNull();
    // 5 ↔ 6 and 5 ↔ 7 are never positional.
    expect(remode(CDEGA.notes, 0, 'pentatonic-gong', 'hexa-qingjiao-gong').report.mapping).toBe(
      'degree-identity',
    );
  });
});

describe('strictRemode: 7 → 5 neighbour choice', () => {
  it('prefers the candidate that keeps the step to the next note, then the nearest', () => {
    // Ionian → 宫 (no 4th, no 7th degree).
    const { notes } = jianpu("1=C 4/4 | 4 5 4 3 | 7 1' 7 6 | 4 - 7 - |");
    const r = remode(notes, 0, 'ionian', 'pentatonic-gong');
    // F→G up: E (E→G up) keeps it, G would repeat. F→E down: G keeps the descent.
    // B→C up: A keeps it. B→A down: C keeps it. Final F, B: nearest (E, C).
    expect(names(r.variant.notes)).toBe('E4 G4 G4 E4 A4 C5 C5 A4 E4 C5');
    expect(r.variant.changes.map((c) => c.explanation?.replace(/^.*（(.*)）$/, '$1'))).toEqual([
      '与下一音的进行方向一致',
      '与下一音的进行方向一致',
      '与下一音的进行方向一致',
      '与下一音的进行方向一致',
      '距离最近',
      '距离最近',
    ]);
    expect(r.variant.changes.every((c) => c.reasonCode === 'SCALE_CONSTRAINT')).toBe(true);
  });

  it('breaks distance ties towards the tonic, then downwards', () => {
    // C# between C and D, no next note: equal distance, C is the tonic.
    expect(chooseNeighbour(61, 0, getScale('ionian').intervals, null)).toEqual({
      pitch: 60,
      lower: 60,
      upper: 62,
      rule: 'tonic',
    });
    // Bb between A and C (target 宫 on C): A is nearer.
    expect(chooseNeighbour(70, 0, getScale('pentatonic-gong').intervals, null)).toMatchObject({
      pitch: 69,
      rule: 'nearest',
    });
    // G between F# and Ab (target 0 6 8): equal distance; Ab is 4 from a tonic, F# 6.
    expect(chooseNeighbour(67, 0, [0, 6, 8], null)).toMatchObject({ pitch: 68, rule: 'tonic' });
    // F# exactly between E and G#, both 4 from a tonic: the lower one.
    expect(chooseNeighbour(66, 0, [0, 4, 8], null)).toMatchObject({ pitch: 64, rule: 'lower' });
    // A tie the next note decides: C# → D next, so C (C→D keeps rising).
    expect(
      chooseNeighbour(61, 0, getScale('ionian').intervals, { sourcePitch: 62, outputPitch: 62 }),
    ).toMatchObject({ pitch: 60, rule: 'direction' });
    // In the current scale library a missing degree is always inside a minor-third
    // gap, so distance ties come only from accidentals; see m1b notes.
  });

  it('6 → 5, 7 → 6 and 5 → 6 go through the same rules', () => {
    const r = remode(C_IONIAN.notes, 0, 'ionian', 'hexa-qingjiao-gong');
    expect(new Set(r.variant.changes.map((c) => c.reasonCode))).toEqual(
      new Set(['SCALE_CONSTRAINT']),
    );
    const back = remode(r.variant.notes, 0, 'hexa-qingjiao-gong', 'pentatonic-gong');
    expect(back.variant.notes.every((n) => [0, 2, 4, 7, 9].includes(mod(n.pitch, 12)))).toBe(true);
  });
});

describe('strictRemode: 5 → 7', () => {
  it('G 徵 (jianpu) → G Aeolian / Lydian: same-numbered degrees, no new notes', () => {
    const { notes } = fixtureJianpu('mode-pentatonic-c-gong-zhi.jianpu');
    // G A C D E = 1 2 4 5 6 relative to G.
    expect(names(notes)).toBe('G3 A3 C4 D4 C4 A3 G3 C4 D4 E4 G4 E4 D4 C4 A3 G3');
    const aeolian = remode(notes, 7, 'pentatonic-zhi', 'aeolian');
    expect(names(aeolian.variant.notes)).toBe('G3 A3 C4 D4 C4 A3 G3 C4 D4 Eb4 G4 Eb4 D4 C4 A3 G3');
    const lydian = remode(notes, 7, 'pentatonic-zhi', 'lydian');
    expect(names(lydian.variant.notes)).toBe('G3 A3 Db4 D4 Db4 A3 G3 Db4 D4 E4 G4 E4 D4 Db4 A3 G3');
    expect(lydian.variant.changes.every((c) => c.reasonCode === 'DEGREE_MAPPED')).toBe(true);
    expect(lydian.report.characteristic.sounded).toEqual(['4→♯4']);
  });
});

describe('NO_CHARACTERISTIC_DEGREE', () => {
  it('C D E G A as C Ionian → C Lydian: no 4th degree, output equals input', () => {
    const { notes } = fixtureJianpu('missing-degrees-cdega.jianpu');
    const r = remode(notes, 0, 'ionian', 'lydian');
    expect(r.variant.changes).toEqual([]);
    expect(r.report.outputEqualsInput).toBe(true);
    expect(r.warnings).toEqual([
      {
        code: 'NO_CHARACTERISTIC_DEGREE',
        message:
          '本旋律未使用有差别的音级（4→♯4），Ionian → Lydian 不会产生听感变化；输出与原曲相同。可在 Expressive 中引入特征音。',
        degrees: ['4→♯4'],
      },
    ]);
    // Honest re-check: the output is still C D E G A, which is not established as Lydian.
    const recheck = recheckTarget(r.variant.notes, { root: 0, scaleId: 'lydian' }, { ppq: 480 });
    expect(recheck.recognised).toBe(false);
    expect(recheck.rank1.map((c) => c.scaleId)).toEqual(['pentatonic-gong']);
    expect(recheck.ambiguities.map((a) => a.code)).toContain('MISSING_DEGREES');
  });

  it('5 → 7 into degrees the source scale lacks, and identical scales', () => {
    const { notes } = fixtureJianpu('missing-degrees-cdega.jianpu');
    const r = remode(notes, 0, 'pentatonic-gong', 'mixolydian');
    expect(r.warnings[0]).toMatchObject({
      code: 'NO_CHARACTERISTIC_DEGREE',
      degrees: ['4 (目标新增)', '♭7 (目标新增)'],
    });
    const same = remode(notes, 0, 'ionian', 'qingyue-gong');
    expect(same.warnings[0]?.message).toMatch(/^C Ionian 与 C 宫调式.* 的音级完全相同/);
  });

  it('is not raised when a differing degree sounds', () => {
    const r = remode(C_IONIAN.notes, 0, 'ionian', 'mixolydian');
    expect(r.warnings).toEqual([]);
    expect(r.report.characteristic.sounded).toEqual(['7→♭7']);
  });
});

describe('accidental policies', () => {
  // C Ionian with one F# (outside the source) and a final C# with no next note.
  const { notes } = jianpu('1=C 4/4 | 1 #4 5 3 | 2 1 #1 - |');

  it('nearest (default) moves outside notes to a target neighbour', () => {
    const r = remode(notes, 0, 'ionian', 'dorian');
    expect(names(r.variant.notes)).toBe('C4 F4 G4 Eb4 D4 C4 C4');
    expect(r.variant.changes.filter((c) => c.reasonCode === 'ACCIDENTAL_NEAREST')).toHaveLength(2);
    expect(r.warnings.map((w) => w.code)).toContain('ACCIDENTALS_MAPPED');
    expect(r.report.accidentals).toEqual({
      policy: 'nearest',
      noteIds: ['jianpu:n1', 'jianpu:n6'],
    });
    // An outside note already in the target stays: F# is in C Lydian.
    const lyd = remode(notes, 0, 'ionian', 'lydian');
    expect(lyd.variant.notes[1]!.pitch).toBe(66);
  });

  it('preserve keeps them but needs a non-strict target', () => {
    const refused = strictRemode(
      notes,
      { root: 0, scaleId: 'ionian' },
      { scaleId: 'dorian' },
      {
        accidentals: 'preserve',
      },
    );
    expect(!refused.ok && refused.errors.map((e) => e.code)).toEqual([
      'PRESERVE_REQUIRES_LOOSE_TARGET',
    ]);
    const r = remode(notes, 0, 'ionian', 'dorian', {
      accidentals: 'preserve',
      strictTarget: false,
    });
    expect(names(r.variant.notes)).toBe('C4 F#4 G4 Eb4 D4 C4 Db4');
    expect(r.warnings.map((w) => w.code)).toContain('ACCIDENTALS_PRESERVED');
  });

  it('reject refuses the transform and names the notes', () => {
    const r = strictRemode(
      notes,
      { root: 0, scaleId: 'ionian' },
      { scaleId: 'dorian' },
      {
        accidentals: 'reject',
      },
    );
    expect(!r.ok && r.errors).toEqual([
      {
        code: 'ACCIDENTAL_REJECTED',
        message: '2 note(s) lie outside C Ionian: F#4 Db4.',
        noteIds: ['jianpu:n1', 'jianpu:n6'],
      },
    ]);
    expect(remode(C_IONIAN.notes, 0, 'ionian', 'dorian', { accidentals: 'reject' }).ok).toBe(true);
  });
});

describe('strictRemode: range', () => {
  it('shifts the whole melody by one octave when the mapping leaves the soft range', () => {
    // B Phrygian near the top: G9 (♭6) → B Ionian's 6 = G#9 = 128, beyond MIDI.
    const notes = notesOf([
      [107, 0, 1], // B7 tonic
      [115, 1, 1], // G8 ♭6
      [127, 2, 1], // G9 ♭6
    ]);
    const r = remode(notes, 11, 'phrygian', 'ionian');
    expect(r.variant.transform.rangeShift).toBe(-24);
    expect(r.report.range).toMatchObject({
      shift: -24,
      fits: 'soft',
      ambitus: { low: 83, high: 104 },
    });
    expect(r.variant.changes.map((c) => c.reasonCode)).toEqual([
      'RANGE_ADJUSTMENT',
      'DEGREE_MAPPED',
      'DEGREE_MAPPED',
    ]);
    expect(r.variant.changes[2]!.explanation).toBe(
      'G9 → Ab7：第 ♭6 级 → B Ionian 的第 6 级；全曲整体移动 -2 个八度（音域）',
    );
    expect(r.warnings.map((w) => w.code)).toContain('RANGE_SHIFTED');

    const off = strictRemode(
      notes,
      { root: 11, scaleId: 'phrygian' },
      { scaleId: 'ionian' },
      {
        softRange: null,
      },
    );
    expect(!off.ok && off.errors[0]?.code).toBe('PITCH_OUT_OF_RANGE');
  });

  it('reports RANGE_NO_FIT when no single octave shift fits the soft range', () => {
    const notes = notesOf([
      [12, 0, 1],
      [120, 1, 1],
    ]);
    const r = remode(notes, 0, 'ionian', 'dorian');
    expect(r.report.range).toMatchObject({ shift: 0, fits: 'midi' });
    expect(r.warnings.map((w) => w.code)).toEqual(['RANGE_NO_FIT', 'NO_CHARACTERISTIC_DEGREE']);
  });
});

describe('strictRemodeWithTonic: two explicit steps', () => {
  it('C Ionian → A Dorian = transpose -3, then A Ionian → A Dorian', () => {
    const r = strictRemodeWithTonic(
      C_IONIAN.notes,
      { root: 0, scaleId: 'ionian' },
      { root: 9, scaleId: 'dorian' },
      at,
    );
    if (!r.ok) throw new Error();
    expect(r.steps.map((s) => s.operation)).toEqual(['transpose', 'parallel-remode']);
    expect(r.steps[0].variant.transform.semitones).toBe(-3);
    expect(r.steps[1].variant.transform.source).toMatchObject({ root: 9, scaleId: 'ionian' });
    expect(names(r.variant.notes)).toBe('A3 C4 E4 D4 C4 B3 A3 E4 F#4 G4 A4 G4 F#4 E4 D4 C4 B3 A3');
    expect(r.variant.transform.preTranspose).toEqual({ fromRoot: 0, semitones: -3 });
    expect(r.variant.changes[1]).toEqual({
      noteId: 'jianpu:n1',
      fromPitch: 64,
      toPitch: 60,
      reasonCode: 'DEGREE_MAPPED',
      explanation: 'E4 → Db4：移调 -3 半音；然后 Db4 → C4：第 3 级 → A Dorian 的第 ♭3 级',
    });
    expect(nearestTransposition(0, 7)).toBe(-5);
    expect(nearestTransposition(0, 6)).toBe(6);
    const bad = strictRemodeWithTonic(
      C_IONIAN.notes,
      { root: 0, scaleId: 'ionian' },
      { root: 9, scaleId: 'dorian' },
      { semitones: 2 },
    );
    expect(!bad.ok && bad.errors[0]?.code).toBe('INVALID_SEMITONES');
  });
});

describe('strict output round trip (Invariant E)', () => {
  it.each(['dorian', 'lydian', 'pentatonic-yu'])('C Ionian → C %s exports and re-imports', (to) => {
    const r = remode(C_IONIAN.notes, 0, 'ionian', to);
    const meta: MidiMetadata = C_IONIAN.metadata;
    const out = exportMidi(r.variant.notes, meta, {
      keySignature: { kind: 'mode', rootPitchClass: 0, scaleId: to },
    });
    if (!out.ok) throw new Error(JSON.stringify(out.errors));
    const back = importMidi(out.bytes);
    if (!back.ok) throw new Error();
    const track = back.midi.tracks[0]!;
    expect(track.notes.map((n) => [n.pitch, n.startTick, n.durationTick, n.velocity])).toEqual(
      r.variant.notes.map((n) => [n.pitch, n.startTick, n.durationTick, n.velocity]),
    );
    expect(out.report.keySignature.mode?.scaleId).toBe(to);
    expect(
      exportFileName({
        source: 'mode-church-c-ionian.jianpu',
        rootPitchClass: 0,
        scaleId: to,
        variant: 'strict',
      }),
    ).toBe(`mode-church-c-ionian-C-${to}-strict.mid`);
  });
});

describe('errors', () => {
  it('unknown scales, bad roots', () => {
    const r = strictRemode(C_IONIAN.notes, { root: 0.5, scaleId: 'nope' }, { scaleId: 'dorian' });
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['INVALID_ROOT', 'UNKNOWN_SCALE']);
  });

  it('every registered scale pair runs', () => {
    for (const s of SCALES) {
      for (const t of SCALES) {
        expect(remode(C_IONIAN.notes, 0, s.id, t.id, { accidentals: 'nearest' }).ok).toBe(true);
      }
    }
  });
});
