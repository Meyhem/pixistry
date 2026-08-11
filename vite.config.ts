import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/chem/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/chem/**/*.ts'],
      exclude: ['src/chem/**/*.test.ts'],
    },
  },
});
