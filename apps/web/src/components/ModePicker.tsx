import { useId } from 'react';
import {
  ZHENGYIN,
  chineseScaleId,
  getScale,
  mod,
  pitchClassName,
  type ChineseScaleType,
  type ChineseTonicDegree,
  type ModeRef,
} from '@remode/core';
import {
  CHINESE_DEGREE_OPTIONS,
  CHINESE_TYPE_OPTIONS,
  CHURCH_OPTIONS,
  PITCH_CLASSES,
  fromPicker,
  refName,
  toPicker,
  type PickerValue,
} from '../lib/modes';

/**
 * Mode selector. Church modes: root + mode. Chinese modes use 宫系统 + 主音
 * (spec §6.2): 宫 pitch class, tonic degree (宫商角徵羽) and scale type.
 * With `lockRoot` the tonic is fixed and only the mode (or, for Chinese
 * modes, the degree and type, which then fix 宫) is chosen.
 */
export function ModePicker({
  value,
  onChange,
  label,
  lockRoot = false,
  testId,
}: {
  value: ModeRef;
  onChange: (next: ModeRef) => void;
  label: string;
  lockRoot?: boolean;
  testId?: string;
}) {
  const id = useId();
  const v = toPicker(value);
  const set = (next: PickerValue) => {
    if (!lockRoot) return onChange(fromPicker(next));
    // Keep the tonic; a Chinese degree change moves 宫 instead.
    if (next.system === 'church') return onChange({ root: value.root, scaleId: next.scaleId });
    return onChange({ root: value.root, scaleId: chineseScaleId(next.type, next.degree) });
  };
  const toSystem = (system: PickerValue['system']) => {
    if (system === v.system) return;
    if (system === 'church') set({ system, root: mod(value.root, 12), scaleId: 'ionian' });
    else set({ system, gong: mod(value.root, 12), degree: 'gong', type: 'pentatonic' });
  };
  const gongOf = (degree: ChineseTonicDegree) => mod(value.root - ZHENGYIN[degree], 12);

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-text">
          体系
          <select
            aria-label="体系"
            className="field"
            value={v.system}
            onChange={(e) => toSystem(e.target.value as PickerValue['system'])}
            aria-describedby={`${id}-name`}
          >
            <option value="church">教会调式</option>
            <option value="chinese">中国调式</option>
          </select>
        </label>
        {v.system === 'church' ? (
          <>
            {!lockRoot && (
              <label className="flex flex-col gap-1 text-xs text-muted-text">
                主音
                <select
                  aria-label="主音"
                  className="field"
                  value={v.root}
                  onChange={(e) => set({ ...v, root: Number(e.target.value) })}
                >
                  {PITCH_CLASSES.map((p) => (
                    <option key={p.pc} value={p.pc}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-text">
              调式
              <select
                aria-label="调式"
                className="field"
                value={v.scaleId}
                onChange={(e) => set({ ...v, scaleId: e.target.value })}
              >
                {CHURCH_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            {!lockRoot && (
              <label className="flex flex-col gap-1 text-xs text-muted-text">
                宫音（宫系统）
                <select
                  aria-label="宫音（宫系统）"
                  className="field"
                  value={v.gong}
                  onChange={(e) => set({ ...v, gong: Number(e.target.value) })}
                >
                  {PITCH_CLASSES.map((p) => (
                    <option key={p.pc} value={p.pc}>
                      {p.name} 宫
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-text">
              主音（调式）
              <select
                aria-label="主音（调式）"
                className="field"
                value={v.degree}
                onChange={(e) => set({ ...v, degree: e.target.value as ChineseTonicDegree })}
              >
                {CHINESE_DEGREE_OPTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                    {lockRoot ? `（${pitchClassName(gongOf(d.id))} 宫）` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-text">
              音阶
              <select
                aria-label="音阶"
                className="field"
                value={v.type}
                onChange={(e) => set({ ...v, type: e.target.value as ChineseScaleType })}
              >
                {CHINESE_TYPE_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <p id={`${id}-name`} className="text-sm" data-testid={testId && `${testId}-name`}>
        {refName(value)}
        <span className="ml-2 font-mono text-xs text-muted-text">{getScale(value.scaleId).id}</span>
      </p>
    </fieldset>
  );
}
