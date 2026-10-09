// Read-only extraction from the wire explicitly agreed in Issue27 comment6083937359.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const yaml = require("../../../../../api/node_modules/js-yaml");
const source = "880e1f2bcffaa4101d00fa1ccc65734b3f55bd76";
const spec = yaml.load(
  execFileSync("git", ["show", `${source}:api/openapi/openapi.yaml`], {
    maxBuffer: 2e6,
  }).toString(),
);
const ids = new Set([
  "createPerson",
  "listPersons",
  "createAthlete",
  "listAthletes",
  "getAthleteProfile",
  "updateAthlete",
  "verifyGuardianLink",
  "setPrimaryContact",
  "listHouseholds",
  "createHousehold",
  "getPersonProfile",
  "updatePerson",
  "archivePerson",
  "archiveAthlete",
  "revokeGuardianLink",
  "getHouseholdProfile",
  "updateHousehold",
  "addHouseholdMember",
  "endHouseholdMember",
]);
const subset = {
  openapi: spec.openapi,
  info: spec.info,
  paths: {},
  components: {},
};
for (const [url, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (ids.has(operation.operationId))
      (subset.paths[url] ||= {})[method] = operation;
  }
}
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
  path.join(__dirname, "registry.openapi.json"),
  JSON.stringify(subset, null, 2) + "\n",
);
console.log(
  `Extracted ${ids.size} operations from ${source}; no shared contract modified.`,
);
