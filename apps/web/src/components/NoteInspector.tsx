import { degreeOf, inMode, pitchName, stepPitch, type ModeRef } from '@remode/core';
import { useEngine } from '../audio/AudioProvider';
import { barBeat, beats, signed } from '../lib/format';
import { codeLabel, degreeRoleLabel } from '../lib/labels';
import { activeVariant, sourceMode, targetMode } from '../state/project';
import { useDispatch, useProject } from '../state/ProjectContext';
import { CodeChip, Issue, Section } from './ui';

function Degree({ pitch, mode }: { pitch: number; mode: (ModeRef & { name: string }) | null }) {
  if (!mode) return <span className="text-muted-text">调式未确定</span>;
  const d = degreeOf(pitch, mode);
  return d.label ? (
    <span>
      <strong>{d.label}</strong>
      {d.role && `（${degreeRoleLabel(d.role)}）`}
      <span className="text-muted-text"> · {mode.name}</span>
    </span>
  ) : (
    <span className="text-warn-text">
      <span aria-hidden="true">! </span>调外音
      <span className="text-muted-text"> · {mode.name}</span>
    </span>
  );
}

/** The selected note (spec §10.3): ID, position, original → current, degrees, reason, revert. */
export function NoteInspector() {
  const state = useProject();
  const dispatch = useDispatch();
  const engine = useEngine();
  const { original, selectedNoteId, snap, custom } = state;
  const active = activeVariant(state);
  const index = original?.notes.findIndex((n) => n.id === selectedNoteId) ?? -1;
  const orig = original?.notes[index];
  const cur = active?.notes[index];

  if (!original || !active || !orig || !cur) {
    return (
      <Section id="note-inspector" title="Note inspector" subtitle="音符">
        <p className="text-sm text-muted-text">
          在卷帘中点击音符，或聚焦卷帘后用 ←/→ 选择；也可以在下方音符表中点选。
        </p>
      </Section>
    );
  }

  const src = sourceMode(state);
  const tgt = targetMode(state);
  const change = active.changes.find((c) => c.noteId === cur.id);
  const delta = cur.pitch - orig.pitch;
  const snapMode = snap && tgt ? tgt : null;
  const out = tgt !== null && active.id !== 'original' && !inMode(cur.pitch, tgt);
  const editsHere = custom?.edits.filter((e) => e.noteId === cur.id).length ?? 0;
  const edit = (toPitch: number, createdAt: number) => {
    if (toPitch === cur.pitch) return;
    dispatch({ type: 'EDIT_PITCH', noteId: cur.id, toPitch, createdAt });
    engine.audition(toPitch);
  };

  return (
    <Section id="note-inspector" title="Note inspector" subtitle={`音符 #${index + 1}`}>
      <dl
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"
        data-testid="note-inspector"
      >
        <dt className="text-muted-text">音符 ID</dt>
        <dd>
          <code className="break-all">{cur.id}</code>
        </dd>
        <dt className="text-muted-text">位置</dt>
        <dd>
          {barBeat(cur.startTick, original.metadata)}（小节.拍）· 时值{' '}
          {beats(cur.durationTick, original.metadata.ppq)} 拍 · tick {cur.startTick}
        </dd>
        <dt className="text-muted-text">音高</dt>
        <dd data-testid="inspector-pitch">
          {pitchName(orig.pitch)} → <strong>{pitchName(cur.pitch)}</strong>
          {delta !== 0 && (
            <span className="text-muted-text">
              {' '}
              (<span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span>
              {signed(delta)} 半音)
            </span>
          )}
        </dd>
        <dt className="text-muted-text">来源音级</dt>
        <dd>
          <Degree pitch={orig.pitch} mode={src.ok ? { ...src.mode, name: src.name } : null} />
        </dd>
        <dt className="text-muted-text">目标音级</dt>
        <dd>
          <Degree pitch={cur.pitch} mode={tgt} />
        </dd>
        <dt className="text-muted-text">原因</dt>
        <dd data-testid="inspector-reason">
          {change ? (
            <>
              <CodeChip code={change.reasonCode} /> {codeLabel(change.reasonCode)}
              {change.explanation && (
                <span className="block text-xs text-muted-text">{change.explanation}</span>
              )}
            </>
          ) : (
            <span className="text-muted-text">未改动</span>
          )}
          {editsHere > 0 && (
            <span className="block text-xs text-muted-text">此音手动修改过 {editsHere} 次。</span>
          )}
        </dd>
      </dl>
      {out && (
        <ul>
          <Issue
            level="warning"
            code="OUT_OF_TARGET_SCALE"
            text={`${pitchName(cur.pitch)} 不在 ${tgt.name} 中。`}
          />
        </ul>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="修改此音">
        <button
          type="button"
          className="btn"
          onClick={() => edit(stepPitch(cur.pitch, 1, snapMode), Date.now())}
          data-testid="inspector-up"
        >
          <span aria-hidden="true">▲</span> 升高
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => edit(stepPitch(cur.pitch, -1, snapMode), Date.now())}
          data-testid="inspector-down"
        >
          <span aria-hidden="true">▼</span> 降低
        </button>
        <button
          type="button"
          className="btn"
          disabled={cur.pitch === orig.pitch}
          onClick={() => {
            dispatch({ type: 'REVERT_NOTE', noteId: cur.id, createdAt: Date.now() });
            engine.audition(orig.pitch);
          }}
          data-testid="revert-note"
        >
          恢复此音（{pitchName(orig.pitch)}）
        </button>
      </div>
      <p className="text-xs text-muted-text">
        只改音高：起始位置、时值、力度与 ID 不变。
        {active.id !== 'custom' && '修改会从当前方案派生 Custom。'}
      </p>
    </Section>
  );
}
