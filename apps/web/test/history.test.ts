import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importMidi, parseJianpu, type MelodyNote } from '@remode/core';
import { exportCustom } from '../src/lib/exportVariant';
import { draftMelody } from '../src/lib/draft';
import {
  HISTORY_LIMIT,
  activeVariant,
  initialState,
  reducer,
  targetMode,
  type Action,
  type ProjectState,
} from '../src/state/project';
import { loadExample } from './helpers';

const run = (...actions: Action[]): ProjectState => actions.reduce(reducer, initialState);
const C_IONIAN = { root: 0, scaleId: 'ionian' };

/** The jianpu example with C Ionian as the source and strict C Dorian generated. */
const strict = () =>
  run(
    { type: 'LOADED', input: loadExample() },
    { type: 'SET_SOURCE_OVERRIDE', mode: C_IONIAN },
    { type: 'GENERATE', createdAt: 1 },
  );

const timing = (notes: readonly MelodyNote[]) =>
  notes.map((n) => [n.id, n.startTick, n.durationTick, n.velocity]);

describe('custom variant', () => {
  it('generating switches the view to the generated variant', () => {
    const s = strict();
    expect(s.view).toBe('generated');
    expect(activeVariant(s)?.diff).toHaveLength(5);
    expect(targetMode(s)).toMatchObject({ root: 0, scaleId: 'dorian', name: 'C Dorian' });
  });

  it('editing from the generated view forks custom and records MANUAL_EDIT', () => {
    const s0 = strict();
    const id = s0.original!.notes[0]!.id; // C4
    const s = reducer(s0, { type: 'EDIT_PITCH', noteId: id, toPitch: 62, createdAt: 5 });
    expect(s.view).toBe('custom');
    expect(s.custom?.forkedFrom).toBe('generated');
    expect(s.custom?.edits).toEqual([
      expect.objectContaining({
        noteId: id,
        fromPitch: 60,
        toPitch: 62,
        reasonCode: 'MANUAL_EDIT',
      }),
    ]);
    const changes = s.custom!.variant.changes;
    expect(changes).toHaveLength(6); // the 5 strict E→Eb plus the edit
    expect(changes.find((c) => c.noteId === id)).toMatchObject({
      fromPitch: 60,
      toPitch: 62,
      reasonCode: 'MANUAL_EDIT',
    });
    expect(changes.filter((c) => c.reasonCode === 'DEGREE_MAPPED')).toHaveLength(5);
    expect(timing(s.custom!.variant.notes)).toEqual(timing(s.original!.notes));
    expect(s.custom!.variant.transform).toMatchObject({
      operation: 'manual-edit',
      version: 'remode-manual/1.0.0',
      forkedFrom: 'generated',
    });
    // Strict itself is untouched.
    expect(s.generated).toBe(s0.generated);
  });

  it('reverting a note removes its change; editing back to the original pitch is not a change', () => {
    const s0 = strict();
    const e = s0.original!.notes.find((n) => n.pitch === 64)!;
    const s = reducer(s0, { type: 'REVERT_NOTE', noteId: e.id, createdAt: 2 });
    expect(s.custom!.variant.notes.find((n) => n.id === e.id)?.pitch).toBe(64);
    expect(s.custom!.variant.changes).toHaveLength(4);
    expect(s.custom!.edits[0]?.explanation).toMatch(/Reverted/);
  });

  it('恢复原样 makes custom an unedited copy of the original, undoably', () => {
    const s0 = reducer(strict(), {
      type: 'EDIT_PITCH',
      noteId: 'jianpu:n0',
      toPitch: 62,
      createdAt: 2,
    });
    const s = reducer(s0, { type: 'RESTORE_ORIGINAL', createdAt: 3 });
    expect(s.custom?.forkedFrom).toBe('original');
    expect(s.custom?.variant.changes).toEqual([]);
    expect(s.custom?.variant.notes.map((n) => n.pitch)).toEqual(
      s.original!.notes.map((n) => n.pitch),
    );
    expect(reducer(s, { type: 'UNDO' }).custom).toBe(s0.custom);
  });

  it('custom MIDI keeps the ticks, changes only edited pitches and is named per §11.1', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_SOURCE_OVERRIDE', mode: C_IONIAN },
      { type: 'GENERATE', createdAt: 1 },
      { type: 'EDIT_PITCH', noteId: 'jianpu:n0', toPitch: 62, createdAt: 2 },
    );
    const out = exportCustom(s.original!, s.custom!);
    if (!out.ok) throw new Error(JSON.stringify(out.errors));
    expect(out.fileName).toBe('melody-C-dorian-custom.mid');
    const back = importMidi(out.bytes);
    if (!back.ok) throw new Error(back.error.message);
    const notes = back.midi.tracks[0]!.notes;
    expect(notes.map((n) => [n.startTick, n.durationTick])).toEqual(
      s.original!.notes.map((n) => [n.startTick, n.durationTick]),
    );
    expect(notes.map((n) => n.pitch)).toEqual(s.custom!.variant.notes.map((n) => n.pitch));

    const fromOriginal = reducer(s, { type: 'RESTORE_ORIGINAL', createdAt: 3 });
    const o = exportCustom(fromOriginal.original!, fromOriginal.custom!);
    expect(o.fileName).toBe('melody-custom.mid');
  });

  it('a target change keeps custom and falls back from the vanished generated view', () => {
    const s = run(
      { type: 'LOADED', input: loadExample() },
      { type: 'SET_SOURCE_OVERRIDE', mode: C_IONIAN },
      { type: 'GENERATE', createdAt: 1 },
      { type: 'SET_TARGET', patch: { scaleId: 'phrygian' } },
    );
    expect(s.generated).toBeNull();
    expect(s.view).toBe('original');
    expect(reducer(s, { type: 'SET_VIEW', view: 'generated' }).view).toBe('original');
  });
});

describe('undo / redo', () => {
  it('undoes and redoes edits, target changes and generation in order', () => {
    const s1 = strict();
    const s2 = reducer(s1, { type: 'EDIT_PITCH', noteId: 'jianpu:n0', toPitch: 62, createdAt: 2 });
    const s3 = reducer(s2, { type: 'SET_TARGET', patch: { scaleId: 'aeolian' } });
    expect(s3.history.past).toHaveLength(4); // override, generate, edit, target

    const u1 = reducer(s3, { type: 'UNDO' });
    expect(u1.target.scaleId).toBe('dorian');
    expect(u1.generated).toBe(s2.generated);
    const u2 = reducer(u1, { type: 'UNDO' });
    expect(u2.custom).toBeNull();
    expect(u2.view).toBe('generated');
    const r1 = reducer(u2, { type: 'REDO' });
    expect(r1.custom).toBe(s2.custom);
    expect(r1.view).toBe('custom');
    // A new edit drops the redo branch.
    const branch = reducer(u2, { type: 'SET_TARGET', patch: { scaleId: 'lydian' } });
    expect(branch.history.future).toEqual([]);
    expect(reducer(branch, { type: 'REDO' })).toBe(branch);
  });

  it('view, selection and snapping are not undo steps; no-ops are not recorded', () => {
    const s = strict();
    const n = s.history.past.length;
    const s2 = [
      { type: 'SET_VIEW', view: 'original' },
      { type: 'SELECT_NOTE', noteId: 'jianpu:n3' },
      { type: 'SET_SNAP', snap: false },
      { type: 'SET_TARGET', patch: { scaleId: 'dorian' } },
      { type: 'EDIT_PITCH', noteId: 'nope', toPitch: 60, createdAt: 1 },
    ].reduce((st, a) => reducer(st, a as Action), s);
    expect(s2.history.past).toHaveLength(n);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    let s = strict();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      s = reducer(s, {
        type: 'EDIT_PITCH',
        noteId: 'jianpu:n0',
        toPitch: 60 + (i % 2) + 1,
        createdAt: i,
      });
    }
    expect(s.history.past).toHaveLength(HISTORY_LIMIT);
  });

  it('loading something else clears the history', () => {
    const s = reducer(strict(), { type: 'LOADED', input: loadExample() });
    expect(s.history).toEqual({ past: [], future: [] });
    expect(s.custom).toBeNull();
  });
});

describe('invariants under random edits (fast-check)', () => {
  it('the original never changes and every variant keeps IDs, ticks and velocity (Invariant B)', () => {
    const base = strict();
    const original = base.original!;
    const before = JSON.stringify(original);
    const ids = original.notes.map((n) => n.id);
    const action = fc.oneof(
      fc
        .record({ k: fc.nat({ max: ids.length - 1 }), p: fc.integer({ min: -5, max: 132 }) })
        .map(({ k, p }): Action => ({
          type: 'EDIT_PITCH',
          noteId: ids[k]!,
          toPitch: p,
          createdAt: 0,
        })),
      fc
        .nat({ max: ids.length - 1 })
        .map((k): Action => ({ type: 'REVERT_NOTE', noteId: ids[k]!, createdAt: 0 })),
      fc.constant<Action>({ type: 'UNDO' }),
      fc.constant<Action>({ type: 'REDO' }),
      fc.constant<Action>({ type: 'RESTORE_ORIGINAL', createdAt: 0 }),
      fc.constant<Action>({ type: 'GENERATE', createdAt: 0 }),
      fc
        .constantFrom('original', 'generated', 'custom')
        .map((view): Action => ({ type: 'SET_VIEW', view })),
      fc
        .constantFrom('dorian', 'phrygian', 'pentatonic-zhi', 'yanyue-yu')
        .map((scaleId): Action => ({ type: 'SET_TARGET', patch: { scaleId } })),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 60 }), (actions) => {
        let s = base;
        for (const a of actions) {
          s = reducer(s, a);
          expect(s.original).toBe(original);
          for (const v of [s.custom?.variant, s.generated?.ok ? s.generated.variant : null]) {
            if (!v) continue;
            expect(timing(v.notes)).toEqual(timing(original.notes));
            expect(
              v.notes.every((n) => Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127),
            ).toBe(true);
            // Every listed change matches the notes, and every changed note is listed.
            const changed = v.notes.filter((n, i) => n.pitch !== original.notes[i]!.pitch);
            expect(v.changes.map((c) => c.noteId).sort()).toEqual(changed.map((n) => n.id).sort());
          }
          expect(s.history.past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
        }
        expect(JSON.stringify(original)).toBe(before);
        expect(Object.isFrozen(original.notes[0])).toBe(true);
      }),
      { seed: 20261103, numRuns: 150 },
    );
  });
});

describe('new-melody mode', () => {
  const draftOf = (...actions: Action[]) =>
    actions.reduce(reducer, reducer(initialState, { type: 'NEW_MELODY' }));

  it('adds, moves, resizes and deletes notes on the grid without overlaps', () => {
    let s = draftOf(
      { type: 'DRAFT_ADD', pitch: 60, startTick: 0 },
      { type: 'DRAFT_ADD', pitch: 62, startTick: 240 },
      { type: 'DRAFT_ADD', pitch: 64, startTick: 120 }, // overlaps: refused
    );
    expect(s.draft!.notes.map((n) => [n.pitch, n.startTick, n.durationTick])).toEqual([
      [60, 0, 240],
      [62, 240, 240],
    ]);
    expect(s.selectedNoteId).toBe('draft:1');
    s = reducer(s, { type: 'DRAFT_UPDATE', noteId: 'draft:1', patch: { durationTick: 720 } });
    s = reducer(s, { type: 'DRAFT_UPDATE', noteId: 'draft:0', patch: { durationTick: 480 } }); // would overlap
    expect(s.draft!.notes.map((n) => n.durationTick)).toEqual([240, 720]);
    s = reducer(s, { type: 'DRAFT_DELETE', noteId: 'draft:0' });
    expect(s.draft!.notes).toHaveLength(1);
    expect(reducer(s, { type: 'UNDO' }).draft!.notes).toHaveLength(2);
  });

  it('finishing makes the draft the frozen Original and analyses it', () => {
    const pitches = [60, 62, 64, 67, 69, 67, 64, 62, 60];
    const s = draftOf(
      ...pitches.map((p, i): Action => ({
        type: 'DRAFT_ADD',
        pitch: p,
        startTick: i * 480,
        durationTick: 480,
      })),
      { type: 'DRAFT_SETTINGS', patch: { keyPc: 0, bpm: 100 } },
      { type: 'DRAFT_FINISH' },
    );
    expect(s.draft).toBeNull();
    expect(s.input?.kind).toBe('new');
    expect(s.original?.notes.map((n) => n.id)).toEqual(pitches.map((_, k) => `new:n${k}`));
    expect(Object.isFrozen(s.original?.notes[0])).toBe(true);
    expect(s.original?.metadata.tempoMap).toEqual([{ tick: 0, bpm: 100 }]);
    expect(s.analysis?.candidates.length).toBeGreaterThan(0);
    expect(s.history.past).toEqual([]);
  });

  it('an empty draft cannot be finished; cancel returns to the empty workbench', () => {
    const s = draftOf();
    expect(reducer(s, { type: 'DRAFT_FINISH' })).toBe(s);
    expect(reducer(s, { type: 'DRAFT_CANCEL' }).draft).toBeNull();
  });

  it('the finished draft round-trips through jianpu text', async () => {
    const { writeJianpu } = await import('@remode/core');
    const s = draftOf(
      { type: 'DRAFT_ADD', pitch: 67, startTick: 0, durationTick: 720 },
      { type: 'DRAFT_ADD', pitch: 66, startTick: 720, durationTick: 240 },
      { type: 'DRAFT_ADD', pitch: 64, startTick: 1440, durationTick: 960 },
      { type: 'DRAFT_SETTINGS', patch: { keyPc: 7 } },
    );
    const m = draftMelody(s.draft!);
    const r = writeJianpu(m.notes, m.metadata, { keyPitchClass: 7 });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.text).toBe('1=G 4/4 bpm=96\n| 1. 7,_ 0 6, | - |\n');
    const back = parseJianpu(r.text);
    expect(back.ok && back.notes.map((n) => [n.pitch, n.startTick, n.durationTick])).toEqual(
      m.notes.map((n) => [n.pitch, n.startTick, n.durationTick]),
    );
  });
});
