// Independent comparison against the accepted full spec supplied through stdin.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const yaml = require("../../../../../api/node_modules/js-yaml");
const accepted = yaml.load(fs.readFileSync(0, "utf8"));
const snapshot = JSON.parse(
  fs.readFileSync(
    require("node:path").resolve(__dirname, "../contract/journal.openapi.json"),
  ),
);
const ids = new Set([
  "listAssignedSessions",
  "getSessionJournal",
  "setAttendance",
  "closeSession",
  "createSessionGuest",
  "addKnownRosterAthlete",
  "excludeRosterAthlete",
  "listAthletes",
]);
let count = 0;
for (const [url, methods] of Object.entries(snapshot.paths))
  for (const [method, operation] of Object.entries(methods)) {
    assert(ids.delete(operation.operationId));
    assert.deepEqual(operation, accepted.paths[url][method]);
    count += 1;
  }
assert.equal(ids.size, 0);
for (const [group, entries] of Object.entries(snapshot.components))
  for (const [name, schema] of Object.entries(entries))
    assert.deepEqual(schema, accepted.components[group][name]);
console.log(
  `${count} operations and all snapshot components match accepted main7219d0d exactly.`,
);
