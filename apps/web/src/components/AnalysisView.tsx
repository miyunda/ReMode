import { useMemo } from 'react';
import {
  collectionLabel,
  collectionPitchClasses,
  pitchClassName,
  type Ambiguity,
  type CollectionMatch,
  type ModeCandidate,
} from '@remode/core';
import { beats } from '../lib/format';
import { EVIDENCE_LABELS, codeLabel } from '../lib/labels';
import { useProject } from '../state/ProjectContext';
import { PcdChart } from './PcdChart';
import { CodeChip, Issue, Section, Severity, TableScroll } from './ui';

const sameCollection = (a: CollectionMatch, b: CollectionMatch) =>
  a.collectionId === b.collectionId && a.transposition === b.transposition;

function CollectionRow({
  c,
  durations,
  ppq,
  selected,
}: {
  c: CollectionMatch;
  durations: readonly number[];
  ppq: number;
  selected: boolean;
}) {
  const members = new Set(collectionPitchClasses(c.collectionId, c.transposition));
  const total = durations.reduce((s, d) => s + d, 0);
  const inside = durations.reduce((s, d, pc) => s + (members.has(pc) ? d : 0), 0);
  return (
    <li className="rounded-lg border border-hl-med bg-base p-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <strong>{collectionLabel(c)}</strong>
        {selected && (
          <span className="rounded border border-pine px-1.5 text-xs text-accent-text">
            ✓ 候选来源
          </span>
        )}
      </p>
      <p className="text-xs text-muted-text">
        集内时值 {beats(inside, ppq)} / {beats(total, ppq)} 拍 · 未用音级：
        {c.unusedDegrees.length ? c.unusedDegrees.map(pitchClassName).join(' ') : '无'} · 集外音：
        {c.outOfSet.length
          ? c.outOfSet
              .map(
                (o) =>
                  `${pitchClassName(o.pitchClass)}（${beats(durations[o.pitchClass] ?? 0, ppq)} 拍）`,
              )
              .join(' ')
          : '无'}
      </p>
    </li>
  );
}

function CandidateCard({ c, noteIndex }: { c: ModeCandidate; noteIndex: Map<string, number> }) {
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-hl-med bg-base p-3"
      data-testid="candidate"
      data-rank={c.rank}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-overlay px-1.5 py-0.5 text-xs font-semibold">
          第 {c.rank} 名
        </span>
        <strong className="text-base" title={`scaleId: ${c.scaleId}`}>
          {c.name}
        </strong>
        <span className="text-xs text-muted-text">证据点数合计 {c.evidencePoints}</span>
      </div>
      {c.aliases.length > 0 && (
        <p className="text-xs text-muted-text">
          同音集同主音的其他名称：{c.aliases.map((a) => a.name).join('；')}
        </p>
      )}
      <p className="text-xs text-muted-text">音集：{collectionLabel(c.collection)}</p>
      {c.warnings.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs" data-testid="candidate-warnings">
          {c.warnings.map((w, i) => (
            <li key={i} className="flex items-center gap-1 text-warn-text">
              <span aria-hidden="true">!</span>
              <CodeChip code={w} /> {codeLabel(w)}
            </li>
          ))}
        </ul>
      )}
      {c.tonicEvidence.length === 0 ? (
        <p className="text-xs text-muted-text">没有支持此主音的证据。</p>
      ) : (
        <TableScroll label={`${c.name} 的主音证据`}>
          <table className="data-table">
            <caption className="pb-1 text-left text-xs text-muted-text">主音证据</caption>
            <thead>
              <tr>
                <th scope="col">证据</th>
                <th scope="col">命中</th>
                <th scope="col">点数</th>
                <th scope="col">说明</th>
                <th scope="col">相关音符</th>
              </tr>
            </thead>
            <tbody>
              {c.tonicEvidence.map((e) => (
                <tr key={e.kind}>
                  <td className="whitespace-nowrap">
                    {EVIDENCE_LABELS[e.kind]} <CodeChip code={e.kind} />
                  </td>
                  <td className="whitespace-nowrap">
                    {e.matched} / {e.of}
                  </td>
                  <td>{e.points}</td>
                  <td>{e.detail}</td>
                  <td>
                    <ul className="flex flex-wrap gap-1" aria-label="音符 ID">
                      {e.noteIds.map((id) => (
                        <li key={id}>
                          <code className="code-chip" title={id}>
                            #{noteIndex.get(id) ?? '?'} {id}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </li>
  );
}

/** MISSING_DEGREES lists every affected mode; a one-line summary is shown until expanded. */
function CollapsedAmbiguity({ a }: { a: Ambiguity }) {
  const modes = a.affectedModes ?? [];
  const missing = a.missingDegrees ?? [];
  return (
    <li
      className="rounded-lg border border-hl-med bg-base p-2 text-sm"
      data-code={a.code}
      data-testid="ambiguity-collapsed"
    >
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <Severity level="info" />
          <CodeChip code={a.code} />
          <span className="font-medium">{codeLabel(a.code)}</span>
          <span className="text-xs text-muted-text">
            {missing.length > 0 && `缺 ${missing.length} 个音级 · `}涉及 {modes.length} 个调式
          </span>
          <span className="text-xs text-accent-text underline">展开</span>
        </summary>
        <p className="mt-1">{a.detail}</p>
        {modes.length > 0 && (
          <p className="text-xs text-muted-text">涉及：{modes.map((m) => m.name).join('、')}</p>
        )}
      </details>
    </li>
  );
}

export function AnalysisView() {
  const { analysis, original } = useProject();
  const noteIndex = useMemo(
    () => new Map((original?.notes ?? []).map((n, i) => [n.id, i + 1])),
    [original],
  );
  if (!analysis || !original) {
    return (
      <Section id="analysis" title="Analysis" subtitle="调式分析">
        <p className="text-sm text-muted-text">
          导入旋律并通过预检后，这里显示音集、主音证据与歧义。
        </p>
      </Section>
    );
  }
  const ppq = original.metadata.ppq;
  // Union of every selected collection (candidates may come from several, e.g. a
  // chromatic melody where all twelve diatonic transpositions tie).
  const inSet = new Set(
    analysis.selectedCollections.flatMap((s) =>
      collectionPitchClasses(s.collectionId, s.transposition),
    ),
  );

  return (
    <Section
      id="analysis"
      title="Analysis"
      subtitle="调式分析"
      actions={
        <code className="text-xs text-muted-text" data-testid="analysis-version">
          {analysis.analysisVersion}
        </code>
      }
    >
      <p className="text-xs text-muted-text">
        两步法：先识别音集，再按具名证据判断主音。排序依据具名证据，点数不是概率。{' '}
        {analysis.noteCount} 个音符，{analysis.phrases.length} 个乐句。
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">结构性歧义（{analysis.ambiguities.length}）</h3>
        {analysis.ambiguities.length === 0 ? (
          <p className="text-sm text-muted-text">无。</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="ambiguities">
            {analysis.ambiguities.map((a, i) =>
              a.code === 'MISSING_DEGREES' ? (
                <CollapsedAmbiguity key={i} a={a} />
              ) : (
                <Issue key={i} level="info" code={a.code} text={a.detail}>
                  {(a.affectedModes?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-text">
                      涉及：{a.affectedModes?.map((m) => m.name).join('、')}
                    </p>
                  )}
                </Issue>
              ),
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">兼容音集（{analysis.compatibleCollections.length}）</h3>
        <ul className="flex flex-col gap-2" data-testid="collections">
          {(analysis.compatibleCollections.length
            ? analysis.compatibleCollections
            : analysis.selectedCollections
          ).map((c, i) => (
            <CollectionRow
              key={i}
              c={c}
              durations={analysis.pcd.durations}
              ppq={ppq}
              selected={analysis.selectedCollections.some((s) => sameCollection(s, c))}
            />
          ))}
        </ul>
        {analysis.compatibleCollections.length === 0 && (
          <p className="text-xs text-warn-text">没有音集达到覆盖阈值；以上为最接近的音集。</p>
        )}
      </div>

      <PcdChart pcd={analysis.pcd} ppq={ppq} inSet={inSet} />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          候选调式（{analysis.candidates.length}，按证据排序）
        </h3>
        <ol className="flex flex-col gap-2">
          {analysis.candidates.map((c, i) => (
            <CandidateCard key={i} c={c} noteIndex={noteIndex} />
          ))}
        </ol>
      </div>
    </Section>
  );
}
