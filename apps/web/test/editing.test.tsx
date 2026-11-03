import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';

afterEach(cleanup);

/** Jianpu example, manual source C Ionian, strict C Dorian. */
async function strict() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '填入示例' }));
  await user.click(screen.getByRole('button', { name: '分析简谱' }));
  const picker = screen.getByTestId('source-picker');
  await user.selectOptions(within(picker).getByLabelText('体系'), 'church');
  await user.selectOptions(within(picker).getByLabelText('调式'), 'ionian');
  await user.click(screen.getByRole('button', { name: '使用此来源调式' }));
  await user.click(screen.getByRole('button', { name: '生成 Strict' }));
  return user;
}

const row = (id: string) => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(screen.getByTestId('piano-roll'), { key: k, ...extra });

describe('note inspector', () => {
  it('shows ID, position, original → current, degrees and the reason of a changed note', async () => {
    const user = await strict();
    await user.click(within(row('jianpu:n1')).getByRole('button'));
    const inspector = screen.getByTestId('note-inspector');
    expect(inspector).toHaveTextContent('jianpu:n1');
    expect(inspector).toHaveTextContent('1.2（小节.拍）');
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → Eb4');
    expect(inspector).toHaveTextContent('3（中音） · C Ionian');
    expect(inspector).toHaveTextContent('♭3（中音） · C Dorian');
    expect(screen.getByTestId('inspector-reason')).toHaveTextContent('DEGREE_MAPPED');
    expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-selected', 'jianpu:n1');
    expect(row('jianpu:n1')).toHaveAttribute('aria-selected', 'true');
  });

  it('an unchanged note reads 未改动 and cannot be reverted', async () => {
    const user = await strict();
    await user.click(screen.getByTestId('table-all'));
    await user.click(within(row('jianpu:n0')).getByRole('button'));
    expect(screen.getByTestId('inspector-reason')).toHaveTextContent('未改动');
    expect(screen.getByTestId('revert-note')).toBeDisabled();
  });
});

describe('keyboard editing on the roll', () => {
  it('←/→ select, ↑/↓ step through the target scale, Shift for octaves, Esc deselects', async () => {
    const user = await strict();
    await user.click(within(row('jianpu:n1')).getByRole('button'));
    key('ArrowRight');
    expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-selected', 'jianpu:n2');
    key('ArrowLeft');
    key('ArrowUp');
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → F4');
    expect(screen.getByTestId('inspector-reason')).toHaveTextContent('MANUAL_EDIT');
    expect(screen.getByTestId('view-custom')).toHaveAttribute('aria-checked', 'true');
    key('ArrowDown');
    key('ArrowDown');
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → D4');
    key('ArrowUp', { shiftKey: true });
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → D5');
    expect(screen.getByTestId('roll-announce')).toHaveTextContent('D5');
    key('Escape');
    expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-selected', '');
  });

  it('snapping off steps by semitone and warns about notes outside the target scale', async () => {
    const user = await strict();
    await user.click(screen.getByTestId('snap-toggle'));
    expect(screen.getByTestId('snap-off-warning')).toBeInTheDocument();
    await user.click(within(row('jianpu:n1')).getByRole('button'));
    key('ArrowDown');
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → D4');
    key('ArrowUp');
    key('ArrowUp');
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → E4');
    expect(screen.getByTestId('out-of-target')).toHaveTextContent('1 个音不在目标音阶');
  });

  it('Ctrl+Z / Shift+Ctrl+Z undo and redo; the revert button restores the original pitch', async () => {
    const user = await strict();
    await user.click(within(row('jianpu:n1')).getByRole('button'));
    key('ArrowUp');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → Eb4');
    expect(screen.getByTestId('view-generated')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → F4');
    await user.click(screen.getByTestId('revert-note'));
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → E4');
    expect(screen.getByTestId('changed-count')).toHaveTextContent('4');
  });

  it('Ctrl+Z inside a text field is left to the field', async () => {
    const user = await strict();
    await user.click(within(row('jianpu:n1')).getByRole('button'));
    key('ArrowUp');
    fireEvent.keyDown(screen.getByLabelText('简谱文本'), { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('inspector-pitch')).toHaveTextContent('E4 → F4');
  });
});

describe('new-melody mode', () => {
  it('adds, edits and deletes notes from the keyboard, then analyses', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('new-melody'));
    key('Enter');
    key('Enter');
    key('ArrowUp');
    key('ArrowUp');
    key('Enter');
    expect(screen.getByTestId('draft-count')).toHaveTextContent('3 个音');
    key('ArrowRight', { shiftKey: true }); // move the last note one grid step later
    expect(screen.getByTestId('draft-selection')).toHaveTextContent('D4 · 1.2.50');
    key('Delete');
    expect(screen.getByTestId('draft-count')).toHaveTextContent('2 个音');
    key('Enter');
    key('Enter');
    await user.click(screen.getByTestId('draft-finish'));
    expect(screen.getByTestId('project-name')).toHaveTextContent('新建旋律');
    expect(screen.getAllByTestId('candidate').length).toBeGreaterThan(0);
  });
});
