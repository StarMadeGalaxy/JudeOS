import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource/rubik/cyrillic-400.css";
import "@fontsource/rubik/cyrillic-500.css";
import "@fontsource/rubik/cyrillic-600.css";
import "@fontsource/rubik/cyrillic-700.css";
import "../../../../design-system/tokens.css";
import { PeopleManager } from "./PeopleManager";
import { SyntheticAdapter, type Fault } from "./synthetic-adapter";
const adapter = new SyntheticAdapter();
// This entry is reached explicitly; the regular app and live API never load it.
function Preview() {
  const [fault, setFault] = useState<Fault>("none");
  return (
    <main>
      <PeopleManager
        adapter={adapter}
        clubName="Синтетический клуб · Минск"
        now={() => adapter.now()}
      />
      <details className="pm-root">
        <summary>Проверка состояний демонстрации</summary>
        <label>
          Следующее действие
          <select
            value={fault}
            onChange={(e) => {
              const value = e.target.value as Fault;
              setFault(value);
              adapter.failNext(value);
            }}
          >
            {Object.entries({
              none: "Обычный ответ",
              network: "Нет сети",
              503: "Сервис недоступен",
              401: "Вход завершён",
              403: "Нет доступа",
              404: "Карточка недоступна",
              conflict: "Конфликт версии",
              "lost-response": "Команда выполнена, ответ потерян",
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Этот переключатель имитирует один ответ адаптера. Он не меняет права
          на сервере.
        </p>
      </details>
    </main>
  );
}
document.body.style.margin = "0";
document.body.style.background = "var(--jp-surface)";
createRoot(document.getElementById("root")!).render(<Preview />);
// Read-only test access to the explicit synthetic preview, absent from the regular app.
Object.defineProperty(window, "__peopleFixture", { value: adapter });
