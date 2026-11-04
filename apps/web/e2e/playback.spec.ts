// M2c: real Tone.js in headless Chromium under the production CSP. These assert
// transport state and the absence of errors (the `net` fixture fails any test
// with a console error, a CSP violation or a network request after load). They
// cannot tell how it sounds: that is the human listening check in the PR.
import { readFileSync } from 'node:fs';
import { importMidi, parseJianpu } from '@remode/core';
import { JIANPU_EXAMPLE } from '../src/components/ImportPanel';
import { expect, loadExample, open, test, useSourceMode } from './fixtures';
import type { Page } from '@playwright/test';

const transport = (page: Page) => page.getByTestId('transport');
const expectStatus = (page: Page, status: string) =>
  expect(transport(page)).toHaveAttribute('data-status', status);
const tick = async (page: Page) =>
  Number(await page.getByTestId('transport-position').getAttribute('data-tick'));
const advancing = (page: Page, from: number) =>
  expect.poll(() => tick(page), { timeout: 5000 }).toBeGreaterThan(from);

test('play, switch variant, loop, stop, drone: one transport, no errors', async ({ page, net }) => {
  await open(page, net);
  await loadExample(page);
  await useSourceMode(page, 'Ionian');
  await page.getByRole('button', { name: '生成 Strict' }).click();
  await expect(page.getByTestId('view-generated')).toHaveAttribute('aria-checked', 'true');

  // Play: the position advances on the audio clock, the playhead follows, the drone is on.
  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await expect(transport(page)).toHaveAttribute('data-drone', '48');
  await advancing(page, 100);
  await expect(page.getByTestId('playhead')).toBeVisible();
  await expect
    .poll(async () => Number(await page.getByTestId('playhead').getAttribute('data-tick')))
    .toBeGreaterThan(100);

  // Switching variant keeps the position and keeps playing.
  // Sampled inside the page: a Playwright round trip takes longer than a beat under load.
  const [before, after] = await page.evaluate(async () => {
    const frame = () => new Promise(requestAnimationFrame);
    const read = () =>
      Number(
        document.querySelector<HTMLElement>('[data-testid="transport-position"]')?.dataset['tick'],
      );
    await frame();
    const first = read();
    document.querySelector<HTMLElement>('[data-testid="view-original"]')?.click();
    await frame();
    await frame();
    return [first, read()] as const;
  });
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after - before).toBeLessThan(480);
  await expectStatus(page, 'playing');
  await expect(page.getByTestId('transport-status')).toContainText('原曲');
  await advancing(page, after);
  await page.getByTestId('view-generated').click();
  await expectStatus(page, 'playing');

  // Space after a mouse click on a tab pauses instead of pressing that tab again.
  await page.keyboard.press('Space');
  await expectStatus(page, 'paused');
  await expect(transport(page)).toHaveAttribute('data-drone', '');
  const paused = await tick(page);
  await page.waitForTimeout(200);
  expect(await tick(page)).toBe(paused);
  await page.keyboard.press('Space');
  await expectStatus(page, 'playing');
  await advancing(page, paused);

  // The drone follows the variant's tonic and its mode applies while playing.
  await page.getByTestId('drone-mode').selectOption({ label: '主音 + 五度' });
  await expect(transport(page)).toHaveAttribute('data-drone', '48,55');
  await page.getByTestId('drone-toggle').uncheck();
  await expect(transport(page)).toHaveAttribute('data-drone', '');
  await page.getByTestId('drone-toggle').check();
  await expect(transport(page)).toHaveAttribute('data-drone', '48,55');

  // Stop rewinds.
  await page.getByTestId('stop').click();
  await expectStatus(page, 'stopped');
  await expect(transport(page)).toHaveAttribute('data-drone', '');
  await expect.poll(() => tick(page)).toBe(0);

  // Loop: the first bar (L, with [ and ] at the seeked positions), over and over.
  await page.getByTestId('loop-toggle').click();
  await expect(transport(page)).toHaveAttribute('data-loop', 'on');
  await page.getByTestId('position-slider').fill('480');
  await expect.poll(() => tick(page)).toBe(480);
  await page.keyboard.press('[');
  await page.getByTestId('position-slider').fill('1440');
  await expect.poll(() => tick(page)).toBe(1440);
  await page.keyboard.press(']');
  await expect(page.getByTestId('loop-range')).toContainText('1.2 – 1.4');
  await page.getByTestId('position-slider').fill('480');
  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await expect.poll(() => tick(page), { timeout: 5000 }).toBeGreaterThan(1200);
  // 96 BPM: the range lasts 1.25 s, and the position must come back round.
  await expect.poll(() => tick(page), { timeout: 5000 }).toBeLessThan(800);
  await expectStatus(page, 'playing');
  await page.getByTestId('loop-clear').click();
  await expect(transport(page)).toHaveAttribute('data-loop', 'off');
  await page.getByTestId('stop').click();

  // The drone is playback only: the exported melody is exactly the Strict notes.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download').click(),
  ]);
  const parsed = importMidi(new Uint8Array(readFileSync(await download.path())));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const source = parseJianpu(JIANPU_EXAMPLE);
  if (!source.ok) throw new Error('example does not parse');
  expect(parsed.midi.tracks.filter((t) => t.noteCount > 0)).toHaveLength(1);
  expect(parsed.midi.tracks[0]!.notes).toHaveLength(source.notes.length);
});

test('ruler: a click seeks, a drag loops, and the melody finishes by itself', async ({
  page,
  net,
}) => {
  await open(page, net);
  await page.getByLabel('简谱文本').fill('1=C 4/4 bpm=300 | 1 2 3 5 |');
  await page.getByRole('button', { name: '分析简谱' }).click();
  await expect(page.getByTestId('candidate').first()).toBeVisible();
  const box = (await page.getByTestId('piano-roll').boundingBox())!;
  const atTick = async (t: number) => {
    const px = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="piano-roll"]') as HTMLElement;
      return (r.firstElementChild as HTMLElement).clientWidth;
    });
    // Fitted to the box: GUTTER (64) + ticks × px per tick.
    return box.x + 64 + (t * (px - 64)) / 2400;
  };
  await page.mouse.click(await atTick(960), box.y + 8);
  await expect.poll(() => tick(page)).toBeGreaterThan(800);
  await expect(page.getByTestId('playhead')).toBeVisible();

  await page.mouse.move(await atTick(480), box.y + 8);
  await page.mouse.down();
  await page.mouse.move(await atTick(1440), box.y + 8, { steps: 4 });
  await page.mouse.up();
  await expect(transport(page)).toHaveAttribute('data-loop', 'on');
  await page.getByTestId('loop-clear').click();

  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await expectStatus(page, 'stopped'); // 0.8 s of music: it ends and rewinds
  await expect.poll(() => tick(page)).toBe(0);
});

test('audition: note, gutter, ↑/↓, mute during playback, the toggle persists', async ({
  page,
  net,
}) => {
  await open(page, net);
  await loadExample(page);
  const last = page.getByTestId('audition-last');
  await expect(last).toHaveAttribute('data-seq', '0');

  // The very first gesture of the session is a note click: it unlocks audio and still sounds.
  await page.getByTestId('table-all').check();
  await page.locator('[data-note-id="jianpu:n1"] button').click();
  await expect(last).toHaveAttribute('data-seq', '1');
  await expect(last).toHaveAttribute('data-pitch', '64');

  const roll = page.getByTestId('piano-roll');
  await roll.focus();
  await page.keyboard.press('ArrowRight');
  await expect(last).toHaveAttribute('data-seq', '2');
  await page.keyboard.press('ArrowUp');
  await expect(last).toHaveAttribute('data-seq', '3');

  const box = (await roll.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(last).toHaveAttribute('data-seq', '4');

  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await roll.focus();
  await page.keyboard.press('ArrowRight');
  await expect(last).toHaveAttribute('data-seq', '4');
  await expect(last).toContainText('自动静音');
  await page.getByTestId('stop').click();

  await page.getByTestId('audition-toggle').uncheck();
  await roll.focus();
  await page.keyboard.press('ArrowRight');
  await expect(last).toHaveAttribute('data-seq', '4');
  await page.reload();
  await page.waitForLoadState('networkidle');
  net.markLoaded();
  await expect(page.getByTestId('audition-toggle')).not.toBeChecked();
  await page.getByTestId('audition-toggle').check();
});

test('Space does not start playback while typing, and pressing it on a focused button clicks once', async ({
  page,
  net,
}) => {
  await open(page, net);
  await loadExample(page);
  const box = page.getByLabel('简谱文本');
  await box.focus();
  await page.keyboard.press('Space');
  await expectStatus(page, 'stopped');

  // Keyboard user: Tab to the play button, Space activates it exactly once.
  await page.getByTestId('play').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expectStatus(page, 'playing');
  await page.keyboard.press('Space');
  await expectStatus(page, 'paused');

  // A mouse click leaves focus on the button: Space must not toggle twice.
  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await page.keyboard.press('Space');
  await expectStatus(page, 'paused');
});

test('new-melody mode: audition and playback of an unfinished draft', async ({ page, net }) => {
  await open(page, net);
  await page.getByTestId('new-melody').click();
  const last = page.getByTestId('audition-last');
  await expect(page.getByTestId('play')).toBeDisabled();
  await page.getByTestId('draft-quantum').selectOption({ label: '四分音符' });
  const roll = page.getByTestId('piano-roll');
  await roll.focus();
  for (const s of [0, 2, 2, 1]) {
    await page.keyboard.press('Enter');
    for (let k = 0; k < s; k++) await page.keyboard.press('ArrowUp');
  }
  await expect(page.getByTestId('draft-count')).toContainText('4 个音');
  await expect(last).toHaveAttribute('data-seq', '9');

  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await expect(page.getByTestId('transport-status')).toContainText('新建旋律草稿');
  await expect(transport(page)).toHaveAttribute('data-drone', '48');
  await advancing(page, 100);

  // Editing while it plays keeps the transport going.
  await page.getByTestId('draft-quantum').selectOption({ label: '八分音符' });
  await expectStatus(page, 'playing');
  await page.keyboard.press('Space');
  await expectStatus(page, 'paused');

  // Finishing makes it the Original: a new melody, so the transport rewinds.
  await page.getByTestId('draft-finish').click();
  await expectStatus(page, 'stopped');
  await expect.poll(() => tick(page)).toBe(0);
  await page.getByTestId('play').click();
  await expectStatus(page, 'playing');
  await advancing(page, 100);
});

test('@phone transport fits the screen and plays by touch', async ({ page, net }, info) => {
  await open(page, net);
  await loadExample(page);
  await useSourceMode(page, 'Ionian');
  const press = (id: string) =>
    info.project.name === 'phone' ? page.getByTestId(id).tap() : page.getByTestId(id).click();
  await press('play');
  await expectStatus(page, 'playing');
  await advancing(page, 50);
  await press('stop');
  await expectStatus(page, 'stopped');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
