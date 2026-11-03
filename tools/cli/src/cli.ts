import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ANALYSIS_VERSION,
  analyzeMode,
  importMidi,
  melodyCandidates,
  repairLegatoOverlaps,
  trackMetadata,
  validateTrack,
  type CleanedSource,
  type ImportedTrack,
  type ModeAnalysis,
  type ParsedMidi,
  type ValidationReport,
} from '@remode/core';

export const CLI_VERSION = '0.1.0';

export const EXIT = {
  OK: 0,
  USAGE: 1,
  TRACK_SELECTION: 2,
  IMPORT_FAILED: 3,
  VALIDATION_FAILED: 4,
} as const;

export const USAGE = `Usage: remode analyze <file.mid> [--track <id|index>] [--repair] [--compact]

Prints a JSON report: parse info, track list, validation, mode candidates with
tonic evidence, and ambiguity codes.

Options:
  --track <id|index>  Track to analyse ("track-2" or 2). Required when the file
                      has more than one non-empty, non-percussion track.
  --repair            Apply the safe legato-tail repair and analyse the cleaned
                      source (every change is listed under "repair").
  --compact           Single-line JSON.
  -h, --help          Show this help.
  -v, --version       Show versions.

Exit codes: 0 ok, 1 usage/IO error, 2 track selection needed or invalid,
3 file could not be imported, 4 track failed validation.`;

export interface CliIo {
  readFile(path: string): Uint8Array;
  stdout(text: string): void;
  stderr(text: string): void;
}

interface CliError {
  code: string;
  message: string;
}

interface Report {
  remode: { cli: string; analysisVersion: string };
  input: { file: string; bytes: number };
  import: ReturnType<typeof importSummary> | { ok: false; error: CliError };
  selectedTrack: string | null;
  validation: ValidationReport | null;
  repair: Pick<CleanedSource, 'repairs' | 'unrepaired'> | null;
  analysis: ModeAnalysis | null;
  errors: CliError[];
}

function importSummary(midi: ParsedMidi) {
  const melodic = new Set(melodyCandidates(midi).map((t) => t.id));
  return {
    ok: true as const,
    format: midi.format,
    declaredTrackCount: midi.declaredTrackCount,
    ppq: midi.metadata.ppq,
    tempoMap: midi.metadata.tempoMap,
    timeSignatures: midi.metadata.timeSignatures,
    keySignatures: midi.metadata.keySignatures ?? [],
    warnings: midi.warnings,
    tracks: midi.tracks.map((t) => ({
      id: t.id,
      index: t.index,
      name: t.name,
      channel: t.channel + 1,
      program: t.instrumentProgram,
      noteCount: t.noteCount,
      pitchRange: t.pitchRange,
      isPercussion: t.isPercussion,
      hasPitchBend: t.hasPitchBend,
      hasSustainPedal: t.hasSustainPedal,
      melodyCandidate: melodic.has(t.id),
    })),
  };
}

function selectTrack(midi: ParsedMidi, wanted: string | undefined): ImportedTrack | CliError {
  if (wanted !== undefined) {
    const found = midi.tracks.find((t) => t.id === wanted || String(t.index) === wanted);
    return (
      found ?? {
        code: 'TRACK_NOT_FOUND',
        message: `No track "${wanted}". Available: ${midi.tracks.map((t) => t.id).join(', ')}.`,
      }
    );
  }
  const candidates = melodyCandidates(midi);
  if (candidates.length === 1) return candidates[0] as ImportedTrack;
  if (candidates.length === 0) {
    return { code: 'NO_MELODIC_TRACK', message: 'No non-empty, non-percussion track found.' };
  }
  return {
    code: 'TRACK_SELECTION_REQUIRED',
    message: `${candidates.length} candidate tracks (${candidates.map((t) => t.id).join(', ')}); pick one with --track.`,
  };
}

export function runCli(argv: readonly string[], io: CliIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        track: { type: 'string' },
        repair: { type: 'boolean', default: false },
        compact: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    io.stderr(`${(e as Error).message}\n\n${USAGE}\n`);
    return EXIT.USAGE;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(`${USAGE}\n`);
    return EXIT.OK;
  }
  if (values.version) {
    io.stdout(`remode ${CLI_VERSION} (analysis ${ANALYSIS_VERSION})\n`);
    return EXIT.OK;
  }
  const [command, file, ...rest] = positionals;
  if (command !== 'analyze' || file === undefined || rest.length > 0) {
    io.stderr(`${USAGE}\n`);
    return EXIT.USAGE;
  }

  let bytes: Uint8Array;
  try {
    bytes = io.readFile(file);
  } catch (e) {
    io.stderr(`Cannot read ${file}: ${(e as Error).message}\n`);
    return EXIT.USAGE;
  }

  const report: Report = {
    remode: { cli: CLI_VERSION, analysisVersion: ANALYSIS_VERSION },
    input: { file: basename(file), bytes: bytes.length },
    import: { ok: false, error: { code: 'NOT_RUN', message: '' } },
    selectedTrack: null,
    validation: null,
    repair: null,
    analysis: null,
    errors: [],
  };
  const emit = (code: number) => {
    io.stdout(`${JSON.stringify(report, null, values.compact ? undefined : 2)}\n`);
    return code;
  };

  const imported = importMidi(bytes, { sourceFileName: basename(file) });
  if (!imported.ok) {
    report.import = { ok: false, error: imported.error };
    report.errors.push(imported.error);
    return emit(EXIT.IMPORT_FAILED);
  }
  const midi = imported.midi;
  report.import = importSummary(midi);

  const track = selectTrack(midi, values.track);
  if ('code' in track) {
    report.errors.push(track);
    return emit(EXIT.TRACK_SELECTION);
  }
  report.selectedTrack = track.id;
  const meta = trackMetadata(midi, track);
  const validation = validateTrack(track, meta);
  report.validation = validation;

  let notes = track.notes;
  if (values.repair) {
    const cleaned = repairLegatoOverlaps(track.notes, validation);
    report.repair = { repairs: cleaned.repairs, unrepaired: cleaned.unrepaired };
    if (cleaned.unrepaired.length === 0) notes = cleaned.notes;
  }
  const blocking = values.repair
    ? (report.repair?.unrepaired ?? [])
    : validation.issues.filter((x) => x.severity === 'error');
  if (blocking.length > 0) {
    report.errors.push({
      code: 'VALIDATION_FAILED',
      message: `${track.id} is not a usable monophonic melody (${[...new Set(blocking.map((x) => x.code))].join(', ')}).`,
    });
    return emit(EXIT.VALIDATION_FAILED);
  }

  report.analysis = analyzeMode(notes, { ppq: meta.ppq, timeSignatures: meta.timeSignatures });
  return emit(EXIT.OK);
}
