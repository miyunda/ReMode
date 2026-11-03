import { useState } from 'react';
import { codeLabel } from '../lib/labels';
import { barBeat, signed } from '../lib/format';
import { downloadBytes, exportGenerated, type VariantExport } from '../lib/exportVariant';
import { useProject } from '../state/ProjectContext';
import { CodeChip, Issue, Section, TableScroll } from './ui';

/** Strict result: warnings, diagnostics, re-check, per-note diff and MIDI download. */
export function ChangeInspector() {
  const { generated, original } = useProject();
  const [exported, setExported] = useState<VariantExport | null>(null);
  const [seen, setSeen] = useState(generated);
  if (seen !== generated) {
    setSeen(generated);
    setExported(null);
  }

  if (!generated || !original) {
    return (
      <Section id="inspector" title="Change inspector" subtitle="改写清单">
        <p className="text-sm text-muted-text">
          在 TARGET 中选择操作并点击“生成 Strict”后，这里列出逐音改动。
        </p>
      </Section>
    );
  }
  if (!generated.ok) {
    return (
      <Section id="inspector" title="Change inspector" subtitle="生成失败">
        <ul className="flex flex-col gap-2" role="alert" data-testid="transform-errors">
          {generated.errors.map((e, i) => (
            <Issue
              key={i}
              level="error"
              code={e.code}
              text={e.message}
              {...(generated.step ? { location: `步骤：${generated.step}` } : {})}
            />
          ))}
        </ul>
      </Section>
    );
  }

  const g = generated;
  const transform = g.variant.transform as { version?: string } | null;
  const title =
    g.operation === 'parallel-remode'
      ? `${g.source.name} → ${g.target.name}`
      : `移调 ${signed(g.semitones)} 半音`;
  const download = () => {
    const r = exportGenerated(original, g);
    setExported(r);
    if (r.ok) downloadBytes(r.bytes, r.fileName);
  };

  return (
    <Section
      id="inspector"
      title="Change inspector"
      subtitle={title}
      actions={
        <button type="button" className="btn btn-primary" onClick={download} data-testid="download">
          下载 MIDI
        </button>
      }
    >
      <div className="flex flex-col gap-1 text-sm" data-testid="variant-summary">
        <p>
          改动 <strong data-testid="changed-count">{g.diff.length}</strong> /{' '}
          {original.notes.length} 个音；起始位置、时值、力度与音符 ID 均不变。
        </p>
        <p className="text-xs text-muted-text">
          {transform?.version && <code>{transform.version}</code>}
          {g.operation === 'parallel-remode' && (
            <>
              {' '}
              · 来源调式{g.source.via === 'manual' ? '（手动指定）' : '（自动识别）'} · 映射方式{' '}
              <code>{g.report.mapping}</code>
              {g.preTranspose !== null && ` · 先移调 ${signed(g.preTranspose)} 半音，再换调式`}
              {g.report.range.shift !== 0 && ` · 整体移动 ${g.report.range.shift / 12} 个八度`}
            </>
          )}
        </p>
        {g.operation === 'parallel-remode' && g.report.characteristic.differing.length > 0 && (
          <p className="text-xs text-muted-text">
            不同的音级：{g.report.characteristic.differing.join('、')}；旋律中实际出现：
            {g.report.characteristic.sounded.length
              ? g.report.characteristic.sounded.join('、')
              : '无'}
          </p>
        )}
      </div>

      {g.warnings.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="transform-warnings">
          {g.warnings.map((w, i) => (
            <Issue key={i} level="warning" code={w.code} text={w.message}>
              {w.degrees && w.degrees.length > 0 && (
                <p className="text-xs text-muted-text">相关音级：{w.degrees.join('、')}</p>
              )}
            </Issue>
          ))}
        </ul>
      )}

      {g.recheck && (
        <div className="rounded-lg border border-hl-med bg-base p-2 text-sm" data-testid="recheck">
          <p>
            <span className="text-muted-text">分析器回检：</span>
            {g.recheck.recognised ? (
              <span className="text-accent-text">
                ✓ 目标 {g.recheck.target.name} 位列第 1 名
                {g.recheck.matchedAs === 'alias' ? '（以同音集别名）' : ''}
              </span>
            ) : (
              <span className="text-warn-text">! 目标 {g.recheck.target.name} 未位列第 1 名</span>
            )}
          </p>
          <p className="text-xs text-muted-text">
            第 1 名：{g.recheck.rank1.map((m) => m.name).join(' / ') || '无'}
            {g.recheck.ambiguities.length > 0 && ' · 歧义：'}
            {g.recheck.ambiguities.map((a, i) => (
              <CodeChip key={i} code={a.code} />
            ))}{' '}
            · <code>{g.recheck.analysisVersion}</code>
          </p>
          <p className="text-xs text-muted-text">回检仅作诊断，不是优化目标。</p>
        </div>
      )}

      {g.diff.length === 0 ? (
        <p className="text-sm text-muted-text">没有音被改变。</p>
      ) : (
        <TableScroll label="逐音改动">
          <table className="data-table" data-testid="diff-table">
            <caption className="pb-1 text-left text-xs text-muted-text">
              逐音改动（音符 # → 原音 → 新音 → 原因）
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">位置</th>
                <th scope="col">原音</th>
                <th scope="col">新音</th>
                <th scope="col">变化</th>
                <th scope="col">原因</th>
              </tr>
            </thead>
            <tbody>
              {g.diff.map((d) => {
                const delta = d.toPitch - d.fromPitch;
                return (
                  <tr key={d.noteId}>
                    <td>
                      {d.index}
                      <span className="block font-mono text-[10px] text-muted-text">
                        {d.noteId}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">{barBeat(d.startTick, original.metadata)}</td>
                    <td>{d.from}</td>
                    <td className="font-semibold">{d.to}</td>
                    <td className="whitespace-nowrap">
                      <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span> {signed(delta)}
                    </td>
                    <td>
                      <CodeChip code={d.reasonCode} /> {codeLabel(d.reasonCode)}
                      {d.explanation && (
                        <span className="block text-xs text-muted-text">{d.explanation}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      {exported && (
        <div className="text-sm" data-testid="export-result" aria-live="polite">
          {exported.ok ? (
            <>
              <p>
                已生成 <code>{exported.fileName}</code>（{exported.bytes.length} 字节，调号策略{' '}
                <code>{exported.report.keySignature.policy}</code>
                {exported.report.keySignature.mode && `，${exported.report.keySignature.mode.text}`}
                ）。
              </p>
              {exported.report.warnings.length > 0 && (
                <ul className="mt-2 flex flex-col gap-2">
                  {exported.report.warnings.map((w, i) => (
                    <Issue key={i} level="warning" code={w.code} detail={w.message} />
                  ))}
                </ul>
              )}
            </>
          ) : (
            <ul className="flex flex-col gap-2" role="alert">
              {exported.errors.map((e, i) => (
                <Issue key={i} level="error" code={e.code} detail={e.message} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}
