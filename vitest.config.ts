import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'test/**/*.test.ts'],
    // Stage 0-1 has no tests yet; corpus arrives in Stage 2, then remove this flag.
    passWithNoTests: true,
  },
});
