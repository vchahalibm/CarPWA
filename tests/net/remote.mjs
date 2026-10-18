#!/usr/bin/env node
/* Real-internet connection test (docs/connection-tests.html, layer 3), run by .github/workflows/net-nightly.yml on separate
   cloud machines (different networks): one is StudioGen's link side (host), the other a DriveGen (guest). Both build the same
   pairing from a seed (the run id and a secret), so they need no other way to meet than the relays.
     node tests/net/remote.mjs host  <seed> <minutes>         stay online as StudioGen for that long
     node tests/net/remote.mjs guest <seed>                   find the host, try a direct link, time requests, report
     node tests/net/remote.mjs guest-code <SG3 code>          the same against a real StudioGen (e.g. the Mac at home)
   Needs Chrome/Chromium (CHROME=path) and the app served at http://localhost:8811 (python3 -m http.server 8811). */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
const [role, arg, minutes = '8'] = process.argv.slice(2), sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const URL0 = `http://localhost:8811/index.html${role === 'host' ? '?linktest=host' : ''}`;

async function browser() {
  const dir = fs.mkdtempSync('/tmp/sgnet-'), p = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${dir}`, `--remote-debugging-port=${process.env.CDP || 9341}`, URL0], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${process.env.CDP || 9341}/json`)).json(); const t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) return { p, ws: t.webSocketDebuggerUrl }; } catch {} await sleep(500); }
  throw new Error('Chrome didn’t start');
}
const ev = (wsUrl, expr, ms = 600000) => new Promise((res, rej) => { const ws = new WebSocket(wsUrl), t = setTimeout(() => { ws.close(); rej(new Error('timeout')); }, ms);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id !== 1) return; clearTimeout(t); ws.close(); m.result?.exceptionDetails ? rej(new Error(m.result.exceptionDetails.exception?.description || 'error')) : res(m.result.result.value); }; });
// The pairing both sides derive from the seed: a room and a key (as StudioGen's pairing code would carry), the default relay list.
const derived = seed => { const h = k => crypto.createHash('sha256').update(`${k}:${seed}`).digest('base64url'); return { room: h('room').slice(0, 22), key: h('key').slice(0, 43) }; };

const b = await browser();
for (let i = 0; i < 120; i++) { try { if (await ev(b.ws, `typeof Relay !== 'undefined' && typeof Voice !== 'undefined' && typeof LinkTest !== 'undefined'`, 5000)) break; } catch {} await sleep(500); } // the app has loaded
let out;
try {
  if (role === 'host') {
    const { room, key } = derived(arg);
    await ev(b.ws, `(async()=>{ Voice.respond=async()=>{}; store.set('relayPeers',[{ id:'ci', room:${JSON.stringify(room)}, key:${JSON.stringify(key)}, name:'CI guest', paired:new Date().toISOString(), brokers: Relay.list().brokers.map(b=>b.url), rev: Relay.list().rev }]); Relay.restart(); return 1 })()`);
    console.log(`host online for ${minutes} min`); await sleep(+minutes * 60000);
    out = await ev(b.ws, `(async()=>({ role:'host', devices: Relay.peers().map(p=>({ name:p.name, online: !!Relay.online[p.room] })), direct: Direct.connected }))()`);
  } else {
    const pair = role === 'guest-code' ? `Relay.pairWith(${JSON.stringify(arg)})` : (() => { const { room, key } = derived(arg); return `store.set('relayMac',{ room:${JSON.stringify(room)}, key:${JSON.stringify(key)}, brokers: RELAY_DEFAULTS.map(b=>b.url), rev:1, name:'CI host' }); Relay.restart()`; })();
    out = await ev(b.ws, `(async()=>{ Voice.respond=async()=>{}; const w=ms=>new Promise(r=>setTimeout(r,ms)); ${pair};
      const t0=Date.now(); for(let i=0;i<360&&!Relay.online.mac;i++) await w(500); const onlineMs=Relay.online.mac?Date.now()-t0:null;
      for(let i=0;i<40&&Relay.online.mac&&!Direct.connected;i++) await w(500);
      const r = await LinkTest.run(); return { role:'guest', onlineMs, report: r }; })()`);
  }
} catch (e) { out = { error: e.message }; }
b.p.kill();
console.log(JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY && out.report) {
  const r = out.report, p = r.peer;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${role} (${process.env.RUNNER_OS || ''})\n\n${r.verdict.map(v => `- ${v}`).join('\n')}\n\n| | |\n|---|---|\n| online after | ${out.onlineMs ?? 'never'} ms |\n| link | ${p.via} |\n| router type | ${r.network.nat} |\n| relays working | ${r.relays.filter(x => x.ok).length}/${r.relays.length} |\n| ping / 200 rows | ${p.pingMs ?? '-'} / ${p.rows200Ms ?? '-'} ms |\n| direct pair | ${r.direct.local || '-'} ↔ ${r.direct.remote || '-'} |\n\n<details><summary>Relays</summary>\n\n${r.relays.map(x => `- ${x.ok ? '✓' : '✗'} ${x.url} ${x.ok ? `${x.ms} ms` : x.err}`).join('\n')}\n</details>\n\n`);
}
process.exit(role === 'host' || (out.report?.peer?.rows200Ok) ? 0 : 1);
