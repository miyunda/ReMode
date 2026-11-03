import type { MidiMetadata } from '@remode/core';

/** "小节.拍" (both 1-based; fractional beats to two places) from the time-signature map. */
export function barBeat(tick: number, meta: Pick<MidiMetadata, 'ppq' | 'timeSignatures'>): string {
  const sigs = [...meta.timeSignatures].sort((a, b) => a.tick - b.tick);
  let bar = 1;
  let at = 0;
  let sig = sigs[0] ?? { tick: 0, numerator: 4, denominator: 4 };
  for (const next of sigs.slice(1)) {
    if (next.tick > tick) break;
    const beatTicks = (meta.ppq * 4) / sig.denominator;
    bar += Math.ceil((next.tick - at) / (beatTicks * sig.numerator));
    at = next.tick;
    sig = next;
  }
  const beatTicks = (meta.ppq * 4) / sig.denominator;
  const barTicks = beatTicks * sig.numerator;
  const rel = tick - at;
  bar += Math.floor(rel / barTicks);
  const beat = (rel % barTicks) / beatTicks + 1;
  return `${bar}.${Number.isInteger(beat) ? beat : beat.toFixed(2)}`;
}

/** Ticks as quarter-note beats, without trailing zeros. */
export const beats = (ticks: number, ppq: number): string => {
  const b = ticks / ppq;
  return Number.isInteger(b) ? `${b}` : b.toFixed(2).replace(/0+$/, '');
};

export const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
