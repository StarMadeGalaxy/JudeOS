const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const moduleRoot = path.resolve(__dirname, "..");
// Compile synthetic-adapter.ts into dist/adapter-tests before this check (README).
const { SyntheticJournalAdapter } = require(
  path.join(moduleRoot, "dist/adapter-tests/synthetic-adapter.js"),
);
const { fixtures, uuid, fixtureDate } = require(
  path.join(moduleRoot, "dist/adapter-tests/fixtures.js"),
);
const Ajv = require("../../../../../api/node_modules/ajv");
const ajv = new Ajv({ strict: false, allErrors: true });
require("../../../../../api/node_modules/ajv-formats")(ajv);
const spec = JSON.parse(
  fs.readFileSync(path.join(moduleRoot, "contract/journal.openapi.json")),
);
const operations = Object.values(spec.paths).flatMap(Object.values);
const validators = new Map();
function validate(name, value) {
  if (!validators.has(name))
    validators.set(
      name,
      ajv.compile({
        $ref: `#/components/schemas/${name}`,
        components: spec.components,
      }),
    );
  const check = validators.get(name);
  assert(check(value), `${name}: ${JSON.stringify(check.errors)}`);
}
let sequence = 9000;
function input(operation, payload, athleteId, sessionId = uuid(501)) {
  return {
    operation,
    sessionId,
    ...(athleteId ? { athleteId } : {}),
    body: { operation_id: uuid(sequence++), ...payload },
  };
}
async function execute(adapter, command) {
  const op = operations.find((o) => o.operationId === command.operation);
  validate(
    op.requestBody.content["application/json"].schema.$ref.split("/").pop(),
    command.body,
  );
  const result = await adapter.execute(command);
  const response = op.responses["200"] || op.responses["201"];
  validate(
    response.content["application/json"].schema.$ref.split("/").pop(),
    result.value,
  );
  return result;
}
const rejects = (promise, code, status = 409, schema) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.body.code, code);
    if (schema) validate(schema, error.body);
    return true;
  });
const adapter = (role = "coach") => new SyntheticJournalAdapter(role, 0);

test("the fixture projections and all thirteen consumed operations use the accepted wire", async () => {
  assert.equal(operations.length, 13);
  assert.deepEqual(spec.components.schemas.AttendanceStatus.enum, [
    "present",
    "absent",
    "sick",
    "unmarked",
  ]);
  fixtures().forEach((j) => validate("SessionJournal", j));
  const a = adapter("manager");
  validate("SessionPage", await a.list(fixtureDate));
  validate("AthletePage", await a.known(""));
  validate("SessionJournal", await a.get(uuid(501)));
  validate("StaffPage", await a.staff());
  validate("SessionCoaches", await a.coaches(uuid(501)));
  for (const status of ["present", "absent", "sick", "unmarked"]) {
    const row = (await a.get(uuid(501))).roster[1];
    const { value } = await execute(
      a,
      input(
        "setAttendance",
        { base_version: row.attendance.version, status },
        row.athlete_id,
      ),
    );
    assert.equal(value.attendance.status, status);
    assert(value.attendance.version > 0);
    assert(value.attendance.recorded_at);
  }
  await execute(
    a,
    input("createSessionGuest", {
      base_version: 1,
      display_name: "Синтетический новый гость",
      phone: null,
      trial: true,
    }),
  );
  await execute(
    a,
    input("addKnownRosterAthlete", {
      base_version: 2,
      athlete_id: uuid(421),
      trial: false,
    }),
  );
  await execute(
    a,
    input("excludeRosterAthlete", { base_version: 3 }, uuid(401)),
  );
  const result = await execute(a, input("closeSession", { base_version: 4 }));
  assert.equal(result.value.warning, "UNMARKED_REMAIN");
});

test("paging is local-date/role bound; a coach cannot enumerate the registry or open another session", async () => {
  const a = adapter();
  const first = await a.list(fixtureDate);
  const second = await a.list(fixtureDate, first.next_cursor);
  assert.equal(
    new Set([...first.items, ...second.items].map((s) => s.session_id)).size,
    3,
  );
  assert.equal(second.next_cursor, null);
  await rejects(
    a.list("2026-10-11", first.next_cursor),
    "INVALID_REQUEST",
    400,
  );
  assert.equal((await a.list("2026-10-11")).items.length, 0);
  await rejects(a.known(""), "FORBIDDEN", 403);
  await rejects(a.get(uuid(502)), "NOT_FOUND", 404);
  const b = adapter("administrator");
  const known = await b.known("");
  const more = await b.known("", known.next_cursor);
  assert.equal(
    new Set([...known.items, ...more.items].map((v) => v.athlete_id)).size,
    3,
  );
  assert(!JSON.stringify(known).includes("phone"));
  const all = [
    ...(await b.list(fixtureDate)).items,
    ...(await b.list(fixtureDate, (await b.list(fixtureDate)).next_cursor))
      .items,
  ];
  assert.equal(all.length, 4);
});

test("a lost response has one effect; exact replay is canonical and cannot roll back a later correction", async () => {
  const a = adapter();
  const command = input(
    "setAttendance",
    { base_version: 0, status: "present" },
    uuid(402),
  );
  a.failNext("lost-response");
  await rejects(a.execute(command), "SERVICE_UNAVAILABLE", 0);
  const { value, replayed } = await execute(a, {
    athleteId: command.athleteId,
    body: {
      reason: "",
      status: "present",
      base_version: 0,
      operation_id: command.body.operation_id,
    },
    sessionId: command.sessionId,
    operation: command.operation,
  });
  assert(replayed);
  assert.equal(value.attendance.version, 1);
  assert.equal(a.history.length, 1);
  await execute(
    a,
    input("setAttendance", { base_version: 1, status: "sick" }, uuid(402)),
  );
  assert.equal((await execute(a, command)).value.attendance.status, "present");
  assert.equal((await a.get(uuid(501))).roster[1].attendance.status, "sick");
  await rejects(
    a.execute({ ...command, body: { ...command.body, status: "absent" } }),
    "OPERATION_ID_REUSED",
    409,
    "AttendanceCommandConflict",
  );
  assert.equal(a.history.length, 2);
});

test("attendance versions are independent; version conflict is terminal until explicit fresh intent", async () => {
  const a = adapter();
  await execute(
    a,
    input("setAttendance", { base_version: 0, status: "present" }, uuid(402)),
  );
  await execute(
    a,
    input("setAttendance", { base_version: 0, status: "absent" }, uuid(403)),
  );
  assert.equal((await a.get(uuid(501))).session.version, 1);
  const stale = input(
    "setAttendance",
    { base_version: 0, status: "unmarked" },
    uuid(402),
  );
  await rejects(
    a.execute(stale),
    "ATTENDANCE_VERSION_CONFLICT",
    409,
    "AttendanceCommandConflict",
  );
  await execute(
    a,
    input("setAttendance", { base_version: 1, status: "sick" }, uuid(402)),
  );
  await rejects(
    a.execute(stale),
    "ATTENDANCE_VERSION_CONFLICT",
    409,
    "AttendanceCommandConflict",
  );
  await execute(
    a,
    input("setAttendance", { base_version: 2, status: "unmarked" }, uuid(402)),
  );
  assert.equal((await a.get(uuid(501))).roster[1].attendance.version, 3);
});

test("closing preserves every unmarked row; closed corrections work and composition/cancelled writes do not", async () => {
  for (const role of ["coach", "manager", "administrator"]) {
    const a = adapter(role);
    const before = await a.get(uuid(501));
    const close = input("closeSession", { base_version: 1 });
    const result = await execute(a, close);
    assert.equal(result.value.unmarked_count, 4);
    assert.deepEqual((await a.get(uuid(501))).roster, before.roster);
    assert((await execute(a, close)).replayed);
    await execute(
      a,
      input("setAttendance", { base_version: 0, status: "present" }, uuid(402)),
    );
    await rejects(
      a.execute(
        input("createSessionGuest", {
          base_version: 2,
          display_name: "Синтетический гость",
          trial: false,
        }),
      ),
      "SESSION_CLOSED",
    );
    await rejects(
      a.execute(
        input(
          "setAttendance",
          { base_version: 0, status: "present" },
          uuid(413),
          uuid(504),
        ),
      ),
      "SESSION_CANCELLED",
      409,
      "AttendanceCommandConflict",
    );
    assert.equal(
      (await a.get(uuid(504))).roster[0].attendance.status,
      "unmarked",
    );
  }
});

test("guest replay/normalization and duplicate names create one persistent guest, with no contact fallback", async () => {
  const a = adapter();
  const guest = input("createSessionGuest", {
    base_version: 1,
    display_name: "Синтетический спортсмен А",
    trial: true,
  });
  a.failNext("lost-response");
  await rejects(a.execute(guest), "SERVICE_UNAVAILABLE", 0);
  const result = await execute(a, {
    ...guest,
    body: { ...guest.body, phone: null },
  });
  assert(result.replayed);
  assert.equal(result.value.entry.participation, "guest");
  assert.equal(result.value.entry.primary_contact, null);
  const journal = await a.get(uuid(501));
  assert.equal(
    journal.roster.filter((e) => e.display_name === "Синтетический спортсмен А")
      .length,
    3,
  );
  assert.equal(
    new Set(journal.roster.map((e) => e.athlete_id)).size,
    journal.roster.length,
  );
  assert.equal(a.history.length, 1);
  assert.equal(journal.session.version, 2);
});

test("manager visit/exclusion keep history, do not grant coach composition rights, and block archived writes", async () => {
  const a = adapter("manager");
  const before = await a.get(uuid(501));
  const visit = input("addKnownRosterAthlete", {
    base_version: 1,
    athlete_id: uuid(421),
    trial: true,
  });
  const added = (await execute(a, visit)).value;
  assert.equal(added.entry.participation, "visit");
  assert.deepEqual(added.session.group, before.session.group);
  const excluded = (
    await execute(
      a,
      input("excludeRosterAthlete", { base_version: 2 }, uuid(401)),
    )
  ).value;
  assert.deepEqual(excluded.entry.attendance, before.roster[0].attendance);
  assert.equal(excluded.entry.primary_contact, null);
  await rejects(
    a.execute(
      input("setAttendance", { base_version: 1, status: "absent" }, uuid(401)),
    ),
    "NOT_FOUND",
    404,
  );
  const repeated = (
    await execute(
      a,
      input("excludeRosterAthlete", { base_version: 3 }, uuid(401)),
    )
  ).value;
  assert.equal(repeated.session.version, 3);
  await rejects(
    adapter().execute(
      input("excludeRosterAthlete", { base_version: 1 }, uuid(401)),
    ),
    "FORBIDDEN",
    403,
  );
  a.archiveAthlete(uuid(402));
  await rejects(
    a.execute(
      input("setAttendance", { base_version: 0, status: "present" }, uuid(402)),
    ),
    "ATHLETE_ARCHIVED",
    409,
    "AttendanceCommandConflict",
  );
  assert.equal((await a.get(uuid(501))).roster[1].primary_contact, null);
});

test("current assignment/access is checked before replay; stale contacts are removed on read", async () => {
  const a = adapter();
  const command = input(
    "setAttendance",
    { base_version: 0, status: "present" },
    uuid(402),
  );
  await execute(a, command);
  a.clearContact(uuid(401));
  assert.equal((await a.get(uuid(501))).roster[0].primary_contact, null);
  a.removeAssignment(uuid(501));
  await rejects(a.execute(command), "NOT_FOUND", 404);
  await rejects(a.get(uuid(501)), "NOT_FOUND", 404);
  const b = adapter("manager");
  await execute(b, command);
  b.revoke();
  await rejects(b.execute(command), "FORBIDDEN", 403);
});

test("closing a fully marked roster returns the accepted zero-warning branch", async () => {
  const a = adapter();
  for (const entry of (await a.get(uuid(501))).roster.filter(
    (e) => !e.excluded,
  ))
    await execute(
      a,
      input(
        "setAttendance",
        { base_version: entry.attendance.version, status: "present" },
        entry.athlete_id,
      ),
    );
  const result = await execute(a, input("closeSession", { base_version: 1 }));
  assert.equal(result.value.unmarked_count, 0);
  assert.equal(result.value.warning, null);
});

test("bad status and extra sensitive fields are rejected by the unchanged accepted schemas", () => {
  const check = ajv.compile({
    $ref: "#/components/schemas/SetAttendanceRequest",
    components: spec.components,
  });
  assert(
    !check({ operation_id: uuid(9999), base_version: 0, status: "other" }),
  );
  assert(
    !check({
      operation_id: uuid(9999),
      base_version: 0,
      status: "present",
      diagnosis: "synthetic",
    }),
  );
  assert(
    !check({
      operation_id: uuid(9999),
      base_version: 0,
      status: "present",
      reason: null,
    }),
  );
});

const moved = {
  starts_at: "2026-10-11T12:30:00Z",
  ends_at: "2026-10-11T13:30:00Z",
};
test("club time round-trips Minsk independent of the browser zone and preserves unchanged seconds", () => {
  const { clubLocalToUTC, localDateTimeInClub } = require(
    path.join(moduleRoot, "dist/adapter-tests/club-time.js"),
  );
  assert.equal(localDateTimeInClub(moved.starts_at), "2026-10-11T15:30");
  assert.equal(clubLocalToUTC("2026-10-11T15:30"), "2026-10-11T12:30:00.000Z");
  assert.equal(clubLocalToUTC("2026-02-30T15:30"), null);
  assert.equal(
    clubLocalToUTC("2026-10-11T15:30", "2026-10-11T12:30:47.125Z"),
    "2026-10-11T12:30:47.125Z",
  );
});
test("reschedule moves one stable session to the new club date without changing venue, state, roster or marks", async () => {
  const a = adapter("administrator"),
    before = await a.get(uuid(501));
  const { value } = await execute(
    a,
    input("rescheduleSession", {
      base_version: 1,
      ...moved,
      reason: "Синтетическая настройка",
    }),
  );
  assert.equal(value.session_id, before.session.session_id);
  assert.deepEqual(value.venue, before.session.venue);
  assert.deepEqual(value.group, before.session.group);
  assert.equal(value.state, "in_progress");
  assert.equal(value.version, 2);
  assert.deepEqual((await a.get(uuid(501))).roster, before.roster);
  assert(
    !(await a.list(fixtureDate)).items.some((s) => s.session_id === uuid(501)),
  );
  assert.equal((await a.list("2026-10-11")).items[0].session_id, uuid(501));
  assert.equal((await a.get(uuid(502))).session.version, 1);
  assert.equal(a.history.length, 1);
});
test("manager and coach cannot configure even by calling the synthetic adapter directly", async () => {
  for (const role of ["manager", "coach"]) {
    const a = adapter(role);
    assert.equal(a.canConfigure, false);
    for (const command of [
      input("rescheduleSession", { base_version: 1, ...moved }),
      input("cancelSession", { base_version: 1 }),
      input("setSessionCoaches", { base_version: 1, coach_membership_ids: [] }),
    ])
      await rejects(a.execute(command), "FORBIDDEN", 403, "Error");
    assert.equal(a.history.length, 0);
  }
});
test("lost cancellation retries the exact operation after its own state became cancelled; facts stay intact", async () => {
  const a = adapter("administrator"),
    before = await a.get(uuid(501));
  const command = input("cancelSession", {
    base_version: 1,
    reason: "Синтетическая отмена",
  });
  a.failNext("lost-response");
  await rejects(execute(a, command), "SERVICE_UNAVAILABLE", 0);
  const replay = await execute(a, command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.state, "cancelled");
  assert.equal(replay.value.version, 2);
  assert.deepEqual((await a.get(uuid(501))).roster, before.roster);
  assert.equal(a.history.length, 1);
  await rejects(
    execute(a, input("cancelSession", { base_version: 2 })),
    "SESSION_CANCELLED",
    409,
    "S1CommandConflict",
  );
  await rejects(
    execute(
      a,
      input("setAttendance", { base_version: 0, status: "absent" }, uuid(402)),
    ),
    "SESSION_CANCELLED",
  );
});
test("coaches use existing StaffPage and SessionCoaches, retain history and leave all attendance versions unchanged", async () => {
  const a = adapter("administrator"),
    before = await a.get(uuid(501)),
    old = await a.coaches(uuid(501));
  const { value } = await execute(
    a,
    input("setSessionCoaches", {
      base_version: 1,
      coach_membership_ids: [uuid(802)],
      reason: "Синтетическая замена",
    }),
  );
  assert.equal(value.version, 2);
  assert.deepEqual(
    value.coaches
      .filter((r) => r.valid_until === null)
      .map((r) => r.membership_id),
    [uuid(802)],
  );
  assert(
    value.coaches.find(
      (r) => r.session_coach_id === old.coaches[0].session_coach_id,
    ).valid_until,
  );
  assert.deepEqual(
    value.coaches.find(
      (r) => r.session_coach_id === old.coaches[1].session_coach_id,
    ),
    old.coaches[1],
  );
  assert.deepEqual((await a.get(uuid(501))).roster, before.roster);
  assert.equal(
    (await a.get(uuid(501))).session.starts_at,
    before.session.starts_at,
  );
});
test("closed and cancelled allow only administrator revocation, retain assignment rows and reject re-addition", async () => {
  for (const sessionId of [uuid(503), uuid(504)]) {
    const a = adapter("administrator"),
      before = await a.get(sessionId);
    const added = input(
      "setSessionCoaches",
      { base_version: 1, coach_membership_ids: [uuid(802)] },
      undefined,
      sessionId,
    );
    await rejects(
      execute(a, added),
      "SESSION_ROSTER_LOCKED",
      409,
      "TrainingCommandConflict",
    );
    const revoked = await execute(
      a,
      input(
        "setSessionCoaches",
        { base_version: 1, coach_membership_ids: [] },
        undefined,
        sessionId,
      ),
    );
    assert.equal(
      revoked.value.coaches.filter((r) => r.valid_until === null).length,
      0,
    );
    assert.equal(revoked.value.coaches.length, 2);
    assert.equal((await a.get(sessionId)).session.state, before.session.state);
    assert.deepEqual((await a.get(sessionId)).roster, before.roster);
    await rejects(
      execute(
        a,
        input(
          "setSessionCoaches",
          { base_version: 2, coach_membership_ids: [uuid(801)] },
          undefined,
          sessionId,
        ),
      ),
      "SESSION_ROSTER_LOCKED",
      409,
      "TrainingCommandConflict",
    );
    await rejects(
      execute(
        a,
        input(
          "rescheduleSession",
          { base_version: 2, ...moved },
          undefined,
          sessionId,
        ),
      ),
      before.session.state === "closed"
        ? "SESSION_CLOSED"
        : "SESSION_CANCELLED",
      409,
      "S1CommandConflict",
    );
  }
});
test("new configuration version conflict is terminal; explicit new confirmation uses a fresh operation and version", async () => {
  const a = adapter("administrator"),
    command = input("rescheduleSession", { base_version: 1, ...moved });
  a.failNext("conflict");
  await rejects(
    execute(a, command),
    "SESSION_VERSION_CONFLICT",
    409,
    "S1CommandConflict",
  );
  await rejects(
    execute(a, command),
    "SESSION_VERSION_CONFLICT",
    409,
    "S1CommandConflict",
  );
  assert.equal((await a.get(uuid(501))).session.version, 2);
  assert.equal(a.history.length, 0);
  await rejects(
    execute(a, { ...command, body: { ...command.body, base_version: 2 } }),
    "OPERATION_ID_REUSED",
    409,
    "S1CommandConflict",
  );
  await execute(a, input("rescheduleSession", { base_version: 2, ...moved }));
  assert.equal((await a.get(uuid(501))).session.version, 3);
  assert.equal(a.history.length, 1);
});
test("canonical configuration replay normalizes empty reason, UTC instants and coach set ordering; no-ops add no history", async () => {
  const a = adapter("administrator"),
    before = await a.get(uuid(501));
  const time = input("rescheduleSession", {
    base_version: 1,
    starts_at: before.session.starts_at,
    ends_at: before.session.ends_at,
  });
  assert.equal((await execute(a, time)).value.version, 1);
  assert(
    (
      await execute(a, {
        ...time,
        body: {
          ...time.body,
          starts_at: "2026-10-10T12:00:00.000Z",
          ends_at: "2026-10-10T13:00:00.000Z",
          reason: "",
        },
      })
    ).replayed,
  );
  assert.equal(a.history.length, 0);
  const coaches = input("setSessionCoaches", {
    base_version: 1,
    coach_membership_ids: [uuid(802), uuid(801)],
  });
  const first = await execute(a, coaches);
  assert.deepEqual(
    await execute(a, {
      ...coaches,
      body: {
        ...coaches.body,
        coach_membership_ids: [uuid(801), uuid(802)],
        reason: "",
      },
    }),
    { value: first.value, replayed: true },
  );
  assert.equal(a.history.length, 1);
  assert.equal(
    (
      await execute(
        a,
        input("setSessionCoaches", {
          base_version: 2,
          coach_membership_ids: [uuid(801), uuid(802)],
          reason: "Только пояснение",
        }),
      )
    ).value.version,
    2,
  );
  assert.equal(a.history.length, 1);
});
test("old successful time and coach results can replay after closure but never downgrade fresh state; revoked actor cannot replay", async () => {
  for (const command of [
    input("rescheduleSession", { base_version: 1, ...moved }),
    input("setSessionCoaches", {
      base_version: 1,
      coach_membership_ids: [uuid(801), uuid(802)],
    }),
  ]) {
    const a = adapter("administrator");
    const original = await execute(a, command);
    await execute(a, input("closeSession", { base_version: 2 }));
    assert.deepEqual(await execute(a, command), {
      value: original.value,
      replayed: true,
    });
    assert.equal((await a.get(uuid(501))).session.state, "closed");
    assert.equal((await a.get(uuid(501))).session.version, 3);
    assert.equal(a.history.length, 2);
    a.revoke();
    await rejects(execute(a, command), "FORBIDDEN", 403, "Error");
  }
});
test("inactive/non-coach/foreign membership and strict time bodies are rejected without touching facts", async () => {
  const a = adapter("administrator"),
    before = await a.get(uuid(501));
  for (const member of [uuid(803), uuid(804)])
    await rejects(
      execute(
        a,
        input("setSessionCoaches", {
          base_version: 1,
          coach_membership_ids: [member],
        }),
      ),
      "COACH_INACTIVE",
      409,
      "TrainingCommandConflict",
    );
  await rejects(
    execute(
      a,
      input("setSessionCoaches", {
        base_version: 1,
        coach_membership_ids: [uuid(999)],
      }),
    ),
    "NOT_FOUND",
    404,
    "Error",
  );
  for (const patch of [
    { starts_at: "2026-10-11T15:30:00+03:00" },
    { ends_at: "2026-10-11T12:29:00Z" },
    { starts_at: "2026-02-30T12:00:00Z" },
    { venue_id: uuid(700) },
    { reason: null },
  ])
    await rejects(
      a.execute(
        input("rescheduleSession", { base_version: 1, ...moved, ...patch }),
      ),
      "INVALID_REQUEST",
      400,
      "Error",
    );
  assert.deepEqual(await a.get(uuid(501)), before);
  assert.equal(a.history.length, 0);
});
test("configuration shares the existing operation namespace without repeating or replacing another command", async () => {
  const a = adapter("administrator"),
    mark = input(
      "setAttendance",
      { base_version: 0, status: "present" },
      uuid(402),
    );
  await execute(a, mark);
  await rejects(
    execute(a, {
      operation: "cancelSession",
      sessionId: uuid(501),
      body: { operation_id: mark.body.operation_id, base_version: 1 },
    }),
    "OPERATION_ID_REUSED",
    409,
    "S1CommandConflict",
  );
  assert.equal((await a.get(uuid(501))).session.state, "in_progress");
  assert.equal(a.history.length, 1);
});
test("coach selection read faults and revoked access disclose no staff or stored results", async () => {
  const a = adapter("administrator");
  a.failNext("503");
  await rejects(a.staff(), "SERVICE_UNAVAILABLE", 503, "Error");
  a.revoke();
  await rejects(a.coaches(uuid(501)), "FORBIDDEN", 403, "Error");
  await rejects(a.staff(), "FORBIDDEN", 403, "Error");
  await rejects(adapter("coach").staff(), "FORBIDDEN", 403, "Error");
});

test("accepted fractional UTC timestamps retain precision in canonical replay and version comparison", async () => {
  const { canonicalUTC, compareUTC } = require(
    path.join(moduleRoot, "dist/adapter-tests/club-time.js"),
  );
  assert.equal(
    canonicalUTC("2026-10-10T12:00:00.0000000010Z"),
    "2026-10-10T12:00:00.000000001Z",
  );
  assert(
    compareUTC("2026-10-10T12:00:00.000000001Z", "2026-10-10T12:00:00Z") > 0,
  );
  const a = adapter("administrator"),
    command = input("rescheduleSession", {
      base_version: 1,
      starts_at: "2026-10-10T12:00:00.000000001Z",
      ends_at: "2026-10-10T13:00:00Z",
    });
  assert.equal((await execute(a, command)).value.version, 2);
  assert(
    (
      await execute(a, {
        ...command,
        body: { ...command.body, starts_at: "2026-10-10T12:00:00.0000000010Z" },
      })
    ).replayed,
  );
  assert.equal(a.history.length, 1);
});
