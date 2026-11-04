// M2b: piano roll selection, the inspector, manual editing, undo/redo,
// custom MIDI download and new-melody mode.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importMidi, parseJianpu } from '@remode/core';
import { JIANPU_EXAMPLE } from '../src/components/ImportPanel';
import { FIXTURES, expect, loadExample, open, test, useSourceMode } from './fixtures';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('select a changed note, edit it with the keyboard, undo/redo, download custom MIDI', async ({
  page,
  net,
}) => {
  await open(page, net);
  await loadExample(page);
  await useSourceMode(page, 'Ionian');
  await page.getByRole('button', { name: '生成 Strict' }).click();
  await expect(page.getByTestId('view-generated')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('changed-count')).toHaveText('5');

  // Select the changed E4 (jianpu:n1) from the synchronized note table.
  await page.locator('[data-note-id="jianpu:n1"] button').click();
  const roll = page.getByTestId('piano-roll');
  await expect(roll).toHaveAttribute('data-selected', 'jianpu:n1');
  const inspector = page.getByTestId('note-inspector');
  await expect(inspector).toContainText('jianpu:n1');
  await expect(inspector).toContainText('1.2');
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → Eb4');
  await expect(page.getByTestId('inspector-reason')).toContainText('DEGREE_MAPPED');
  await expect(inspector).toContainText('♭3');

  // Keyboard: → selects the next note, ← comes back; ↑ moves Eb4 one Dorian step up to F4.
  await roll.focus();
  await page.keyboard.press('ArrowRight');
  await expect(roll).toHaveAttribute('data-selected', 'jianpu:n2');
  await page.keyboard.press('ArrowLeft');
  await expect(roll).toHaveAttribute('data-selected', 'jianpu:n1');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('view-custom')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');
  await expect(page.getByTestId('inspector-reason')).toContainText('MANUAL_EDIT');
  await expect(page.getByTestId('changed-count')).toHaveText('5');
  await expect(page.getByTestId('custom-summary')).toContainText('基于Strict，1 次手动修改');

  // Undo / redo with the keyboard and the buttons.
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByTestId('view-generated')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → Eb4');
  await page.keyboard.press(`Shift+${mod}+z`);
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → Eb4');
  await page.getByTestId('redo').click();
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');

  // Snapping off: a semitone step can leave the target scale and is flagged.
  await page.getByTestId('snap-toggle').uncheck();
  await expect(page.getByTestId('snap-off-warning')).toBeVisible();
  await roll.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F#4');
  await expect(page.locator('li[data-code="OUT_OF_TARGET_SCALE"]')).toBeVisible();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('melody-C-dorian-custom.mid');
  const parsed = importMidi(new Uint8Array(readFileSync(await download.path())));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const source = parseJianpu(JIANPU_EXAMPLE);
  if (!source.ok) throw new Error('example does not parse');
  const notes = parsed.midi.tracks[0]!.notes;
  // Ticks identical; strict's E → Eb everywhere except the edited note, now F4.
  expect(notes.map((n) => [n.startTick, n.durationTick])).toEqual(
    source.notes.map((n) => [n.startTick, n.durationTick]),
  );
  expect(notes.map((n) => n.pitch)).toEqual(
    source.notes.map((n, i) => (i === 1 ? 65 : n.pitch === 64 ? 63 : n.pitch)),
  );

  // Revert this note from the inspector.
  await page.getByTestId('revert-note').click();
  await expect(page.getByTestId('inspector-pitch')).toHaveText('E4 → E4');
  await expect(page.getByTestId('inspector-reason')).toContainText('未改动');
  await expect(page.getByTestId('changed-count')).toHaveText('4');

  // 恢复原样: custom equals the original.
  await page.getByTestId('restore-original').click();
  await expect(page.getByTestId('changed-count')).toHaveText('0');
  await expect(page.getByTestId('custom-summary')).toContainText('基于原曲');
});

test('new-melody mode: draw a melody, analyse it and generate', async ({ page, net }) => {
  await open(page, net);
  await page.getByTestId('new-melody').click();
  await expect(page.getByTestId('project-name')).toContainText('新建旋律');
  const roll = page.getByTestId('piano-roll');
  await expect(roll).toBeVisible();

  // A mouse click on the empty grid adds a note.
  const box = (await roll.boundingBox())!;
  await page.mouse.click(box.x + 90, box.y + box.height / 2);
  await expect(page.getByTestId('draft-count')).toContainText('1 个音');
  await page.getByTestId('draft-delete').click();
  await expect(page.getByTestId('draft-count')).toContainText('0 个音');

  // Keyboard: Enter adds a note after the selection, ↑/↓ change pitch by a semitone.
  // C D E G A G E D C, quarter-note grid.
  await page.getByTestId('draft-quantum').selectOption({ label: '四分音符' });
  await roll.focus();
  const steps = [0, 2, 2, 3, 2, -2, -3, -2, -2];
  for (const s of steps) {
    await page.keyboard.press('Enter');
    for (let k = 0; k < Math.abs(s); k++)
      await page.keyboard.press(s > 0 ? 'ArrowUp' : 'ArrowDown');
  }
  await expect(page.getByTestId('draft-count')).toContainText('9 个音');
  // Make the last note a half note.
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByTestId('draft-selection')).toContainText('时值 2 拍');

  await page.getByTestId('draft-jianpu').click();
  await expect(page.getByTestId('draft-jianpu-result')).toContainText(
    '1=C 4/4 bpm=96\n| 1 2 3 5 | 6 5 3 2 | 1 - |',
  );

  // Undo the lengthening, redo it.
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByTestId('draft-selection')).toContainText('时值 1 拍');
  await page.keyboard.press(`Shift+${mod}+z`);
  await expect(page.getByTestId('draft-selection')).toContainText('时值 2 拍');

  await page.getByTestId('draft-finish').click();
  await expect(page.getByTestId('candidate').first()).toContainText('C 宫调式');
  await expect(page.getByTestId('ambiguity-collapsed')).toContainText('展开');
  await page.getByRole('button', { name: '生成 Strict' }).click();
  await expect(page.getByTestId('view-generated')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('recheck')).toBeVisible();
  // The finished draft is the immutable Original: 9 notes with new: IDs.
  await page.getByTestId('table-all').check();
  await expect(page.getByTestId('diff-table').locator('tbody tr')).toHaveCount(9);
  await expect(page.getByTestId('diff-table')).toContainText('new:n8');
});

test('replacing a project is undoable; a bad file never replaces it', async ({ page, net }) => {
  await open(page, net);
  await loadExample(page);
  await useSourceMode(page, 'Ionian');
  await page.getByRole('button', { name: '生成 Strict' }).click();
  await page.locator('[data-note-id="jianpu:n1"] button').click();
  await page.getByTestId('inspector-up').click();
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');

  // A malformed file shows its error and leaves the edited project alone.
  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'malformed-not-midi.mid'));
  await expect(page.getByTestId('load-failure')).toContainText('NOT_MIDI');
  await expect(page.getByTestId('view-custom')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');

  // 新建旋律 replaces it; one undo brings back original, Strict and the custom edit.
  await page.getByTestId('new-melody').click();
  await expect(page.getByTestId('draft-finish')).toBeVisible();
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByTestId('view-custom')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('changed-count')).toHaveText('5');
  await page.locator('[data-note-id="jianpu:n1"] button').click();
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');
  await expect(page.getByTestId('view-generated')).toBeEnabled();
});
