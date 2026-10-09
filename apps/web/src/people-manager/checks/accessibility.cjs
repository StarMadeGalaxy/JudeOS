// Optional independent axe installation; no shared dependency or lockfile changes.
const {
  chromium,
} = require("../../../../../api/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const path = require("node:path");
if (!process.env.AXE_CORE_PATH)
  throw new Error(
    "Set AXE_CORE_PATH to an installed axe-core/axe.min.js (see README).",
  );
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.JUDEOS_CHROMIUM_PATH || "/usr/bin/chromium",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 850 },
    });
    await page.goto(
      process.env.PEOPLE_MANAGER_A11Y_URL ||
        "http://127.0.0.1:5178/src/people-manager/preview.html",
    );
    await page
      .getByRole("button", { name: /Открыть карточку/ })
      .first()
      .waitFor();
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
    await check("mobile list");
    await page.getByRole("button", { name: "+ Новый человек" }).click();
    await check("person form");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Спортсмены", exact: true }).click();
    await page
      .getByRole("button", { name: /Открыть карточку/ })
      .first()
      .click();
    await check("representatives and contact");
    await page
      .getByRole("button", { name: "Проверить представительство" })
      .click();
    await page.getByRole("radio").first().waitFor();
    await check("representative form");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Семьи", exact: true }).click();
    await page
      .getByRole("button", { name: /Открыть карточку/ })
      .first()
      .click();
    await check("family periods");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
