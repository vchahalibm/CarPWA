// A static file server for the lab's "internet" (serves the repository at /app on port 8000).
import http from 'http'; import fs from 'fs'; import path from 'path';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.csv': 'text/csv' };
http.createServer((q, s) => { const p = path.join('/app', decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!p.startsWith('/app')) { s.writeHead(403); return s.end(); }
  fs.stat(p, (e, st) => { const f = !e && st.isDirectory() ? path.join(p, 'index.html') : p; fs.readFile(f, (e2, b) => { if (e2) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); s.end(b); }); });
}).listen(8000, () => console.log('web ready'));
