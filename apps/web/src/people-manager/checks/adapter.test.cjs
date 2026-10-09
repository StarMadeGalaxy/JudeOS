const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const moduleRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(moduleRoot, "../../../..");
const output = path.join(moduleRoot, "dist/adapter-tests");
execFileSync(path.join(repoRoot, "apps/web/node_modules/.bin/tsc"), [
  "--target",
  "ES2022",
  "--module",
  "commonjs",
  "--strict",
  "--skipLibCheck",
  "--outDir",
  output,
  path.join(moduleRoot, "synthetic-adapter.ts"),
]);
fs.writeFileSync(path.join(output, "package.json"), ' {"type":"commonjs"}');
const { SyntheticAdapter } = require(path.join(output, "synthetic-adapter.js"));
const { uuid, fixtureNow } = require(path.join(output, "fixtures.js"));
const Ajv = require(path.join(repoRoot, "api/node_modules/ajv"));
const ajv = new Ajv({ strict: false, allErrors: true });
require(path.join(repoRoot, "api/node_modules/ajv-formats"))(ajv);
const spec = JSON.parse(
  fs.readFileSync(path.join(moduleRoot, "contract/registry.openapi.json")),
);
const operations = Object.values(spec.paths).flatMap((v) => Object.values(v));
const schemas = new Map();
function validate(name, value) {
  if (!schemas.has(name))
    schemas.set(
      name,
      ajv.compile({
        $ref: `#/components/schemas/${name}`,
        components: spec.components,
      }),
    );
  const validator = schemas.get(name);
  assert(validator(value), `${name}: ${JSON.stringify(validator.errors)}`);
}
let sequence = 9000;
async function command(adapter, operation, target, payload) {
  const input = {
    operation,
    target,
    body: { operation_id: uuid(sequence++), ...payload },
  };
  const op = operations.find((o) => o.operationId === operation);
  validate(
    op.requestBody.content["application/json"].schema.$ref.split("/").pop(),
    input.body,
  );
  const result = await adapter.execute(input);
  const response = op.responses["200"] || op.responses["201"];
  validate(
    response.content["application/json"].schema.$ref.split("/").pop(),
    result.value,
  );
  return result.value;
}
const rejects = (promise, code, status = 409) =>
  assert.rejects(promise, (e) => e.code === code && e.status === status);
test("all 19 operations use the agreed request/response schemas, with independent profiles and periods", async () => {
  const a = new SyntheticAdapter();
  for (const [kind, schema, profile] of [
    ["people", "PersonPage", "PersonProfile"],
    ["athletes", "AthletePage", "AthleteProfile"],
    ["households", "HouseholdPage", "HouseholdProfile"],
  ]) {
    const page = await a.list(kind, { q: "", state: "active", limit: 6 });
    validate(schema, page);
    validate(
      profile,
      await a.get(
        kind,
        page.items[0][
          kind === "people"
            ? "person_id"
            : kind === "athletes"
              ? "athlete_id"
              : "household_id"
        ],
      ),
    );
    assert(!JSON.stringify(page).includes("phone"));
    assert(!JSON.stringify(page).includes("guardian_links"));
  }
  let p = await command(a, "createPerson", "", {
    display_name: "Тестовый новый человек",
    phone: null,
  });
  p = await command(a, "updatePerson", p.person_id, {
    base_version: p.version,
    display_name: "Тестовый обновлённый человек",
    phone: "+375000000028",
  });
  let athlete = await command(a, "createAthlete", "", {
    person_id: p.person_id,
    participation: "guest",
  });
  athlete = await command(a, "updateAthlete", athlete.athlete_id, {
    base_version: athlete.version,
    participation: "regular",
  });
  const g = await command(a, "verifyGuardianLink", athlete.athlete_id, {
    base_version: athlete.version,
    representative_person_id: uuid(307),
    basis_kind: "Синтетическая проверка",
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: null,
  });
  athlete = await a.get("athletes", athlete.athlete_id);
  athlete = await command(a, "setPrimaryContact", athlete.athlete_id, {
    base_version: athlete.version,
    guardian_link_id: g.guardian_link_id,
  });
  assert.equal(athlete.primary_contact.phone, null);
  athlete = await command(
    a,
    "revokeGuardianLink",
    `${athlete.athlete_id}/${g.guardian_link_id}`,
    { base_version: athlete.version },
  );
  assert.equal(athlete.primary_contact, null);
  athlete = await command(a, "archiveAthlete", athlete.athlete_id, {
    base_version: athlete.version,
  });
  assert.equal(athlete.archived, true);
  assert.equal((await a.get("people", p.person_id)).archived, false);
  let household = await command(a, "createHousehold", "", {
    name: "Синтетическая новая семья",
  });
  assert(
    (
      await a.list("households", {
        q: household.name,
        state: "active",
        limit: 6,
      })
    ).items.length === 1,
    "Empty families remain listed: no invented archive state",
  );
  household = await command(a, "updateHousehold", household.household_id, {
    base_version: household.version,
    name: "Синтетическая семья обновлена",
  });
  household = await command(a, "addHouseholdMember", household.household_id, {
    base_version: household.version,
    person_id: p.person_id,
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: null,
  });
  household = await command(
    a,
    "endHouseholdMember",
    `${household.household_id}/${household.members[0].household_member_id}`,
    { base_version: household.version, valid_until: "2026-10-09T12:00:00Z" },
  );
  assert.equal(household.members.length, 1);
  assert(!("grants" in household));
  p = await command(a, "archivePerson", p.person_id, {
    base_version: p.version,
  });
  assert.equal(p.phone, null);
  assert.equal(a.history.length, 13);
});
test("keyset pages preserve equal names and literal search; archive filter and family state follow wire", async () => {
  const a = new SyntheticAdapter();
  let cursor,
    seen = [];
  do {
    const p = await a.list("people", {
      q: "",
      state: "active",
      limit: 3,
      cursor,
    });
    validate("PersonPage", p);
    seen.push(...p.items);
    cursor = p.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 11);
  assert.equal(new Set(seen.map((p) => p.person_id)).size, 11);
  assert.equal(
    (await a.list("people", { q: "АЛЕКСЕЙ", state: "active", limit: 30 })).items
      .length,
    2,
  );
  assert.equal(
    (await a.list("people", { q: "%", state: "all", limit: 30 })).items.length,
    0,
  );
  assert.equal(
    (await a.list("people", { q: "", state: "archived", limit: 30 })).items
      .length,
    1,
  );
  await rejects(
    a.list("households", { q: "", state: "archived", limit: 30 }),
    "INVALID_REQUEST",
    400,
  );
});
test("family membership does not verify a representative; contact expiry and archive have no fallback", async () => {
  const a = new SyntheticAdapter();
  let athlete = await a.get("athletes", uuid(402));
  assert.equal(athlete.guardian_links.length, 0);
  assert.equal(athlete.primary_contact, null);
  await rejects(
    command(a, "setPrimaryContact", uuid(401), {
      base_version: 1,
      guardian_link_id: uuid(702),
    }),
    "GUARDIAN_LINK_INACTIVE",
  );
  athlete = await a.get("athletes", uuid(401));
  assert.equal(athlete.primary_contact.phone, null);
  await command(a, "archivePerson", uuid(307), { base_version: 1 });
  athlete = await a.get("athletes", uuid(401));
  assert.equal(athlete.primary_contact, null);
  assert.equal(athlete.guardian_links[0].status, "revoked");
  assert.equal(athlete.guardian_links.length, 2);
  const b = new SyntheticAdapter();
  const g = await command(b, "verifyGuardianLink", uuid(402), {
    base_version: 1,
    representative_person_id: uuid(308),
    basis_kind: "Тест",
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: "2026-10-10T00:00:00Z",
  });
  await command(b, "setPrimaryContact", uuid(402), {
    base_version: 2,
    guardian_link_id: g.guardian_link_id,
  });
  assert.equal(
    (await b.get("athletes", uuid(402))).primary_contact.phone,
    "+375000000029",
  );
  b.setClock(Date.parse("2026-10-10T00:00:00Z"));
  assert.equal((await b.get("athletes", uuid(402))).primary_contact, null);
});
test("lost response replays one effect; changed payload, stale contact and denied access cannot replay", async () => {
  const a = new SyntheticAdapter();
  const c = {
    operation: "setPrimaryContact",
    target: uuid(401),
    body: {
      operation_id: uuid(9901),
      base_version: 1,
      guardian_link_id: uuid(701),
    },
  };
  a.failNext("lost-response");
  await rejects(a.execute(c), "NETWORK_UNKNOWN", 0);
  assert.equal((await a.execute(c)).replayed, true);
  assert.equal(a.history.length, 1);
  await rejects(
    a.execute({ ...c, body: { ...c.body, guardian_link_id: null } }),
    "OPERATION_ID_REUSED",
  );
  await command(a, "revokeGuardianLink", `${uuid(401)}/${uuid(701)}`, {
    base_version: 2,
  });
  await rejects(a.execute(c), "RESULT_NOT_CURRENT");
  a.setPermission(false);
  await rejects(a.execute(c), "FORBIDDEN", 403);
});
test("conflict refresh requires new operation ID, parent versions apply to links and periods", async () => {
  const a = new SyntheticAdapter();
  const c = {
    operation: "updatePerson",
    target: uuid(301),
    body: {
      operation_id: uuid(9902),
      base_version: 1,
      display_name: "Синтетическое изменение",
    },
  };
  a.failNext("conflict");
  await rejects(a.execute(c), "ENTITY_VERSION_CONFLICT");
  await rejects(
    a.execute({ ...c, body: { ...c.body, base_version: 2 } }),
    "OPERATION_ID_REUSED",
  );
  await command(a, "updatePerson", uuid(301), {
    base_version: 2,
    display_name: "Синтетическое изменение",
  });
  await rejects(
    command(a, "endHouseholdMember", `${uuid(501)}/${uuid(801)}`, {
      base_version: 999,
      valid_until: "2026-10-09T12:00:00Z",
    }),
    "ENTITY_VERSION_CONFLICT",
  );
  await rejects(
    command(a, "endHouseholdMember", `${uuid(501)}/${uuid(999999)}`, {
      base_version: 999,
      valid_until: "2026-10-09T12:00:00Z",
    }),
    "NOT_FOUND",
    404,
  );
});
