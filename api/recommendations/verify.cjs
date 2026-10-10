// Validates the standalone proposal, not the runtime API or PostgreSQL behavior.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const path = require('node:path');
const spec = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, '../dist/recommendations-proposal.json')));
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'examples.json')));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
let checked = 0;
const validate = name => ajv.compile({ ...spec.components.schemas[name], components: spec.components });
for (const [name, value] of Object.entries(fixtures.schemas)) {
  const v = validate(name);
  assert(v(value), `${name}: ${JSON.stringify(v.errors)}`);
  checked++;
}
const ids = [];
for (const [route, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) {
    assert.equal(op['x-status'], 'planned');
    assert.equal(op['x-issue'], 39);
    ids.push(op.operationId);
    const resolve = v => v.$ref ? v.$ref.split('/').slice(1).reduce((p, k) => p[k], spec) : v;
    if (op.requestBody) {
      const media = resolve(op.requestBody).content['application/json'];
      const v = ajv.compile({ ...media.schema, components: spec.components });
      assert(v(media.example), `${op.operationId} request: ${JSON.stringify(v.errors)}`);
      checked++;
    }
    for (const [status, response] of Object.entries(op.responses)) {
      const r = resolve(response);
      assert(r.headers['Cache-Control'], `${op.operationId}/${status}: no-store`);
      assert(r.headers['X-Request-ID'], `${op.operationId}/${status}: request id`);
      for (const media of Object.values(r.content || {})) {
        const v = ajv.compile({ ...media.schema, components: spec.components });
        const examples = media.examples ? Object.values(media.examples).map(e => e.value) : [media.example];
        assert(examples.length && examples.every(e => e !== undefined));
        for (const e of examples) {
          assert(v(e), `${op.operationId}/${status}: ${JSON.stringify(v.errors)}`);
          checked++;
        }
      }
    }
    const parameters = op.parameters.map(resolve);
    for (const match of route.matchAll(/\{([^}]+)\}/g)) {
      assert(parameters.some(p => p.in === 'path' && p.name === match[1] && p.required));
    }
    if (method === 'post') assert(parameters.some(p => p.name === 'X-CSRF-Token' && p.required));
  }
}
assert.equal(ids.length, 7);
assert.equal(new Set(ids).size, ids.length);

// Independent expected-value checks use BigInt to avoid rounding large integers.
// These verify document fixtures; the application calculator is tested in Go.
for (const scenario of fixtures.scenarios) {
  const requested = BigInt(scenario.requested_reduction_kopecks);
  const base = scenario.rates_kopecks.map(BigInt);
  const final = scenario.expected_final_kopecks.map(BigInt);
  const unused = BigInt(scenario.expected_unused_kopecks);
  assert.equal(base.length, final.length);
  assert(final.every((n, i) => n >= 0n && n <= base[i]));
  assert.equal(base.reduce((a, n) => a + n, 0n), final.reduce((a, n) => a + n, 0n) + requested - unused);
  assert.equal(unused, requested > base.reduce((a, n) => a + n, 0n) ? requested - base.reduce((a, n) => a + n, 0n) : 0n);
  let usedBefore = 0n;
  for (let i = 0; i < base.length; i++) {
    const removed = base[i] - final[i];
    assert.equal(removed, requested - usedBefore > base[i] ? base[i] : requested - usedBefore);
    usedBefore += removed;
  }
}
const adjustment = validate('RecommendationAdjustmentCommand');
const good = fixtures.schemas.RecommendationAdjustmentCommand;
for (const change of [{ amount_kopecks: -1 }, { amount_kopecks: 0.5 }, { amount_kopecks: 9007199254740992 }, { amount_kopecks: null }, { base_version: null }, { acknowledge_past: null }, { currency: 'USD' }, { kind: 'refund' }]) {
  assert(!adjustment({ ...good, ...change }), `invalid adjustment accepted: ${JSON.stringify(change)}`);
}
const terms = validate('RecommendationTermsCommand');
const goodTerms = fixtures.schemas.RecommendationTermsCommand;
for (const change of [{ effective_from: '2026-13' }, { effective_from: '2026-1' }, { athlete_ids: [] }, { athlete_ids: [goodTerms.athlete_ids[0], goodTerms.athlete_ids[0]] }, { reason: '' }, { base_version: 0.5 }]) {
  assert(!terms({ ...goodTerms, ...change }));
}
console.log(`Standalone planned #39: 7 operations; ${checked} schema examples; ${fixtures.scenarios.length} exact synthetic money scenarios; invalid DTO checks PASS. No runtime/DB evidence.`);
