const { test, expect } = require("../../../../../api/node_modules/@playwright/test");
const demoLink = "Люди и семьи — синтетическая демонстрация";
const token = "a".repeat(64);
const password = "Synthetic-test-password-2026";
const emptySession = {
  account_id: "00000000-0000-4000-8000-000000000001",
  expires_at: "2099-01-01T00:00:00Z",
  memberships: [], networks: [], platform_administrator: false,
};
async function mockAPI(page, session = null, status = 401) {
  const commands = [], reads = [];
  let currentSession = session;
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== "GET") commands.push({ path: url.pathname, body: req.postDataJSON() });
    else reads.push(url.pathname);
    let body = { items: [], next_cursor: null }, code = 200;
    if (url.pathname.endsWith("/session")) {
      body = currentSession || { code: "SESSION_INVALID" }; code = currentSession ? 200 : status;
    } else if (url.pathname.endsWith("/csrf")) body = { csrf_token: "synthetic-csrf" };
    else if (url.pathname.endsWith("/login")) body = currentSession = emptySession;
    else if (url.pathname.endsWith("/redeem") || url.pathname.endsWith("/accept-invitation")) code = 204;
    await route.fulfill({ status: code, contentType: "application/json", body: code === 204 ? "" : JSON.stringify(body) });
  });
  return { commands, reads };
}
test("built explicit demo stays isolated, resets in memory and returns to App", async ({ page }) => {
  const api = await mockAPI(page);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/?demo=people");
  await expect(page.getByRole("button", { name: /Открыть карточку/ }).first()).toBeVisible();
  await expect(page.getByText("Демонстрация · синтетические данные", { exact: true })).toBeVisible();
  await expect(page.getByText("Проверка состояний демонстрации", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => "__peopleFixture" in window)).toBe(false);
  await page.getByRole("button", { name: "+ Новый человек" }).click();
  await page.getByLabel("Полное имя", { exact: true }).fill("Тестовый профиль обычной сборки");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Тестовый профиль обычной сборки", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("На сервер не отправлено");
  await page.reload();
  await expect(page.getByRole("button", { name: /Открыть карточку/ })).toHaveCount(6);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  expect(api.reads).toEqual([]); expect(api.commands).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/workspace/JudeOS/apps/web/src/people-manager/dist/built-demo-390.png", fullPage: true });
  await page.getByRole("link", { name: "← К приложению" }).click();
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  await expect(page.getByText("Демонстрация · синтетические данные", { exact: true })).toHaveCount(0);
  expect(api.reads).toContain("/api/v1/access/session");
  expect(errors).toEqual([]);
});
test("demo link uses existing registry scope; live failures never activate demo", async ({ page }) => {
  for (const role of ["administrator", "manager", "coach", "none"]) {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" });
    const session = { ...emptySession, memberships: role === "none" ? [] : [{
      membership_id: "00000000-0000-4000-8000-000000000002",
      tenant_id: "00000000-0000-4000-8000-000000000003",
      club_name: "Синтетический клуб",
      grants: [{ role, scope: role === "coach" ? "assigned_sessions" : "club" }],
    }] };
    await mockAPI(page, session);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: demoLink })).toHaveCount(role === "administrator" || role === "manager" ? 1 : 0);
    if (role === "manager") {
      await page.getByRole("link", { name: demoLink }).click();
      await expect(page.getByText("Демонстрация · синтетические данные", { exact: true })).toBeVisible();
    }
  }
  for (const status of [401, 403, 503]) {
    await page.goto("about:blank");
    await page.unrouteAll({ behavior: "wait" }); await mockAPI(page, null, status);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
    await expect(page.getByText("Демонстрация · синтетические данные", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: demoLink })).toHaveCount(0);
  }
});
for (const timing of ["initial", "after demo opens"]) {
  for (const kind of ["invite", "reset", "join", "recovery"]) {
    test(`${kind} fragment ${timing} stays in former access flow`, async ({ page }) => {
      const api = await mockAPI(page);
      const fragment = `#token=${token}&kind=${kind}`;
      if (timing === "initial") await page.goto("/?demo=people" + fragment);
      else {
        await page.goto("/?demo=people");
        await expect(page.getByRole("button", { name: /Открыть карточку/ }).first()).toBeVisible();
        expect(api.reads).toEqual([]);
        await page.evaluate(value => { location.hash = value; }, fragment);
      }
      const join = kind === "join";
      if (join) {
        await expect(page.getByRole("heading", { name: "Войти и принять приглашение" })).toBeVisible();
        await page.getByLabel("Логин", { exact: true }).fill("synthetic-join");
        await page.getByLabel("Пароль", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Войти", exact: true }).click();
        await page.getByRole("button", { name: "Принять приглашение в клуб", exact: true }).click();
        await expect(page.getByRole("status")).toContainText("Приглашение принято");
        expect(api.commands.find(c => c.path.endsWith("/accept-invitation")).body).toEqual({ token });
      } else {
        await expect(page.getByLabel("Код приглашения или восстановления")).toHaveValue(token);
        await page.getByLabel("Новый пароль (не менее 12 символов)").fill(password);
        await page.getByRole("button", { name: "Установить пароль", exact: true }).click();
        await expect(page.getByRole("status")).toContainText("Пароль установлен");
        expect(api.commands.find(c => c.path.endsWith("/redeem")).body).toEqual({ token, password });
      }
      expect(await page.evaluate(() => location.hash)).toBe("");
      await expect(page.getByText("Демонстрация · синтетические данные", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => "__peopleFixture" in window)).toBe(false);
      expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    });
  }
}
