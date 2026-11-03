// Minimal Standard MIDI File writer. Deliberately independent of the importer
// under test, so fixtures can encode Type 0, chords, percussion and broken data.

export interface SmfEvent {
  tick: number;
  /** Raw event bytes (status + data, or FF type len data for meta). */
  data: number[];
  /** Order among events at the same tick: note-offs 0, meta/controls 1, note-ons 2. */
  order: number;
}

export interface SmfFile {
  format: 0 | 1;
  ppq: number;
  tracks: SmfEvent[][];
}

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const bytesOf = (s: string) => [...new TextEncoder().encode(s)];

export function chunk(id: string, body: number[]): number[] {
  return [...bytesOf(id), ...u32(body.length), ...body];
}

export function trackBody(events: readonly SmfEvent[]): number[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || a.e.order - b.e.order || a.i - b.i)
    .map(({ e }) => e);
  const body: number[] = [];
  let last = 0;
  for (const e of sorted) {
    body.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0x00);
  return body;
}

export function header(format: number, trackCount: number, division: number): number[] {
  return chunk('MThd', [...u16(format), ...u16(trackCount), ...u16(division)]);
}

export function writeSmf(file: SmfFile): Uint8Array {
  return Uint8Array.from([
    ...header(file.format, file.tracks.length, file.ppq),
    ...file.tracks.flatMap((t) => chunk('MTrk', trackBody(t))),
  ]);
}

// --- Event helpers -----------------------------------------------------------

export const tempo = (tick: number, bpm: number): SmfEvent => {
  const us = Math.round(60_000_000 / bpm);
  return {
    tick,
    order: 1,
    data: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff],
  };
};

export const timeSignature = (tick: number, numerator: number, denominator: number): SmfEvent => ({
  tick,
  order: 1,
  data: [0xff, 0x58, 0x04, numerator, Math.log2(denominator), 24, 8],
});

export const trackName = (name: string): SmfEvent => {
  const b = bytesOf(name);
  return { tick: 0, order: 1, data: [0xff, 0x03, ...vlq(b.length), ...b] };
};

export const program = (channel: number, number: number, tick = 0): SmfEvent => ({
  tick,
  order: 1,
  data: [0xc0 | channel, number],
});

export const controller = (channel: number, cc: number, value: number, tick: number): SmfEvent => ({
  tick,
  order: 1,
  data: [0xb0 | channel, cc, value],
});

export const pitchBend = (channel: number, value14: number, tick: number): SmfEvent => ({
  tick,
  order: 1,
  data: [0xe0 | channel, value14 & 0x7f, (value14 >> 7) & 0x7f],
});

export const note = (
  channel: number,
  pitch: number,
  start: number,
  duration: number,
  velocity = 96,
): SmfEvent[] => [
  { tick: start, order: 2, data: [0x90 | channel, pitch, velocity] },
  { tick: start + duration, order: 0, data: [0x80 | channel, pitch, 0] },
];

// --- Melody helpers ----------------------------------------------------------

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" = 60, "F#3", "Bb5". */
export function midiOf(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note name ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (LETTER[m[1] as string] as number) + acc + (Number(m[3]) + 1) * 12;
}

/** [pitch | null (rest), beats] */
export type Step = readonly [number | null, number];

/** Lay out a melody of quarter-note beats as note events on one channel. */
export function melody(
  steps: readonly Step[],
  ppq: number,
  channel = 0,
  startTick = 0,
): SmfEvent[] {
  const events: SmfEvent[] = [];
  let tick = startTick;
  for (const [pitch, beats] of steps) {
    const dur = Math.round(beats * ppq);
    if (pitch !== null) events.push(...note(channel, pitch, tick, dur));
    tick += dur;
  }
  return events;
}
