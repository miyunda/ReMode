import { useEffect, useState } from 'react';
import { ANALYSIS_VERSION, JIANPU_PARSER_VERSION, STRICT_TRANSFORM_VERSION } from '@remode/core';
import { AnalysisView } from './components/AnalysisView';
import { ChangeInspector } from './components/ChangeInspector';
import { ImportPanel } from './components/ImportPanel';
import { SourceModeCard } from './components/SourceModeCard';
import { TargetPanel } from './components/TargetPanel';
import { TrackList } from './components/TrackList';
import { ValidationView } from './components/ValidationView';
import { Section } from './components/ui';
import { applyThemePref, readThemePref, saveThemePref, type ThemePref } from './lib/theme';
import { ProjectProvider, useProject } from './state/ProjectContext';

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
  const { input } = useProject();
  const project =
    input?.kind === 'midi'
      ? input.fileName
      : input?.kind === 'jianpu'
        ? (input.fileName ?? '简谱输入')
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

/** A clearly labelled slot that a later milestone fills. */
function Placeholder({
  id,
  title,
  milestone,
  text,
  tall,
}: {
  id: string;
  title: string;
  milestone: string;
  text: string;
  tall?: boolean;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`placeholder-${id}`}
      className={`flex flex-col justify-center gap-1 rounded-xl border-2 border-dashed border-hl-high p-4 ${tall ? 'min-h-40' : ''}`}
    >
      <h2 id={`${id}-title`} className="panel-title">
        {title} <span className="normal-case tracking-normal">· 待实现（{milestone}）</span>
      </h2>
      <p className="text-sm text-muted-text">{text}</p>
    </section>
  );
}

function Workbench() {
  const { original, analysis } = useProject();
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
          <Placeholder
            id="piano-roll"
            title="Piano roll"
            milestone="M2b"
            tall
            text="原曲虚影 + 当前方案、乐句标记与改动高亮；手动修音与撤销。"
          />
          <Placeholder
            id="transport"
            title="Transport"
            milestone="M2c"
            text="Original | Strict 切换、播放 / 暂停 / 定位 / 循环、主音持续低音（drone）。"
          />
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

export function App() {
  return (
    <ProjectProvider>
      <Workbench />
    </ProjectProvider>
  );
}
