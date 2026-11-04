import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// Set E2E_BASE_URL to run against an already running server (e.g. `wrangler dev`).
const external = process.env.E2E_BASE_URL;
const screenshots = !!process.env.SCREENSHOTS;

// E2E runs against the production build served by `vite preview`, which also
// sends the Cloudflare `_headers` (CSP included), see vite.config.ts.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // `pnpm screenshots` regenerates docs/screenshots/m2b; it is not part of the suite.
  ...(screenshots ? { grep: /@screenshots/ } : { grepInvert: /@screenshots/ }),
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      grep: screenshots ? /@screenshots/ : /@phone/,
    },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
