import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  JournalError,
  dateInClub,
  displayDate,
  timeInClub,
  timeRangeInClub,
  type JournalAdapter,
  type Schema,
  type TrainingSession,
} from "./model";
import { clubLocalToUTC, localDateTimeInClub, compareUTC } from "./club-time";

function Reason({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  return (
    <label>
      Причина (необязательно)
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={500}
        rows={3}
        disabled={disabled}
      />
      <span className="oj-muted">
        До 500 символов. Пояснение к этому изменению.
      </span>
    </label>
  );
}
export function TimeForm({
  session,
  disabled,
  onSubmit,
}: {
  session: TrainingSession;
  disabled: boolean;
  onSubmit(starts: string, ends: string, reason: string): void;
}) {
  const [start, setStart] = useState(() =>
    localDateTimeInClub(session.starts_at),
  );
  const [end, setEnd] = useState(() => localDateTimeInClub(session.ends_at));
  const [reason, setReason] = useState("");
  type Field = "startDate" | "startTime" | "endDate" | "endTime";
  const [error, setError] = useState<Field | null>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);
  const refs = {
    startDate: startDateRef,
    startTime: startTimeRef,
    endDate: endDateRef,
    endTime: endTimeRef,
  };
  const [startDate, startTime] = start.split("T");
  const [endDate, endTime] = end.split("T");
  const errorId = useId();
  const fields = [
    {
      key: "startDate",
      label: "Дата начала",
      type: "date",
      value: startDate,
      change: (value: string) => setStart(`${value}T${startTime}`),
    },
    {
      key: "startTime",
      label: "Время начала",
      type: "time",
      value: startTime,
      change: (value: string) => setStart(`${startDate}T${value}`),
    },
    {
      key: "endDate",
      label: "Дата окончания",
      type: "date",
      value: endDate,
      change: (value: string) => setEnd(`${value}T${endTime}`),
    },
    {
      key: "endTime",
      label: "Время окончания",
      type: "time",
      value: endTime,
      change: (value: string) => setEnd(`${endDate}T${value}`),
    },
  ] as const;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const starts = clubLocalToUTC(start, session.starts_at);
    const ends = clubLocalToUTC(end, session.ends_at);
    const order = starts && ends ? compareUTC(ends, starts) : null;
    if (!starts || !ends || order === null || order <= 0) {
      const field: Field = !starts
        ? !startDate
          ? "startDate"
          : "startTime"
        : !endDate || endDate < startDate
          ? "endDate"
          : "endTime";
      setError(field);
      refs[field].current?.focus();
      return;
    }
    setError(null);
    onSubmit(starts, ends, reason);
  }
  return (
    <form className="oj-form" noValidate onSubmit={submit}>
      <p>
        Время клуба: Минск. Зал: {session.venue.name}. Меняется только это
        занятие.
      </p>
      <p className="oj-muted">
        Сейчас: {displayDate(dateInClub(session.starts_at))},{" "}
        {timeRangeInClub(session)}. Состав и отметки сохраняются.
      </p>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          <input
            ref={refs[field.key]}
            type={field.type}
            step={field.type === "time" ? 60 : undefined}
            required
            value={field.value}
            onChange={(event) => field.change(event.target.value)}
            disabled={disabled}
            aria-invalid={error === field.key || undefined}
            aria-describedby={error === field.key ? errorId : undefined}
          />
        </label>
      ))}
      {error && (
        <p id={errorId} className="oj-message" role="alert">
          Введите дату и время; окончание должно быть позже начала.
        </p>
      )}
      <Reason value={reason} onChange={setReason} disabled={disabled} />
      <p className="oj-muted">
        Назначение тренеров подтверждается отдельным действием.
      </p>
      <button disabled={disabled}>Сохранить дату и время</button>
    </form>
  );
}
export function CancelForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit(reason: string): void;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="oj-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSubmit(reason);
      }}
    >
      <p>
        Отменить это занятие? Состав, сделанные отметки и история сохранятся.
        Новые отметки и настройка времени будут заблокированы.
      </p>
      <Reason value={reason} onChange={setReason} disabled={disabled} />
      <button disabled={disabled}>Подтвердить отмену</button>
    </form>
  );
}
type CoachesRead =
  | { state: "loading" }
  | { state: "error" }
  | {
      state: "ready";
      assignments: Schema["SessionCoaches"];
      staff: Schema["StaffMember"][];
      selected: string[];
    };
export function CoachesForm({
  adapter,
  session,
  disabled,
  onDenied,
  onSubmit,
}: {
  adapter: JournalAdapter;
  session: TrainingSession;
  disabled: boolean;
  onDenied(status: number): void;
  onSubmit(ids: string[], version: number, reason: string): void;
}) {
  const [read, setRead] = useState<CoachesRead>({ state: "loading" });
  const [retry, setRetry] = useState(0);
  const [reason, setReason] = useState("");
  const deniedRef = useRef(onDenied);
  deniedRef.current = onDenied;
  useEffect(() => {
    let active = true;
    setRead({ state: "loading" });
    Promise.all([adapter.coaches(session.session_id), adapter.staff()])
      .then(([assignments, staff]) => {
        if (active)
          setRead({
            state: "ready",
            assignments,
            staff: staff.items,
            selected: assignments.coaches
              .filter((row) => row.valid_until === null)
              .map((row) => row.membership_id),
          });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof JournalError &&
          [401, 403, 404].includes(error.status)
        )
          deniedRef.current(error.status);
        else setRead({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [adapter, session.session_id, session.version, retry]);
  if (read.state === "loading")
    return <p role="status">Читаем текущие назначения и доступных тренеров…</p>;
  if (read.state === "error")
    return (
      <div className="oj-message" role="alert">
        <p>Не удалось получить назначения. Выбор и запись пока недоступны.</p>
        <button
          type="button"
          className="oj-secondary"
          disabled={disabled}
          onClick={() => setRetry((value) => value + 1)}
        >
          Повторить чтение назначений
        </button>
      </div>
    );
  const current = read.assignments.coaches
    .filter((row) => row.valid_until === null)
    .map((row) => row.membership_id);
  const locked = session.state === "closed" || session.state === "cancelled";
  const eligible = read.staff.filter(
    (member) =>
      member.active &&
      member.state === "active" &&
      member.grants.some(
        (grant) =>
          grant.role === "coach" && grant.scope === "assigned_sessions",
      ),
  );
  const options = [
    ...new Set([
      ...current,
      ...(locked ? [] : eligible.map((member) => member.membership_id)),
    ]),
  ];
  const name = (id: string) =>
    read.staff.find((member) => member.membership_id === id)?.login ||
    "Профиль тренера недоступен";
  return (
    <form
      className="oj-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled)
          onSubmit(read.selected, read.assignments.version, reason);
      }}
    >
      <p>
        {locked
          ? "Можно только снять текущие назначения для отзыва доступа. Добавление и замена запрещены."
          : "Выберите тренеров именно этого занятия. Время подтверждается отдельно."}{" "}
        История снятых назначений сохраняется.
      </p>
      <fieldset disabled={disabled}>
        <legend>{locked ? "Текущие назначения" : "Тренеры занятия"}</legend>
        {!options.length && <p>Текущих назначений нет.</p>}
        {options.map((id) => (
          <label className="oj-choice" key={id}>
            <input
              type="checkbox"
              checked={read.selected.includes(id)}
              disabled={
                !read.selected.includes(id) && read.selected.length >= 20
              }
              onChange={(event) => {
                const checked = event.target.checked;
                setRead((value) =>
                  value.state === "ready"
                    ? {
                        ...value,
                        selected: checked
                          ? [...value.selected, id]
                          : value.selected.filter(
                              (selected) => selected !== id,
                            ),
                      }
                    : value,
                );
              }}
            />
            <span>
              {name(id)}
              {current.includes(id) && (
                <span className="oj-muted"> · назначен сейчас</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <Reason value={reason} onChange={setReason} disabled={disabled} />
      <details>
        <summary>История назначений</summary>
        <ul>
          {read.assignments.coaches.map((row) => (
            <li key={row.session_coach_id}>
              {name(row.membership_id)} ·{" "}
              {displayDate(dateInClub(row.valid_from))},{" "}
              {timeInClub(row.valid_from)} ·{" "}
              {row.valid_until
                ? `снят ${displayDate(dateInClub(row.valid_until))}, ${timeInClub(row.valid_until)}`
                : "действует"}
            </li>
          ))}
        </ul>
      </details>
      <button disabled={disabled}>
        {locked ? "Подтвердить отзыв доступа" : "Сохранить тренеров"}
      </button>
    </form>
  );
}
