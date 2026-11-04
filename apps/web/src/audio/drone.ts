// Tonic drone (spec §10.4, ADR-014): which pitches sound. Pure.

import { inMode, mod, type ModeRef } from '@remode/core';

export type DroneMode = 'tonic' | 'tonic-fifth';

/** Lowest drone root (G2): the root always sits in G2–F#3, below most melodies. */
export const DRONE_LOW = 43;

export function dronePitches(tonicPc: number, mode: DroneMode): number[] {
  const root = DRONE_LOW + mod(tonicPc - DRONE_LOW, 12);
  return mode === 'tonic' ? [root] : [root, root + 7];
}

/** The drone's fifth is always perfect; false when the mode itself has none (Locrian, 角). */
export const modeHasFifth = (mode: ModeRef): boolean => inMode(mode.root + 7, mode);
