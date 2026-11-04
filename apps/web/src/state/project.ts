// Workbench state (spec §3.1): the parsed input, the immutable original, the
// user's settings and the generated variant live in separate slots. The
// reducer only calls pure core functions; anything time-dependent (the
// variant's createdAt) arrives in the action, so the reducer stays pure.
//
// M2b adds the `custom` variant (manual pitch edits forked from the generated
// variant or the original), the note selection, the new-melody draft and a
// bounded undo/redo history over the user's settings and edits (spec §10.6).

import {
  MANUAL_EDIT,
  MANUAL_EDIT_VERSION,
  analyzeMode,
  applyManualEdit,
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
  type PitchChange,
  type TransformSettings,
  type RecheckResult,
  type StrictRemodeReport,
  type TransformError,
  type TransformWarning,
  type ValidationReport,
} from '@remode/core';
import {
  addNote,
  deleteNote,
  draftMelody,
  emptyDraft,
  updateNote,
  type Draft,
  type DraftSettings,
} from '../lib/draft';
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

export type OkGenerated = Extract<GeneratedVariant, { ok: true }>;

/** Which variant the piano roll draws filled and the note table lists. */
export type ViewId = 'original' | 'generated' | 'custom';

/** Manual edits (spec §10.3): a copy of the generated variant or the original, edited pitch by pitch. */
export interface CustomVariant {
  forkedFrom: 'original' | 'generated';
  /** The generated variant it was forked from (kept when the target changes later). */
  base: OkGenerated | null;
  /** `variant.changes` are net changes against the original; manually touched notes carry MANUAL_EDIT. */
  variant: MelodyVariant;
  /** Every manual edit in order, each from the pitch before that edit. */
  edits: PitchChange[];
}

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
  custom: CustomVariant | null;
  view: ViewId;
  selectedNoteId: string | null;
  /** Manual edits snap to the target scale (spec §10.3); off allows any semitone. */
  snap: boolean;
  /** New-melody mode; null otherwise. */
  draft: Draft | null;
  history: History;
}

/**
 * The part of the state undo/redo restores (spec §10.6): the whole project,
 * so replacing it (another file, 新建旋律, a track change) is undoable too.
 * Not restored: the history itself, the snap preference, the selection and
 * the last load error.
 */
export type Snapshot = Omit<ProjectState, 'history' | 'snap' | 'selectedNoteId' | 'loadFailure'>;

export interface History {
  past: readonly Snapshot[];
  future: readonly Snapshot[];
}

/** Undo depth; older steps are dropped. */
export const HISTORY_LIMIT = 100;

const EMPTY_HISTORY: History = { past: [], future: [] };

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
  custom: null,
  view: 'original',
  selectedNoteId: null,
  snap: true,
  draft: null,
  history: EMPTY_HISTORY,
};

export type Action =
  | { type: 'LOADED'; input: LoadedInput }
  | { type: 'LOAD_FAILED'; failure: LoadFailure }
  | { type: 'SELECT_TRACK'; trackId: string }
  | { type: 'SET_REPAIR'; repair: boolean }
  | { type: 'SET_SOURCE_OVERRIDE'; mode: ModeRef | null }
  | { type: 'SET_TARGET'; patch: Partial<TargetSettings> }
  | { type: 'GENERATE'; createdAt: number }
  | { type: 'RESET' }
  // M2b: variants, selection and manual edits
  | { type: 'SET_VIEW'; view: ViewId }
  | { type: 'SELECT_NOTE'; noteId: string | null }
  | { type: 'SET_SNAP'; snap: boolean }
  | { type: 'FORK_CUSTOM'; from: 'original' | 'generated'; createdAt: number }
  /** Edits the custom variant; from another view it first forks custom from that view. */
  | { type: 'EDIT_PITCH'; noteId: string; toPitch: number; createdAt: number }
  | { type: 'REVERT_NOTE'; noteId: string; createdAt: number }
  /** 恢复原样: custom becomes an unedited copy of the original. */
  | { type: 'RESTORE_ORIGINAL'; createdAt: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // New-melody mode
  | { type: 'NEW_MELODY'; settings?: DraftSettings }
  | { type: 'DRAFT_SETTINGS'; patch: Partial<DraftSettings> }
  | { type: 'DRAFT_ADD'; pitch: number; startTick: number; durationTick?: number }
  | {
      type: 'DRAFT_UPDATE';
      noteId: string;
      patch: Partial<Pick<MelodyNote, 'pitch' | 'startTick' | 'durationTick'>>;
    }
  | { type: 'DRAFT_DELETE'; noteId: string }
  | { type: 'DRAFT_FINISH' }
  | { type: 'DRAFT_CANCEL' };

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
    custom: null,
    view: 'original',
    selectedNoteId: null,
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
  if (input.kind === 'jianpu' || input.kind === 'new') {
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

/** The target mode edits snap to: the generated target, else what the settings would produce. */
export function targetMode(
  state: Pick<ProjectState, 'analysis' | 'sourceOverride' | 'target' | 'generated'>,
): (ModeRef & { name: string }) | null {
  const g = state.generated;
  if (g?.ok && g.operation === 'parallel-remode') return g.target;
  const src = sourceMode(state);
  if (!src.ok) return null;
  const t = g?.ok
    ? { ...state.target, operation: g.operation, semitones: g.semitones }
    : state.target;
  const ref: ModeRef =
    t.operation === 'transpose'
      ? { root: mod(src.mode.root + t.semitones, 12), scaleId: src.mode.scaleId }
      : { root: t.root ?? src.mode.root, scaleId: t.scaleId };
  return { ...ref, name: modeName(ref.root, ref.scaleId) };
}

/** The mode a generated variant ends up in; a transposed one is the source mode moved with it. */
function generatedMode(state: ProjectState, g: OkGenerated): ModeRef | null {
  if (g.operation === 'parallel-remode') return g.target;
  const src = sourceMode(state);
  return src.ok ? { root: mod(src.mode.root + g.semitones, 12), scaleId: src.mode.scaleId } : null;
}

/**
 * The mode of what is selected (the drone's tonic, spec §10.4). Null when it is
 * not determined: an ambiguous source is not guessed at, it is resolved in SOURCE.
 * A draft has only its key (1=).
 */
export function variantMode(state: ProjectState): ModeRef | null {
  if (state.draft) return { root: state.draft.settings.keyPc, scaleId: 'ionian' };
  const base =
    state.view === 'custom' && state.custom
      ? state.custom.base
      : state.view === 'generated' && state.generated?.ok
        ? state.generated
        : null;
  if (base) return generatedMode(state, base);
  const src = sourceMode(state);
  return src.ok ? src.mode : null;
}

export interface ActiveVariant {
  id: ViewId;
  notes: readonly MelodyNote[];
  changes: readonly PitchChange[];
  diff: DiffRow[];
}

/** The variant the roll draws filled; falls back to the original when the view has none. */
export function activeVariant(state: ProjectState): ActiveVariant | null {
  const original = state.original;
  if (!original) return null;
  if (state.view === 'custom' && state.custom) {
    const v = state.custom.variant;
    return { id: 'custom', notes: v.notes, changes: v.changes, diff: diffOf(original.notes, v) };
  }
  if (state.view === 'generated' && state.generated?.ok) {
    const g = state.generated;
    return { id: 'generated', notes: g.variant.notes, changes: g.variant.changes, diff: g.diff };
  }
  return { id: 'original', notes: original.notes, changes: [], diff: [] };
}

/** Net changes of `notes` against the original: manual notes as MANUAL_EDIT, the rest from the base. */
function customChanges(
  original: readonly MelodyNote[],
  notes: readonly MelodyNote[],
  base: OkGenerated | null,
  edited: ReadonlySet<string>,
): PitchChange[] {
  const baseChanges = new Map((base?.variant.changes ?? []).map((c) => [c.noteId, c]));
  const basePitch = new Map(base?.variant.notes.map((n) => [n.id, n.pitch]));
  const out: PitchChange[] = [];
  notes.forEach((n, i) => {
    const from = (original[i] as MelodyNote).pitch;
    if (n.pitch === from) return;
    if (!edited.has(n.id)) {
      const c = baseChanges.get(n.id);
      if (c) out.push(c);
      return;
    }
    const b = basePitch.get(n.id);
    out.push({
      noteId: n.id,
      fromPitch: from,
      toPitch: n.pitch,
      reasonCode: MANUAL_EDIT,
      explanation:
        `手动修改：${pitchName(from)} → ${pitchName(n.pitch)}` +
        (b !== undefined && b !== from && b !== n.pitch ? `（生成结果为 ${pitchName(b)}）` : ''),
    });
  });
  return out;
}

function customVariant(
  original: OriginalMelody,
  base: OkGenerated | null,
  notes: readonly MelodyNote[],
  edits: PitchChange[],
  createdAt: number,
): CustomVariant {
  const edited = new Set(edits.map((e) => e.noteId));
  const transform: TransformSettings = {
    operation: 'manual-edit',
    version: MANUAL_EDIT_VERSION,
    forkedFrom: base ? 'generated' : 'original',
    base: base?.variant.transform ?? null,
    edits: edits.length,
  };
  return deepFreeze<CustomVariant>({
    forkedFrom: base ? 'generated' : 'original',
    base,
    variant: {
      id: 'custom',
      notes: [...notes],
      createdAt,
      transform,
      changes: customChanges(original.notes, notes, base, edited),
    },
    edits,
  });
}

function fork(
  state: ProjectState,
  from: 'original' | 'generated',
  createdAt: number,
): ProjectState {
  const original = state.original;
  if (!original) return state;
  const base = from === 'generated' && state.generated?.ok ? state.generated : null;
  if (from === 'generated' && !base) return state;
  const notes = base ? base.variant.notes : original.notes;
  return { ...state, custom: customVariant(original, base, notes, [], createdAt), view: 'custom' };
}

function editPitch(
  state: ProjectState,
  noteId: string,
  toPitch: number,
  createdAt: number,
  explanation?: string,
): ProjectState {
  if (!state.original) return state;
  let s = state;
  if (s.view !== 'custom' || !s.custom) {
    s = fork(s, s.view === 'generated' && s.generated?.ok ? 'generated' : 'original', createdAt);
  }
  const custom = s.custom;
  if (!custom) return state;
  const r = applyManualEdit(custom.variant.notes, noteId, toPitch, explanation);
  if (!r.ok) return state;
  return {
    ...s,
    custom: customVariant(
      s.original as OriginalMelody,
      custom.base,
      r.notes,
      [...custom.edits, r.change],
      custom.variant.createdAt,
    ),
    selectedNoteId: noteId,
  };
}

const snapshot = (s: ProjectState): Snapshot => ({
  input: s.input,
  trackId: s.trackId,
  repair: s.repair,
  validation: s.validation,
  limitError: s.limitError,
  repairPreview: s.repairPreview,
  original: s.original,
  analysis: s.analysis,
  sourceOverride: s.sourceOverride,
  target: s.target,
  generated: s.generated,
  custom: s.custom,
  view: s.view,
  draft: s.draft,
});

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  (Object.keys(a) as Array<keyof Snapshot>).every((k) => a[k] === b[k]);

/** Actions that change what undo/redo restores. */
const UNDOABLE: ReadonlySet<Action['type']> = new Set<Action['type']>([
  // Replacing the project: a new file, another track, the repair toggle,
  // 新建旋律, finishing or abandoning a draft, RESET.
  'LOADED',
  'SELECT_TRACK',
  'SET_REPAIR',
  'RESET',
  'NEW_MELODY',
  'DRAFT_FINISH',
  'DRAFT_CANCEL',
  'SET_SOURCE_OVERRIDE',
  'SET_TARGET',
  'GENERATE',
  'FORK_CUSTOM',
  'EDIT_PITCH',
  'REVERT_NOTE',
  'RESTORE_ORIGINAL',
  'DRAFT_SETTINGS',
  'DRAFT_ADD',
  'DRAFT_UPDATE',
  'DRAFT_DELETE',
]);

/** Undo/redo only touch the snapshot fields; the selection survives when its note still exists. */
function restore(state: ProjectState, snap: Snapshot, history: History): ProjectState {
  const next = { ...state, ...snap, history };
  const ids = next.draft ? next.draft.notes : (next.original?.notes ?? []);
  if (next.selectedNoteId && !ids.some((n) => n.id === next.selectedNoteId))
    next.selectedNoteId = null;
  return next;
}

/** The view after `generated` changed: a vanished generated variant falls back to the original. */
const viewAfter = (s: ProjectState): ViewId =>
  s.view === 'generated' && !s.generated?.ok ? 'original' : s.view;

function apply(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case 'LOADED': {
      const input = action.input;
      const fresh: ProjectState = {
        ...initialState,
        snap: state.snap,
        target: state.target,
        input,
      };
      // Auto-select only when there is exactly one candidate (spec §5.1).
      const only =
        input.kind === 'jianpu' || input.kind === 'new'
          ? input.kind
          : input.candidates.length === 1
            ? (input.candidates[0]?.id ?? null)
            : null;
      return select(fresh, only, false);
    }
    case 'LOAD_FAILED':
      // A file that cannot be read never replaces the current project.
      return { ...state, loadFailure: action.failure };
    case 'SELECT_TRACK':
      return select(state, action.trackId, false);
    case 'SET_REPAIR':
      return state.trackId === null ? state : select(state, state.trackId, action.repair);
    case 'SET_SOURCE_OVERRIDE': {
      const s = { ...state, sourceOverride: action.mode, generated: null };
      return { ...s, view: viewAfter(s) };
    }
    case 'SET_TARGET': {
      const patch = action.patch as Record<string, unknown>;
      const cur = state.target as unknown as Record<string, unknown>;
      if (Object.keys(patch).every((k) => patch[k] === cur[k])) return state;
      const s = { ...state, target: { ...state.target, ...action.patch }, generated: null };
      return { ...s, view: viewAfter(s) };
    }
    case 'GENERATE': {
      const generated = generate(state, action.createdAt);
      const s = { ...state, generated };
      return { ...s, view: generated?.ok ? 'generated' : viewAfter(s) };
    }
    case 'RESET':
      return { ...initialState, snap: state.snap, target: state.target };

    case 'SET_VIEW': {
      const ok =
        action.view === 'original' ||
        (action.view === 'generated' && state.generated?.ok) ||
        (action.view === 'custom' && state.custom);
      return ok && state.original ? { ...state, view: action.view } : state;
    }
    case 'SELECT_NOTE':
      return { ...state, selectedNoteId: action.noteId };
    case 'SET_SNAP':
      return { ...state, snap: action.snap };
    case 'FORK_CUSTOM':
      return fork(state, action.from, action.createdAt);
    case 'EDIT_PITCH':
      return editPitch(state, action.noteId, action.toPitch, action.createdAt);
    case 'REVERT_NOTE': {
      const n = state.original?.notes.find((x) => x.id === action.noteId);
      return n
        ? editPitch(
            state,
            action.noteId,
            n.pitch,
            action.createdAt,
            `恢复原音：${pitchName(n.pitch)}`,
          )
        : state;
    }
    case 'RESTORE_ORIGINAL':
      return fork(state, 'original', action.createdAt);
    case 'UNDO':
    case 'REDO':
      return state; // handled in reducer()

    case 'NEW_MELODY':
      return {
        ...initialState,
        snap: state.snap,
        target: state.target,
        draft: emptyDraft(action.settings),
      };
    case 'DRAFT_SETTINGS': {
      const d = state.draft;
      if (!d) return state;
      return { ...state, draft: { ...d, settings: { ...d.settings, ...action.patch } } };
    }
    case 'DRAFT_ADD': {
      const d = state.draft;
      if (!d) return state;
      const next = addNote(d, action);
      if (next === d) return state;
      return { ...state, draft: next, selectedNoteId: `draft:${d.nextId}` };
    }
    case 'DRAFT_UPDATE': {
      const d = state.draft;
      if (!d) return state;
      const next = updateNote(d, action.noteId, action.patch);
      return next === d ? state : { ...state, draft: next };
    }
    case 'DRAFT_DELETE': {
      const d = state.draft;
      if (!d) return state;
      const next = deleteNote(d, action.noteId);
      if (next === d) return state;
      return {
        ...state,
        draft: next,
        selectedNoteId: state.selectedNoteId === action.noteId ? null : state.selectedNoteId,
      };
    }
    case 'DRAFT_FINISH': {
      const d = state.draft;
      if (!d || d.notes.length === 0) return state;
      const melody = draftMelody(d);
      const loaded = apply(
        { ...state, draft: null },
        {
          type: 'LOADED',
          input: {
            kind: 'new',
            fileName: null,
            melody: { ...melody, warnings: [] },
            keyPitchClass: d.settings.keyPc,
          },
        },
      );
      return loaded;
    }
    case 'DRAFT_CANCEL':
      return state.draft ? { ...initialState, snap: state.snap, target: state.target } : state;
  }
}

export function reducer(state: ProjectState, action: Action): ProjectState {
  const { past, future } = state.history;
  if (action.type === 'UNDO') {
    const prev = past[past.length - 1];
    if (!prev) return state;
    return restore(state, prev, {
      past: past.slice(0, -1),
      future: [snapshot(state), ...future].slice(0, HISTORY_LIMIT),
    });
  }
  if (action.type === 'REDO') {
    const next = future[0];
    if (!next) return state;
    return restore(state, next, {
      past: [...past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: future.slice(1),
    });
  }
  // History is managed here only; `apply` never touches it.
  const applied = apply(state, action);
  if (applied === state) return state;
  const next = applied.history === state.history ? applied : { ...applied, history: state.history };
  if (!UNDOABLE.has(action.type)) return next;
  const before = snapshot(state);
  if (sameSnapshot(before, snapshot(next))) return next;
  return {
    ...next,
    history: { past: [...past, before].slice(-HISTORY_LIMIT), future: [] },
  };
}
