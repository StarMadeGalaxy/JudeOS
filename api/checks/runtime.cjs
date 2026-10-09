const fs = require('node:fs');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const spec = JSON.parse(fs.readFileSync('dist/runtime-openapi.json'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const base = process.env.JUDEOS_BASE_URL || 'http://127.0.0.1:8080';
const cases = [['/healthz',200], ['/readyz',200], ['/openapi.json',200], ['/docs',200], ['/api/v1/access/session',401], ['/healthz/',404], ['/docs/',404], ['/healthz',405,'HEAD'], ['/readyz',405,'OPTIONS']];
(async () => {
  for (const [route, status, method = 'GET'] of cases) {
    const res = await fetch(base + route, { method, redirect:'manual', headers:{'X-Request-ID':'untrusted-input'} });
    assert.equal(res.status, status, route);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-request-id'), /^[a-f0-9]{32}$/);
    if (status === 405) assert.equal(res.headers.get('allow'), 'GET');
    if (method === 'HEAD') continue;
    if (route === '/openapi.json') assert.match(res.headers.get('content-type'), /^application\/json(?:;|$)/);
    if (res.headers.get('content-type').startsWith('application/json')) {
      const body = await res.json();
      if (route === '/openapi.json') assert.deepEqual(body, spec, 'Served runtime OpenAPI differs from the checked artifact');
      const schema = status === 200 ? spec.paths[route].get.responses['200'].content['application/json'].schema : { $ref:'#/components/schemas/Error' };
      const validate = ajv.compile({ ...schema, components:spec.components });
      assert(validate(body), JSON.stringify(validate.errors));
      if (status !== 200) assert.equal(body.request_id, res.headers.get('x-request-id'));
    }
  }
  console.log('Live HTTP: readiness, health, exact runtime spec/docs, access session 401, slash/method policy and response schemas passed.');
})().catch(e => { console.error(e); process.exitCode=1; });
