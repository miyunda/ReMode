# ReMode

> **Same Melody. Different Mood.**

ReMode is a local-first melody mode lab. You import a monophonic melody, it identifies the
mode (church modes and Chinese 五声 / 六声 / 七声 modes), rewrites the melody into another
mode, and exports MIDI; later milestones add side-by-side playback in the browser. Everything
runs in the browser. There is no backend and no AI.

The spec is in [`docs/ReMode-Development-Plan.md`](docs/ReMode-Development-Plan.md) and the
project rules are in [`CLAUDE.md`](CLAUDE.md).

**Status: milestone M1b (strict transforms).** M0 added MIDI import, monophony validation
and mode analysis. M1a added jianpu (numbered notation) input and MIDI export. M1b adds
chromatic transpose and the strict parallel remode (same tonic, new mode), all from the
command line. The web UI comes in M2 and the Expressive optimiser in M3.

## Repository layout

| Path | What |
|---|---|
| `packages/core` | `@remode/core`: pure TypeScript engine (types, scales, MIDI import/export, jianpu parser, validator, analyzer). No DOM, no Node built-ins. |
| `tools/cli` | `@remode/cli`: the `remode` command. |
| `tools/fixtures` | Deterministic fixture generator (MIDI and jianpu text), which writes to `fixtures/generated/`. |
| `fixtures/generated` | Committed `.mid` and `.jianpu` fixtures and `manifest.json` (description and expected behaviour of each fixture). |
| `apps/web` | Placeholder for the M2 browser workbench. |

## Setup

Requires Node ≥ 24 and pnpm 12.16.1 (pinned via `packageManager`; `corepack enable` will
pick it up).

```bash
pnpm install
pnpm typecheck
pnpm lint        # ESLint + Prettier check
pnpm test
pnpm build
pnpm smoke       # runs the built CLI once
```

After changing `tools/fixtures/src/catalog.ts`, regenerate the fixtures with
`pnpm fixtures` and commit the result. The tests fail if the committed fixtures differ from
a fresh generation.

## CLI

```bash
pnpm build
node tools/cli/dist/main.js analyze <file.mid|file.jianpu|file.txt> [--track <id|index>] [--repair] [--compact]
node tools/cli/dist/main.js analyze --jianpu "<jianpu text>" [--compact]
node tools/cli/dist/main.js export <file.jianpu|file.txt> [-o <out.mid>] [--compact]
node tools/cli/dist/main.js export --jianpu "<jianpu text>" [-o <out.mid>] [--compact]
node tools/cli/dist/main.js transpose <input> --semitones <n> [--no-range] [-o <out.mid>]
node tools/cli/dist/main.js remode <input> --to [<root>:]<scaleId> [--from <root>:<scaleId>] \
    [--accidentals nearest|preserve|reject] [--strategy strict] [--no-range] [-o <out.mid>]
```

All commands take their input the same way: either a positional file or inline jianpu text
with `--jianpu "<text>"` (always text, never a path). Giving both, or neither, is a usage
error. A file's format follows its extension: `.jianpu` and `.txt` are read as UTF-8 jianpu
text, and anything else (`.mid`, `.midi`) as a Standard MIDI File.

`analyze` prints one JSON document with these sections:

- `input`: file name (`null` for `--jianpu` text), `format` (`midi` or `jianpu`) and size.
- `import`: for MIDI, the format, PPQ, tempo map, time signatures, key signatures, import
  warnings, and every track (channel, program, note count, pitch range, percussion flag,
  pitch-bend and CC64 flags, and whether it is a melody candidate). For jianpu, the parser
  version, the header (key, reference pitch, time signature, BPM), the bars, and warnings
  such as `BAR_DURATION_MISMATCH`; on failure, `errors` with `code`, `line` and `column`.
- `selectedTrack` and `validation`: monophony report with structured issues (`EMPTY_TRACK`,
  `PERCUSSION_TRACK`, `SAME_TICK_CHORD`, `DUPLICATE_NOTE`, `OVERLAP` with
  ticks/ms/repairable, `INVALID_*`, `PITCH_BEND_PRESENT`, `SUSTAIN_PEDAL_PRESENT`). Jianpu
  input is a single melody, so `selectedTrack` is `"jianpu"`.
- `repair`: present only with `--repair`. It lists every trimmed legato tail. The source
  notes are never modified; the analysis runs on the cleaned copy.
- `analysis`: `analysisVersion` and the full `config`, the PCD, compatible and selected
  collections, the phrases, the ranked `candidates` (each with named `tonicEvidence`,
  integer points and aliases), the `ambiguities` (`MISSING_DEGREES`,
  `MULTIPLE_COLLECTIONS`, `TONIC_UNCLEAR`, `CHROMATIC_HEAVY`, `TOO_SHORT` with the affected
  scale IDs), and the Krumhansl–Schmuckler `baseline`, which is for comparison only and
  never used for ranking.
- `errors`: structured errors.

ReMode never outputs a percentage or a confidence value.

`export` converts jianpu to MIDI with no transform: the notes, tempo, time signature and the
key signature implied by `1=X` (X major) are written as parsed. Without `-o` the file goes to
the current directory as `<source>-original.mid` (`melody-original.mid` for `--jianpu` text).
The JSON report lists the output file and any export warnings. MIDI input is rejected with a
usage error (exit code 1), because there is nothing to convert; use `transpose` or `remode`.

`transpose` adds `n` semitones to every note (`--semitones -3` and `--semitones=-3` both
work). IDs, ticks, durations and velocities are kept. Source key signatures are omitted
(warning `KEY_SIGNATURES_OMITTED`) unless `n` is a multiple of 12. The default output name
is `<source>-transpose-up<n>.mid` or `-down<n>.mid`.

`remode` is the strict parallel remode (spec §7.3): the tonic stays and every note moves to
the target's degree with the same number (by degree identity), in the same octave. Between
two 五声 modes, or two 六声 modes of the same type, the k-th tone above the tonic maps to the
target's k-th tone instead (`SCALE_POSITION_MAPPED`; 宫 → 羽 is 1→1, 2→♭3, 3→4, 5→5, 6→♭7),
because their degree numbers differ. For seven-tone scales the two rules agree. Timing is
never changed.

- The source mode is the rank-1 analysis candidate. If the analysis is ambiguous at rank 1
  (several rank-1 modes, `TONIC_UNCLEAR`, `MULTIPLE_COLLECTIONS`, `CHROMATIC_HEAVY` or
  `TOO_SHORT`), the command stops with exit code 6 and asks for `--from <root>:<scaleId>`
  (for example `--from C:ionian` or `--from A:pentatonic-yu`). `MISSING_DEGREES` alone does
  not stop it, because the rank-1 candidate is then the smaller collection (e.g. 五声).
- `--to` takes a scale id (`dorian`, `lydian`, `pentatonic-yu`, `qingyue-gong`, …). With a
  root (`--to A:dorian`) the tonic changes too: the report shows two `steps`, a transpose
  (the smaller move, −5 to +6 semitones) and then the parallel remode.
- A degree the target lacks (a 偏音 going into 五声, for example) goes to the upper or lower
  target neighbour: first the one that keeps the direction of the step to the next note,
  then the nearer one, then the one nearer the tonic. These notes carry `SCALE_CONSTRAINT`.
- Notes outside the source scale follow `--accidentals`: `nearest` (default, same neighbour
  rule, `ACCIDENTAL_NEAREST`), `preserve` (kept as they are; the target is then not strict)
  or `reject` (exit code 7, nothing written).
- The whole result is shifted by whole octaves only if it leaves the soft range 21–108
  (`RANGE_SHIFTED`, `RANGE_NO_FIT`). `--no-range` turns this off; pitches outside MIDI 0–127
  are then an error.

The `remode` report adds `sourceAnalysis`, `sourceMode` (`via` `analysis` or `option`),
`targetMode`, `transform` (all settings and `remode-strict/1.1.0`), `steps` (tonic change
only), `summary`, `diff` (every changed note with `from`/`to`, `reasonCode` and an
explanation), `warnings`, `diagnostics` (degree table, characteristic-degree exposure,
contour, range), `recheck` and the `output`/`export` sections. Warnings include
`NO_CHARACTERISTIC_DEGREE` (the melody never sounds a degree that differs between the two
modes, so the output equals the input), `CONTOUR_REVERSED` and `REPETITION_INTRODUCED`
(diagnostics for M3). `recheck` runs the analyzer on the output and says whether the target
is a rank-1 candidate. It is a diagnostic, and “not recognised” is a valid answer. The MIDI
file carries the target's key signature and a `ReMode mode: …` text event, and the default
name is `<source>-<root>-<scaleId>-strict.mid`.

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | Usage or I/O error |
| 2 | Track selection needed (`TRACK_SELECTION_REQUIRED`, `NO_MELODIC_TRACK`, `TRACK_NOT_FOUND`) |
| 3 | The input could not be imported or parsed (`NOT_MIDI`, `TRUNCATED`, `UNSUPPORTED_TUPLET`, …) |
| 4 | The selected track is not a usable monophonic melody (see `validation`) |
| 5 | The MIDI file could not be encoded |
| 6 | `remode`: the source mode is ambiguous at rank 1; pass `--from` |
| 7 | The transform failed (`ACCIDENTAL_REJECTED`, `PITCH_OUT_OF_RANGE`, …) |

Example:

```bash
node tools/cli/dist/main.js analyze fixtures/generated/missing-degrees-cdega.mid
```

The top candidate is `C 宫调式（C 宫系统，五声）`, with evidence such as `FINAL_NOTE` (尾音为 C)
and `PHRASE_END` (1 个非末句中 1 个结束于 C). The analysis also reports `MISSING_DEGREES`:
“旋律未确立第 4、7 级，无法区分 C Ionian / C Mixolydian / C Lydian；同样无法区分的中国七声读法：…”, listing the 清乐/雅乐/燕乐 readings as well.
Analysing `fixtures/generated/missing-degrees-cdega.jianpu`, the same melody in jianpu, gives
the same analysis.

Strict remode examples:

```bash
node tools/cli/dist/main.js remode fixtures/generated/mode-church-c-ionian.jianpu --to dorian
# → mode-church-c-ionian-C-dorian-strict.mid; diff: E4→Eb4 ×3, B4→Bb4 ×2 (DEGREE_MAPPED)
node tools/cli/dist/main.js remode fixtures/generated/missing-degrees-cdega.jianpu --from C:ionian --to lydian
# → no changes; NO_CHARACTERISTIC_DEGREE (the melody has no 4th degree), recheck.recognised = false
```

## Jianpu

```text
// C Dorian, written 首调: 宫 = Bb, so the tonic is 2.
1=Bb 4/4 ♩=120
| 2, 4, 6, 5, | 4, 3, 2, - |
| 6, 7, 1 2 | 1 7, 6, 5, | 4, 3, 2, - |
```

| Syntax | Meaning |
|---|---|
| `1=C`, `1=F#`, `1=Bb` | Key: the pitch of `1`. An unmarked `1` is in octave 4 (`1=C` → C4 = MIDI 60, `1=G` → G4). Default `1=C`, with a warning. |
| `4/4`, `6/8` | Time signature. Default 4/4, with a warning. |
| `bpm=96` or `♩=96` | Tempo. Default 120. |
| `1`–`7`, `0` | Scale degrees of the major scale on the key; `0` is a rest. A bare digit is a quarter note. |
| `#4`, `b7` | Sharp / flat prefix. |
| `1'`, `1''`, `5,`, `5,,` | Octave up / down, stackable. |
| `5_`, `5__` | Eighth / sixteenth. |
| `6.`, `6_.` | Dot: adds half the note's value. |
| `-` | Adds one beat (a quarter note) to the previous note or rest, even across a barline. |
| `\|` | Barline. A bar whose length does not match the time signature is a warning, not an error. |
| `// …` | Comment to the end of the line. |

Headers must come before the first note. Tuplets, slurs, ornaments, repeats, double
accidentals, double dots, thirty-seconds and mid-piece key, tempo or time changes are
rejected with a structured error (`code`, `line`, `column`). Every note gets velocity 96/127
and a stable ID `jianpu:n<k>`. The full rules are in spec §10.8.1.

## Supported input and limitations

Supported: Standard MIDI Files of format 0 and 1 that use ticks-per-quarter-note timing.
Multi-track files are supported; Type 0 files are split into one track per channel.

Not supported:

- **MIDI format 2** (independent sequences) is rejected with `UNSUPPORTED_FORMAT`.
- **SMPTE time division** is rejected with `SMPTE_TIMING`.
- Files over 4 MiB or with more than 20 000 notes are rejected. These are initial limits
  and will be tuned after performance testing.
- Polyphonic tracks are not analysed. Same-tick chords and overlaps beyond the legato
  tolerance (min(15 ms, PPQ/16)) are reported as errors.
- Percussion tracks (channel 10) are listed but never treated as melodies.
- Pitch bend is ignored; analysis uses discrete note numbers. The sustain pedal (CC64)
  produces a warning only.
- Tracks are split by (channel, program) by `@tonejs/midi`, so a program change in the
  middle of a channel splits that line into two tracks. A note-less first track in a
  format 1 file (the conductor track) is not listed.
- A note-on without a matching note-off is dropped by the parser and is not reported.
- Strong-beat evidence assumes there is no anacrusis (pickup).
- Evidence points are initial, uncalibrated values (calibration is planned for M4).

### MIDI export and round-trip support matrix

The exporter writes a format 1 file: a conductor track and one melody track. The round-trip
tests (import or parse → export → re-import, Invariant E) cover every generated MIDI fixture
that passes validation and every jianpu fixture.

| Data | Round-trip | Notes |
|---|---|---|
| Note count, pitch, start tick, duration | Exact | Ticks are never re-derived from seconds. |
| Velocity | Exact for 7-bit values (k/127) | Other values are rounded (`VELOCITY_QUANTIZED`); 0 is written as 1/127 (`VELOCITY_ZERO_RAISED`), because a note-on with velocity 0 is a note-off. |
| PPQ | Exact | |
| Tempo map | Exact to the microsecond per quarter note | MIDI stores whole microseconds; other tempos (e.g. jianpu `bpm=70`) are rounded (`TEMPO_ROUNDED`). |
| Time signatures | Exact (numerator, denominator, tick) | The MIDI clocks-per-click and 32nds fields are always written as 24 and 8. |
| Key signatures | Exact for −7…+7 accidentals, major or minor | Unencodable entries are dropped (`KEY_SIGNATURE_DROPPED`). With a target mode, the collection's key signature is written and the mode goes in a text event (spec §11.1). |
| Channel, program, track name | Exact | Track names are written as UTF-8. |
| Pitch bend, CC64 and other controllers | Not exported | Reported as `PITCH_BEND_DROPPED` / `SUSTAIN_PEDAL_DROPPED` when the caller passes the source flags. |
| Other tracks, SysEx, lyrics, markers, other meta events | Not exported | Only the selected melody is written; `TRACKS_DROPPED` when the caller says so. |
| Format 0 source | Written as format 1 | Re-import yields the same melody track. |

The decisions behind these behaviours are in
[`docs/decisions/m0-implementation-notes.md`](docs/decisions/m0-implementation-notes.md) and
[`docs/decisions/m1a-implementation-notes.md`](docs/decisions/m1a-implementation-notes.md).

## Corpus

Calibration (M4) will use the Essen Folksong Collection © CCARH. That corpus is licensed
for personal and academic use only and must not be redistributed, so it is never committed:
local downloads go to the gitignored `corpus/` directory (spec §12.2).

## License

ReMode is released under the [MIT License](LICENSE). The license covers this repository's code,
documentation and generated fixtures only. It does not cover third-party data such as the Essen
Folksong Collection, which is under CCARH's own terms (see [Corpus](#corpus)).
