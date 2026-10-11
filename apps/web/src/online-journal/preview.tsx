import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource/rubik/cyrillic-400.css";
import "@fontsource/rubik/cyrillic-500.css";
import "@fontsource/rubik/cyrillic-600.css";
import "@fontsource/rubik/cyrillic-700.css";
import "../../../../design-system/tokens.css";
import { OnlineJournal } from "./OnlineJournal";
import { roleNames, type DemoRole } from "./model";
import { SyntheticJournalAdapter, type Fault } from "./synthetic-adapter";

// Deliberate test entry only. No fault controls/test handle in the ordinary app.
function Preview() {
  const initial = new URLSearchParams(location.search).get("role");
  const [role, setRole] = useState<DemoRole>(
    initial === "manager" || initial === "administrator" ? initial : "coach",
  );
  const [adapter, setAdapter] = useState(
    () => new SyntheticJournalAdapter(role),
  );
  const [epoch, setEpoch] = useState(0);
  const [locked, setLocked] = useState(false);
  Object.defineProperty(window, "__journalFixture", {
    configurable: true,
    value: adapter,
  });
  const reset = (value: DemoRole) => {
    setRole(value);
    setAdapter(new SyntheticJournalAdapter(value));
    setEpoch((e) => e + 1);
  };
  return (
    <main className="oj-root oj-demo-page">
      <div className="oj-demo-controls">
        <label>
          Учебная роль
          <select
            value={role}
            disabled={locked}
            onChange={(e) => reset(e.target.value as DemoRole)}
          >
            {(Object.keys(roleNames) as DemoRole[]).map((value) => (
              <option key={value} value={value}>
                {roleNames[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="oj-secondary"
          disabled={locked}
          onClick={() => reset(role)}
        >
          Сбросить демонстрацию
        </button>
      </div>
      <OnlineJournal key={epoch} adapter={adapter} onOutstanding={setLocked} />
      <details>
        <summary>Проверка состояний демонстрации</summary>
        <label>
          Следующий ответ
          <select
            defaultValue="none"
            onChange={(e) => adapter.failNext(e.target.value as Fault)}
          >
            {Object.entries({
              none: "Обычный ответ",
              network: "Ошибка сети",
              "503": "Сервис недоступен",
              "401": "Вход завершён",
              "403": "Нет доступа",
              "404": "Занятие недоступно",
              conflict: "Конфликт версии",
              "lost-response": "Команда принята, ответ потерян",
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Имитируется один ответ адаптера; серверные права этим не проверяются.
        </p>
      </details>
    </main>
  );
}
document.body.style.margin = "0";
document.body.style.background = "var(--jp-surface)";
createRoot(document.getElementById("root")!).render(<Preview />);
