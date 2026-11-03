import { join } from 'node:path';
import { test as base, expect, type Page, type Request } from '@playwright/test';

export const FIXTURES = join(import.meta.dirname, '../../../fixtures/generated');

/**
 * Every page is watched for network use and CSP violations. The app may load
 * its own static assets (same origin, before the workflow starts) and nothing
 * else: no other origin ever, and no request at all once the page has loaded.
 */
export const test = base.extend<{
  net: { requests: Request[]; markLoaded: () => void; afterLoad: () => Request[] };
}>({
  net: async ({ page }, use, testInfo) => {
    const requests: Request[] = [];
    const problems: string[] = [];
    let loadedAt = -1;
    page.on('request', (r) => requests.push(r));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await use({
      requests,
      markLoaded: () => {
        loadedAt = requests.length;
      },
      afterLoad: () => (loadedAt < 0 ? [] : requests.slice(loadedAt)),
    });
    const origin = new URL(testInfo.project.use.baseURL ?? 'http://localhost:4173').origin;
    const http = requests.filter((r) => /^https?:/.test(r.url()));
    expect(http.filter((r) => new URL(r.url()).origin !== origin).map((r) => r.url())).toEqual([]);
    if (loadedAt >= 0) {
      expect(
        requests
          .slice(loadedAt)
          .filter((r) => /^https?:/.test(r.url()))
          .map((r) => r.url()),
        'network requests after the page loaded',
      ).toEqual([]);
    }
    expect(problems, 'console errors / CSP violations').toEqual([]);
  },
});

export { expect };

export async function open(page: Page, net: { markLoaded: () => void }) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ReMode' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  net.markLoaded();
}

export async function loadExample(page: Page) {
  await page.getByRole('button', { name: '填入示例' }).click();
  await page.getByRole('button', { name: '分析简谱' }).click();
  await expect(page.getByTestId('candidate').first()).toBeVisible();
}

export async function useSourceMode(page: Page, scaleLabel: string) {
  const picker = page.getByTestId('source-picker');
  if (!(await picker.isVisible())) await page.getByText('手动指定来源调式').click();
  await picker.getByLabel('体系').selectOption('church');
  await picker.getByLabel('主音', { exact: true }).selectOption({ label: 'C' });
  await picker.getByLabel('调式').selectOption({ label: scaleLabel });
  await page.getByRole('button', { name: '使用此来源调式' }).click();
}
