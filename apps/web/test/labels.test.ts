// Every structured code core (and the web layer) can emit has a Chinese label.
// The Record types make this list exhaustive at compile time: a new code in
// core fails `pnpm typecheck` until it is added here and labelled.
import { describe, expect, it } from 'vitest';
import type {
  AmbiguityCode,
  ExportErrorCode,
  ExportWarningCode,
  ImportErrorCode,
  ImportWarningCode,
  JianpuErrorCode,
  JianpuWarningCode,
  StrictReasonCode,
  TransformErrorCode,
  TransformWarningCode,
  ValidationCode,
} from '@remode/core';
import { codeLabel } from '../src/lib/labels';

type CoreCode =
  | AmbiguityCode
  | ExportErrorCode
  | ExportWarningCode
  | ImportErrorCode
  | ImportWarningCode
  | JianpuErrorCode
  | JianpuWarningCode
  | StrictReasonCode
  | TransformErrorCode
  | TransformWarningCode
  | ValidationCode;

// prettier-ignore
const CORE: Record<CoreCode, true> = {
  MISSING_DEGREES: true, MULTIPLE_COLLECTIONS: true, TONIC_UNCLEAR: true, CHROMATIC_HEAVY: true,
  TOO_SHORT: true, INVALID_PPQ: true, INVALID_TEMPO: true, INVALID_TIME_SIGNATURE: true,
  INVALID_KEY_SIGNATURE: true, INVALID_CHANNEL: true, INVALID_PROGRAM: true, INVALID_NOTE: true,
  UNKNOWN_SCALE: true, VELOCITY_QUANTIZED: true, VELOCITY_ZERO_RAISED: true, TEMPO_ROUNDED: true,
  KEY_SIGNATURE_DROPPED: true, SOURCE_KEY_SIGNATURES_REPLACED: true, PITCH_BEND_DROPPED: true,
  SUSTAIN_PEDAL_DROPPED: true, TRACKS_DROPPED: true, EMPTY_FILE: true, FILE_TOO_LARGE: true,
  NOT_MIDI: true, INVALID_HEADER: true, TRUNCATED: true, NO_TRACKS: true,
  UNSUPPORTED_FORMAT: true, SMPTE_TIMING: true, TOO_MANY_NOTES: true, PARSE_FAILED: true,
  DEFAULT_TEMPO: true, DEFAULT_TIME_SIGNATURE: true, TRACK_COUNT_MISMATCH: true,
  TRAILING_BYTES: true, TYPE0_SPLIT_BY_CHANNEL: true, TEXT_TOO_LONG: true, INVALID_KEY: true,
  DUPLICATE_HEADER: true, HEADER_AFTER_NOTES: true, INVALID_DEGREE: true,
  INVALID_REST_MODIFIER: true, MIXED_OCTAVE_MARKS: true, UNSUPPORTED_DURATION: true,
  UNSUPPORTED_ACCIDENTAL: true, DANGLING_ACCIDENTAL: true, DANGLING_EXTENDER: true,
  PITCH_OUT_OF_RANGE: true, UNSUPPORTED_TUPLET: true, UNSUPPORTED_ORNAMENT: true,
  UNSUPPORTED_REPEAT: true, UNEXPECTED_CHARACTER: true, NO_NOTES: true, DEFAULT_KEY: true,
  BAR_DURATION_MISMATCH: true, KEY_SIGNATURE_RESPELLED: true, DEGREE_MAPPED: true,
  SCALE_POSITION_MAPPED: true, SCALE_CONSTRAINT: true, ACCIDENTAL_NEAREST: true, TRANSPOSE: true,
  RANGE_ADJUSTMENT: true, INVALID_SEMITONES: true, INVALID_ROOT: true, INVALID_RANGE: true,
  ACCIDENTAL_REJECTED: true, PRESERVE_REQUIRES_LOOSE_TARGET: true, RANGE_SHIFTED: true,
  RANGE_NO_FIT: true, ACCIDENTALS_MAPPED: true, ACCIDENTALS_PRESERVED: true,
  NO_CHARACTERISTIC_DEGREE: true, CONTOUR_REVERSED: true, REPETITION_INTRODUCED: true,
  EMPTY_TRACK: true, PERCUSSION_TRACK: true, INVALID_PITCH: true, INVALID_START: true,
  INVALID_DURATION: true, INVALID_VELOCITY: true, SAME_TICK_CHORD: true, DUPLICATE_NOTE: true,
  OVERLAP: true, PITCH_BEND_PRESENT: true, SUSTAIN_PEDAL_PRESENT: true,
};

/** ModeCandidate.warnings are plain strings in core (analyzer.ts); listed by hand. */
const CANDIDATE_WARNINGS = ['BELOW_COVERAGE_THRESHOLD', 'OUT_OF_SET_NOTES', 'NOT_FINAL_NOTE'];
/** Codes the web layer adds. */
const WEB = [
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'NOT_UTF8',
  'READ_FAILED',
  'MELODY_TOO_LONG',
  'SOURCE_MODE_AMBIGUOUS',
];

describe('code labels', () => {
  it.each([...Object.keys(CORE), ...CANDIDATE_WARNINGS, ...WEB])(
    '%s has a Chinese label',
    (code) => {
      expect(codeLabel(code)).not.toBe(code);
      expect(codeLabel(code)).toMatch(/[一-鿿]/);
    },
  );
});
