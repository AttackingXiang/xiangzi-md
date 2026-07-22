import { defineConfig, devices } from '@playwright/test'

// Browser regression suite for interactions vitest's node-environment tests
// (vitest.config.ts) cannot exercise: real caret/selection/scroll behaviour
// needs an actual DOM and trusted input events, which Playwright's
// page.keyboard/page.mouse provide and jsdom-less Node tests cannot.
//
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
      use: {
        ...devices['Desktop Chrome'],
        // Local development can reuse an installed Chrome with
        // PLAYWRIGHT_CHANNEL=chrome; CI installs Playwright Chromium explicitly.
        channel: process.env.PLAYWRIGHT_CHANNEL,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
