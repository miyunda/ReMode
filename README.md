# ReMode

> **Same Melody. Different Mood.**

ReMode is a local-first melody mode lab. You import a monophonic melody, it identifies the
mode (church modes and Chinese 五声 / 六声 / 七声 modes), and later milestones will rewrite
the melody into another mode, play the versions side by side, and export MIDI. Everything
runs in the browser. There is no backend and no AI.

The spec is in [`docs/ReMode-Development-Plan.md`](docs/ReMode-Development-Plan.md) and the
project rules are in [`CLAUDE.md`](CLAUDE.md).

**Status: milestone M0 (Core + CLI).** M0 covers MIDI import, monophony validation and
mode analysis, all from the command line. Transforms, MIDI export, jianpu input and the web
UI come in M1–M2.

## Repository layout

| Path | What |
|---|---|
| `packages/core` | `@remode/core`: pure TypeScript engine (types, scales, MIDI import, validator, analyzer). No DOM, no Node built-ins. |
| `tools/cli` | `@remode/cli`: the `remode` command. |
| `tools/fixtures` | Deterministic MIDI fixture generator, which writes to `fixtures/generated/`. |
| `fixtures/generated` | Committed fixtures and `manifest.json` (description and expected behaviour of each fixture). |
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
node tools/cli/dist/main.js analyze <file.mid> [--track <id|index>] [--repair] [--compact]
```

`analyze` prints one JSON document with these sections:

- `import`: format, PPQ, tempo map, time signatures, key signatures, import warnings, and
  every track (channel, program, note count, pitch range, percussion flag, pitch-bend and
  CC64 flags, and whether it is a melody candidate).
- `selectedTrack` and `validation`: monophony report with structured issues (`EMPTY_TRACK`,
  `PERCUSSION_TRACK`, `SAME_TICK_CHORD`, `DUPLICATE_NOTE`, `OVERLAP` with
  ticks/ms/repairable, `INVALID_*`, `PITCH_BEND_PRESENT`, `SUSTAIN_PEDAL_PRESENT`).
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

| Exit code | Meaning |
|---|---|
| 0 | Analysed |
| 1 | Usage or I/O error |
| 2 | Track selection needed (`TRACK_SELECTION_REQUIRED`, `NO_MELODIC_TRACK`, `TRACK_NOT_FOUND`) |
| 3 | The file could not be imported (`NOT_MIDI`, `TRUNCATED`, `PARSE_FAILED`, …) |
| 4 | The selected track is not a usable monophonic melody (see `validation`) |

Example:

```bash
node tools/cli/dist/main.js analyze fixtures/generated/missing-degrees-cdega.mid
```

The top candidate is `C 宫调式（C 宫系统，五声）`, with evidence such as `FINAL_NOTE` (尾音为 C)
and `PHRASE_END` (1 个非末句中 1 个结束于 C). The analysis also reports `MISSING_DEGREES`:
“旋律未确立第 4、7 级，无法区分 C Ionian / C Mixolydian / C Lydian”.

## Supported input and limitations (M0)

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

The decisions behind these behaviours are in
[`docs/decisions/m0-implementation-notes.md`](docs/decisions/m0-implementation-notes.md).

## Corpus

Calibration (M4) will use the Essen Folksong Collection © CCARH. That corpus is licensed
for personal and academic use only and must not be redistributed, so it is never committed:
local downloads go to the gitignored `corpus/` directory (spec §12.2).
