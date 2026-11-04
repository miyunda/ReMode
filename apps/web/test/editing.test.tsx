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

describe('review fixes', () => {
  it('the note table flags a note kept outside the target scale by `preserve`, like the roll', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('简谱文本'), "1=C 4/4 | 1 2 3 #4 | 5 6 7 1' |");
    await user.click(screen.getByRole('button', { name: '分析简谱' }));
    const picker = screen.getByTestId('source-picker');
    await user.selectOptions(within(picker).getByLabelText('体系'), 'church');
    await user.selectOptions(within(picker).getByLabelText('调式'), 'ionian');
    await user.click(screen.getByRole('button', { name: '使用此来源调式' }));
    await user.selectOptions(screen.getByLabelText(/调外音策略/), 'preserve');
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    await user.click(screen.getByTestId('table-all'));
    // F#4 is unchanged (preserved), not a change, and still outside C Dorian.
    const fsharp = row('jianpu:n3');
    expect(fsharp).toHaveTextContent('未改动');
    expect(fsharp).toHaveTextContent('不在目标音阶内');
    expect(row('jianpu:n0')).not.toHaveTextContent('不在目标音阶内');
    await user.click(within(fsharp).getByRole('button'));
    expect(document.querySelector('li[data-code="OUT_OF_TARGET_SCALE"]')).not.toBeNull();
  });

  it('the draft BPM field follows undo and a later blur does not re-apply the undone value', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('new-melody'));
    const bpm = screen.getByTestId('draft-bpm');
    await user.clear(bpm);
    await user.type(bpm, '120');
    await user.tab();
    expect(bpm).toHaveValue('120');
    await user.click(screen.getByRole('button', { name: /撤销/ }));
    expect(bpm).toHaveValue('96');
    await user.click(bpm);
    await user.tab();
    expect(bpm).toHaveValue('96');
    expect(screen.getByRole('button', { name: /重做/ })).toBeEnabled();
  });

  it('the mode caption shows the name only; the scale ID is a tooltip', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '填入示例' }));
    await user.click(screen.getByRole('button', { name: '分析简谱' }));
    const caption = screen.getByTestId('target-picker-name');
    expect(caption).toHaveTextContent(/^C Dorian$/);
    expect(caption).toHaveAttribute('title', 'scaleId: dorian');
    expect(document.body.textContent).not.toMatch(/Doriandorian|五声）pentatonic/);
  });
});
