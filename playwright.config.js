import { defineConfig, devices } from '@playwright/test';

// Entwicklungsumgebungen bringen teils einen anderen Chromium-Build mit als der
// hier gepinnte Playwright erwartet (und der Download-Host ist nicht überall
// erreichbar). PW_CHROMIUM_PATH zeigt dann auf das vorhandene Binary; in CI ist
// die Variable nicht gesetzt, dort gilt wie bisher der mitgelieferte Browser.
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8098',
    ...devices['Pixel 7'],
    locale: 'de-DE',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: {
    command: 'python3 -m http.server 8098',
    url: 'http://127.0.0.1:8098',
    reuseExistingServer: !process.env.CI,
  },
});
