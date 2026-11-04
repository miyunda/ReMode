import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importMidi, parseJianpu } from '@remode/core';
import { JIANPU_EXAMPLE } from '../src/components/ImportPanel';
import { FIXTURES, expect, loadExample, open, test, useSourceMode } from './fixtures';

test('jianpu example → analysis → manual source → C Dorian → MIDI with identical ticks', async ({
  page,
  net,
}) => {
  await open(page, net);
  await loadExample(page);

  // Candidates with named evidence, ambiguity codes, version; nothing that looks like a confidence.
  const first = page.getByTestId('candidate').first();
  await expect(first).toContainText('C 宫调式（C 宫系统，五声）');
  await expect(first).toContainText('FINAL_NOTE');
  await expect(page.getByTestId('ambiguities')).toContainText('MISSING_DEGREES');
  await expect(page.getByTestId('analysis-version')).toContainText('remode-mode-2step/');
  await expect(page.locator('body')).not.toContainText('%');

  // Manual source mode overrides detection and is labelled as such.
  await useSourceMode(page, 'Ionian');
  const effective = page.getByTestId('effective-source-mode');
  await expect(effective).toContainText('C Ionian');
  await expect(effective).toContainText('手动指定');

  // Target: same tonic, Dorian (the default target).
  await expect(page.getByTestId('target-picker-name')).toContainText('C Dorian');
  await page.getByRole('button', { name: '生成 Strict' }).click();
  await expect(page.getByTestId('changed-count')).toHaveText('5');
  await expect(page.getByTestId('diff-table').locator('tbody tr')).toHaveCount(5);
  await expect(page.getByTestId('recheck')).toContainText('C Dorian');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('melody-C-dorian-strict.mid');
  const bytes = new Uint8Array(readFileSync(await download.path()));

  const parsed = importMidi(bytes);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const source = parseJianpu(JIANPU_EXAMPLE);
  if (!source.ok) throw new Error('example does not parse');
  const notes = parsed.midi.tracks[0]!.notes;
  expect(parsed.midi.metadata.ppq).toBe(source.metadata.ppq);
  expect(notes.map((n) => [n.startTick, n.durationTick])).toEqual(
    source.notes.map((n) => [n.startTick, n.durationTick]),
  );
  // Only E (64) → Eb (63) changes.
  expect(notes.map((n) => n.pitch)).toEqual(
    source.notes.map((n) => (n.pitch === 64 ? 63 : n.pitch)),
  );
  expect(parsed.midi.metadata.keySignatures).toEqual([{ tick: 0, key: 'Bb', scale: 'major' }]);

  await expect(page.getByTestId('export-result')).toContainText('melody-C-dorian-strict.mid');
});

test('uploading a generated fixture .mid analyses it', async ({ page, net }) => {
  await open(page, net);
  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'mode-church-c-dorian.mid'));
  await expect(page.getByTestId('project-name')).toContainText('mode-church-c-dorian.mid');
  await expect(page.getByTestId('track-list')).toContainText('track-0');
  await expect(page.getByTestId('candidate').first()).toContainText('C Dorian');
  await expect(page.getByTestId('effective-source-mode')).toContainText('自动识别');
});

test('a malformed file shows a structured error', async ({ page, net }) => {
  await open(page, net);
  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'malformed-not-midi.mid'));
  const failure = page.getByTestId('load-failure');
  await expect(failure).toContainText('MIDI 解析失败');
  await expect(failure).toContainText('NOT_MIDI');
  await expect(failure).toContainText('不是标准 MIDI 文件');

  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'malformed-truncated.mid'));
  await expect(page.getByTestId('load-failure')).toContainText('TRUNCATED');
  await expect(page.getByTestId('candidate')).toHaveCount(0);
});

test('multi-track MIDI needs an explicit track choice', async ({ page, net }) => {
  await open(page, net);
  await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'type0-multichannel.mid'));
  await expect(page.getByText('文件含多条候选轨，请选择要处理的一条旋律轨。')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成 Strict' })).toBeDisabled();
  await page.getByLabel(/选择 track-0/).check();
  await expect(page.getByTestId('candidate').first()).toContainText('D Dorian');
});

test('jianpu errors show line and column', async ({ page, net }) => {
  await open(page, net);
  await page.getByLabel('简谱文本').fill('1=C 4/4\n| 1 2 |: 3 4 :|');
  await page.getByRole('button', { name: '分析简谱' }).click();
  const failure = page.getByTestId('load-failure');
  await expect(failure).toContainText('UNSUPPORTED_REPEAT');
  await expect(failure).toContainText('第 2 行，第 7 列');
});

test('theme: manual choice persists across reloads', async ({ page, net }) => {
  await open(page, net);
  await page.getByTestId('theme-select').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.waitForLoadState('networkidle');
  net.markLoaded();
  // Applied by theme-init.js before the app renders.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('theme-select')).toHaveValue('dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(25, 23, 36)');
});

test('keyboard: skip link and visible focus', async ({ page, net }) => {
  await open(page, net);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: '跳到主要内容' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return getComputedStyle(el).outlineStyle;
  });
  expect(outline).toBe('solid');
});

test('@phone layout has no horizontal scroll through the workflow', async ({ page, net }) => {
  await open(page, net);
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noOverflow()).toBe(true);
  await loadExample(page);
  await useSourceMode(page, 'Ionian');
  await page.getByRole('button', { name: '生成 Strict' }).click();
  await expect(page.getByTestId('diff-table')).toBeVisible();
  // The roll scrolls inside its own box; touch selects, the inspector edits.
  const roll = page.getByTestId('piano-roll');
  const rollBox = (await roll.boundingBox())!;
  expect(rollBox.x + rollBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await roll.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await page.locator('[data-note-id="jianpu:n1"] button').click();
  await page.getByTestId('inspector-up').click();
  await expect(page.getByTestId('inspector-pitch')).toContainText('E4 → F4');
  await page.getByTestId('table-all').check();
  for (const d of await page.locator('details').all())
    await d.evaluate((e) => ((e as HTMLDetailsElement).open = true));
  expect(await noOverflow()).toBe(true);

  await page.getByTestId('new-melody').click();
  await expect(page.getByTestId('piano-roll')).toBeVisible();
  expect(await noOverflow()).toBe(true);
});
