// Optional private JSONL produced by the disposable Go HTTP/PostgreSQL suite.
// Checks actual request/response DTOs against the published runtime contract.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const Ajv=require('ajv');
const formats=require('ajv-formats');
const spec=JSON.parse(fs.readFileSync('dist/runtime-openapi.json'));
const ajv=new Ajv({strict:false,allErrors:true});formats(ajv);
const resolve=r=>r.$ref?r.$ref.slice(2).split('/').reduce((v,k)=>v[k],spec):r;
const routes=Object.entries(spec.paths).sort(([a],[b])=>(a.match(/\{/g)||[]).length-(b.match(/\{/g)||[]).length).map(([path,item])=>({pattern:new RegExp('^'+path.replace(/\{[^}]+\}/g,'[^/]+')+'$'),item}));
const lines=fs.readFileSync(process.env.JUDEOS_TEST_RESPONSE_FILE,'utf8').trim().split('\n');
const covered=new Set();
for(const line of lines){
 const sample=JSON.parse(line);const route=routes.find(r=>r.pattern.test(sample.path.split('?')[0]));
 assert(route,`Undocumented runtime path`);const op=route.item[sample.method.toLowerCase()]||(sample.status===405?Object.values(route.item)[0]:null);assert(op,`Undocumented method`);
 const response=resolve(op.responses[sample.status]||{});assert(response.description,`${op.operationId}: undocumented status ${sample.status}`);
 if(sample.status!==204){const schema=response.content['application/json'].schema;const validate=ajv.compile({...schema,components:spec.components});assert(validate(sample.response),`${op.operationId}/${sample.status}: ${JSON.stringify(validate.errors)}`);}
 if(sample.request&&op.requestBody&&sample.status<400){const schema=resolve(op.requestBody).content['application/json'].schema;const validate=ajv.compile({...schema,components:spec.components});assert(validate(sample.request),`${op.operationId}/request: ${JSON.stringify(validate.errors)}`);}
 assert.equal(sample.headers['Cache-Control'][0],'no-store');assert(sample.headers['X-Request-Id']?.[0]);
 if(response.headers['Operation-Replayed'])assert(['true','false'].includes(sample.headers['Operation-Replayed']?.[0]));
 covered.add(op.operationId);
}
console.log(`PostgreSQL HTTP: ${lines.length} actual responses across ${covered.size} operations match OpenAPI.`);
