import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@remode/source'] },
  ssr: { resolve: { conditions: ['@remode/source'] } },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
