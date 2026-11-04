// A fake AudioBackend: a controllable clock and a record of every voice, so
// scheduling can be asserted exactly and "what is sounding at time t" computed.
import type { AudioBackend, AudioHost, Levels, NoteRequest } from '../src/audio/backend';
import { PlaybackEngine, PUMP_MS, type EngineDeps, type Program } from '../src/audio/engine';
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from '../src/audio/prefs';
import type { TimbreId } from '../src/audio/timbres';

export interface FakeVoice extends NoteRequest {
  id: number;
  cancelledAt?: number;
}

export class FakeBackend implements AudioBackend {
  time = 100;
  voices: FakeVoice[] = [];
  /** Every setDrone call. */
  drones: number[][] = [];
  levels: Levels | null = null;
  timbre: TimbreId | null = null;

  now = () => this.time;
  note(r: NoteRequest) {
    const id = this.voices.length + 1;
    this.voices.push({ ...r, id });
    return id;
  }
  cancel(id: number) {
    const v = this.voices[id - 1];
    if (v && v.cancelledAt === undefined) v.cancelledAt = this.time;
  }
  setDrone(pitches: readonly number[]) {
    this.drones.push([...pitches]);
  }
  setLevels(levels: Levels) {
    this.levels = levels;
  }
  setTimbre(timbre: TimbreId) {
    this.timbre = timbre;
  }

  end = (v: FakeVoice) => Math.min(v.time + v.duration, v.cancelledAt ?? Infinity);
  /** Voices that actually make sound (cancelled before their start they never did). */
  heard = () => this.voices.filter((v) => this.end(v) > v.time);
  soundingAt = (t: number) => this.heard().filter((v) => v.time <= t && t < this.end(v));
}

export function rig(options: Partial<EngineDeps> & { prefs?: AudioPrefs } = {}) {
  const backend = new FakeBackend();
  let pump: (() => void) | null = null;
  const host: AudioHost & { unlocks: number; load: () => Promise<AudioBackend> } = {
    supported: true,
    unlocks: 0,
    unlock() {
      this.unlocks++;
    },
    load: () => Promise.resolve(backend),
  };
  const engine = new PlaybackEngine({
    host,
    prefs: { ...DEFAULT_AUDIO_PREFS, droneOn: false },
    startTimer: (fn) => {
      pump = fn;
      return () => {
        pump = null;
      };
    },
    ...options,
  });
  /** Moves the audio clock forward, firing the timer as a browser would. */
  const advance = (seconds: number) => {
    const end = backend.time + seconds;
    while (backend.time < end) {
      backend.time = Math.min(end, backend.time + PUMP_MS / 1000);
      pump?.();
    }
  };
  return { engine, backend, host, advance, running: () => pump !== null };
}

export const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Starts playing and lets the (already resolved) backend load finish. */
export async function play(engine: PlaybackEngine) {
  engine.play();
  await flush();
}

export const note = (pitch: number, startTick: number, durationTick = 480, velocity = 0.8) => ({
  pitch,
  startTick,
  durationTick,
  velocity,
});

const KEY = {};

/** Four quarter notes at 60 BPM unless overridden: one second per note. */
export const program = (over: Partial<Program> = {}): Program => ({
  key: KEY,
  notes: [note(60, 0), note(62, 480), note(64, 960), note(65, 1440)],
  ppq: 480,
  tempoMap: [{ tick: 0, bpm: 60 }],
  mode: { root: 0, scaleId: 'ionian' },
  ...over,
});
