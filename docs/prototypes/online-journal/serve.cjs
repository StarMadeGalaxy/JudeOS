const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.woff2':'font/woff2'};
http.createServer((req,res)=>{
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
 if(pathname==='/'){res.writeHead(302,{Location:'/docs/prototypes/online-journal/index.html'}).end();return;}
 const file=path.resolve(root,'.'+pathname);
 const allowed=file.startsWith(__dirname+path.sep)||file===path.join(root,'design-system/tokens.css');
 if(!allowed||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);});
}).listen(4174,'127.0.0.1',()=>console.log('Prototype: http://127.0.0.1:4174'));
