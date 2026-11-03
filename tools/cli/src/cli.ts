import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ANALYSIS_VERSION,
  JIANPU_PARSER_VERSION,
  analyzeMode,
  exportFileName,
  exportMidi,
  importMidi,
  melodyCandidates,
  parseJianpu,
  repairLegatoOverlaps,
  trackMetadata,
  validateMelody,
  validateTrack,
  type CleanedSource,
  type ExportReport,
  type ImportedTrack,
  type JianpuResult,
  type MelodyNote,
  type MidiMetadata,
  type ModeAnalysis,
  type ParsedMidi,
  type ValidationReport,
} from '@remode/core';

export const CLI_VERSION = '0.3.0';

export const EXIT = {
  OK: 0,
  USAGE: 1,
  TRACK_SELECTION: 2,
  IMPORT_FAILED: 3,
  VALIDATION_FAILED: 4,
  EXPORT_FAILED: 5,
} as const;

export const USAGE = `Usage:
  remode analyze <file> [--track <id|index>] [--repair] [--compact]
  remode analyze --jianpu "<jianpu text>" [--compact]
  remode export <file.jianpu|file.txt> [-o <out.mid>] [--compact]
  remode export --jianpu "<jianpu text>" [-o <out.mid>] [--compact]

Input is either a positional file or inline --jianpu text, never both. A file's
format follows its extension: .jianpu and .txt are UTF-8 jianpu text; anything
else (.mid, .midi) is a Standard MIDI File.

analyze prints a JSON report: parse info, track list, validation, mode
candidates with tonic evidence, and ambiguity codes.

export converts jianpu to MIDI without any transform and prints a JSON report.
MIDI input is not accepted until transforms exist (M1b). Without -o the file is
written to the current directory as <source>-original.mid (melody-original.mid
for --jianpu text).

Options:
  --track <id|index>  Track to analyse ("track-2" or 2). Required when the file
                      has more than one non-empty, non-percussion track.
  --repair            Apply the safe legato-tail repair and analyse the cleaned
                      source (every change is listed under "repair").
  --jianpu <text>     Jianpu text given inline (never a file path).
  -o, --output <file> export: output path.
  --compact           Single-line JSON.
  -h, --help          Show this help.
  -v, --version       Show versions.

Exit codes: 0 ok, 1 usage/IO error, 2 track selection needed or invalid,
3 input could not be imported or parsed, 4 track failed validation,
5 MIDI could not be encoded.`;

export interface CliIo {
  readFile(path: string): Uint8Array;
  writeFile(path: string, bytes: Uint8Array): void;
  stdout(text: string): void;
  stderr(text: string): void;
}

interface CliError {
  code: string;
  message: string;
}

type InputFormat = 'midi' | 'jianpu';

interface Report {
  remode: { cli: string; analysisVersion: string; jianpuParserVersion: string };
  /** `file` is null for inline --jianpu text. */
  input: { file: string | null; format: InputFormat; bytes: number };
  import:
    | ReturnType<typeof importSummary>
    | ReturnType<typeof jianpuSummary>
    | { ok: false; error: CliError };
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
    source: 'midi' as const,
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

function jianpuSummary(r: JianpuResult) {
  if (!r.ok) {
    return {
      ok: false as const,
      source: 'jianpu' as const,
      errors: r.errors,
      warnings: r.warnings,
    };
  }
  return {
    ok: true as const,
    source: 'jianpu' as const,
    parserVersion: r.parserVersion,
    header: r.header,
    ppq: r.metadata.ppq,
    tempoMap: r.metadata.tempoMap,
    timeSignatures: r.metadata.timeSignatures,
    keySignatures: r.metadata.keySignatures ?? [],
    noteCount: r.notes.length,
    bars: r.bars,
    warnings: r.warnings,
  };
}

const JIANPU_EXTENSIONS = new Set(['.jianpu', '.txt']);
const isJianpuFile = (file: string) => JIANPU_EXTENSIONS.has(extname(file).toLowerCase());
const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

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
        jianpu: { type: 'string' },
        output: { type: 'string', short: 'o' },
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
    io.stdout(
      `remode ${CLI_VERSION} (analysis ${ANALYSIS_VERSION}, jianpu ${JIANPU_PARSER_VERSION})\n`,
    );
    return EXIT.OK;
  }
  const [command, ...rest] = positionals;
  const usage = (message?: string) => {
    io.stderr(`${message ? `${message}\n\n` : ''}${USAGE}\n`);
    return EXIT.USAGE;
  };
  const read = (file: string): Uint8Array | null => {
    try {
      return io.readFile(file);
    } catch (e) {
      io.stderr(`Cannot read ${file}: ${(e as Error).message}\n`);
      return null;
    }
  };
  const print = (report: object) =>
    io.stdout(`${JSON.stringify(report, null, values.compact ? undefined : 2)}\n`);

  if (command !== 'analyze' && command !== 'export') return usage();

  // One input: a positional file (format by extension) or inline --jianpu text.
  let input: Report['input'];
  let bytes: Uint8Array;
  if (values.jianpu !== undefined) {
    if (rest.length > 0) return usage('Give either a file or --jianpu text, not both.');
    bytes = new TextEncoder().encode(values.jianpu);
    input = { file: null, format: 'jianpu', bytes: bytes.length };
  } else {
    const [file, ...extra] = rest;
    if (file === undefined) return usage('Give an input file or --jianpu text.');
    if (extra.length > 0) return usage();
    const fileBytes = read(file);
    if (!fileBytes) return EXIT.USAGE;
    bytes = fileBytes;
    input = {
      file: basename(file),
      format: isJianpuFile(file) ? 'jianpu' : 'midi',
      bytes: bytes.length,
    };
  }

  if (command === 'export') {
    if (values.track !== undefined || values.repair) {
      return usage('export takes neither --track nor --repair.');
    }
    if (input.format !== 'jianpu') {
      return usage(
        'export converts jianpu (.jianpu, .txt or --jianpu text) to MIDI; MIDI input has nothing to convert until transforms exist (M1b).',
      );
    }
    return runExport({ ...input, format: 'jianpu' }, bytes, values.output, io, print);
  }
  if (values.output !== undefined) return usage('-o/--output applies to export only.');

  if (input.format === 'jianpu' && values.track !== undefined) {
    return usage('--track does not apply to jianpu input (it is a single melody).');
  }

  const report: Report = {
    remode: {
      cli: CLI_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      jianpuParserVersion: JIANPU_PARSER_VERSION,
    },
    input,
    import: { ok: false, error: { code: 'NOT_RUN', message: '' } },
    selectedTrack: null,
    validation: null,
    repair: null,
    analysis: null,
    errors: [],
  };
  const emit = (code: number) => {
    print(report);
    return code;
  };

  let notes: readonly MelodyNote[];
  let meta: MidiMetadata;
  let validation: ValidationReport;
  if (input.format === 'jianpu') {
    const r = parseJianpu(utf8(bytes), input.file ? { sourceFileName: input.file } : {});
    report.import = jianpuSummary(r);
    if (!r.ok) {
      report.errors.push(...r.errors);
      return emit(EXIT.IMPORT_FAILED);
    }
    report.selectedTrack = 'jianpu';
    notes = r.notes;
    meta = r.metadata;
    validation = validateMelody(notes, meta);
  } else {
    const imported = importMidi(bytes, { sourceFileName: input.file ?? '' });
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
    meta = trackMetadata(midi, track);
    validation = validateTrack(track, meta);
    notes = track.notes;
  }
  report.validation = validation;

  if (values.repair) {
    const cleaned = repairLegatoOverlaps(notes, validation);
    report.repair = { repairs: cleaned.repairs, unrepaired: cleaned.unrepaired };
    if (cleaned.unrepaired.length === 0) notes = cleaned.notes;
  }
  const blocking = values.repair
    ? (report.repair?.unrepaired ?? [])
    : validation.issues.filter((x) => x.severity === 'error');
  if (blocking.length > 0) {
    report.errors.push({
      code: 'VALIDATION_FAILED',
      message: `${report.selectedTrack} is not a usable monophonic melody (${[...new Set(blocking.map((x) => x.code))].join(', ')}).`,
    });
    return emit(EXIT.VALIDATION_FAILED);
  }

  report.analysis = analyzeMode(notes, { ppq: meta.ppq, timeSignatures: meta.timeSignatures });
  return emit(EXIT.OK);
}

interface ExportCliReport {
  remode: { cli: string; jianpuParserVersion: string };
  input: { file: string | null; format: 'jianpu'; bytes: number };
  import: ReturnType<typeof jianpuSummary>;
  output: { file: string; bytes: number } | null;
  export: ExportReport | null;
  errors: CliError[];
}

function runExport(
  input: ExportCliReport['input'],
  bytes: Uint8Array,
  output: string | undefined,
  io: CliIo,
  print: (report: object) => void,
): number {
  const parsed = parseJianpu(utf8(bytes), input.file ? { sourceFileName: input.file } : {});
  const report: ExportCliReport = {
    remode: { cli: CLI_VERSION, jianpuParserVersion: JIANPU_PARSER_VERSION },
    input,
    import: jianpuSummary(parsed),
    output: null,
    export: null,
    errors: [],
  };
  if (!parsed.ok) {
    report.errors.push(...parsed.errors);
    print(report);
    return EXIT.IMPORT_FAILED;
  }
  const result = exportMidi(parsed.notes, parsed.metadata);
  if (!result.ok) {
    report.errors.push(...result.errors);
    print(report);
    return EXIT.EXPORT_FAILED;
  }
  const target = output ?? exportFileName({ source: input.file ?? '', variant: 'original' });
  try {
    io.writeFile(target, result.bytes);
  } catch (e) {
    io.stderr(`Cannot write ${target}: ${(e as Error).message}\n`);
    return EXIT.USAGE;
  }
  report.output = { file: target, bytes: result.bytes.length };
  report.export = result.report;
  print(report);
  return EXIT.OK;
}
