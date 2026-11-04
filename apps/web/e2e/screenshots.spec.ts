// `pnpm --filter @remode/web screenshots` → docs/screenshots/m2c/ (not part of the suite).
// docs/screenshots/m2a/ and m2b/ keep those sets as they were at their merges.
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, loadExample, open, test, useSourceMode } from './fixtures';

const OUT = join(import.meta.dirname, '../../../docs/screenshots/m2c');

for (const theme of ['light', 'dark'] as const) {
  test(`@screenshots ${theme}`, async ({ page, net }, info) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page, net);
    const device = info.project.name;
    const shot = async (view: string, locator: ReturnType<Page['locator']>) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -16));
      await page.screenshot({ path: join(OUT, `${device}-${theme}-${view}.png`) });
    };

    // Analysis with MISSING_DEGREES collapsed to one line.
    await loadExample(page);
    await useSourceMode(page, 'Ionian');
    await shot('analysis', page.locator('#analysis-title'));

    // Piano roll: strict C Dorian plus one manual edit (custom), the edited note selected.
    await page.getByRole('button', { name: '生成 Strict' }).click();
    await page.getByTestId('table-all').check();
    await page.locator('[data-note-id="jianpu:n2"] button').click();
    await page.getByTestId('piano-roll').focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('inspector-reason')).toContainText('DEGREE_MAPPED');
    await shot('roll', page.locator('#piano-roll-title'));
    await shot('inspector', page.locator('#note-inspector-title'));

    // Transport: paused mid-melody with a loop range and the drone on.
    await page.getByTestId('play').click();
    await expect(page.getByTestId('transport')).toHaveAttribute('data-status', 'playing');
    await page.getByTestId('play').click();
    await page.getByTestId('position-slider').fill('960');
    await page.keyboard.press('[');
    await page.getByTestId('position-slider').fill('2880');
    await page.keyboard.press(']');
    await page.getByTestId('position-slider').fill('1440');
    await expect(page.getByTestId('loop-toggle')).toHaveAttribute('aria-pressed', 'true');
    await shot('transport', page.locator('#transport-title'));

    // New-melody mode with a few notes.
    await page.getByTestId('new-melody').click();
    await page.getByTestId('draft-quantum').selectOption({ label: '四分音符' });
    await page.getByTestId('piano-roll').focus();
    for (const s of [0, 2, 2, 3, 2, -2, -3, -2, -2]) {
      await page.keyboard.press('Enter');
      for (let k = 0; k < Math.abs(s); k++)
        await page.keyboard.press(s > 0 ? 'ArrowUp' : 'ArrowDown');
    }
    await page.keyboard.press('Alt+ArrowRight');
    await shot('new-melody', page.locator('#draft-title'));
  });
}
