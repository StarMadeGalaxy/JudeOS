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

test("the fixture projections and all eight consumed operations use the accepted wire", async () => {
  assert.equal(operations.length, 8);
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
