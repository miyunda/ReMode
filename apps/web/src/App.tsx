import { useEffect, useState } from 'react';
import { ANALYSIS_VERSION, JIANPU_PARSER_VERSION, STRICT_TRANSFORM_VERSION } from '@remode/core';
import { AudioProvider, ProgramSync } from './audio/AudioProvider';
import type { PlaybackEngine } from './audio/engine';
import { AnalysisView } from './components/AnalysisView';
import { ChangeInspector } from './components/ChangeInspector';
import { DraftPanel } from './components/DraftPanel';
import { ImportPanel } from './components/ImportPanel';
import { NoteInspector } from './components/NoteInspector';
import { PianoRollPanel } from './components/PianoRollPanel';
import { SourceModeCard } from './components/SourceModeCard';
import { TargetPanel } from './components/TargetPanel';
import { TrackList } from './components/TrackList';
import { TransportPanel } from './components/TransportPanel';
import { ValidationView } from './components/ValidationView';
import { Section } from './components/ui';
import { applyThemePref, readThemePref, saveThemePref, type ThemePref } from './lib/theme';
import { ProjectProvider, useDispatch, useProject } from './state/ProjectContext';

function ThemeSelect() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  useEffect(() => applyThemePref(pref), [pref]);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-text">主题</span>
      <select
        className="field"
        value={pref}
        data-testid="theme-select"
        onChange={(e) => {
          const next = e.target.value as ThemePref;
          saveThemePref(next);
          setPref(next);
        }}
      >
        <option value="system">跟随系统</option>
        <option value="light">Rosé Pine Dawn（浅色）</option>
        <option value="dark">Rosé Pine（深色）</option>
      </select>
    </label>
  );
}

function Header() {
  const { input, draft } = useProject();
  const project = draft
    ? '新建旋律（编辑中）'
    : input?.kind === 'midi'
      ? input.fileName
      : input?.kind === 'jianpu'
        ? (input.fileName ?? '简谱输入')
        : input?.kind === 'new'
          ? '新建旋律'
          : null;
  return (
    <header className="border-b border-hl-med bg-surface">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h1 className="text-xl font-bold tracking-tight">ReMode</h1>
          <p className="text-sm text-muted-text">Same Melody. Different Mood.</p>
        </div>
        <p className="min-w-0 truncate text-sm" data-testid="project-name">
          <span className="text-muted-text">项目：</span>
          {project ?? '未导入'}
        </p>
        <ThemeSelect />
      </div>
    </header>
  );
}

/** Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z or Ctrl+Y redo; text fields keep their own undo. */
function useUndoShortcuts() {
  const dispatch = useDispatch();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z') dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
      else if (key === 'y' && !e.shiftKey) dispatch({ type: 'REDO' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}

function Workbench() {
  const { original, analysis, draft } = useProject();
  useUndoShortcuts();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded focus:bg-surface focus:p-2"
      >
        跳到主要内容
      </a>
      <Header />
      <main
        id="main"
        className="mx-auto grid w-full max-w-[1600px] flex-1 gap-4 p-4 lg:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Section id="source" title="Source" subtitle="来源">
            <ImportPanel />
            <TrackList />
            <ValidationView />
            {original && analysis && <SourceModeCard />}
          </Section>
          <Section id="target" title="Target" subtitle="目标">
            <TargetPanel />
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {draft ? <DraftPanel /> : <PianoRollPanel />}
          <TransportPanel />
          {!draft && <NoteInspector />}
          <ChangeInspector />
          <AnalysisView />
        </div>
      </main>
      <footer className="border-t border-hl-med bg-surface">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap justify-between gap-2 px-4 py-3 text-xs text-muted-text">
          <p>隐私：文件与简谱只在本机浏览器内处理，不上传、不联网、不保存。</p>
          <p className="font-mono">
            {ANALYSIS_VERSION} · {STRICT_TRANSFORM_VERSION} · {JIANPU_PARSER_VERSION}
          </p>
        </div>
      </footer>
    </div>
  );
}

export function App({ engine }: { engine?: PlaybackEngine }) {
  return (
    <ProjectProvider>
      <AudioProvider {...(engine ? { engine } : {})}>
        <ProgramSync />
        <Workbench />
      </AudioProvider>
    </ProjectProvider>
  );
}
