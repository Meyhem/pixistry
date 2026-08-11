import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/chem/**/*.test.ts', 'src/sim/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/chem/**/*.ts', 'src/sim/**/*.ts'],
      exclude: ['src/chem/**/*.test.ts', 'src/sim/**/*.test.ts'],
    },
  },
});
