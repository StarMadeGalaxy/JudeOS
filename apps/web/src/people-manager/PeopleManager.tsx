import { useEffect, useRef, useState, useId, type FormEvent } from "react";
import {
  activeGuardian,
  activePeriod,
  displayDate,
  idOf,
  RegistryError,
  toInputDate,
  toWireDate,
  type RegistryAdapter,
  type Kind,
  type State,
  type Command,
  type Person,
  type Athlete,
  type Household,
  type Pages,
} from "./model";
import "./people-manager.css";

type Item = {
  id: string;
  name: string;
  archived?: boolean;
  participation?: string;
};
type Detail = { kind: Kind; id: string; value: Person | Athlete | Household };
type FormMode =
  | "createPerson"
  | "updatePerson"
  | "createAthlete"
  | "updateAthlete"
  | "verifyGuardianLink"
  | "createHousehold"
  | "updateHousehold"
  | "addHouseholdMember"
  | "endHouseholdMember"
  | "archivePerson"
  | "archiveAthlete"
  | "revokeGuardianLink";
type Editing = { mode: FormMode; memberId?: string; starts?: string };
const names: Record<Kind, string> = {
  people: "Люди",
  athletes: "Спортсмены",
  households: "Семьи",
};
const titles: Record<FormMode, string> = {
  createPerson: "Новый человек",
  updatePerson: "Изменить профиль",
  createAthlete: "Спортивное участие",
  updateAthlete: "Изменить участие",
  verifyGuardianLink: "Проверить представительство",
  createHousehold: "Новая семья",
  updateHousehold: "Изменить название семьи",
  addHouseholdMember: "Добавить члена семьи",
  endHouseholdMember: "Завершить период",
  archivePerson: "Архивировать человека",
  archiveAthlete: "Архивировать спортсмена",
  revokeGuardianLink: "Отозвать представительство",
};
const uuid = () => crypto.randomUUID();
const syntheticSaved =
  "Изменение сохранено в памяти демонстрации. На сервер не отправлено.";
function itemsFrom(kind: Kind, page: Pages[Kind]): Item[] {
  if (kind === "people")
    return (page as Pages["people"]).items.map((p) => ({
      id: p.person_id,
      name: p.display_name,
      archived: p.archived,
    }));
  if (kind === "athletes")
    return (page as Pages["athletes"]).items.map((a) => ({
      id: a.athlete_id,
      name: a.display_name,
      archived: a.archived,
      participation: a.participation,
    }));
  return (page as Pages["households"]).items.map((h) => ({
    id: h.household_id,
    name: h.name,
  }));
}
function message(error: unknown, isCommand = false): string {
  if (!(error instanceof RegistryError))
    return "Не удалось выполнить действие. Попробуйте ещё раз.";
  if (error.status === 0)
    return isCommand
      ? "Ответ не получен. Изменение могло выполниться. Повторите исходную команду."
      : "Нет связи. Не удалось загрузить данные. Повторите загрузку.";
  if (error.status === 401)
    return "Вход завершён. Войдите снова; данные скрыты.";
  if (error.status === 403)
    return "Нет доступа к реестру этого клуба. Проверьте назначенные права.";
  if (error.status === 404)
    return "Карточка недоступна. Она могла измениться или находиться в другом клубе.";
  if (error.status === 503 || error.status === 429)
    return "Сервис временно недоступен. Повторите позже.";
  if (error.status === 409)
    return (
      (
        {
          ENTITY_VERSION_CONFLICT:
            "Карточка изменилась. Перечитайте её и проверьте данные перед новой командой.",
          RESULT_NOT_CURRENT:
            "Результат команды устарел. Перечитайте карточку; прежние контакты не показываются.",
          OPERATION_ID_REUSED:
            "Команда с этим номером уже использована. Перечитайте карточку перед новым действием.",
          PERSON_ARCHIVED: "Карточка в архиве. Изменение недоступно.",
          ATHLETE_ALREADY_EXISTS:
            "Спортивное участие для этого человека уже существует.",
          GUARDIAN_LINK_INACTIVE:
            "Связь больше не действует. Перечитайте карточку.",
          MEMBERSHIP_ENDED:
            "У периода уже указана дата окончания. Изменять её нельзя.",
        } as Record<string, string>
      )[error.code] || "Изменение отклонено. Перечитайте карточку."
    );
  return "Проверьте поля формы. Изменение не сохранено.";
}
function Field({
  label,
  name,
  value,
  required = false,
  maxLength,
  type = "text",
  hint,
  error,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
  maxLength?: number;
  type?: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="pm-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={maxLength}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
      />
      {(hint || error) && (
        <p id={`${id}-help`} className={error ? "pm-field-error" : "pm-muted"}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
function PersonPicker({
  adapter,
  onSelect,
  selected,
  label,
}: {
  adapter: RegistryAdapter;
  onSelect: (id: string) => void;
  selected: string;
  label: string;
}) {
  const [q, setQ] = useState(""),
    [items, setItems] = useState<Item[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const generation = useRef(0),
    id = useId();
  async function load(next?: string) {
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const p = await adapter.list("people", {
        q,
        state: "active",
        limit: 6,
        cursor: next,
      });
      if (ticket === generation.current) {
        setItems((previous) =>
          next
            ? [...previous, ...itemsFrom("people", p)]
            : itemsFrom("people", p),
        );
        setCursor(p.next_cursor);
      }
    } catch (e) {
      if (ticket === generation.current) setError(message(e));
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [q, retry]);
  return (
    <fieldset className="pm-picker">
      <legend>{label}</legend>
      <label htmlFor={id}>Поиск человека по имени</label>
      <input
        id={id}
        type="search"
        maxLength={200}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onSelect("");
        }}
      />
      <p className="pm-muted">
        Совпадение имени не объединяет карточки. Выберите нужного человека явно.
      </p>
      {items.map((p, i) => (
        <label className="pm-choice" key={p.id}>
          <input
            type="radio"
            name={`${id}-person`}
            value={p.id}
            checked={selected === p.id}
            onChange={() => onSelect(p.id)}
          />
          <span>
            {p.name}
            <small>Отдельная запись {i + 1}</small>
          </span>
        </label>
      ))}
      {!loading && !error && items.length === 0 && (
        <p>Людей не найдено. Сначала создайте отдельный профиль человека.</p>
      )}
      {loading && <p role="status">Загружаем людей…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="pm-secondary"
            onClick={() => setRetry((v) => v + 1)}
          >
            Повторить поиск
          </button>
        </div>
      )}
      {cursor && (
        <button
          type="button"
          className="pm-secondary"
          disabled={loading}
          onClick={() => load(cursor)}
        >
          Ещё люди
        </button>
      )}
    </fieldset>
  );
}

export function PeopleManager({
  adapter,
  clubName,
  now = Date.now,
}: {
  adapter: RegistryAdapter;
  clubName: string;
  now?: () => number;
}) {
  const [kind, setKind] = useState<Kind>("people"),
    [state, setState] = useState<State>("active"),
    [search, setSearch] = useState(""),
    [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [listBusy, setListBusy] = useState(false),
    [listError, setListError] = useState(""),
    [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null),
    [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null),
    [formErrors, setFormErrors] = useState<Record<string, string>>({}),
    [chosenPerson, setChosenPerson] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Command | null>(null),
    [commandError, setCommandError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const listGeneration = useRef(0),
    detailGeneration = useRef(0),
    titleRef = useRef<HTMLHeadingElement>(null),
    formRef = useRef<HTMLFormElement>(null),
    returnButton = useRef<HTMLButtonElement | null>(null);
  const searchId = useId(),
    stateId = useId();
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);
  const locked =
    busy ||
    pending !== null ||
    (commandError instanceof RegistryError && commandError.status === 409);
  async function loadList(next?: string) {
    const ticket = ++listGeneration.current;
    setListBusy(true);
    setListError("");
    try {
      const page = await adapter.list(kind, {
        q,
        state,
        cursor: next,
        limit: 6,
      });
      if (ticket === listGeneration.current) {
        setItems((previous) =>
          next
            ? [...previous, ...itemsFrom(kind, page)]
            : itemsFrom(kind, page),
        );
        setCursor(page.next_cursor);
      }
    } catch (e) {
      if (ticket === listGeneration.current) {
        setListError(message(e));
        if (
          e instanceof RegistryError &&
          (e.status === 401 || e.status === 403)
        ) {
          setItems([]);
          setDetail(null);
        }
      }
    } finally {
      if (ticket === listGeneration.current) setListBusy(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    void loadList();
    return () => {
      listGeneration.current++;
    };
  }, [kind, state, q, revision]);
  useEffect(() => {
    if (detail || editing) titleRef.current?.focus();
  }, [detail?.id, editing?.mode]);
  useEffect(() => {
    if (detail?.kind === "athletes") {
      const a = detail.value as Athlete;
      const link = a.guardian_links.find(
        (g) => g.guardian_link_id === a.primary_guardian_link_id,
      );
        // Read the actual clock: a profile may arrive between interval ticks.
        if (a.primary_contact && (!link || !activeGuardian(link, now())))
        setDetail({ ...detail, value: { ...a, primary_contact: null } });
    }
  }, [detail, clock, now]);
  async function open(kind: Kind, id: string) {
    const ticket = ++detailGeneration.current;
    setDetailBusy(true);
    setDetailError("");
    setDetail(null);
    setEditing(null);
    setCommandError(null);
    setNotice("");
    try {
      const value = await adapter.get(kind, id);
      if (ticket === detailGeneration.current) setDetail({ kind, id, value });
    } catch (e) {
      if (ticket === detailGeneration.current) {
        setDetailError(message(e));
        if (
          e instanceof RegistryError &&
          (e.status === 401 || e.status === 403)
        )
          setItems([]);
      }
    } finally {
      if (ticket === detailGeneration.current) setDetailBusy(false);
    }
  }
  function begin(mode: FormMode, memberId?: string, starts?: string) {
    if (locked) return;
    setEditing({ mode, memberId, starts });
    setChosenPerson("");
    setFormErrors({});
    setCommandError(null);
    setNotice("");
  }
  function back() {
    detailGeneration.current++;
    setDetail(null);
    setEditing(null);
    setDetailError("");
    setDetailBusy(false);
    setCommandError(null);
    setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>(
        `[data-card-id="${returnButton.current?.dataset.cardId}"]`,
      );
      button?.focus();
    }, 0);
  }
  async function run(command: Command) {
    if (busy) return;
    setBusy(true);
    setCommandError(null);
    setNotice("");
    try {
      const response = await adapter.execute(command);
      setPending(null);
      setEditing(null);
      // Verify changes raise Athlete.version; read the parent before any further command.
      const nextKind: Kind = command.operation.includes("Household")
        ? "households"
        : command.operation.includes("Person")
          ? "people"
          : "athletes";
      const nextId =
        command.operation === "verifyGuardianLink"
          ? command.target
          : idOf(response.value);
      try {
        const value = await adapter.get(nextKind, nextId);
        setDetail({ kind: nextKind, id: nextId, value });
        setDetailError("");
      } catch (e) {
        setDetail(null);
        setDetailError(
          `Команда выполнена, но карточка не загружена. ${message(e)}`,
        );
      }
      setNotice(
        (response.replayed ? "Исходная команда подтверждена повторно. " : "") +
          (adapter.mode === "synthetic"
            ? syntheticSaved
            : "Изменение подтверждено сервером."),
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setCommandError(e);
      if (e instanceof RegistryError && e.status === 0) setPending(command);
      else setPending(null);
      if (
        e instanceof RegistryError &&
        (e.status === 401 || e.status === 403 || e.status === 404)
      ) {
        setDetail(null);
        setEditing(null);
        setItems([]);
      }
      if (
        e instanceof RegistryError &&
        e.status === 409 &&
        detail?.kind === "athletes"
      )
        setDetail({
          ...detail,
          value: { ...(detail.value as Athlete), primary_contact: null },
        });
    } finally {
      setBusy(false);
    }
  }
  function version() {
    return detail!.value.version;
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || locked) return;
    const data = new FormData(e.currentTarget),
      errors: Record<string, string> = {};
    const text = (name: string, max: number) => {
      const s = String(data.get(name) || "").trim();
      if (!s || s.length > max)
        errors[name] = `Введите непустое значение до ${max} символов.`;
      return s;
    };
    const period = () => {
      const from = String(data.get("from") || ""),
        until = String(data.get("until") || "");
      let valid_from = "",
        valid_until: string | null = null;
      try {
        valid_from = toWireDate(from);
        if (until) valid_until = toWireDate(until);
        if (valid_until && valid_until <= valid_from)
          errors.until = "Окончание должно быть позже начала.";
      } catch {
        errors.from = "Укажите корректную дату и время.";
      }
      return { valid_from, valid_until };
    };
    const op = editing.mode,
      operation_id = uuid();
    let command: Command | null = null;
    const target = detail?.id || "",
      base_version = detail?.value.version || 1;
    if (op === "createPerson" || op === "updatePerson") {
      const display_name = text("name", 200),
        phone = String(data.get("phone") || "").trim() || null;
      if (phone && phone.length > 50) errors.phone = "Номер — до 50 символов.";
      command =
        op === "createPerson"
          ? {
              operation: op,
              target: "",
              body: { operation_id, display_name, phone },
            }
          : {
              operation: op,
              target,
              body: { operation_id, base_version, display_name, phone },
            };
    } else if (op === "createHousehold" || op === "updateHousehold") {
      const name = text("name", 200);
      command =
        op === "createHousehold"
          ? { operation: op, target: "", body: { operation_id, name } }
          : {
              operation: op,
              target,
              body: { operation_id, base_version, name },
            };
    } else if (op === "createAthlete" || op === "updateAthlete") {
      const participation =
        data.get("participation") === "guest" ? "guest" : "regular";
      command =
        op === "createAthlete"
          ? {
              operation: op,
              target: "",
              body: {
                operation_id,
                person_id: (detail!.value as Person).person_id,
                participation,
              },
            }
          : {
              operation: op,
              target,
              body: { operation_id, base_version, participation },
            };
    } else if (op === "verifyGuardianLink" || op === "addHouseholdMember") {
      if (!chosenPerson)
        errors.person = "Выберите отдельную карточку человека.";
      const dates = period();
      command =
        op === "verifyGuardianLink"
          ? {
              operation: op,
              target,
              body: {
                operation_id,
                base_version,
                representative_person_id: chosenPerson,
                basis_kind: text("basis", 80),
                ...dates,
              },
            }
          : {
              operation: op,
              target,
              body: {
                operation_id,
                base_version,
                person_id: chosenPerson,
                ...dates,
              },
            };
    } else if (op === "endHouseholdMember") {
      let valid_until = "";
      try {
        valid_until = toWireDate(String(data.get("until") || ""));
        if (valid_until <= editing.starts!)
          errors.until = "Окончание должно быть позже начала периода.";
      } catch {
        errors.until = "Укажите корректную дату и время.";
      }
      command = {
        operation: op,
        target: `${target}/${editing.memberId}`,
        body: { operation_id, base_version, valid_until },
      };
    } else if (op === "revokeGuardianLink")
      command = {
        operation: op,
        target: `${target}/${editing.memberId}`,
        body: { operation_id, base_version },
      };
    else
      command = { operation: op, target, body: { operation_id, base_version } };
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setTimeout(
        () =>
          formRef.current
            ?.querySelector<HTMLElement>('[aria-invalid="true"]')
            ?.focus(),
        0,
      );
      return;
    }
    if (command) await run(command);
  }
  const person = detail?.kind === "people" ? (detail.value as Person) : null;
  const athlete =
    detail?.kind === "athletes" ? (detail.value as Athlete) : null;
  const household =
    detail?.kind === "households" ? (detail.value as Household) : null;
  const archived =
    person?.archived || athlete?.archived || athlete?.person.archived;
  const form = editing && (
    <form ref={formRef} className="pm-form" onSubmit={submit} aria-busy={busy}>
      <h2 ref={titleRef} tabIndex={-1}>
        {titles[editing.mode]}
      </h2>
      <fieldset className="pm-form-lock" disabled={locked}>
        {(editing.mode === "createPerson" ||
          editing.mode === "updatePerson") && (
          <>
            <Field
              name="name"
              label="Полное имя"
              value={person?.display_name}
              required
              maxLength={200}
              error={formErrors.name}
            />
            <Field
              name="phone"
              label="Телефон (необязательно)"
              value={person?.phone ?? ""}
              maxLength={50}
              type="tel"
              hint="Отсутствие номера не мешает создать профиль."
              error={formErrors.phone}
            />
            <p className="pm-muted">
              Аккаунт, семья и представитель не требуются. Одинаковые имена
              сохраняются отдельно.
            </p>
          </>
        )}
        {(editing.mode === "createHousehold" ||
          editing.mode === "updateHousehold") && (
          <Field
            name="name"
            label="Название семьи"
            value={household?.name}
            required
            maxLength={200}
            error={formErrors.name}
          />
        )}
        {(editing.mode === "createAthlete" ||
          editing.mode === "updateAthlete") && (
          <fieldset>
            <legend>Тип участия</legend>
            <label className="pm-choice">
              <input
                type="radio"
                name="participation"
                value="regular"
                defaultChecked={!athlete || athlete.participation === "regular"}
              />
              Постоянный участник
            </label>
            <label className="pm-choice">
              <input
                type="radio"
                name="participation"
                value="guest"
                defaultChecked={athlete?.participation === "guest"}
              />
              Гость
            </label>
            <p className="pm-muted">
              Это спортивный профиль, без автоматического зачисления в группу
              или занятие.
            </p>
          </fieldset>
        )}
        {(editing.mode === "verifyGuardianLink" ||
          editing.mode === "addHouseholdMember") && (
          <>
            <PersonPicker
              adapter={adapter}
              selected={chosenPerson}
              onSelect={setChosenPerson}
              label={
                editing.mode === "verifyGuardianLink"
                  ? "Представитель"
                  : "Человек"
              }
            />
            {formErrors.person && (
              <p role="alert" className="pm-field-error">
                {formErrors.person}
              </p>
            )}
            {editing.mode === "verifyGuardianLink" && (
              <>
                <Field
                  name="basis"
                  label="Основание проверки"
                  required
                  maxLength={80}
                  error={formErrors.basis}
                  hint="Краткое описание проверки. Без документов и медицинских сведений."
                />
                <p>
                  Подтверждаю проверку связи именно с этим спортсменом. Семья и
                  телефон не доказывают представительство.
                </p>
              </>
            )}
            <Field
              name="from"
              label="Действует с (Минск)"
              type="datetime-local"
              required
              value={toInputDate(new Date(now()).toISOString())}
              error={formErrors.from}
            />
            <Field
              name="until"
              label="Действует до (Минск, необязательно)"
              type="datetime-local"
              error={formErrors.until}
              hint="Окончание не входит в период; пустое значение — без даты окончания."
            />
          </>
        )}
        {editing.mode === "endHouseholdMember" && (
          <>
            <p>
              Начало периода: {displayDate(editing.starts!)}. Уже установленное
              окончание изменить нельзя.
            </p>
            <Field
              name="until"
              label="Окончание периода (Минск)"
              type="datetime-local"
              required
              value={toInputDate(new Date(now()).toISOString())}
              error={formErrors.until}
            />
          </>
        )}
        {editing.mode === "archivePerson" && (
          <p>
            Телефон будет очищен, спортивный профиль архивирован, связанные
            представительства и основной контакт отозваны. Имя и разрешённая
            история сохранятся. Независимые права сотрудника не отзываются.
            Восстановление из архива не предусмотрено.
          </p>
        )}
        {editing.mode === "archiveAthlete" && (
          <p>
            Спортивный профиль станет архивным, его представительства и основной
            контакт будут отозваны. Профиль человека и разрешённая история
            сохранятся. Восстановление из архива не предусмотрено.
          </p>
        )}
        {editing.mode === "revokeGuardianLink" && (
          <p>
            Представительство прекратит действие. Если эта связь выбрана
            основной, контакт будет скрыт без автоматической замены. История
            проверки сохранится.
          </p>
        )}
        <div className="pm-actions">
          <button disabled={locked}>
            {busy
              ? "Сохраняем…"
              : editing.mode === "verifyGuardianLink"
                ? "Подтвердить проверку"
                : editing.mode.startsWith("archive")
                  ? "Подтвердить архивирование"
                  : editing.mode === "revokeGuardianLink"
                    ? "Подтвердить отзыв"
                    : "Сохранить"}
          </button>
          <button
            type="button"
            className="pm-secondary"
            disabled={locked}
            onClick={() => {
              if (detail) setEditing(null);
              else back();
            }}
          >
            Отмена
          </button>
        </div>
      </fieldset>
    </form>
  );
  return (
    <div className="pm-root">
      <header className="pm-header">
        <div>
          <p className="pm-brand">
            JUDO PRIDE <span>JudeOS</span>
          </p>
          <h1>Люди и семьи</h1>
          <p>{clubName}</p>
        </div>
        <span className="pm-badge">Реестр клуба</span>
      </header>
      {adapter.mode === "synthetic" && (
        <aside className="pm-demo" aria-label="Синтетический режим">
          <strong>Демонстрация · синтетические данные</strong>
          <p>
            Изменения сохраняются только в памяти вкладки. Обновление страницы
            сбросит их. Сервер не подключён.
          </p>
        </aside>
      )}
      <nav className="pm-tabs" aria-label="Разделы реестра">
        {(Object.keys(names) as Kind[]).map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            disabled={locked}
            onClick={() => {
              setKind(k);
              setState("active");
              setQ("");
              setSearch("");
              back();
            }}
          >
            {names[k]}
          </button>
        ))}
      </nav>
      <div role="status" aria-live="polite" className="pm-notice">
        {notice}
      </div>
      {commandError !== null && (
        <div role="alert" className="pm-error">
          <p>{message(commandError, true)}</p>
          {pending ? (
            <button disabled={busy} onClick={() => run(pending)}>
              Повторить ту же команду
            </button>
          ) : detail &&
            commandError instanceof RegistryError &&
            commandError.status === 409 ? (
            <button
              disabled={busy}
              onClick={() => open(detail.kind, detail.id)}
            >
              Перечитать карточку
            </button>
          ) : null}
        </div>
      )}
      {detail || detailBusy || detailError || editing ? (
        <section className="pm-detail" aria-busy={detailBusy}>
          <button
            className="pm-secondary pm-back"
            disabled={locked}
            onClick={back}
          >
            ← К списку
          </button>
          {detailBusy && <p role="status">Загружаем карточку…</p>}
          {detailError && (
            <div role="alert">
              <p>{detailError}</p>
              <p>Вернитесь к списку и откройте карточку ещё раз.</p>
            </div>
          )}
          {form ||
            (detail && (
              <>
                <h2 ref={titleRef} tabIndex={-1}>
                  {person?.display_name ||
                    athlete?.person.display_name ||
                    household?.name}
                </h2>
                <p className="pm-muted">
                  {household
                    ? "Семья · периоды участия"
                    : archived
                      ? "В архиве · доступна разрешённая история"
                      : athlete
                        ? athlete.participation === "regular"
                          ? "Постоянный участник"
                          : "Гость"
                        : "Профиль человека"}
                </p>
                {person && (
                  <>
                    <dl>
                      <dt>Телефон</dt>
                      <dd>{person.phone || "Не указан"}</dd>
                      <dt>Аккаунт</dt>
                      <dd>Для профиля не требуется</dd>
                    </dl>
                    {!archived && (
                      <div className="pm-actions">
                        <button
                          disabled={locked}
                          onClick={() => begin("updatePerson")}
                        >
                          Изменить профиль
                        </button>
                        <button
                          className="pm-secondary"
                          disabled={locked}
                          onClick={() => begin("createAthlete")}
                        >
                          Добавить спортивное участие
                        </button>
                        <button
                          className="pm-secondary"
                          disabled={locked}
                          onClick={() => begin("archivePerson")}
                        >
                          В архив
                        </button>
                      </div>
                    )}
                  </>
                )}
                {athlete && (
                  <>
                    <div className="pm-contact">
                      <h3>Основной контакт</h3>
                      {athlete.primary_contact ? (
                        <>
                          <strong>
                            {athlete.primary_contact.display_name}
                          </strong>
                          <p>
                            {athlete.primary_contact.phone ||
                              "Телефон не указан"}
                          </p>
                        </>
                      ) : (
                        <p>Не выбран или связь больше не действует.</p>
                      )}
                      <p className="pm-muted">
                        Только одна действующая проверенная связь.
                        Автоматической замены нет.
                      </p>
                    </div>
                    {!archived && (
                      <>
                        <div className="pm-actions">
                          <button
                            disabled={locked}
                            onClick={() => begin("verifyGuardianLink")}
                          >
                            Проверить представительство
                          </button>
                          <button
                            className="pm-secondary"
                            disabled={locked}
                            onClick={() => begin("updateAthlete")}
                          >
                            Изменить участие
                          </button>
                          <button
                            className="pm-secondary"
                            disabled={locked}
                            onClick={() => begin("archiveAthlete")}
                          >
                            В архив
                          </button>
                        </div>
                      </>
                    )}
                    <h3>Представительства и история</h3>
                    {athlete.guardian_links.length === 0 ? (
                      <p>
                        Проверенных связей пока нет. Семья не создаёт их
                        автоматически.
                      </p>
                    ) : (
                      <ul className="pm-records">
                        {athlete.guardian_links.map((g) => {
                          const active = activeGuardian(g, now()) && !archived;
                          return (
                            <li key={g.guardian_link_id}>
                              <h4>
                                {g.representative_display_name ||
                                  "Представитель"}
                              </h4>
                              <p>
                                {g.status === "revoked"
                                  ? "Отозвана"
                                  : active
                                    ? "Проверена · действует"
                                    : Date.parse(g.valid_from) > now()
                                      ? "Проверена · ещё не действует"
                                      : "Срок действия истёк"}
                                {athlete.primary_guardian_link_id ===
                                g.guardian_link_id
                                  ? active
                                    ? " · выбран основной контакт"
                                    : " · сохранённый выбор больше не действует"
                                  : ""}
                              </p>
                              <p>{g.basis_kind}</p>
                              <p className="pm-muted">
                                {displayDate(g.valid_from)} —{" "}
                                {g.valid_until
                                  ? displayDate(g.valid_until)
                                  : "без окончания"}
                              </p>
                              {active && (
                                <button
                                  className="pm-secondary"
                                  disabled={
                                    locked ||
                                    athlete.primary_guardian_link_id ===
                                      g.guardian_link_id
                                  }
                                  onClick={() =>
                                    run({
                                      operation: "setPrimaryContact",
                                      target: athlete.athlete_id,
                                      body: {
                                        operation_id: uuid(),
                                        base_version: version(),
                                        guardian_link_id: g.guardian_link_id,
                                      },
                                    })
                                  }
                                >
                                  Выбрать основным
                                </button>
                              )}
                              {!archived && g.status !== "revoked" && (
                                <button
                                  className="pm-secondary"
                                  disabled={locked}
                                  onClick={() =>
                                    begin(
                                      "revokeGuardianLink",
                                      g.guardian_link_id,
                                    )
                                  }
                                >
                                  Отозвать связь
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {!archived && athlete.primary_guardian_link_id && (
                      <button
                        className="pm-secondary"
                        disabled={locked}
                        onClick={() =>
                          run({
                            operation: "setPrimaryContact",
                            target: athlete.athlete_id,
                            body: {
                              operation_id: uuid(),
                              base_version: version(),
                              guardian_link_id: null,
                            },
                          })
                        }
                      >
                        Снять выбор основного контакта
                      </button>
                    )}
                  </>
                )}
                {household && (
                  <>
                    <p>
                      Членство в семье не даёт представительства или доступа к
                      данным.
                    </p>
                    <div className="pm-actions">
                      <button
                        disabled={locked}
                        onClick={() => begin("addHouseholdMember")}
                      >
                        Добавить человека в семью
                      </button>
                      <button
                        className="pm-secondary"
                        disabled={locked}
                        onClick={() => begin("updateHousehold")}
                      >
                        Изменить название
                      </button>
                    </div>
                    <h3>Люди и периоды</h3>
                    {household.members.length === 0 ? (
                      <p>
                        В семье пока нет людей. Добавьте отдельные карточки и
                        укажите периоды.
                      </p>
                    ) : (
                      <ul className="pm-records">
                        {household.members.map((m) => (
                          <li key={m.household_member_id}>
                            <h4>{m.display_name}</h4>
                            <p>
                              {activePeriod(m.valid_from, m.valid_until, now())
                                ? "Действующий период"
                                : Date.parse(m.valid_from) > now()
                                  ? "Будущий период"
                                  : "Период завершён"}
                            </p>
                            <p className="pm-muted">
                              {displayDate(m.valid_from)} —{" "}
                              {m.valid_until
                                ? displayDate(m.valid_until)
                                : "без окончания"}
                            </p>
                            {m.valid_until === null && (
                              <button
                                className="pm-secondary"
                                disabled={locked}
                                onClick={() =>
                                  begin(
                                    "endHouseholdMember",
                                    m.household_member_id,
                                    m.valid_from,
                                  )
                                }
                              >
                                Завершить период
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </>
            ))}
        </section>
      ) : (
        <section className="pm-list">
          <div className="pm-list-heading">
            <h2>{names[kind]}</h2>
            <button
              disabled={locked}
              data-card-id={`create-${kind}`}
              onClick={(e) => {
                returnButton.current = e.currentTarget;
                begin(
                  kind === "households" ? "createHousehold" : "createPerson",
                );
              }}
            >
              {kind === "households" ? "+ Новая семья" : "+ Новый человек"}
            </button>
          </div>
          <form
            className="pm-search"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(search);
              setRevision((v) => v + 1);
            }}
          >
            <div>
              <label htmlFor={searchId}>
                Поиск по {kind === "households" ? "названию" : "имени"}
              </label>
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={200}
              />
            </div>
            <button disabled={locked}>Найти</button>
          </form>
          <label htmlFor={stateId}>Показать</label>
          <select
            id={stateId}
            value={state}
            disabled={locked}
            onChange={(e) => setState(e.target.value as State)}
          >
            <option value="active">Действующие</option>
            {kind !== "households" && <option value="archived">Архив</option>}
            <option value="all">Все, включая историю</option>
          </select>
          <p className="pm-muted">
            {kind === "households"
              ? "Семья объединяет периоды участия, но не выдаёт права."
              : "Имена могут совпадать. Каждая запись — самостоятельная карточка."}
          </p>
          <ul className="pm-cards">
            {items.map((p, i) => (
              <li key={p.id}>
                <article>
                  <p className="pm-kicker">Отдельная запись {i + 1}</p>
                  <h3>{p.name}</h3>
                  <p>
                    {p.archived
                      ? "В архиве"
                      : p.participation
                        ? p.participation === "regular"
                          ? "Постоянный участник"
                          : "Гость"
                        : kind === "households"
                          ? "Семья"
                          : "Человек"}
                  </p>
                  <button
                    className="pm-secondary"
                    data-card-id={p.id}
                    disabled={locked}
                    onClick={(e) => {
                      returnButton.current = e.currentTarget;
                      void open(kind, p.id);
                    }}
                  >
                    Открыть карточку
                    <span className="pm-sr">
                      {" "}
                      {p.name}, запись {i + 1}
                    </span>
                  </button>
                </article>
              </li>
            ))}
          </ul>
          {listBusy && (
            <p role="status">
              Загружаем {items.length ? "следующие карточки" : "список"}…
            </p>
          )}
          {!listBusy && !listError && items.length === 0 && (
            <div className="pm-empty">
              <h3>
                {q
                  ? "Ничего не найдено"
                  : state === "archived"
                    ? "Архив пуст"
                    : kind === "households"
                      ? "Пока нет действующих семей"
                      : "Список пуст"}
              </h3>
              <p>
                {q
                  ? "Измените запрос или очистите поиск."
                  : kind === "households"
                    ? "Создайте семью и добавьте периоды участия."
                    : "Создайте отдельный профиль человека без обязательного аккаунта."}
              </p>
              {q && (
                <button
                  className="pm-secondary"
                  onClick={() => {
                    setSearch("");
                    setQ("");
                  }}
                >
                  Очистить поиск
                </button>
              )}
            </div>
          )}
          {listError && (
            <div role="alert" className="pm-error">
              <p>{listError}</p>
              <button
                className="pm-secondary"
                onClick={() =>
                  loadList(items.length ? (cursor ?? undefined) : undefined)
                }
              >
                Повторить загрузку
              </button>
            </div>
          )}
          {cursor && !listError && (
            <button
              className="pm-more"
              disabled={listBusy || locked}
              onClick={() => loadList(cursor)}
            >
              Показать ещё
            </button>
          )}
          {!cursor && !listBusy && !listError && items.length > 0 && (
            <p className="pm-muted">Все доступные карточки загружены.</p>
          )}
        </section>
      )}
    </div>
  );
}
