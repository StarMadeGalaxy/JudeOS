const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const swagger = require('swagger-ui-dist').getAbsoluteFSPath();
const assets = {
  '/swagger-ui.css': [path.join(swagger, 'swagger-ui.css'), 'text/css'],
  '/swagger-ui-bundle.js': [path.join(swagger, 'swagger-ui-bundle.js'), 'text/javascript'],
  '/openapi.json': [path.join(__dirname, '../dist/openapi.json'), 'application/json'],
};
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>JudeOS contract</title>
<link rel="stylesheet" href="/swagger-ui.css"><body><p>Принятый #16 и каркас #19; S1 #26 — предложение для ревью. Бизнес-операции planned, новые права не приняты.</p>
<div id="swagger-ui"></div><script src="/swagger-ui-bundle.js"></script><script>
window.ui = SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',supportedSubmitMethods:[],deepLinking:true});
</script></body></html>`;
http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
  const asset = assets[req.url];
  if (!asset) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', asset[1]);
  fs.createReadStream(asset[0]).on('error', () => { res.statusCode = 500; res.end('Run npm run bundle first'); }).pipe(res);
}).listen(4173, '127.0.0.1', () => process.stdout.write('Swagger preview: http://127.0.0.1:4173\n'));
