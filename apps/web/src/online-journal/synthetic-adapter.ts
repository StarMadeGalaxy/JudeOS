import {
  JournalError,
  dateInClub,
  type JournalAdapter,
  type Command,
  type Result,
  type Failure,
  type DemoRole,
  type Journal,
  type Schema,
} from "./model";
import {
  fixtures,
  knownAthletes,
  actorId,
  fixtureNow,
  tenantId,
  uuid,
} from "./fixtures";

export type Fault =
  | "none"
  | "lost-response"
  | "network"
  | "503"
  | "401"
  | "403"
  | "404"
  | "conflict";
type Stored = { canonical: string; value?: Result; conflict?: Failure };
const clone = <T>(value: T): T => structuredClone(value);
const sorted = (value: unknown): unknown =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, sorted(item)]),
      )
    : value;
function canonicalCommand(command: Command) {
  const normalized = clone(command);
  if (normalized.operation === "setAttendance") normalized.body.reason ??= "";
  if (normalized.operation === "createSessionGuest")
    normalized.body.phone ??= null;
  return JSON.stringify(
    sorted({ api: "v1", tenantId, actorId, command: normalized }),
  );
}

// Deterministic in-memory UI simulator. It neither implements server security nor falls back from a live API.
export class SyntheticJournalAdapter implements JournalAdapter {
  readonly mode = "synthetic" as const;
  readonly canManage: boolean;
  private data = fixtures();
  private athletes = knownAthletes();
  private results = new Map<string, Stored>();
  private fault: Fault = "none";
  private allowed = true;
  private assigned = new Set([uuid(501), uuid(503), uuid(504)]);
  private archived = new Set<string>();
  private sequence = 1200;
  readonly history: Command[] = [];
  constructor(
    readonly role: DemoRole = "coach",
    readonly delay = 180,
  ) {
    this.canManage = role !== "coach";
  }
  failNext(fault: Fault) {
    this.fault = fault;
  }
  revoke() {
    this.allowed = false;
  }
  removeAssignment(id: string) {
    this.assigned.delete(id);
  }
  archiveAthlete(id: string) {
    this.archived.add(id);
  }
  clearContact(id: string) {
    for (const journal of this.data)
      for (const entry of journal.roster)
        if (entry.athlete_id === id) entry.primary_contact = null;
  }
  private wait() {
    return new Promise<void>((resolve) => setTimeout(resolve, this.delay));
  }
  private error(status: number, code: Schema["Error"]["code"]): never {
    throw new JournalError(status, {
      code,
      message: "Синтетическая ошибка.",
      request_id: "synthetic-journal",
    });
  }
  private checkAccess() {
    if (!this.allowed) this.error(403, "FORBIDDEN");
  }
  private target(id: string): Journal {
    this.checkAccess();
    const value = this.data.find(
      (j) => j.session.session_id === id && j.session.tenant_id === tenantId,
    );
    if (!value || (!this.canManage && !this.assigned.has(id)))
      this.error(404, "NOT_FOUND");
    return value!;
  }
  private takeFault(): Fault {
    const value = this.fault;
    this.fault = "none";
    return value;
  }
  private rejectFault(fault: Fault) {
    if (fault === "network" || fault === "503")
      this.error(fault === "network" ? 0 : 503, "SERVICE_UNAVAILABLE");
    if (fault === "401" || fault === "403") {
      this.allowed = false;
      this.error(
        Number(fault),
        fault === "401" ? "UNAUTHENTICATED" : "FORBIDDEN",
      );
    }
    if (fault === "404") this.error(404, "NOT_FOUND");
  }
  async list(date: string, cursor?: string): Promise<Schema["SessionPage"]> {
    await this.wait();
    this.checkAccess();
    this.rejectFault(this.takeFault());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) this.error(400, "INVALID_REQUEST");
    const items = this.data
      .filter(
        (j) =>
          (this.canManage || this.assigned.has(j.session.session_id)) &&
          dateInClub(j.session.starts_at) === date,
      )
      .map((j) => j.session)
      .sort(
        (a, b) =>
          a.starts_at.localeCompare(b.starts_at) ||
          a.session_id.localeCompare(b.session_id),
      );
    const prefix = `${this.role}/${date}/`;
    if (cursor && !cursor.startsWith(prefix))
      this.error(400, "INVALID_REQUEST");
    const start = cursor ? Number(cursor.slice(prefix.length)) : 0;
    if (!Number.isInteger(start) || start < 0 || start > items.length)
      this.error(400, "INVALID_REQUEST");
    return clone({
      items: items.slice(start, start + 2),
      next_cursor: start + 2 < items.length ? `${prefix}${start + 2}` : null,
    });
  }
  async get(id: string): Promise<Journal> {
    await this.wait();
    this.rejectFault(this.takeFault());
    const journal = clone(this.target(id));
    for (const entry of journal.roster)
      if (entry.excluded || this.archived.has(entry.athlete_id)) {
        entry.primary_contact = null;
        entry.admission = null;
      }
    return journal;
  }
  async known(q: string, cursor?: string): Promise<Schema["AthletePage"]> {
    await this.wait();
    this.checkAccess();
    if (!this.canManage) this.error(403, "FORBIDDEN");
    this.rejectFault(this.takeFault());
    const values = this.athletes
      .filter(
        (a) =>
          !a.archived &&
          !this.archived.has(a.athlete_id) &&
          a.display_name
            .toLocaleLowerCase("ru")
            .includes(q.toLocaleLowerCase("ru")),
      )
      .sort((a, b) => a.athlete_id.localeCompare(b.athlete_id));
    const items = cursor ? values.filter((a) => a.athlete_id > cursor) : values;
    return clone({
      items: items.slice(0, 2),
      next_cursor: items.length > 2 ? items[1].athlete_id : null,
    });
  }
  private s1(
    command: Command,
    code: Schema["S1CommandConflict"]["code"],
    current: number | null,
  ): Failure {
    return {
      code,
      message: "Синтетический конфликт.",
      request_id: "synthetic-journal",
      operation_id: command.body.operation_id,
      current_version: current,
    };
  }
  private conflict(
    command: Command,
    code: "SESSION_CANCELLED" | "ATHLETE_ARCHIVED" | "OPERATION_ID_REUSED",
  ): never {
    if (command.operation === "setAttendance") this.error(409, code);
    throw new JournalError(409, this.s1(command, code, null));
  }
  async execute(input: Command): Promise<{ value: Result; replayed: boolean }> {
    const command = clone(input);
    await this.wait();
    const journal = this.target(command.sessionId);
    if (command.operation === "excludeRosterAthlete" && !this.canManage)
      this.error(403, "FORBIDDEN");
    const fault = this.takeFault();
    this.rejectFault(fault);
    const { session } = journal;
    if (session.state === "cancelled")
      this.conflict(command, "SESSION_CANCELLED");
    if (
      [
        "createSessionGuest",
        "addKnownRosterAthlete",
        "excludeRosterAthlete",
      ].includes(command.operation) &&
      session.state === "closed"
    )
      throw new JournalError(409, this.s1(command, "SESSION_CLOSED", null));
    const entry =
      "athleteId" in command
        ? journal.roster.find((e) => e.athlete_id === command.athleteId)
        : undefined;
    if (
      "athleteId" in command &&
      (!entry || (command.operation === "setAttendance" && entry.excluded))
    )
      this.error(404, "NOT_FOUND");
    if (entry && this.archived.has(entry.athlete_id))
      this.conflict(command, "ATHLETE_ARCHIVED");
    if (
      command.operation === "addKnownRosterAthlete" &&
      this.archived.has(command.body.athlete_id)
    )
      this.conflict(command, "ATHLETE_ARCHIVED");
    const canonical = canonicalCommand(command);
    const previous = this.results.get(command.body.operation_id);
    if (previous) {
      if (canonical !== previous.canonical)
        this.conflict(command, "OPERATION_ID_REUSED");
      if (previous.conflict)
        throw new JournalError(409, clone(previous.conflict));
      return { value: clone(previous.value!), replayed: true };
    }
    if (command.operation === "closeSession" && session.state === "closed")
      throw new JournalError(409, this.s1(command, "SESSION_CLOSED", null));
    if (fault === "conflict") {
      if (command.operation === "setAttendance" && entry) {
        entry.attendance = {
          athlete_id: entry.athlete_id,
          status: "sick",
          version: entry.attendance.version + 1,
          recorded_at: fixtureNow,
          recorded_by_account_id: uuid(2),
        };
      } else session.version += 1;
    }
    const version =
      command.operation === "setAttendance"
        ? entry!.attendance.version
        : session.version;
    if (version !== command.body.base_version) {
      const conflict: Failure =
        command.operation === "setAttendance"
          ? {
              code: "ATTENDANCE_VERSION_CONFLICT",
              message: "Синтетический конфликт отметки.",
              request_id: "synthetic-journal",
              operation_id: command.body.operation_id,
              current: clone(entry!.attendance),
            }
          : this.s1(command, "SESSION_VERSION_CONFLICT", version);
      this.results.set(command.body.operation_id, {
        canonical,
        conflict: clone(conflict),
      });
      throw new JournalError(409, conflict);
    }
    let result: Result;
    if (command.operation === "setAttendance") {
      entry!.attendance = {
        athlete_id: entry!.athlete_id,
        status: command.body.status,
        version: version + 1,
        recorded_at: fixtureNow,
        recorded_by_account_id: actorId,
      };
      result = {
        operation_id: command.body.operation_id,
        attendance: clone(entry!.attendance),
      };
    } else if (command.operation === "closeSession") {
      session.state = "closed";
      session.version += 1;
      const count = journal.roster.filter(
        (e) => !e.excluded && e.attendance.status === "unmarked",
      ).length;
      result = {
        operation_id: command.body.operation_id,
        session: { ...clone(session), state: "closed" },
        unmarked_count: count,
        warning: count === 0 ? null : "UNMARKED_REMAIN",
      };
    } else if (command.operation === "excludeRosterAthlete") {
      if (!entry!.excluded) {
        entry!.excluded = true;
        entry!.primary_contact = null;
        entry!.admission = null;
        session.version += 1;
      }
      result = {
        operation_id: command.body.operation_id,
        session: clone(session),
        entry: clone(entry!),
      };
    } else {
      let added: Schema["RosterEntry"];
      if (command.operation === "createSessionGuest") {
        if (
          !command.body.display_name.trim() ||
          command.body.display_name.length > 200
        )
          this.error(400, "INVALID_REQUEST");
        const number = ++this.sequence;
        added = {
          athlete_id: uuid(number),
          person_id: uuid(number + 10000),
          display_name: command.body.display_name.trim(),
          participation: "guest",
          trial: command.body.trial,
          primary_contact: null,
          admission: null,
          excluded: false,
          attendance: {
            athlete_id: uuid(number),
            status: "unmarked",
            version: 0,
            recorded_at: null,
            recorded_by_account_id: null,
          },
        };
        this.athletes.push({
          athlete_id: added.athlete_id,
          person_id: added.person_id,
          display_name: added.display_name,
          participation: "guest",
          archived: false,
          version: 1,
        });
      } else {
        const athlete = this.athletes.find(
          (a) =>
            a.athlete_id === command.body.athlete_id &&
            !a.archived &&
            !this.archived.has(a.athlete_id),
        );
        if (!athlete) this.error(404, "NOT_FOUND");
        const existing = journal.roster.find(
          (e) => e.athlete_id === athlete!.athlete_id,
        );
        if (existing?.excluded)
          throw new JournalError(
            409,
            this.s1(command, "ROSTER_EXCLUDED", null),
          );
        if (existing) {
          result = {
            operation_id: command.body.operation_id,
            session: clone(session),
            entry: clone(existing),
          };
          this.results.set(command.body.operation_id, {
            canonical,
            value: clone(result),
          });
          if (fault === "lost-response") this.error(0, "SERVICE_UNAVAILABLE");
          return { value: result, replayed: false };
        }
        added = {
          athlete_id: athlete!.athlete_id,
          person_id: athlete!.person_id,
          display_name: athlete!.display_name,
          participation: "visit",
          trial: command.body.trial,
          primary_contact: null,
          admission: null,
          excluded: false,
          attendance: {
            athlete_id: athlete!.athlete_id,
            status: "unmarked",
            version: 0,
            recorded_at: null,
            recorded_by_account_id: null,
          },
        };
      }
      journal.roster.push(added);
      session.version += 1;
      result = {
        operation_id: command.body.operation_id,
        session: clone(session),
        entry: clone(added),
      };
    }
    this.history.push(clone(command));
    this.results.set(command.body.operation_id, {
      canonical,
      value: clone(result),
    });
    if (fault === "lost-response") this.error(0, "SERVICE_UNAVAILABLE");
    return { value: clone(result), replayed: false };
  }
}
