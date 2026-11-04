import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { WEB_LIMITS } from '../src/lib/limits';
import { THEME_KEY } from '../src/lib/theme';
import { fixtureBytes } from './helpers';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
  vi.restoreAllMocks();
});

const setup = () => {
  const user = userEvent.setup();
  render(<App />);
  return user;
};

async function loadExample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '填入示例' }));
  await user.click(screen.getByRole('button', { name: '分析简谱' }));
}

describe('workbench', () => {
  it('shows the piano roll and a placeholder for the M2c transport', () => {
    setup();
    expect(screen.getByTestId('roll-empty')).toBeInTheDocument();
    expect(screen.getByTestId('placeholder-transport')).toHaveTextContent('M2c');
  });

  it('analyses the jianpu example: candidates, evidence, ambiguity codes, no percentages', async () => {
    const user = setup();
    await loadExample(user);
    const candidates = screen.getAllByTestId('candidate');
    expect(candidates[0]).toHaveTextContent('C 宫调式（C 宫系统，五声）');
    expect(within(candidates[0]!).getByText('FINAL_NOTE')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('ambiguities')).getByText('MISSING_DEGREES'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('analysis-version')).toHaveTextContent('remode-mode-2step/');
    expect(screen.getByTestId('pcd-table')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/%|％|置信/);
  });

  it('a manual source mode overrides detection, is labelled, and feeds Strict', async () => {
    const user = setup();
    await loadExample(user);
    expect(screen.getByTestId('effective-source-mode')).toHaveTextContent('自动识别');

    const picker = screen.getByTestId('source-picker');
    await user.selectOptions(within(picker).getByLabelText('体系'), 'church');
    await user.selectOptions(within(picker).getByLabelText('调式'), 'ionian');
    await user.click(screen.getByRole('button', { name: '使用此来源调式' }));
    expect(screen.getByTestId('effective-source-mode')).toHaveTextContent('C Ionian');
    expect(screen.getByTestId('effective-source-mode')).toHaveTextContent('手动指定');

    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    expect(screen.getByTestId('changed-count')).toHaveTextContent('5');
    const rows = within(screen.getByTestId('diff-table')).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(rows[1]).toHaveTextContent('E4');
    expect(rows[1]).toHaveTextContent('Eb4');
    expect(screen.getByTestId('recheck')).toHaveTextContent('C Dorian');

    await user.click(screen.getByRole('button', { name: '恢复自动识别' }));
    expect(screen.getByTestId('effective-source-mode')).toHaveTextContent('自动识别');
    // The stale Strict variant is gone; the roll and table fall back to the original.
    expect(screen.getByTestId('active-view')).toHaveTextContent('原曲');
    expect(screen.getByTestId('view-generated')).toBeDisabled();
  });

  it('warns NO_CHARACTERISTIC_DEGREE for a target whose colour the melody never sounds', async () => {
    const user = setup();
    await loadExample(user);
    const picker = screen.getByTestId('target-picker');
    await user.selectOptions(within(picker).getByLabelText('体系'), 'church');
    await user.selectOptions(within(picker).getByLabelText('调式'), 'mixolydian');
    // Source: C 宫 五声 (auto). Mixolydian differs from it in 4 and ♭7, neither sounded.
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    expect(
      within(screen.getByTestId('transform-warnings')).getByText('NO_CHARACTERISTIC_DEGREE'),
    ).toBeInTheDocument();
  });

  it('shows jianpu errors with line and column', async () => {
    const user = setup();
    await user.type(screen.getByLabelText('简谱文本'), '1=C 4/4 | 1 2 ~3 |');
    await user.click(screen.getByRole('button', { name: '分析简谱' }));
    const alert = screen.getByTestId('load-failure');
    expect(alert).toHaveTextContent('UNSUPPORTED_ORNAMENT');
    expect(alert).toHaveTextContent('第 1 行，第 15 列');
  });

  it('requires a track choice for multi-track MIDI and shows polyphony per track', async () => {
    const user = setup();
    const file = new File(
      [fixtureBytes('type0-multichannel.mid') as Uint8Array<ArrayBuffer>],
      'type0-multichannel.mid',
    );
    await user.upload(screen.getByTestId('file-input'), file);
    expect(
      await screen.findByText('文件含多条候选轨，请选择要处理的一条旋律轨。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成 Strict' })).toBeDisabled();
    await user.click(screen.getByLabelText(/选择 track-0/));
    expect(screen.getAllByTestId('candidate')[0]).toHaveTextContent('D Dorian');
  });

  it('opt-in repair shows what changes', async () => {
    const user = setup();
    const file = new File(
      [fixtureBytes('overlap-legato.mid') as Uint8Array<ArrayBuffer>],
      'overlap-legato.mid',
    );
    await user.upload(screen.getByTestId('file-input'), file);
    const table = await screen.findByTestId('repair-table');
    expect(table).toHaveTextContent('修复将做的修改（未应用）');
    await user.click(screen.getByRole('checkbox', { name: /应用安全连奏修复/ }));
    expect(screen.getByTestId('repair-table')).toHaveTextContent('已应用的修改');
    expect(screen.getByText(/正在使用清理后来源/)).toBeInTheDocument();
  });
});

describe('review fixes', () => {
  it('typing -3 key by key transposes down and names the file down3', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:remode-test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = setup();
    await loadExample(user);
    await user.click(screen.getByRole('radio', { name: '移调' }));
    const field = screen.getByLabelText(/半音数/);
    await user.clear(field);
    await user.type(field, '-');
    expect(field).toHaveValue('-');
    await user.type(field, '3');
    expect(field).toHaveValue('-3');
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    expect(screen.getByTestId('variant-summary')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /移调 -3 半音/ })).toBeInTheDocument();
    const rows = within(screen.getByTestId('diff-table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('-3');
    await user.click(screen.getByTestId('download'));
    expect(screen.getByTestId('export-result')).toHaveTextContent('melody-transpose-down3.mid');
  });

  it('rejects non-integer semitones with a message and clamps to ±48 on blur', async () => {
    const user = setup();
    await loadExample(user);
    await user.click(screen.getByRole('radio', { name: '移调' }));
    const field = screen.getByLabelText(/半音数/);
    await user.clear(field);
    await user.type(field, '-');
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入');
    expect(screen.getByTestId('view-generated')).toBeDisabled();
    await user.clear(field);
    await user.type(field, '-99');
    await user.tab();
    expect(field).toHaveValue('-48');
  });

  it('PCD marks the union of all selected collections; candidate warnings are labelled', async () => {
    const user = setup();
    const file = new File(
      [fixtureBytes('chromatic-twelve-tone.mid') as Uint8Array<ArrayBuffer>],
      'chromatic-twelve-tone.mid',
    );
    await user.upload(screen.getByTestId('file-input'), file);
    const table = await screen.findByTestId('pcd-table');
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.lastElementChild?.textContent);
    expect(cells).toEqual(Array(12).fill('是'));
    const warnings = screen.getAllByTestId('candidate-warnings')[0]!;
    expect(warnings).toHaveTextContent('OUT_OF_SET_NOTES');
    expect(warnings).toHaveTextContent('含音集外的音');
  });

  it('never truncates a long jianpu paste; the parser reports TEXT_TOO_LONG', async () => {
    const user = setup();
    const long = '1=C 4/4 |' + ' 1'.repeat(WEB_LIMITS.maxJianpuChars / 2);
    const area = screen.getByLabelText('简谱文本');
    fireEvent.change(area, { target: { value: long } });
    expect((area as HTMLTextAreaElement).value).toHaveLength(long.length);
    expect(screen.getByTestId('jianpu-count')).toHaveTextContent('超过上限');
    await user.click(screen.getByRole('button', { name: '分析简谱' }));
    expect(screen.getByTestId('load-failure')).toHaveTextContent('TEXT_TOO_LONG');
  });
});

describe('theme', () => {
  beforeEach(() => localStorage.clear());

  it('follows the system by default and persists a manual choice', async () => {
    const user = setup();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    await user.selectOptions(screen.getByTestId('theme-select'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    await user.selectOptions(screen.getByTestId('theme-select'), 'system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = setup();
    await user.selectOptions(screen.getByTestId('theme-select'), 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
