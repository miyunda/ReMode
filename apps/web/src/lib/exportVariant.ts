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
import type { MelodyNote } from '@remode/core';
import type { CustomVariant, OkGenerated, OriginalMelody, ViewId } from '../state/project';

export type VariantExport = ExportResult & { fileName: string };

/**
 * Key signature and §11.1 file name for notes derived from `generated` (or
 * from the original when null); `custom` marks manually edited notes.
 */
function plan(
  original: OriginalMelody,
  generated: OkGenerated | null,
  custom: boolean,
): { keySignature: NonNullable<ExportOptions['keySignature']>; fileName: string } {
  const meta = original.metadata;
  const source = meta.sourceFileName ?? '';
  if (!generated) {
    return {
      keySignature: { kind: 'source' },
      fileName: exportFileName({ source, variant: custom ? 'custom' : 'original' }),
    };
  }
  if (generated.operation === 'parallel-remode') {
    const { root, scaleId } = generated.target;
    return {
      keySignature: { kind: 'mode', rootPitchClass: root, scaleId },
      fileName: exportFileName({
        source,
        rootPitchClass: root,
        scaleId,
        variant: custom ? 'custom' : 'strict',
      }),
    };
  }
  const n = generated.semitones;
  const direction = n > 0 ? `up${n}` : n < 0 ? `down${-n}` : '0';
  return {
    keySignature:
      (meta.keySignatures ?? []).length > 0 && mod(n, 12) !== 0
        ? { kind: 'omit' }
        : { kind: 'source' },
    fileName: exportFileName({
      source,
      variant: `transpose-${direction}${custom ? '-custom' : ''}`,
    }),
  };
}

function encode(
  original: OriginalMelody,
  notes: readonly MelodyNote[],
  p: ReturnType<typeof plan>,
): VariantExport {
  const result = exportMidi(
    notes,
    { ...original.metadata },
    {
      keySignature: p.keySignature,
      source: original.exportSource,
    },
  );
  return { ...result, fileName: p.fileName };
}

export function exportGenerated(original: OriginalMelody, generated: OkGenerated): VariantExport {
  return encode(original, generated.variant.notes, plan(original, generated, false));
}

/** The custom variant keeps the key signature of what it was forked from; its name ends in `custom`. */
export function exportCustom(original: OriginalMelody, custom: CustomVariant): VariantExport {
  return encode(original, custom.variant.notes, plan(original, custom.base, true));
}

export function exportView(
  view: ViewId,
  original: OriginalMelody,
  generated: OkGenerated | null,
  custom: CustomVariant | null,
): VariantExport {
  if (view === 'custom' && custom) return exportCustom(original, custom);
  if (view === 'generated' && generated) return exportGenerated(original, generated);
  return encode(original, original.notes, plan(original, null, false));
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
