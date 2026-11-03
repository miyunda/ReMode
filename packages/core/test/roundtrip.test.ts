// Invariant E (spec §12.3): MIDI export → re-import preserves note pitch,
// ticks, duration, velocity and the supported header events.

import { describe, expect, it } from 'vitest';
import {
  exportMidi,
  importMidi,
  melodyCandidates,
  parseJianpu,
  trackMetadata,
  validateMelody,
  validateTrack,
  type MelodyNote,
  type MidiMetadata,
  type ParsedMidi,
} from '../src/index.js';
import { fixtureBytes, fixtureText, manifest } from './helpers.js';

const parse = (bytes: Uint8Array): ParsedMidi => {
  const r = importMidi(bytes);
  if (!r.ok) throw new Error(r.error.code);
  return r.midi;
};

/** µs per quarter: the unit MIDI stores tempo in. */
const tempoUs = (meta: MidiMetadata) =>
  meta.tempoMap.map((t) => [t.tick, Math.round(60_000_000 / t.bpm)]);
const noteData = (notes: readonly MelodyNote[]) =>
  notes.map((n) => [n.pitch, n.startTick, n.durationTick, n.velocity]);

function expectRoundTrip(notes: readonly MelodyNote[], meta: MidiMetadata) {
  const r = exportMidi(notes, meta);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  expect(r.report.warnings.map((w) => w.code)).not.toContain('VELOCITY_QUANTIZED');
  const back = parse(r.bytes);
  expect(back.tracks).toHaveLength(1);
  const track = back.tracks[0]!;
  expect(track.noteCount).toBe(notes.length);
  expect(noteData(track.notes)).toEqual(noteData(notes));
  expect(back.metadata.ppq).toBe(meta.ppq);
  expect(tempoUs(back.metadata)).toEqual(tempoUs(meta));
  expect(back.metadata.timeSignatures).toEqual(meta.timeSignatures);
  expect(back.metadata.keySignatures).toEqual(meta.keySignatures ?? []);
  expect(track.channel).toBe(meta.channel ?? 0);
  expect(track.instrumentProgram).toBe(meta.instrumentProgram ?? 0);
  expect(track.name).toBe(meta.trackName ?? '');
  // A second pass is byte-identical: nothing drifts across repeated exports.
  const again = exportMidi(track.notes, trackMetadata(back, track));
  expect(again.ok && [...again.bytes]).toEqual([...r.bytes]);
}

const midiCases = manifest()
  .filter((f) => f.file.endsWith('.mid') && f.expect.import.ok)
  .flatMap(({ file }) => {
    const m = parse(fixtureBytes(file));
    return melodyCandidates(m)
      .filter((t) => validateTrack(t, m.metadata).ok)
      .map((t) => ({ name: `${file} ${t.id}`, file, trackId: t.id }));
  });

describe('Invariant E: MIDI fixture → export → re-import', () => {
  it('covers the validated fixtures', () => {
    expect(midiCases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(midiCases)('$name', ({ file, trackId }) => {
    const m = parse(fixtureBytes(file));
    const track = m.tracks.find((t) => t.id === trackId)!;
    expectRoundTrip(track.notes, trackMetadata(m, track));
  });
});

const jianpuCases = [
  ...manifest()
    .filter((f) => f.file.endsWith('.jianpu'))
    .map((f) => ({ name: f.file, text: fixtureText(f.file) })),
  { name: 'spec example', text: '1=C 4/4 | 5 3 2 1 | 6. 5_ 3 - |' },
  {
    name: 'sixteenths, rests, 6/8, ♩=72',
    text: '1=Eb 6/8 ♩=72 | 1__2__3_ 0_ 5. | 6,_ 5,_ 0_ 1. |',
  },
  { name: 'non-integer µs tempo', text: '1=G 3/4 bpm=70 | 3 2 1 | 6, - - |' },
  { name: 'extremes', text: "1=C 2/4 | 1,,,, 1'''' | 7''' 0 |" },
];

describe('Invariant E: jianpu → export → re-import', () => {
  it('includes the jianpu fixtures', () => {
    expect(jianpuCases.length).toBeGreaterThanOrEqual(7);
  });

  it.each(jianpuCases)('$name', ({ text }) => {
    const j = parseJianpu(text);
    if (!j.ok) throw new Error(JSON.stringify(j.errors));
    expect(validateMelody(j.notes, j.metadata).ok).toBe(true);
    expectRoundTrip(j.notes, j.metadata);
  });
});
