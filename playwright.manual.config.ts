import { defineConfig } from '@playwright/test';

// The screenshots of the user manual (docs/manual.md): the web build in
// Chromium, in English and in the light theme, written to docs/manual/.
// `npm run manual:shots` builds it first. A port of its own, so it does not
// meet the server of the end-to-end tests.
export default defineConfig({
  testDir: 'tests/manual',
  timeout: 300_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3121/',
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    colorScheme: 'light',
    actionTimeout: 15_000,
    // Date fields follow the language of the browser itself, not the page's locale.
    launchOptions: { args: ['--lang=en-US'] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node scripts/serve-web.cjs 3121',
    url: 'http://127.0.0.1:3121/',
    reuseExistingServer: !process.env.CI,
  },
});
