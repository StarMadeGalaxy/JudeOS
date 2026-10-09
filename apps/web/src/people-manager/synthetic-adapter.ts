import {
  activeGuardian,
  RegistryError,
  type RegistryAdapter,
  type Kind,
  type Pages,
  type Profiles,
  type Query,
  type Command,
  type Result,
  type Person,
  type Athlete,
  type Household,
} from "./model";
import { fixtures, fixtureNow, tenantId, uuid } from "./fixtures";
export type Fault =
  | "none"
  | "network"
  | "503"
  | "401"
  | "403"
  | "404"
  | "conflict"
  | "lost-response";
// A deterministic UI simulator, never a security implementation or a live API fallback.
export class SyntheticAdapter implements RegistryAdapter {
  readonly mode = "synthetic" as const;
  private data = fixtures();
  private sequence = 1000;
  private fault: Fault = "none";
  private permission = true;
  private clock = fixtureNow;
  readonly history: Command[] = [];
  private results = new Map<
    string,
    { canonical: string; value: Result; current: () => Result }
  >();
  private conflicts = new Map<string, { canonical: string; version: number }>();
  failNext(fault: Fault) {
    this.fault = fault;
  }
  setPermission(allowed: boolean) {
    this.permission = allowed;
  }
  setClock(now: number) {
    this.clock = now;
  }
  now() {
    return this.clock;
  }
  private id() {
    return uuid(this.sequence++);
  }
  private person(id: string): Person {
    const p = this.data.people.find((v) => v.person_id === id);
    if (!p) throw new RegistryError(404, "NOT_FOUND");
    return p;
  }
  private athlete(id: string): Athlete {
    const a = this.data.athletes.find((v) => v.athlete_id === id);
    if (!a) throw new RegistryError(404, "NOT_FOUND");
    return a;
  }
  private household(id: string): Household {
    const h = this.data.households.find((v) => v.household_id === id);
    if (!h) throw new RegistryError(404, "NOT_FOUND");
    return h;
  }
  private athleteView(a: Athlete): Athlete {
    const value = structuredClone(a);
    value.person = structuredClone(this.person(a.person.person_id));
    value.guardian_links = value.guardian_links.map((g) => ({
      ...g,
      representative_display_name: this.person(g.representative_person_id)
        .display_name,
    }));
    const link = value.guardian_links.find(
      (g) =>
        g.guardian_link_id === value.primary_guardian_link_id &&
        activeGuardian(g, this.clock),
    );
    const representative = link
      ? this.person(link.representative_person_id)
      : null;
    value.primary_contact =
      !a.archived &&
      !value.person.archived &&
      representative &&
      !representative.archived
        ? {
            display_name: representative.display_name,
            phone: representative.phone ?? null,
          }
        : null;
    return value;
  }
  private householdView(h: Household): Household {
    return {
      ...structuredClone(h),
      members: h.members.map((m) => ({
        ...m,
        display_name: this.person(m.person_id).display_name,
      })),
    };
  }
  private guard() {
    if (!this.permission) throw new RegistryError(403, "FORBIDDEN");
  }
  private async before(): Promise<Fault> {
    this.guard();
    const fault = this.fault;
    this.fault = "none";
    await new Promise((resolve) => setTimeout(resolve, 80));
    this.guard();
    if (fault === "network") throw new RegistryError(0, "NETWORK_UNKNOWN");
    if (["401", "403", "404", "503"].includes(fault))
      throw new RegistryError(Number(fault), "REQUEST_FAILED");
    return fault;
  }
  async list<K extends Kind>(kind: K, query: Query): Promise<Pages[K]> {
    await this.before();
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      query.q.length > 200 ||
      !["active", "archived", "all"].includes(query.state) ||
      (query.cursor && !/^[0-9a-f-]{36}$/i.test(query.cursor)) ||
      (kind === "households" && query.state === "archived")
    )
      throw new RegistryError(400, "INVALID_REQUEST");
    const summaries =
      kind === "people"
        ? this.data.people.map(
            ({ person_id, tenant_id, display_name, archived, version }) => ({
              person_id,
              tenant_id,
              display_name,
              archived,
              version,
            }),
          )
        : kind === "athletes"
          ? this.data.athletes.map((a) => ({
              athlete_id: a.athlete_id,
              person_id: a.person.person_id,
              display_name: this.person(a.person.person_id).display_name,
              participation: a.participation,
              archived: a.archived,
              version: a.version,
            }))
          : this.data.households.map(({ household_id, name, version }) => ({
              household_id,
              name,
              version,
            }));
    const key = (v: (typeof summaries)[number]) =>
      "athlete_id" in v
        ? v.athlete_id
        : "person_id" in v
          ? v.person_id
          : v.household_id;
    const filtered = summaries
      .filter(
        (v) =>
          ("name" in v ? v.name : v.display_name)
            .toLocaleLowerCase("ru")
            .includes(query.q.toLocaleLowerCase("ru")) &&
          (!query.cursor || key(v) > query.cursor) &&
          (!("archived" in v) ||
            query.state === "all" ||
            v.archived === (query.state === "archived")),
      )
      .sort((a, b) => key(a).localeCompare(key(b)));
    const items = filtered.slice(0, query.limit);
    return structuredClone({
      items,
      next_cursor:
        filtered.length > items.length ? key(items[items.length - 1]) : null,
    }) as Pages[K];
  }
  async get<K extends Kind>(kind: K, id: string): Promise<Profiles[K]> {
    await this.before();
    return structuredClone(
      kind === "people"
        ? this.person(id)
        : kind === "athletes"
          ? this.athleteView(this.athlete(id))
          : this.householdView(this.household(id)),
    ) as Profiles[K];
  }
  async execute(
    command: Command,
  ): Promise<{ value: Result; replayed: boolean }> {
    const fault = await this.before();
    const { operation: op, target, body } = command;
    // Resolve object before version/replay, matching the neutral unknown-object policy.
    const entity =
      op === "createPerson" ||
      op === "createHousehold" ||
      op === "createAthlete"
        ? null
        : op.includes("Person")
          ? this.person(target)
          : op.includes("Household")
            ? this.household(target.split("/")[0])
            : this.athlete(target.split("/")[0]);
    if (op === "createAthlete") this.person(body.person_id);
    if (
      op === "revokeGuardianLink" &&
      !this.athlete(target.split("/")[0]).guardian_links.some(
        (g) => g.guardian_link_id === target.split("/")[1],
      )
    )
      throw new RegistryError(404, "NOT_FOUND");
    if (
      op === "endHouseholdMember" &&
      !this.household(target.split("/")[0]).members.some(
        (m) => m.household_member_id === target.split("/")[1],
      )
    )
      throw new RegistryError(404, "NOT_FOUND");
    const normalized = {
      ...body,
      ...("phone" in body || op === "createPerson" || op === "updatePerson"
        ? { phone: ("phone" in body ? body.phone : null) ?? null }
        : {}),
    };
    const canonical = JSON.stringify({
      op,
      target,
      body: Object.fromEntries(
        Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)),
      ),
    });
    const conflict = this.conflicts.get(body.operation_id);
    if (conflict) {
      if (canonical !== conflict.canonical)
        throw new RegistryError(
          409,
          "OPERATION_ID_REUSED",
          entity?.version ?? null,
        );
      throw new RegistryError(409, "ENTITY_VERSION_CONFLICT", conflict.version);
    }
    const old = this.results.get(body.operation_id);
    if (old) {
      if (canonical !== old.canonical)
        throw new RegistryError(
          409,
          "OPERATION_ID_REUSED",
          entity?.version ?? null,
        );
      if (JSON.stringify(old.current()) !== JSON.stringify(old.value))
        throw new RegistryError(
          409,
          "RESULT_NOT_CURRENT",
          entity?.version ?? null,
        );
      return { value: structuredClone(old.value), replayed: true };
    }
    if (entity && fault === "conflict") entity.version++;
    if (
      entity &&
      "base_version" in body &&
      body.base_version !== entity.version
    ) {
      this.conflicts.set(body.operation_id, {
        canonical,
        version: entity.version,
      });
      throw new RegistryError(409, "ENTITY_VERSION_CONFLICT", entity.version);
    }
    if (
      entity &&
      "archived" in entity &&
      entity.archived &&
      op !== "archivePerson" &&
      op !== "archiveAthlete"
    )
      throw new RegistryError(409, "PERSON_ARCHIVED", entity.version);
    const text = (v: string, max = 200) => {
      if (!v.trim() || v.length > max)
        throw new RegistryError(400, "INVALID_REQUEST");
      return v.trim();
    };
    const period = (from: string, until: string | null) => {
      if (
        !from.endsWith("Z") ||
        !Number.isFinite(Date.parse(from)) ||
        (until !== null &&
          (!until.endsWith("Z") ||
            !Number.isFinite(Date.parse(until)) ||
            Date.parse(until) <= Date.parse(from)))
      )
        throw new RegistryError(400, "INVALID_REQUEST");
    };
    let current: () => Result;
    switch (op) {
      case "createPerson": {
        const p: Person = {
          person_id: this.id(),
          tenant_id: tenantId,
          display_name: text(body.display_name),
          phone: body.phone == null ? null : text(body.phone, 50),
          archived: false,
          version: 1,
        };
        this.data.people.push(p);
        current = () => structuredClone(p);
        break;
      }
      case "updatePerson": {
        const p = this.person(target),
          name = text(body.display_name),
          phone = body.phone == null ? null : text(body.phone, 50);
        p.display_name = name;
        p.phone = phone;
        p.version++;
        current = () => structuredClone(p);
        break;
      }
      case "createAthlete": {
        const p = this.person(body.person_id);
        if (p.archived)
          throw new RegistryError(409, "PERSON_ARCHIVED", p.version);
        if (this.data.athletes.some((a) => a.person.person_id === p.person_id))
          throw new RegistryError(409, "ATHLETE_ALREADY_EXISTS", null);
        const a: Athlete = {
          athlete_id: this.id(),
          person: p,
          participation: body.participation,
          archived: false,
          version: 1,
          guardian_links: [],
          primary_guardian_link_id: null,
          primary_contact: null,
          admission: null,
        };
        this.data.athletes.push(a);
        current = () => this.athleteView(a);
        break;
      }
      case "updateAthlete": {
        const a = this.athlete(target);
        a.participation = body.participation;
        a.version++;
        current = () => this.athleteView(a);
        break;
      }
      case "archivePerson": {
        const p = this.person(target);
        if (!p.archived) {
          p.archived = true;
          p.phone = null;
          p.version++;
          for (const a of this.data.athletes) {
            let changed = false;
            if (a.person.person_id === p.person_id) {
              a.archived = true;
              changed = true;
            }
            for (const g of a.guardian_links)
              if (
                g.status === "verified" &&
                (g.representative_person_id === p.person_id ||
                  a.person.person_id === p.person_id)
              ) {
                g.status = "revoked";
                g.version++;
                if (a.primary_guardian_link_id === g.guardian_link_id)
                  a.primary_guardian_link_id = null;
                changed = true;
              }
            if (changed) a.version++;
          }
        }
        current = () => structuredClone(p);
        break;
      }
      case "archiveAthlete": {
        const a = this.athlete(target);
        if (!a.archived) {
          a.archived = true;
          a.primary_guardian_link_id = null;
          a.guardian_links.forEach((g) => {
            if (g.status === "verified") {
              g.status = "revoked";
              g.version++;
            }
          });
          a.version++;
        }
        current = () => this.athleteView(a);
        break;
      }
      case "verifyGuardianLink": {
        const a = this.athlete(target),
          p = this.person(body.representative_person_id);
        if (p.archived)
          throw new RegistryError(409, "PERSON_ARCHIVED", p.version);
        period(body.valid_from, body.valid_until);
        const basis = text(body.basis_kind, 80);
        const g = {
          guardian_link_id: this.id(),
          athlete_id: a.athlete_id,
          representative_person_id: p.person_id,
          representative_display_name: p.display_name,
          status: "verified" as const,
          basis_kind: basis,
          verified_by_account_id: uuid(201),
          valid_from: body.valid_from,
          valid_until: body.valid_until,
          version: 1,
        };
        a.guardian_links.push(g);
        a.version++;
        current = () => structuredClone(g);
        break;
      }
      case "setPrimaryContact": {
        const a = this.athlete(target),
          g = a.guardian_links.find(
            (g) => g.guardian_link_id === body.guardian_link_id,
          );
        if (
          body.guardian_link_id !== null &&
          (!g ||
            !activeGuardian(g, this.clock) ||
            this.person(g.representative_person_id).archived)
        )
          throw new RegistryError(409, "GUARDIAN_LINK_INACTIVE", a.version);
        a.primary_guardian_link_id = body.guardian_link_id;
        a.version++;
        current = () => this.athleteView(a);
        break;
      }
      case "revokeGuardianLink": {
        const [aid, gid] = target.split("/"),
          a = this.athlete(aid),
          g = a.guardian_links.find((g) => g.guardian_link_id === gid);
        if (!g) throw new RegistryError(404, "NOT_FOUND");
        if (g.status !== "revoked") {
          g.status = "revoked";
          g.version++;
          if (a.primary_guardian_link_id === gid)
            a.primary_guardian_link_id = null;
          a.version++;
        }
        current = () => this.athleteView(a);
        break;
      }
      case "createHousehold": {
        const h: Household = {
          household_id: this.id(),
          name: text(body.name),
          version: 1,
          members: [],
        };
        this.data.households.push(h);
        current = () => this.householdView(h);
        break;
      }
      case "updateHousehold": {
        const h = this.household(target);
        h.name = text(body.name);
        h.version++;
        current = () => this.householdView(h);
        break;
      }
      case "addHouseholdMember": {
        const h = this.household(target),
          p = this.person(body.person_id);
        if (p.archived)
          throw new RegistryError(409, "PERSON_ARCHIVED", p.version);
        period(body.valid_from, body.valid_until);
        h.members.push({
          household_member_id: this.id(),
          person_id: p.person_id,
          display_name: p.display_name,
          valid_from: body.valid_from,
          valid_until: body.valid_until,
        });
        h.version++;
        current = () => this.householdView(h);
        break;
      }
      case "endHouseholdMember": {
        const [hid, mid] = target.split("/"),
          h = this.household(hid),
          m = h.members.find((m) => m.household_member_id === mid);
        if (!m) throw new RegistryError(404, "NOT_FOUND");
        if (m.valid_until !== null)
          throw new RegistryError(409, "MEMBERSHIP_ENDED", h.version);
        period(m.valid_from, body.valid_until);
        m.valid_until = body.valid_until;
        h.version++;
        current = () => this.householdView(h);
        break;
      }
    }
    const value = current();
    this.results.set(body.operation_id, {
      canonical,
      value: structuredClone(value),
      current,
    });
    this.history.push(structuredClone(command));
    if (fault === "lost-response")
      throw new RegistryError(0, "NETWORK_UNKNOWN");
    return { value: structuredClone(value), replayed: false };
  }
}
