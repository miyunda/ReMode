// The transport as React state. The engine lives outside React: discrete state
// reaches components through useSyncExternalStore, and the moving position is
// read in animation frames (engine.position()) so playback never re-renders.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { draftMelody } from '../lib/draft';
import { activeVariant, variantMode, type ProjectState } from '../state/project';
import { useProject } from '../state/ProjectContext';
import { PlaybackEngine, type Program, type TransportSnapshot } from './engine';
import { readPrefs, savePrefs } from './prefs';
import { createWebAudioHost } from './webAudioHost';

const EngineContext = createContext<PlaybackEngine | null>(null);

const createEngine = () =>
  new PlaybackEngine({ host: createWebAudioHost(), prefs: readPrefs(), onPrefs: savePrefs });

export function AudioProvider({
  engine,
  children,
}: {
  engine?: PlaybackEngine;
  children: ReactNode;
}) {
  const [own] = useState(() => engine ?? createEngine());
  return <EngineContext.Provider value={own}>{children}</EngineContext.Provider>;
}

export function useEngine(): PlaybackEngine {
  const e = useContext(EngineContext);
  if (!e) throw new Error('useEngine outside AudioProvider');
  return e;
}

export function useTransport(): TransportSnapshot {
  const e = useEngine();
  return useSyncExternalStore(e.subscribe, e.getSnapshot);
}

/** The transport props of a RollCanvas. */
export function useRollAudio() {
  const engine = useEngine();
  const { status, tick, loop, loopOn } = useTransport();
  return useMemo(
    () => ({
      playback: {
        tick: engine.position,
        playing: status === 'playing',
        atTick: tick,
        loop,
        loopOn,
      },
      onSeek: (t: number) => engine.seek(t),
      onLoopRange: (a: number, b: number) => engine.setLoop(a, b),
      onAudition: (pitch: number) => engine.audition(pitch),
    }),
    [engine, status, tick, loop, loopOn],
  );
}

/** The selected variant as a Program; the draft plays without being finished first. */
export function programOf(state: ProjectState): Program | null {
  const mode = variantMode(state);
  if (state.draft) {
    const { notes, metadata } = draftMelody(state.draft);
    return { key: 'draft', notes, ppq: metadata.ppq, tempoMap: metadata.tempoMap, mode };
  }
  const active = activeVariant(state);
  const original = state.original;
  if (!active || !original) return null;
  const { ppq, tempoMap } = original.metadata;
  return { key: original, notes: active.notes, ppq, tempoMap, mode };
}

/** Keeps the engine on the selected variant; renders nothing. */
export function ProgramSync() {
  const engine = useEngine();
  const state = useProject();
  const { draft, original, view, generated, custom, analysis, sourceOverride } = state;
  const program = useMemo(
    () => programOf(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields programOf reads
    [draft, original, view, generated, custom, analysis, sourceOverride],
  );
  useEffect(() => engine.setProgram(program), [engine, program]);
  // Leaving the page (or a test unmounting the app) must not leave sound behind.
  useEffect(() => () => engine.stop(), [engine]);
  return null;
}
