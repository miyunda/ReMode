// Initial browser limits (spec §5.1, §13.2), measured in
// docs/decisions/m2a-implementation-notes.md. Parsing, validation, analysis,
// strict and re-check stay under ~15 ms even at 20 000 notes; MIDI export
// (@tonejs/midi) grows superlinearly (≈160 ms at 5 000 notes, ≈2.6 s at
// 20 000), so the melody being processed is capped lower than the file.

export interface WebLimits {
  /** Checked on File.size before reading a byte. */
  maxFileBytes: number;
  /** Total notes in a MIDI file (all tracks). */
  maxNotes: number;
  /** Notes in the melody being analysed and transformed (selected track or jianpu text). */
  maxMelodyNotes: number;
  /** Characters of jianpu text (pasted or loaded from a file). */
  maxJianpuChars: number;
}

export const WEB_LIMITS: WebLimits = {
  maxFileBytes: 1024 * 1024,
  maxNotes: 20_000,
  maxMelodyNotes: 5_000,
  maxJianpuChars: 100_000,
};

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MiB`
    : n >= 1024
      ? `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} KiB`
      : `${n} B`;
