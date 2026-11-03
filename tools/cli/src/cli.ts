import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ANALYSIS_VERSION,
  JIANPU_PARSER_VERSION,
  STRICT_TRANSFORM_VERSION,
  TRANSPOSE_VERSION,
  analyzeMode,
  exportFileName,
  exportMidi,
  getScale,
  importMidi,
  melodyCandidates,
  mod,
  modeName,
  parseJianpu,
  pitchClassName,
  pitchName,
  recheckTarget,
  repairLegatoOverlaps,
  strictRemode,
  strictRemodeWithTonic,
  trackMetadata,
  transpose,
  validateMelody,
  validateTrack,
  type AccidentalPolicy,
  type AmbiguityCode,
  type CleanedSource,
  type ExportOptions,
  type ExportReport,
  type ImportedTrack,
  type JianpuResult,
  type MelodyNote,
  type MidiMetadata,
  type ModeAnalysis,
  type ModeRef,
  type ParsedMidi,
  type PitchChange,
  type RecheckResult,
  type StrictRemodeReport,
  type StrictRemodeSettings,
  type TransformSettings,
  type TransformWarning,
  type TransposeSettings,
  type ValidationReport,
} from '@remode/core';

export const CLI_VERSION = '0.4.0';

export const EXIT = {
  OK: 0,
  USAGE: 1,
  TRACK_SELECTION: 2,
  IMPORT_FAILED: 3,
  VALIDATION_FAILED: 4,
  EXPORT_FAILED: 5,
  SOURCE_MODE_AMBIGUOUS: 6,
  TRANSFORM_FAILED: 7,
} as const;

export const USAGE = `Usage:
  remode analyze <input> [--track <id|index>] [--repair] [--compact]
  remode export <file.jianpu|file.txt> [-o <out.mid>] [--compact]
  remode export --jianpu "<jianpu text>" [-o <out.mid>] [--compact]
  remode transpose <input> --semitones <n> [--no-range] [-o <out.mid>] [--compact]
  remode remode <input> --to [<root>:]<scaleId> [--from <root>:<scaleId>]
                [--accidentals nearest|preserve|reject] [--strategy strict]
                [--no-range] [-o <out.mid>] [--compact]

<input> is either a positional file or inline --jianpu "<text>", never both. A
file's format follows its extension: .jianpu and .txt are UTF-8 jianpu text;
anything else (.mid, .midi) is a Standard MIDI File. --track and --repair work
for MIDI input in analyze, transpose and remode.

analyze prints a JSON report: parse info, track list, validation, mode
candidates with tonic evidence, and ambiguity codes.

export converts jianpu to MIDI without any transform. Without -o the file is
written to the current directory as <source>-original.mid (melody-original.mid
for --jianpu text). MIDI input has nothing to convert; use transpose or remode.

transpose adds n semitones to every note (n may be negative; write
--semitones=-3 or --semitones -3). Default output <source>-transpose-up<n>.mid
or -down<n>.mid. Source key signatures are omitted unless n is a multiple of 12.

remode is the strict parallel remode (spec 7.3): the tonic stays, each note
moves to the target's degree with the same number. --from overrides the
detected source mode; without it the rank-1 analysis candidate is used, and
an ambiguous analysis (several rank-1 modes, TONIC_UNCLEAR, MULTIPLE_COLLECTIONS,
CHROMATIC_HEAVY or TOO_SHORT) is refused with exit code 6. --to <root>:<scaleId>
with a different root transposes first (two explicit steps in the report).
The output carries the target's key signature and a mode text event; default
name <source>-<root>-<scaleId>-strict.mid. The JSON report lists every changed
note with its reason code, warnings (e.g. NO_CHARACTERISTIC_DEGREE), and an
analyzer re-check of the output (diagnostic only).

Options:
  --track <id|index>  Track to use ("track-2" or 2). Required when the file
                      has more than one non-empty, non-percussion track.
  --repair            Apply the safe legato-tail repair first (every change is
                      listed under "repair").
  --jianpu <text>     Jianpu text given inline (never a file path).
  --semitones <n>     transpose: integer semitones.
  --to <target>       remode: target scale id, optionally with a new root
                      ("dorian", "pentatonic-yu", "A:aeolian").
  --from <source>     remode: source mode "<root>:<scaleId>" ("C:ionian").
  --accidentals <p>   remode: notes outside the source scale: nearest (default),
                      preserve (the target is then not strict), reject.
  --strategy strict   remode: the only strategy until M3 (Expressive).
  --no-range          transpose, remode: disable the soft range 21-108; pitches
                      outside MIDI 0..127 are then an error.
  -o, --output <file> Output path (export, transpose, remode).
  --compact           Single-line JSON.
  -h, --help          Show this help.
  -v, --version       Show versions.

Exit codes: 0 ok, 1 usage/IO error, 2 track selection needed or invalid,
3 input could not be imported or parsed, 4 track failed validation,
5 MIDI could not be encoded, 6 source mode ambiguous (pass --from),
7 transform failed (e.g. rejected accidentals, out of range).`;

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

/** What every command that reads a melody reports about loading it. */
interface LoadReport {
  remode: {
    cli: string;
    analysisVersion: string;
    jianpuParserVersion: string;
    transformVersion?: string;
  };
  /** `file` is null for inline --jianpu text. */
  input: { file: string | null; format: InputFormat; bytes: number };
  import:
    | ReturnType<typeof importSummary>
    | ReturnType<typeof jianpuSummary>
    | { ok: false; error: CliError };
  selectedTrack: string | null;
  validation: ValidationReport | null;
  repair: Pick<CleanedSource, 'repairs' | 'unrepaired'> | null;
  errors: CliError[];
}

interface AnalyzeReport extends LoadReport {
  analysis: ModeAnalysis | null;
}

/** One changed note, as the CLI prints it. */
interface DiffEntry {
  noteId: string;
  startTick: number;
  from: string;
  to: string;
  fromPitch: number;
  toPitch: number;
  reasonCode: string;
  explanation: string;
}

interface TransformOutput {
  summary: { notes: number; changed: number } | null;
  diff: DiffEntry[];
  warnings: Array<TransformWarning | CliError>;
  output: { file: string; bytes: number } | null;
  export: ExportReport | null;
}

interface TransposeReport extends LoadReport, TransformOutput {
  transform: TransposeSettings | null;
}

interface ModeSummary {
  root: string;
  rootPitchClass: number;
  scaleId: string;
  name: string;
}

interface RemodeReport extends LoadReport, TransformOutput {
  /** Analysis of the input, run even with --from so the report shows what was overridden. */
  sourceAnalysis: {
    analysisVersion: string;
    rank1: string[];
    ambiguities: Array<{ code: AmbiguityCode; detail: string }>;
  } | null;
  sourceMode: (ModeSummary & { via: 'option' | 'analysis' }) | null;
  targetMode: ModeSummary | null;
  transform: StrictRemodeSettings | null;
  /** Only for a change of tonic: transpose, then parallel remode. */
  steps: Array<{ operation: string; transform: TransformSettings | null; changed: number }> | null;
  diagnostics: StrictRemodeReport | null;
  recheck: RecheckResult | null;
}

/** Rank-1 ambiguities that make the detected source mode unusable without --from. */
const BLOCKING_AMBIGUITIES: readonly AmbiguityCode[] = [
  'TONIC_UNCLEAR',
  'MULTIPLE_COLLECTIONS',
  'CHROMATIC_HEAVY',
  'TOO_SHORT',
];
const ACCIDENTAL_POLICIES: readonly AccidentalPolicy[] = ['nearest', 'preserve', 'reject'];

const ROOT_NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C", "F#", "Bb", "c♯" → pitch class; null if not a note name. */
export function parseRoot(text: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(text.trim());
  if (!m) return null;
  const base = ROOT_NAMES[(m[1] as string).toUpperCase()] as number;
  const alter = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return mod(base + alter, 12);
}

/** "<root>:<scaleId>" or (when `rootOptional`) "<scaleId>". */
function parseModeArg(
  flag: string,
  text: string,
  rootOptional: boolean,
): { root: number | null; scaleId: string } | string {
  const parts = text.split(':');
  if (parts.length > 2 || (parts.length === 1 && !rootOptional)) {
    return `${flag} expects ${rootOptional ? '[<root>:]<scaleId>' : '<root>:<scaleId>'}, got "${text}".`;
  }
  const scaleId = (parts.length === 2 ? parts[1] : parts[0]) as string;
  let root: number | null = null;
  if (parts.length === 2) {
    root = parseRoot(parts[0] as string);
    if (root === null) return `${flag}: "${parts[0]}" is not a root such as C, F# or Bb.`;
  }
  try {
    getScale(scaleId);
  } catch {
    return `${flag}: unknown scale id "${scaleId}".`;
  }
  return { root, scaleId };
}

const modeSummary = (root: number, scaleId: string): ModeSummary => ({
  root: pitchClassName(root),
  rootPitchClass: mod(root, 12),
  scaleId,
  name: modeName(root, scaleId),
});

function diffOf(notes: readonly MelodyNote[], changes: readonly PitchChange[]): DiffEntry[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return changes.map((c) => ({
    noteId: c.noteId,
    startTick: byId.get(c.noteId)?.startTick ?? -1,
    from: pitchName(c.fromPitch),
    to: pitchName(c.toPitch),
    fromPitch: c.fromPitch,
    toPitch: c.toPitch,
    reasonCode: c.reasonCode,
    explanation: c.explanation ?? '',
  }));
}

/** parseArgs refuses "--semitones -3"; rewrite it as "--semitones=-3". */
const joinNegativeValues = (argv: readonly string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const next = argv[i + 1];
    if (arg === '--semitones' && next !== undefined && /^-\d+$/.test(next)) {
      out.push(`${arg}=${next}`);
      i++;
    } else {
      out.push(arg);
    }
  }
  return out;
};

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

type Values = {
  track?: string | undefined;
  repair?: boolean | undefined;
  jianpu?: string | undefined;
  output?: string | undefined;
  semitones?: string | undefined;
  to?: string | undefined;
  from?: string | undefined;
  accidentals?: string | undefined;
  strategy?: string | undefined;
  'no-range'?: boolean | undefined;
};

const COMMANDS = ['analyze', 'export', 'transpose', 'remode'] as const;
type Command = (typeof COMMANDS)[number];

export function runCli(argv: readonly string[], io: CliIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: joinNegativeValues(argv),
      allowPositionals: true,
      options: {
        track: { type: 'string' },
        repair: { type: 'boolean', default: false },
        jianpu: { type: 'string' },
        output: { type: 'string', short: 'o' },
        semitones: { type: 'string' },
        to: { type: 'string' },
        from: { type: 'string' },
        accidentals: { type: 'string' },
        strategy: { type: 'string' },
        'no-range': { type: 'boolean', default: false },
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
      `remode ${CLI_VERSION} (analysis ${ANALYSIS_VERSION}, jianpu ${JIANPU_PARSER_VERSION}, ${TRANSPOSE_VERSION}, ${STRICT_TRANSFORM_VERSION})\n`,
    );
    return EXIT.OK;
  }
  const [commandArg, ...rest] = positionals;
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

  if (!(COMMANDS as readonly string[]).includes(commandArg ?? '')) return usage();
  const command = commandArg as Command;

  // Options that belong to one command only.
  if (command !== 'transpose' && values.semitones !== undefined) {
    return usage('--semitones applies to transpose only.');
  }
  const remodeOnly = [values.to, values.from, values.accidentals, values.strategy];
  if (command !== 'remode' && remodeOnly.some((v) => v !== undefined)) {
    return usage('--to, --from, --accidentals and --strategy apply to remode only.');
  }
  if ((command === 'analyze' || command === 'export') && values['no-range']) {
    return usage('--no-range applies to transpose and remode only.');
  }
  if (command === 'analyze' && values.output !== undefined) {
    return usage('-o/--output applies to export, transpose and remode.');
  }
  let semitones = 0;
  if (command === 'transpose') {
    if (values.semitones === undefined) return usage('transpose needs --semitones <n>.');
    if (!/^[+-]?\d+$/.test(values.semitones)) {
      return usage(`--semitones expects an integer, got "${values.semitones}".`);
    }
    semitones = Number(values.semitones);
  }
  let remodeArgs: RemodeArgs | null = null;
  if (command === 'remode') {
    if (values.to === undefined) return usage('remode needs --to [<root>:]<scaleId>.');
    const to = parseModeArg('--to', values.to, true);
    if (typeof to === 'string') return usage(to);
    let from: ModeRef | null = null;
    if (values.from !== undefined) {
      const f = parseModeArg('--from', values.from, false);
      if (typeof f === 'string') return usage(f);
      from = { root: f.root as number, scaleId: f.scaleId };
    }
    const accidentals = (values.accidentals ?? 'nearest') as AccidentalPolicy;
    if (!ACCIDENTAL_POLICIES.includes(accidentals)) {
      return usage(
        `--accidentals expects nearest, preserve or reject, got "${values.accidentals}".`,
      );
    }
    if (values.strategy !== undefined && values.strategy !== 'strict') {
      return usage(
        `--strategy "${values.strategy}" is not available; only strict exists before M3.`,
      );
    }
    remodeArgs = { to, from, accidentals };
  }

  // One input: a positional file (format by extension) or inline --jianpu text.
  let input: LoadReport['input'];
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
        'export converts jianpu (.jianpu, .txt or --jianpu text) to MIDI unchanged; for MIDI input use transpose or remode.',
      );
    }
    return runExport({ ...input, format: 'jianpu' }, bytes, values.output, io, print);
  }
  if (input.format === 'jianpu' && values.track !== undefined) {
    return usage('--track does not apply to jianpu input (it is a single melody).');
  }

  const base: LoadReport = {
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
    errors: [],
  };
  const transformOutput = (): TransformOutput => ({
    summary: null,
    diff: [],
    warnings: [],
    output: null,
    export: null,
  });
  const ctx: TransformContext = {
    values,
    io,
    print,
    softRange: values['no-range'] ? null : undefined,
  };

  if (command === 'analyze') {
    const report: AnalyzeReport = { ...base, analysis: null };
    const loaded = load(report, bytes, values);
    if (typeof loaded === 'number') return emit(print, report, loaded);
    report.analysis = analyzeMode(loaded.notes, {
      ppq: loaded.meta.ppq,
      timeSignatures: loaded.meta.timeSignatures,
    });
    return emit(print, report, EXIT.OK);
  }
  if (command === 'transpose') {
    const report: TransposeReport = {
      ...base,
      remode: { ...base.remode, transformVersion: TRANSPOSE_VERSION },
      transform: null,
      ...transformOutput(),
    };
    const loaded = load(report, bytes, values);
    if (typeof loaded === 'number') return emit(print, report, loaded);
    return runTranspose(report, loaded, semitones, ctx);
  }
  const report: RemodeReport = {
    ...base,
    remode: { ...base.remode, transformVersion: STRICT_TRANSFORM_VERSION },
    sourceAnalysis: null,
    sourceMode: null,
    targetMode: null,
    transform: null,
    steps: null,
    ...transformOutput(),
    diagnostics: null,
    recheck: null,
  };
  const loaded = load(report, bytes, values);
  if (typeof loaded === 'number') return emit(print, report, loaded);
  return runRemode(report, loaded, remodeArgs as RemodeArgs, ctx);
}

const emit = (print: (report: object) => void, report: object, code: number) => {
  print(report);
  return code;
};

interface Loaded {
  notes: readonly MelodyNote[];
  meta: MidiMetadata;
  /** Facts the exporter cannot carry, so it can report their loss. */
  exportSource: NonNullable<ExportOptions['source']>;
}

/** Parse, select, validate and (optionally) repair; an exit code on failure. */
function load(report: LoadReport, bytes: Uint8Array, values: Values): Loaded | number {
  const { input } = report;
  let notes: readonly MelodyNote[];
  let meta: MidiMetadata;
  let validation: ValidationReport;
  let exportSource: Loaded['exportSource'] = {};
  if (input.format === 'jianpu') {
    const r = parseJianpu(utf8(bytes), input.file ? { sourceFileName: input.file } : {});
    report.import = jianpuSummary(r);
    if (!r.ok) {
      report.errors.push(...r.errors);
      return EXIT.IMPORT_FAILED;
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
      return EXIT.IMPORT_FAILED;
    }
    const midi = imported.midi;
    report.import = importSummary(midi);

    const track = selectTrack(midi, values.track);
    if ('code' in track) {
      report.errors.push(track);
      return EXIT.TRACK_SELECTION;
    }
    report.selectedTrack = track.id;
    meta = trackMetadata(midi, track);
    validation = validateTrack(track, meta);
    notes = track.notes;
    exportSource = {
      hasPitchBend: track.hasPitchBend,
      hasSustainPedal: track.hasSustainPedal,
      droppedTracks: midi.tracks.filter((t) => t.id !== track.id && t.noteCount > 0).length,
    };
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
    return EXIT.VALIDATION_FAILED;
  }
  return { notes, meta, exportSource };
}

interface RemodeArgs {
  to: { root: number | null; scaleId: string };
  from: ModeRef | null;
  accidentals: AccidentalPolicy;
}

interface TransformContext {
  values: Values;
  io: CliIo;
  print: (report: object) => void;
  /** `null` with --no-range; undefined keeps the default soft range. */
  softRange: null | undefined;
}

/** Encode and write; fills `report.output` / `report.export` or returns a failure code. */
function writeVariant(
  report: TransformOutput & { errors: CliError[] },
  notes: readonly MelodyNote[],
  meta: MidiMetadata,
  options: ExportOptions,
  target: string,
  io: CliIo,
): number {
  const result = exportMidi(notes, meta, options);
  if (!result.ok) {
    report.errors.push(...result.errors);
    return EXIT.EXPORT_FAILED;
  }
  try {
    io.writeFile(target, result.bytes);
  } catch (e) {
    io.stderr(`Cannot write ${target}: ${(e as Error).message}\n`);
    return EXIT.USAGE;
  }
  report.output = { file: target, bytes: result.bytes.length };
  report.export = result.report;
  return EXIT.OK;
}

function runTranspose(
  report: TransposeReport,
  loaded: Loaded,
  semitones: number,
  ctx: TransformContext,
): number {
  const r = transpose(loaded.notes, semitones, {
    createdAt: Date.now(),
    ...(ctx.softRange === null ? { softRange: null } : {}),
  });
  if (!r.ok) {
    report.errors.push(...r.errors);
    return emit(ctx.print, report, EXIT.TRANSFORM_FAILED);
  }
  report.transform = r.variant.transform;
  report.summary = { notes: loaded.notes.length, changed: r.variant.changes.length };
  report.diff = diffOf(loaded.notes, r.variant.changes);
  report.warnings.push(...r.warnings);

  // A transposed melody no longer matches its source key signature.
  let keySignature: ExportOptions['keySignature'] = { kind: 'source' };
  if ((loaded.meta.keySignatures ?? []).length > 0 && mod(semitones, 12) !== 0) {
    keySignature = { kind: 'omit' };
    report.warnings.push({
      code: 'KEY_SIGNATURES_OMITTED',
      message: `Source key signatures no longer apply after transposing by ${semitones}; none written.`,
    });
  }
  const direction = semitones > 0 ? `up${semitones}` : semitones < 0 ? `down${-semitones}` : '0';
  const target =
    ctx.values.output ??
    exportFileName({ source: report.input.file ?? '', variant: `transpose-${direction}` });
  const code = writeVariant(
    report,
    r.variant.notes,
    loaded.meta,
    { keySignature, source: loaded.exportSource },
    target,
    ctx.io,
  );
  return code === EXIT.USAGE ? code : emit(ctx.print, report, code);
}

function runRemode(
  report: RemodeReport,
  loaded: Loaded,
  args: RemodeArgs,
  ctx: TransformContext,
): number {
  const { notes, meta } = loaded;
  const analyzeOptions = { ppq: meta.ppq, timeSignatures: meta.timeSignatures };
  const analysis = analyzeMode(notes, { ...analyzeOptions, baseline: false });
  const rank1 = analysis.candidates.filter((c) => c.rank === 1);
  report.sourceAnalysis = {
    analysisVersion: analysis.analysisVersion,
    rank1: rank1.map((c) => c.name),
    ambiguities: analysis.ambiguities.map((a) => ({ code: a.code, detail: a.detail })),
  };

  let source: ModeRef;
  if (args.from) {
    source = args.from;
    report.sourceMode = {
      ...modeSummary(source.root, source.scaleId),
      via: 'option',
    };
  } else {
    const modes = [...new Set(rank1.map((c) => `${c.rootPitchClass}:${c.scaleId}`))];
    const blocking = analysis.ambiguities.filter((a) => BLOCKING_AMBIGUITIES.includes(a.code));
    const top = rank1[0];
    if (modes.length !== 1 || blocking.length > 0 || !top) {
      const why = [
        modes.length === 0
          ? 'no candidate'
          : modes.length > 1
            ? `${modes.length} rank-1 modes (${rank1.map((c) => c.name).join(', ')})`
            : '',
        ...blocking.map((a) => a.code),
      ].filter(Boolean);
      report.errors.push({
        code: 'SOURCE_MODE_AMBIGUOUS',
        message: `The source mode is ambiguous at rank 1 (${why.join('; ')}); pass --from <root>:<scaleId>.`,
      });
      return emit(ctx.print, report, EXIT.SOURCE_MODE_AMBIGUOUS);
    }
    source = { root: top.rootPitchClass, scaleId: top.scaleId };
    report.sourceMode = {
      ...modeSummary(source.root, source.scaleId),
      via: 'analysis',
    };
  }
  const target: ModeRef = { root: args.to.root ?? source.root, scaleId: args.to.scaleId };
  report.targetMode = modeSummary(target.root, target.scaleId);

  const options = {
    accidentals: args.accidentals,
    // Keeping accidentals means the target cannot be strict (spec §7.3).
    strictTarget: args.accidentals !== 'preserve',
    createdAt: Date.now(),
    ...(ctx.softRange === null ? { softRange: null } : {}),
  };
  let variant;
  if (mod(target.root, 12) === mod(source.root, 12)) {
    const r = strictRemode(notes, source, { scaleId: target.scaleId }, options);
    if (!r.ok) {
      report.errors.push(...r.errors);
      return emit(ctx.print, report, EXIT.TRANSFORM_FAILED);
    }
    variant = r.variant;
    report.diagnostics = r.report;
    report.warnings.push(...r.warnings);
  } else {
    const r = strictRemodeWithTonic(notes, source, target, options);
    if (!r.ok) {
      report.errors.push(...r.errors.map((e) => ({ ...e, step: r.step })));
      return emit(ctx.print, report, EXIT.TRANSFORM_FAILED);
    }
    variant = r.variant;
    report.steps = r.steps.map((s) => ({
      operation: s.operation,
      transform: s.variant.transform,
      changed: s.variant.changes.length,
    }));
    report.diagnostics = r.report;
    report.warnings.push(...r.warnings);
  }
  report.transform = variant.transform;
  report.summary = { notes: notes.length, changed: variant.changes.length };
  report.diff = diffOf(notes, variant.changes);
  report.recheck = recheckTarget(variant.notes, target, analyzeOptions);

  const file =
    ctx.values.output ??
    exportFileName({
      source: report.input.file ?? '',
      rootPitchClass: target.root,
      scaleId: target.scaleId,
      variant: 'strict',
    });
  const code = writeVariant(
    report,
    variant.notes,
    meta,
    {
      keySignature: { kind: 'mode', rootPitchClass: target.root, scaleId: target.scaleId },
      source: loaded.exportSource,
    },
    file,
    ctx.io,
  );
  return code === EXIT.USAGE ? code : emit(ctx.print, report, code);
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
