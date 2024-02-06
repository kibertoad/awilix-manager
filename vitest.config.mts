import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    environment: 'node',
    reporters: ['verbose'],
    coverage: {
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.spec.ts'],
      reporter: ['text', 'lcov'],
      all: true,
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
})
