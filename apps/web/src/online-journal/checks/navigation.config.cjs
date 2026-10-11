const {
  defineConfig,
} = require("../../../../../api/node_modules/@playwright/test");
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "navigation.spec.cjs",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5180",
    headless: true,
    launchOptions: {
      executablePath: process.env.JUDEOS_CHROMIUM_PATH || "/usr/bin/chromium",
    },
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5180 --strictPort",
    cwd: require("node:path").resolve(__dirname, "../../.."),
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
  },
});
