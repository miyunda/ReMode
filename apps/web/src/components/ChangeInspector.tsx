import { useMemo, useState } from 'react';
import { inMode, mod, recheckTarget, writeJianpu, type RecheckResult } from '@remode/core';
import { useEngine } from '../audio/AudioProvider';
import { signed } from '../lib/format';
import { downloadBytes, downloadText, exportView, type VariantExport } from '../lib/exportVariant';
import { activeVariant, targetMode } from '../state/project';
import { useDispatch, useProject } from '../state/ProjectContext';
import { NoteTable } from './NoteTable';
import { CodeChip, Issue, Section } from './ui';

function Recheck({ recheck }: { recheck: RecheckResult }) {
  return (
    <div className="rounded-lg border border-hl-med bg-base p-2 text-sm" data-testid="recheck">
      <p>
        <span className="text-muted-text">分析器回检：</span>
        {recheck.recognised ? (
          <span className="text-accent-text">
            ✓ 目标 {recheck.target.name} 位列第 1 名
            {recheck.matchedAs === 'alias' ? '（以同音集别名）' : ''}
          </span>
        ) : (
          <span className="text-warn-text">! 目标 {recheck.target.name} 未位列第 1 名</span>
        )}
      </p>
      <p className="text-xs text-muted-text">
        第 1 名：{recheck.rank1.map((m) => m.name).join(' / ') || '无'}
        {recheck.ambiguities.length > 0 && ' · 歧义：'}
        {recheck.ambiguities.map((a, i) => (
          <CodeChip key={i} code={a.code} />
        ))}{' '}
        · <code>{recheck.analysisVersion}</code>
      </p>
      <p className="text-xs text-muted-text">回检仅作诊断，不是优化目标。</p>
    </div>
  );
}

const VIEW_NAMES = { original: '原曲', generated: 'Strict', custom: 'Custom' } as const;

/** The active variant: summary, generation diagnostics, the note table and downloads. */
export function ChangeInspector() {
  const state = useProject();
  const dispatch = useDispatch();
  const engine = useEngine();
  const { generated, original, custom, view, selectedNoteId, input } = state;
  const [exported, setExported] = useState<VariantExport | null>(null);
  const [jianpu, setJianpu] = useState<ReturnType<typeof writeJianpu> | null>(null);
  const active = useMemo(() => activeVariant(state), [state]);
  const tgt = targetMode(state);
  const [seen, setSeen] = useState(active?.notes);
  if (seen !== active?.notes) {
    setSeen(active?.notes);
    setExported(null);
    setJianpu(null);
  }
  const customRecheck = useMemo(
    () =>
      original && custom && view === 'custom' && tgt
        ? recheckTarget(custom.variant.notes, tgt, {
            ppq: original.metadata.ppq,
            timeSignatures: original.metadata.timeSignatures,
          })
        : null,
    [original, custom, view, tgt],
  );

  if (!original || !active) {
    return (
      <Section id="inspector" title="Change inspector" subtitle="改写清单">
        <p className="text-sm text-muted-text">
          在 TARGET 中选择操作并点击“生成 Strict”后，这里列出逐音改动。
        </p>
      </Section>
    );
  }

  const g = generated?.ok ? generated : null;
  const viewName =
    active.id === 'generated' && g?.operation === 'transpose' ? '移调结果' : VIEW_NAMES[active.id];
  const title = g
    ? g.operation === 'parallel-remode'
      ? `${g.source.name} → ${g.target.name}`
      : `移调 ${signed(g.semitones)} 半音`
    : viewName;
  const outOfTarget =
    tgt && active.id !== 'original' ? active.notes.filter((n) => !inMode(n.pitch, tgt)).length : 0;
  const download = () => {
    const r = exportView(active.id, original, g, custom);
    setExported(r);
    if (r.ok) downloadBytes(r.bytes, r.fileName);
  };
  // `1=` of the written text: the key the melody was entered in, else the source key signature.
  const keyPitchClass =
    input?.kind === 'new'
      ? input.keyPitchClass
      : input?.kind === 'jianpu'
        ? mod(input.melody.header.keyPitch, 12)
        : undefined;
  const exportJianpu = () => {
    const r = writeJianpu(
      active.notes,
      original.metadata,
      keyPitchClass !== undefined ? { keyPitchClass } : {},
    );
    setJianpu(r);
    if (r.ok) {
      const base = exportView(active.id, original, g, custom).fileName.replace(/\.mid$/, '');
      downloadText(r.text, `${base}.jianpu`);
    }
  };
  const transform = g?.variant.transform as { version?: string } | undefined;
  const customBase =
    custom?.forkedFrom === 'original'
      ? '原曲'
      : custom?.base?.operation === 'transpose'
        ? '移调结果'
        : 'Strict';

  return (
    <Section
      id="inspector"
      title="Change inspector"
      subtitle={title}
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={exportJianpu}
            data-testid="download-jianpu"
          >
            导出简谱文本
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={download}
            data-testid="download"
          >
            下载 MIDI（{viewName}）
          </button>
        </div>
      }
    >
      {generated && !generated.ok && (
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
      )}

      <div className="flex flex-col gap-1 text-sm" data-testid="variant-summary">
        <p>
          当前显示：<strong data-testid="active-view">{viewName}</strong> · 改动{' '}
          <strong data-testid="changed-count">{active.diff.length}</strong> /{' '}
          {original.notes.length} 个音；起始位置、时值、力度与音符 ID 均不变。
        </p>
        {active.id === 'custom' && custom && (
          <p className="text-xs text-muted-text" data-testid="custom-summary">
            基于{customBase}，{custom.edits.length} 次手动修改（
            <CodeChip code="MANUAL_EDIT" />
            ）· <code>{String(custom.variant.transform?.['version'] ?? '')}</code>
          </p>
        )}
        {active.id === 'generated' && g && (
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
        )}
        {active.id === 'generated' &&
          g?.operation === 'parallel-remode' &&
          g.report.characteristic.differing.length > 0 && (
            <p className="text-xs text-muted-text">
              不同的音级：{g.report.characteristic.differing.join('、')}；旋律中实际出现：
              {g.report.characteristic.sounded.length
                ? g.report.characteristic.sounded.join('、')
                : '无'}
            </p>
          )}
        {outOfTarget > 0 && tgt && (
          <p className="text-xs text-warn-text" data-testid="out-of-target">
            <span aria-hidden="true">! </span>
            {outOfTarget} 个音不在目标音阶 {tgt.name} 内（
            <CodeChip code="OUT_OF_TARGET_SCALE" />
            ）。
          </p>
        )}
      </div>

      {active.id === 'generated' && g && g.warnings.length > 0 && (
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

      {active.id === 'generated' && g?.recheck && <Recheck recheck={g.recheck} />}
      {active.id === 'custom' && customRecheck && <Recheck recheck={customRecheck} />}

      <NoteTable
        original={original.notes}
        notes={active.notes}
        changes={active.changes}
        meta={original.metadata}
        target={active.id === 'original' ? null : tgt}
        selectedId={selectedNoteId}
        onSelect={(id) => {
          dispatch({ type: 'SELECT_NOTE', noteId: id });
          const note = active.notes.find((n) => n.id === id);
          if (note) engine.audition(note.pitch);
        }}
      />

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
      {jianpu && (
        <div className="flex flex-col gap-2 text-sm" data-testid="jianpu-result" aria-live="polite">
          {jianpu.ok ? (
            <>
              <p>
                简谱文本（<code>{jianpu.syntaxVersion}</code> 语法，可粘贴回导入框）：
              </p>
              <pre className="max-w-full overflow-x-auto rounded-lg border border-hl-med bg-base p-2 font-mono text-xs">
                {jianpu.text}
              </pre>
              {jianpu.warnings.length > 0 && (
                <ul className="flex flex-col gap-2" data-testid="jianpu-warnings">
                  {jianpu.warnings.map((w, i) => (
                    <Issue key={i} level="warning" code={w.code} detail={w.message}>
                      <p className="text-xs break-words text-muted-text">
                        音符：{w.noteIds.slice(0, 12).join('、')}
                        {w.noteIds.length > 12 && ` 等 ${w.noteIds.length} 个`}
                      </p>
                    </Issue>
                  ))}
                </ul>
              )}
            </>
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
