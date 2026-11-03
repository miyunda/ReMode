import { useId, useState } from 'react';
import { inMode, pitchName, type MelodyNote, type ModeRef, type PitchChange } from '@remode/core';
import { barBeat, signed } from '../lib/format';
import { codeLabel } from '../lib/labels';
import type { MidiMetadata } from '@remode/core';
import { CodeChip, TableScroll } from './ui';

export const PAGE_SIZE = 100;

/**
 * The screen-reader alternative to the piano roll (spec §10.3): one row per
 * note (or per changed note), synchronized with the roll's selection.
 */
export function NoteTable({
  original,
  notes,
  changes,
  meta,
  target,
  selectedId,
  onSelect,
}: {
  original: readonly MelodyNote[];
  notes: readonly MelodyNote[];
  changes: readonly PitchChange[];
  meta: Pick<MidiMetadata, 'ppq' | 'timeSignatures'>;
  target: ModeRef | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(changes.length === 0);
  const [page, setPage] = useState(0);
  const filterId = useId();
  const byId = new Map(changes.map((c) => [c.noteId, c]));
  const rows = notes
    .map((n, i) => ({ n, i, o: original[i] as MelodyNote, c: byId.get(n.id) }))
    .filter((r) => all || r.c);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // Follow the selection to its page.
  const selRow = rows.findIndex((r) => r.n.id === selectedId);
  const [seenSel, setSeenSel] = useState(selectedId);
  if (seenSel !== selectedId) {
    setSeenSel(selectedId);
    if (selRow >= 0 && Math.floor(selRow / PAGE_SIZE) !== page)
      setPage(Math.floor(selRow / PAGE_SIZE));
  }
  const p = Math.min(page, pages - 1);
  const shown = rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-2">
          <input
            id={filterId}
            type="checkbox"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
              setPage(0);
            }}
            data-testid="table-all"
          />
          <label htmlFor={filterId}>显示全部音符（否则只列改动）</label>
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1" role="group" aria-label="分页">
            <button
              type="button"
              className="btn px-2 py-0.5"
              disabled={p === 0}
              onClick={() => setPage(p - 1)}
            >
              上一页
            </button>
            <span className="text-xs text-muted-text">
              第 {p + 1} / {pages} 页
            </span>
            <button
              type="button"
              className="btn px-2 py-0.5"
              disabled={p >= pages - 1}
              onClick={() => setPage(p + 1)}
            >
              下一页
            </button>
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-text">没有音被改变。</p>
      ) : (
        <TableScroll label="音符表">
          <table className="data-table" data-testid="diff-table">
            <caption className="pb-1 text-left text-xs text-muted-text">
              {all ? '全部音符' : '逐音改动'}（音符 # → 原音 → 当前 →
              原因）；点选一行即在卷帘中选中该音
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">位置</th>
                <th scope="col">原音</th>
                <th scope="col">当前</th>
                <th scope="col">变化</th>
                <th scope="col">原因</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ n, i, o, c }) => {
                const delta = n.pitch - o.pitch;
                const sel = n.id === selectedId;
                const out = target !== null && c !== undefined && !inMode(n.pitch, target);
                return (
                  <tr
                    key={n.id}
                    aria-selected={sel}
                    className={
                      sel
                        ? 'bg-overlay outline-2 -outline-offset-2 outline-focus'
                        : 'cursor-pointer hover:bg-hl-low'
                    }
                    onClick={() => onSelect(n.id)}
                    data-note-id={n.id}
                  >
                    <td>
                      <button
                        type="button"
                        className="text-left underline decoration-dotted underline-offset-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(n.id);
                        }}
                        aria-label={`选中第 ${i + 1} 个音`}
                        aria-pressed={sel}
                      >
                        {sel && <span aria-hidden="true">▶ </span>}
                        {i + 1}
                      </button>
                      <span className="block font-mono text-[10px] text-muted-text">{n.id}</span>
                    </td>
                    <td className="whitespace-nowrap">{barBeat(n.startTick, meta)}</td>
                    <td>{pitchName(o.pitch)}</td>
                    <td className={delta !== 0 ? 'font-semibold' : ''}>
                      {pitchName(n.pitch)}
                      {out && (
                        <span className="ml-1 text-danger-text" title="不在目标音阶内">
                          <span aria-hidden="true">!</span>
                          <span className="sr-only">（不在目标音阶内）</span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {delta === 0 ? (
                        <span className="text-muted-text">—</span>
                      ) : (
                        <>
                          <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span> {signed(delta)}
                        </>
                      )}
                    </td>
                    <td>
                      {c ? (
                        <>
                          <CodeChip code={c.reasonCode} /> {codeLabel(c.reasonCode)}
                          {c.explanation && (
                            <span className="block text-xs text-muted-text">{c.explanation}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-text">未改动</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}
