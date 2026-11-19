import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A separate headless process/profile; never attaches to the user's browser.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (process.platform === 'darwin' && existsSync(chrome) ? chrome : undefined);
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: [['list'], ['json', {outputFile: 'evidence/playwright-results.json'}]],
  use: {
    browserName: 'chromium', headless: true, viewport: {width: 1365, height: 900},
    launchOptions: {executablePath}, trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
});
