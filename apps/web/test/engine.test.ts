import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AUDITION_SECONDS, LOOKAHEAD, LOOKAHEAD_HIDDEN, RESTART_DELAY } from '../src/audio/engine';
import { DEFAULT_AUDIO_PREFS } from '../src/audio/prefs';
import { flush, note, play, program, rig } from './fakeAudio';

const DRONE_ON = { ...DEFAULT_AUDIO_PREFS, droneOn: true };

describe('scheduling', () => {
  it('schedules notes at the tempo map, across tempo changes', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(
      program({
        notes: [note(60, 0), note(62, 480), note(64, 960, 480), note(65, 1440, 480)],
        tempoMap: [
          { tick: 0, bpm: 120 },
          { tick: 960, bpm: 60 },
        ],
      }),
    );
    await play(engine);
    const t0 = backend.voices[0]!.time;
    advance(4);
    const offsets = backend.voices.map((v) => Number((v.time - t0).toFixed(6)));
    expect(offsets).toEqual([0, 0.5, 1, 2]);
    expect(backend.voices.map((v) => Number(v.duration.toFixed(6)))).toEqual([0.5, 0.5, 1, 1]);
    expect(backend.voices.map((v) => v.velocity)).toEqual([0.8, 0.8, 0.8, 0.8]);
  });

  it('hands notes over only within the look-ahead', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    expect(backend.voices).toHaveLength(1);
    advance(1 - RESTART_DELAY - LOOKAHEAD - 0.05);
    expect(backend.voices).toHaveLength(1);
    advance(0.15);
    expect(backend.voices).toHaveLength(2);
  });

  it('looks further ahead in a hidden tab, whose timers are slow', async () => {
    const { engine, backend } = rig({ isHidden: () => true });
    engine.setProgram(program());
    await play(engine);
    expect(LOOKAHEAD_HIDDEN).toBeGreaterThan(1);
    expect(backend.voices.map((v) => v.pitch)).toEqual([60, 62]);
  });

  it('reports the position from the audio clock and stops at the end', async () => {
    const { engine, backend, advance, running } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(RESTART_DELAY + 1.5);
    expect(engine.position()).toBeCloseTo(720, 0);
    expect(engine.getSnapshot().status).toBe('playing');
    advance(3);
    expect(engine.getSnapshot()).toMatchObject({ status: 'stopped', tick: 0 });
    expect(running()).toBe(false);
    expect(backend.soundingAt(backend.time)).toEqual([]);
  });

  it('a late timer never starts a note in the past', async () => {
    const { engine, backend, advance } = rig({ startTimer: () => () => undefined });
    engine.setProgram(program());
    await play(engine);
    advance(1.5); // no pump ran: the main thread was blocked
    (engine as unknown as { pump(): void }).pump();
    const late = backend.voices[1]!;
    expect(late.time).toBeCloseTo(backend.time);
    expect(late.time + late.duration).toBeCloseTo(backend.voices[0]!.time + 2);
  });
});

describe('transport', () => {
  it('pause keeps the position, stop returns to the start, both silence everything', async () => {
    const { engine, backend, advance, running } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(1.2);
    engine.pause();
    const at = engine.position();
    expect(at).toBeGreaterThan(480);
    expect(backend.soundingAt(backend.time)).toEqual([]);
    expect(running()).toBe(false);
    advance(5);
    expect(engine.position()).toBe(at);
    await play(engine);
    advance(0.01);
    expect(engine.position()).toBeCloseTo(at, 0);
    engine.stop();
    expect(engine.getSnapshot()).toMatchObject({ status: 'stopped', tick: 0 });
    expect(backend.soundingAt(backend.time)).toEqual([]);
  });

  it('seek while stopped moves the start; playing from mid-note sounds the rest of it', async () => {
    const { engine, backend } = rig();
    engine.setProgram(program());
    engine.seek(720);
    expect(engine.getSnapshot()).toMatchObject({ status: 'stopped', tick: 720 });
    await play(engine);
    expect(backend.voices[0]).toMatchObject({ pitch: 62 });
    expect(backend.voices[0]!.duration).toBeCloseTo(0.5);
  });

  it('seek while playing jumps with no leftover voices and clamps to the melody', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(0.5);
    engine.seek(1440);
    advance(RESTART_DELAY + 0.1);
    expect(backend.soundingAt(backend.time).map((v) => v.pitch)).toEqual([65]);
    engine.pause();
    engine.seek(99_999);
    expect(engine.getSnapshot().tick).toBe(1920);
  });

  it('play at the very end starts over', async () => {
    const { engine, backend } = rig();
    engine.setProgram(program());
    engine.seek(1920);
    await play(engine);
    expect(backend.voices[0]).toMatchObject({ pitch: 60 });
  });

  it('nothing to play: play does nothing', async () => {
    const { engine, backend } = rig();
    await play(engine);
    engine.setProgram(program({ notes: [] }));
    await play(engine);
    expect(engine.getSnapshot().status).toBe('stopped');
    expect(backend.voices).toEqual([]);
  });

  it('a stop while the backend is still loading cancels the play', async () => {
    const { engine, backend, host } = rig();
    let resolve: (b: typeof backend) => void = () => undefined;
    host.load = () => new Promise((r) => (resolve = r));
    engine.setProgram(program());
    engine.play();
    expect(engine.getSnapshot().status).toBe('playing');
    engine.stop();
    resolve(backend);
    await flush();
    expect(backend.voices).toEqual([]);
    expect(engine.getSnapshot().status).toBe('stopped');
  });

  it('unlocks inside the gesture, before anything async', () => {
    const { engine, host } = rig();
    engine.setProgram(program());
    engine.play();
    expect(host.unlocks).toBe(1);
  });

  it('reports a backend that fails, and the next gesture tries again', async () => {
    const { engine, backend, host } = rig();
    const load = host.load;
    host.load = () => Promise.reject(new Error('suspended'));
    engine.setProgram(program());
    await play(engine);
    expect(engine.getSnapshot()).toMatchObject({ status: 'stopped', error: 'failed' });
    host.load = load;
    await play(engine);
    expect(engine.getSnapshot()).toMatchObject({ status: 'playing', error: null });
    expect(backend.voices).toHaveLength(1);
  });

  it('explains missing Web Audio and never starts', async () => {
    const { engine, host } = rig();
    Object.assign(host, { supported: false });
    engine.setProgram(program());
    await play(engine);
    expect(engine.getSnapshot().status).toBe('stopped');
    engine.audition(60);
    expect(engine.getSnapshot()).toMatchObject({ audition: null });
  });
});

describe('variant switching', () => {
  const strict = program({ notes: [note(60, 0), note(63, 480), note(64, 960), note(65, 1440)] });

  it('keeps the position, releases what sounds and continues with the new variant', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(RESTART_DELAY + 0.75); // mid 60
    advance(0.5); // mid 62
    const at = engine.position();
    expect(backend.soundingAt(backend.time).map((v) => v.pitch)).toEqual([62]);
    engine.setProgram(strict);
    expect(engine.position()).toBeCloseTo(at, 0);
    expect(backend.soundingAt(backend.time)).toEqual([]);
    advance(RESTART_DELAY + 0.01);
    expect(backend.soundingAt(backend.time).map((v) => v.pitch)).toEqual([63]);
    advance(0.75);
    expect(backend.soundingAt(backend.time).map((v) => v.pitch)).toEqual([64]);
  });

  it('cancels notes already handed over for the old variant', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(0.95 - LOOKAHEAD + 0.1); // 62 is scheduled but has not started
    expect(backend.voices.map((v) => v.pitch)).toEqual([60, 62]);
    engine.setProgram(strict);
    advance(1);
    expect(backend.heard().map((v) => v.pitch)).toEqual([60, 60, 63]);
  });

  it('does not restart when the variants sound the same', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(0.2);
    engine.setProgram(program({ mode: { root: 2, scaleId: 'dorian' } }));
    expect(backend.voices).toHaveLength(1);
    expect(backend.voices[0]!.cancelledAt).toBeUndefined();
  });

  it('a different melody stops and rewinds; an edit of the same one keeps going', async () => {
    const { engine, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    advance(1);
    const at = engine.position();
    engine.setProgram(program({ notes: [note(70, 0), note(71, 480)] }));
    expect(engine.getSnapshot().status).toBe('playing');
    expect(engine.position()).toBeCloseTo(at, 0);
    engine.setProgram(program({ key: {} }));
    expect(engine.getSnapshot()).toMatchObject({ status: 'stopped', tick: 0, loop: null });
    await play(engine);
    engine.setProgram(null);
    expect(engine.getSnapshot()).toMatchObject({ status: 'stopped', endTick: 0 });
  });

  it('deleting every note of a playing draft stops it', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program({ key: 'draft' }));
    await play(engine);
    advance(0.5);
    engine.setProgram(program({ key: 'draft', notes: [] }));
    expect(engine.getSnapshot().status).toBe('stopped');
    expect(backend.soundingAt(backend.time)).toEqual([]);
  });

  it('a tempo change restarts at the same tick', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program({ key: 'draft' }));
    await play(engine);
    advance(1);
    const at = engine.position();
    engine.setProgram(program({ key: 'draft', tempoMap: [{ tick: 0, bpm: 120 }] }));
    advance(RESTART_DELAY);
    expect(engine.position()).toBeCloseTo(at, 0);
    advance(0.5);
    expect(engine.position()).toBeCloseTo(at + 480, 0);
    expect(backend.soundingAt(backend.time)).toHaveLength(1);
  });
});

describe('loop', () => {
  it('repeats the range exactly, cutting notes at the loop end', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    engine.seek(480);
    engine.setLoop(480, 1200); // 62 whole, 64 for half a beat
    await play(engine);
    const t0 = backend.voices[0]!.time;
    advance(3.4);
    const heard = backend.voices.map((v) => [
      v.pitch,
      Number((v.time - t0).toFixed(6)),
      Number(v.duration.toFixed(6)),
    ]);
    expect(heard.slice(0, 5)).toEqual([
      [62, 0, 1],
      [64, 1, 0.5],
      [62, 1.5, 1],
      [64, 2.5, 0.5],
      [62, 3, 1],
    ]);
    expect(engine.getSnapshot().status).toBe('playing');
  });

  it('the position wraps at the loop end', async () => {
    const { engine, advance } = rig();
    engine.setProgram(program());
    engine.setLoop(0, 960);
    await play(engine);
    advance(RESTART_DELAY + 1.9);
    expect(engine.position()).toBeCloseTo(912, 0);
    advance(0.2);
    expect(engine.position()).toBeCloseTo(48, 0);
  });

  it('a note begun before the loop start sounds from the loop start', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program({ notes: [note(60, 0, 960), note(62, 960)] }));
    engine.setLoop(480, 1440);
    await play(engine);
    advance(3.2); // 60 for 2 s, 62 for 1 s, then round from the loop start
    expect(backend.voices.map((v) => v.pitch)).toEqual([60, 62, 60]);
    expect(backend.voices[2]!.duration).toBeCloseTo(1);
  });

  it('a playhead past the loop runs to the end of the melody', async () => {
    const { engine, advance } = rig();
    engine.setProgram(program());
    engine.setLoop(0, 480);
    engine.seek(960);
    await play(engine);
    advance(RESTART_DELAY + 2.1);
    expect(engine.getSnapshot().status).toBe('stopped');
  });

  it('toggling with no range loops the whole melody; off lets it finish', async () => {
    const { engine, advance } = rig();
    engine.setProgram(program());
    engine.toggleLoop();
    expect(engine.getSnapshot()).toMatchObject({
      loopOn: true,
      loop: { startTick: 0, endTick: 1920 },
    });
    await play(engine);
    advance(10);
    expect(engine.getSnapshot().status).toBe('playing');
    engine.toggleLoop();
    advance(5);
    expect(engine.getSnapshot().status).toBe('stopped');
  });

  it('loop edges at the playhead; a crossing edge resets the other one', () => {
    const { engine } = rig();
    engine.setProgram(program());
    engine.seek(480);
    engine.setLoopEdge('start');
    expect(engine.getSnapshot().loop).toEqual({ startTick: 480, endTick: 1920 });
    engine.seek(960);
    engine.setLoopEdge('end');
    expect(engine.getSnapshot().loop).toEqual({ startTick: 480, endTick: 960 });
    engine.seek(1440);
    engine.setLoopEdge('start');
    expect(engine.getSnapshot().loop).toEqual({ startTick: 1440, endTick: 1920 });
    engine.seek(240);
    engine.setLoopEdge('end');
    expect(engine.getSnapshot().loop).toEqual({ startTick: 0, endTick: 240 });
  });

  it('refuses an empty range, clamps to the melody, follows a shrinking draft', () => {
    const { engine } = rig();
    engine.setProgram(program({ key: 'draft' }));
    engine.setLoop(480, 480);
    expect(engine.getSnapshot().loop).toBeNull();
    engine.setLoop(9000, 960);
    expect(engine.getSnapshot().loop).toEqual({ startTick: 960, endTick: 1920 });
    engine.setProgram(program({ key: 'draft', notes: [note(60, 0)] }));
    expect(engine.getSnapshot()).toMatchObject({ loop: null, loopOn: false });
  });

  it('survives a variant switch with its range', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    engine.setLoop(0, 960);
    await play(engine);
    advance(0.5);
    engine.setProgram(program({ notes: [note(61, 0), note(63, 480)] }));
    advance(2.2);
    expect(engine.getSnapshot()).toMatchObject({ status: 'playing', loopOn: true });
    expect(backend.soundingAt(backend.time).map((v) => v.pitch)).toEqual([61]);
  });
});

describe('drone', () => {
  const dorianD = { root: 2, scaleId: 'dorian' };

  it('sounds only while playing, on the variant tonic', async () => {
    const { engine, backend, advance } = rig({ prefs: DRONE_ON });
    engine.setProgram(program());
    expect(backend.drones).toEqual([]);
    await play(engine);
    expect(backend.drones).toEqual([[48]]);
    expect(engine.getSnapshot().drone).toEqual([48]);
    advance(0.5);
    engine.pause();
    expect(backend.drones.at(-1)).toEqual([]);
    await play(engine);
    expect(backend.drones.at(-1)).toEqual([48]);
    engine.stop();
    expect(backend.drones.at(-1)).toEqual([]);
    expect(engine.getSnapshot().drone).toEqual([]);
  });

  it('follows the tonic of the selected variant, and only when it differs', async () => {
    const { engine, backend, advance } = rig({ prefs: DRONE_ON });
    engine.setProgram(program());
    await play(engine);
    advance(0.5);
    const notes = [note(62, 0), note(64, 480)];
    engine.setProgram(program({ notes, mode: dorianD }));
    expect(backend.drones).toEqual([[48], [50]]);
    engine.setProgram(program({ notes: [note(63, 0)], mode: dorianD }));
    expect(backend.drones).toHaveLength(2);
  });

  it('stays silent without a tonic and when switched off; the mode applies at once', async () => {
    const { engine, backend, advance } = rig({ prefs: DRONE_ON });
    engine.setProgram(program({ mode: null }));
    await play(engine);
    expect(backend.drones).toEqual([]);
    engine.setProgram(program());
    expect(backend.drones).toEqual([[48]]);
    engine.setPrefs({ droneMode: 'tonic-fifth' });
    expect(backend.drones.at(-1)).toEqual([48, 55]);
    engine.setPrefs({ droneOn: false });
    expect(backend.drones.at(-1)).toEqual([]);
    advance(0.1);
  });

  it('ends with the melody and is never a melody note', async () => {
    const { engine, backend, advance } = rig({ prefs: DRONE_ON });
    engine.setProgram(program());
    await play(engine);
    advance(5);
    expect(backend.drones).toEqual([[48], []]);
    expect(backend.voices.map((v) => v.pitch)).toEqual([60, 62, 64, 65]);
  });
});

describe('audition', () => {
  it('sounds one short note', async () => {
    const { engine, backend } = rig();
    engine.audition(67);
    await flush();
    expect(backend.voices).toHaveLength(1);
    expect(backend.voices[0]).toMatchObject({ pitch: 67, duration: AUDITION_SECONDS });
    expect(engine.getSnapshot().audition).toEqual({ pitch: 67, seq: 1 });
  });

  it('the gesture that unlocks audio still sounds; of several, the last', async () => {
    const { engine, backend, host } = rig();
    let resolve: (b: typeof backend) => void = () => undefined;
    host.load = () => new Promise((r) => (resolve = r));
    engine.audition(60);
    engine.audition(62);
    expect(backend.voices).toEqual([]);
    resolve(backend);
    await flush();
    expect(backend.voices.map((v) => v.pitch)).toEqual([62]);
  });

  it('a new audition cuts the previous one', async () => {
    const { engine, backend, advance } = rig();
    engine.audition(60);
    await flush();
    advance(0.05);
    engine.audition(62);
    expect(backend.soundingAt(backend.time).map((v) => v.pitch)).toEqual([62]);
  });

  it('is muted during playback, nothing doubles, and it returns when paused', async () => {
    const { engine, backend, advance } = rig();
    engine.setProgram(program());
    await play(engine);
    const before = backend.voices.length;
    engine.audition(70);
    expect(backend.voices).toHaveLength(before);
    expect(engine.getSnapshot().audition).toBeNull();
    advance(0.1);
    engine.pause();
    engine.audition(70);
    expect(backend.voices.at(-1)).toMatchObject({ pitch: 70 });
  });

  it('play drops a pending audition and cuts a sounding one', async () => {
    const { engine, backend, host } = rig();
    let resolve: (b: typeof backend) => void = () => undefined;
    host.load = () => new Promise((r) => (resolve = r));
    engine.setProgram(program());
    engine.audition(70);
    engine.play();
    resolve(backend);
    await flush();
    expect(backend.voices.map((v) => v.pitch)).toEqual([60]);

    const second = rig();
    second.engine.setProgram(program());
    second.engine.audition(70);
    await flush();
    await play(second.engine);
    expect(second.backend.soundingAt(second.backend.time)).toEqual([]);
    expect(second.backend.voices[0]!.cancelledAt).toBe(second.backend.time);
  });

  it('the toggle silences it', async () => {
    const { engine, backend } = rig();
    engine.setPrefs({ audition: false });
    engine.audition(60);
    await flush();
    expect(backend.voices).toEqual([]);
  });
});

describe('preferences', () => {
  it('reach the backend when it arrives and when they change, and are reported', async () => {
    let saved = DEFAULT_AUDIO_PREFS;
    const { engine, backend } = rig({ onPrefs: (p) => (saved = p) });
    engine.setPrefs({ masterVolume: 0.5, timbre: 'pluck' });
    expect(saved).toMatchObject({ masterVolume: 0.5, timbre: 'pluck' });
    engine.audition(60);
    await flush();
    expect(backend.levels?.master).toBe(0.5);
    expect(backend.timbre).toBe('pluck');
    engine.setPrefs({ droneVolume: 0.1, timbre: 'reed' });
    expect(backend.levels?.drone).toBe(0.1);
    expect(backend.timbre).toBe('reed');
  });
});

describe('invariants under any sequence of actions', () => {
  const variants = [
    program(),
    program({
      notes: [note(61, 0), note(63, 480), note(66, 960), note(68, 1440)],
      mode: { root: 2, scaleId: 'dorian' },
    }),
    program({ notes: [note(60, 0, 240), note(72, 720, 960)], mode: null }),
  ];
  const action = fc.oneof(
    fc.constant({ do: 'toggle' as const }),
    fc.constant({ do: 'stop' as const }),
    fc.constant({ do: 'loop' as const }),
    fc.record({ do: fc.constant('variant' as const), i: fc.nat(2) }),
    fc.record({ do: fc.constant('seek' as const), tick: fc.nat(2400) }),
    fc.record({
      do: fc.constant('range' as const),
      a: fc.nat(1920),
      b: fc.nat(1920),
    }),
    fc.record({
      do: fc.constant('wait' as const),
      s: fc.double({ min: 0.01, max: 2, noNaN: true }),
    }),
  );

  it('one voice at most, the position in range, nothing left after a stop', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { maxLength: 30 }), async (actions) => {
        const { engine, backend, advance, running } = rig({ prefs: DRONE_ON });
        engine.setProgram(variants[0]!);
        for (const a of actions) {
          if (a.do === 'toggle') engine.toggle();
          else if (a.do === 'stop') engine.stop();
          else if (a.do === 'loop') engine.toggleLoop();
          else if (a.do === 'variant') engine.setProgram(variants[a.i]!);
          else if (a.do === 'seek') engine.seek(a.tick);
          else if (a.do === 'range') engine.setLoop(a.a, a.b);
          else advance(a.s);
          await flush();
          const at = engine.position();
          expect(at).toBeGreaterThanOrEqual(0);
          expect(at).toBeLessThanOrEqual(1920);
          expect(backend.soundingAt(backend.time).length).toBeLessThanOrEqual(1);
          const playing = engine.getSnapshot().status === 'playing';
          expect(running()).toBe(playing);
          if (!playing) {
            expect(backend.soundingAt(backend.time)).toEqual([]);
            expect(engine.getSnapshot().drone).toEqual([]);
          }
        }
        // Scan the whole run: no two voices ever overlapped in time.
        const heard = [...backend.heard()].sort((a, b) => a.time - b.time);
        for (let i = 1; i < heard.length; i++)
          expect(heard[i]!.time).toBeGreaterThanOrEqual(backend.end(heard[i - 1]!) - 1e-9);
        engine.stop();
        expect(backend.soundingAt(backend.time)).toEqual([]);
        expect(backend.voices.filter((v) => v.time > backend.time && !v.cancelledAt)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
