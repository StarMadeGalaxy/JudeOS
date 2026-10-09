import { useState } from "react";
import "@fontsource/rubik/cyrillic-500.css";
import "@fontsource/rubik/cyrillic-600.css";
import { PeopleManager } from "./PeopleManager";
import { SyntheticAdapter } from "./synthetic-adapter";

// Explicit demo entry; no access to the real account, club or fragment token.
export default function Demo() {
  const [adapter] = useState(() => new SyntheticAdapter());
  return (
    <main className="pm-demo-page">
      <nav className="pm-root" aria-label="Возврат в приложение">
        <a className="pm-app-link" href="/">
          ← К приложению
        </a>
      </nav>
      <PeopleManager
        adapter={adapter}
        clubName="Синтетический клуб · Минск"
        now={() => adapter.now()}
      />
    </main>
  );
}
