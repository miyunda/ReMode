import type { TimeSignatureEvent } from '../types.js';

export type MetricWeight = 'downbeat' | 'secondary' | 'weak';

/**
 * Metric weight of an onset under the time-signature map. Assumes signature
 * changes fall on bar lines and the melody has no anacrusis offset.
 * Secondary strong beats: beat 3 of 4/x, and the first beat of each later
 * three-beat group in compound 6/x, 9/x and 12/x.
 */
export function metricWeight(
  tick: number,
  ppq: number,
  timeSignatures: readonly TimeSignatureEvent[],
): MetricWeight {
  let ts: TimeSignatureEvent = { tick: 0, numerator: 4, denominator: 4 };
  for (const e of timeSignatures) {
    if (e.tick <= tick) ts = e;
    else break;
  }
  const beatTicks = (ppq * 4) / ts.denominator;
  const barTicks = beatTicks * ts.numerator;
  const pos = (tick - ts.tick) % barTicks;
  if (pos === 0) return 'downbeat';
  const beat = pos / beatTicks;
  if (!Number.isInteger(beat)) return 'weak';
  if (ts.numerator === 4 && beat === 2) return 'secondary';
  if ([6, 9, 12].includes(ts.numerator) && beat % 3 === 0) return 'secondary';
  return 'weak';
}
