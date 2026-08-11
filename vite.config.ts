import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: 'node',
    include: ['src/sim/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/sim/**/*.ts'],
      exclude: ['src/sim/**/*.test.ts'],
    },
  },
});
