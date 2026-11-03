// Encode the original or a generated variant with the core exporter.
// Key signatures (spec §11.1): a remode writes the target collection's key
// signature (`mode` policy); a transpose by a non-octave interval drops the
// source key signatures, as the CLI does.

import {
  exportFileName,
  exportMidi,
  mod,
  type ExportOptions,
  type ExportResult,
} from '@remode/core';
import type { GeneratedVariant, OriginalMelody } from '../state/project';

export type VariantExport = ExportResult & { fileName: string };

export function exportGenerated(
  original: OriginalMelody,
  generated: Extract<GeneratedVariant, { ok: true }>,
): VariantExport {
  const meta = { ...original.metadata };
  const source = meta.sourceFileName ?? '';
  let keySignature: ExportOptions['keySignature'];
  let fileName: string;
  if (generated.operation === 'parallel-remode') {
    const { root, scaleId } = generated.target;
    keySignature = { kind: 'mode', rootPitchClass: root, scaleId };
    fileName = exportFileName({ source, rootPitchClass: root, scaleId, variant: 'strict' });
  } else {
    const n = generated.semitones;
    keySignature =
      (meta.keySignatures ?? []).length > 0 && mod(n, 12) !== 0
        ? { kind: 'omit' }
        : { kind: 'source' };
    const direction = n > 0 ? `up${n}` : n < 0 ? `down${-n}` : '0';
    fileName = exportFileName({ source, variant: `transpose-${direction}` });
  }
  const result = exportMidi(generated.variant.notes, meta, {
    keySignature,
    source: original.exportSource,
  });
  return { ...result, fileName };
}

/** Hand bytes to the browser as a download; no network involved. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
