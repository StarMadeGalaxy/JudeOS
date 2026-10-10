import { useState } from "react";
import "@fontsource/rubik/cyrillic-500.css";
import "@fontsource/rubik/cyrillic-600.css";
import { OnlineJournal } from "./OnlineJournal";
import { roleNames, type DemoRole } from "./model";
import { SyntheticJournalAdapter } from "./synthetic-adapter";

// Explicit demo only: receives no live session, token, account or tenant.
export default function Demo() {
  const [role, setRole] = useState<DemoRole>("coach");
  const [adapter, setAdapter] = useState(() => new SyntheticJournalAdapter());
  const [locked, setLocked] = useState(false);
  const [generation, setGeneration] = useState(0);
  const chooseRole = (value: DemoRole) => {
    if (locked) return;
    setRole(value);
    setAdapter(new SyntheticJournalAdapter(value));
    setGeneration((prior) => prior + 1);
  };
  return (
    <main className="oj-demo-page oj-root">
      <nav aria-label="Возврат в приложение">
        <a
          href="/"
          onClick={(event) => {
            if (
              locked &&
              !confirm(
                "Результат команды ещё не подтверждён. Покинуть демонстрацию и сбросить её память?",
              )
            )
              event.preventDefault();
          }}
        >
          ← К приложению
        </a>
      </nav>
      <div className="oj-demo-controls">
        <label>
          Учебная роль
          <select
            value={role}
            disabled={locked}
            onChange={(event) => chooseRole(event.target.value as DemoRole)}
          >
            {(Object.keys(roleNames) as DemoRole[]).map((r) => (
              <option key={r} value={r}>
                {roleNames[r]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="oj-secondary"
          disabled={locked}
          onClick={() => chooseRole(role)}
        >
          Сбросить демонстрацию
        </button>
      </div>
      <OnlineJournal
        key={generation}
        adapter={adapter}
        onOutstanding={setLocked}
      />
    </main>
  );
}
