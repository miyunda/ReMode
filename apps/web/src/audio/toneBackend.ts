// Tone.js implementation of AudioBackend. This is the only file that imports
// `tone`, and it is loaded as a separate chunk.
//
// CSP (`script-src 'self'`, `worker-src 'self'`, see docs/decisions/m2c): Tone's
// default Context starts its clock in a blob: Worker, which the policy refuses.
// Two things keep that from happening:
//  - deep imports, never `tone` itself: its index module calls getContext() at
//    evaluation, which builds the default Context (and an AudioContext) on load;
//  - setContext() with clockSource 'timeout' before any node exists.
// No AudioWorklet node is used, so no worklet blob is created either.
import { setContext } from 'tone/build/esm/core/Global.js';
import { Context } from 'tone/build/esm/core/context/Context.js';
import { Synth } from 'tone/build/esm/instrument/Synth.js';
import type { AudioBackend, Levels, NoteRequest, VoiceId } from './backend';
import { timbreOf, type Timbre, type TimbreId } from './timbres';

const hz = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

/** Time constant of the cancel fade: fast, but not a click. */
const FADE_TC = 0.006;
const DRONE_ENVELOPE = { attack: 0.35, decay: 0.1, sustain: 1, release: 0.5 };
const DRONE_LEVEL = 0.32;

interface Voice {
  synth: Synth;
  gate: GainNode;
  time: number;
  timer: ReturnType<typeof setTimeout>;
}

const perceptual = (v: number) => v * v;

export function createToneBackend(ctx: AudioContext): AudioBackend {
  const tone = new Context({
    context: ctx,
    clockSource: 'timeout',
    // Times passed in are absolute; ReMode has its own look-ahead.
    lookAhead: 0,
    updateInterval: 0.05,
  });
  setContext(tone);

  const master = ctx.createGain();
  const melodyBus = ctx.createGain();
  const droneBus = ctx.createGain();
  melodyBus.connect(master);
  droneBus.connect(master);
  master.connect(ctx.destination);

  const voices = new Map<VoiceId, Voice>();
  let nextVoice = 1;
  let timbre: Timbre = timbreOf('soft');
  let drone: Synth[] = [];

  const release = (id: VoiceId) => {
    const v = voices.get(id);
    if (!v) return;
    voices.delete(id);
    clearTimeout(v.timer);
    v.synth.dispose();
    v.gate.disconnect();
  };

  const makeSynth = (t: Timbre) =>
    new Synth({
      context: tone,
      oscillator: { type: t.oscillator },
      envelope: t.envelope,
    });

  return {
    now: () => ctx.currentTime,

    note({ pitch, velocity, time, duration }: NoteRequest): VoiceId {
      const id = nextVoice++;
      const gate = ctx.createGain();
      gate.gain.value = timbre.level;
      gate.connect(melodyBus);
      const synth = makeSynth(timbre);
      synth.connect(gate);
      synth.triggerAttackRelease(hz(pitch), duration, time, velocity);
      const ttl = time - ctx.currentTime + duration + timbre.envelope.release + 0.2;
      voices.set(id, { synth, gate, time, timer: setTimeout(() => release(id), ttl * 1000) });
      return id;
    },

    cancel(id: VoiceId) {
      const v = voices.get(id);
      if (!v) return;
      const now = ctx.currentTime;
      if (v.time > now) {
        release(id);
        return;
      }
      clearTimeout(v.timer);
      v.gate.gain.setTargetAtTime(0, now, FADE_TC);
      v.timer = setTimeout(() => release(id), FADE_TC * 8 * 1000);
    },

    setDrone(pitches: readonly number[]) {
      const now = ctx.currentTime;
      for (const s of drone) {
        s.triggerRelease(now);
        setTimeout(() => s.dispose(), (DRONE_ENVELOPE.release + 0.3) * 1000);
      }
      drone = pitches.map((pitch) => {
        const s = new Synth({
          context: tone,
          oscillator: { type: 'sine' },
          envelope: DRONE_ENVELOPE,
        });
        s.connect(droneBus);
        s.triggerAttack(hz(pitch), now, DRONE_LEVEL);
        return s;
      });
    },

    setLevels({ master: m, drone: d }: Levels) {
      const now = ctx.currentTime;
      master.gain.setTargetAtTime(perceptual(m), now, 0.01);
      droneBus.gain.setTargetAtTime(perceptual(d), now, 0.01);
    },

    setTimbre(id: TimbreId) {
      timbre = timbreOf(id);
    },
  };
}
