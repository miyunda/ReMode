import { readFileSync } from 'node:fs';
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Headers from `public/_headers` (served by Workers static assets) for the
 * `/*` rule, so `vite preview` and the E2E suite run under the production CSP.
 */
function pagesHeaders(): Record<string, string> {
  const text = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  const headers: Record<string, string> = {};
  let inRoot = false;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inRoot = line.trim() === '/*';
      continue;
    }
    const at = line.indexOf(':');
    if (inRoot && at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Use @remode/core's TypeScript sources directly: no prebuilt dist needed.
    conditions: ['@remode/source', ...defaultClientConditions],
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  preview: {
    headers: pagesHeaders(),
  },
});
