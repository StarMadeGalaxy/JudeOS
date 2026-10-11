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
  staffFixtures,
  coachFixtures,
  coachMembership,
} from "./fixtures";
import { canonicalUTC, compareUTC } from "./club-time";

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
type ConfigurationCommand = Extract<
  Command,
  { operation: "rescheduleSession" | "cancelSession" | "setSessionCoaches" }
>;
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
  if (
    normalized.operation === "rescheduleSession" ||
    normalized.operation === "cancelSession" ||
    normalized.operation === "setSessionCoaches"
  ) {
    normalized.body.reason ??= "";
    normalized.body.operation_id = normalized.body.operation_id.toLowerCase();
    normalized.sessionId = normalized.sessionId.toLowerCase();
    if (normalized.operation === "setSessionCoaches")
      normalized.body.coach_membership_ids =
        normalized.body.coach_membership_ids
          .map((id) => id.toLowerCase())
          .sort();
    if (normalized.operation === "rescheduleSession") {
      normalized.body.starts_at = canonicalUTC(normalized.body.starts_at)!;
      normalized.body.ends_at = canonicalUTC(normalized.body.ends_at)!;
    }
  }
  return JSON.stringify(
    sorted({ api: "v1", tenantId, actorId, command: normalized }),
  );
}

// Deterministic in-memory UI simulator. It neither implements server security nor falls back from a live API.
export class SyntheticJournalAdapter implements JournalAdapter {
  readonly mode = "synthetic" as const;
  readonly canManage: boolean;
  readonly canConfigure: boolean;
  private data = fixtures();
  private athletes = knownAthletes();
  private staffData = staffFixtures();
  private assignments = coachFixtures();
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
    this.canConfigure = role === "administrator";
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
  async staff(): Promise<Schema["StaffPage"]> {
    await this.wait();
    this.checkAccess();
    if (!this.canManage) this.error(403, "FORBIDDEN");
    this.rejectFault(this.takeFault());
    return clone({ items: this.staffData });
  }
  async coaches(id: string): Promise<Schema["SessionCoaches"]> {
    await this.wait();
    const journal = this.target(id);
    if (!this.canManage) this.error(403, "FORBIDDEN");
    this.rejectFault(this.takeFault());
    return clone({
      session_id: id,
      version: journal.session.version,
      coaches: this.assignments.get(id)!,
    });
  }
  private configure(
    command: ConfigurationCommand,
    journal: Journal,
    fault: Fault,
  ): { value: Result; replayed: boolean } {
    const { session } = journal;
    const keys = [
      "operation_id",
      "base_version",
      "reason",
      ...(command.operation === "rescheduleSession"
        ? ["starts_at", "ends_at"]
        : command.operation === "setSessionCoaches"
          ? ["coach_membership_ids"]
          : []),
    ];
    if (
      Object.keys(command.body).some((key) => !keys.includes(key)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        command.body.operation_id,
      ) ||
      !Number.isSafeInteger(command.body.base_version) ||
      command.body.base_version < 1 ||
      (command.body.reason !== undefined &&
        (typeof command.body.reason !== "string" ||
          command.body.reason.length > 500))
    )
      this.error(400, "INVALID_REQUEST");
    if (command.operation === "rescheduleSession") {
      const comparison = compareUTC(
        command.body.ends_at,
        command.body.starts_at,
      );
      if (comparison === null || comparison <= 0)
        this.error(400, "INVALID_REQUEST");
    }
    const rows = this.assignments.get(session.session_id)!;
    const current = rows
      .filter((row) => row.valid_until === null)
      .map((row) => row.membership_id);
    let desired = current;
    if (command.operation === "setSessionCoaches") {
      if (
        !Array.isArray(command.body.coach_membership_ids) ||
        command.body.coach_membership_ids.length > 20 ||
        command.body.coach_membership_ids.some(
          (id) =>
            typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id,
            ),
        ) ||
        new Set(command.body.coach_membership_ids.map((id) => id.toLowerCase()))
          .size !== command.body.coach_membership_ids.length
      )
        this.error(400, "INVALID_REQUEST");
      desired = command.body.coach_membership_ids.map((id) => id.toLowerCase());
      for (const id of desired)
        if (!this.staffData.some((member) => member.membership_id === id))
          this.error(404, "NOT_FOUND");
    }
    const canonical = canonicalCommand(command);
    const key = command.body.operation_id.toLowerCase();
    const reject = (
      code:
        | Schema["S1CommandConflict"]["code"]
        | Schema["TrainingCommandConflict"]["code"],
      version: number | null = null,
    ): never => {
      const conflict = {
        code,
        message: "Синтетический конфликт настройки занятия.",
        request_id: "synthetic-journal",
        operation_id: command.body.operation_id,
        current_version: version,
      } as Failure;
      this.results.set(key, { canonical, conflict: clone(conflict) });
      throw new JournalError(409, conflict);
    };
    const previous = this.results.get(key);
    if (previous) {
      if (previous.canonical !== canonical)
        throw new JournalError(
          409,
          this.s1(command, "OPERATION_ID_REUSED", null),
        );
      if (previous.conflict)
        throw new JournalError(409, clone(previous.conflict));
      return { value: clone(previous.value!), replayed: true };
    }
    const locked = session.state === "closed" || session.state === "cancelled";
    if (command.operation === "setSessionCoaches") {
      if (locked && desired.some((id) => !current.includes(id)))
        reject("SESSION_ROSTER_LOCKED");
      for (const id of desired.filter((id) => !current.includes(id))) {
        const member = this.staffData.find(
          (member) => member.membership_id === id,
        )!;
        if (
          !member.active ||
          member.state !== "active" ||
          !member.grants.some(
            (grant) =>
              grant.role === "coach" && grant.scope === "assigned_sessions",
          )
        )
          reject("COACH_INACTIVE");
      }
    } else if (locked)
      reject(
        session.state === "closed" ? "SESSION_CLOSED" : "SESSION_CANCELLED",
      );
    if (fault === "conflict") session.version += 1;
    if (session.version !== command.body.base_version)
      reject("SESSION_VERSION_CONFLICT", session.version);
    let changed = false;
    let result: Result;
    if (command.operation === "rescheduleSession") {
      changed =
        compareUTC(command.body.starts_at, session.starts_at) !== 0 ||
        compareUTC(command.body.ends_at, session.ends_at) !== 0;
      if (changed) {
        session.starts_at = command.body.starts_at;
        session.ends_at = command.body.ends_at;
        session.version += 1;
      }
      result = clone(session);
    } else if (command.operation === "cancelSession") {
      changed = true;
      session.state = "cancelled";
      session.version += 1;
      result = clone(session);
    } else {
      changed =
        current.length !== desired.length ||
        desired.some((id) => !current.includes(id));
      if (changed) {
        const now = new Date(
          Date.parse(fixtureNow) + ++this.sequence,
        ).toISOString();
        for (const row of rows)
          if (row.valid_until === null && !desired.includes(row.membership_id))
            row.valid_until = now;
        for (const id of desired)
          if (!current.includes(id))
            rows.push({
              session_coach_id: uuid(++this.sequence + 20000),
              membership_id: id,
              valid_from: now,
              valid_until: null,
            });
        session.version += 1;
        if (desired.includes(coachMembership))
          this.assigned.add(session.session_id);
        else this.assigned.delete(session.session_id);
      }
      result = {
        session_id: session.session_id,
        version: session.version,
        coaches: clone(rows),
      };
    }
    if (changed) this.history.push(clone(command));
    this.results.set(key, { canonical, value: clone(result) });
    if (fault === "lost-response") this.error(0, "SERVICE_UNAVAILABLE");
    return { value: clone(result), replayed: false };
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
    const configuration =
      command.operation === "rescheduleSession" ||
      command.operation === "cancelSession" ||
      command.operation === "setSessionCoaches";
    if (configuration && !this.canConfigure) this.error(403, "FORBIDDEN");
    const fault = this.takeFault();
    this.rejectFault(fault);
    if (
      command.operation === "rescheduleSession" ||
      command.operation === "cancelSession" ||
      command.operation === "setSessionCoaches"
    )
      return this.configure(command, journal, fault);
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
