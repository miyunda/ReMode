// `pnpm --filter @remode/web screenshots` → docs/screenshots/m2a/ (not part of the suite).
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { FIXTURES, expect, loadExample, open, test, useSourceMode } from './fixtures';

const OUT = join(import.meta.dirname, '../../../docs/screenshots/m2a');

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

    // Import: multi-track MIDI with track list, import warning and validation.
    await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'type0-multichannel.mid'));
    await page.getByLabel(/选择 track-0/).check();
    await expect(page.getByTestId('candidate').first()).toBeVisible();
    await shot('import', page.locator('#source-title'));

    // Analysis: the jianpu example (MISSING_DEGREES) with a manual source mode.
    await loadExample(page);
    await useSourceMode(page, 'Ionian');
    await shot('analysis', page.locator('#analysis-title'));

    // Diff: strict C Dorian with re-check and per-note table.
    await page.getByRole('button', { name: '生成 Strict' }).click();
    await expect(page.getByTestId('diff-table')).toBeVisible();
    await shot('diff', page.locator('#inspector-title'));
  });
}
