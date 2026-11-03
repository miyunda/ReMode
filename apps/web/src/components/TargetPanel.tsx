import { useId, useState } from 'react';
import { pitchClassName, type AccidentalPolicy } from '@remode/core';
import { PITCH_CLASSES } from '../lib/modes';
import { ambiguityReasonText } from '../lib/labels';
import { sourceMode } from '../state/project';
import { useDispatch, useProject } from '../state/ProjectContext';
import { ModePicker } from './ModePicker';

export const MAX_SEMITONES = 48;

/**
 * Semitone text → integer clamped to ±48, or null when it is not an integer.
 * The field keeps its raw text so intermediate input such as "-" or "" survives.
 */
export function parseSemitones(text: string): number | null {
  const t = text.trim().replace(/^[−–]/, '-');
  if (!/^[+-]?\d+$/.test(t)) return null;
  return Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, Number.parseInt(t, 10)));
}

const ACCIDENTALS: Array<{ id: AccidentalPolicy; label: string; hint: string }> = [
  { id: 'nearest', label: '就近映射（默认）', hint: '来源调式外的音移到相邻的目标音阶音。' },
  { id: 'preserve', label: '保留原音', hint: '来源调式外的音不变；目标因此不再是严格音阶。' },
  { id: 'reject', label: '拒绝', hint: '旋律含来源调式外的音时不生成。' },
];

export function TargetPanel() {
  const state = useProject();
  const dispatch = useDispatch();
  const { target, original } = state;
  const ids = { op: useId(), root: useId(), acc: useId(), semi: useId(), range: useId() };
  const src = sourceMode(state);
  const set = (patch: Partial<typeof target>) => dispatch({ type: 'SET_TARGET', patch });
  const tonic = src.ok ? src.mode.root : 0;
  const remode = target.operation === 'parallel-remode';
  const blockedReason = !original
    ? '先导入并通过预检的旋律。'
    : remode && !src.ok
      ? `来源调式未确定（${src.reasons.map(ambiguityReasonText).join('、')}）：请在 SOURCE 中手动指定。`
      : null;
  const accHint = ACCIDENTALS.find((a) => a.id === target.accidentals)?.hint;

  // Raw text of the semitone field; parsed and clamped on blur and on generate.
  const [semiText, setSemiText] = useState(String(target.semitones));
  const [semiError, setSemiError] = useState<string | null>(null);
  const [seenSemitones, setSeenSemitones] = useState(target.semitones);
  if (seenSemitones !== target.semitones) {
    setSeenSemitones(target.semitones);
    if (parseSemitones(semiText) !== target.semitones) setSemiText(String(target.semitones));
  }
  /** Commit the field: the parsed value, or null (with a message) when the text is invalid. */
  const commitSemitones = (): number | null => {
    const n = parseSemitones(semiText);
    if (n === null) {
      setSemiError(`请输入 −${MAX_SEMITONES} 到 ${MAX_SEMITONES} 之间的整数（负数向下）。`);
      return null;
    }
    setSemiError(null);
    setSemiText(String(n));
    if (n !== target.semitones) set({ semitones: n });
    return n;
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="target-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!remode && commitSemitones() === null) return;
        dispatch({ type: 'GENERATE', createdAt: Date.now() });
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">操作</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={ids.op}
            checked={remode}
            onChange={() => set({ operation: 'parallel-remode' })}
          />
          同主音换调式（默认）
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={ids.op}
            checked={!remode}
            onChange={() => set({ operation: 'transpose' })}
          />
          移调
        </label>
      </fieldset>

      {remode ? (
        <>
          <label htmlFor={ids.root} className="flex flex-col gap-1 text-sm font-medium">
            目标主音
            <select
              id={ids.root}
              className="field"
              value={target.root === null ? 'same' : String(target.root)}
              onChange={(e) =>
                set({ root: e.target.value === 'same' ? null : Number(e.target.value) })
              }
            >
              <option value="same">同主音{src.ok ? `（${pitchClassName(tonic)}）` : ''}</option>
              {PITCH_CLASSES.map((p) => (
                <option key={p.pc} value={p.pc}>
                  {p.name}（先移调，再换调式）
                </option>
              ))}
            </select>
          </label>
          <ModePicker
            label="目标调式"
            lockRoot
            value={{ root: target.root ?? tonic, scaleId: target.scaleId }}
            onChange={(m) => set({ scaleId: m.scaleId })}
            testId="target-picker"
          />
          <label htmlFor={ids.acc} className="flex flex-col gap-1 text-sm font-medium">
            调外音策略
            <select
              id={ids.acc}
              className="field"
              value={target.accidentals}
              aria-describedby={`${ids.acc}-hint`}
              onChange={(e) => set({ accidentals: e.target.value as AccidentalPolicy })}
            >
              {ACCIDENTALS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <span id={`${ids.acc}-hint`} className="text-xs font-normal text-muted-text">
              {accHint}
            </span>
          </label>
        </>
      ) : (
        <label htmlFor={ids.semi} className="flex flex-col gap-1 text-sm font-medium">
          半音数（正数向上，负数向下）
          <input
            id={ids.semi}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="field w-32"
            value={semiText}
            aria-invalid={semiError !== null}
            aria-describedby={`${ids.semi}-msg`}
            onChange={(e) => {
              setSemiText(e.target.value);
              setSemiError(null);
            }}
            onBlur={commitSemitones}
          />
          <span
            id={`${ids.semi}-msg`}
            className={`text-xs font-normal ${semiError ? 'text-danger-text' : 'text-muted-text'}`}
            role={semiError ? 'alert' : undefined}
          >
            {semiError ?? `范围 −${MAX_SEMITONES}…${MAX_SEMITONES}，超出时取边界值。`}
          </span>
        </label>
      )}

      <div className="flex items-start gap-2 text-sm">
        <input
          id={ids.range}
          type="checkbox"
          className="mt-1"
          checked={target.softRange}
          onChange={(e) => set({ softRange: e.target.checked })}
        />
        <label htmlFor={ids.range}>软音域 A0–C8：超出时整体移动八度（不做局部折叠）</label>
      </div>

      <div className="flex flex-col gap-1">
        <button type="submit" className="btn btn-primary self-start" disabled={!!blockedReason}>
          生成 Strict
        </button>
        {blockedReason && <p className="text-xs text-muted-text">{blockedReason}</p>}
      </div>
    </form>
  );
}
