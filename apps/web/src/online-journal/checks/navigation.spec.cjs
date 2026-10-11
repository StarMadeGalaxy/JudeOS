const {
  test,
  expect,
} = require("../../../../../api/node_modules/@playwright/test");
const demoLink = "Онлайн-журнал — синтетическая демонстрация";
const token = "b".repeat(64),
  password = "Synthetic-test-password-2026";
const sessionBase = {
  account_id: "00000000-0000-4000-8000-000000000001",
  expires_at: "2099-01-01T00:00:00Z",
  memberships: [],
  networks: [],
  platform_administrator: false,
};
async function api(page, session = null, status = 401) {
  const writes = [],
    reads = [];
  let current = session;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() === "GET") reads.push(url.pathname);
    else writes.push({ path: url.pathname, body: req.postDataJSON() });
    let body = { items: [], next_cursor: null },
      code = 200;
    if (url.pathname.endsWith("/session")) {
      body = current || {
        code:
          status === 401
            ? "UNAUTHENTICATED"
            : status === 403
              ? "FORBIDDEN"
              : "SERVICE_UNAVAILABLE",
        message: "Синтетический отказ",
        request_id: "synthetic-navigation",
      };
      code = current ? 200 : status;
    } else if (url.pathname.endsWith("/csrf"))
      body = { csrf_token: "synthetic-csrf" };
    else if (url.pathname.endsWith("/login")) body = current = sessionBase;
    else if (
      url.pathname.endsWith("/redeem") ||
      url.pathname.endsWith("/accept-invitation")
    )
      code = 204;
    await route.fulfill({
      status: code,
      contentType: "application/json",
      body: code === 204 ? "" : JSON.stringify(body),
    });
  });
  return { writes, reads };
}
async function openJournal(page) {
  await page.getByRole("button", { name: "Ещё занятия", exact: true }).click();
  await page
    .locator(".oj-session-list")
    .getByRole("button", { name: /15:00–16:00/ })
    .click();
  await expect(page.locator("[data-oj-heading]")).toBeVisible();
}

test("built explicit journal has no API/storage/debug handle, resets completely and returns to App", async ({
  page,
}) => {
  const calls = await api(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=journal");
  await openJournal(page);
  await expect(
    page.getByText("Синтетическая демонстрация.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Проверка состояний демонстрации", { exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "__journalFixture" in window)).toBe(false);
  const row = page.getByRole("listitem", {
    name: "Синтетический спортсмен Б · постоянный",
    exact: true,
  });
  await row.getByRole("button", { name: "Был", exact: true }).click();
  await expect(row.getByRole("status")).toContainText(
    "Подтверждено в демонстрации",
  );
  await page.getByRole("button", { name: "Сбросить демонстрацию" }).click();
  await expect(page.locator("[data-oj-heading]")).toHaveCount(0);
  await openJournal(page);
  await expect(row.locator(".oj-current")).toHaveText("Не отмечен");
  await page.getByRole("button", { name: "Добавить онлайн-гостя" }).click();
  await page
    .getByLabel("Полное имя гостя")
    .fill("Синтетический гость обычной сборки");
  await page
    .getByRole("button", { name: "Добавить гостя", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Синтетический гость обычной сборки" }),
  ).toBeVisible();
  await page.reload();
  await openJournal(page);
  await expect(
    page.getByRole("heading", { name: "Синтетический гость обычной сборки" }),
  ).toHaveCount(0);
  expect(calls.writes).toEqual([]);
  expect(calls.reads).toEqual([]);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
  await page.getByRole("link", { name: "← К приложению", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("club grants control only the explicit link; live 401/403/503 never select fixtures", async ({
  page,
}) => {
  for (const role of ["administrator", "manager", "coach", "no-grant"]) {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    await api(page, {
      ...sessionBase,
      memberships: [
        {
          membership_id: "00000000-0000-4000-8000-000000000002",
          tenant_id: "00000000-0000-4000-8000-000000000003",
          club_name: "Синтетический клуб",
          grants:
            role === "no-grant"
              ? []
              : [
                  {
                    role,
                    scope: role === "coach" ? "assigned_sessions" : "club",
                  },
                ],
        },
      ],
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Выйти", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: demoLink })).toHaveCount(
      role === "no-grant" ? 0 : 1,
    );
    await expect(
      page.getByText("Синтетическая демонстрация.", { exact: true }),
    ).toHaveCount(0);
  }
  for (const status of [401, 403, 503]) {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    await api(page, null, status);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: demoLink })).toHaveCount(0);
    await expect(
      page.getByText("Синтетическая демонстрация.", { exact: true }),
    ).toHaveCount(0);
  }
});

for (const timing of ["initial", "late"])
  for (const kind of ["invite", "reset", "join", "recovery"])
    test(`${kind} ${timing} fragment stays in access/recovery and locks out the journal demo`, async ({
      page,
    }) => {
      const calls = await api(page),
        fragment = `#token=${token}&kind=${kind}`;
      if (timing === "initial") await page.goto("/?demo=journal" + fragment);
      else {
        await page.goto("/?demo=journal");
        await expect(
          page.getByRole("heading", { name: "Назначенные занятия" }),
        ).toBeVisible();
        await page.evaluate((value) => {
          location.hash = value;
        }, fragment);
      }
      if (kind === "join") {
        await expect(
          page.getByRole("heading", { name: "Войти и принять приглашение" }),
        ).toBeVisible();
        await page.getByLabel("Логин", { exact: true }).fill("synthetic-join");
        await page.getByLabel("Пароль", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Войти", exact: true }).click();
        await page
          .getByRole("button", {
            name: "Принять приглашение в клуб",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "Приглашение принято",
        );
        expect(
          calls.writes.find((c) => c.path.endsWith("/accept-invitation")).body,
        ).toEqual({ token });
      } else {
        await expect(
          page.getByLabel("Код приглашения или восстановления"),
        ).toHaveValue(token);
        await page
          .getByLabel("Новый пароль (не менее 12 символов)")
          .fill(password);
        await page
          .getByRole("button", { name: "Установить пароль", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "Пароль установлен",
        );
        expect(
          calls.writes.find((c) => c.path.endsWith("/redeem")).body,
        ).toEqual({ token, password });
      }
      expect(await page.evaluate(() => location.hash)).toBe("");
      await expect(
        page.getByText("Синтетическая демонстрация.", { exact: true }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => "__journalFixture" in window)).toBe(
        false,
      );
    });
