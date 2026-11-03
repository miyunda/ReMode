import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MelodyNote } from '../src/index.js';

export const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));

export interface ManifestEntry {
  file: string;
  description: string;
  expect: {
    import: {
      ok: boolean;
      errorCode?: string;
      format?: 0 | 1;
      ppq?: number;
      melodyTracks?: number;
      percussionTracks?: number;
      emptyTracks?: number;
      warnings?: string[];
      tempoCount?: number;
      timeSignatureCount?: number;
    };
    validation?: {
      trackId: string;
      ok: boolean;
      monophonic: boolean;
      codes: string[];
      repairable?: number;
    };
    analysis?: {
      trackId: string;
      top?: { root: string; scaleId: string; name?: string; aliases?: string[] };
      ambiguities: string[];
      absent?: string[];
      missingDegreesScaleIds?: string[];
    };
  };
}

export const manifest = (): ManifestEntry[] =>
  (JSON.parse(readFileSync(`${FIXTURE_DIR}manifest.json`, 'utf8')) as { fixtures: ManifestEntry[] })
    .fixtures;

export const fixtureBytes = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(`${FIXTURE_DIR}${file}`));

let counter = 0;
/** Build notes from [pitch, startBeat, beats] with PPQ 480. */
export function notesOf(spec: Array<[number, number, number]>, ppq = 480): MelodyNote[] {
  return spec.map(([pitch, start, beats]) => ({
    id: `n${counter++}`,
    pitch,
    startTick: Math.round(start * ppq),
    durationTick: Math.round(beats * ppq),
    velocity: 0.75,
  }));
}
