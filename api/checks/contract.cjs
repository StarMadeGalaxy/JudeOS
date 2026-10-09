const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const root = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'dist/openapi.json')));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'examples/first-online.json')));
const registry = fs.readFileSync(path.join(root, 'ENDPOINTS.md'), 'utf8');
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
function resolve(node) {
  return node.$ref ? node.$ref.slice(2).split('/').reduce((value, key) => value[key], spec) : node;
}
for (const fixture of fixtures.cases) {
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
    assert.equal(operation['x-issue'], operation['x-status'] === 'planned' ? 16 : operation.tags.includes('access') ? 21 : 19);
    assert(registry.includes(`| ${method.toUpperCase()} | \`${route}\` | \`${operation.operationId}\` |`), `Registry misses ${operation.operationId}`);
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
assert.equal(operations.length, 16);
assert.equal(new Set(operations).size, operations.length);
assert.equal((registry.match(/^\| (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \|/gm) || []).length, operations.length);
const journal = fixtures.cases.find(c => c.name === 'journal').value;
assert.equal(journal.roster[0].athlete_id, journal.roster[0].attendance.athlete_id);
assert.equal(journal.session.tenant_id, fixtures.ids.tenant);
const prototype = JSON.parse(fs.readFileSync(path.join(root, '../docs/prototypes/online-journal/fixture.json')));
const validatePrototype = ajv.compile({ $ref: '#/components/schemas/SessionJournal', components: spec.components });
assert(validatePrototype(prototype), `Prototype SessionJournal: ${JSON.stringify(validatePrototype.errors)}`);
for (const entry of prototype.roster) assert.equal(entry.athlete_id, entry.attendance.athlete_id);
process.stdout.write(`Contract: ${operations.length} operations (3 planned, 13 implemented), ${fixtures.cases.length} schema fixtures, every response example and prototype SessionJournal passed.\n`);
