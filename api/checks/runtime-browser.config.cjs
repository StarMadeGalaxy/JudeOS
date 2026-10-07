const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'runtime-browser.spec.cjs',
  use: { baseURL: process.env.JUDEOS_BASE_URL || 'http://127.0.0.1:8080', headless:true,
    launchOptions:process.env.JUDEOS_CHROMIUM_PATH ? {executablePath:process.env.JUDEOS_CHROMIUM_PATH} : {} }
});
