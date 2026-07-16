import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    // e2e/ holds the Playwright browser regression suite (playwright.config.ts),
    // a separate runner with its own *.spec.ts files. Vitest's default include
    // pattern would otherwise pick those up too and fail outside a browser, so
    // extend (not replace) the default exclude list with it.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/perfMain.tsx'],
      thresholds: {
        statements: 32,
        branches: 30,
        functions: 25,
        lines: 33,
      },
    },
  },
})
