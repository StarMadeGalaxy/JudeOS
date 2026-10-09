const {
  test,
  expect,
} = require("../../../../../api/node_modules/@playwright/test");
const preview = "/src/people-manager/preview.html";
const card = (page, index = 0) =>
  page.getByRole("button", { name: /Открыть карточку/ }).nth(index);
async function fault(page, name) {
  await page.evaluate((name) => window.__peopleFixture.failNext(name), name);
}
test("explicit synthetic mobile cards, privacy, pages, search and keyboard return", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
  });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(preview);
    await expect(card(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Открыть карточку/ }),
    ).toHaveCount(6);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".pm-root")
        .first()
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Rubik");
    await page.screenshot({
      path: `/workspace/JudeOS/apps/web/src/people-manager/dist/cards-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Открыть карточку/ }),
  ).toHaveCount(11);
  await page.getByLabel("Поиск по имени").fill("Алексей");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Открыть карточку/ }),
  ).toHaveCount(2);
  await card(page, 1).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Алексей Тестовый", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("Не указан", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← К списку" }).click();
  await expect(card(page, 1)).toBeFocused();
  await page.getByLabel("Поиск по имени").fill("Никого");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ничего не найдено" }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});
test("profile without Account/phone, form validation, unknown result and explicit replay", async ({
  page,
}) => {
  await page.goto(preview);
  await page.getByRole("button", { name: "+ Новый человек" }).click();
  await page.getByLabel("Полное имя", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByLabel("Полное имя", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .getByLabel("Полное имя", { exact: true })
    .fill("Тестовый новый профиль");
  await fault(page, "lost-response");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Изменение могло выполниться",
  );
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeDisabled();
  const first = await page.evaluate(() => window.__peopleFixture.history[0]);
  await page.getByRole("button", { name: "Повторить ту же команду" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Исходная команда подтверждена повторно",
  );
  await expect(
    page.getByRole("heading", { name: "Тестовый новый профиль", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__peopleFixture.history)).toEqual([
    first,
  ]);
  await expect(page.getByText("Не указан", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Изменить профиль", exact: true })
    .click();
  await page
    .getByLabel("Полное имя", { exact: true })
    .fill("Тестовый после конфликта");
  await fault(page, "conflict");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Карточка изменилась");
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Перечитать карточку" }).click();
  await page
    .getByRole("button", { name: "Изменить профиль", exact: true })
    .click();
  await page
    .getByLabel("Полное имя", { exact: true })
    .fill("Тестовый после конфликта");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Тестовый после конфликта",
      exact: true,
    }),
  ).toBeVisible();
});
test("representative check, contact withdrawal, expiry and archive preserve history", async ({
  page,
}) => {
  await page.goto(preview);
  await page.getByRole("button", { name: "Спортсмены", exact: true }).click();
  await card(page, 1).click();
  await expect(
    page.getByText("Проверенных связей пока нет.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Проверить представительство" })
    .click();
  await page.getByLabel("Поиск человека по имени").fill("Анна");
  await page.getByRole("radio", { name: /Анна/ }).check();
  await page
    .getByLabel("Основание проверки", { exact: true })
    .fill("Синтетическая личная проверка");
  await page
    .getByLabel("Действует до (Минск, необязательно)")
    .fill("2026-01-01T10:00");
  await page.getByRole("button", { name: "Подтвердить проверку" }).click();
  await expect(
    page.getByText("Окончание должно быть позже начала."),
  ).toBeVisible();
  await page
    .getByLabel("Действует до (Минск, необязательно)")
    .fill("2026-10-10T10:00");
  await page.getByRole("button", { name: "Подтвердить проверку" }).click();
  await expect(
    page.getByRole("button", { name: "Выбрать основным" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выбрать основным" }).click();
  await expect(page.locator(".pm-contact")).toContainText(
    "Анна Демонстрационная",
  );
  await expect(page.locator(".pm-contact")).toContainText("Телефон не указан");
  await page.evaluate(() =>
    window.__peopleFixture.setClock(Date.parse("2026-10-10T07:00:00Z")),
  );
  await expect(page.locator(".pm-contact")).toContainText("Не выбран");
  await expect(page.getByText(/Срок действия истёк/)).toBeVisible();
  await page.evaluate(() =>
    window.__peopleFixture.setClock(Date.parse("2026-10-09T12:00:00Z")),
  );
  await page.getByRole("button", { name: "← К списку" }).click();
  await card(page, 1).click();
  await expect(page.locator(".pm-contact")).toContainText(
    "Анна Демонстрационная",
  );
  await page.getByRole("button", { name: "Отозвать связь" }).click();
  await page.getByRole("button", { name: "Подтвердить отзыв" }).click();
  await expect(page.locator(".pm-contact")).toContainText("Не выбран");
  await expect(page.getByText("Отозвана", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "В архив", exact: true }).click();
  await page.getByRole("button", { name: "Подтвердить архивирование" }).click();
  await expect(
    page.getByText("В архиве · доступна разрешённая история"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Проверить представительство" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "← К списку" }).click();
  await page.getByLabel("Показать", { exact: true }).selectOption("archived");
  await card(page).click();
  await expect(page.getByText("Отозвана", { exact: true })).toBeVisible();
});
test("family create, duplicate names, periods and empty states do not grant representation", async ({
  page,
}) => {
  await page.goto(preview);
  await page.getByRole("button", { name: "Семьи", exact: true }).click();
  await page.getByRole("button", { name: "+ Новая семья" }).click();
  await page
    .getByLabel("Название семьи", { exact: true })
    .fill("Синтетическая новая семья");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("В семье пока нет людей.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Добавить человека в семью" }).click();
  await page.getByLabel("Поиск человека по имени").fill("Алексей");
  await expect(page.getByRole("radio")).toHaveCount(2);
  await page.getByRole("radio").nth(1).check();
  await page
    .getByLabel("Действует с (Минск)", { exact: true })
    .fill("2026-01-01T00:00");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText(
      "Членство в семье не даёт представительства или доступа к данным.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Завершить период" }).click();
  await page
    .getByLabel("Окончание периода (Минск)", { exact: true })
    .fill("2026-10-09T15:00");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Период завершён", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Завершить период" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "← К списку" }).click();
  await expect(
    page.getByRole("button", { name: /Открыть карточку/ }),
  ).toHaveCount(2);
  await expect(
    page.getByLabel("Показать").locator('option[value="archived"]'),
  ).toHaveCount(0);
});
test("read errors, page retry, access denial and large text do not silently load fixtures from API", async ({
  page,
}) => {
  await page.goto(preview);
  await expect(card(page)).toBeVisible();
  await fault(page, "503");
  await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("временно недоступен");
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(
    page.getByRole("button", { name: /Открыть карточку/ }),
  ).toHaveCount(11);
  await page.setViewportSize({ width: 320, height: 850 });
  await page.addStyleTag({ content: ".pm-root {font-size:32px}" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await fault(page, "403");
  await card(page).click();
  await expect(page.getByRole("alert")).toContainText("Нет доступа");
  await expect(
    page.getByRole("button", { name: /Открыть карточку/ }),
  ).toHaveCount(0);
  await page.goto(preview);
  await expect(card(page)).toBeVisible();
  await fault(page, "401");
  await card(page).click();
  await expect(page.getByRole("alert")).toContainText("Вход завершён");
});
