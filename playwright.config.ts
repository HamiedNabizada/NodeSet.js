import { defineConfig } from '@playwright/test';

// End-to-end tests drive the web build in Chromium. `npm run test:e2e` builds
// it first. The companion specifications of the corpus test come from a clone
// of OPCFoundation/UA-Nodeset named in UA_NODESET; without it that test is skipped.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3120/',
    viewport: { width: 1500, height: 950 },
    // A button that never comes fails the test in seconds, not at its timeout.
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node scripts/serve-web.cjs 3120',
    url: 'http://127.0.0.1:3120/',
    reuseExistingServer: !process.env.CI,
  },
});
