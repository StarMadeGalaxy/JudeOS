const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'swagger.spec.cjs',
  use: {
    baseURL: 'http://127.0.0.1:4173', headless: true,
    launchOptions: process.env.JUDEOS_CHROMIUM_PATH ? { executablePath: process.env.JUDEOS_CHROMIUM_PATH } : {},
  },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
