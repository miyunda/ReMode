// Fixture catalog: every generated file with a description and the behaviour
// tests assert against it. Regenerate with `pnpm fixtures`.

import {
  chunk,
  controller,
  header,
  melody,
  midiOf,
  note,
  pitchBend,
  program,
  tempo,
  timeSignature,
  trackBody,
  trackName,
  writeSmf,
  type SmfEvent,
  type Step,
} from './smf.js';

export interface FixtureExpectation {
  /** MIDI fixtures only. */
  import?: {
    ok: boolean;
    errorCode?: string;
    format?: 0 | 1;
    ppq?: number;
    /** Tracks with notes that are not percussion. */
    melodyTracks?: number;
    percussionTracks?: number;
    emptyTracks?: number;
    warnings?: string[];
    tempoCount?: number;
    timeSignatureCount?: number;
  };
  validation?: {
    trackId: string;
    ok: boolean;
    monophonic: boolean;
    /** Codes that must be present (others may appear too). */
    codes: string[];
    /** OVERLAP issues the safe repair may fix. */
    repairable?: number;
  };
  /** Jianpu fixtures only (`.jianpu`, UTF-8 text). */
  jianpu?: {
    noteCount: number;
    /** Parser warning codes, exactly. */
    warnings: string[];
    /** MIDI fixture with the same melody: same notes, same analysis. */
    twin?: string;
  };
  analysis?: {
    /** MIDI fixtures: the track to analyse. */
    trackId?: string;
    /** Expected rank-1 tonic and scale; omitted when the sample is meant to be unclear. */
    top?: { root: string; scaleId: string; name?: string; aliases?: string[] };
    /** Ambiguity codes that must be present. */
    ambiguities: string[];
    /** Ambiguity codes that must be absent. */
    absent?: string[];
    /** MISSING_DEGREES must name at least these scale IDs. */
    missingDegreesScaleIds?: string[];
  };
}

export interface Fixture {
  file: string;
  description: string;
  expect: FixtureExpectation;
  bytes: Uint8Array;
}

const PPQ = 480;
const conductor = (): SmfEvent[] => [tempo(0, 120), timeSignature(0, 4, 4)];
const single = (events: SmfEvent[]): Uint8Array =>
  writeSmf({ format: 1, ppq: PPQ, tracks: [[...conductor(), ...events]] });

// --- Church modes: same tonic C, every degree used, cadences on the tonic ----

const CHURCH: Array<[string, string, number[]]> = [
  ['ionian', 'Ionian', [0, 2, 4, 5, 7, 9, 11]],
  ['dorian', 'Dorian', [0, 2, 3, 5, 7, 9, 10]],
  ['phrygian', 'Phrygian', [0, 1, 3, 5, 7, 8, 10]],
  ['lydian', 'Lydian', [0, 2, 4, 6, 7, 9, 11]],
  ['mixolydian', 'Mixolydian', [0, 2, 4, 5, 7, 9, 10]],
  ['aeolian', 'Aeolian', [0, 2, 3, 5, 7, 8, 10]],
  ['locrian', 'Locrian', [0, 1, 3, 5, 6, 8, 10]],
];

/** Phrase A: 1 3 5 4 3 2 1(half); phrase B: 5 6 7 8 7 6 5 4 3 2 1(half). */
// prettier-ignore
const DEGREE_PLAN: Array<[number, number]> = [
  [1, 1], [3, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 2],
  [5, 1], [6, 1], [7, 1], [8, 1], [7, 1], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 2],
];

function heptatonicMelody(intervals: number[], tonicMidi: number): Step[] {
  return DEGREE_PLAN.map(([d, beats]) => [
    tonicMidi + (intervals[(d - 1) % 7] as number) + 12 * Math.floor((d - 1) / 7),
    beats,
  ]);
}

// --- Chinese pentatonic: C 宫系统, five different finals ----------------------

const C_GONG_PENTATONIC = [0, 2, 4, 7, 9];
const PENTA_DEGREES: Array<[string, string, string]> = [
  ['gong', '宫', 'C4'],
  ['shang', '商', 'D4'],
  ['jue', '角', 'E4'],
  ['zhi', '徵', 'G3'],
  ['yu', '羽', 'A3'],
];

/** Scale steps (0 = tonic, 5 = octave): 0 1 2 3 2 1 0(half) | 2 3 4 5 4 3 2 1 0(whole). */
// prettier-ignore
const PENTA_PLAN: Array<[number, number]> = [
  [0, 1], [1, 1], [2, 1], [3, 1], [2, 1], [1, 1], [0, 2],
  [2, 1], [3, 1], [4, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 1], [0, 4],
];

function pentatonicMelody(tonicMidi: number, gongPc: number): Step[] {
  const tonicPc = tonicMidi % 12;
  const rel = C_GONG_PENTATONIC.map((pc) => (pc + gongPc - tonicPc + 24) % 12).sort(
    (a, b) => a - b,
  );
  return PENTA_PLAN.map(([s, beats]) => [
    tonicMidi + (rel[s % 5] as number) + 12 * Math.floor(s / 5),
    beats,
  ]);
}

const steps = (spec: string): Step[] =>
  spec
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [n, b] = tok.split(':') as [string, string | undefined];
      return [n === 'r' ? null : midiOf(n), b === undefined ? 1 : Number(b)] as const;
    });

// --- Catalog -------------------------------------------------------------------

export function buildFixtures(): Fixture[] {
  const out: Fixture[] = [];
  const add = (file: string, description: string, expect: FixtureExpectation, bytes: Uint8Array) =>
    out.push({ file, description, expect, bytes });

  for (const [id, label, intervals] of CHURCH) {
    add(
      `mode-church-c-${id}.mid`,
      `C ${label}: every degree used, both phrases cadence on C.`,
      {
        import: { ok: true, format: 1, ppq: PPQ, melodyTracks: 1 },
        validation: { trackId: 'track-0', ok: true, monophonic: true, codes: [] },
        analysis: {
          trackId: 'track-0',
          top: { root: 'C', scaleId: id, name: `C ${label}` },
          ambiguities: [],
          absent: ['MISSING_DEGREES', 'TONIC_UNCLEAR', 'TOO_SHORT', 'CHROMATIC_HEAVY'],
        },
      },
      single([trackName(`C ${label}`), ...melody(heptatonicMelody(intervals, 60), PPQ)]),
    );
  }

  for (const [degree, zh, tonic] of PENTA_DEGREES) {
    const root = tonic.replace(/\d/, '');
    add(
      `mode-pentatonic-c-gong-${degree}.mid`,
      `C 宫系统五声, final ${root} → ${root} ${zh}调式. Same pitch set as the other four, different 结音.`,
      {
        import: { ok: true, format: 1, melodyTracks: 1 },
        validation: { trackId: 'track-0', ok: true, monophonic: true, codes: [] },
        analysis: {
          trackId: 'track-0',
          top: {
            root,
            scaleId: `pentatonic-${degree}`,
            name: `${root} ${zh}调式（C 宫系统，五声）`,
          },
          ambiguities: ['MISSING_DEGREES'],
          absent: ['TONIC_UNCLEAR', 'TOO_SHORT', 'MULTIPLE_COLLECTIONS'],
        },
      },
      single([trackName(`${root} ${zh}`), ...melody(pentatonicMelody(midiOf(tonic), 0), PPQ)]),
    );
  }

  add(
    'missing-degrees-cdega.mid',
    'Only C D E G A, ending on C: C 宫 (五声); cannot tell C Ionian / Lydian / Mixolydian.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      analysis: {
        trackId: 'track-0',
        top: { root: 'C', scaleId: 'pentatonic-gong' },
        ambiguities: ['MISSING_DEGREES'],
        absent: ['TONIC_UNCLEAR'],
        missingDegreesScaleIds: ['ionian', 'lydian', 'mixolydian'],
      },
    },
    single(melody(steps('C4 E4 G4 A4 G4 E4 D4 C4:2 E4 G4 A4 C5 A4 G4 E4 D4 C4:4'), PPQ)),
  );

  add(
    'mode-hexatonic-d-shang-qingjiao.mid',
    'C D E F G A ending on D: D 商调式 (C 宫系统，六声加清角), also readable as D 羽 (F 宫加变宫).',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      analysis: {
        trackId: 'track-0',
        top: {
          root: 'D',
          scaleId: 'hexa-qingjiao-shang',
          name: 'D 商调式（C 宫系统，六声加清角）',
          aliases: ['hexa-biangong-yu'],
        },
        ambiguities: ['MISSING_DEGREES'],
        absent: ['TONIC_UNCLEAR'],
        missingDegreesScaleIds: ['dorian', 'aeolian'],
      },
    },
    single(melody(steps('D4 E4 F4 G4 A4 G4 F4 E4 D4:2 A4 C5 A4 G4 F4 E4 C4 E4 D4:4'), PPQ)),
  );

  add(
    'mode-qingyue-a-yu.mid',
    'A 羽调式 (C 宫系统，七声清乐) — the same pitch structure as A Aeolian.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      analysis: {
        trackId: 'track-0',
        top: {
          root: 'A',
          scaleId: 'aeolian',
          aliases: ['qingyue-yu', 'yayue-jue', 'yanyue-shang'],
        },
        ambiguities: [],
        absent: ['MISSING_DEGREES', 'TONIC_UNCLEAR'],
      },
    },
    single(melody(heptatonicMelody([0, 2, 3, 5, 7, 8, 10], 57), PPQ)),
  );

  add(
    'tonic-unclear-pentatonic.mid',
    'C 宫五声 whose phrases and long notes stress A but which ends on a short D.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      analysis: { trackId: 'track-0', ambiguities: ['TONIC_UNCLEAR'] },
    },
    single(melody(steps('A3:2 C4 D4 C4 D4 A3:2 C4 D4 E4 G4 E4 D4 A3:2 C4 E4 D4'), PPQ)),
  );

  add(
    'chromatic-twelve-tone.mid',
    'All 12 pitch classes with equal duration: no collection reaches the threshold and all 12 diatonic sets tie.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      analysis: {
        trackId: 'track-0',
        ambiguities: ['CHROMATIC_HEAVY'],
        absent: ['MULTIPLE_COLLECTIONS'],
      },
    },
    single(melody(steps('C4 Db4 D4 Eb4 E4 F4 F#4 G4 Ab4 A4 Bb4 B4'), PPQ)),
  );

  add(
    'short-three-notes.mid',
    'C D C: too short to judge.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: { trackId: 'track-0', ok: true, monophonic: true, codes: [] },
      analysis: { trackId: 'track-0', ambiguities: ['TOO_SHORT'] },
    },
    single(melody(steps('C4 D4 C4:2'), PPQ)),
  );

  add(
    'short-repeated-note.mid',
    'E E E E: one pitch class only.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      analysis: { trackId: 'track-0', ambiguities: ['TOO_SHORT'] },
    },
    single(melody(steps('E4 E4 E4 E4:2'), PPQ)),
  );

  // --- Monophony validation --------------------------------------------------

  const line = steps('C4 D4 E4 F4 G4 A4 B4 C5:2');
  add(
    'overlap-legato.mid',
    'D4 starts 5 ticks before C4 ends (≈5 ms at 120 BPM / 480 PPQ): repairable legato tail.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: {
        trackId: 'track-0',
        ok: true,
        monophonic: false,
        codes: ['OVERLAP'],
        repairable: 1,
      },
    },
    single([...note(0, 60, 0, PPQ + 5), ...melody(line.slice(1), PPQ, 0, PPQ)]),
  );

  add(
    'overlap-heavy.mid',
    'C4 sustains half a beat into D4: beyond tolerance, rejected.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: {
        trackId: 'track-0',
        ok: false,
        monophonic: false,
        codes: ['OVERLAP'],
        repairable: 0,
      },
    },
    single([...note(0, 60, 0, PPQ + 240), ...melody(line.slice(1), PPQ, 0, PPQ)]),
  );

  add(
    'overlap-nested.mid',
    'A whole-note C4 under E4 and G4: nested overlap caught via the running max end tick.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: {
        trackId: 'track-0',
        ok: false,
        monophonic: false,
        codes: ['OVERLAP'],
        repairable: 0,
      },
    },
    single([
      ...note(0, 60, 0, 4 * PPQ),
      ...note(0, 64, PPQ, PPQ),
      ...note(0, 67, 2 * PPQ, PPQ),
      ...melody(steps('A4 B4 C5:2'), PPQ, 0, 4 * PPQ),
    ]),
  );

  add(
    'same-tick-chord.mid',
    'C4 and E4 start on the same tick: a chord, never repairable by trimming.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: {
        trackId: 'track-0',
        ok: false,
        monophonic: false,
        codes: ['SAME_TICK_CHORD'],
        repairable: 0,
      },
    },
    single([...note(0, 64, 0, PPQ), ...note(0, 60, 0, PPQ), ...melody(line.slice(1), PPQ, 0, PPQ)]),
  );

  add(
    'zero-length-note.mid',
    'A note-on immediately followed by its note-off at the same tick.',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: { trackId: 'track-0', ok: false, monophonic: true, codes: ['INVALID_DURATION'] },
    },
    single([...note(0, 62, 0, 0), ...melody(line, PPQ, 0, PPQ)]),
  );

  add(
    'pitch-bend-sustain.mid',
    'Clean monophonic line that uses pitch bend and the sustain pedal (CC64).',
    {
      import: { ok: true, format: 1, melodyTracks: 1 },
      validation: {
        trackId: 'track-0',
        ok: true,
        monophonic: true,
        codes: ['PITCH_BEND_PRESENT', 'SUSTAIN_PEDAL_PRESENT'],
      },
    },
    single([
      controller(0, 64, 127, 0),
      pitchBend(0, 8192 + 1024, PPQ),
      pitchBend(0, 8192, 2 * PPQ),
      controller(0, 64, 0, 4 * PPQ),
      ...melody(line, PPQ),
    ]),
  );

  // --- Track layout ------------------------------------------------------------

  const dorian = steps('D4 F4 A4 G4 F4 E4 D4:2 A4 B4 C5 B4 A4 G4 F4 E4 D4:4');
  add(
    'type0-multichannel.mid',
    'Type 0: melody on channel 1, bass on channel 2, drums on channel 10, all in one track.',
    {
      import: {
        ok: true,
        format: 0,
        melodyTracks: 2,
        percussionTracks: 1,
        warnings: ['TYPE0_SPLIT_BY_CHANNEL'],
      },
      validation: { trackId: 'track-0', ok: true, monophonic: true, codes: [] },
      analysis: {
        trackId: 'track-0',
        top: { root: 'D', scaleId: 'dorian' },
        ambiguities: [],
        absent: ['TONIC_UNCLEAR'],
      },
    },
    writeSmf({
      format: 0,
      ppq: PPQ,
      tracks: [
        [
          ...conductor(),
          program(0, 73),
          program(1, 32),
          ...melody(dorian, PPQ, 0),
          ...melody(steps('D2:4 A2:4 D2:4 A2:4 D2:4'), PPQ, 1),
          ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((b) => note(9, b % 2 ? 38 : 36, b * PPQ, PPQ / 2)),
        ],
      ],
    }),
  );

  add(
    'type1-empty-percussion.mid',
    'Type 1: conductor track, a named empty track, a drum track (channel 10) and the melody.',
    {
      import: { ok: true, format: 1, melodyTracks: 1, percussionTracks: 1, emptyTracks: 1 },
      validation: { trackId: 'track-1', ok: false, monophonic: true, codes: ['PERCUSSION_TRACK'] },
      analysis: { trackId: 'track-2', top: { root: 'D', scaleId: 'dorian' }, ambiguities: [] },
    },
    writeSmf({
      format: 1,
      ppq: PPQ,
      tracks: [
        [...conductor(), trackName('Conductor')],
        [trackName('Empty')],
        [trackName('Drums'), ...[0, 1, 2, 3].flatMap((b) => note(9, 42, b * PPQ, PPQ / 4))],
        [trackName('Melody'), program(0, 0), ...melody(dorian, PPQ, 0)],
      ],
    }),
  );

  const ppq96 = 96;
  add(
    'tempo-timesig-changes.mid',
    'PPQ 96; 120 → 90 BPM and 4/4 → 3/4 at bar 3; D Dorian line.',
    {
      import: {
        ok: true,
        format: 1,
        ppq: ppq96,
        melodyTracks: 1,
        tempoCount: 2,
        timeSignatureCount: 2,
      },
      validation: { trackId: 'track-0', ok: true, monophonic: true, codes: [] },
      analysis: { trackId: 'track-0', top: { root: 'D', scaleId: 'dorian' }, ambiguities: [] },
    },
    writeSmf({
      format: 1,
      ppq: ppq96,
      tracks: [
        [
          tempo(0, 120),
          timeSignature(0, 4, 4),
          tempo(8 * ppq96, 90),
          timeSignature(8 * ppq96, 3, 4),
          ...melody(
            steps('D4 F4 A4 G4 F4 E4 D4:2 A4 B4 C5 D5 C5 B4 A4 G4 F4 E4 C4 E4 D4:3'),
            ppq96,
          ),
        ],
      ],
    }),
  );

  // --- Jianpu sources (spec §10.8, ADR-016) ------------------------------------
  // Each has a MIDI twin above with exactly the same notes and meter, so
  // analysis must agree whatever the input format.

  const jianpu = (
    file: string,
    description: string,
    text: string,
    jianpuExpect: NonNullable<FixtureExpectation['jianpu']>,
  ) => {
    const twin = out.find((f) => f.file === jianpuExpect.twin);
    const analysis = twin?.expect.analysis;
    const expectation: FixtureExpectation = { jianpu: jianpuExpect };
    if (analysis) {
      expectation.analysis = { ...analysis };
      delete expectation.analysis.trackId; // a jianpu source is a single melody
    }
    add(file, description, expectation, new TextEncoder().encode(text));
  };

  jianpu(
    'mode-church-c-ionian.jianpu',
    'C Ionian in 1=C, as in mode-church-c-ionian.mid: every degree used. Source of the M1b strict remode tests.',
    `// C Ionian: every degree, both phrases end on 1.
1=C 4/4 ♩=120
| 1 3 5 4 | 3 2 1 - |
| 5 6 7 1' | 7 6 5 4 | 3 2 1 - |
`,
    { noteCount: 18, warnings: [], twin: 'mode-church-c-ionian.mid' },
  );

  jianpu(
    'mode-church-c-dorian.jianpu',
    'C Dorian written 首调 (1=Bb, the tonic is 2), as in mode-church-c-dorian.mid.',
    `// C Dorian: Bb 宫系统, tonic 2 (re).
1=Bb 4/4 ♩=120
| 2, 4, 6, 5, | 4, 3, 2, - |
| 6, 7, 1 2 | 1 7, 6, 5, | 4, 3, 2, - |
`,
    { noteCount: 18, warnings: [], twin: 'mode-church-c-dorian.mid' },
  );

  jianpu(
    'mode-pentatonic-c-gong-zhi.jianpu',
    'G 徵调式 (C 宫系统，五声) ending on 5, as in mode-pentatonic-c-gong-zhi.mid.',
    `// G 徵调式（C 宫系统，五声）
1=C 4/4
| 5, 6, 1 2 | 1 6, 5, - |
| 1 2 3 5 | 3 2 1 6, | 5, - - - |
`,
    { noteCount: 16, warnings: [], twin: 'mode-pentatonic-c-gong-zhi.mid' },
  );

  jianpu(
    'missing-degrees-cdega.jianpu',
    'Only 1 2 3 5 6 in 1=C, as in missing-degrees-cdega.mid. The final bar is one beat long: a warning, not an error.',
    `// C D E G A only: MISSING_DEGREES between C Ionian / Lydian / Mixolydian.
1=C 4/4
| 1 3 5 6 | 5 3 2 1 | - 3 5 6 |
| 1' 6 5 3 | 2 1 - - | - |
`,
    { noteCount: 17, warnings: ['BAR_DURATION_MISMATCH'], twin: 'missing-degrees-cdega.mid' },
  );

  // --- Malformed / unsupported ---------------------------------------------------

  const malformed = (file: string, description: string, errorCode: string, bytes: number[]) =>
    add(file, description, { import: { ok: false, errorCode } }, Uint8Array.from(bytes));

  malformed('malformed-empty.mid', 'Zero bytes.', 'EMPTY_FILE', []);
  malformed('malformed-not-midi.mid', 'Plain text with a .mid extension.', 'NOT_MIDI', [
    ...new TextEncoder().encode('This is definitely not a MIDI file.\n'),
  ]);
  malformed(
    'malformed-truncated.mid',
    'MTrk chunk declares 1000 bytes; the file ends after 8.',
    'TRUNCATED',
    [
      ...header(1, 1, PPQ),
      ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0x03, 0xe8],
      0,
      0x90,
      60,
      100,
      0x60,
      0x80,
      60,
      0,
    ],
  );
  malformed(
    'malformed-running-status.mid',
    'A data byte with no preceding status byte.',
    'PARSE_FAILED',
    [...header(1, 1, PPQ), ...chunk('MTrk', [0x00, 0x40, 0x40, 0x00, 0xff, 0x2f, 0x00])],
  );
  malformed(
    'unsupported-format2.mid',
    'MIDI format 2 (independent sequences).',
    'UNSUPPORTED_FORMAT',
    [...header(2, 1, PPQ), ...chunk('MTrk', trackBody(melody(line, PPQ)))],
  );
  malformed(
    'unsupported-smpte.mid',
    'SMPTE time division (25 fps, 40 ticks per frame).',
    'SMPTE_TIMING',
    [...header(1, 1, 0xe728), ...chunk('MTrk', trackBody(melody(line, PPQ)))],
  );

  return out;
}
