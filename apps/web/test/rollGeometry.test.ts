import { describe, expect, it } from 'vitest';
import {
  GUTTER,
  RULER,
  fitView,
  gridLines,
  hitNote,
  pitchRange,
  pitchToY,
  tickToX,
  timeOrderOf,
  xToTick,
  yToPitch,
} from '../src/lib/rollGeometry';

const note = (pitch: number, startTick: number, durationTick = 480) => ({
  pitch,
  startTick,
  durationTick,
});

describe('roll geometry', () => {
  it('draws bars and beats from every time signature', () => {
    const meta = {
      ppq: 480,
      timeSignatures: [
        { tick: 0, numerator: 2, denominator: 4 },
        { tick: 1920, numerator: 6, denominator: 8 },
      ],
    };
    const lines = gridLines(meta, 0, 1920 + 1440 + 1);
    expect(lines.filter((l) => l.kind === 'bar').map((l) => [l.tick, l.bar])).toEqual([
      [0, 1],
      [960, 2],
      [1920, 3],
      [3360, 4],
    ]);
    // 6/8: beats every eighth (240 ticks) inside the bar.
    expect(lines.filter((l) => l.kind === 'beat' && l.tick > 1920).map((l) => l.tick)).toEqual([
      2160, 2400, 2640, 2880, 3120,
    ]);
    expect(gridLines({ ppq: 480, timeSignatures: [] }, 1900, 2000)).toEqual([
      { tick: 1920, kind: 'bar', bar: 2 },
    ]);
  });

  it('maps ticks and pitches to pixels and back', () => {
    const v = { pxPerTick: 0.1, rowH: 10, range: { lo: 48, hi: 72 }, scrollX: 20, scrollY: 30 };
    expect(tickToX(v, 480)).toBe(GUTTER + 48 - 20);
    expect(xToTick(v, tickToX(v, 960))).toBeCloseTo(960);
    expect(pitchToY(v, 72)).toBe(RULER - 30);
    expect(yToPitch(v, pitchToY(v, 60) + 5)).toBe(60);
    expect(yToPitch(v, -1000)).toBe(72);
  });

  it('pads the pitch range, keeps a minimum height, clamps to MIDI', () => {
    expect(pitchRange([60, 64])).toEqual({ lo: 48, hi: 76 });
    expect(pitchRange([60], 0, 5)).toEqual({ lo: 58, hi: 62 });
    expect(pitchRange([2, 126])).toEqual({ lo: 0, hi: 127 });
    expect(pitchRange([])).toEqual({ lo: 48, hi: 72 });
  });

  it('fits the melody: whole length across, used pitches down, within zoom limits', () => {
    const notes = [note(60, 0), note(67, 480 * 15)];
    const f = fitView(notes, { lo: 48, hi: 79 }, 480 * 16, 480, { width: 864, height: 400 });
    expect(f.pxPerTick).toBeCloseTo((864 - GUTTER - 8) / (480 * 16));
    expect(f.rowH).toBe(22);
    expect(f.scrollY).toBe((79 - 69) * 22);
    // A very long melody stops at 6 px per beat and scrolls instead.
    const long = fitView(notes, { lo: 48, hi: 79 }, 480 * 5000, 480, { width: 864, height: 400 });
    expect(long.pxPerTick).toBe(6 / 480);
  });

  it('hit-tests notes and orders them in time', () => {
    const notes = [note(62, 480), note(60, 0), note(60, 960, 240)];
    expect(hitNote(notes, 500, 62)).toBe(0);
    expect(hitNote(notes, 1000, 60)).toBe(2);
    expect(hitNote(notes, 1200, 60)).toBe(-1);
    expect(timeOrderOf(notes)).toEqual([1, 0, 2]);
  });
});
