const {
  defineConfig,
} = require("../../../../../api/node_modules/@playwright/test");
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "people-manager.spec.cjs",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5178",
    headless: true,
    launchOptions: {
      executablePath: process.env.JUDEOS_CHROMIUM_PATH || "/usr/bin/chromium",
    },
  },
  webServer: {
    command: "npm --prefix apps/web run dev -- --port 5178",
    cwd: require("node:path").resolve(__dirname, "../../../../.."),
    url: "http://127.0.0.1:5178/src/people-manager/preview.html",
    reuseExistingServer: true,
  },
});
