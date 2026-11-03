// Property-based checks of the core invariants (spec §12.1, §12.3) for
// transpose and strict remode on random monophonic melodies.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SCALES,
  getScale,
  mod,
  strictRemode,
  transpose,
  type MelodyNote,
  type PitchRange,
} from '../src/index.js';

const SEED = { seed: 20261103, numRuns: 300 };

/** Monophonic melody: consecutive notes, random gaps, 0..127 pitches. */
const melody = (pitch = fc.integer({ min: 0, max: 127 })) =>
  fc
    .array(
      fc.record({
        pitch,
        gap: fc.integer({ min: 0, max: 960 }),
        durationTick: fc.integer({ min: 1, max: 1920 }),
        velocity: fc.integer({ min: 1, max: 127 }).map((v) => v / 127),
      }),
      { maxLength: 40 },
    )
    .map((raw) => {
      let tick = 0;
      return raw.map((r, i): MelodyNote => {
        const startTick = tick + r.gap;
        tick = startTick + r.durationTick;
        return {
          id: `p${i}`,
          pitch: r.pitch,
          startTick,
          durationTick: r.durationTick,
          velocity: r.velocity,
        };
      });
    });

const scaleId = fc.constantFrom(...SCALES.map((s) => s.id));
const softRange: fc.Arbitrary<PitchRange | null | undefined> = fc.constantFrom(undefined, null, {
  low: 36,
  high: 96,
});

const timing = (notes: readonly MelodyNote[]) =>
  notes.map(({ id, startTick, durationTick, velocity }) => ({
    id,
    startTick,
    durationTick,
    velocity,
  }));

const deepFreeze = (notes: MelodyNote[]) => {
  notes.forEach((n) => Object.freeze(n));
  return Object.freeze(notes);
};

describe('transpose properties', () => {
  it('A, B, C: no mutation, timing untouched, pitches valid; intervals kept', () => {
    fc.assert(
      fc.property(melody(), fc.integer({ min: -60, max: 60 }), softRange, (notes, n, range) => {
        const before = structuredClone(notes);
        const r = transpose(
          deepFreeze(notes),
          n,
          range === undefined ? { createdAt: 0 } : { createdAt: 0, softRange: range },
        );
        expect(notes).toEqual(before); // A
        if (!r.ok) {
          expect(r.errors.map((e) => e.code)).toEqual(['PITCH_OUT_OF_RANGE']);
          return;
        }
        const out = r.variant.notes;
        expect(timing(out)).toEqual(timing(notes)); // B
        for (const x of out)
          expect(Number.isInteger(x.pitch) && x.pitch >= 0 && x.pitch <= 127).toBe(true); // C
        out.forEach((x, i) => expect(x.pitch - notes[i]!.pitch - n).toBe(r.range.shift));
        expect(mod(r.range.shift, 12)).toBe(0);
      }),
      SEED,
    );
  });
});

describe('strict remode properties', () => {
  it('A, B, C, D on random melodies, scales, roots and ranges', () => {
    fc.assert(
      fc.property(
        melody(),
        fc.integer({ min: 0, max: 11 }),
        scaleId,
        scaleId,
        softRange,
        (notes, root, from, to, range) => {
          const before = structuredClone(notes);
          const r = strictRemode(
            deepFreeze(notes),
            { root, scaleId: from },
            { scaleId: to },
            range === undefined ? { createdAt: 0 } : { createdAt: 0, softRange: range },
          );
          expect(notes).toEqual(before); // A
          if (!r.ok) {
            expect(r.errors.map((e) => e.code)).toEqual(['PITCH_OUT_OF_RANGE']);
            return;
          }
          const out = r.variant.notes;
          expect(out).not.toBe(notes);
          expect(timing(out)).toEqual(timing(notes)); // B
          const target = getScale(to);
          for (const x of out) {
            expect(Number.isInteger(x.pitch) && x.pitch >= 0 && x.pitch <= 127).toBe(true); // C
            expect(target.intervals).toContain(mod(x.pitch - root, 12)); // D
          }
          // Every changed note, and only those, has a PitchChange with a reason.
          const changed = out.filter((x, i) => x.pitch !== notes[i]!.pitch).map((x) => x.id);
          expect(r.variant.changes.map((c) => c.noteId)).toEqual(changed);
          for (const c of r.variant.changes) expect(c.reasonCode).toBeTruthy();
          // Strict never moves a note further than the range shift plus a third.
          out.forEach((x, i) =>
            expect(Math.abs(x.pitch - notes[i]!.pitch - r.report.range.shift)).toBeLessThanOrEqual(
              3,
            ),
          );
        },
      ),
      SEED,
    );
  });

  it('F: heptatonic → heptatonic changes exactly the in-scale notes on differing degrees', () => {
    const heptatonic = SCALES.filter((s) => s.intervals.length === 7).map((s) => s.id);
    fc.assert(
      fc.property(
        melody(fc.integer({ min: 24, max: 103 })),
        fc.integer({ min: 0, max: 11 }),
        fc.constantFrom(...heptatonic),
        fc.constantFrom(...heptatonic),
        (notes, root, from, to) => {
          const src = getScale(from);
          const tgt = getScale(to);
          const r = strictRemode(notes, { root, scaleId: from }, { scaleId: to }, { createdAt: 0 });
          if (!r.ok) throw new Error(JSON.stringify(r.errors));
          expect(r.report.range.shift).toBe(0);
          notes.forEach((n, i) => {
            const degree = src.intervals.indexOf(mod(n.pitch - root, 12));
            if (degree < 0) return; // accidentals follow their own policy
            const differs = src.intervals[degree] !== tgt.intervals[degree];
            expect(r.variant.notes[i]!.pitch !== n.pitch).toBe(differs);
            expect(r.variant.notes[i]!.pitch - n.pitch).toBe(
              tgt.intervals[degree]! - src.intervals[degree]!,
            );
          });
        },
      ),
      SEED,
    );
  });
});
