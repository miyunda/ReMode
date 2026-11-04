// Tick ⇄ seconds through the tempo map (spec §4: ticks are the time base,
// seconds are always derived). Pure.

import type { TempoEvent } from '@remode/core';

/** The MIDI default before the first tempo event. */
export const DEFAULT_BPM = 120;

export interface Timeline {
  toSeconds(tick: number): number;
  toTick(seconds: number): number;
}

interface Point {
  tick: number;
  seconds: number;
  secondsPerTick: number;
}

export function buildTimeline(ppq: number, tempoMap: readonly TempoEvent[]): Timeline {
  const perTick = (bpm: number) => 60 / bpm / ppq;
  const events = tempoMap
    .filter((e) => Number.isFinite(e.bpm) && e.bpm > 0 && e.tick >= 0)
    .sort((a, b) => a.tick - b.tick);
  const points: Point[] = [{ tick: 0, seconds: 0, secondsPerTick: perTick(DEFAULT_BPM) }];
  for (const e of events) {
    const last = points[points.length - 1] as Point;
    if (e.tick === last.tick) last.secondsPerTick = perTick(e.bpm);
    else {
      points.push({
        tick: e.tick,
        seconds: last.seconds + (e.tick - last.tick) * last.secondsPerTick,
        secondsPerTick: perTick(e.bpm),
      });
    }
  }
  const find = (test: (p: Point) => boolean): Point => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (test(points[mid] as Point)) lo = mid;
      else hi = mid - 1;
    }
    return points[lo] as Point;
  };
  return {
    toSeconds(tick) {
      const p = find((x) => x.tick <= tick);
      return p.seconds + (tick - p.tick) * p.secondsPerTick;
    },
    toTick(seconds) {
      const p = find((x) => x.seconds <= seconds);
      return p.tick + (seconds - p.seconds) / p.secondsPerTick;
    },
  };
}
