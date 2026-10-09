const fs = require('node:fs');
const path = require('node:path');
const spec = JSON.parse(fs.readFileSync('dist/openapi.json'));
spec.paths = Object.fromEntries(Object.entries(spec.paths).map(([route, item]) => [route,
  Object.fromEntries(Object.entries(item).filter(([, operation]) => operation['x-status'] === 'implemented'))
]).filter(([, item]) => Object.keys(item).length));
spec.servers = [{ url: '/' }];
spec.security = [];
const usedTags = new Set(Object.values(spec.paths).flatMap(item => Object.values(item).flatMap(op => op.tags || [])));
spec.tags = spec.tags.filter(tag => usedTags.has(tag.name));
// Follow component references from the runtime paths, keeping future additions
// automatic while avoiding unrelated auth/journal schemas in the live docs.
const components = spec.components;
delete spec.components;
const selected = {};
const seen = new Set();
function references(node) {
  if (!node || typeof node !== 'object') return;
  if (node.$ref?.startsWith('#/components/')) {
    const [, , category, encodedName] = node.$ref.split('/');
    const name = encodedName.replace(/~1/g, '/').replace(/~0/g, '~');
    const key = `${category}/${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      const component = components[category]?.[name];
      if (!component) throw new Error(`Missing runtime component: ${key}`);
      (selected[category] ||= {})[name] = component;
      references(component);
    }
  }
  for (const value of Object.values(node)) references(value);
}
for (const item of Object.values(spec.paths)) for (const op of Object.values(item)) for (const security of op.security || []) for (const name of Object.keys(security)) { (selected.securitySchemes ||= {})[name] = components.securitySchemes[name]; }
references(spec);
spec.components = selected;
fs.writeFileSync('dist/runtime-openapi.json', JSON.stringify(spec, null, 2) + '\n');
fs.mkdirSync('dist/swagger', { recursive: true });
const assets = require('swagger-ui-dist').getAbsoluteFSPath();
for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js']) fs.copyFileSync(path.join(assets, name), path.join('dist/swagger', name));
fs.writeFileSync('dist/swagger/index.html', `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>JudeOS API</title><link rel="stylesheet" href="/docs/assets/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/docs/assets/swagger-ui-bundle.js"></script><script>window.ui=SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',supportedSubmitMethods:[],deepLinking:true});</script></body></html>`);
