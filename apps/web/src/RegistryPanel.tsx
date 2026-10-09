import { useEffect, useState, type FormEvent } from "react";
import { APIError, errorMessage, request } from "./api";
type Person = {
  person_id: string;
  tenant_id: string;
  display_name: string;
  phone: string | null;
  archived: boolean;
  version: number;
};
type Guardian = {
  guardian_link_id: string;
  representative_person_id: string;
  representative_display_name: string;
  status: "verified" | "revoked";
  basis_kind: string;
  valid_from: string;
  valid_until: string | null;
  version: number;
};
type Athlete = {
  athlete_id: string;
  person: Person;
  participation: "regular" | "guest";
  archived: boolean;
  version: number;
  guardian_links: Guardian[];
  primary_guardian_link_id: string | null;
  primary_contact: { display_name: string; phone: string | null } | null;
};
type Household = {
  household_id: string;
  name: string;
  version: number;
  members: {
    household_member_id: string;
    person_id: string;
    display_name: string;
    valid_from: string;
    valid_until: string | null;
  }[];
};
type Summary = {
  person_id?: string;
  athlete_id?: string;
  household_id?: string;
  display_name?: string;
  name?: string;
  archived?: boolean;
  version: number;
};
type Page = { items: Summary[]; next_cursor: string | null };
class PendingCommandError extends Error {}
type PendingCommand = { path: string; method: string; body: object };
type Kind = "people" | "athletes" | "households";
const today = () =>
  new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const instant = (d: string) => new Date(d + "T00:00:00+03:00").toISOString();
const date = (v: string) =>
  new Date(v).toLocaleDateString("ru-RU", { timeZone: "Europe/Minsk" });
const idOf = (v: Summary) =>
  v.athlete_id || v.household_id || v.person_id || "";
function PersonPicker({
  tenant,
  value,
  onChange,
  label,
}: {
  tenant: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      request<Page>(
        `/api/v1/tenants/${tenant}/people?q=${encodeURIComponent(query)}`,
      )
        .then((v) => {
          if (active) {
            setItems(v.items);
            setCursor(v.next_cursor);
            setStatus("");
          }
        })
        .catch((e) => {
          if (active) {
            setItems([]);
            setStatus(errorMessage(e));
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tenant, query]);
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        Найти человека
        <input
          type="search"
          value={query}
          maxLength={200}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange("");
          }}
        />
      </label>
      <label>
        Выбрать человека
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        >
          <option value="">Выберите карточку</option>
          {items.map((p) => (
            <option key={p.person_id} value={p.person_id}>
              {p.display_name} · №{p.person_id?.slice(-6)}
            </option>
          ))}
        </select>
      </label>
      {cursor && (
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              const v = await request<Page>(
                `/api/v1/tenants/${tenant}/people?q=${encodeURIComponent(query)}&cursor=${cursor}`,
              );
              setItems([...items, ...v.items]);
              setCursor(v.next_cursor);
            } catch (e) {
              setStatus(errorMessage(e));
            }
          }}
        >
          Ещё люди
        </button>
      )}
      <p role="status">{status}</p>
    </fieldset>
  );
}
export function RegistryPanel({ tenant }: { tenant: string }) {
  const [kind, setKind] = useState<Kind>("people");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [page, setPage] = useState<Page>({ items: [], next_cursor: null });
  const [selected, setSelected] = useState<Person | Athlete | Household | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [personID, setPersonID] = useState("");
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState("");
  const [basis, setBasis] = useState("manual_confirmation");
  const root = `/api/v1/tenants/${tenant}/`;
  const person = selected && "person_id" in selected ? selected : null;
  const athlete = selected && "athlete_id" in selected ? selected : null;
  const household = selected && "household_id" in selected ? selected : null;
  async function load(cursor = "") {
    const v = await request<Page>(
      `${root}${kind}?q=${encodeURIComponent(query)}&state=${kind === "households" ? "all" : filter}${cursor ? `&cursor=${cursor}` : ""}`,
    );
    setPage((old) =>
      cursor
        ? { items: [...old.items, ...v.items], next_cursor: v.next_cursor }
        : v,
    );
  }
  useEffect(() => {
    let current = true;
    setSelected((old) =>
      old &&
      ((kind === "people" && "person_id" in old) ||
        (kind === "athletes" && "athlete_id" in old) ||
        (kind === "households" && "household_id" in old))
        ? old
        : null,
    );
    setPage({ items: [], next_cursor: null });
    request<Page>(
      `${root}${kind}?q=${encodeURIComponent(query)}&state=${kind === "households" ? "all" : filter}`,
    )
      .then((v) => {
        if (current) setPage(v);
      })
      .catch((e) => {
        if (current) setStatus(errorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [root, kind, query, filter]);
  async function open(id: string) {
    const v = await request<Person | Athlete | Household>(
      root + kind + "/" + id,
    );
    setSelected(v);
    if ("person_id" in v) {
      setName(v.display_name);
      setPhone(v.phone || "");
    } else if ("household_id" in v) setName(v.name);
    setPersonID("");
  }
  async function act(fn: () => Promise<void>, refreshList = true) {
    setBusy(true);
    setStatus("");
    try {
      await fn();
      setStatus("Изменение сохранено.");
      if (refreshList) await load();
    } catch (e) {
      if (e instanceof APIError && (e.status === 401 || e.status === 403)) {
        setSelected(null);
        setPage({ items: [], next_cursor: null });
      }
      setStatus(
        e instanceof PendingCommandError
          ? "Результат команды неизвестен. Повторите сохранённую команду, чтобы проверить результат."
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function command<T>(path: string, method: string, data: object) {
    const body = { ...data, operation_id: crypto.randomUUID() };
    setPending({ path, method, body });
    try {
      const result = await request<T>(root + path, method, body);
      setPending(null);
      return result;
    } catch (e) {
      if (e instanceof APIError && e.status < 500) {
        setPending(null);
        throw e;
      }
      throw new PendingCommandError();
    }
  }
  async function retry() {
    if (!pending) return;
    await act(async () => {
      try {
        let result = await request<
          | Person
          | Athlete
          | Household
          | { guardian_link_id: string; athlete_id: string }
        >(root + pending.path, pending.method, pending.body);
        setPending(null);
        if ("guardian_link_id" in result)
          result = await request<Athlete>(
            root + "athletes/" + result.athlete_id,
          );
        const targetKind: Kind =
          "athlete_id" in result
            ? "athletes"
            : "household_id" in result
              ? "households"
              : "people";
        setSelected(result);
        if (kind !== targetKind) setKind(targetKind);
        else await load();
      } catch (e) {
        if (e instanceof APIError && e.status < 500) setPending(null);
        throw e;
      }
    }, false);
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      if (kind === "people") {
        const v = await command<Person>("people", "POST", {
          display_name: name,
          phone: phone || null,
        });
        setSelected(v);
      } else {
        const v = await command<Household>("households", "POST", { name });
        setSelected(v);
      }
      setName("");
      setPhone("");
    });
  }
  return (
    <div className="module" aria-label="Реестр клуба">
      <fieldset
        className="registry-controls"
        disabled={busy || Boolean(pending)}
      >
        <h2>Реестр клуба</h2>
        <nav className="tabs" aria-label="Разделы реестра">
          {(
            [
              ["people", "Люди"],
              ["athletes", "Спортсмены"],
              ["households", "Семьи"],
            ] as const
          ).map(([v, title]) => (
            <button
              key={v}
              className={kind === v ? "" : "secondary"}
              aria-pressed={kind === v}
              disabled={busy}
              onClick={() => {
                setKind(v);
                setName("");
                setPhone("");
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setQuery(String(f.get("q") || ""));
          }}
        >
          <label>
            Поиск по имени
            <input name="q" type="search" maxLength={200} />
          </label>
          <button className="secondary" disabled={busy}>
            Найти
          </button>
        </form>
        {kind !== "households" && (
          <label>
            Показывать
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={busy}
            >
              <option value="active">Действующие</option>
              <option value="archived">Архив</option>
              <option value="all">Все записи</option>
            </select>
          </label>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              setSelected(null);
              await load();
            })
          }
        >
          Обновить реестр
        </button>
        <ul className="records">
          {page.items.map((item) => (
            <li key={idOf(item)}>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act(() => open(idOf(item)), false)}
              >
                {item.display_name || item.name} · №{idOf(item).slice(-6)}
                {item.archived ? " · Архив" : ""}
              </button>
            </li>
          ))}
        </ul>
        {!page.items.length && <p>Записей не найдено.</p>}
        {page.next_cursor && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act(() => load(page.next_cursor!), false)}
          >
            Следующая страница
          </button>
        )}
        {!selected && kind !== "athletes" && (
          <form onSubmit={create}>
            <h3>{kind === "people" ? "Новый человек" : "Новая семья"}</h3>
            <label>
              {kind === "people" ? "Отображаемое имя" : "Название семьи"}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </label>
            {kind === "people" && (
              <label>
                Телефон (необязательно)
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={50}
                />
              </label>
            )}
            <p>
              {kind === "people"
                ? "Человек добавляется отдельной карточкой. Совпадение имени или телефона не объединяет записи."
                : "Семья объединяет записи для учёта. Доступ представителей проверяется отдельно."}
            </p>
            <button disabled={busy}>
              Добавить {kind === "people" ? "человека" : "семью"}
            </button>
          </form>
        )}
        {!selected && kind === "athletes" && (
          <p>
            Откройте карточку человека в разделе «Люди», чтобы записать его как
            спортсмена.
          </p>
        )}
        {selected && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setName("");
              setPhone("");
              setPersonID("");
            }}
          >
            Закрыть карточку
          </button>
        )}
        {person && (
          <article className="record">
            <h3>
              {person.display_name}
              {person.archived ? " · Архив" : ""}
            </h3>
            {!person.archived && (
              <>
                <form
                  key={person.person_id + "-" + person.version}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act(async () =>
                      setSelected(
                        await command<Person>(
                          `people/${person.person_id}`,
                          "PUT",
                          {
                            base_version: person.version,
                            display_name: f.get("name"),
                            phone: f.get("phone") || null,
                          },
                        ),
                      ),
                    );
                  }}
                >
                  <label>
                    Имя в карточке
                    <input
                      name="name"
                      defaultValue={person.display_name}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Телефон в карточке
                    <input
                      name="phone"
                      type="tel"
                      defaultValue={person.phone || ""}
                      maxLength={50}
                    />
                  </label>
                  <button disabled={busy}>Сохранить человека</button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act(async () => {
                      const v = await command<Athlete>("athletes", "POST", {
                        person_id: person.person_id,
                        participation: f.get("participation"),
                      });
                      setKind("athletes");
                      setSelected(v);
                    }, false);
                  }}
                >
                  <label>
                    Участие спортсмена
                    <select name="participation">
                      <option value="regular">Регулярное</option>
                      <option value="guest">Гостевое</option>
                    </select>
                  </label>
                  <button disabled={busy}>Записать как спортсмена</button>
                </form>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Архивировать ${person.display_name}? Проверенные связи будут отозваны, контакт скрыт.`,
                      )
                    )
                      void act(async () =>
                        setSelected(
                          await command<Person>(
                            `people/${person.person_id}/archive`,
                            "POST",
                            { base_version: person.version },
                          ),
                        ),
                      );
                  }}
                >
                  Архивировать человека
                </button>
              </>
            )}
          </article>
        )}
        {athlete && (
          <article className="record">
            <h3>
              {athlete.person.display_name}
              {athlete.archived ? " · Архив" : ""}
            </h3>
            <p>
              Основной контакт:{" "}
              {athlete.primary_contact
                ? `${athlete.primary_contact.display_name} · ${athlete.primary_contact.phone || "телефон не указан"}`
                : "не выбран или связь не действует"}
              .
            </p>
            {!athlete.archived && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () =>
                    setSelected(
                      await command<Athlete>(
                        `athletes/${athlete.athlete_id}`,
                        "PUT",
                        {
                          base_version: athlete.version,
                          participation: f.get("participation"),
                        },
                      ),
                    ),
                  );
                }}
              >
                <label>
                  Вид участия
                  <select
                    name="participation"
                    defaultValue={athlete.participation}
                  >
                    <option value="regular">Регулярное</option>
                    <option value="guest">Гостевое</option>
                  </select>
                </label>
                <button disabled={busy}>Сохранить участие</button>
              </form>
            )}
            <h4>Проверенные представители</h4>
            <ul>
              {athlete.guardian_links.map((g) => (
                <li key={g.guardian_link_id}>
                  {g.representative_display_name} · №
                  {g.representative_person_id.slice(-6)} ·{" "}
                  {g.status === "revoked"
                    ? "связь отозвана"
                    : g.valid_until && new Date(g.valid_until) <= new Date()
                      ? "срок истёк"
                      : "проверено"}{" "}
                  · {date(g.valid_from)}
                  {g.valid_until ? ` — ${date(g.valid_until)}` : ""}
                  {!athlete.archived && g.status === "verified" && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            setSelected(
                              await command<Athlete>(
                                `athletes/${athlete.athlete_id}/primary-contact`,
                                "PUT",
                                {
                                  base_version: athlete.version,
                                  guardian_link_id: g.guardian_link_id,
                                },
                              ),
                            ),
                          )
                        }
                      >
                        Выбрать основным контактом
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          if (confirm("Отозвать проверенную связь?"))
                            void act(async () =>
                              setSelected(
                                await command<Athlete>(
                                  `athletes/${athlete.athlete_id}/guardian-links/${g.guardian_link_id}/revoke`,
                                  "POST",
                                  { base_version: athlete.version },
                                ),
                              ),
                            );
                        }}
                      >
                        Отозвать связь
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {!athlete.archived && (
              <>
                <button
                  className="secondary"
                  disabled={busy || !athlete.primary_guardian_link_id}
                  onClick={() =>
                    void act(async () =>
                      setSelected(
                        await command<Athlete>(
                          `athletes/${athlete.athlete_id}/primary-contact`,
                          "PUT",
                          {
                            base_version: athlete.version,
                            guardian_link_id: null,
                          },
                        ),
                      ),
                    )
                  }
                >
                  Снять основной контакт
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      !confirm(
                        "Вы проверили право этого человека представлять спортсмена?",
                      )
                    )
                      return;
                    void act(async () => {
                      await command(
                        `athletes/${athlete.athlete_id}/guardian-links`,
                        "POST",
                        {
                          base_version: athlete.version,
                          representative_person_id: personID,
                          basis_kind: basis,
                          valid_from: instant(from),
                          valid_until: until ? instant(until) : null,
                        },
                      );
                      await open(athlete.athlete_id);
                    });
                  }}
                >
                  <PersonPicker
                    tenant={tenant}
                    value={personID}
                    onChange={setPersonID}
                    label="Выберите представителя"
                  />
                  <label>
                    Основание проверки
                    <input
                      value={basis}
                      onChange={(e) => setBasis(e.target.value)}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Начало действия
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Действует до (не включая дату)
                    <input
                      type="date"
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                      min={from}
                    />
                  </label>
                  <p>
                    Укажите краткое основание проверки без документов и
                    медицинских сведений. Родство или общий телефон сами по себе
                    прав не дают.
                  </p>
                  <button disabled={busy || !personID}>
                    Подтвердить проверенную связь
                  </button>
                </form>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm("Архивировать спортсмена и отозвать его связи?")
                    )
                      void act(async () =>
                        setSelected(
                          await command<Athlete>(
                            `athletes/${athlete.athlete_id}/archive`,
                            "POST",
                            { base_version: athlete.version },
                          ),
                        ),
                      );
                  }}
                >
                  Архивировать спортсмена
                </button>
              </>
            )}
          </article>
        )}
        {household && (
          <article className="record">
            <h3>{household.name}</h3>
            <form
              key={household.household_id + "-" + household.version}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(async () =>
                  setSelected(
                    await command<Household>(
                      `households/${household.household_id}`,
                      "PUT",
                      { base_version: household.version, name: f.get("name") },
                    ),
                  ),
                );
              }}
            >
              <label>
                Название в карточке семьи
                <input
                  name="name"
                  defaultValue={household.name}
                  required
                  maxLength={200}
                />
              </label>
              <button disabled={busy}>Сохранить семью</button>
            </form>
            <ul>
              {household.members.map((m) => (
                <li key={m.household_member_id}>
                  {m.display_name} · {date(m.valid_from)}
                  {m.valid_until ? ` — ${date(m.valid_until)}` : " · действует"}
                  {!m.valid_until && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void act(async () =>
                          setSelected(
                            await command<Household>(
                              `households/${household.household_id}/members/${m.household_member_id}/end`,
                              "POST",
                              {
                                base_version: household.version,
                                valid_until: instant(String(f.get("until"))),
                              },
                            ),
                          ),
                        );
                      }}
                    >
                      <label>
                        Дата окончания членства
                        <input
                          name="until"
                          type="date"
                          defaultValue={today()}
                          required
                        />
                      </label>
                      <button className="secondary" disabled={busy}>
                        Завершить членство в семье
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () =>
                  setSelected(
                    await command<Household>(
                      `households/${household.household_id}/members`,
                      "POST",
                      {
                        base_version: household.version,
                        person_id: personID,
                        valid_from: instant(from),
                        valid_until: until ? instant(until) : null,
                      },
                    ),
                  ),
                );
              }}
            >
              <PersonPicker
                tenant={tenant}
                value={personID}
                onChange={setPersonID}
                label="Добавить человека в семью"
              />
              <label>
                В семье с
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  required
                />
              </label>
              <label>
                В семье до (не включая дату)
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  min={from}
                />
              </label>
              <button disabled={busy || !personID}>Добавить члена семьи</button>
            </form>
          </article>
        )}
      </fieldset>
      {pending && (
        <aside className="invitation">
          <p>
            Подтверждение сохранения не получено. Данные команды сохраняются до
            ответа или выхода из клуба.
          </p>
          <button disabled={busy} onClick={() => void retry()}>
            Повторить сохранённую команду
          </button>
        </aside>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
