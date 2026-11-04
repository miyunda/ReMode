import { useEffect, useId, useMemo, useRef } from 'react';
import { pitchClassName, pitchName, type MidiMetadata } from '@remode/core';
import { useEngine, useTransport } from '../audio/AudioProvider';
import { modeHasFifth, type DroneMode } from '../audio/drone';
import { buildTimeline } from '../audio/timeline';
import { TIMBRES, type TimbreId } from '../audio/timbres';
import { draftMelody } from '../lib/draft';
import { barBeat } from '../lib/format';
import { isTyping, spaceIsTransport } from '../lib/keyboard';
import { variantMode, type ProjectState } from '../state/project';
import { useProject } from '../state/ProjectContext';
import { Section } from './ui';

const STATUS_TEXT = { playing: '播放中', paused: '已暂停', stopped: '已停止' } as const;

/** "m:ss.d" */
const clock = (seconds: number) => {
  const tenths = Math.floor(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** "小节.拍", whole beats only: the fractional part would flicker during playback. */
const wholeBeat = (tick: number, meta: Pick<MidiMetadata, 'ppq' | 'timeSignatures'>) =>
  barBeat(tick, meta).split('.').slice(0, 2).join('.');

function variantLabel(state: ProjectState): string {
  if (state.draft) return '新建旋律草稿';
  if (!state.original) return '无';
  if (state.view === 'custom' && state.custom) return 'Custom';
  if (state.view === 'generated' && state.generated?.ok)
    return state.generated.operation === 'transpose' ? '移调结果' : 'Strict';
  return '原曲';
}

function useTransportShortcuts() {
  const engine = useEngine();
  useEffect(() => {
    let focusedByPointer = false;
    const onPointer = () => (focusedByPointer = true);
    const onTab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') focusedByPointer = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        if (!spaceIsTransport(e.target, focusedByPointer)) return;
        e.preventDefault(); // no page scroll, no click on a mouse-focused button
        if (!e.repeat) engine.toggle();
        return;
      }
      if (isTyping(e.target) || e.repeat) return;
      if (e.key === 'l' || e.key === 'L') engine.toggleLoop();
      else if (e.key === '[') engine.setLoopEdge('start');
      else if (e.key === ']') engine.setLoopEdge('end');
      else return;
      e.preventDefault();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onTab, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onTab, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [engine]);
}

function Slider({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-2">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        className="w-24"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        aria-valuetext={`${Math.round(value * 100)}%`}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        data-testid={testId}
      />
    </span>
  );
}

/** Spec §10.4: one position for every variant, loop, volume, drone, audition. */
export function TransportPanel() {
  const state = useProject();
  const engine = useEngine();
  const t = useTransport();
  useTransportShortcuts();
  const ids = {
    position: useId(),
    audition: useId(),
    drone: useId(),
    droneMode: useId(),
    timbre: useId(),
  };
  const positionRef = useRef<HTMLParagraphElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);
  const { draft, original } = state;
  const meta = useMemo(
    () => (draft ? draftMelody(draft).metadata : (original?.metadata ?? null)),
    [draft, original],
  );
  const timeline = useMemo(() => (meta ? buildTimeline(meta.ppq, meta.tempoMap) : null), [meta]);
  const playing = t.status === 'playing';
  const canPlay = t.endTick > 0 && t.error !== 'unsupported';
  const mode = variantMode(state);
  const { prefs } = t;

  // The moving readouts are written directly: playback must not re-render React.
  useEffect(() => {
    let raf = 0;
    let shown = '';
    const paint = () => {
      const tick = engine.position();
      const beat = meta ? wholeBeat(tick, meta) : '—';
      const text = timeline
        ? `${beat} · ${clock(timeline.toSeconds(tick))} / ${clock(timeline.toSeconds(t.endTick))}`
        : '—';
      const pos = positionRef.current;
      if (pos) {
        pos.dataset['tick'] = String(Math.round(tick));
        if (text !== shown) pos.textContent = text;
      }
      const slider = sliderRef.current;
      if (slider && !scrubbing.current) {
        slider.value = String(tick);
        if (text !== shown) slider.setAttribute('aria-valuetext', `第 ${beat} 拍`);
      }
      shown = text;
      if (playing) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [engine, playing, t.tick, t.endTick, meta, timeline]);

  const loopText =
    t.loop && meta
      ? `${wholeBeat(t.loop.startTick, meta)} – ${wholeBeat(t.loop.endTick, meta)}`
      : '未设置（在卷帘标尺上拖动，或用 [ 和 ] 在播放位置设置）';

  return (
    <Section id="transport" title="Transport" subtitle="试听">
      <div
        className="flex min-w-0 flex-col gap-3"
        data-testid="transport"
        data-status={t.status}
        data-loop={t.loopOn ? 'on' : 'off'}
        data-drone={t.drone.join(',')}
      >
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="播放控制">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canPlay}
            onClick={() => engine.toggle()}
            aria-keyshortcuts="Space"
            title="空格"
            data-testid="play"
          >
            <span aria-hidden="true">{playing ? '⏸' : '▶'}</span>
            {playing ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canPlay || (t.status === 'stopped' && t.tick === 0)}
            onClick={() => engine.stop()}
            data-testid="stop"
          >
            <span aria-hidden="true">⏹</span> 停止
          </button>
          <button
            type="button"
            className={`btn ${t.loopOn ? 'btn-primary' : ''}`}
            disabled={!canPlay}
            aria-pressed={t.loopOn}
            aria-keyshortcuts="L"
            title="L"
            onClick={() => engine.toggleLoop()}
            data-testid="loop-toggle"
          >
            <span aria-hidden="true">⟲</span> 循环：{t.loopOn ? '开' : '关'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canPlay}
            aria-keyshortcuts="["
            title="["
            onClick={() => engine.setLoopEdge('start')}
            data-testid="loop-start"
          >
            设循环起点
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canPlay}
            aria-keyshortcuts="]"
            title="]"
            onClick={() => engine.setLoopEdge('end')}
            data-testid="loop-end"
          >
            设循环终点
          </button>
          <button
            type="button"
            className="btn"
            disabled={!t.loop}
            onClick={() => engine.clearLoop()}
            data-testid="loop-clear"
          >
            清除循环
          </button>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <p aria-live="polite" data-testid="transport-status">
            <span className="font-medium">{STATUS_TEXT[t.status]}</span>
            <span className="text-muted-text"> · 方案：{variantLabel(state)}</span>
          </p>
          <p
            ref={positionRef}
            className="font-mono tabular-nums"
            data-testid="transport-position"
          />
          <p className="text-xs text-muted-text" data-testid="loop-range">
            循环区间：{loopText}
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-sm">
          <label htmlFor={ids.position} className="shrink-0">
            播放位置
          </label>
          <input
            ref={sliderRef}
            id={ids.position}
            type="range"
            className="min-w-0 flex-1"
            min={0}
            max={Math.max(1, t.endTick)}
            step={(meta?.ppq ?? 480) / 4}
            disabled={!canPlay}
            defaultValue={0}
            onPointerDown={() => (scrubbing.current = true)}
            onPointerUp={() => (scrubbing.current = false)}
            onPointerCancel={() => (scrubbing.current = false)}
            onChange={(e) => engine.seek(Number(e.target.value))}
            data-testid="position-slider"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Slider
            label="音量"
            value={prefs.masterVolume}
            onChange={(masterVolume) => engine.setPrefs({ masterVolume })}
            testId="master-volume"
          />
          <span className="flex items-center gap-2">
            <label htmlFor={ids.timbre}>音色</label>
            <select
              id={ids.timbre}
              className="field"
              value={prefs.timbre}
              onChange={(e) => engine.setPrefs({ timbre: e.target.value as TimbreId })}
              data-testid="timbre"
            >
              {TIMBRES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-2">
            <input
              id={ids.audition}
              type="checkbox"
              checked={prefs.audition}
              onChange={(e) => engine.setPrefs({ audition: e.target.checked })}
              data-testid="audition-toggle"
            />
            <label htmlFor={ids.audition}>试听音符</label>
          </span>
          <span
            className="text-xs text-muted-text"
            data-testid="audition-last"
            data-seq={t.audition?.seq ?? 0}
            data-pitch={t.audition?.pitch ?? ''}
          >
            {!prefs.audition
              ? '已关闭'
              : playing
                ? '播放时自动静音'
                : t.audition
                  ? `最近试听：${pitchName(t.audition.pitch)}`
                  : '点击音符或左侧琴键'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <input
              id={ids.drone}
              type="checkbox"
              checked={prefs.droneOn}
              onChange={(e) => engine.setPrefs({ droneOn: e.target.checked })}
              data-testid="drone-toggle"
            />
            <label htmlFor={ids.drone}>主音持续低音（drone）</label>
          </span>
          <span className="flex items-center gap-2">
            <label htmlFor={ids.droneMode}>模式</label>
            <select
              id={ids.droneMode}
              className="field"
              value={prefs.droneMode}
              disabled={!prefs.droneOn}
              onChange={(e) => engine.setPrefs({ droneMode: e.target.value as DroneMode })}
              data-testid="drone-mode"
            >
              <option value="tonic">仅主音</option>
              <option value="tonic-fifth">主音 + 五度</option>
            </select>
          </span>
          <Slider
            label="drone 音量"
            value={prefs.droneVolume}
            onChange={(droneVolume) => engine.setPrefs({ droneVolume })}
            testId="drone-volume"
          />
          <span className="text-xs text-muted-text" data-testid="drone-tonic">
            {mode ? `主音：${pitchClassName(mode.root)}` : '主音未确定：先在 SOURCE 中指定来源调式'}
            {t.drone.length > 0 && ' · 正在发声'}
          </span>
        </div>
        {prefs.droneOn && prefs.droneMode === 'tonic-fifth' && mode && !modeHasFifth(mode) && (
          <p className="text-xs text-warn-text" data-testid="drone-fifth-warning">
            <span aria-hidden="true">! </span>此调式没有纯五度（{pitchClassName(mode.root + 7)}{' '}
            不在调内），五度 drone 会与调式冲突。
          </p>
        )}
        {t.error === 'unsupported' && (
          <p className="text-sm text-warn-text" data-testid="audio-error">
            <span aria-hidden="true">! </span>
            此浏览器不支持 Web Audio，无法试听；导入、改写和导出不受影响。
          </p>
        )}
        {t.error === 'failed' && (
          <p className="text-sm text-warn-text" role="alert" data-testid="audio-error">
            <span aria-hidden="true">! </span>音频未能启动。请再点一次播放重试。
          </p>
        )}
      </div>
    </Section>
  );
}
