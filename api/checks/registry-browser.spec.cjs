const fs = require("node:fs");
const { test, expect } = require("@playwright/test");
const password = "synthetic-browser-password-27";
test("real HTTPS registry, network setup, owner and platform panels", async ({
  page,
  browser,
  baseURL,
}) => {
  const file = process.env.JUDEOS_REGISTRY_FIXTURE_FILE;
  test.skip(!file, "requires disposable Go HTTPS/PostgreSQL fixture");
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#token=" + fixture.link.token);
  await page.getByLabel("Новый пароль").fill(password);
  await page
    .getByRole("button", { name: "Установить пароль", exact: true })
    .click();
  await page.getByLabel("Логин", { exact: true }).fill(fixture.login);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const registry = page.getByLabel("Реестр клуба");
  await expect(
    registry.getByRole("heading", { name: "Реестр клуба", exact: true }),
  ).toBeVisible();
  let lost = false,
    savedOperation;
  await page.route("**/people", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      savedOperation = route.request().postDataJSON().operation_id;
      lost = true;
      const res = await route.fetch();
      expect(res.status()).toBe(201);
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  for (const name of ["Синтетический ребёнок", "Синтетический представитель"]) {
    await registry.getByLabel("Отображаемое имя", { exact: true }).fill(name);
    await registry.getByLabel("Телефон (необязательно)").fill("+375000000027");
    await registry
      .getByRole("button", { name: "Добавить человека", exact: true })
      .click();
    if (name === "Синтетический ребёнок") {
      await expect(
        registry.getByRole("button", { name: "Повторить сохранённую команду" }),
      ).toBeVisible();
      const repeated = page.waitForRequest(
        (r) =>
          r.method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/people"),
      );
      await registry
        .getByRole("button", { name: "Повторить сохранённую команду" })
        .click();
      expect((await repeated).postDataJSON().operation_id).toBe(savedOperation);
      await page.unroute("**/people");
    }

    await expect(
      registry.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await registry.getByRole("button", { name: "Закрыть карточку" }).click();
  }
  await registry
    .getByRole("button", { name: /Синтетический ребёнок · №/ })
    .click();
  await registry
    .getByRole("button", { name: "Записать как спортсмена" })
    .click();
  await expect(
    registry.getByRole("heading", { name: "Проверенные представители" }),
  ).toBeVisible();
  const representative = registry.getByLabel("Выбрать человека");
  await expect(representative.locator("option")).toHaveCount(3);
  const value = await representative
    .locator("option")
    .filter({ hasText: "Синтетический представитель" })
    .getAttribute("value");
  await representative.selectOption(value);
  page.once("dialog", (d) => d.accept());
  await registry
    .getByRole("button", { name: "Подтвердить проверенную связь" })
    .click();
  await expect(
    registry.getByRole("button", { name: "Выбрать основным контактом" }),
  ).toBeVisible();
  await registry
    .getByRole("button", { name: "Выбрать основным контактом" })
    .click();
  await expect(
    registry.getByText("Основной контакт:", { exact: false }),
  ).toContainText("Синтетический представитель");
  page.once("dialog", (d) => d.accept());
  await registry
    .getByRole("button", { name: "Отозвать связь", exact: true })
    .click();
  await expect(
    registry.getByText("Основной контакт:", { exact: false }),
  ).toContainText("не выбран");
  await registry.getByRole("button", { name: "Закрыть карточку" }).click();
  await registry.getByRole("button", { name: "Семьи", exact: true }).click();
  await registry
    .getByLabel("Название семьи", { exact: true })
    .fill("Синтетическая семья браузера");
  await registry
    .getByRole("button", { name: "Добавить семью", exact: true })
    .click();
  await expect(
    registry.getByRole("heading", {
      name: "Синтетическая семья браузера",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    registry.getByLabel("Выбрать человека").locator("option"),
  ).toHaveCount(3);
  await registry.getByLabel("Выбрать человека").selectOption(value);
  await registry.getByRole("button", { name: "Добавить члена семьи" }).click();
  await expect(
    registry
      .locator("article > ul > li")
      .filter({ hasText: "Синтетический представитель" }),
  ).toBeVisible();
  await registry.getByRole("button", { name: "Закрыть карточку" }).click();
  await registry.getByRole("button", { name: "Люди", exact: true }).click();
  await registry
    .getByRole("button", { name: /Синтетический представитель · №/ })
    .click();
  page.once("dialog", (d) => d.accept());
  await registry.getByRole("button", { name: "Архивировать человека" }).click();
  await expect(
    registry.getByRole("heading", {
      name: "Синтетический представитель · Архив",
      exact: true,
    }),
  ).toBeVisible();
  const networkName = "Синтетическая сеть браузера " + fixture.tenant.slice(-6);
  const network = page.getByLabel("Настройки сети");
  await network.getByLabel("Название новой сети").fill(networkName);
  await network
    .getByRole("button", { name: "Создать сеть", exact: true })
    .click();
  await expect(
    network.getByRole("heading", { name: "Клубы сети" }),
  ).toBeVisible();
  await network
    .getByLabel("Название нового клуба")
    .fill("Синтетический второй клуб браузера");
  await network.getByLabel("Адрес нового клуба").fill("Тестовая улица, 27");
  await network
    .getByRole("button", { name: "Добавить клуб", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Клуб", exact: true }).locator("option"),
  ).toHaveCount(2);
  const clubOption = page
    .getByRole("combobox", { name: "Клуб", exact: true })
    .locator("option")
    .filter({ hasText: "Синтетический второй клуб браузера" });
  const club = await clubOption.getAttribute("value");
  await page
    .getByRole("combobox", { name: "Клуб", exact: true })
    .selectOption(club);
  await expect(
    page.getByLabel("Реестр клуба").getByText("Записей не найдено."),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "dist/registry-network-owner.png",
    fullPage: true,
  });
  const platformContext = await browser.newContext({ baseURL });
  const platform = await platformContext.newPage();
  await platform.goto("/");
  await platform
    .getByLabel("Логин", { exact: true })
    .fill(fixture.platform_login);
  await platform
    .getByLabel("Пароль", { exact: true })
    .fill("synthetic-network-password-27");
  await platform.getByRole("button", { name: "Войти", exact: true }).click();
  const panel = platform.getByLabel("Панель администратора платформы");
  await expect(
    panel.getByRole("heading", {
      name: "Администрирование платформы",
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "Сеть", exact: true })
    .selectOption({ label: networkName });
  await expect(
    panel.getByRole("heading", { name: "Клубы сети" }),
  ).toBeVisible();
  expect(
    await panel
      .getByLabel("Название клуба")
      .evaluateAll((items) => items.map((i) => i.value)),
  ).toContain("Синтетический второй клуб браузера");
  await platform.screenshot({
    path: "dist/registry-platform.png",
    fullPage: true,
  });
  await platformContext.close();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
