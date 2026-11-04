// The only contract between the transport and the sound. Everything above this
// line (engine, UI, tests) is free of Tone.js; toneBackend.ts implements it and
// the unit tests use a fake, so scheduling is tested without a browser.

import type { TimbreId } from './timbres';

export interface NoteRequest {
  pitch: number;
  /** 0..1 */
  velocity: number;
  /** Start on the audio clock, seconds. */
  time: number;
  /** Seconds until the note is released. */
  duration: number;
}

export type VoiceId = number;

export interface Levels {
  /** 0..1 */
  master: number;
  /** 0..1, relative to master. */
  drone: number;
}

export interface AudioBackend {
  /** The audio clock, seconds. */
  now(): number;
  note(request: NoteRequest): VoiceId;
  /** A pending voice never sounds; a sounding one fades out at once. Unknown voices are ignored. */
  cancel(voice: VoiceId): void;
  /** Sustained pitches, replacing what is sounding; [] silences the drone. */
  setDrone(pitches: readonly number[]): void;
  setLevels(levels: Levels): void;
  /** Applies to notes requested from now on. */
  setTimbre(timbre: TimbreId): void;
}

/** Gets from "a user gesture happened" to a usable backend. */
export interface AudioHost {
  /** False when the browser has no Web Audio; playback controls then explain why they are off. */
  readonly supported: boolean;
  /** Called synchronously inside the gesture, before anything async. */
  unlock(): void;
  /** Rejects when audio cannot start; the next gesture tries again. */
  load(): Promise<AudioBackend>;
}
