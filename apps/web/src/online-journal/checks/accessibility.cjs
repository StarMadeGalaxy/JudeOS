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
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByLabel("Учебная роль").selectOption("administrator");
    await page
      .getByRole("button", { name: "Ещё занятия", exact: true })
      .click();
    await page
      .locator(".oj-session-list")
      .getByRole("button", { name: /15:00–16:00/ })
      .click();
    await page.locator("[data-oj-heading]").waitFor();
    await check("administrator journal");
    await page
      .getByRole("button", { name: "Изменить дату и время", exact: true })
      .click();
    await check("time configuration");
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-time-mobile.png"),
    });
    await page.getByLabel("Дата окончания", { exact: true }).fill("2026-10-10");
    await page.getByLabel("Время окончания", { exact: true }).fill("14:00");
    await page.getByRole("button", { name: "Сохранить дату и время" }).click();
    await check("time interval validation");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .getByRole("button", { name: "Назначить тренеров", exact: true })
      .click();
    await page.getByRole("checkbox", { name: /synthetic_coach_a/ }).waitFor();
    await check("coach assignment form");
    await page.getByText("История назначений", { exact: true }).click();
    await check("coach assignment history");
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-coaches-mobile.png"),
    });
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .getByRole("button", { name: "Отменить занятие", exact: true })
      .click();
    await check("cancel confirmation");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .locator(".oj-session-list")
      .getByRole("button", { name: /10:00–11:00/ })
      .click();
    await page
      .getByRole("button", { name: "Отозвать доступ тренера", exact: true })
      .click();
    await page.getByRole("checkbox", { name: /synthetic_coach_a/ }).waitFor();
    await check("closed-session revocation");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page
      .locator(".oj-session-list")
      .getByRole("button", { name: /15:00–16:00/ })
      .click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("button", { name: "Изменить дату и время", exact: true })
      .click();
    await check("desktop time configuration");
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-time-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200% !important }" });
    await check("enlarged time configuration");
    await page.screenshot({
      path: path.resolve(__dirname, "../dist/journal-time-enlarged-top.png"),
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
