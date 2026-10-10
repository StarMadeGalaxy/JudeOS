// Read-only subset of the accepted #16/#26/#27/#29 wire. Never writes shared OpenAPI.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("../../../../../api/node_modules/js-yaml");
const source = "7219d0d9703de08fb9779ba1c215cf7a60cd16db";
// Feed `git show <source>:api/openapi/openapi.yaml` through stdin, also in restricted sandboxes.
const input = fs.readFileSync(0, "utf8");
const hash = require("node:crypto")
  .createHash("sha256")
  .update(input)
  .digest("hex");
if (hash !== "cc09aaccf0931b4faf29eff7ddc8cff6e9841dd4e86666f650a136346a0d61ac")
  throw new Error(
    "Expected the pinned accepted OpenAPI; do not silently replace the wire.",
  );
const spec = yaml.load(input);
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
const subset = {
  openapi: spec.openapi,
  info: spec.info,
  paths: {},
  components: {},
};
const matched = new Set();
for (const [url, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (ids.has(operation.operationId)) {
      (subset.paths[url] ||= {})[method] = operation;
      matched.add(operation.operationId);
    }
  }
}
if (matched.size !== ids.size)
  throw new Error("An accepted operation is missing.");
const refs = new Set();
function visit(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref && !refs.has(value.$ref)) {
    refs.add(value.$ref);
    const [, , group, name] = value.$ref.split("/");
    (subset.components[group] ||= {})[name] = spec.components[group][name];
    visit(spec.components[group][name]);
  }
  for (const item of Object.values(value)) visit(item);
}
visit(subset.paths);
subset.components.securitySchemes = spec.components.securitySchemes;
fs.writeFileSync(
  path.join(__dirname, "journal.openapi.json"),
  JSON.stringify(subset, null, 2) + "\n",
);
console.log(`Extracted ${ids.size} accepted operations from ${source}.`);
