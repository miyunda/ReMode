import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildTimeline, DEFAULT_BPM } from '../src/audio/timeline';

describe('timeline', () => {
  it('maps ticks to seconds across tempo changes', () => {
    const t = buildTimeline(480, [
      { tick: 0, bpm: 120 },
      { tick: 960, bpm: 60 },
      { tick: 1440, bpm: 240 },
    ]);
    expect(t.toSeconds(0)).toBe(0);
    expect(t.toSeconds(480)).toBeCloseTo(0.5);
    expect(t.toSeconds(960)).toBeCloseTo(1);
    expect(t.toSeconds(1200)).toBeCloseTo(1.5); // half a beat at 60 BPM
    expect(t.toSeconds(1440)).toBeCloseTo(2);
    expect(t.toSeconds(1920)).toBeCloseTo(2.25);
    expect(t.toTick(1.5)).toBeCloseTo(1200);
    expect(t.toTick(2.25)).toBeCloseTo(1920);
  });

  it('uses the MIDI default until the first tempo event, and ignores invalid ones', () => {
    const late = buildTimeline(480, [{ tick: 480, bpm: 60 }]);
    expect(late.toSeconds(480)).toBeCloseTo(60 / DEFAULT_BPM);
    expect(late.toSeconds(960)).toBeCloseTo(60 / DEFAULT_BPM + 1);
    expect(buildTimeline(480, []).toSeconds(480)).toBeCloseTo(0.5);
    const bad = buildTimeline(480, [
      { tick: 0, bpm: 0 },
      { tick: 0, bpm: Number.NaN },
    ]);
    expect(bad.toSeconds(480)).toBeCloseTo(0.5);
  });

  it('takes the last of several events on one tick and accepts unsorted maps', () => {
    const t = buildTimeline(480, [
      { tick: 480, bpm: 30 },
      { tick: 0, bpm: 60 },
      { tick: 0, bpm: 120 },
    ]);
    expect(t.toSeconds(480)).toBeCloseTo(0.5);
    expect(t.toSeconds(960)).toBeCloseTo(2.5);
  });

  it('is monotonic and round-trips for any tempo map', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ tick: fc.nat(10_000), bpm: fc.integer({ min: 20, max: 300 }) })),
        fc.array(fc.nat(20_000), { minLength: 2 }),
        (tempoMap, ticks) => {
          const t = buildTimeline(480, tempoMap);
          const sorted = [...ticks].sort((a, b) => a - b);
          for (let i = 1; i < sorted.length; i++)
            expect(t.toSeconds(sorted[i]!)).toBeGreaterThanOrEqual(t.toSeconds(sorted[i - 1]!));
          for (const tick of ticks) expect(t.toTick(t.toSeconds(tick))).toBeCloseTo(tick, 5);
        },
      ),
    );
  });
});
