import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXIT, runCli } from '../src/cli.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));

function run(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = runCli(argv, {
    readFile: (p) => new Uint8Array(readFileSync(p.startsWith('/') ? p : `${FIXTURES}${p}`)),
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = stdout.startsWith('{') ? (JSON.parse(stdout) as any) : null;
  return { code, stdout, stderr, json };
}

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
    expect(run('--help').stdout).toMatch(/Usage: remode analyze/);
  });
});
