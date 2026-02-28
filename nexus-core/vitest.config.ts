import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    typecheck: { tsconfig: './tsconfig.test.json' },
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
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
