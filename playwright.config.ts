import { defineConfig, devices } from '@playwright/test'

// Browser regression suite for interactions vitest's node-environment tests
// (vitest.config.ts) cannot exercise: real caret/selection/scroll behaviour
// needs an actual DOM and trusted input events, which Playwright's
// page.keyboard/page.mouse provide and jsdom-less Node tests cannot.
//
// NOTE: as of this writing this suite has been written but not executed —
// see docs/ENGINEERING_CONSTRAINTS.md's "测试金字塔" section for the
// first-run instructions and current status.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Interaction-heavy specs (typing, scroll settling, reveal timing) get more
  // headroom than Playwright's 30s default, especially on a cold first run.
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
