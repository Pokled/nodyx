import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/scripts/**',
        'src/migrations/**',
        'src/tests/**',
        'src/fortunes.ts',
      ],
    },
  },
})
