// Lab agent inside a peer container: `node agent.mjs start <url>` launches headless Chromium; `node agent.mjs eval '<js>'` runs JS in the app and prints JSON.
import { spawn } from 'child_process';
const [cmd, arg] = process.argv.slice(2), sleep = ms => new Promise(r => setTimeout(r, ms));
if (cmd === 'start') {
  const origin = new URL(arg).origin;
  spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=9222', '--user-data-dir=/tmp/profile', `--unsafely-treat-insecure-origin-as-secure=${origin}`, '--window-size=1000,800', arg], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9222/json')).json(); if (l.some(x => x.type === 'page' && x.url.includes('index.html'))) { console.log('started'); process.exit(0); } } catch {} await sleep(500); }
  console.log('no page'); process.exit(1);
}
if (cmd === 'eval') {
  const l = await (await fetch('http://127.0.0.1:9222/json')).json(), t = l.find(x => x.type === 'page' && x.url.includes('index.html'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: arg, awaitPromise: true, returnByValue: true } }));
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id !== 1) return; const r = m.result; console.log(JSON.stringify(r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || 'error' } : r.result.value)); process.exit(0); };
  setTimeout(() => { console.log(JSON.stringify({ error: 'timeout' })); process.exit(1); }, 170000);
}
