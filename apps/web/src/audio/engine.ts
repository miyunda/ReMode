// The transport (spec §10.4): one position in ticks, shared by every variant,
// and a look-ahead scheduler that hands notes to an AudioBackend slightly ahead
// of the audio clock. No Tone.js and no DOM here: time comes from backend.now(),
// wake-ups from an injected timer, so all of it runs against a fake in tests.
//
// While playing, time is a list of segments: "at audio time T the position is
// tick P, running up to tick E". A loop appends a segment at the loop start; a
// variant switch, a seek or a loop change cancels the voices and starts a new
// segment at the current position, which is why nothing can stay stuck or play
// twice: there is exactly one source of pending notes.

import type { ModeRef, TempoEvent } from '@remode/core';
import type { AudioBackend, AudioHost, Levels, VoiceId } from './backend';
import { dronePitches } from './drone';
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from './prefs';
import { buildTimeline, type Timeline } from './timeline';

export type TransportStatus = 'stopped' | 'playing' | 'paused';

export interface ProgramNote {
  pitch: number;
  startTick: number;
  durationTick: number;
  velocity: number;
}

/** What the transport plays: the selected variant, or the new-melody draft. */
export interface Program {
  /** Identity of the melody: variants of one melody share it, so they share the position. */
  key: unknown;
  notes: readonly ProgramNote[];
  ppq: number;
  tempoMap: readonly TempoEvent[];
  /** The selected variant's mode; null when the tonic is not determined. */
  mode: ModeRef | null;
}

export interface LoopRange {
  startTick: number;
  endTick: number;
}

export interface TransportSnapshot {
  status: TransportStatus;
  /** Position at the last discrete change; position() is live. */
  tick: number;
  endTick: number;
  loop: LoopRange | null;
  loopOn: boolean;
  /** Sounding drone pitches; empty when silent. */
  drone: readonly number[];
  prefs: AudioPrefs;
  /** Last pitch auditioned; seq counts them, so repeats of a pitch are visible. */
  audition: { pitch: number; seq: number } | null;
  /** Web Audio is missing, or it did not start. */
  error: 'unsupported' | 'failed' | null;
}

/** How far ahead notes are handed to the backend. Hidden tabs get slow timers. */
export const LOOKAHEAD = 0.15;
export const LOOKAHEAD_HIDDEN = 1.5;
export const PUMP_MS = 25;
/** Gap before a new segment, so its first note is not late. */
export const RESTART_DELAY = 0.03;
/** Remainders shorter than this are not worth sounding after a seek or a switch. */
export const MIN_CLIP = 0.03;
export const AUDITION_SECONDS = 0.35;
export const AUDITION_VELOCITY = 0.75;

export interface EngineDeps {
  host: AudioHost;
  prefs?: AudioPrefs;
  onPrefs?: (prefs: AudioPrefs) => void;
  /** Starts a repeating timer and returns its stop function. */
  startTimer?: (fn: () => void, ms: number) => () => void;
  isHidden?: () => boolean;
}

interface Segment {
  audioStart: number;
  tick: number;
  endTick: number;
  startSeconds: number;
  audioEnd: number;
  /** Next note to look at. */
  cursor: number;
}

const realTimer = (fn: () => void, ms: number) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

const endOf = (notes: readonly ProgramNote[]) =>
  notes.reduce((m, n) => Math.max(m, n.startTick + n.durationTick), 0);

const sorted = (notes: readonly ProgramNote[]) =>
  [...notes].sort((a, b) => a.startTick - b.startTick);

const sameNotes = (a: readonly ProgramNote[], b: readonly ProgramNote[]) =>
  a === b ||
  (a.length === b.length &&
    a.every((n, i) => {
      const m = b[i] as ProgramNote;
      return (
        n.pitch === m.pitch &&
        n.startTick === m.startTick &&
        n.durationTick === m.durationTick &&
        n.velocity === m.velocity
      );
    }));

const sameTempo = (a: Program, b: Program) =>
  a.ppq === b.ppq &&
  a.tempoMap.length === b.tempoMap.length &&
  a.tempoMap.every((e, i) => e.tick === b.tempoMap[i]?.tick && e.bpm === b.tempoMap[i]?.bpm);

const samePitches = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((p, i) => p === b[i]);

export class PlaybackEngine {
  private readonly host: AudioHost;
  private readonly onPrefs: (prefs: AudioPrefs) => void;
  private readonly startTimer: NonNullable<EngineDeps['startTimer']>;
  private readonly isHidden: () => boolean;
  private readonly listeners = new Set<() => void>();

  private backend: AudioBackend | null = null;
  private loading: Promise<AudioBackend> | null = null;
  private failed = false;

  private program: Program | null = null;
  private notes: readonly ProgramNote[] = [];
  private timeline: Timeline = buildTimeline(480, []);
  private endTick = 0;

  private status: TransportStatus = 'stopped';
  /** Position when not playing, and while a play waits for the backend. */
  private held = 0;
  private segments: Segment[] = [];
  private live: Array<{ voice: VoiceId; end: number }> = [];
  private stopTimer: (() => void) | null = null;
  /** Invalidates a play still waiting for the backend. */
  private playToken = 0;

  private loop: LoopRange | null = null;
  private loopOn = false;
  private prefs: AudioPrefs;
  private drone: readonly number[] = [];
  private auditionVoice: VoiceId | null = null;
  private lastAudition: TransportSnapshot['audition'] = null;
  private pendingAudition: number | null = null;

  private snapshot: TransportSnapshot;

  constructor(deps: EngineDeps) {
    this.host = deps.host;
    this.prefs = deps.prefs ?? DEFAULT_AUDIO_PREFS;
    this.onPrefs = deps.onPrefs ?? (() => undefined);
    this.startTimer = deps.startTimer ?? realTimer;
    this.isHidden = deps.isHidden ?? (() => false);
    this.snapshot = this.buildSnapshot();
  }

  // --- Store interface (useSyncExternalStore) -------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TransportSnapshot => this.snapshot;

  /** Live position in ticks; cheap enough for every animation frame. */
  position = (): number => {
    const first = this.segments[0];
    if (this.status !== 'playing' || !first || !this.backend) return this.held;
    const now = this.backend.now();
    let s = first;
    for (const x of this.segments) if (x.audioStart <= now) s = x;
    if (now <= s.audioStart) return s.tick;
    return Math.min(s.endTick, this.timeline.toTick(s.startSeconds + now - s.audioStart));
  };

  // --- Program --------------------------------------------------------------

  setProgram(next: Program | null): void {
    const prev = this.program;
    const sameMelody = !!prev && !!next && prev.key === next.key;
    if (!sameMelody) {
      this.halt('stopped', 0);
      this.loop = null;
      this.loopOn = false;
    }
    const at = this.position();
    const heard = !!prev && !!next && sameNotes(prev.notes, next.notes) && sameTempo(prev, next);
    this.program = next;
    if (heard) {
      this.syncDrone();
      this.emit();
      return;
    }
    this.notes = sorted(next?.notes ?? []);
    this.timeline = buildTimeline(next?.ppq ?? 480, next?.tempoMap ?? []);
    this.endTick = endOf(this.notes);
    if (this.loop) {
      const endTick = Math.min(this.loop.endTick, this.endTick);
      this.loop = endTick > this.loop.startTick ? { ...this.loop, endTick } : null;
      if (!this.loop) this.loopOn = false;
    }
    if (this.status === 'playing') {
      if (this.endTick === 0) this.halt('stopped', 0);
      else if (this.segments.length > 0) this.restart(at);
      else this.held = Math.min(at, this.endTick);
    } else this.held = Math.min(at, this.endTick);
    this.syncDrone();
    this.emit();
  }

  // --- Transport ------------------------------------------------------------

  /** Call from a user gesture. */
  play(): void {
    if (this.status === 'playing' || this.endTick === 0 || !this.host.supported) return;
    this.pendingAudition = null;
    this.silenceAudition();
    const token = ++this.playToken;
    if (this.held >= this.endTick) this.held = this.loopOn && this.loop ? this.loop.startTick : 0;
    this.status = 'playing';
    this.emit();
    this.withBackend(() => {
      if (token !== this.playToken || this.status !== 'playing') return;
      this.restart(this.held);
      this.stopTimer = this.startTimer(this.pump, PUMP_MS);
      this.emit();
    });
  }

  pause(): void {
    if (this.status === 'playing') this.halt('paused', this.position());
    this.emit();
  }

  stop(): void {
    this.halt('stopped', 0);
    this.emit();
  }

  toggle(): void {
    if (this.status === 'playing') this.pause();
    else this.play();
  }

  /** Call from a user gesture. Keeps playing when it is playing. */
  seek(tick: number): void {
    const to = Math.max(0, Math.min(this.endTick, tick));
    if (this.status === 'playing' && this.segments.length > 0) this.restart(to);
    else this.held = to;
    this.emit();
  }

  /** Sets the range and turns the loop on. */
  setLoop(a: number, b: number): void {
    const startTick = Math.max(0, Math.min(a, b));
    const endTick = Math.min(this.endTick, Math.max(a, b));
    if (endTick <= startTick) return;
    this.loop = { startTick, endTick };
    this.loopOn = true;
    this.retarget();
  }

  /** With no range yet, loops the whole melody. */
  toggleLoop(): void {
    if (this.endTick === 0) return;
    this.loop ??= { startTick: 0, endTick: this.endTick };
    this.loopOn = !this.loopOn;
    this.retarget();
  }

  /** A loop edge at the playhead; an edge that would cross the other resets it. */
  setLoopEdge(edge: 'start' | 'end'): void {
    const at = Math.round(this.position());
    const cur = this.loop ?? { startTick: 0, endTick: this.endTick };
    if (edge === 'start') this.setLoop(at, at < cur.endTick ? cur.endTick : this.endTick);
    else this.setLoop(at > cur.startTick ? cur.startTick : 0, at);
  }

  clearLoop(): void {
    this.loop = null;
    this.loopOn = false;
    this.retarget();
  }

  // --- Audition -------------------------------------------------------------

  /**
   * One short note, from a user gesture. Silent while the transport plays, so
   * nothing doubles. When this gesture is the one that unlocks audio, the note
   * still sounds once the backend is ready; if several arrive first, the last.
   */
  audition(pitch: number): void {
    if (!this.prefs.audition || this.status === 'playing' || !this.host.supported) return;
    this.lastAudition = { pitch, seq: (this.lastAudition?.seq ?? 0) + 1 };
    this.pendingAudition = pitch;
    this.emit();
    this.withBackend((b) => {
      const p = this.pendingAudition;
      this.pendingAudition = null;
      if (p === null || this.status === 'playing') return;
      this.silenceAudition();
      this.auditionVoice = b.note({
        pitch: p,
        velocity: AUDITION_VELOCITY,
        time: b.now(),
        duration: AUDITION_SECONDS,
      });
    });
  }

  // --- Preferences ----------------------------------------------------------

  setPrefs(patch: Partial<AudioPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    if (this.backend) {
      this.backend.setLevels(this.levels());
      this.backend.setTimbre(this.prefs.timbre);
    }
    this.syncDrone();
    this.onPrefs(this.prefs);
    this.emit();
  }

  // --- Internals ------------------------------------------------------------

  private levels(): Levels {
    return { master: this.prefs.masterVolume, drone: this.prefs.droneVolume };
  }

  private withBackend(fn: (backend: AudioBackend) => void): void {
    this.host.unlock();
    if (this.backend) {
      fn(this.backend);
      return;
    }
    this.loading ??= this.host.load();
    this.loading.then(
      (b) => {
        if (!this.backend) {
          this.backend = b;
          b.setLevels(this.levels());
          b.setTimbre(this.prefs.timbre);
        }
        this.failed = false;
        fn(b);
        this.emit();
      },
      () => {
        this.loading = null;
        this.failed = true;
        this.pendingAudition = null;
        this.halt(this.status === 'playing' ? 'stopped' : this.status, this.held);
        this.emit();
      },
    );
  }

  private boundary(tick: number): number {
    return this.loopOn && this.loop && tick < this.loop.endTick ? this.loop.endTick : this.endTick;
  }

  private segment(tick: number, audioStart: number): Segment {
    const startSeconds = this.timeline.toSeconds(tick);
    const endTick = this.boundary(tick);
    return {
      audioStart,
      tick,
      endTick,
      startSeconds,
      audioEnd: audioStart + this.timeline.toSeconds(endTick) - startSeconds,
      cursor: 0,
    };
  }

  private restart(tick: number): void {
    const b = this.backend;
    if (!b) return;
    this.cancelVoices();
    if (tick >= this.endTick) {
      this.halt('stopped', 0);
      return;
    }
    this.segments = [this.segment(tick, b.now() + RESTART_DELAY)];
    this.syncDrone();
    this.pump();
  }

  /** The loop changed: restart only if that moves where the current segment ends. */
  private retarget(): void {
    if (this.status === 'playing' && this.segments.length > 0) {
      const at = this.position();
      if (this.segments.length > 1 || this.boundary(at) !== this.segments[0]?.endTick)
        this.restart(at);
    }
    this.emit();
  }

  /** Stops everything; the transport ends at `tick`. */
  private halt(status: TransportStatus, tick: number): void {
    this.playToken++;
    this.stopTimer?.();
    this.stopTimer = null;
    this.cancelVoices();
    this.segments = [];
    this.status = status;
    this.held = tick;
    this.syncDrone();
  }

  private cancelVoices(): void {
    for (const v of this.live) this.backend?.cancel(v.voice);
    this.live = [];
  }

  private silenceAudition(): void {
    if (this.auditionVoice !== null) this.backend?.cancel(this.auditionVoice);
    this.auditionVoice = null;
  }

  /** The drone sounds only during playback and follows the selected variant's tonic. */
  private syncDrone(): void {
    const mode = this.program?.mode;
    const want =
      this.status === 'playing' && this.segments.length > 0 && this.prefs.droneOn && mode
        ? dronePitches(mode.root, this.prefs.droneMode)
        : [];
    if (samePitches(want, this.drone)) return;
    this.drone = want;
    this.backend?.setDrone(want);
  }

  private readonly pump = (): void => {
    const b = this.backend;
    if (!b || this.status !== 'playing') return;
    const now = b.now();
    this.fill(now, now + (this.isHidden() ? LOOKAHEAD_HIDDEN : LOOKAHEAD));
    this.live = this.live.filter((v) => v.end > now);
    while ((this.segments[1]?.audioStart ?? Infinity) <= now) this.segments.shift();
    const last = this.segments[this.segments.length - 1];
    if (last && now >= last.audioEnd && !this.loops(last)) {
      this.halt('stopped', 0);
      this.emit();
    }
  };

  private loops(s: Segment): boolean {
    return this.loopOn && !!this.loop && s.endTick === this.loop.endTick;
  }

  private fill(now: number, horizon: number): void {
    for (;;) {
      const s = this.segments[this.segments.length - 1];
      if (!s) return;
      if (!this.fillSegment(s, now, horizon)) return;
      if (s.audioEnd > horizon || !this.loops(s)) return;
      this.segments.push(this.segment((this.loop as LoopRange).startTick, s.audioEnd));
    }
  }

  /** Hands over the segment's notes up to the horizon; true when none are left. */
  private fillSegment(s: Segment, now: number, horizon: number): boolean {
    const b = this.backend as AudioBackend;
    const tl = this.timeline;
    for (; s.cursor < this.notes.length; s.cursor++) {
      const n = this.notes[s.cursor] as ProgramNote;
      if (n.startTick >= s.endTick) {
        s.cursor = this.notes.length;
        break;
      }
      const noteEnd = n.startTick + n.durationTick;
      if (noteEnd <= s.tick) continue;
      // A note already under way at the segment start sounds for what is left of it.
      const from = Math.max(n.startTick, s.tick);
      const planned = s.audioStart + tl.toSeconds(from) - s.startSeconds;
      if (planned > horizon) return false;
      const end = s.audioStart + tl.toSeconds(Math.min(noteEnd, s.endTick)) - s.startSeconds;
      const time = Math.max(planned, now);
      const clipped = from !== n.startTick || time !== planned;
      if (end - time <= 0 || (clipped && end - time < MIN_CLIP)) continue;
      this.live.push({
        voice: b.note({ pitch: n.pitch, velocity: n.velocity, time, duration: end - time }),
        end,
      });
    }
    return true;
  }

  private buildSnapshot(): TransportSnapshot {
    return {
      status: this.status,
      tick: this.position(),
      endTick: this.endTick,
      loop: this.loop,
      loopOn: this.loopOn,
      drone: this.drone,
      prefs: this.prefs,
      audition: this.lastAudition,
      error: !this.host.supported ? 'unsupported' : this.failed ? 'failed' : null,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }
}
