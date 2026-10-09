const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const root = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'dist/openapi.json')));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'examples/first-online.json')));
const s1 = JSON.parse(fs.readFileSync(path.join(root, 'examples/s1-people-journal.json')));
const proposedOperations = JSON.parse(fs.readFileSync(path.join(root, 'examples/s1-operations.json')));
const registryCases=JSON.parse(fs.readFileSync(path.join(root,'examples/registry-network.json')));
const registry = fs.readFileSync(path.join(root, 'ENDPOINTS.md'), 'utf8');
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
function resolve(node) {
  return node.$ref ? node.$ref.slice(2).split('/').reduce((value, key) => value[key], spec) : node;
}
for (const fixture of [...fixtures.cases, ...s1.cases, ...registryCases.cases]) {
  const validate = ajv.compile({ $ref: `#/components/schemas/${fixture.schema}`, components: spec.components });
  assert.equal(validate(fixture.value), fixture.valid, `${fixture.name}: ${JSON.stringify(validate.errors)}`);
}
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const operations = [];
for (const [route, item] of Object.entries(spec.paths)) {
  for (const method of methods) {
    const operation = item[method];
    if (!operation) continue;
    operations.push(operation.operationId);
    assert(['planned', 'implemented'].includes(operation['x-status']));
    assert([16, 19, 21, 26, 27].includes(operation['x-issue']));
    assert.equal(operation['x-status'], [19, 21, 27].includes(operation['x-issue']) ? 'implemented' : 'planned');
    if (operation['x-status'] === 'implemented') {
      assert([19,21,27].includes(operation['x-issue']));
    }
    if (operation['x-issue'] === 26 || operation['x-s1-issue'] === 26) {
      assert.equal(operation['x-contract-status'], 'accepted');
      assert.equal(operation['x-status'], operation['x-issue']===27?'implemented':'planned');
    }
    assert(registry.includes(`| ${method.toUpperCase()} | \`${route}\` | \`${operation.operationId}\` |`), `Registry misses ${operation.operationId}`);
    if (operation.requestBody) {
      for (const media of Object.values(resolve(operation.requestBody).content)) {
        if (media.example !== undefined) {
          const validate = ajv.compile({ ...media.schema, components: spec.components });
          assert(validate(media.example), `${operation.operationId}/request: ${JSON.stringify(validate.errors)}`);
        }
      }
    }
    for (const [status, reference] of Object.entries(operation.responses)) {
      const response = resolve(reference);
      assert(response.headers['Cache-Control'], `${operation.operationId}/${status}: no-store missing`);
      assert(response.headers['X-Request-ID'], `${operation.operationId}/${status}: request_id missing`);
      if (status === '204') assert.equal(response.content, undefined);
      for (const media of Object.values(response.content || {})) {
        const validate = ajv.compile({ ...media.schema, components: spec.components });
        const values = media.examples ? Object.values(media.examples).map(e => e.value) : [media.example];
        assert(values.length && values.every(v => v !== undefined), `${operation.operationId}/${status}: example missing`);
        for (const value of values) assert(validate(value), `${operation.operationId}/${status}: ${JSON.stringify(validate.errors)}`);
      }
    }
  }
}
assert.equal(operations.length, 53);
for (const addition of proposedOperations.operations) {
  const operation = spec.paths[addition.path]?.[addition.method.toLowerCase()];
  assert.equal(operation?.operationId, addition.operationId);
  assert([26,27].includes(operation['x-issue']));
}
assert.equal(new Set(operations).size, operations.length);
assert.equal((registry.match(/^\| (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \|/gm) || []).length, operations.length);
const journal = fixtures.cases.find(c => c.name === 'journal').value;
assert.equal(journal.roster[0].athlete_id, journal.roster[0].attendance.athlete_id);
assert.equal(journal.session.tenant_id, fixtures.ids.tenant);
const prototype = JSON.parse(fs.readFileSync(path.join(root, '../docs/prototypes/online-journal/fixture.json')));
const journalSchema = ajv.compile({ $ref: '#/components/schemas/SessionJournal', components: spec.components });
assert(journalSchema(prototype), `Accepted #23 prototype: ${JSON.stringify(journalSchema.errors)}`);
for (const entry of prototype.roster) assert.equal(entry.athlete_id, entry.attendance.athlete_id);
const implemented = Object.values(spec.paths).flatMap(item => Object.values(item)).filter(op => op['x-status'] === 'implemented').length;
assert.equal(implemented, 46);
for(const id of ['loginStaff','getAccessSession','inviteStaff','changeStaffAccess','redeemAccessLink'])assert(operations.includes(id));
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'dist/runtime-openapi.json')));
assert.equal(Object.values(runtime.paths).flatMap(item => Object.values(item)).length, implemented);
const runtimeIds = Object.values(runtime.paths).flatMap(item => Object.values(item)).map(op => op.operationId).sort();
const implementedIds = Object.values(spec.paths).flatMap(item => Object.values(item)).filter(op => op['x-status'] === 'implemented').map(op => op.operationId).sort();
assert.deepEqual(runtimeIds, implementedIds);
assert(runtime.components.schemas.PrimaryContact, 'Implemented #27 contact schema is present');
assert(!runtime.paths['/api/v1/tenants/{tenant_id}/sessions'], 'Journal remains planned');
process.stdout.write(`Contract: ${operations.length} operations (${operations.length - implemented} planned, ${implemented} implemented), ${fixtures.cases.length + s1.cases.length + registryCases.cases.length} schema fixtures and every response example passed.\n`);
