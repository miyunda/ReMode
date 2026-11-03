import { describe, expect, it } from 'vitest';
import { exportMidi, importMidi } from '@remode/core';
import { WEB_LIMITS } from '../src/lib/limits';
import { exportGenerated } from '../src/lib/exportVariant';
import { loadBytes, loadJianpuText } from '../src/lib/loadInput';
import {
  initialState,
  reducer,
  sourceMode,
  type Action,
  type ProjectState,
} from '../src/state/project';
import { fixtureBytes, loadExample, loadFixture } from './helpers';

const run = (...actions: Action[]): ProjectState => actions.reduce(reducer, initialState);
const C_IONIAN = { root: 0, scaleId: 'ionian' };

describe('loading', () => {
  it('auto-selects jianpu input, freezes the original and analyses it', () => {
    const s = run({ type: 'LOADED', input: loadExample() });
    expect(s.trackId).toBe('jianpu');
    expect(s.validation?.ok).toBe(true);
    expect(s.original?.notes).toHaveLength(21);
    expect(Object.isFrozen(s.original)).toBe(true);
    expect(Object.isFrozen(s.original?.notes)).toBe(true);
    expect(Object.isFrozen(s.original?.notes[0])).toBe(true);
    expect(s.analysis?.ambiguities.map((a) => a.code)).toEqual(['MISSING_DEGREES']);
    expect(s.analysis?.candidates[0]?.name).toBe('C 宫调式（C 宫系统，五声）');
    // MISSING_DEGREES alone does not block the rank-1 mode (same rule as the CLI).
    expect(sourceMode(s)).toMatchObject({ ok: true, via: 'analysis' });
  });

  it('requires an explicit track choice when several candidates exist', () => {
    const input = loadFixture('type0-multichannel.mid');
    expect(input.kind === 'midi' && input.candidates.length).toBe(2);
    const s = run({ type: 'LOADED', input });
    expect(s.trackId).toBeNull();
    expect(s.original).toBeNull();
    const picked = reducer(s, { type: 'SELECT_TRACK', trackId: 'track-0' });
    expect(picked.original?.trackId).toBe('track-0');
    expect(picked.analysis?.candidates[0]).toMatchObject({ rootPitchClass: 2, scaleId: 'dorian' });
  });

  it('auto-selects the only candidate even with empty and percussion tracks', () => {
    const s = run({ type: 'LOADED', input: loadFixture('type1-empty-percussion.mid') });
    expect(s.trackId).toBe('track-2');
    expect(s.original).not.toBeNull();
  });

  it('reports structured import and jianpu errors', () => {
    const midi = loadBytes(fixtureBytes('malformed-not-midi.mid'), 'malformed-not-midi.mid');
    expect(midi).toMatchObject({
      ok: false,
      failure: { stage: 'midi', errors: [{ code: 'NOT_MIDI' }] },
    });
    const text = loadJianpuText('1=C 4/4\n| 1 2 (3 4) |', null);
    expect(text).toMatchObject({
      ok: false,
      failure: {
        stage: 'jianpu',
        errors: [
          { code: 'UNSUPPORTED_TUPLET', line: 2, column: 7 },
          { code: 'UNSUPPORTED_TUPLET', line: 2, column: 11 },
        ],
      },
    });
    const other = loadBytes(new Uint8Array([1, 2, 3]), 'notes.pdf');
    expect(other).toMatchObject({
      ok: false,
      failure: { errors: [{ code: 'UNSUPPORTED_FILE_TYPE' }] },
    });
  });

  it('refuses files over the size limit before parsing', () => {
    const r = loadBytes(new Uint8Array(10), 'x.mid', {
      maxFileBytes: 5,
      maxNotes: 10,
      maxMelodyNotes: 10,
      maxJianpuChars: 10,
    });
    expect(r).toMatchObject({
      ok: false,
      failure: { stage: 'file', errors: [{ code: 'FILE_TOO_LARGE' }] },
    });
  });

  it('refuses a selected melody over the melody note limit with MELODY_TOO_LONG', () => {
    const n = WEB_LIMITS.maxMelodyNotes + 1;
    const notes = Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      pitch: 60 + (i % 5),
      startTick: i * 120,
      durationTick: 120,
      velocity: 0.75,
    }));
    const meta = {
      ppq: 480,
      tempoMap: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    };
    const out = exportMidi(notes, meta);
    if (!out.ok) throw new Error('export failed');
    const r = loadBytes(out.bytes, 'long.mid');
    if (!r.ok) throw new Error('load failed');
    const s = run({ type: 'LOADED', input: r.input });
    expect(s.limitError?.code).toBe('MELODY_TOO_LONG');
    expect(s.original).toBeNull();
  });

  it('LOAD_FAILED clears the previous project but keeps target settings', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_TARGET', patch: { scaleId: 'lydian' } },
      {
        type: 'LOAD_FAILED',
        failure: {
          stage: 'file',
          fileName: 'x',
          errors: [{ code: 'READ_FAILED', message: '' }],
          warnings: [],
        },
      },
    );
    expect(s.original).toBeNull();
    expect(s.loadFailure?.errors[0]?.code).toBe('READ_FAILED');
    expect(s.target.scaleId).toBe('lydian');
  });
});

describe('legato repair (explicit opt-in)', () => {
  it('previews the repair, applies it only on opt-in, and leaves the input untouched', () => {
    const input = loadFixture('overlap-legato.mid');
    const before = run({ type: 'LOADED', input });
    expect(before.repairPreview?.repairs).toHaveLength(1);
    expect(before.original?.cleaned).toBe(false);
    const repair = before.repairPreview!.repairs[0]!;
    const held = before.original!.notes.find((n) => n.id === repair.noteId)!;
    expect(held.durationTick).toBe(repair.from);

    const after = reducer(before, { type: 'SET_REPAIR', repair: true });
    expect(after.original?.cleaned).toBe(true);
    expect(after.original!.notes.find((n) => n.id === repair.noteId)!.durationTick).toBe(repair.to);
    // The parsed track is never modified.
    const track = input.kind === 'midi' ? input.midi.tracks[0]! : null;
    expect(track!.notes.find((n) => n.id === repair.noteId)!.durationTick).toBe(repair.from);
  });

  it('blocks analysis when errors remain', () => {
    const s = run({ type: 'LOADED', input: loadFixture('overlap-heavy.mid') });
    expect(s.validation?.ok).toBe(false);
    expect(s.original).toBeNull();
    expect(s.analysis).toBeNull();
  });
});

describe('source mode', () => {
  it('a manual choice overrides the analysis and is marked as manual', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_SOURCE_OVERRIDE', mode: C_IONIAN },
    );
    expect(sourceMode(s)).toEqual({ ok: true, mode: C_IONIAN, name: 'C Ionian', via: 'manual' });
    expect(sourceMode(reducer(s, { type: 'SET_SOURCE_OVERRIDE', mode: null }))).toMatchObject({
      via: 'analysis',
    });
  });

  it('is undetermined for an ambiguous tonic, and remode refuses until it is set', () => {
    const s = run(
      { type: 'LOADED', input: loadFixture('tonic-unclear-pentatonic.mid') },
      { type: 'GENERATE', createdAt: 1 },
    );
    expect(sourceMode(s)).toMatchObject({ ok: false });
    expect((sourceMode(s) as { reasons: string[] }).reasons).toContain('TONIC_UNCLEAR');
    expect(s.generated).toMatchObject({ ok: false, errors: [{ code: 'SOURCE_MODE_AMBIGUOUS' }] });
  });
});

describe('generate', () => {
  it('strict C Ionian → C Dorian changes pitches only and keeps the original', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_SOURCE_OVERRIDE', mode: C_IONIAN },
      {
        type: 'SET_TARGET',
        patch: { operation: 'parallel-remode', scaleId: 'dorian', root: null },
      },
      { type: 'GENERATE', createdAt: 42 },
    );
    const g = s.generated;
    if (!g?.ok || g.operation !== 'parallel-remode') throw new Error('expected a remode');
    expect(g.target.name).toBe('C Dorian');
    expect(g.source.via).toBe('manual');
    expect(g.variant.createdAt).toBe(42);
    expect(g.diff).toHaveLength(5);
    expect(g.diff.every((d) => d.from === 'E4' && d.to === 'Eb4')).toBe(true);
    expect(g.recheck.recognised).toBe(true);
    const original = s.original!;
    expect(original.notes.map((n) => n.pitch)).toContain(64);
    g.variant.notes.forEach((n, i) => {
      const o = original.notes[i]!;
      expect([n.id, n.startTick, n.durationTick, n.velocity]).toEqual([
        o.id,
        o.startTick,
        o.durationTick,
        o.velocity,
      ]);
    });
  });

  it('reports NO_CHARACTERISTIC_DEGREE when the melody lacks the differing degrees', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_SOURCE_OVERRIDE', mode: C_IONIAN },
      { type: 'SET_TARGET', patch: { scaleId: 'lydian' } },
      { type: 'GENERATE', createdAt: 1 },
    );
    expect(s.generated?.ok && s.generated.warnings.map((w) => w.code)).toContain(
      'NO_CHARACTERISTIC_DEGREE',
    );
  });

  it('changing settings discards a stale variant', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'GENERATE', createdAt: 1 },
      { type: 'SET_TARGET', patch: { scaleId: 'phrygian' } },
    );
    expect(s.generated).toBeNull();
  });

  it('transposes and exports a file that re-imports with identical ticks', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_TARGET', patch: { operation: 'transpose', semitones: -3 } },
      { type: 'GENERATE', createdAt: 1 },
    );
    const g = s.generated;
    if (!g?.ok || g.operation !== 'transpose') throw new Error('expected a transpose');
    expect(g.diff).toHaveLength(21);
    expect(g.recheck?.target.name).toBe('A 宫调式（A 宫系统，五声）');
    const out = exportGenerated(s.original!, g);
    if (!out.ok) throw new Error(JSON.stringify(out.errors));
    expect(out.fileName).toBe('melody-transpose-down3.mid');
    expect(out.report.keySignature.policy).toBe('omit');
    const back = importMidi(out.bytes);
    if (!back.ok) throw new Error(back.error.message);
    const notes = back.midi.tracks[0]!.notes;
    expect(notes.map((n) => [n.startTick, n.durationTick])).toEqual(
      s.original!.notes.map((n) => [n.startTick, n.durationTick]),
    );
    expect(notes.map((n) => n.pitch)).toEqual(g.variant.notes.map((n) => n.pitch));
  });

  it('remode export uses the mode key-signature policy and the §11.1 file name', () => {
    const input = loadFixture('mode-church-c-ionian.mid');
    const s = run({ type: 'LOADED', input }, { type: 'GENERATE', createdAt: 1 });
    const g = s.generated;
    if (!g?.ok) throw new Error('expected success');
    const out = exportGenerated(s.original!, g);
    if (!out.ok) throw new Error('export failed');
    expect(out.fileName).toBe('mode-church-c-ionian-C-dorian-strict.mid');
    expect(out.report.keySignature).toMatchObject({
      policy: 'mode',
      mode: { name: 'C Dorian' },
      written: [{ key: 'Bb', scale: 'major' }],
    });
  });
});
