const {
  test,
  expect,
} = require("../../../../../api/node_modules/@playwright/test");
const path = require("node:path");
const preview = "/src/online-journal/preview.html";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (page, name = "Синтетический спортсмен Б · постоянный") =>
  page.getByRole("listitem", { name, exact: true });
async function open(page, role = "coach", state = "in_progress") {
  await page.goto(`${preview}?role=${role}`);
  if (state === "in_progress" || state === "planned")
    await page
      .getByRole("button", { name: "Ещё занятия", exact: true })
      .click();
  const names = {
    in_progress: /15:00–16:00/,
    closed: /10:00–11:00/,
    cancelled: /11:00–12:00/,
    planned: /18:00–19:00/,
  };
  await page
    .locator(".oj-session-list")
    .getByRole("button", { name: names[state] })
    .click();
  await expect(page.locator("[data-oj-heading]")).toBeVisible();
}
async function fault(page, value) {
  await page.evaluate((f) => window.__journalFixture.failNext(f), value);
}
async function sent(page) {
  await page.evaluate(() => {
    window.__journalSent = [];
    const a = window.__journalFixture,
      original = a.execute.bind(a);
    a.execute = (command) => {
      window.__journalSent.push(structuredClone(command));
      return original(command);
    };
  });
}
async function history(page) {
  return page.evaluate(() => window.__journalFixture.history);
}

test("four explicit marks preserve unmarked and show intent separately from confirmation", async ({
  page,
}) => {
  await open(page);
  await sent(page);
  await page.evaluate(() => {
    window.__journalFixture.delay = 650;
  });
  const athlete = row(page);
  for (const [label, status] of [
    ["Был", "present"],
    ["Не был", "absent"],
    ["Болел", "sick"],
    ["Не отмечен", "unmarked"],
  ]) {
    const button = athlete.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(athlete.getByRole("status")).toContainText(
      "Пока не сохранено",
    );
    await expect(athlete.getByRole("status")).toContainText(
      "Подтверждено в демонстрации",
    );
    await expect(button).toHaveAttribute("aria-pressed", "true");
    expect((await history(page)).at(-1).body.status).toBe(status);
  }
  expect((await history(page)).map((c) => c.body.base_version)).toEqual([
    0, 1, 2, 3,
  ]);
  await expect(athlete.locator(".oj-current")).toHaveText("Не отмечен");
  await expect(
    athlete.getByText(/Последняя подтверждённая запись/),
  ).toBeVisible();
});

test("unknown result freezes the command while another athlete remains independent; replay rereads fresh state", async ({
  page,
}) => {
  await open(page);
  await sent(page);
  await fault(page, "lost-response");
  await row(page).getByRole("button", { name: "Был", exact: true }).click();
  await expect(row(page).getByRole("alert")).toContainText(
    "Результат неизвестен",
  );
  await expect(page.getByLabel("Дата занятия")).toBeDisabled();
  await expect(page.getByLabel("Учебная роль")).toBeDisabled();
  await expect(
    row(page).getByRole("button", { name: "Болел", exact: true }),
  ).toBeDisabled();
  await row(page, "Синтетический спортсмен Г · постоянный")
    .getByRole("button", { name: "Был", exact: true })
    .click();
  await expect(
    row(page, "Синтетический спортсмен Г · постоянный").getByRole("status"),
  ).toContainText("Подтверждено");
  await page.evaluate(
    async ({ athlete, session }) => {
      await window.__journalFixture.execute({
        operation: "setAttendance",
        athleteId: athlete,
        sessionId: session,
        body: {
          operation_id: crypto.randomUUID(),
          base_version: 1,
          status: "sick",
        },
      });
    },
    { athlete: id(402), session: id(501) },
  );
  await row(page)
    .getByRole("button", { name: "Повторить ту же команду" })
    .click();
  await expect(row(page).getByRole("status")).toContainText("повтор принят");
  await expect(
    row(page).getByRole("button", { name: "Болел", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const commands = await page.evaluate(() =>
    window.__journalSent.filter(
      (c) => c.athleteId?.endsWith("402") && c.body.status === "present",
    ),
  );
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(await history(page)).toHaveLength(3);
});

test("offline blocks writes and frozen retries without a local queue, then exact retry becomes available", async ({
  page,
  context,
}) => {
  await open(page);
  await fault(page, "lost-response");
  await row(page).getByRole("button", { name: "Был", exact: true }).click();
  await expect(row(page).getByRole("alert")).toContainText(
    "Результат неизвестен",
  );
  await context.setOffline(true);
  await expect(page.getByText(/Нет сети\. Новые записи/)).toBeVisible();
  await expect(
    row(page).getByRole("button", { name: "Повторить ту же команду" }),
  ).toBeDisabled();
  await expect(
    row(page, "Синтетический спортсмен Г · постоянный").getByRole("button", {
      name: "Был",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await history(page)).toHaveLength(1);
  await context.setOffline(false);
  await row(page)
    .getByRole("button", { name: "Повторить ту же команду" })
    .click();
  await expect(row(page).getByRole("status")).toContainText("повтор принят");
  expect(await history(page)).toHaveLength(1);
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
});

for (const keep of [false, true])
  test(`attendance conflict rereads and ${keep ? "saves a new intent" : "keeps the current value without a write"}`, async ({
    page,
  }) => {
    await open(page);
    await sent(page);
    await fault(page, "conflict");
    await row(page).getByRole("button", { name: "Был", exact: true }).click();
    await expect(row(page).getByRole("alert")).toContainText("Сейчас: Болел");
    await row(page)
      .getByRole("button", {
        name: keep ? "Сохранить мой выбор" : "Оставить текущую",
      })
      .click();
    await expect(
      row(page).getByRole("button", {
        name: keep ? "Был" : "Болел",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const calls = await page.evaluate(() => window.__journalSent);
    expect(calls).toHaveLength(keep ? 2 : 1);
    if (keep) {
      expect(calls[1].body.operation_id).not.toBe(calls[0].body.operation_id);
      expect(calls[1].body.base_version).toBe(1);
    }
    expect(await history(page)).toHaveLength(keep ? 1 : 0);
  });

test("closing warns, preserves unmarked, accepts lost-response replay once and permits closed correction", async ({
  page,
}) => {
  await open(page);
  await sent(page);
  await page
    .getByRole("button", { name: "Закрыть занятие", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Не отмечены: 4");
  await fault(page, "lost-response");
  await page.getByRole("button", { name: "Подтвердить закрытие" }).click();
  await expect(page.getByRole("dialog")).toContainText("Результат неизвестен");
  await expect(
    page.getByRole("button", { name: "Отмена", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Повторить ту же команду" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/Занятие закрыто\. Существующие/)).toBeVisible();
  await expect(row(page).locator(".oj-current")).toHaveText("Не отмечен");
  await expect(
    page.getByRole("button", { name: "Добавить онлайн-гостя" }),
  ).toBeDisabled();
  await row(page).getByRole("button", { name: "Был", exact: true }).click();
  await expect(row(page).getByRole("status")).toContainText("Подтверждено");
  expect(await history(page)).toHaveLength(2);
  const closeCalls = await page.evaluate(() =>
    window.__journalSent.filter((c) => c.operation === "closeSession"),
  );
  expect(closeCalls[1]).toEqual(closeCalls[0]);
});

test("guest validation/focus, keyboard trap and return focus; duplicate name guest has one effect on replay", async ({
  page,
}) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "Добавить онлайн-гостя" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const name = page.getByLabel("Полное имя гостя");
  await expect(name).toBeFocused();
  await page
    .getByRole("button", { name: "Добавить гостя", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Укажите полное имя");
  await expect(name).toBeFocused();
  await page.getByRole("button", { name: "Отмена", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(name).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await name.fill("Синтетический спортсмен А");
  await page.getByLabel("Пробное занятие", { exact: true }).check();
  await fault(page, "lost-response");
  await page
    .getByRole("button", { name: "Добавить гостя", exact: true })
    .click();
  await expect(dialog).toContainText("Результат неизвестен");
  await page.getByRole("button", { name: "Повторить ту же команду" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    row(page, "Синтетический спортсмен А · гость · пробное"),
  ).toContainText("Гость · Пробное занятие");
  expect(await history(page)).toHaveLength(1);
});

test("manager schedule, known visit and exclusion preserve facts; move/cancel stay explicitly unavailable", async ({
  page,
}) => {
  await open(page, "manager");
  await expect(
    page.getByRole("heading", { name: "Расписание клуба" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Перенести занятие", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Отменить занятие", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Добавить известного участника" })
    .click();
  await page.getByRole("button", { name: "Ещё участники" }).click();
  await page.getByLabel("Участник", { exact: true }).selectOption(id(423));
  await page.getByRole("button", { name: "Добавить разовый визит" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    row(page, "Синтетический участник визита 3 · визит"),
  ).toBeVisible();
  await row(page, "Синтетический спортсмен А · постоянный")
    .getByRole("button", { name: "Исключить из состава" })
    .click();
  await page.getByRole("button", { name: "Подтвердить исключение" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Синтетический спортсмен А · постоянный")).toHaveCount(
    0,
  );
  await page.getByLabel("Показать исключённых с историей").check();
  const excluded = row(page, "Синтетический спортсмен А · постоянный");
  await expect(excluded).toContainText("Подтверждённая отметка: Был");
  await expect(
    excluded.getByRole("button", { name: "Был", exact: true }),
  ).toBeDisabled();
  await expect(
    excluded.getByText("Контакт и допуск", { exact: true }),
  ).toHaveCount(0);
});

test("aggregate conflict requires reread and a new confirmation; permissions in known lookup hide the journal", async ({
  page,
}) => {
  await open(page, "manager");
  await sent(page);
  await page
    .getByRole("button", { name: "Закрыть занятие", exact: true })
    .click();
  await fault(page, "conflict");
  await page.getByRole("button", { name: "Подтвердить закрытие" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Данные занятия изменились",
  );
  await page.getByRole("button", { name: "Перечитать занятие" }).click();
  await page.getByRole("button", { name: "Подтвердить закрытие" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__journalSent);
  expect(calls[1].body.base_version).toBe(2);
  expect(calls[1].body.operation_id).not.toBe(calls[0].body.operation_id);
  await page.reload();
  await page.getByRole("button", { name: "Ещё занятия", exact: true }).click();
  await page
    .locator(".oj-session-list")
    .getByRole("button", { name: /15:00–16:00/ })
    .click();
  await expect(row(page)).toBeVisible();
  await fault(page, "403");
  await page
    .getByRole("button", { name: "Добавить известного участника" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page)).toHaveCount(0);
  await expect(page.getByText(/Журнал и контакты скрыты/)).toBeVisible();
});

for (const failure of ["network", "503"])
  test(`${failure} has an unknown result and an explicit retry, without a synthetic success fallback`, async ({
    page,
  }) => {
    await open(page);
    await fault(page, failure);
    await row(page).getByRole("button", { name: "Был", exact: true }).click();
    await expect(row(page).getByRole("alert")).toContainText(
      "Результат неизвестен",
    );
    expect(await history(page)).toHaveLength(0);
    await row(page)
      .getByRole("button", { name: "Повторить ту же команду" })
      .click();
    await expect(row(page).getByRole("status")).toContainText("Подтверждено");
    expect(await history(page)).toHaveLength(1);
  });

for (const failure of ["401", "403", "404"])
  test(`${failure} clears the visible journal/contacts and cannot disclose an old result`, async ({
    page,
  }) => {
    await open(page);
    await fault(page, failure);
    await row(page).getByRole("button", { name: "Был", exact: true }).click();
    await expect(page.locator(".oj-roster .oj-entry")).toHaveCount(0);
    await expect(page.locator("[data-oj-heading]")).toHaveCount(0);
    await expect(
      page.getByText(/Сессия завершена|Журнал и контакты скрыты/),
    ).toBeVisible();
    expect(await history(page)).toHaveLength(0);
  });

test("coach restrictions, cancelled history, primary-contact null and no fallback, not-admitted factual mark", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("button", { name: "Добавить известного участника" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Исключить из состава", exact: true }),
  ).toHaveCount(0);
  await row(page).getByText("Контакт и допуск", { exact: true }).click();
  await expect(row(page)).toContainText("Номер не указан");
  await expect(row(page)).toContainText("Не допущен");
  await row(page).getByRole("button", { name: "Был", exact: true }).click();
  await expect(row(page).getByRole("status")).toContainText("Подтверждено");
  await page.evaluate(
    (athlete) => window.__journalFixture.clearContact(athlete),
    id(402),
  );
  await page
    .locator(".oj-journal")
    .getByRole("button", { name: "Обновить журнал", exact: true })
    .click();
  await expect(row(page)).toContainText(
    "Основной контакт не выбран или недоступен",
  );
  await page
    .locator(".oj-session-list")
    .getByRole("button", { name: /11:00–12:00/ })
    .click();
  await expect(
    page.getByText(/Занятие отменено\. Факты сохранены/),
  ).toBeVisible();
  await expect(page.locator(".oj-marks button").first()).toBeDisabled();
});

test("an acknowledged guest with failed reread closes its form and blocks duplicate writes until refresh", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const a = window.__journalFixture,
      get = a.get.bind(a);
    let once = true;
    a.get = async (...args) => {
      if (once) {
        once = false;
        a.failNext("503");
      }
      return get(...args);
    };
  });
  await page.getByRole("button", { name: "Добавить онлайн-гостя" }).click();
  await page
    .getByLabel("Полное имя гостя")
    .fill("Синтетический гость подтверждённого ответа");
  await page
    .getByRole("button", { name: "Добавить гостя", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(/Команда подтверждена, но актуальный журнал не получен/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить онлайн-гостя" }),
  ).toBeDisabled();
  await page
    .locator(".oj-journal")
    .getByRole("button", { name: "Обновить журнал", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Добавить онлайн-гостя" }),
  ).toBeEnabled();
  expect(await history(page)).toHaveLength(1);
});

test("a failed conflict reread keeps the intent; a later explicit resolution sends a fresh version", async ({
  page,
}) => {
  await open(page);
  await sent(page);
  await fault(page, "conflict");
  await row(page).getByRole("button", { name: "Был", exact: true }).click();
  await expect(row(page).getByRole("alert")).toContainText("Сейчас: Болел");
  await fault(page, "503");
  await row(page).getByRole("button", { name: "Сохранить мой выбор" }).click();
  await expect(page.getByText(/Не удалось обновить журнал/)).toBeVisible();
  expect(await page.evaluate(() => window.__journalSent.length)).toBe(1);
  await row(page).getByRole("button", { name: "Сохранить мой выбор" }).click();
  await expect(row(page).getByRole("status")).toContainText("Подтверждено");
  expect((await history(page)).at(-1).body.base_version).toBe(1);
});

test("empty date, stale date response and removed assignment do not resurrect contacts", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const a = window.__journalFixture,
      list = a.list.bind(a);
    window.__oldDateDone = false;
    a.list = async (date, cursor) => {
      const result = await list(date, cursor);
      if (date === "2026-10-11") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.__oldDateDone = true;
      }
      return result;
    };
  });
  await page.getByLabel("Дата занятия").fill("2026-10-11");
  await page.getByLabel("Дата занятия").fill("2026-10-10");
  await expect(
    page.getByRole("button", { name: "Ещё занятия", exact: true }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__oldDateDone)).toBe(true);
  await expect(
    page.getByRole("button", { name: "Ещё занятия", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Дата занятия").fill("2026-10-12");
  await expect(
    page.getByText("На эту дату доступных занятий нет.", { exact: true }),
  ).toBeVisible();
  await open(page);
  await page.evaluate(
    (session) => window.__journalFixture.removeAssignment(session),
    id(501),
  );
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(page.locator(".oj-roster .oj-entry")).toHaveCount(0);
  await expect(page.getByText(/Журнал и контакты скрыты/)).toBeVisible();
});

for (const width of [320, 390, 768, 1280])
  test(`layout, 200% text and reduced motion at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "manager");
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(await overflow()).toBe(false);
    await page.getByRole("button", { name: "Добавить онлайн-гостя" }).click();
    expect(await overflow()).toBe(false);
    await page.addStyleTag({ content: "html { font-size: 200% !important }" });
    expect(await overflow()).toBe(false);
    await expect(page.getByLabel("Полное имя гостя")).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(await overflow()).toBe(false);
    const durations = await page
      .locator(".oj-root button")
      .first()
      .evaluate((button) => ({
        animation: getComputedStyle(button).animationDuration,
        transition: getComputedStyle(button).transitionDuration,
      }));
    expect(durations).toEqual({ animation: "0s", transition: "0s" });
    expect(errors).toEqual([]);
    if (width === 390)
      await page.screenshot({
        path: path.resolve(__dirname, "../dist/journal-mobile.png"),
        fullPage: true,
      });
  });
