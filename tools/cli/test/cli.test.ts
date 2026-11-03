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
    expect(r.stderr).toMatch(/MIDI input has nothing to convert/);
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
