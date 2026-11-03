import { useMemo } from 'react';
import { pitchName, trackMetadata, validateMelody, type ImportedTrack } from '@remode/core';
import { codeLabel } from '../lib/labels';
import { useDispatch, useProject } from '../state/ProjectContext';
import { CodeChip, TableScroll } from './ui';

interface Row {
  track: ImportedTrack;
  candidate: boolean;
  /** Overlaps or simultaneous onsets (validator's `monophonic` flag). */
  polyphonic: boolean;
  why: string | null;
}

export function TrackList() {
  const { input, trackId } = useProject();
  const dispatch = useDispatch();
  const rows = useMemo<Row[]>(() => {
    if (input?.kind !== 'midi') return [];
    const ids = new Set(input.candidates.map((t) => t.id));
    return input.midi.tracks.map((track) => ({
      track,
      candidate: ids.has(track.id),
      polyphonic:
        track.noteCount > 0 &&
        !validateMelody(track.notes, trackMetadata(input.midi, track)).monophonic,
      why: track.noteCount === 0 ? 'EMPTY_TRACK' : track.isPercussion ? 'PERCUSSION_TRACK' : null,
    }));
  }, [input]);
  if (input?.kind !== 'midi') return null;

  const many = input.candidates.length > 1;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid="track-list">
      <legend className="text-sm font-medium">
        轨道（{input.midi.tracks.length} 条，候选 {input.candidates.length} 条）
      </legend>
      {input.candidates.length === 0 && (
        <p role="alert" className="text-sm text-danger-text">
          没有可用的旋律轨：所有轨道都为空或是打击乐。
        </p>
      )}
      {many && trackId === null && (
        <p role="status" className="text-sm text-warn-text">
          文件含多条候选轨，请选择要处理的一条旋律轨。
        </p>
      )}
      <TableScroll label="轨道列表">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">选择</th>
              <th scope="col">轨道</th>
              <th scope="col">通道</th>
              <th scope="col">音符</th>
              <th scope="col">音域</th>
              <th scope="col">单声部</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ track, candidate, polyphonic, why }) => {
              const label = `${track.id}${track.name ? ` ${track.name}` : ''}`;
              return (
                <tr key={track.id} className={track.id === trackId ? 'bg-hl-low' : ''}>
                  <td>
                    <input
                      type="radio"
                      name="track"
                      value={track.id}
                      checked={track.id === trackId}
                      disabled={!candidate}
                      aria-label={`选择 ${label}`}
                      onChange={() => dispatch({ type: 'SELECT_TRACK', trackId: track.id })}
                    />
                  </td>
                  <td className="break-all">
                    <span className="font-mono text-xs">{track.id}</span>
                    {track.name && <span className="block">{track.name}</span>}
                    {why && (
                      <span className="block text-xs text-muted-text">
                        <CodeChip code={why} /> {codeLabel(why)}
                      </span>
                    )}
                  </td>
                  <td>{track.channel + 1}</td>
                  <td>{track.noteCount}</td>
                  <td className="whitespace-nowrap">
                    {track.pitchRange
                      ? `${pitchName(track.pitchRange.min)}–${pitchName(track.pitchRange.max)}`
                      : '—'}
                  </td>
                  <td>{track.noteCount === 0 ? '—' : polyphonic ? '✕ 疑似复音' : '✓ 是'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </fieldset>
  );
}
