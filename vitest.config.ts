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
      reporter: ['text', 'html'],
    },
  },
})
