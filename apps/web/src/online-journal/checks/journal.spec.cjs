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
  await expect(
    dialog.getByRole("button", { name: "Отмена", exact: true }),
  ).toBeFocused();
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

test("manager schedule, known visit and exclusion preserve facts; configuration is restricted to administrator", async ({
  page,
}) => {
  await open(page, "manager");
  await expect(
    page.getByRole("heading", { name: "Расписание клуба" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Изменить дату и время", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Отменить занятие", exact: true }),
  ).toHaveCount(0);
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

const readJournal = (page) =>
  page.evaluate(async () =>
    window.__journalFixture.get("00000000-0000-4000-8000-000000000501"),
  );
async function timeDialog(page) {
  await page
    .getByRole("button", { name: "Изменить дату и время", exact: true })
    .click();
  await page.getByLabel("Дата начала", { exact: true }).fill("2026-10-11");
  await page.getByLabel("Время начала", { exact: true }).fill("15:30");
  await page.getByLabel("Дата окончания", { exact: true }).fill("2026-10-11");
  await page.getByLabel("Время окончания", { exact: true }).fill("16:30");
}
async function coachDialog(page, locked = false) {
  await page
    .getByRole("button", {
      name: locked ? "Отозвать доступ тренера" : "Назначить тренеров",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("checkbox", { name: /synthetic_coach_a/ }),
  ).toBeVisible();
}
test.describe("Minsk schedule with a different browser time zone", () => {
  test.use({ timezoneId: "America/New_York" });
  test("administrator moves date/time in Minsk, shows pending then ack, preserves ID/venue/roster and refreshes the new date", async ({
    page,
  }) => {
    await open(page, "administrator");
    const before = await readJournal(page);
    await sent(page);
    await timeDialog(page);
    await page
      .getByLabel("Причина (необязательно)")
      .fill("Синтетическая настройка времени");
    await page.evaluate(() => {
      window.__journalFixture.delay = 500;
    });
    await page.getByRole("button", { name: "Сохранить дату и время" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Пока не сохранено",
    );
    await expect(
      page.getByLabel("Дата начала", { exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Дата занятия", { exact: true })).toHaveValue(
      "2026-10-11",
    );
    await expect(
      page
        .locator(".oj-session-list")
        .getByRole("button", { name: /15:30–16:30/ }),
    ).toBeVisible();
    const after = await readJournal(page);
    expect(after.session.session_id).toBe(before.session.session_id);
    expect(after.session.venue).toEqual(before.session.venue);
    expect(after.roster).toEqual(before.roster);
    expect(after.session.starts_at).toBe("2026-10-11T12:30:00.000Z");
    expect((await history(page)).at(-1).body.reason).toBe(
      "Синтетическая настройка времени",
    );
    await expect(page.locator(".oj-journal .oj-confirmed")).toContainText(
      "Подтверждено в демонстрации",
    );
  });
});
test("time interval validation focuses the bad field; textarea and both dialog edges participate in keyboard navigation", async ({
  page,
}) => {
  await open(page, "administrator");
  const trigger = page.getByRole("button", {
    name: "Изменить дату и время",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"),
    start = page.getByLabel("Дата начала", { exact: true }),
    end = page.getByLabel("Время окончания", { exact: true });
  await expect(start).toBeFocused();
  await start.fill("2026-10-11");
  await page.getByLabel("Время начала", { exact: true }).fill("15:30");
  await page.getByLabel("Дата окончания", { exact: true }).fill("2026-10-11");
  await end.fill("15:00");
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "окончание должно быть позже",
  );
  await expect(end).toBeFocused();
  await expect(end).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Причина (необязательно)").focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Сохранить дату и время" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(start).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Отмена", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await history(page)).toHaveLength(0);
});
test("unknown cancellation freezes its reason/UUID, blocks offline retry and resolves its own cancelled state with one effect", async ({
  page,
  context,
}) => {
  await open(page, "administrator");
  const before = await readJournal(page);
  await sent(page);
  await page
    .getByRole("button", { name: "Отменить занятие", exact: true })
    .click();
  await page.getByLabel("Причина (необязательно)").fill("Синтетическая отмена");
  await fault(page, "lost-response");
  await page.getByRole("button", { name: "Подтвердить отмену" }).click();
  await expect(page.getByRole("dialog")).toContainText("Результат неизвестен");
  await expect(page.getByLabel("Причина (необязательно)")).toBeDisabled();
  await expect(page.getByLabel("Учебная роль")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Повторить ту же команду" }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Повторить ту же команду" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Повторить ту же команду" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(/Отмена подтверждена в демонстрации/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Изменить дату и время", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Отменить занятие", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".oj-marks button").first()).toBeDisabled();
  expect((await readJournal(page)).roster).toEqual(before.roster);
  const calls = await page.evaluate(() => window.__journalSent);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(await history(page)).toHaveLength(1);
});
test("reschedule replay after later closure reads the latest state instead of reviving its old success", async ({
  page,
}) => {
  await open(page, "administrator");
  await sent(page);
  await timeDialog(page);
  await fault(page, "lost-response");
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(page.getByRole("dialog")).toContainText("Результат неизвестен");
  await page.evaluate(async (session) => {
    await window.__journalFixture.execute({
      operation: "closeSession",
      sessionId: session,
      body: { operation_id: crypto.randomUUID(), base_version: 2 },
    });
  }, id(501));
  await page.getByRole("button", { name: "Повторить ту же команду" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(/Занятие закрыто\. Существующие активные/),
  ).toBeVisible();
  await expect(page.getByLabel("Дата занятия", { exact: true })).toHaveValue(
    "2026-10-11",
  );
  await expect(
    page.getByRole("button", { name: "Изменить дату и время", exact: true }),
  ).toBeDisabled();
  const calls = await page.evaluate(() =>
    window.__journalSent.filter((c) => c.operation === "rescheduleSession"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(await history(page)).toHaveLength(2);
});
test("time conflict requires reread and a second confirmation with a new UUID/version", async ({
  page,
}) => {
  await open(page, "administrator");
  await sent(page);
  await timeDialog(page);
  await fault(page, "conflict");
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Данные занятия изменились",
  );
  await expect(
    page.getByRole("button", { name: "Сохранить дату и время" }),
  ).toBeDisabled();
  expect(await history(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Перечитать занятие" }).click();
  await expect(
    page.getByRole("button", { name: "Сохранить дату и время" }),
  ).toBeEnabled();
  expect(await history(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__journalSent);
  expect(calls).toHaveLength(2);
  expect(calls[1].body.base_version).toBe(2);
  expect(calls[1].body.operation_id).not.toBe(calls[0].body.operation_id);
  expect(await history(page)).toHaveLength(1);
});
test("time acknowledgement with failed reread closes the form and blocks new writes until a successful refresh", async ({
  page,
}) => {
  await open(page, "administrator");
  await timeDialog(page);
  await page.evaluate(() => {
    const a = window.__journalFixture,
      get = a.get.bind(a);
    let once = true;
    a.get = (...args) => {
      if (once) {
        once = false;
        a.failNext("503");
      }
      return get(...args);
    };
  });
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(/Команда подтверждена, но актуальный журнал не получен/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Изменить дату и время", exact: true }),
  ).toBeDisabled();
  expect(await history(page)).toHaveLength(1);
  await page
    .locator(".oj-journal")
    .getByRole("button", { name: "Обновить журнал", exact: true })
    .click();
  await expect(page.getByLabel("Дата занятия", { exact: true })).toHaveValue(
    "2026-10-11",
  );
  await expect(
    page.getByRole("button", { name: "Изменить дату и время", exact: true }),
  ).toBeEnabled();
  expect(await history(page)).toHaveLength(1);
});
test("coaches are a separate confirmation after time, use the fresh version, show active choices and retain assignment history", async ({
  page,
}) => {
  await open(page, "administrator");
  const before = await readJournal(page);
  await timeDialog(page);
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(
    page.getByRole("button", { name: "Назначить тренеров", exact: true }),
  ).toBeEnabled();
  await coachDialog(page);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("checkbox", {
      name: /synthetic_revoked_coach|synthetic_manager/,
    }),
  ).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: /synthetic_coach_a/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /synthetic_coach_b/ }).check();
  await page.getByRole("button", { name: "Сохранить тренеров" }).click();
  await expect(dialog).toHaveCount(0);
  const commands = await history(page);
  expect(commands.map((c) => c.operation)).toEqual([
    "rescheduleSession",
    "setSessionCoaches",
  ]);
  expect(commands[1].body.base_version).toBe(2);
  expect(commands[1].body.coach_membership_ids).toEqual([id(802)]);
  expect((await readJournal(page)).roster).toEqual(before.roster);
  await coachDialog(page);
  await expect(
    dialog.getByRole("checkbox", { name: /synthetic_coach_b/ }),
  ).toBeChecked();
  await dialog.getByText("История назначений", { exact: true }).click();
  await expect(dialog.locator("details")).toContainText("synthetic_coach_a");
  await expect(dialog.locator("details")).toContainText("снят");
});
test("coach read failure offers an explicit retry and never preselects synthetic substitutes", async ({
  page,
}) => {
  await open(page, "administrator");
  await fault(page, "503");
  await page
    .getByRole("button", { name: "Назначить тренеров", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Не удалось получить назначения",
  );
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  expect(await history(page)).toHaveLength(0);
  await page
    .getByRole("button", { name: "Повторить чтение назначений" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_a/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_b/ }),
  ).not.toBeChecked();
});
test("coach conflict reloads current assignments and needs a new deliberate selection/confirmation", async ({
  page,
}) => {
  await open(page, "administrator");
  await sent(page);
  await coachDialog(page);
  await page.getByRole("checkbox", { name: /synthetic_coach_a/ }).uncheck();
  await page.getByRole("checkbox", { name: /synthetic_coach_b/ }).check();
  await fault(page, "conflict");
  await page.getByRole("button", { name: "Сохранить тренеров" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Данные занятия изменились",
  );
  await page.getByRole("button", { name: "Перечитать занятие" }).click();
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_a/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_b/ }),
  ).not.toBeChecked();
  expect(await history(page)).toHaveLength(0);
  await page.getByRole("checkbox", { name: /synthetic_coach_a/ }).uncheck();
  await page.getByRole("checkbox", { name: /synthetic_coach_b/ }).check();
  await page.getByRole("button", { name: "Сохранить тренеров" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__journalSent);
  expect(calls[1].body.base_version).toBe(2);
  expect(calls[1].body.operation_id).not.toBe(calls[0].body.operation_id);
  expect(await history(page)).toHaveLength(1);
});
for (const state of ["closed", "cancelled"])
  test(`administrator can separately revoke coaches in ${state}, with no addition or reschedule`, async ({
    page,
  }) => {
    await open(page, "administrator", state);
    await expect(
      page.getByRole("button", { name: "Изменить дату и время", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Отменить занятие", exact: true }),
    ).toBeDisabled();
    await coachDialog(page, true);
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(1);
    await page.getByRole("checkbox", { name: /synthetic_coach_a/ }).uncheck();
    await page
      .getByRole("button", { name: "Подтвердить отзыв доступа" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await history(page)).at(-1).body.coach_membership_ids).toEqual([]);
    await page
      .getByRole("button", { name: "Отозвать доступ тренера", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Текущих назначений нет.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  });
for (const failure of ["401", "403", "404"])
  test(`configuration ${failure} hides the form, journal, contacts and prior choices`, async ({
    page,
  }) => {
    await open(page, "administrator");
    await timeDialog(page);
    await fault(page, failure);
    await page.getByRole("button", { name: "Сохранить дату и время" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-oj-heading]")).toHaveCount(0);
    await expect(page.locator(".oj-roster .oj-entry")).toHaveCount(0);
    await expect(
      page.getByText(/Сессия завершена|Журнал и контакты скрыты/),
    ).toBeVisible();
    expect(await history(page)).toHaveLength(0);
  });
test("late coach reads cannot disclose choices after access is denied or the dialog is abandoned", async ({
  page,
}) => {
  await open(page, "administrator");
  await page.evaluate(() => {
    const a = window.__journalFixture,
      staff = a.staff.bind(a);
    a.staff = async () => {
      const value = await staff();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return value;
    };
  });
  await page
    .getByRole("button", { name: "Назначить тренеров", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await fault(page, "403");
  await row(page).getByRole("button", { name: "Был", exact: true }).click();
  await expect(page.locator("[data-oj-heading]")).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("synthetic_coach_a", { exact: false }),
  ).toHaveCount(0);
});
for (const width of [320, 390, 768, 1280])
  test(`configuration dialogs, 200% text, focus and reduced motion at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "administrator");
    await page.addStyleTag({ content: "html { font-size: 200% !important }" });
    for (const action of [
      "Изменить дату и время",
      "Назначить тренеров",
      "Отменить занятие",
    ]) {
      const trigger = page.getByRole("button", { name: action, exact: true });
      await trigger.click();
      if (action === "Назначить тренеров")
        await expect(
          page.getByRole("checkbox", { name: /synthetic_coach_a/ }),
        ).toBeVisible();
      await expect(page.getByLabel("Причина (необязательно)")).toBeVisible();
      expect(
        await page.evaluate(() => {
          const dialog = document.querySelector(".oj-dialog");
          return (
            document.documentElement.scrollWidth > innerWidth ||
            dialog.scrollWidth > dialog.clientWidth + 1
          );
        }),
      ).toBe(false);
      await page.getByLabel("Причина (необязательно)").focus();
      await expect(page.getByLabel("Причина (необязательно)")).toBeFocused();
      if (width === 390 && action === "Изменить дату и время")
        await page.screenshot({
          path: path.resolve(__dirname, "../dist/journal-time-enlarged.png"),
        });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    const durations = await page
      .locator(".oj-root button")
      .first()
      .evaluate((button) => ({
        animation: getComputedStyle(button).animationDuration,
        transition: getComputedStyle(button).transitionDuration,
      }));
    expect(durations).toEqual({ animation: "0s", transition: "0s" });
    expect(errors).toEqual([]);
  });

test("unknown coach assignment freezes selections and focus, then rereads the latest closed state on exact replay", async ({
  page,
}) => {
  await open(page, "administrator");
  await sent(page);
  await coachDialog(page);
  await page.getByRole("checkbox", { name: /synthetic_coach_a/ }).uncheck();
  await page.getByRole("checkbox", { name: /synthetic_coach_b/ }).check();
  await fault(page, "lost-response");
  await page.getByRole("button", { name: "Сохранить тренеров" }).click();
  await expect(page.getByRole("dialog")).toContainText("Результат неизвестен");
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_b/ }),
  ).toBeDisabled();
  const summary = page
    .getByRole("dialog")
    .getByText("История назначений", { exact: true });
  await summary.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Повторить ту же команду" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  await page.evaluate(async (session) => {
    await window.__journalFixture.execute({
      operation: "closeSession",
      sessionId: session,
      body: { operation_id: crypto.randomUUID(), base_version: 2 },
    });
  }, id(501));
  await page.getByRole("button", { name: "Повторить ту же команду" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(/Занятие закрыто\. Существующие активные/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Отозвать доступ тренера", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_b/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /synthetic_coach_a/ }),
  ).toHaveCount(0);
  const calls = await page.evaluate(() =>
    window.__journalSent.filter((c) => c.operation === "setSessionCoaches"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(await history(page)).toHaveLength(2);
});
test("a session crossing midnight shows both club dates and is listed by its start date", async ({
  page,
}) => {
  await open(page, "administrator");
  await timeDialog(page);
  await page.getByLabel("Дата начала", { exact: true }).fill("2026-10-11");
  await page.getByLabel("Время начала", { exact: true }).fill("23:30");
  await page.getByLabel("Дата окончания", { exact: true }).fill("2026-10-12");
  await page.getByLabel("Время окончания", { exact: true }).fill("00:30");
  await page.getByRole("button", { name: "Сохранить дату и время" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Дата занятия", { exact: true })).toHaveValue(
    "2026-10-11",
  );
  await expect(page.locator(".oj-journal")).toContainText("12 октября 2026 г.");
  await expect(page.locator(".oj-session-list")).toContainText("00:30");
  expect((await readJournal(page)).session.ends_at).toBe(
    "2026-10-11T21:30:00.000Z",
  );
});
