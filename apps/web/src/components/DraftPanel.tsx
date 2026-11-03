import { useId, useMemo, useState } from 'react';
import { pitchName, writeJianpu } from '@remode/core';
import { DRAFT_LIMITS, QUANTA, TIME_SIGNATURES, draftMelody } from '../lib/draft';
import { downloadText } from '../lib/exportVariant';
import { barBeat, beats } from '../lib/format';
import { PITCH_CLASSES } from '../lib/modes';
import { useDispatch, useProject } from '../state/ProjectContext';
import { RollCanvas } from './RollCanvas';
import { Issue, Section } from './ui';

const NO_CHANGES = new Map();

/** New-melody mode (spec §10.3): notes on an empty roll; "完成并分析" makes them the Original. */
export function DraftPanel() {
  const { draft, selectedNoteId, history } = useProject();
  const dispatch = useDispatch();
  const ids = { key: useId(), sig: useId(), bpm: useId(), q: useId() };
  const [jianpu, setJianpu] = useState<ReturnType<typeof writeJianpu> | null>(null);
  const [bpmText, setBpmText] = useState(String(draft?.settings.bpm ?? 96));
  const meta = useMemo(
    () =>
      draft
        ? {
            ppq: 480,
            timeSignatures: [
              {
                tick: 0,
                numerator: draft.settings.numerator,
                denominator: draft.settings.denominator,
              },
            ],
          }
        : null,
    [draft],
  );
  // Refit only when a new draft starts, not on every added note.
  const [fitKey] = useState(() => Symbol('draft'));
  if (!draft || !meta) return null;
  const s = draft.settings;
  const set = (patch: Partial<typeof s>) => dispatch({ type: 'DRAFT_SETTINGS', patch });
  const sel = draft.notes.find((n) => n.id === selectedNoteId);
  const keyMode = { root: s.keyPc, scaleId: 'ionian' };
  const exportJianpu = () => {
    const m = draftMelody(draft);
    const r = writeJianpu(m.notes, m.metadata, { keyPitchClass: s.keyPc });
    setJianpu(r);
    if (r.ok) downloadText(r.text, 'melody.jianpu');
  };

  return (
    <Section
      id="draft"
      title="New melody"
      subtitle="新建旋律"
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={history.past.length === 0}
            onClick={() => dispatch({ type: 'UNDO' })}
            title="Ctrl/⌘+Z"
          >
            ↶ 撤销
          </button>
          <button
            type="button"
            className="btn"
            disabled={history.future.length === 0}
            onClick={() => dispatch({ type: 'REDO' })}
            title="Shift+Ctrl/⌘+Z"
          >
            ↷ 重做
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => dispatch({ type: 'DRAFT_CANCEL' })}
            data-testid="draft-cancel"
          >
            放弃
          </button>
          <button
            type="button"
            className="btn"
            onClick={exportJianpu}
            disabled={draft.notes.length === 0}
            data-testid="draft-jianpu"
          >
            导出简谱文本
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => dispatch({ type: 'DRAFT_FINISH' })}
            disabled={draft.notes.length === 0}
            data-testid="draft-finish"
          >
            完成并分析
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label htmlFor={ids.key} className="flex flex-col gap-1 font-medium">
          调（1=）
          <select
            id={ids.key}
            className="field"
            value={s.keyPc}
            onChange={(e) => set({ keyPc: Number(e.target.value) })}
          >
            {PITCH_CLASSES.map((p) => (
              <option key={p.pc} value={p.pc}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.sig} className="flex flex-col gap-1 font-medium">
          拍号
          <select
            id={ids.sig}
            className="field"
            value={`${s.numerator}/${s.denominator}`}
            onChange={(e) => {
              const [n, d] = e.target.value.split('/').map(Number);
              set({ numerator: n as number, denominator: d as number });
            }}
          >
            {TIME_SIGNATURES.map(([n, d]) => (
              <option key={`${n}/${d}`} value={`${n}/${d}`}>
                {n}/{d}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.bpm} className="flex flex-col gap-1 font-medium">
          速度（BPM）
          <input
            id={ids.bpm}
            className="field w-20"
            inputMode="numeric"
            value={bpmText}
            onChange={(e) => setBpmText(e.target.value)}
            onBlur={() => {
              const n = Math.round(Number(bpmText));
              const bpm = Number.isFinite(n) && n >= 20 && n <= 300 ? n : s.bpm;
              setBpmText(String(bpm));
              if (bpm !== s.bpm) set({ bpm });
            }}
          />
        </label>
        <label htmlFor={ids.q} className="flex flex-col gap-1 font-medium">
          网格
          <select
            id={ids.q}
            className="field"
            value={s.quantum}
            onChange={(e) => set({ quantum: Number(e.target.value) })}
            data-testid="draft-quantum"
          >
            {QUANTA.map((q) => (
              <option key={q.ticks} value={q.ticks}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-text" data-testid="draft-count">
          {draft.notes.length} 个音（上限 {DRAFT_LIMITS.maxNotes}）
        </p>
      </div>

      <RollCanvas
        label={`新建旋律卷帘，${draft.notes.length} 个音`}
        mode="compose"
        notes={draft.notes}
        ghosts={null}
        changes={NO_CHANGES}
        meta={meta}
        scales={{ source: keyMode, target: null, showSource: true, showTarget: false }}
        phraseTicks={[]}
        selectedId={selectedNoteId}
        onSelect={(id) => dispatch({ type: 'SELECT_NOTE', noteId: id })}
        quantum={s.quantum}
        minTicks={8 * ((480 * 4 * s.numerator) / s.denominator)}
        onAdd={(pitch, startTick) => dispatch({ type: 'DRAFT_ADD', pitch, startTick })}
        onUpdate={(noteId, patch) => dispatch({ type: 'DRAFT_UPDATE', noteId, patch })}
        onDelete={(noteId) => dispatch({ type: 'DRAFT_DELETE', noteId })}
        fitKey={fitKey}
      />
      <p className="text-xs text-muted-text">
        左栏 ■ 标出 {PITCH_CLASSES[s.keyPc]?.name} 大调（1=
        {PITCH_CLASSES[s.keyPc]?.name}）的音，仅作参考；完成后由分析器识别调式。音不能重叠。
      </p>

      {sel && (
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          role="group"
          aria-label="所选音符"
          data-testid="draft-selection"
        >
          <span>
            所选：<strong>{pitchName(sel.pitch)}</strong> · {barBeat(sel.startTick, meta)} · 时值{' '}
            {beats(sel.durationTick, 480)} 拍
          </span>
          {(
            [
              ['▲', '升半音', { pitch: sel.pitch + 1 }],
              ['▼', '降半音', { pitch: sel.pitch - 1 }],
              ['◀', '前移', { startTick: Math.max(0, sel.startTick - s.quantum) }],
              ['▶', '后移', { startTick: sel.startTick + s.quantum }],
              ['−', '缩短', { durationTick: Math.max(s.quantum, sel.durationTick - s.quantum) }],
              ['+', '加长', { durationTick: sel.durationTick + s.quantum }],
            ] as const
          ).map(([sym, label, patch]) => (
            <button
              key={label}
              type="button"
              className="btn px-2 py-0.5"
              onClick={() => dispatch({ type: 'DRAFT_UPDATE', noteId: sel.id, patch })}
            >
              <span aria-hidden="true">{sym}</span> {label}
            </button>
          ))}
          <button
            type="button"
            className="btn px-2 py-0.5"
            onClick={() => dispatch({ type: 'DRAFT_DELETE', noteId: sel.id })}
            data-testid="draft-delete"
          >
            删除
          </button>
        </div>
      )}

      {jianpu && (
        <div
          className="flex flex-col gap-2 text-sm"
          aria-live="polite"
          data-testid="draft-jianpu-result"
        >
          {jianpu.ok ? (
            <pre className="max-w-full overflow-x-auto rounded-lg border border-hl-med bg-base p-2 font-mono text-xs">
              {jianpu.text}
            </pre>
          ) : (
            <ul className="flex flex-col gap-2" role="alert">
              {jianpu.errors.map((e, i) => (
                <Issue key={i} level="error" code={e.code} detail={e.message} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}
