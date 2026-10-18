#!/usr/bin/env node
/* The network lab (docs/connection-tests.html, layer 2): StudioGen's link side and DriveGen, each in headless Chromium in its own
   network namespace behind its own router namespace (home, restricted, strict, UDP blocked, web-only, brokers blocked), with a
   STUN/TURN server and the app's web server on the lab's "internet" (tests/net/ns.sh, all inside one privileged container, so
   no Docker networking gets in the way); the relays are the real public ones. Each scenario pairs the two, waits for them to see
   each other, lets a direct link form (or not), times a 200-row request, and compares the outcome with what it should be.
     node tests/net/lab.mjs [smoke|full] [--keep]      (Docker, e.g. OrbStack; builds the images first)
   Output: tests/net/out/report.json and report.html. */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const run = promisify(execFile), here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const docker = async (...a) => (await run('docker', a, { maxBuffer: 1e7 })).stdout.trim();
const quiet = (...a) => docker(...a).catch(() => '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Scenarios: router profiles of each side, StudioGen's link settings, and what should happen ---------- */
const S = (name, a, b, cfg, expect, more = {}) => ({ name, a, b, cfg: { mode: 'auto', relayData: true, ...cfg }, expect, ...more });
const SMOKE = [
  S('home ↔ home', 'home', 'home', {}, 'direct'),
  S('home ↔ strict', 'home', 'strict', {}, 'direct'),
  S('restricted ↔ restricted', 'restricted', 'restricted', {}, 'direct|relay'),
  S('strict ↔ strict', 'strict', 'strict', {}, 'relay'),
  S('strict ↔ strict + TURN', 'strict', 'strict', { turn: true }, 'turn'),
  S('strict ↔ strict, data over relays off', 'strict', 'strict', { relayData: false }, 'fail'),
  S('UDP blocked ↔ home', 'noudp', 'home', {}, 'relay'),
  S('web-only ↔ home (443 relays only)', 'webonly', 'home', {}, 'relay'),
  S('home ↔ home, direct never', 'home', 'home', { mode: 'off' }, 'relay'),
  S('home ↔ home, same network only', 'home', 'home', { mode: 'local' }, 'relay'),
  S('StudioGen can’t reach EMQX or HiveMQ', 'home', 'home', { mode: 'off' }, 'relay', { blockA: 'broker.emqx.io,broker.hivemq.com' }),
];
const PROFILES = ['home', 'restricted', 'strict', 'noudp', 'webonly'];
const FULL = [...SMOKE, ...PROFILES.flatMap(a => PROFILES.map(b => S(`${a} ↔ ${b} (matrix)`, a, b, {}, expectOf(a, b))))];
function expectOf(a, b) { // with STUN, data over relays on, no TURN
  const udp = p => p !== 'noudp' && p !== 'webonly';
  if (!udp(a) || !udp(b)) return 'relay';
  if (a === 'home' || b === 'home') return 'direct';                  // an easy NAT on one side is enough
  if (a === 'strict' || b === 'strict') return 'relay';                // strict against restricted/strict
  return 'direct|relay';                                                // restricted ↔ restricted: timing decides
}

/* ---------- The lab: one privileged container, network namespaces inside (tests/net/ns.sh) ---------- */
const LAB = 'sglab-netlab', WEB = '172.31.0.1', STUN = '172.31.0.1';
async function images() { await run('/bin/sh', [path.join(here, 'build.sh')], { env: process.env, maxBuffer: 1e7 }); } // builds what's missing (see build.sh)
async function setup() {
  if (!(await quiet('ps', '-q', '-f', `name=^${LAB}$`))) { await quiet('rm', '-f', LAB); await docker('run', '-d', '--init', '--name', LAB, '--privileged', '-v', `${repo}:/app:ro`, '--entrypoint', 'sleep', 'sglab-netlab', 'infinity'); }
  await docker('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'init');
}
const ev = async (ns, js) => { const out = await docker('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'peer', ns, 'eval', js); try { return JSON.parse(out.split('\n').pop()); } catch { return { error: out.slice(0, 200) }; } };

async function scenario(s, i) {
  const A = `pa${i}`, B = `pb${i}`, t0 = Date.now(), res = { ...s };
  try {
    await quiet('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'down', String(i));
    await docker('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'up', String(i), s.a, s.b, s.blockA || '', s.blockB || '');
    await docker('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'peer', A, 'start', `http://${WEB}:8000/index.html?linktest=host`);
    await docker('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'peer', B, 'start', `http://${WEB}:8000/index.html`);
    for (const c of [A, B]) for (let j = 0; j < 120; j++) { if ((await ev(c, `typeof Relay !== 'undefined' && typeof Voice !== 'undefined' && typeof LinkTest !== 'undefined'`)) === true) break; await sleep(500); } // the app has loaded
    const cfg = { mode: s.cfg.mode, relayData: s.cfg.relayData, stun: [`stun:${STUN}:3478`], turn: s.cfg.turn ? { url: `turn:${STUN}:3478`, user: 'lab', pass: 'lab' } : { url: '', user: '', pass: '' } };
    const code = await ev(A, `(async()=>{ Voice.respond=async()=>{}; store.set('relayList', ${JSON.stringify(s.list || null)}); store.set('directCfg', ${JSON.stringify(cfg)}); store.set('relayPeers', []); return Relay.newPairing(); })()`);
    if (typeof code !== 'string') throw new Error(`pairing: ${JSON.stringify(code)}`);
    const r = await ev(B, `(async()=>{ Voice.respond=async()=>{}; const w=ms=>new Promise(r=>setTimeout(r,ms)); Relay.pairWith(${JSON.stringify(code)});
      const t0=Date.now(); for(let i=0;i<120&&!Relay.online.mac;i++) await w(500); const online=!!Relay.online.mac, onlineMs=Date.now()-t0;
      if (online && ${JSON.stringify(s.cfg.mode)} !== 'off') for(let i=0;i<50&&!Direct.connected;i++) await w(500);
      let rows=0, ms=null, err=null; const t=Date.now();
      try { const x = Link.direct() ? await Direct.call('echo',{n:200},30000) : Link.relay() ? await Relay.call('echo',{n:200},30000) : null; if (x) { rows=x.rows.length; ms=Date.now()-t; } else err='no link'; } catch(e) { err=e.message; }
      const st = await LinkTest.directStats(); return { online, onlineMs, direct: Direct.connected, via: Link.via(), rows, ms, err, local: st.local, remote: st.remote, rtt: st.rtt, active: Relay.mac() ? Relay.active(Relay.mac()) : [] }; })()`);
    Object.assign(res, r);
    res.outcome = r.error ? 'error' : !r.online && !r.direct ? 'fail' : r.direct && r.rows === 200 ? (r.local === 'relay' || r.remote === 'relay' ? 'turn' : 'direct') : r.rows === 200 ? 'relay' : 'fail';
  } catch (e) { res.outcome = 'error'; res.error = e.message.split('\n')[0].slice(0, 300); }
  res.pass = s.expect.split('|').includes(res.outcome); res.secs = Math.round((Date.now() - t0) / 1000);
  if (!process.argv.includes('--keep')) await quiet('exec', LAB, 'sh', '/app/tests/net/ns.sh', 'down', String(i));
  console.log(`${res.pass ? 'PASS' : 'FAIL'}  ${s.name.padEnd(42)} expected ${s.expect.padEnd(6)} got ${String(res.outcome).padEnd(6)} ${res.ms != null ? `${res.ms} ms` : ''} ${res.local ? `(${res.local}↔${res.remote})` : ''} ${res.error || res.err || ''}`);
  return res;
}

function html(results) {
  const row = r => `<tr><td>${r.name}</td><td>${r.expect}</td><td class="${r.pass ? 'p' : 'f'}">${r.outcome}</td><td>${r.onlineMs ?? ''}</td><td>${r.ms ?? ''}</td><td>${r.local ? `${r.local} ↔ ${r.remote}${r.rtt != null ? `, ${r.rtt} ms` : ''}` : ''}</td><td>${(r.active || []).map(u => u.replace(/^(\w+\+)?wss:\/\//, '').split(/[:/]/)[0]).join(', ')}</td><td>${r.error || r.err || ''}</td></tr>`;
  return `<!doctype html><meta charset="utf-8"><title>Network Lab Report</title><style>body{font:14px -apple-system,sans-serif;margin:20px;background:#fff;color:#111}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #8884;padding:6px;text-align:left;vertical-align:top}.p{color:#0a7d3e;font-weight:600}.f{color:#c2262e;font-weight:600}</style>
<h1>Network lab: ${results.filter(r => r.pass).length} of ${results.length} as expected</h1><p>${new Date().toISOString()} · routers: home (port-preserving NAT), strict (random ports), noudp, webonly · STUN/TURN in the lab · real public relays</p>
<table><tr><th>Scenario</th><th>Expected</th><th>Outcome</th><th>Online ms</th><th>200 rows ms</th><th>Direct pair</th><th>Relays used</th><th>Note</th></tr>${results.map(row).join('')}</table>`;
}

const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',').map(Number);
const set = (process.argv[2] === 'full' ? FULL : SMOKE).filter((_, i) => !only || only.includes(i)); // --only=0,3 runs some
console.log(`Network lab: ${set.length} scenarios`); await images(); await setup();
const results = [], par = +(process.env.LAB_PAR || 2); let next = 0;
await Promise.all(Array.from({ length: par }, async () => { while (next < set.length) { const i = next++; results[i] = await scenario(set[i], i); } }));
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/report.json'), JSON.stringify(results, null, 2)); fs.writeFileSync(path.join(here, 'out/report.html'), html(results));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} as expected · tests/net/out/report.html`);
process.exit(results.every(r => r.pass) ? 0 : 1);
