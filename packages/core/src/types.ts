// Canonical data model (spec §4.1, §6.5). Ticks are the only editable time base;
// seconds and note names are always derived.

export interface MelodyNote {
  /** Stable ID, shared by every variant derived from this note. */
  id: string;
  /** MIDI note number, integer 0..127. */
  pitch: number;
  /** >= 0 */
  startTick: number;
  /** > 0 */
  durationTick: number;
  /** Normalised 0..1. */
  velocity: number;
}

export interface TempoEvent {
  tick: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface KeySignatureEvent {
  tick: number;
  key: string;
  scale: 'major' | 'minor';
}

export interface MidiMetadata {
  ppq: number;
  tempoMap: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  keySignatures?: KeySignatureEvent[];
  trackName?: string;
  instrumentProgram?: number;
  channel?: number;
  sourceFileName?: string;
}

export type VariantId = 'original' | 'strict' | 'expressive' | 'custom';

/** Transform settings are defined in M1 (spec §7); M0 only reserves the slot. */
export interface TransformSettings {
  operation: 'parallel-remode' | 'transpose' | 'relative-recenter' | 'manual-edit';
  [key: string]: unknown;
}

export interface PitchChange {
  noteId: string;
  fromPitch: number;
  toPitch: number;
  reasonCode: string;
  explanation?: string;
}

export interface MelodyVariant {
  id: VariantId;
  notes: MelodyNote[];
  createdAt: number;
  transform: TransformSettings | null;
  changes: PitchChange[];
}

export interface MelodyProject {
  schemaVersion: 1;
  metadata: MidiMetadata;
  original: readonly MelodyNote[];
  variants: Partial<Record<VariantId, MelodyVariant>>;
  selectedTrackId: string;
  sourceAnalysis?: ModeAnalysis;
}

// ---------------------------------------------------------------------------
// Scales (spec §6.2, §7.2)

export type ChineseTonicDegree = 'gong' | 'shang' | 'jue' | 'zhi' | 'yu';

export type ChineseScaleType =
  'pentatonic' | 'hexa-qingjiao' | 'hexa-biangong' | 'qingyue' | 'yayue' | 'yanyue';

export interface ChineseModeRef {
  /** Pitch class of 宫. */
  gongPitchClass: number;
  tonicDegree: ChineseTonicDegree;
  scaleType: ChineseScaleType;
}

export interface DegreeIdentity {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  alter: -1 | 0 | 1;
}

export interface ScaleDefinition {
  id: string;
  label: string;
  /** Semitones above the tonic, ascending, starting with 0. */
  intervals: number[];
  family: 'diatonic' | 'pentatonic' | 'hexatonic' | 'other';
  /** Degree identity of each interval relative to the tonic (parallel to `intervals`). */
  degreeIdentity: DegreeIdentity[];
  /** Role name of each interval (parallel to `intervals`). */
  degreeRoles: string[];
  /** Degree numbers (1..7, see `degreeIdentity`) that give the mode its colour. */
  characteristicDegrees: number[];
  avoidDegrees?: number[];
  chinese?: Omit<ChineseModeRef, 'gongPitchClass'>;
}

// ---------------------------------------------------------------------------
// Mode analysis (spec §6.3–6.5)

export type CollectionId = 'pentatonic' | 'hexatonic' | 'diatonic';

export interface CollectionMatch {
  collectionId: CollectionId;
  /** 0..11. Pitch class the collection's reference set is built on (see collection.ts). */
  transposition: number;
  /** Duration share of notes inside the set, 0..1. Not a probability. */
  coverage: number;
  outOfSet: Array<{ pitchClass: number; durationShare: number }>;
  /** Absolute pitch classes (0..11) of set members the melody never uses. */
  unusedDegrees: number[];
}

export type TonicEvidenceKind =
  'FINAL_NOTE' | 'PHRASE_END' | 'LONG_NOTE' | 'STRONG_BEAT' | 'AMBITUS' | 'FIRST_NOTE';

export interface TonicEvidence {
  kind: TonicEvidenceKind;
  noteIds: string[];
  /** Integer evidence points from the versioned config; never a probability. */
  points: number;
  /** Notes of this kind that support the candidate. */
  matched: number;
  /** Notes of this kind in the melody (e.g. number of non-final phrase endings). */
  of: number;
  /** Human-readable statement of the evidence. */
  detail: string;
}

export interface ModeName {
  rootPitchClass: number;
  scaleId: string;
  name: string;
  chinese?: ChineseModeRef;
}

export interface ModeCandidate {
  rootPitchClass: number;
  scaleId: string;
  /** e.g. "D Dorian", "D 徵调式（G 宫系统，五声）". */
  name: string;
  chinese?: ChineseModeRef;
  /** Other names for exactly the same pitch set and tonic (e.g. 七声 interpretations). */
  aliases: ModeName[];
  collection: CollectionMatch;
  tonicEvidence: TonicEvidence[];
  /** Plain sum of `tonicEvidence[].points`; shown next to the evidence it sums. */
  evidencePoints: number;
  /** 1-based; candidates with identical ordering keys share a rank. */
  rank: number;
  warnings: string[];
}

export type AmbiguityCode =
  'MISSING_DEGREES' | 'MULTIPLE_COLLECTIONS' | 'TONIC_UNCLEAR' | 'CHROMATIC_HEAVY' | 'TOO_SHORT';

export interface Ambiguity {
  code: AmbiguityCode;
  detail: string;
  /**
   * Scale IDs the ambiguity applies to. Empty only for TOO_SHORT on a melody
   * with no candidates (e.g. no notes at all).
   */
  affectedScaleIds: string[];
  /** Fully qualified modes (root + scale) behind `affectedScaleIds`. */
  affectedModes?: ModeName[];
  /** Scale degrees (relative to the tonic) behind MISSING_DEGREES. */
  missingDegrees?: number[];
}

export interface TonicEvidencePoints {
  FINAL_NOTE: number;
  PHRASE_END: number;
  LONG_NOTE: number;
  STRONG_BEAT: number;
  AMBITUS: number;
  FIRST_NOTE: number;
}

export interface AnalysisConfig {
  /** Minimum coverage for a collection to count as compatible (spec §6.3). */
  coverageThreshold: number;
  /** Maximum points per evidence kind; count-based kinds are scaled by their match share. */
  evidencePoints: TonicEvidencePoints;
  /** A note is "long" when durationTick >= factor × mean duration. */
  longNoteFactor: number;
  /** Rest (in beats) that ends a phrase. */
  phraseRestBeats: number;
  /** A note of >= this factor × median duration and >= 1 beat ends a phrase. */
  phraseLongNoteFactor: number;
  /** TONIC_UNCLEAR when the best candidate leads the next one by fewer points than this. */
  tonicMarginPoints: number;
  /** TOO_SHORT below this many notes. */
  minNotes: number;
  /** TOO_SHORT below this many distinct pitch classes. */
  minDistinctPitchClasses: number;
}

export interface PitchClassDistribution {
  /** Duration in ticks per pitch class 0..11. */
  durations: number[];
  /** Duration share per pitch class, 0..1 (sums to 1 unless empty). */
  shares: number[];
  totalDuration: number;
  weighting: 'ticks';
}

export interface KsBaselineResult {
  tonicPitchClass: number;
  mode: 'major' | 'minor';
  name: string;
  /** Pearson correlation coefficient (-1..1). Comparison baseline only. */
  correlation: number;
}

export interface KsBaseline {
  method: 'krumhansl-schmuckler';
  profiles: 'krumhansl-kessler-1982';
  usedForRanking: false;
  top: KsBaselineResult[];
}

export interface ModeAnalysis {
  candidates: ModeCandidate[];
  ambiguities: Ambiguity[];
  analysisVersion: string;
  config: AnalysisConfig;
  noteCount: number;
  pcd: PitchClassDistribution;
  /** Every collection match with coverage >= threshold, smallest collections first. */
  compatibleCollections: CollectionMatch[];
  /** The collections candidates were drawn from (smallest compatible, or best fallback). */
  selectedCollections: CollectionMatch[];
  phrases: Array<{ startNoteId: string; endNoteId: string; noteCount: number }>;
  /** Comparison baseline only; never consulted for ranking (ADR-004). */
  baseline?: KsBaseline;
}
