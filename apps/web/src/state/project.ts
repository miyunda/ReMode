// Workbench state (spec §3.1): the parsed input, the immutable original, the
// user's settings and the generated variant live in separate slots. The
// reducer only calls pure core functions; anything time-dependent (the
// variant's createdAt) arrives in the action, so the reducer stays pure.

import {
  analyzeMode,
  mod,
  modeName,
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
  type MelodyNote,
  type MelodyVariant,
  type MidiMetadata,
  type ModeAnalysis,
  type ModeRef,
  type RecheckResult,
  type StrictRemodeReport,
  type TransformError,
  type TransformWarning,
  type ValidationReport,
} from '@remode/core';
import { WEB_LIMITS } from '../lib/limits';
import type { LoadFailure, LoadIssue, LoadedInput } from '../lib/loadInput';

/** The melody every variant is derived from. Deep-frozen (Invariant A). */
export interface OriginalMelody {
  /** 'jianpu' or the selected MIDI track ID. */
  trackId: string;
  notes: readonly Readonly<MelodyNote>[];
  metadata: Readonly<MidiMetadata>;
  /** True when the user opted into the legato repair and it changed something. */
  cleaned: boolean;
  /** Facts the exporter cannot carry, so it can report their loss. */
  exportSource: NonNullable<ExportOptions['source']>;
}

export interface TargetSettings {
  operation: 'parallel-remode' | 'transpose';
  /** parallel-remode: target scale. */
  scaleId: string;
  /** parallel-remode: null keeps the source tonic; otherwise transpose first (spec §7.1). */
  root: number | null;
  /** transpose: semitones. */
  semitones: number;
  accidentals: AccidentalPolicy;
  /** Soft range A0–C8 (spec §7.4); false allows the whole MIDI range. */
  softRange: boolean;
}

export const DEFAULT_TARGET: TargetSettings = {
  operation: 'parallel-remode',
  scaleId: 'dorian',
  root: null,
  semitones: 0,
  accidentals: 'nearest',
  softRange: true,
};

export interface DiffRow {
  index: number;
  noteId: string;
  startTick: number;
  fromPitch: number;
  toPitch: number;
  from: string;
  to: string;
  reasonCode: string;
  explanation: string;
}

export type GeneratedVariant =
  | {
      ok: true;
      operation: 'parallel-remode';
      source: ModeRef & { name: string; via: SourceModeVia };
      target: ModeRef & { name: string };
      /** Set when the root changed: transpose first, then remode. */
      preTranspose: number | null;
      variant: MelodyVariant;
      report: StrictRemodeReport;
      warnings: TransformWarning[];
      diff: DiffRow[];
      recheck: RecheckResult;
    }
  | {
      ok: true;
      operation: 'transpose';
      semitones: number;
      variant: MelodyVariant;
      warnings: TransformWarning[];
      diff: DiffRow[];
      /** Re-check of the source mode moved by the same interval, when a source mode is known. */
      recheck: RecheckResult | null;
    }
  | {
      ok: false;
      operation: TargetSettings['operation'];
      step?: 'transpose' | 'parallel-remode';
      /** Core TransformError, or SOURCE_MODE_AMBIGUOUS (same code as the CLI). */
      errors: Array<Pick<TransformError, 'message' | 'noteIds'> & { code: string }>;
    };

export interface ProjectState {
  input: LoadedInput | null;
  loadFailure: LoadFailure | null;
  /** Selected MIDI track; 'jianpu' for text input. */
  trackId: string | null;
  /** Explicit opt-in to the audited legato repair (spec §5.2). */
  repair: boolean;
  validation: ValidationReport | null;
  /** The selected melody exceeds WEB_LIMITS.maxMelodyNotes (MELODY_TOO_LONG). */
  limitError: LoadIssue | null;
  /** What the repair does (or would do) to the selected track; null if nothing repairable. */
  repairPreview: CleanedSource | null;
  original: OriginalMelody | null;
  analysis: ModeAnalysis | null;
  /** Manual source mode; overrides the analysis while set. */
  sourceOverride: ModeRef | null;
  target: TargetSettings;
  generated: GeneratedVariant | null;
}

export const initialState: ProjectState = {
  input: null,
  loadFailure: null,
  trackId: null,
  repair: false,
  validation: null,
  limitError: null,
  repairPreview: null,
  original: null,
  analysis: null,
  sourceOverride: null,
  target: DEFAULT_TARGET,
  generated: null,
};

export type Action =
  | { type: 'LOADED'; input: LoadedInput }
  | { type: 'LOAD_FAILED'; failure: LoadFailure }
  | { type: 'SELECT_TRACK'; trackId: string }
  | { type: 'SET_REPAIR'; repair: boolean }
  | { type: 'SET_SOURCE_OVERRIDE'; mode: ModeRef | null }
  | { type: 'SET_TARGET'; patch: Partial<TargetSettings> }
  | { type: 'GENERATE'; createdAt: number }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Ambiguities after which the analysis' rank-1 mode is not used without confirmation (as the CLI). */
export const BLOCKING_AMBIGUITIES: readonly AmbiguityCode[] = [
  'TONIC_UNCLEAR',
  'MULTIPLE_COLLECTIONS',
  'CHROMATIC_HEAVY',
  'TOO_SHORT',
];

export type SourceModeVia = 'manual' | 'analysis';

export type SourceMode =
  { ok: true; mode: ModeRef; name: string; via: SourceModeVia } | { ok: false; reasons: string[] };

/** The source mode transforms use: the manual choice, else an unambiguous rank-1 candidate. */
export function sourceMode(state: Pick<ProjectState, 'analysis' | 'sourceOverride'>): SourceMode {
  if (state.sourceOverride) {
    const m = state.sourceOverride;
    return { ok: true, mode: m, name: modeName(m.root, m.scaleId), via: 'manual' };
  }
  const analysis = state.analysis;
  if (!analysis) return { ok: false, reasons: ['NO_ANALYSIS'] };
  const rank1 = analysis.candidates.filter((c) => c.rank === 1);
  const modes = new Set(rank1.map((c) => `${c.rootPitchClass}:${c.scaleId}`));
  const blocking = analysis.ambiguities
    .filter((a) => BLOCKING_AMBIGUITIES.includes(a.code))
    .map((a) => a.code);
  const top = rank1[0];
  if (!top || modes.size !== 1 || blocking.length > 0) {
    return {
      ok: false,
      reasons: [
        ...(top ? [] : ['NO_CANDIDATE']),
        ...(modes.size > 1 ? ['SEVERAL_RANK1'] : []),
        ...new Set(blocking),
      ],
    };
  }
  return {
    ok: true,
    mode: { root: top.rootPitchClass, scaleId: top.scaleId },
    name: top.name,
    via: 'analysis',
  };
}

/** Validate the selected track, apply the repair if opted in, and build the original. */
function select(state: ProjectState, trackId: string | null, repair: boolean): ProjectState {
  const input = state.input;
  const base: ProjectState = {
    ...state,
    trackId,
    repair,
    validation: null,
    limitError: null,
    repairPreview: null,
    original: null,
    analysis: null,
    sourceOverride: null,
    generated: null,
  };
  if (!input || trackId === null) return base;
  if (input.kind === 'midi') {
    const count = input.midi.tracks.find((t) => t.id === trackId)?.noteCount ?? 0;
    if (count > WEB_LIMITS.maxMelodyNotes) {
      return {
        ...base,
        limitError: {
          code: 'MELODY_TOO_LONG',
          message: `该轨有 ${count} 个音符，超过单条旋律 ${WEB_LIMITS.maxMelodyNotes} 个音符的上限。`,
        },
      };
    }
  }

  let notes: readonly MelodyNote[];
  let metadata: MidiMetadata;
  let validation: ValidationReport;
  let exportSource: OriginalMelody['exportSource'] = {};
  if (input.kind === 'jianpu') {
    notes = input.melody.notes;
    metadata = input.melody.metadata;
    validation = validateMelody(notes, metadata);
  } else {
    const track = input.midi.tracks.find((t) => t.id === trackId);
    if (!track) return { ...base, trackId: null };
    metadata = trackMetadata(input.midi, track);
    notes = track.notes;
    validation = validateTrack(track, metadata);
    exportSource = {
      hasPitchBend: track.hasPitchBend,
      hasSustainPedal: track.hasSustainPedal,
      droppedTracks: input.midi.tracks.filter((t) => t.id !== track.id && t.noteCount > 0).length,
    };
  }

  const preview = validation.issues.some((x) => x.code === 'OVERLAP' && x.repairable)
    ? repairLegatoOverlaps(notes, validation)
    : null;
  const applied = repair && preview !== null && preview.repairs.length > 0;
  const blocking = applied
    ? (preview as CleanedSource).unrepaired
    : validation.issues.filter((x) => x.severity === 'error');
  const next = { ...base, validation, repairPreview: preview };
  if (blocking.length > 0) return next;

  const finalNotes = applied ? (preview as CleanedSource).notes : notes;
  // Copy before freezing: the parsed input stays usable for re-selection.
  const original = deepFreeze<OriginalMelody>({
    trackId,
    notes: finalNotes.map((n) => ({ ...n })),
    metadata: structuredClone(metadata),
    cleaned: applied,
    exportSource,
  });
  const analysis = analyzeMode(original.notes, {
    ppq: original.metadata.ppq,
    timeSignatures: original.metadata.timeSignatures,
  });
  return { ...next, original, analysis };
}

const diffOf = (notes: readonly MelodyNote[], variant: MelodyVariant): DiffRow[] => {
  const index = new Map(notes.map((n, i) => [n.id, i]));
  return variant.changes.map((c) => {
    const i = index.get(c.noteId) ?? -1;
    return {
      index: i + 1,
      noteId: c.noteId,
      startTick: notes[i]?.startTick ?? -1,
      fromPitch: c.fromPitch,
      toPitch: c.toPitch,
      from: pitchName(c.fromPitch),
      to: pitchName(c.toPitch),
      reasonCode: c.reasonCode,
      explanation: c.explanation ?? '',
    };
  });
};

function generate(state: ProjectState, createdAt: number): GeneratedVariant | null {
  const original = state.original;
  if (!original) return null;
  const { notes, metadata } = original;
  const t = state.target;
  const analyzeOptions = { ppq: metadata.ppq, timeSignatures: metadata.timeSignatures };
  const range = t.softRange ? {} : { softRange: null };
  const src = sourceMode(state);

  if (t.operation === 'transpose') {
    const r = transpose(notes, t.semitones, { createdAt, ...range });
    if (!r.ok) return { ok: false, operation: 'transpose', errors: r.errors };
    return {
      ok: true,
      operation: 'transpose',
      semitones: t.semitones,
      variant: r.variant,
      warnings: r.warnings,
      diff: diffOf(notes, r.variant),
      recheck: src.ok
        ? recheckTarget(
            r.variant.notes,
            { root: mod(src.mode.root + t.semitones, 12), scaleId: src.mode.scaleId },
            analyzeOptions,
          )
        : null,
    };
  }

  if (!src.ok) {
    return {
      ok: false,
      operation: 'parallel-remode',
      errors: [
        {
          code: 'SOURCE_MODE_AMBIGUOUS',
          message: `来源调式未确定（${src.reasons.join('、')}）：请在 SOURCE 中手动指定。`,
        },
      ],
    };
  }
  const source = src.mode;
  const target: ModeRef = { root: t.root ?? source.root, scaleId: t.scaleId };
  const options = {
    accidentals: t.accidentals,
    // Keeping accidentals means the target cannot be strict (spec §7.3).
    strictTarget: t.accidentals !== 'preserve',
    createdAt,
    ...range,
  };
  let variant: MelodyVariant;
  let report: StrictRemodeReport;
  let warnings: TransformWarning[];
  let preTranspose: number | null = null;
  if (mod(target.root, 12) === mod(source.root, 12)) {
    const r = strictRemode(notes, source, { scaleId: target.scaleId }, options);
    if (!r.ok) return { ok: false, operation: 'parallel-remode', errors: r.errors };
    ({ variant, report, warnings } = r);
  } else {
    const r = strictRemodeWithTonic(notes, source, target, options);
    if (!r.ok) return { ok: false, operation: 'parallel-remode', step: r.step, errors: r.errors };
    ({ variant, report, warnings } = r);
    preTranspose = r.steps[0].variant.transform.semitones;
  }
  return {
    ok: true,
    operation: 'parallel-remode',
    source: { ...source, name: src.name, via: src.via },
    target: { ...target, name: modeName(target.root, target.scaleId) },
    preTranspose,
    variant,
    report,
    warnings,
    diff: diffOf(notes, variant),
    recheck: recheckTarget(variant.notes, target, analyzeOptions),
  };
}

export function reducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case 'LOADED': {
      const input = action.input;
      const fresh: ProjectState = { ...initialState, target: state.target, input };
      // Auto-select only when there is exactly one candidate (spec §5.1).
      const only =
        input.kind === 'jianpu'
          ? 'jianpu'
          : input.candidates.length === 1
            ? (input.candidates[0]?.id ?? null)
            : null;
      return select(fresh, only, false);
    }
    case 'LOAD_FAILED':
      return { ...initialState, target: state.target, loadFailure: action.failure };
    case 'SELECT_TRACK':
      return select(state, action.trackId, false);
    case 'SET_REPAIR':
      return state.trackId === null ? state : select(state, state.trackId, action.repair);
    case 'SET_SOURCE_OVERRIDE':
      return { ...state, sourceOverride: action.mode, generated: null };
    case 'SET_TARGET':
      return { ...state, target: { ...state.target, ...action.patch }, generated: null };
    case 'GENERATE':
      return { ...state, generated: generate(state, action.createdAt) };
    case 'RESET':
      return { ...initialState, target: state.target };
  }
}
