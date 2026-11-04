// Light synth voices (spec §10.4): oscillators only, so nothing is downloaded.

export type TimbreId = 'soft' | 'pluck' | 'reed';

export interface Timbre {
  id: TimbreId;
  label: string;
  oscillator: 'triangle' | 'square';
  envelope: { attack: number; decay: number; sustain: number; release: number };
  /** Square waves are much louder than triangles at the same amplitude. */
  level: number;
}

export const TIMBRES: readonly Timbre[] = [
  {
    id: 'soft',
    label: '柔和',
    oscillator: 'triangle',
    envelope: { attack: 0.012, decay: 0.12, sustain: 0.65, release: 0.16 },
    level: 0.5,
  },
  {
    id: 'pluck',
    label: '拨弦',
    oscillator: 'triangle',
    envelope: { attack: 0.003, decay: 0.45, sustain: 0.12, release: 0.12 },
    level: 0.6,
  },
  {
    id: 'reed',
    label: '簧片',
    oscillator: 'square',
    envelope: { attack: 0.02, decay: 0.08, sustain: 0.75, release: 0.1 },
    level: 0.16,
  },
];

export const timbreOf = (id: TimbreId): Timbre =>
  TIMBRES.find((t) => t.id === id) ?? (TIMBRES[0] as Timbre);
