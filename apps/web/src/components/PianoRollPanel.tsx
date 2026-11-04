import { useId, useMemo, useState } from 'react';
import { inMode, snapPitch, stepPitch, type MelodyNote } from '@remode/core';
import { useRollAudio } from '../audio/AudioProvider';
import { activeVariant, sourceMode, targetMode, type ViewId } from '../state/project';
import { useDispatch, useProject } from '../state/ProjectContext';
import { RollCanvas } from './RollCanvas';
import { Section } from './ui';

/** Swatches for the legend; every meaning has a shape or pattern, not only a colour. */
function Legend() {
  const item = 'flex items-center gap-1.5';
  const box = 'inline-block h-3 w-5 shrink-0 rounded-sm';
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-text"
      data-testid="roll-legend"
    >
      <li className={item}>
        <span className={`${box} border border-dashed border-muted-text`} aria-hidden="true" />
        虚线框：原曲
      </li>
      <li className={item}>
        <span className={`${box} bg-accent-fill`} aria-hidden="true" />
        实心：当前方案
      </li>
      <li className={item}>
        <span
          className={`${box} border border-text bg-gold`}
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent 0 3px, var(--rp-base) 3px 4px)',
          }}
          aria-hidden="true"
        />
        斜线：生成时改动（竖线连到原音高）
      </li>
      <li className={item}>
        <span
          className={`${box} border border-text bg-gold`}
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent 0 3px, var(--rp-base) 3px 4px), repeating-linear-gradient(45deg, transparent 0 3px, var(--rp-base) 3px 4px)',
          }}
          aria-hidden="true"
        />
        交叉线：手动修改
      </li>
      <li className={item}>
        <span className="font-bold text-danger-text" aria-hidden="true">
          !
        </span>
        不在目标音阶内
      </li>
      <li className={item}>
        <span aria-hidden="true" className="font-mono">
          ■ / □ / 1
        </span>
        左栏：来源 / 目标音阶内的音，1 为主音（主音行有实线 / 虚线）
      </li>
      <li className={item}>
        <span aria-hidden="true" className="font-mono text-iris">
          ┆▼P2
        </span>
        乐句起点
      </li>
    </ul>
  );
}

export function PianoRollPanel() {
  const state = useProject();
  const dispatch = useDispatch();
  const rollAudio = useRollAudio();
  const { original, analysis, generated, custom, view, selectedNoteId, snap, history } = state;
  const [showSource, setShowSource] = useState(true);
  const [showTarget, setShowTarget] = useState(true);
  const ids = { snap: useId(), src: useId(), tgt: useId() };
  const active = useMemo(() => activeVariant(state), [state]);
  const src = sourceMode(state);
  const tgt = targetMode(state);
  const phraseTicks = useMemo(() => {
    if (!original || !analysis) return [];
    const at = new Map(original.notes.map((n) => [n.id, n.startTick]));
    return analysis.phrases.slice(1).flatMap((p) => at.get(p.startNoteId) ?? []);
  }, [original, analysis]);
  const changes = useMemo(
    () => new Map((active?.changes ?? []).map((c) => [c.noteId, c])),
    [active],
  );

  if (!original || !active) {
    return (
      <Section id="piano-roll" title="Piano roll" subtitle="卷帘">
        <p className="text-sm text-muted-text" data-testid="roll-empty">
          导入旋律或“新建旋律”后，这里显示原曲与当前方案的卷帘。
        </p>
      </Section>
    );
  }

  const generatedLabel =
    generated?.ok && generated.operation === 'transpose' ? '移调结果' : 'Strict';
  const tabs: Array<{
    id: ViewId | 'expressive';
    label: string;
    enabled: boolean;
    hint?: string | undefined;
  }> = [
    { id: 'original', label: '原曲', enabled: true },
    {
      id: 'generated',
      label: generatedLabel,
      enabled: !!generated?.ok,
      hint: generated?.ok ? undefined : '先在 TARGET 中生成',
    },
    { id: 'expressive', label: 'Expressive', enabled: false, hint: 'M3' },
    {
      id: 'custom',
      label: 'Custom',
      enabled: !!custom,
      hint: custom ? undefined : '编辑任一音后出现',
    },
  ];
  const snapActive = snap && tgt !== null;
  const editable =
    view === 'custom'
      ? '编辑 Custom'
      : `编辑时从${view === 'original' ? '原曲' : generatedLabel}派生 Custom`;

  return (
    <Section
      id="piano-roll"
      title="Piano roll"
      subtitle="卷帘"
      actions={
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="历史">
          <button
            type="button"
            className="btn"
            disabled={history.past.length === 0}
            onClick={() => dispatch({ type: 'UNDO' })}
            title="Ctrl/⌘+Z"
            data-testid="undo"
          >
            ↶ 撤销
          </button>
          <button
            type="button"
            className="btn"
            disabled={history.future.length === 0}
            onClick={() => dispatch({ type: 'REDO' })}
            title="Shift+Ctrl/⌘+Z"
            data-testid="redo"
          >
            ↷ 重做
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch({ type: 'RESTORE_ORIGINAL', createdAt: Date.now() })}
            disabled={
              custom !== null &&
              custom.forkedFrom === 'original' &&
              custom.variant.changes.length === 0
            }
            title="Custom 恢复为原曲的音高（可撤销）"
            data-testid="restore-original"
          >
            恢复原样
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="显示的方案"
          className="flex flex-wrap gap-1"
          data-testid="variant-tabs"
        >
          {tabs.map((t) => {
            const on = t.id === active.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!t.enabled}
                className={`btn ${on ? 'btn-primary' : ''}`}
                onClick={() => t.id !== 'expressive' && dispatch({ type: 'SET_VIEW', view: t.id })}
                data-testid={`view-${t.id}`}
              >
                {on && <span aria-hidden="true">●</span>}
                {t.label}
                {t.hint && <span className="text-xs font-normal">（{t.hint}）</span>}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-muted-text" data-testid="edit-target">
          {editable}
          {custom &&
            view === 'custom' &&
            `（基于${custom.forkedFrom === 'original' ? '原曲' : generatedLabel}，${custom.edits.length} 次手动修改）`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <input
            id={ids.snap}
            type="checkbox"
            checked={snap}
            disabled={!tgt}
            onChange={(e) => dispatch({ type: 'SET_SNAP', snap: e.target.checked })}
            data-testid="snap-toggle"
          />
          <label htmlFor={ids.snap}>
            吸附到目标音阶{tgt ? `（${tgt.name}）` : '（目标调式未确定，按半音）'}
          </label>
        </span>
        <span className="flex items-center gap-2">
          <input
            id={ids.src}
            type="checkbox"
            checked={showSource}
            onChange={(e) => setShowSource(e.target.checked)}
            disabled={!src.ok}
          />
          <label htmlFor={ids.src}>来源音阶{src.ok ? `（${src.name}）` : ''}</label>
        </span>
        <span className="flex items-center gap-2">
          <input
            id={ids.tgt}
            type="checkbox"
            checked={showTarget}
            onChange={(e) => setShowTarget(e.target.checked)}
            disabled={!tgt}
          />
          <label htmlFor={ids.tgt}>目标音阶</label>
        </span>
      </div>
      {!snapActive && view !== 'original' && tgt && (
        <p className="text-xs text-warn-text" data-testid="snap-off-warning">
          <span aria-hidden="true">! </span>吸附已关闭：手动修改可能离开目标音阶，这些音标有“!”。
        </p>
      )}

      <RollCanvas
        label={`钢琴卷帘：${active.id === 'original' ? '原曲' : active.id === 'custom' ? 'Custom' : generatedLabel}，${original.notes.length} 个音`}
        mode="edit"
        notes={active.notes}
        ghosts={active.id === 'original' ? null : original.notes}
        changes={changes}
        meta={original.metadata}
        scales={{
          source: src.ok ? src.mode : null,
          target: tgt,
          showSource: showSource && src.ok,
          showTarget: showTarget && !!tgt,
        }}
        phraseTicks={phraseTicks}
        selectedId={selectedNoteId}
        onSelect={(id) => dispatch({ type: 'SELECT_NOTE', noteId: id })}
        stepPitch={(n: MelodyNote, dir, octave) =>
          octave
            ? Math.max(0, Math.min(127, n.pitch + 12 * dir))
            : stepPitch(n.pitch, dir, snapActive ? tgt : null)
        }
        dragPitch={(raw) => (snapActive ? snapPitch(raw, tgt) : raw)}
        onPitch={(noteId, toPitch) =>
          dispatch({ type: 'EDIT_PITCH', noteId, toPitch, createdAt: Date.now() })
        }
        {...(tgt && active.id !== 'original'
          ? { outOfTarget: (p: number) => !inMode(p, tgt) }
          : {})}
        fitKey={original}
        {...rollAudio}
      />
      <Legend />
    </Section>
  );
}
