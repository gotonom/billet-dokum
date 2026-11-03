// Serves the casthouse panels (static pages in docs/) on Railway's $PORT.
// Pages are read per request so a fresh `python3 build.py` shows up without a restart.
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, 'docs');
const port = process.env.PORT || 3000;

function page(url) {
  const name = url === '/' ? 'index.html' : url.replace(/^\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+(\.html)?$/.test(name)) return null;
  const file = path.join(DOCS, name.endsWith('.html') ? name : name + '.html');
  try { return fs.readFileSync(file); } catch (e) { return null; }
}

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const body = page(req.url.split('?')[0]);
  if (!body) { res.writeHead(302, { Location: '/' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '0.0.0.0', () => console.log(`Casthouse panels on :${port}`));
