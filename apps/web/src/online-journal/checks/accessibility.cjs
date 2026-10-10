const {
  chromium,
} = require("../../../../../api/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");
if (!process.env.AXE_CORE_PATH)
  throw new Error("Set AXE_CORE_PATH to an installed axe-core/axe.min.js.");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.JUDEOS_CHROMIUM_PATH || "/usr/bin/chromium",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 850 },
    });
    await page.goto(
      process.env.JOURNAL_A11Y_URL ||
        "http://127.0.0.1:5179/src/online-journal/preview.html?role=manager",
    );
    await page.getByLabel("Учебная роль").selectOption("manager");
    const check = async (name) => {
      await page.addScriptTag({
        path: path.resolve(process.env.AXE_CORE_PATH),
      });
      const result = await page.evaluate(() =>
        axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
          },
        }),
      );
      assert.deepEqual(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
        name,
      );
      console.log(`${name}: axe checks pass`);
    };
    await page
      .getByRole("button", { name: "Ещё занятия", exact: true })
      .waitFor();
    await check("mobile schedule");
    await page
      .getByRole("button", { name: "Ещё занятия", exact: true })
      .click();
    await page
      .locator(".oj-session-list")
      .getByRole("button", { name: /15:00–16:00/ })
      .click();
    await page.locator("[data-oj-heading]").waitFor();
    await check("journal roster and four marks");
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-mobile.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-mobile-viewport.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await check("desktop journal");
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 850 });
    await page.getByRole("button", { name: "Добавить онлайн-гостя" }).click();
    await check("guest dialog");
    await page
      .getByRole("button", { name: "Добавить гостя", exact: true })
      .click();
    await check("guest validation");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .getByRole("button", { name: "Добавить известного участника" })
      .click();
    await page.getByRole("button", { name: "Ещё участники" }).waitFor();
    await check("known participant dialog");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .getByRole("button", { name: "Закрыть занятие", exact: true })
      .click();
    await check("closing warning");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
