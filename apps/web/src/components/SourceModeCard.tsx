import { useState } from 'react';
import type { ModeRef } from '@remode/core';
import { ambiguityReasonText } from '../lib/labels';
import { sameMode } from '../lib/modes';
import { sourceMode } from '../state/project';
import { useDispatch, useProject } from '../state/ProjectContext';
import { ModePicker } from './ModePicker';
import { CodeChip } from './ui';

/** Detected vs. manually chosen source mode (spec §1.2 step 4, §1.3). */
export function SourceModeCard() {
  const state = useProject();
  const dispatch = useDispatch();
  const { analysis, sourceOverride } = state;
  const top = analysis?.candidates[0];
  const [draft, setDraft] = useState<ModeRef | null>(null);
  // A new analysis (new input, track or repair) discards an unapplied choice.
  const [seen, setSeen] = useState(analysis);
  if (seen !== analysis) {
    setSeen(analysis);
    setDraft(null);
  }
  if (!analysis) return null;

  const current = sourceMode(state);
  const detected = sourceMode({ analysis, sourceOverride: null });
  const rank1 = analysis.candidates.filter((c) => c.rank === 1);
  const pickerValue: ModeRef =
    draft ??
    sourceOverride ??
    (top ? { root: top.rootPitchClass, scaleId: top.scaleId } : { root: 0, scaleId: 'ionian' });

  return (
    <div className="flex flex-col gap-3" data-testid="source-mode">
      <div className="flex flex-col gap-1 text-sm">
        <p>
          <span className="text-muted-text">自动识别（第 1 名）：</span>
          {rank1.length ? rank1.map((c) => c.name).join(' / ') : '无候选'}
        </p>
        {analysis.ambiguities.length > 0 && (
          <p className="flex flex-wrap items-center gap-1">
            <span className="text-muted-text">歧义：</span>
            {analysis.ambiguities.map((a, i) => (
              <CodeChip key={i} code={a.code} />
            ))}
          </p>
        )}
      </div>

      <div
        className={`rounded-lg border p-2 text-sm ${current.ok ? 'border-hl-high' : 'border-gold'}`}
        data-testid="effective-source-mode"
        aria-live="polite"
      >
        {current.ok ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted-text">来源调式：</span>
            <strong>{current.name}</strong>
            {current.via === 'manual' ? (
              <span className="rounded border border-iris px-1.5 py-0.5 text-xs font-semibold text-text">
                ✎ 手动指定（已覆盖自动识别）
              </span>
            ) : (
              <span className="rounded border border-hl-high px-1.5 py-0.5 text-xs text-muted-text">
                自动识别
              </span>
            )}
          </p>
        ) : (
          <p className="text-warn-text">
            ! 来源调式未确定：{current.reasons.map(ambiguityReasonText).join('、')}。请手动指定。
          </p>
        )}
      </div>

      <details className="flex flex-col gap-2" open={!detected.ok || sourceOverride !== null}>
        <summary className="cursor-pointer text-sm font-medium">手动指定来源调式</summary>
        <div className="mt-2 flex flex-col gap-2">
          <ModePicker
            label="来源调式"
            value={pickerValue}
            onChange={setDraft}
            testId="source-picker"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={sameMode(pickerValue, sourceOverride)}
              onClick={() => {
                dispatch({ type: 'SET_SOURCE_OVERRIDE', mode: pickerValue });
                setDraft(null);
              }}
            >
              使用此来源调式
            </button>
            {sourceOverride && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  dispatch({ type: 'SET_SOURCE_OVERRIDE', mode: null });
                  setDraft(null);
                }}
              >
                恢复自动识别
              </button>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
