import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8098',
    ...devices['Pixel 7'],
    locale: 'de-DE',
  },
  webServer: {
    command: 'python3 -m http.server 8098',
    url: 'http://127.0.0.1:8098',
    reuseExistingServer: !process.env.CI,
  },
});
