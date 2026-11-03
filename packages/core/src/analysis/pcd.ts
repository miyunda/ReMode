import type { MelodyNote, PitchClassDistribution } from '../types.js';
import { pitchClass } from '../theory/pitch.js';

/** Duration-weighted pitch-class distribution, in ticks (spec §6.3 step 1). */
export function computePcd(notes: readonly MelodyNote[]): PitchClassDistribution {
  const durations = new Array<number>(12).fill(0);
  for (const note of notes) {
    const pc = pitchClass(note.pitch);
    durations[pc] = (durations[pc] as number) + note.durationTick;
  }
  const totalDuration = durations.reduce((a, b) => a + b, 0);
  const shares = durations.map((d) => (totalDuration > 0 ? d / totalDuration : 0));
  return { durations, shares, totalDuration, weighting: 'ticks' };
}
