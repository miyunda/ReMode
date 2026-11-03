import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importMidi } from '@remode/core';
import { EXIT, runCli } from '../src/cli.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));

/** In-memory files that shadow the fixture directory. */
const virtual = new Map<string, Uint8Array>();

function run(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const written = new Map<string, Uint8Array>();
  const code = runCli(argv, {
    readFile: (p) =>
      virtual.get(p) ?? new Uint8Array(readFileSync(p.startsWith('/') ? p : `${FIXTURES}${p}`)),
    writeFile: (p, bytes) => written.set(p, bytes),
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = stdout.startsWith('{') ? (JSON.parse(stdout) as any) : null;
  return { code, stdout, stderr, json, written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withoutIds = (analysis: any) =>
  JSON.parse(JSON.stringify(analysis).replace(/"(track-0|jianpu):n(\d+)"/g, '"n$2"'));

describe('remode analyze', () => {
  it('reports candidates, evidence and MISSING_DEGREES for C D E G A', () => {
    const { code, json, stdout } = run('analyze', 'missing-degrees-cdega.mid');
    expect(code).toBe(EXIT.OK);
    expect(json.selectedTrack).toBe('track-0');
    expect(json.validation.ok).toBe(true);
    const top = json.analysis.candidates[0];
    expect(top.name).toBe('C 宫调式（C 宫系统，五声）');
    expect(top.tonicEvidence.map((e: { kind: string }) => e.kind)).toContain('FINAL_NOTE');
    const md = json.analysis.ambiguities.find(
      (a: { code: string }) => a.code === 'MISSING_DEGREES',
    );
    expect(md.affectedScaleIds).toEqual(expect.arrayContaining(['ionian', 'lydian', 'mixolydian']));
    expect(json.analysis.baseline.usedForRanking).toBe(false);
    expect(stdout).not.toMatch(/%|confidence|probability/i);
  });

  it('asks for --track when several melodic tracks exist, then honours it', () => {
    const first = run('analyze', 'type0-multichannel.mid');
    expect(first.code).toBe(EXIT.TRACK_SELECTION);
    expect(first.json.errors[0].code).toBe('TRACK_SELECTION_REQUIRED');
    expect(first.json.import.tracks).toHaveLength(3);

    const picked = run('analyze', 'type0-multichannel.mid', '--track', '0');
    expect(picked.code).toBe(EXIT.OK);
    expect(picked.json.analysis.candidates[0].name).toBe('D Dorian');
  });

  it('refuses percussion and overlapping tracks', () => {
    const drums = run('analyze', 'type1-empty-percussion.mid', '--track', 'track-1');
    expect(drums.code).toBe(EXIT.VALIDATION_FAILED);
    expect(drums.json.analysis).toBeNull();

    const nested = run('analyze', 'overlap-nested.mid');
    expect(nested.code).toBe(EXIT.VALIDATION_FAILED);
    expect(nested.json.errors[0].code).toBe('VALIDATION_FAILED');
  });

  it('applies the safe repair only on request and lists every change', () => {
    const plain = run('analyze', 'overlap-legato.mid');
    expect(plain.code).toBe(EXIT.OK);
    expect(plain.json.repair).toBeNull();

    const repaired = run('analyze', 'overlap-legato.mid', '--repair');
    expect(repaired.code).toBe(EXIT.OK);
    expect(repaired.json.repair.repairs).toEqual([
      expect.objectContaining({ action: 'TRIM_LEGATO_TAIL', from: 485, to: 480 }),
    ]);

    const heavy = run('analyze', 'overlap-heavy.mid', '--repair');
    expect(heavy.code).toBe(EXIT.VALIDATION_FAILED);
    expect(heavy.json.repair.repairs).toEqual([]);
  });

  it('reports malformed files with a structured error', () => {
    const { code, json } = run('analyze', 'malformed-truncated.mid');
    expect(code).toBe(EXIT.IMPORT_FAILED);
    expect(json.import).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'TRUNCATED' }),
    });
  });

  it('prints usage on bad arguments', () => {
    expect(run().code).toBe(EXIT.USAGE);
    expect(run('analyze').code).toBe(EXIT.USAGE);
    expect(run('analyze', 'x.mid', '--bogus').code).toBe(EXIT.USAGE);
    expect(run('analyze', '/nonexistent/file.mid').code).toBe(EXIT.USAGE);
    expect(run('--help').stdout).toMatch(/remode analyze/);
    expect(run('analyze', 'x.mid', '--jianpu', '1 2 3').code).toBe(EXIT.USAGE);
    expect(run('analyze', '--jianpu', '1 2 3', '--track', '0').code).toBe(EXIT.USAGE);
    expect(run('export').code).toBe(EXIT.USAGE);
    expect(run('export', 'x.jianpu', '--jianpu', '1 2 3').code).toBe(EXIT.USAGE);
    expect(run('export', '--jianpu', '1 2 3', '--repair').code).toBe(EXIT.USAGE);
    expect(run('analyze', '--jianpu', '1 2 3', '-o', 'x.mid').code).toBe(EXIT.USAGE);
    expect(run('transpose', 'x.mid').code).toBe(EXIT.USAGE);
    expect(run('transpose', '--jianpu', '1 2', '--semitones', '1.5').code).toBe(EXIT.USAGE);
    expect(run('remode', '--jianpu', '1 2').code).toBe(EXIT.USAGE);
    expect(run('remode', '--jianpu', '1 2', '--to', 'nope').code).toBe(EXIT.USAGE);
    expect(run('remode', '--jianpu', '1 2', '--to', 'H:dorian').code).toBe(EXIT.USAGE);
    expect(run('remode', '--jianpu', '1 2', '--to', 'dorian', '--from', 'ionian').code).toBe(
      EXIT.USAGE,
    );
    expect(run('remode', '--jianpu', '1 2', '--to', 'dorian', '--accidentals', 'x').code).toBe(
      EXIT.USAGE,
    );
    expect(
      run('remode', '--jianpu', '1 2', '--to', 'dorian', '--strategy', 'expressive').code,
    ).toBe(EXIT.USAGE);
    expect(run('analyze', '--jianpu', '1 2', '--to', 'dorian').code).toBe(EXIT.USAGE);
    expect(run('analyze', '--jianpu', '1 2', '--no-range').code).toBe(EXIT.USAGE);
    expect(run('remode', '--jianpu', '1 2', '--to', 'dorian', '--semitones', '2').code).toBe(
      EXIT.USAGE,
    );
  });
});

describe('remode analyze (jianpu)', () => {
  it('analyses a .jianpu file exactly like its MIDI twin', () => {
    const j = run('analyze', 'missing-degrees-cdega.jianpu');
    const m = run('analyze', 'missing-degrees-cdega.mid');
    expect(j.code).toBe(EXIT.OK);
    expect(j.json.input).toEqual({
      file: 'missing-degrees-cdega.jianpu',
      format: 'jianpu',
      bytes: expect.any(Number),
    });
    expect(j.json.import).toEqual(
      expect.objectContaining({ ok: true, source: 'jianpu', noteCount: 17, ppq: 480 }),
    );
    expect(j.json.import.warnings.map((w: { code: string }) => w.code)).toEqual([
      'BAR_DURATION_MISMATCH',
    ]);
    expect(j.json.selectedTrack).toBe('jianpu');
    expect(j.json.validation.ok).toBe(true);
    expect(withoutIds(j.json.analysis)).toEqual(withoutIds(m.json.analysis));
  });

  it('reads .txt files as jianpu', () => {
    virtual.set('/virtual/song.txt', new TextEncoder().encode('1=D 2/4 | 6, 1 | 2 3 | 6, - |'));
    const r = run('analyze', '/virtual/song.txt', '--compact');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.import.header.key).toBe('D');
  });

  it('accepts inline text with --jianpu', () => {
    const r = run('analyze', '--jianpu', '1=Bb 4/4 | 2, 4, 6, 5, | 4, 3, 2, - |');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.input).toEqual({ file: null, format: 'jianpu', bytes: expect.any(Number) });
    expect(r.json.analysis.candidates.length).toBeGreaterThan(0);
  });

  it('reports parse errors with line, column and code', () => {
    const r = run('analyze', '--jianpu', '1=C 4/4\n| 1 2 (3 4) |');
    expect(r.code).toBe(EXIT.IMPORT_FAILED);
    expect(r.json.import.ok).toBe(false);
    expect(r.json.errors[0]).toEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_TUPLET', line: 2, column: 7 }),
    );
    expect(r.json.analysis).toBeNull();
  });
});

describe('remode export', () => {
  it('converts jianpu to MIDI without changing a note', () => {
    const r = run('export', 'mode-church-c-dorian.jianpu', '-o', 'out.mid');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.output).toEqual({ file: 'out.mid', bytes: r.written.get('out.mid')!.length });
    expect(r.json.export.warnings).toEqual([]);
    expect(r.json.export.keySignature).toEqual({
      policy: 'source',
      written: [{ tick: 0, key: 'Bb', scale: 'major' }],
    });
    const back = importMidi(r.written.get('out.mid')!);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const twin = importMidi(new Uint8Array(readFileSync(`${FIXTURES}mode-church-c-dorian.mid`)));
    const shape = (b: ReturnType<typeof importMidi>) =>
      b.ok ? b.midi.tracks[0]!.notes.map((n) => [n.pitch, n.startTick, n.durationTick]) : [];
    expect(shape(back)).toEqual(shape(twin));
    expect(back.midi.metadata.keySignatures).toEqual([{ tick: 0, key: 'Bb', scale: 'major' }]);
  });

  it('names the output after the source when -o is omitted', () => {
    const r = run('export', 'mode-pentatonic-c-gong-zhi.jianpu');
    expect(r.code).toBe(EXIT.OK);
    expect([...r.written.keys()]).toEqual(['mode-pentatonic-c-gong-zhi-original.mid']);
  });

  it('converts inline --jianpu text, which is never read as a path', () => {
    const r = run('export', '--jianpu', '1=C 4/4 | 1 2 3 4 |', '-o', 'out.mid');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.input).toEqual({ file: null, format: 'jianpu', bytes: 19 });
    const back = importMidi(r.written.get('out.mid')!);
    expect(back.ok && back.midi.tracks[0]!.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);

    const unnamed = run('export', '--jianpu', '1 2 3');
    expect([...unnamed.written.keys()]).toEqual(['melody-original.mid']);

    // A path given to --jianpu is parsed as text and fails, rather than being read.
    const path = run('export', '--jianpu', 'mode-church-c-dorian.jianpu');
    expect(path.code).toBe(EXIT.IMPORT_FAILED);
    expect(path.written.size).toBe(0);
  });

  it('refuses MIDI input with a clear message', () => {
    const r = run('export', 'mode-church-c-dorian.mid', '-o', 'out.mid');
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.stderr).toMatch(/for MIDI input use transpose or remode/);
    expect(r.written.size).toBe(0);
  });

  it('writes nothing when the jianpu does not parse', () => {
    virtual.set('/virtual/bad.jianpu', new TextEncoder().encode('1=C |: 1 2 :|'));
    const r = run('export', '/virtual/bad.jianpu', '-o', 'out.mid');
    expect(r.code).toBe(EXIT.IMPORT_FAILED);
    expect(r.json.errors[0].code).toBe('UNSUPPORTED_REPEAT');
    expect(r.written.size).toBe(0);
  });
});

describe('remode transpose', () => {
  it('transposes MIDI by a negative interval and names the file after it', () => {
    const r = run('transpose', 'mode-church-c-dorian.mid', '--semitones', '-3');
    expect(r.code).toBe(EXIT.OK);
    expect([...r.written.keys()]).toEqual(['mode-church-c-dorian-transpose-down3.mid']);
    expect(r.json.remode.transformVersion).toBe('remode-transpose/1.0.0');
    expect(r.json.transform).toMatchObject({
      operation: 'transpose',
      semitones: -3,
      rangeShift: 0,
    });
    expect(r.json.summary).toEqual({ notes: 18, changed: 18 });
    expect(r.json.diff[0]).toMatchObject({ from: 'C4', to: 'A3', reasonCode: 'TRANSPOSE' });
    const back = importMidi(r.written.get('mode-church-c-dorian-transpose-down3.mid')!);
    const src = importMidi(new Uint8Array(readFileSync(`${FIXTURES}mode-church-c-dorian.mid`)));
    if (!back.ok || !src.ok) throw new Error();
    expect(
      back.midi.tracks[0]!.notes.map((n) => [n.pitch + 3, n.startTick, n.durationTick]),
    ).toEqual(src.midi.tracks[0]!.notes.map((n) => [n.pitch, n.startTick, n.durationTick]));
  });

  it('omits source key signatures that no longer apply', () => {
    const r = run('transpose', 'mode-church-c-dorian.jianpu', '--semitones=2', '-o', 'o.mid');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.warnings.map((w: { code: string }) => w.code)).toEqual([
      'KEY_SIGNATURES_OMITTED',
    ]);
    expect(r.json.export.keySignature).toEqual({ policy: 'omit', written: [] });
    const octave = run(
      'transpose',
      'mode-church-c-dorian.jianpu',
      '--semitones',
      '12',
      '-o',
      'o.mid',
    );
    expect(octave.json.export.keySignature.policy).toBe('source');
  });

  it('applies the soft range, or fails with --no-range', () => {
    const shifted = run('transpose', '--jianpu', "1=C | 1'' 2'' |", '--semitones', '40');
    expect(shifted.code).toBe(EXIT.OK);
    expect(shifted.json.transform.rangeShift).toBe(-24); // 124..126 → 100..102
    expect(shifted.json.warnings[0].code).toBe('RANGE_SHIFTED');
    // 126 is still MIDI; 131 is not, and --no-range forbids shifting it back.
    const legal = run(
      'transpose',
      '--jianpu',
      "1=C | 1'' 2'' |",
      '--semitones',
      '40',
      '--no-range',
    );
    expect(legal.json.transform.rangeShift).toBe(0);
    const off = run('transpose', '--jianpu', "1=C | 1'' 2'' |", '--semitones', '45', '--no-range');
    expect(off.code).toBe(EXIT.TRANSFORM_FAILED);
    expect(off.json.errors[0].code).toBe('PITCH_OUT_OF_RANGE');
    expect(off.written.size).toBe(0);
  });
});

describe('remode remode', () => {
  type Diff = { noteId: string; from: string; to: string; reasonCode: string };

  it('C Ionian → C Dorian / Lydian / 羽 from the jianpu fixture', () => {
    const dorian = run('remode', 'mode-church-c-ionian.jianpu', '--to', 'dorian');
    expect(dorian.code).toBe(EXIT.OK);
    expect([...dorian.written.keys()]).toEqual(['mode-church-c-ionian-C-dorian-strict.mid']);
    expect(dorian.json.sourceMode).toMatchObject({ name: 'C Ionian', via: 'analysis' });
    expect(dorian.json.targetMode).toMatchObject({ name: 'C Dorian' });
    expect(dorian.json.diff.map((d: Diff) => `${d.from}→${d.to}`)).toEqual([
      'E4→Eb4',
      'E4→Eb4',
      'B4→Bb4',
      'B4→Bb4',
      'E4→Eb4',
    ]);
    expect(dorian.json.recheck).toMatchObject({ recognised: true, matchedAs: 'primary' });
    expect(dorian.json.export.keySignature).toMatchObject({
      policy: 'mode',
      written: [{ tick: 0, key: 'Bb', scale: 'major' }],
      mode: { text: 'ReMode mode: C Dorian [dorian]' },
    });

    const lydian = run('remode', 'mode-church-c-ionian.jianpu', '--to', 'lydian');
    expect(lydian.json.diff.map((d: Diff) => `${d.from}→${d.to}`)).toEqual(['F4→F#4', 'F4→F#4']);

    const yu = run(
      'remode',
      'mode-church-c-ionian.jianpu',
      '--to',
      'pentatonic-yu',
      '-o',
      'yu.mid',
    );
    expect(yu.code).toBe(EXIT.OK);
    expect(yu.json.targetMode.name).toBe('C 羽调式（Eb 宫系统，五声）');
    expect(new Set(yu.json.diff.map((d: Diff) => d.reasonCode))).toEqual(
      new Set(['DEGREE_MAPPED', 'SCALE_CONSTRAINT']),
    );
    expect(yu.json.warnings.map((w: { code: string }) => w.code)).toEqual([
      'REPETITION_INTRODUCED',
    ]);
    const back = importMidi(yu.written.get('yu.mid')!);
    expect(back.ok && back.midi.metadata.keySignatures).toEqual([
      { tick: 0, key: 'Eb', scale: 'major' },
    ]);
  });

  it('maps 五声 → 五声 by scale position', () => {
    const r = run('remode', 'missing-degrees-cdega.jianpu', '--to', 'pentatonic-yu');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.sourceMode.scaleId).toBe('pentatonic-gong');
    expect(r.json.diagnostics.mapping).toBe('scale-position');
    expect(new Set(r.json.diff.map((d: Diff) => `${d.from}→${d.to}`))).toEqual(
      new Set(['D4→Eb4', 'E4→F4', 'A4→Bb4']),
    );
    expect(new Set(r.json.diff.map((d: Diff) => d.reasonCode))).toEqual(
      new Set(['SCALE_POSITION_MAPPED']),
    );
    expect(r.json.warnings).toEqual([]);
    expect(r.json.recheck.recognised).toBe(true);
  });

  it('reports NO_CHARACTERISTIC_DEGREE and an honest re-check', () => {
    const r = run('remode', 'missing-degrees-cdega.jianpu', '--from', 'C:ionian', '--to', 'lydian');
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.sourceMode.via).toBe('option');
    expect(r.json.sourceAnalysis.rank1).toEqual(['C 宫调式（C 宫系统，五声）']);
    expect(r.json.diff).toEqual([]);
    expect(r.json.warnings[0]).toMatchObject({
      code: 'NO_CHARACTERISTIC_DEGREE',
      degrees: ['4→♯4'],
    });
    expect(r.json.diagnostics.outputEqualsInput).toBe(true);
    expect(r.json.recheck.recognised).toBe(false);
  });

  it('refuses an ambiguous source mode unless --from is given', () => {
    const r = run('remode', 'tonic-unclear-pentatonic.mid', '--to', 'dorian');
    expect(r.code).toBe(EXIT.SOURCE_MODE_AMBIGUOUS);
    expect(r.json.errors[0].code).toBe('SOURCE_MODE_AMBIGUOUS');
    expect(r.json.errors[0].message).toMatch(/TONIC_UNCLEAR.*--from/);
    expect(r.written.size).toBe(0);
    const ok = run(
      'remode',
      'tonic-unclear-pentatonic.mid',
      '--to',
      'dorian',
      '--from',
      'A:pentatonic-yu',
    );
    expect(ok.code).toBe(EXIT.OK);
    const short = run('remode', '--jianpu', '1 2 3', '--to', 'dorian');
    expect(short.code).toBe(EXIT.SOURCE_MODE_AMBIGUOUS);
    expect(short.json.errors[0].message).toMatch(/TOO_SHORT/);
  });

  it('changes tonic and mode as two explicit steps', () => {
    const r = run('remode', 'mode-church-c-ionian.jianpu', '--to', 'A:dorian');
    expect(r.code).toBe(EXIT.OK);
    expect([...r.written.keys()]).toEqual(['mode-church-c-ionian-A-dorian-strict.mid']);
    expect(r.json.steps.map((s: { operation: string }) => s.operation)).toEqual([
      'transpose',
      'parallel-remode',
    ]);
    expect(r.json.transform.preTranspose).toEqual({ fromRoot: 0, semitones: -3 });
    expect(r.json.recheck).toMatchObject({ recognised: true });
  });

  it('accidental policies: nearest, preserve, reject', () => {
    const text = '1=C 4/4 | 1 #4 5 3 | 2 1 3 2 | 1 - - - |';
    const nearest = run('remode', '--jianpu', text, '--from', 'C:ionian', '--to', 'dorian');
    expect(
      nearest.json.diff.filter((d: Diff) => d.reasonCode === 'ACCIDENTAL_NEAREST'),
    ).toHaveLength(1);
    const keep = run(
      'remode',
      '--jianpu',
      text,
      '--from',
      'C:ionian',
      '--to',
      'dorian',
      '--accidentals',
      'preserve',
    );
    expect(keep.code).toBe(EXIT.OK);
    expect(keep.json.transform.strictTarget).toBe(false);
    expect(keep.json.warnings.map((w: { code: string }) => w.code)).toContain(
      'ACCIDENTALS_PRESERVED',
    );
    const reject = run(
      'remode',
      '--jianpu',
      text,
      '--from',
      'C:ionian',
      '--to',
      'dorian',
      '--accidentals',
      'reject',
    );
    expect(reject.code).toBe(EXIT.TRANSFORM_FAILED);
    expect(reject.json.errors[0]).toMatchObject({
      code: 'ACCIDENTAL_REJECTED',
      noteIds: ['jianpu:n1'],
    });
    expect(reject.written.size).toBe(0);
  });

  it('works on MIDI input with --track and keeps timing', () => {
    const r = run(
      'remode',
      'type0-multichannel.mid',
      '--track',
      '0',
      '--to',
      'aeolian',
      '-o',
      'a.mid',
    );
    expect(r.code).toBe(EXIT.OK);
    expect(r.json.sourceMode.name).toBe('D Dorian');
    expect(r.json.export.warnings.map((w: { code: string }) => w.code)).toContain('TRACKS_DROPPED');
    const back = importMidi(r.written.get('a.mid')!);
    if (!back.ok) throw new Error();
    expect(
      back.midi.tracks[0]!.notes.every((n) => [2, 4, 5, 7, 9, 10, 0].includes(n.pitch % 12)),
    ).toBe(true);
  });
});
