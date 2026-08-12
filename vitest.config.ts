import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    // e2e/ holds the Playwright browser regression suite (playwright.config.ts),
    // a separate runner with its own *.spec.ts files. Vitest's default include
    // pattern would otherwise pick those up too and fail outside a browser, so
    // extend (not replace) the default exclude list with it. harmonyos/ is a
    // gitignored, untracked ArkTS port with its own vitest.config.mts and its
    // own @xiangzi/models workspace package — invisible to this project's
    // resolver, so its *.test.ts files fail here with "package not found"
    // rather than running.
    exclude: [...configDefaults.exclude, 'e2e/**', 'harmonyos/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/perfMain.tsx'],
      // 棘轮：贴着实测值下方约 1.5 个点，只留 CI 环境波动的余量。设得太松等于允许覆盖率
      // 无声下滑——之前这四个数比实测低 6 点，退化 6 个点都不会有人发现。补测试之后请顺手
      // 往上抬，不要让差距重新拉开。
      // 实测（2026-08-01）：statements 40.85 / branches 36.95 / functions 33.71 / lines 42.33
      thresholds: {
        statements: 39,
        branches: 35,
        functions: 32,
        lines: 41,
      },
    },
  },
})
