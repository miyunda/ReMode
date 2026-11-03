/** Mathematical modulo; JS `%` keeps the dividend's sign (spec §7.2). */
export const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const pitchClass = (pitch: number): number => mod(pitch, 12);

const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const pitchClassName = (pc: number): string => PC_NAMES[mod(pc, 12)] as string;

/** Scientific pitch notation with MIDI 60 = C4. */
export const pitchName = (pitch: number): string =>
  `${pitchClassName(pitch)}${Math.floor(pitch / 12) - 1}`;

export const isValidMidiPitch = (pitch: number): boolean =>
  Number.isInteger(pitch) && pitch >= 0 && pitch <= 127;
