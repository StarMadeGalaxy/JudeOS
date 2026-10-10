import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Dialog } from "./Dialog";
import {
  JournalError,
  displayDate,
  isUnknown,
  markName,
  marks,
  sessionNames,
  timeInClub,
  type Attendance,
  type Command,
  type Entry,
  type Failure,
  type Journal,
  type JournalAdapter,
  type Mark,
  type Result,
  type Schema,
  type TrainingSession,
} from "./model";
import { fixtureDate } from "./fixtures";
import "./online-journal.css";

type Pending = {
  phase: "sending" | "unknown" | "conflict" | "error";
  command: Command;
  label: string;
  failure?: Failure;
};
type Form =
  | { kind: "guest" }
  | { kind: "known" }
  | { kind: "close" }
  | { kind: "exclude"; entry: Entry };
const outstanding = (value?: Pending) =>
  value?.phase === "sending" || value?.phase === "unknown";
const failureText = (code: string) =>
  ({
    SESSION_CANCELLED:
      "Занятие отменено. Новые отметки запрещены; прежние факты сохранены.",
    SESSION_CLOSED:
      "Занятие закрыто. Состав менять нельзя; существующие отметки можно исправлять.",
    ATHLETE_ARCHIVED: "Участник архивирован. Новая запись запрещена.",
    ROSTER_EXCLUDED: "Участник исключён из состава. Его история сохранена.",
    OPERATION_ID_REUSED:
      "Команда не принята: требуется обновить данные и заново подтвердить действие.",
    INVALID_REQUEST: "Проверьте поля формы. Запись не принята.",
    RATE_LIMITED: "Слишком много запросов. Повторите позже.",
  })[code] || "Запись не принята. Обновите данные перед новым действием.";

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// Only confirmed snapshots/results enter the journal. Intent and command outcomes stay separate.
function mergeJournal(current: Journal | null, incoming: Journal): Journal {
  if (!current || current.session.session_id !== incoming.session.session_id)
    return incoming;
  return {
    session:
      current.session.version > incoming.session.version
        ? current.session
        : incoming.session,
    roster: incoming.roster.map((entry) => {
      const prior = current.roster.find(
        (value) => value.athlete_id === entry.athlete_id,
      );
      return prior && prior.attendance.version > entry.attendance.version
        ? { ...entry, attendance: prior.attendance }
        : entry;
    }),
  };
}
function applyResult(current: Journal, result: Result): Journal {
  if ("attendance" in result)
    return {
      ...current,
      roster: current.roster.map((entry) =>
        entry.athlete_id === result.attendance.athlete_id &&
        entry.attendance.version <= result.attendance.version
          ? { ...entry, attendance: result.attendance }
          : entry,
      ),
    };
  const session =
    current.session.version <= result.session.version
      ? result.session
      : current.session;
  if (!("entry" in result)) return { ...current, session };
  return {
    session,
    roster: current.roster.some((e) => e.athlete_id === result.entry.athlete_id)
      ? current.roster.map((e) =>
          e.athlete_id === result.entry.athlete_id ? result.entry : e,
        )
      : [...current.roster, result.entry],
  };
}

export function OnlineJournal({
  adapter,
  onOutstanding,
}: {
  adapter: JournalAdapter;
  onOutstanding?: (value: boolean) => void;
}) {
  const online = useOnline();
  const [date, setDate] = useState(fixtureDate);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [journal, setJournal] = useState<Journal | null>(null);
  const journalRef = useRef<Journal | null>(null);
  const selected = useRef<string | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const needsRefreshRef = useRef(false);
  const [denied, setDenied] = useState(false);
  const deniedRef = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const commands = useRef(new Map<string, Pending>());
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unmarked" | "marked">("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const listGeneration = useRef(0);
  const readGeneration = useRef(0);
  const hasOutstanding = Object.values(pending).some(outstanding);
  const aggregateLocked =
    outstanding(pending.session) || pending.session?.phase === "conflict";
  const acknowledgement =
    adapter.mode === "synthetic"
      ? "Подтверждено в демонстрации"
      : "Сохранено на сервере";

  const putJournal = (value: Journal | null) => {
    journalRef.current = value;
    setJournal(value);
  };
  const putPending = (key: string, value?: Pending) => {
    if (value) commands.current.set(key, value);
    else commands.current.delete(key);
    setPending((prior) => {
      const next = { ...prior };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };
  const deny = (status: number) => {
    readGeneration.current += 1;
    listGeneration.current += 1;
    deniedRef.current = true;
    setReadBusy(false);
    setListBusy(false);
    commands.current.clear();
    setPending({});
    setConfirmed({});
    putJournal(null);
    setSessions([]);
    setCursor(null);
    setForm(null);
    setDenied(true);
    setNeedsRefresh(true);
    needsRefreshRef.current = true;
    setNotice(
      status === 401
        ? "Сессия завершена. Откройте приложение и войдите снова."
        : "Доступ к данным больше не подтверждён. Журнал и контакты скрыты.",
    );
  };
  const refresh = useCallback(
    async (id: string, focus = false) => {
      const generation = ++readGeneration.current;
      setReadBusy(true);
      try {
        const value = await adapter.get(id);
        if (generation !== readGeneration.current || selected.current !== id)
          return false;
        putJournal(mergeJournal(journalRef.current, value));
        setNeedsRefresh(false);
        needsRefreshRef.current = false;
        setDenied(false);
        deniedRef.current = false;
        if (focus) requestAnimationFrame(() => heading.current?.focus());
        return true;
      } catch (error) {
        if (generation !== readGeneration.current) return false;
        if (
          error instanceof JournalError &&
          [401, 403, 404].includes(error.status)
        )
          deny(error.status);
        else {
          setNeedsRefresh(true);
          needsRefreshRef.current = true;
          setNotice(
            "Не удалось обновить журнал. Новые записи заблокированы до успешного обновления.",
          );
        }
        return false;
      } finally {
        if (generation === readGeneration.current) setReadBusy(false);
      }
    },
    [adapter],
  );
  const loadList = useCallback(
    async (day: string, after?: string) => {
      const generation = ++listGeneration.current;
      setListBusy(true);
      setListError("");
      if (!after) {
        setSessions([]);
        setCursor(null);
      }
      try {
        const value = await adapter.list(day, after);
        if (generation !== listGeneration.current) return;
        setSessions((prior) =>
          after
            ? [
                ...new Map(
                  [...prior, ...value.items].map((s) => [s.session_id, s]),
                ).values(),
              ].sort(
                (a, b) =>
                  a.starts_at.localeCompare(b.starts_at) ||
                  a.session_id.localeCompare(b.session_id),
              )
            : value.items,
        );
        setCursor(value.next_cursor);
        setDenied(false);
        if (!after && selected.current) await refresh(selected.current);
      } catch (error) {
        if (generation !== listGeneration.current) return;
        if (error instanceof JournalError && [401, 403].includes(error.status))
          deny(error.status);
        setListError(
          "Не удалось загрузить занятия. Повторите чтение при доступной сети.",
        );
      } finally {
        if (generation === listGeneration.current) setListBusy(false);
      }
    },
    [adapter, refresh],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void loadList(date);
    return () => {
      listGeneration.current += 1;
      readGeneration.current += 1;
    };
  }, [date, loadList]);
  useEffect(() => {
    onOutstanding?.(hasOutstanding);
  }, [hasOutstanding, onOutstanding]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasOutstanding) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const visible = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        selected.current &&
        !Object.values(pending).some((p) => p.phase === "sending")
      )
        void refresh(selected.current);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [hasOutstanding, pending, refresh]);

  async function open(id: string) {
    if ([...commands.current.values()].some(outstanding)) return;
    selected.current = id;
    putJournal(null);
    setPending({});
    commands.current.clear();
    setConfirmed({});
    setNotice("");
    setQuery("");
    setFilter("all");
    setForm(null);
    await refresh(id, true);
  }
  async function send(
    command: Command,
    key: string,
    label: string,
    retry = false,
  ) {
    if (!navigator.onLine || deniedRef.current || needsRefreshRef.current)
      return;
    const previous = commands.current.get(key);
    if (
      previous &&
      (previous.phase === "sending" || (previous.phase === "unknown" && !retry))
    )
      return;
    // A sent body is immutable; explicit retry uses the same object/ID/base version.
    const frozen =
      retry && previous ? previous.command : structuredClone(command);
    const intent: Pending = { phase: "sending", command: frozen, label };
    onOutstanding?.(true);
    putPending(key, intent);
    setConfirmed((prior) => {
      const next = { ...prior };
      delete next[key];
      return next;
    });
    setNotice("");
    try {
      const result = await adapter.execute(frozen);
      if (!mounted.current || deniedRef.current) return;
      if (journalRef.current && !result.replayed)
        putJournal(applyResult(journalRef.current, result.value));
      putPending(key);
      setConfirmed((prior) => ({
        ...prior,
        [key]: `${acknowledgement}${result.replayed ? " · повтор принят" : ""}`,
      }));
      if (key === "session") setForm(null);
      setNeedsRefresh(true);
      needsRefreshRef.current = true;
      const read = await refresh(frozen.sessionId);
      if (read) {
        if ("unmarked_count" in result.value)
          setNotice(
            `Занятие закрыто. Не отмечены: ${result.value.unmarked_count}. Отсутствие не проставлено.`,
          );
        else
          setNotice(
            result.replayed
              ? "Повтор подтверждён. Журнал перечитан; показаны актуальные отметки."
              : acknowledgement + ".",
          );
      } else if (!deniedRef.current)
        setNotice(
          "Команда подтверждена, но актуальный журнал не получен. Обновите данные; повторять запись не требуется.",
        );
    } catch (error) {
      if (!mounted.current || deniedRef.current) return;
      if (isUnknown(error)) {
        putPending(key, { ...intent, phase: "unknown" });
        return;
      }
      const failure = (error as JournalError).body;
      if (
        error instanceof JournalError &&
        [401, 403, 404].includes(error.status)
      ) {
        putPending(key);
        deny(error.status);
        return;
      }
      putPending(key, {
        ...intent,
        phase:
          error instanceof JournalError && error.status === 409
            ? "conflict"
            : "error",
        failure,
      });
    }
  }
  const mark = (entry: Entry, status: Mark) =>
    void send(
      {
        operation: "setAttendance",
        sessionId: journalRef.current!.session.session_id,
        athleteId: entry.athlete_id,
        body: {
          operation_id: crypto.randomUUID(),
          base_version: entry.attendance.version,
          status,
        },
      },
      entry.athlete_id,
      markName(status),
    );
  async function resolveMark(key: string, keepMine: boolean) {
    const value = commands.current.get(key);
    if (
      !value ||
      value.command.operation !== "setAttendance" ||
      !navigator.onLine
    )
      return;
    const status = value.command.body.status;
    const loaded = await refresh(value.command.sessionId);
    if (!loaded) return;
    const entry = journalRef.current?.roster.find((e) => e.athlete_id === key);
    if (
      !entry ||
      entry.excluded ||
      journalRef.current?.session.state === "cancelled"
    ) {
      putPending(key);
      setNotice("Запись больше недоступна для исправления.");
      return;
    }
    putPending(key);
    if (keepMine) mark(entry, status);
    else
      setNotice("Оставлена актуальная отметка. Новая команда не отправлена.");
  }
  async function rereadAggregate(key: string) {
    if (!selected.current || !(await refresh(selected.current))) return;
    putPending(key);
    setNotice(
      "Данные обновлены. Проверьте состав и подтвердите действие заново.",
    );
  }
  const closeForm = () => {
    if (outstanding(commands.current.get("session"))) return;
    putPending("session");
    setForm(null);
  };
  function pendingBlock(key: string) {
    const value = pending[key];
    if (!value)
      return confirmed[key] ? (
        <p className="oj-confirmed" role="status">
          {confirmed[key]}
        </p>
      ) : null;
    if (value.phase === "sending")
      return (
        <p role="status">
          Ожидаем подтверждения: {value.label}. Пока не сохранено.
        </p>
      );
    if (value.phase === "unknown")
      return (
        <div className="oj-message" role="alert">
          <p>
            Результат неизвестен: {value.label}. Подтверждения нет; команда
            могла быть принята.
          </p>
          <button
            type="button"
            className="oj-secondary"
            disabled={!online || denied || needsRefresh}
            onClick={() => void send(value.command, key, value.label, true)}
          >
            Повторить ту же команду
          </button>
          <p>До ответа новая запись для этого действия заблокирована.</p>
        </div>
      );
    if (value.phase === "conflict") {
      const current =
        value.failure && "current" in value.failure
          ? (value.failure.current as Attendance)
          : null;
      return (
        <div className="oj-message" role="alert">
          {current ? (
            <>
              <p>
                Отметка изменена другим сотрудником. Сейчас:{" "}
                {markName(current.status)}. Ваш выбор: {value.label}.
              </p>
              <div className="oj-actions">
                <button
                  type="button"
                  className="oj-secondary"
                  disabled={!online || readBusy}
                  onClick={() => void resolveMark(key, false)}
                >
                  Оставить текущую
                </button>
                <button
                  type="button"
                  disabled={!online || readBusy}
                  onClick={() => void resolveMark(key, true)}
                >
                  Сохранить мой выбор
                </button>
              </div>
              <p>Перед решением журнал будет перечитан.</p>
            </>
          ) : (
            <>
              <p>
                {[
                  "SESSION_VERSION_CONFLICT",
                  "ENTITY_VERSION_CONFLICT",
                ].includes(value.failure?.code || "")
                  ? "Данные занятия изменились. Сначала перечитайте их и подтвердите действие заново."
                  : failureText(value.failure?.code || "")}
              </p>
              <button
                type="button"
                className="oj-secondary"
                disabled={!online || readBusy}
                onClick={() => void rereadAggregate(key)}
              >
                Перечитать занятие
              </button>
            </>
          )}
        </div>
      );
    }
    return (
      <div className="oj-message" role="alert">
        <p>{failureText(value.failure?.code || "")}</p>
        <button
          type="button"
          className="oj-secondary"
          disabled={!online || readBusy}
          onClick={async () => {
            if (selected.current && (await refresh(selected.current)))
              putPending(key);
          }}
        >
          Обновить данные
        </button>
      </div>
    );
  }
  const active = journal?.roster.filter((e) => !e.excluded) || [];
  const unmarked = active.filter(
    (e) => e.attendance.status === "unmarked",
  ).length;
  const canWrite =
    online &&
    !denied &&
    !needsRefresh &&
    journal?.session.state !== "cancelled";
  const canCompose =
    canWrite &&
    journal?.session.state !== "closed" &&
    !hasOutstanding &&
    !aggregateLocked;
  const shown =
    journal?.roster.filter(
      (entry) =>
        (showExcluded || !entry.excluded) &&
        entry.display_name
          .toLocaleLowerCase("ru")
          .includes(query.toLocaleLowerCase("ru")) &&
        (filter === "all" ||
          (filter === "unmarked"
            ? entry.attendance.status === "unmarked"
            : entry.attendance.status !== "unmarked")),
    ) || [];

  return (
    <section className="oj-root" aria-label="Онлайн-журнал">
      <header className="oj-heading">
        <p className="oj-eyebrow">Judo Pride · Синтетический клуб</p>
        <h1>
          {adapter.canManage ? "Расписание клуба" : "Назначенные занятия"}
        </h1>
        <p>Время клуба: Минск. Работа с телефона и компьютера.</p>
      </header>
      <div className="oj-demo-banner">
        <strong>Синтетическая демонстрация.</strong> Все имена вымышленные.
        Команды меняют только память вкладки; обновление страницы сбрасывает
        данные. Реальные данные не вводите.
      </div>
      {!online && (
        <div className="oj-message" role="alert">
          Нет сети. Новые записи и повторы заблокированы. Офлайн-сохранения пока
          нет; ожидающие команды не превращены в очередь.
        </div>
      )}
      <p className="oj-notice" role="status" aria-live="polite">
        {notice}
      </p>
      <div className="oj-layout">
        <div className="oj-schedule" role="group" aria-label="Список занятий">
          <label>
            Дата занятия
            <input
              type="date"
              value={date}
              disabled={hasOutstanding}
              onChange={(event) => {
                if (!event.target.value) return;
                selected.current = null;
                putJournal(null);
                setForm(null);
                setPending({});
                commands.current.clear();
                setDate(event.target.value);
              }}
            />
          </label>
          <p>{displayDate(date)}</p>
          <button
            type="button"
            className="oj-secondary"
            disabled={!online || listBusy || hasOutstanding}
            onClick={() => void loadList(date)}
          >
            Обновить список
          </button>
          {listBusy && <p role="status">Загружаем занятия…</p>}
          {listError && <p role="alert">{listError}</p>}
          {!listBusy && !listError && !sessions.length && (
            <p>На эту дату доступных занятий нет.</p>
          )}
          <ul className="oj-session-list">
            {sessions.map((session) => (
              <li key={session.session_id}>
                <button
                  type="button"
                  className="oj-session-button oj-secondary"
                  aria-current={
                    journal?.session.session_id === session.session_id
                      ? "true"
                      : undefined
                  }
                  disabled={hasOutstanding || readBusy || !online}
                  onClick={() => void open(session.session_id)}
                >
                  <strong>{session.group.name}</strong>
                  <span>
                    {timeInClub(session.starts_at)}–
                    {timeInClub(session.ends_at)} · {session.venue.name}
                  </span>
                  <span>{sessionNames[session.state]}</span>
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              type="button"
              className="oj-secondary"
              disabled={!online || listBusy || hasOutstanding}
              onClick={() => void loadList(date, cursor)}
            >
              Ещё занятия
            </button>
          )}
          <p className="oj-muted">
            Показаны загруженные занятия. Перенос может изменить порядок;
            обновление перечитывает список.
          </p>
          {adapter.canManage && (
            <div className="oj-boundary">
              <p>Изменение времени и отмена пока недоступны.</p>
              <div className="oj-actions">
                <button type="button" className="oj-secondary" disabled>
                  Перенести занятие
                </button>
                <button type="button" className="oj-secondary" disabled>
                  Отменить занятие
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="oj-journal">
          {readBusy && <p role="status">Обновляем журнал…</p>}
          {!journal && !denied && !readBusy && (
            <p>Выберите занятие, чтобы открыть сохранённый состав.</p>
          )}
          {needsRefresh && !journal && selected.current && (
            <button
              type="button"
              className="oj-secondary"
              disabled={!online || readBusy}
              onClick={() => void refresh(selected.current!, true)}
            >
              Обновить журнал
            </button>
          )}
          {journal && (
            <>
              <h2 ref={heading} tabIndex={-1} data-oj-heading>
                {journal.session.group.name}
              </h2>
              <p>
                {timeInClub(journal.session.starts_at)}–
                {timeInClub(journal.session.ends_at)} ·{" "}
                {journal.session.venue.name}
              </p>
              <p>
                <strong>{sessionNames[journal.session.state]}</strong> · В
                составе: {active.length} · Отмечено: {active.length - unmarked}{" "}
                · Не отмечены: {unmarked}
              </p>
              {journal.session.state === "closed" && (
                <p className="oj-message">
                  Занятие закрыто. Существующие активные отметки можно
                  исправить; состав менять нельзя. Не отмеченные сохранились.
                </p>
              )}
              {journal.session.state === "cancelled" && (
                <p className="oj-message" role="alert">
                  Занятие отменено. Факты сохранены, новые отметки и изменения
                  состава заблокированы.
                </p>
              )}
              <div className="oj-actions">
                <button
                  type="button"
                  className="oj-secondary"
                  disabled={!canCompose}
                  onClick={() => setForm({ kind: "guest" })}
                >
                  Добавить онлайн-гостя
                </button>
                {adapter.canManage && (
                  <button
                    type="button"
                    className="oj-secondary"
                    disabled={!canCompose}
                    onClick={() => setForm({ kind: "known" })}
                  >
                    Добавить известного участника
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canCompose}
                  onClick={() => setForm({ kind: "close" })}
                >
                  Закрыть занятие
                </button>
                <button
                  type="button"
                  className="oj-secondary"
                  disabled={
                    !online ||
                    readBusy ||
                    Object.values(pending).some((p) => p.phase === "sending")
                  }
                  onClick={() => void refresh(journal.session.session_id)}
                >
                  Обновить журнал
                </button>
              </div>
              {!adapter.canManage && (
                <p className="oj-muted">
                  Тренер временно добавляет гостя в это занятие. Постоянный
                  состав и исключение ведёт менеджер.
                </p>
              )}
              {!form && pendingBlock("session")}
              <label>
                Поиск в составе
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="oj-actions" aria-label="Фильтр состава">
                {(
                  [
                    ["all", "Все"],
                    ["unmarked", "Не отмечены"],
                    ["marked", "С отметкой"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className="oj-secondary"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="oj-check">
                <input
                  type="checkbox"
                  checked={showExcluded}
                  onChange={(event) => setShowExcluded(event.target.checked)}
                />
                Показать исключённых с историей
              </label>
              {!shown.length && (
                <p>
                  {journal.roster.length
                    ? "Нет участников по выбранному поиску и фильтру."
                    : "Состав пуст. Менеджер может добавить участников; тренер — онлайн-гостя."}
                </p>
              )}
              <ul className="oj-roster">
                {shown.map((entry) => (
                  <li
                    className="oj-entry"
                    key={entry.athlete_id}
                    aria-label={`${entry.display_name} · ${entry.participation === "visit" ? "визит" : entry.participation === "guest" ? "гость" : "постоянный"}${entry.trial ? " · пробное" : ""}`}
                  >
                    <h3>{entry.display_name}</h3>
                    <p className="oj-muted">
                      {entry.participation === "regular"
                        ? "Постоянный участник"
                        : entry.participation === "guest"
                          ? "Гость"
                          : "Разовый визит"}
                      {entry.trial ? " · Пробное занятие" : ""}
                    </p>
                    {entry.excluded && (
                      <p>
                        <strong>Исключён из состава. История сохранена.</strong>
                      </p>
                    )}
                    <p className="oj-current">
                      {entry.attendance.status === "unmarked"
                        ? "Не отмечен"
                        : `Подтверждённая отметка: ${markName(entry.attendance.status)}`}
                    </p>
                    {entry.attendance.recorded_at && (
                      <p className="oj-muted">
                        Последняя подтверждённая запись:{" "}
                        <time dateTime={entry.attendance.recorded_at}>
                          {timeInClub(entry.attendance.recorded_at)} · Минск
                        </time>
                        .
                      </p>
                    )}
                    {!entry.excluded && (
                      <details>
                        <summary>Контакт и допуск</summary>
                        <p>
                          {entry.primary_contact ? (
                            <>
                              {entry.primary_contact.display_name}:{" "}
                              {entry.primary_contact.phone ? (
                                <a
                                  href={`tel:${entry.primary_contact.phone.replace(/[^+\d]/g, "")}`}
                                >
                                  {entry.primary_contact.phone}
                                </a>
                              ) : (
                                "Номер не указан"
                              )}
                            </>
                          ) : (
                            "Основной контакт не выбран или недоступен"
                          )}
                        </p>
                        <p>
                          Допуск:{" "}
                          {entry.admission
                            ? {
                                admitted: "Допущен",
                                not_admitted: "Не допущен",
                                review_required: "Нужна проверка",
                              }[entry.admission.state]
                            : "Сведений нет"}
                          {entry.admission?.valid_until
                            ? ` · срок до ${entry.admission.valid_until}`
                            : ""}
                          .
                        </p>
                        {entry.admission?.state === "not_admitted" && (
                          <p>
                            Недопуск не мешает зафиксировать фактическое
                            присутствие.
                          </p>
                        )}
                      </details>
                    )}
                    <div
                      className="oj-marks"
                      aria-label={`Отметка ${entry.display_name}`}
                    >
                      {(Object.keys(marks) as Mark[]).map((status) => (
                        <button
                          type="button"
                          key={status}
                          className="oj-secondary"
                          aria-pressed={entry.attendance.status === status}
                          disabled={
                            !canWrite ||
                            entry.excluded ||
                            aggregateLocked ||
                            !!pending[entry.athlete_id]
                          }
                          onClick={() => mark(entry, status)}
                        >
                          {marks[status]}
                        </button>
                      ))}
                    </div>
                    {pendingBlock(entry.athlete_id)}
                    {adapter.canManage && !entry.excluded && (
                      <button
                        type="button"
                        className="oj-secondary oj-small-action"
                        disabled={!canCompose}
                        onClick={() => setForm({ kind: "exclude", entry })}
                      >
                        Исключить из состава
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {form && journal && (
        <Dialog
          title={
            {
              guest: "Добавить онлайн-гостя",
              known: "Добавить известного участника",
              close: "Закрыть занятие",
              exclude: "Исключить из состава",
            }[form.kind]
          }
          locked={outstanding(pending.session)}
          onClose={closeForm}
        >
          {form.kind === "guest" && (
            <GuestForm
              disabled={!canWrite || !!pending.session}
              onSubmit={(name, phone, trial) =>
                void send(
                  {
                    operation: "createSessionGuest",
                    sessionId: journal.session.session_id,
                    body: {
                      operation_id: crypto.randomUUID(),
                      base_version: journal.session.version,
                      display_name: name,
                      ...(phone ? { phone } : {}),
                      trial,
                    },
                  },
                  "session",
                  "Добавление гостя",
                )
              }
            />
          )}
          {form.kind === "known" && (
            <KnownForm
              adapter={adapter}
              onDenied={deny}
              disabled={!canWrite || !!pending.session}
              onSubmit={(athleteId, trial) =>
                void send(
                  {
                    operation: "addKnownRosterAthlete",
                    sessionId: journal.session.session_id,
                    body: {
                      operation_id: crypto.randomUUID(),
                      base_version: journal.session.version,
                      athlete_id: athleteId,
                      trial,
                    },
                  },
                  "session",
                  "Разовый визит",
                )
              }
            />
          )}
          {form.kind === "close" && (
            <>
              <p>
                Не отмечены: {unmarked}. Закрытие сохранит эти строки без
                автоматического отсутствия. Исправления существующих активных
                отметок останутся доступны.
              </p>
              <button
                type="button"
                disabled={!canWrite || !!pending.session}
                onClick={() =>
                  void send(
                    {
                      operation: "closeSession",
                      sessionId: journal.session.session_id,
                      body: {
                        operation_id: crypto.randomUUID(),
                        base_version: journal.session.version,
                      },
                    },
                    "session",
                    "Закрытие занятия",
                  )
                }
              >
                Подтвердить закрытие
              </button>
            </>
          )}
          {form.kind === "exclude" && (
            <>
              <p>
                {form.entry.display_name}: исключение сохранит отметку, автора и
                историю; новые отметки и контакт станут недоступны. Группа и
                будущие занятия не изменятся.
              </p>
              <button
                type="button"
                disabled={!canWrite || !!pending.session}
                onClick={() =>
                  void send(
                    {
                      operation: "excludeRosterAthlete",
                      sessionId: journal.session.session_id,
                      athleteId: form.entry.athlete_id,
                      body: {
                        operation_id: crypto.randomUUID(),
                        base_version: journal.session.version,
                      },
                    },
                    "session",
                    "Исключение из состава",
                  )
                }
              >
                Подтвердить исключение
              </button>
            </>
          )}
          {pendingBlock("session")}
        </Dialog>
      )}
    </section>
  );
}

function GuestForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (name: string, phone: string, trial: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [trial, setTrial] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Укажите полное имя одной строкой.");
      nameRef.current?.focus();
      return;
    }
    setError("");
    onSubmit(name.trim(), phone.trim(), trial);
  };
  return (
    <form onSubmit={submit} noValidate>
      <p>
        Гость добавляется только в это занятие. Его карточка сохраняется в
        демонстрации; аккаунт, семья и представитель не обязательны. Совпадение
        имени не объединяет людей.
      </p>
      <label>
        Полное имя гостя
        <input
          ref={nameRef}
          autoFocus
          value={name}
          maxLength={200}
          required
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? "oj-guest-error" : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" id="oj-guest-error">
          {error}
        </p>
      )}
      <label>
        Телефон гостя · необязательно
        <input
          type="tel"
          value={phone}
          maxLength={50}
          disabled={disabled}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>
      <label className="oj-check">
        <input
          type="checkbox"
          checked={trial}
          disabled={disabled}
          onChange={(event) => setTrial(event.target.checked)}
        />
        Пробное занятие
      </label>
      <button disabled={disabled}>Добавить гостя</button>
    </form>
  );
}
function KnownForm({
  adapter,
  disabled,
  onSubmit,
  onDenied,
}: {
  adapter: JournalAdapter;
  disabled: boolean;
  onSubmit: (id: string, trial: boolean) => void;
  onDenied: (status: number) => void;
}) {
  const choiceId = useId();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Schema["AthleteSummary"][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [trial, setTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const loadedQuery = useRef("");
  const onDeniedRef = useRef(onDenied);
  onDeniedRef.current = onDenied;
  const load = useCallback(
    async (query: string, after?: string) => {
      const current = ++generation.current;
      setBusy(true);
      setError("");
      if (!after) {
        setItems([]);
        setChoice("");
        setCursor(null);
        loadedQuery.current = query;
      }
      try {
        const page = await adapter.known(query, after);
        if (generation.current === current) {
          setItems((prior) =>
            after
              ? [
                  ...new Map(
                    [...prior, ...page.items].map((a) => [a.athlete_id, a]),
                  ).values(),
                ]
              : page.items,
          );
          setCursor(page.next_cursor);
        }
      } catch (error) {
        if (generation.current === current) {
          if (
            error instanceof JournalError &&
            [401, 403, 404].includes(error.status)
          )
            onDeniedRef.current(error.status);
          else setError("Не удалось загрузить участников. Повторите поиск.");
        }
      } finally {
        if (generation.current === current) setBusy(false);
      }
    },
    [adapter],
  );
  useEffect(() => {
    void load("");
    return () => {
      generation.current += 1;
    };
  }, [load]);
  return (
    <>
      <p>
        Разовый визит не меняет постоянную группу и будущие занятия. Поиск
        доступен менеджеру и администратору; тренеру этот реестр не выдаётся.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(q);
        }}
      >
        <label>
          Поиск известного участника
          <input
            type="search"
            autoFocus
            maxLength={100}
            value={q}
            disabled={disabled}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="oj-secondary"
          disabled={disabled || busy}
        >
          Найти участника
        </button>
      </form>
      {busy && <p role="status">Загрузка участников…</p>}
      {error && <p role="alert">{error}</p>}
      <label htmlFor={choiceId}>Участник</label>
      <select
        id={choiceId}
        value={choice}
        disabled={disabled || busy}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">Выберите участника</option>
        {items.map((a) => (
          <option key={a.athlete_id} value={a.athlete_id}>
            {a.display_name} ·{" "}
            {a.participation === "guest" ? "гость" : "постоянный"}
          </option>
        ))}
      </select>
      {!busy && !error && !items.length && (
        <p>Участников по этому поиску нет.</p>
      )}
      {cursor && (
        <button
          type="button"
          className="oj-secondary"
          disabled={disabled || busy}
          onClick={() => void load(loadedQuery.current, cursor)}
        >
          Ещё участники
        </button>
      )}
      <label className="oj-check">
        <input
          type="checkbox"
          checked={trial}
          disabled={disabled}
          onChange={(event) => setTrial(event.target.checked)}
        />
        Пробное занятие
      </label>
      <button
        type="button"
        disabled={disabled || busy || !choice}
        onClick={() => onSubmit(choice, trial)}
      >
        Добавить разовый визит
      </button>
    </>
  );
}
