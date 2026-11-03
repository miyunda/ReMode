import { useId } from 'react';
import { pitchClassName, type PitchClassDistribution } from '@remode/core';
import { beats } from '../lib/format';
import { TableScroll } from './ui';

/**
 * Pitch-class duration chart (spec §6.3 step 1). Bars are sounding time in
 * beats, not shares, so nothing reads as a probability. Members of the
 * selected collection are filled; others are hatched (not colour alone).
 */
export function PcdChart({
  pcd,
  ppq,
  inSet,
}: {
  pcd: PitchClassDistribution;
  ppq: number;
  /** Pitch classes of the selected collection. */
  inSet: ReadonlySet<number>;
}) {
  const id = useId();
  const max = Math.max(...pcd.durations, 1);
  const W = 360;
  const H = 150;
  const top = 12;
  const bottom = 28;
  const left = 8;
  const bw = (W - left * 2) / 12;
  const plotH = H - top - bottom;
  const summary = pcd.durations
    .map((d, pc) => (d > 0 ? `${pitchClassName(pc)} ${beats(d, ppq)} 拍` : null))
    .filter(Boolean)
    .join('，');

  return (
    <figure className="flex min-w-0 flex-col gap-2" data-testid="pcd-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-xl"
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
      >
        <title id={`${id}-t`}>音级时值分布（按拍）</title>
        <desc id={`${id}-d`}>{summary || '没有音符'}</desc>
        <defs>
          <pattern
            id={`${id}-hatch`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-love" strokeWidth="3" />
          </pattern>
        </defs>
        <line
          x1={left}
          x2={W - left}
          y1={top + plotH}
          y2={top + plotH}
          className="stroke-hl-high"
        />
        {pcd.durations.map((d, pc) => {
          const h = (d / max) * plotH;
          const x = left + pc * bw + 3;
          const member = inSet.has(pc);
          return (
            <g key={pc}>
              {d > 0 && (
                <rect
                  x={x}
                  y={top + plotH - h}
                  width={bw - 6}
                  height={h}
                  rx={2}
                  className={member ? 'fill-pine' : 'stroke-love'}
                  fill={member ? undefined : `url(#${id}-hatch)`}
                  strokeWidth={member ? 0 : 1.5}
                />
              )}
              <text
                x={x + (bw - 6) / 2}
                y={H - bottom + 14}
                textAnchor="middle"
                className={`text-[11px] ${member ? 'fill-text' : 'fill-muted-text'}`}
              >
                {pitchClassName(pc)}
              </text>
              {d > 0 && (
                <text
                  x={x + (bw - 6) / 2}
                  y={top + plotH - h - 3}
                  textAnchor="middle"
                  className="fill-muted-text text-[9px]"
                >
                  {beats(d, ppq)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted-text">
        纵轴：累计时值（拍）。实心 = 所选音集内的音级；斜线 = 音集外。
      </figcaption>
      <details>
        <summary className="cursor-pointer text-xs font-medium">数据表</summary>
        <TableScroll label="音级时值数据表">
          <table className="data-table mt-1" data-testid="pcd-table">
            <thead>
              <tr>
                <th scope="col">音级</th>
                <th scope="col">时值（拍）</th>
                <th scope="col">时值（tick）</th>
                <th scope="col">在所选音集内</th>
              </tr>
            </thead>
            <tbody>
              {pcd.durations.map((d, pc) => (
                <tr key={pc}>
                  <th scope="row" className="font-normal">
                    {pitchClassName(pc)}
                  </th>
                  <td>{beats(d, ppq)}</td>
                  <td>{d}</td>
                  <td>{inSet.has(pc) ? '是' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </details>
    </figure>
  );
}
