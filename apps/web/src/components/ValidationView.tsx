import { useId } from 'react';
import { pitchName } from '@remode/core';
import { validationText } from '../lib/labels';
import { useDispatch, useProject } from '../state/ProjectContext';
import { Issue, TableScroll } from './ui';

/** Import warnings, the validation report and the opt-in legato repair. */
export function ValidationView() {
  const { input, validation, limitError, repairPreview, repair, original, trackId } = useProject();
  const dispatch = useDispatch();
  const repairId = useId();
  if (!input || trackId === null) return null;
  if (limitError) {
    return (
      <ul role="alert" className="flex flex-col gap-2" data-testid="validation">
        <Issue level="error" code={limitError.code} text={limitError.message} />
      </ul>
    );
  }

  const importWarnings =
    input.kind === 'midi'
      ? input.midi.warnings.map((w) => ({ code: w.code, message: w.message, location: undefined }))
      : input.melody.warnings.map((w) => ({
          code: w.code,
          message: w.message,
          location: `第 ${w.line} 行，第 ${w.column} 列`,
        }));
  const repairs = repairPreview?.repairs ?? [];
  const notesById = new Map(
    (input.kind === 'midi'
      ? (input.midi.tracks.find((t) => t.id === trackId)?.notes ?? [])
      : input.melody.notes
    ).map((n) => [n.id, n]),
  );
  const blocked = validation && !original;

  return (
    <div className="flex flex-col gap-2" data-testid="validation">
      <h3 className="text-sm font-medium">
        预检{' '}
        {validation && (
          <span className={validation.ok ? 'text-accent-text' : 'text-danger-text'}>
            {validation.ok ? '✓ 可用的单声部旋律' : '✕ 未通过'}
          </span>
        )}
        {validation && (
          <span className="ml-2 text-xs text-muted-text">{validation.noteCount} 个音符</span>
        )}
      </h3>
      {(importWarnings.length > 0 || (validation?.issues.length ?? 0) > 0) && (
        <ul className="flex flex-col gap-2">
          {importWarnings.map((w, i) => (
            <Issue
              key={`i${i}`}
              level="warning"
              code={w.code}
              detail={w.message}
              {...(w.location ? { location: w.location } : {})}
            />
          ))}
          {validation?.issues.map((x, i) => (
            <Issue
              key={i}
              level={x.severity}
              code={x.code}
              text={validationText(x)}
              detail={x.message}
              {...(x.tick !== undefined ? { location: `tick ${x.tick}` } : {})}
            />
          ))}
        </ul>
      )}

      {repairs.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-hl-high p-2">
          <div className="flex items-start gap-2">
            <input
              id={repairId}
              type="checkbox"
              className="mt-1"
              checked={repair}
              onChange={(e) => dispatch({ type: 'SET_REPAIR', repair: e.target.checked })}
            />
            <label htmlFor={repairId} className="text-sm">
              应用安全连奏修复：裁剪 {repairs.length} 个容差内的连奏尾音（只改这些音的时值，
              不改音高与起始位置；生成带审计记录的“清理后来源”，原始文件不变）。
            </label>
          </div>
          <TableScroll label="修复内容">
            <table className="data-table" data-testid="repair-table">
              <caption className="pb-1 text-left text-xs text-muted-text">
                {repair ? '已应用的修改' : '修复将做的修改（未应用）'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">音符</th>
                  <th scope="col">时值（tick）</th>
                  <th scope="col">重叠</th>
                  <th scope="col">因</th>
                </tr>
              </thead>
              <tbody>
                {repairs.map((r) => {
                  const n = notesById.get(r.noteId);
                  return (
                    <tr key={r.noteId}>
                      <td>
                        <span className="font-mono text-xs">{r.noteId}</span>
                        {n && ` ${pitchName(n.pitch)}`}
                      </td>
                      <td>
                        {r.from} → {r.to}
                      </td>
                      <td>
                        {r.overlapTicks} tick（{r.overlapMs} ms）
                      </td>
                      <td className="font-mono text-xs">{r.causedBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          {repair && original?.cleaned && (
            <p className="text-xs text-accent-text">
              ✓ 正在使用清理后来源（{repairs.length} 处修改）。
            </p>
          )}
        </div>
      )}

      {blocked && (
        <p role="alert" className="text-sm text-danger-text">
          {repair
            ? '修复后仍有无法自动处理的错误，无法继续分析。'
            : '存在错误，无法继续分析；请修正源文件或选择其他轨道。'}
        </p>
      )}
    </div>
  );
}
