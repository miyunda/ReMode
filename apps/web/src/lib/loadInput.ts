// Turn a dropped/picked file or pasted jianpu text into parsed data through
// @remode/core. Everything happens in memory; nothing leaves the browser.

import {
  importMidi,
  melodyCandidates,
  parseJianpu,
  type ImportedTrack,
  type JianpuMelody,
  type JianpuWarning,
  type ParsedMidi,
} from '@remode/core';
import { WEB_LIMITS, formatBytes, type WebLimits } from './limits';

export type InputKind = 'midi' | 'jianpu';

export type LoadedInput =
  | {
      kind: 'midi';
      fileName: string;
      byteLength: number;
      midi: ParsedMidi;
      /** Non-empty, non-percussion tracks (spec §5.1). */
      candidates: ImportedTrack[];
    }
  | {
      kind: 'jianpu';
      /** null for text typed into the textarea. */
      fileName: string | null;
      text: string;
      melody: JianpuMelody;
    };

export interface LoadIssue {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface LoadFailure {
  /** Which step refused the input: reading the file, the MIDI parser or the jianpu parser. */
  stage: 'file' | 'midi' | 'jianpu';
  fileName: string | null;
  errors: LoadIssue[];
  warnings: LoadIssue[];
}

export type LoadResult = { ok: true; input: LoadedInput } | { ok: false; failure: LoadFailure };

const MIDI_EXT = /\.(mid|midi)$/i;
const TEXT_EXT = /\.(jianpu|txt)$/i;
export const ACCEPT = '.mid,.midi,.jianpu,.txt';

const fail = (
  stage: LoadFailure['stage'],
  fileName: string | null,
  errors: LoadIssue[],
  warnings: LoadIssue[] = [],
): LoadResult => ({ ok: false, failure: { stage, fileName, errors, warnings } });

const isMidiMagic = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0x4d && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64;

/** Jianpu text → parsed melody. */
export function loadJianpuText(
  text: string,
  fileName: string | null,
  limits: WebLimits = WEB_LIMITS,
): LoadResult {
  const r = parseJianpu(text, {
    ...(fileName ? { sourceFileName: fileName } : {}),
    limits: { maxChars: limits.maxJianpuChars, maxNotes: limits.maxMelodyNotes },
  });
  if (!r.ok) return fail('jianpu', fileName, r.errors, r.warnings);
  const melody: JianpuMelody = {
    parserVersion: r.parserVersion,
    header: r.header,
    notes: r.notes,
    metadata: r.metadata,
    bars: r.bars,
    warnings: r.warnings,
  };
  return { ok: true, input: { kind: 'jianpu', fileName, text, melody } };
}

/** File bytes → parsed MIDI or jianpu, chosen by extension, then by content. */
export function loadBytes(
  bytes: Uint8Array,
  fileName: string,
  limits: WebLimits = WEB_LIMITS,
): LoadResult {
  if (bytes.length > limits.maxFileBytes) {
    return fail('file', fileName, [
      {
        code: 'FILE_TOO_LARGE',
        message: `${formatBytes(bytes.length)}，超过 ${formatBytes(limits.maxFileBytes)} 的上限。`,
      },
    ]);
  }
  const midi = MIDI_EXT.test(fileName) || (!TEXT_EXT.test(fileName) && isMidiMagic(bytes));
  if (midi) {
    const r = importMidi(bytes, {
      sourceFileName: fileName,
      limits: { maxFileBytes: limits.maxFileBytes, maxNotes: limits.maxNotes },
    });
    if (!r.ok) return fail('midi', fileName, [r.error]);
    return {
      ok: true,
      input: {
        kind: 'midi',
        fileName,
        byteLength: bytes.length,
        midi: r.midi,
        candidates: melodyCandidates(r.midi),
      },
    };
  }
  if (!TEXT_EXT.test(fileName)) {
    return fail('file', fileName, [
      {
        code: 'UNSUPPORTED_FILE_TYPE',
        message: '只支持 .mid / .midi（标准 MIDI 文件）和 .jianpu / .txt（简谱文本）。',
      },
    ]);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('file', fileName, [
      { code: 'NOT_UTF8', message: '文本文件不是有效的 UTF-8 编码。' },
    ]);
  }
  return loadJianpuText(text.replace(/^\uFEFF/, ''), fileName, limits);
}

/** Read a File (size is checked before any byte is read). */
export async function loadFile(file: File, limits: WebLimits = WEB_LIMITS): Promise<LoadResult> {
  if (file.size > limits.maxFileBytes) {
    return fail('file', file.name, [
      {
        code: 'FILE_TOO_LARGE',
        message: `${formatBytes(file.size)}，超过 ${formatBytes(limits.maxFileBytes)} 的上限。`,
      },
    ]);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return fail('file', file.name, [{ code: 'READ_FAILED', message: '无法读取文件。' }]);
  }
  return loadBytes(bytes, file.name, limits);
}

export type { JianpuWarning };
