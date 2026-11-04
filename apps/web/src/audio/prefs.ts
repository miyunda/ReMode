// Audio preferences in guarded localStorage: storage can be missing or throw
// (private mode, blocked site data), and a value can be stale or hand-edited.

import type { DroneMode } from './drone';
import { TIMBRES, type TimbreId } from './timbres';

export const AUDIO_PREFS_KEY = 'remode.audio';

export interface AudioPrefs {
  /** 试听音符: sound notes on selection and edits. */
  audition: boolean;
  droneOn: boolean;
  droneMode: DroneMode;
  /** 0..1 */
  masterVolume: number;
  /** 0..1 */
  droneVolume: number;
  timbre: TimbreId;
}

// Drone on, tonic only: see docs/decisions/m2c-implementation-notes.md (spec §18 question 5).
export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  audition: true,
  droneOn: true,
  droneMode: 'tonic',
  masterVolume: 0.8,
  droneVolume: 0.6,
  timbre: 'soft',
};

const unit = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function parsePrefs(raw: string | null): AudioPrefs {
  const d = DEFAULT_AUDIO_PREFS;
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>;
  } catch {
    return d;
  }
  return {
    audition: bool(v['audition'], d.audition),
    droneOn: bool(v['droneOn'], d.droneOn),
    droneMode: v['droneMode'] === 'tonic-fifth' ? 'tonic-fifth' : 'tonic',
    masterVolume: unit(v['masterVolume'], d.masterVolume),
    droneVolume: unit(v['droneVolume'], d.droneVolume),
    timbre: TIMBRES.find((t) => t.id === v['timbre'])?.id ?? d.timbre,
  };
}

export function readPrefs(): AudioPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(AUDIO_PREFS_KEY));
  } catch {
    return DEFAULT_AUDIO_PREFS;
  }
}

export function savePrefs(prefs: AudioPrefs): void {
  try {
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* not persisted; the choice still applies to this page */
  }
}
