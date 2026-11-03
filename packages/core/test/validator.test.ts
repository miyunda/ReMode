import { describe, expect, it } from 'vitest';
import {
  legatoToleranceTicks,
  repairLegatoOverlaps,
  validateMelody,
  type MelodyNote,
} from '../src/index.js';
import { notesOf } from './helpers.js';

const meta = { ppq: 480, tempoMap: [{ tick: 0, bpm: 120 }] };

describe('validateMelody', () => {
  it('accepts a clean monophonic line', () => {
    const r = validateMelody(
      notesOf([
        [60, 0, 1],
        [62, 1, 1],
        [64, 2, 2],
      ]),
      meta,
    );
    expect(r).toMatchObject({ ok: true, monophonic: true, issues: [] });
  });

  it('tolerance is min(15 ms in ticks, PPQ/16) at the local tempo', () => {
    expect(legatoToleranceTicks(meta, 0)).toBe(14); // 1.0417 ms per tick
    const slow = { ppq: 480, tempoMap: [{ tick: 0, bpm: 30 }] };
    expect(legatoToleranceTicks(slow, 0)).toBe(3); // 4.1667 ms per tick
    const fast = {
      ppq: 480,
      tempoMap: [
        { tick: 0, bpm: 120 },
        { tick: 960, bpm: 480 },
      ],
    };
    expect(legatoToleranceTicks(fast, 960)).toBe(30); // tick cap wins
  });

  it('finds overlaps against the running maximum end, not just the previous note', () => {
    // C4 whole note; E4 and G4 both start under it; G4 does not overlap E4.
    const notes = notesOf([
      [60, 0, 4],
      [64, 1, 1],
      [67, 2, 1],
    ]);
    const r = validateMelody(notes, meta);
    const overlaps = r.issues.filter((x) => x.code === 'OVERLAP');
    expect(overlaps).toHaveLength(2);
    expect(overlaps.map((x) => x.noteIds[0])).toEqual([notes[0]!.id, notes[0]!.id]);
    expect(overlaps.every((x) => x.repairable === false && x.severity === 'error')).toBe(true);
  });

  it('reports same-tick chords and duplicates, never as repairable', () => {
    const chord = validateMelody(
      notesOf([
        [60, 0, 1],
        [64, 0, 1],
      ]),
      meta,
    );
    expect(chord.issues.map((x) => x.code)).toEqual(['SAME_TICK_CHORD']);
    const dup = validateMelody(
      notesOf([
        [60, 0, 1],
        [60, 0, 1],
      ]),
      meta,
    );
    expect(dup.issues.map((x) => x.code)).toEqual(['DUPLICATE_NOTE']);
  });

  it('rejects invalid notes without letting them reach overlap checks', () => {
    const bad: MelodyNote[] = [
      { id: 'a', pitch: 128, startTick: 0, durationTick: 10, velocity: 0.5 },
      { id: 'b', pitch: 60, startTick: 0, durationTick: 0, velocity: 0.5 },
      { id: 'c', pitch: 60.5, startTick: 0, durationTick: 10, velocity: 0.5 },
      { id: 'd', pitch: 60, startTick: Number.NaN, durationTick: 10, velocity: 0.5 },
      { id: 'e', pitch: 60, startTick: 0, durationTick: 10, velocity: Infinity },
    ];
    const r = validateMelody(bad, meta);
    expect(r.issues.map((x) => x.code)).toEqual([
      'INVALID_PITCH',
      'INVALID_DURATION',
      'INVALID_PITCH',
      'INVALID_START',
      'INVALID_VELOCITY',
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('repairLegatoOverlaps', () => {
  it('trims only repairable legato tails, records each change, and never mutates input', () => {
    const notes = notesOf([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 1],
      [65, 3, 1],
    ]);
    notes[0] = { ...notes[0]!, durationTick: 485 }; // 5-tick legato tail → repairable
    notes[2] = { ...notes[2]!, durationTick: 720 }; // 240-tick overlap → not repairable
    const frozen = notes.map((n) => Object.freeze({ ...n }));
    const report = validateMelody(frozen, meta);
    const cleaned = repairLegatoOverlaps(frozen, report);

    expect(cleaned.kind).toBe('cleaned-source');
    expect(cleaned.repairs).toEqual([
      expect.objectContaining({ noteId: notes[0]!.id, from: 485, to: 480, causedBy: notes[1]!.id }),
    ]);
    expect(cleaned.unrepaired.map((x) => x.code)).toEqual(['OVERLAP']);
    expect(frozen[0]!.durationTick).toBe(485);
    expect(cleaned.notes[0]!.durationTick).toBe(480);
    // Only durationTick of the repaired note changes; ids, pitches, starts, velocities stay.
    cleaned.notes.forEach((n, i) => {
      const src = frozen[i]!;
      expect({ ...n, durationTick: 0 }).toEqual({ ...src, durationTick: 0 });
    });
    const after = validateMelody(cleaned.notes, meta);
    expect(after.issues.filter((x) => x.repairable)).toEqual([]);
  });
});
