// Tandem tests: several StudioGens and DriveGens on this Mac, steps done by you or by the runner,
// every step checked by watching the apps. Design and use: tests/tandem/README.md.
//   node tests/tandem/run.mjs [--journey demo|basic] [--auto] [--only act1,act2,…] [--phone sim|chrome] [--studio electron|chrome] [--port 8822] [--hold]
// The journeys (acts of steps) are in journeys.mjs.
// StudioGens: the desktop app from desktop/ (or Chrome in lab mode), each with its own scratch profile, never yours.
// Phones: the iOS Simulator's Safari (Xcode), else a phone-sized Chrome window.
// The control panel (opened in your browser) shows what to do now, each device's state and the results.
import { spawn, execFileSync } from 'child_process';
import http from 'http'; import fs from 'fs'; import path from 'path'; import os from 'os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const AUTO = process.argv.includes('--auto'), PORT = +arg('port', 8822), ONLY = arg('only', '')?.split(',').filter(Boolean);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ELECTRON = path.join(ROOT, 'desktop/node_modules/.bin/electron');
const RUN = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), OUT = path.join(ROOT, 'tests/tandem/out', RUN), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-tandem-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms)), kids = [];
// on the way out: the devices stop, their throwaway profiles go (they were GBs after a few days), the last 5 runs' results stay
const bye = () => {
  for (const k of kids) try { k.kill(); } catch {} for (const s of sims) try { execFileSync('xcrun', ['simctl', 'shutdown', s]); } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  try { const all = fs.readdirSync(path.dirname(OUT)).sort(); for (const d of all.slice(0, -5)) fs.rmSync(path.join(path.dirname(OUT), d), { recursive: true, force: true }); } catch {}
};
process.on('exit', bye); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143)); process.on('SIGHUP', () => process.exit(129));
const hasSim = () => { try { execFileSync('xcrun', ['simctl', 'help'], { stdio: 'ignore' }); return true; } catch { return false; } };
const PHONE = arg('phone', hasSim() ? 'sim' : 'chrome'), STUDIO = arg('studio', fs.existsSync(ELECTRON) ? 'electron' : 'chrome');
const sims = [];

// ---- the server: the app's files, the panel, and the simulator pages' reports (js/linktest.js › Tandem) ----
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary' };
const ui = { step: null, log: [], act: null }, reports = {}, queue = {}, results = {};
const body = q => new Promise(r => { let s = ''; q.on('data', c => s += c); q.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), json = o => r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(o));
  if (u.pathname.endsWith('/tandem/report')) { const d = u.searchParams.get('dev'); reports[d] = { ...(await body(q)), at: Date.now() }; const s = queue[d] || []; queue[d] = []; return json(s); }
  if (u.pathname.endsWith('/tandem/result')) { const b = await body(q); results[b.id] = b; return json({}); }
  if (u.pathname === '/tandem/') return r.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(path.join(ROOT, 'tests/tandem/panel.html')));
  if (u.pathname === '/tandem/state') return json({ step: ui.step, log: ui.log, auto: AUTO, devices: await Promise.all(devs.map(async d => ({ id: d.id, label: d.label, kind: d.kind, s: await d.state().catch(() => null) }))) });
  if (u.pathname === '/tandem/act') { ui.act = (await body(q)).act; return json({}); }
  // by hand while holding: POST /tandem/do {dev, step, arg}: one of the page's fixed steps (Tandem.STEPS), e.g. a command to type
  if (u.pathname === '/tandem/do' && q.method === 'POST') { const b = await body(q), d = devs.find(x => x.id === b.dev); if (!d) return json({ err: 'no such device' }); try { return json({ out: await d.step(String(b.step), b.arg) }); } catch (e) { return json({ err: e.message }); } }
  const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!f.startsWith(ROOT) || f.includes('/tests/tandem/out')) return r.writeHead(403).end();
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => e ? r.writeHead(404).end() : r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(d));
}).listen(PORT, '0.0.0.0');
const BASE = `http://localhost:${PORT}/index.html`;
// The simulator's Safari keeps each address's data (pairings, identity, offline copy) between runs: a new address each run gives a new phone.
const SIM_PORT = 20000 + Math.floor(Math.random() * 10000), SIM_BASE = `http://localhost:${SIM_PORT}/index.html`;
server.listeners('request').forEach(h => http.createServer(h).listen(SIM_PORT, '0.0.0.0'));

// ---- devices ----
async function cdpTarget(port, want) {
  for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const t = l.find(x => x.type === 'page' && x.url.includes(want)); if (t) return t.webSocketDebuggerUrl; } catch {} await sleep(300); }
  throw new Error('no page on port ' + port);
}
function cdp(ws, method, params, ms = 60000) {
  return new Promise((res, rej) => { const s = new WebSocket(ws), t = setTimeout(() => { s.close(); rej(new Error('timeout ' + method)); }, ms);
    s.onerror = () => { clearTimeout(t); rej(new Error('cdp')); };
    s.onopen = () => s.send(JSON.stringify({ id: 1, method, params }));
    s.onmessage = m => { const d = JSON.parse(m.data); if (d.id !== 1) return; clearTimeout(t); s.close(); d.error ? rej(new Error(d.error.message)) : res(d.result); }; });
}
/** A device the runner drives directly (Chrome DevTools protocol): the desktop app or a Chrome window. */
function cdpDevice(id, label, kind, launch) {
  const d = { id, label, kind, ws: null,
    async start() { const { proc, port, want } = launch(await freePort()); kids.push(proc); this.proc = proc; this.ws = await cdpTarget(port, want); await this.until('typeof Tandem !== "undefined" && typeof Mesh !== "undefined" && typeof MeshView !== "undefined"', 60);
      await this.eval(`(()=>{ store.set('onboarded',true); store.set('meshName',${JSON.stringify(label)}); ${AUTO ? "if(typeof Voice!=='undefined') Voice.respond=async(m,then)=>{ VoiceLog.app(String(m)); then?.(); clearTimeout(Voice._tt); Voice._tt=setTimeout(()=>{ const a=document.getElementById('assistant'); if(a) a.hidden=true; },1500); };" : ''} const o=Relay.newPairing.bind(Relay); Relay.newPairing=async(...a)=>(Relay._tandemCode=await o(...a)); closeSheet(); if (LINK_HOST) { const l = Dash.list('stage.side'); if (!l.includes('chat')) Dash.setList('stage.side', ['chat', ...l]); } /* the Assistant, to type commands in */ openView(${AUTO ? "'mesh'" : "'dashboard'"}); return 1 })()`); },
    async eval(js, ms) { const r = await cdp(this.ws, 'Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }, ms); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'error'); return r.result.value; },
    async until(cond, n = 60) { for (let i = 0; i < n; i++) { try { if (await this.eval(`!!(${cond})`, 5000)) return true; } catch {} await sleep(500); } throw new Error(`${label}: not ready`); },
    state() { return this.ws ? this.eval('Tandem.state()', 5000) : Promise.reject(new Error('stopped')); },
    /** Quit (like ⌘Q) and open again with the same profile. */
    async stop() { try { this.proc.kill(); } catch {} this.ws = null; await sleep(1500); },
    async restart() { await this.stop(); await this.start(); },
    step(name, a) { return this.eval(`Promise.resolve(Tandem.STEPS[${JSON.stringify(name)}](${JSON.stringify(a)}))`); },
    async clip(text) { execFileSync('pbcopy', { input: text }); return 'the Mac clipboard'; },
    async shot(file) { const r = await cdp(this.ws, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
  };
  return d;
}
let nextPort = 9700;
// a debugging port nobody is using (a StudioGen left over from a run that was killed would answer on it with old code)
const freePort = async () => { for (;;) { const p = nextPort++; try { await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(500) }); } catch { return p; } } };
const studio = (id, label) => cdpDevice(id, label, STUDIO === 'electron' ? 'StudioGen (desktop app)' : 'StudioGen (Chrome, lab mode)', port => {
  const dir = path.join(TMP, id);
  if (STUDIO === 'electron') { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; return { port, want: 'index.html', proc: spawn(ELECTRON, ['.', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], { cwd: path.join(ROOT, 'desktop'), env, stdio: 'ignore' }) }; }
  return { port, want: 'index.html', proc: spawn(CHROME, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--no-first-run', '--window-size=1280,800', `--app=${BASE}?linktest=host`], { stdio: 'ignore' }) };
});
const chromePhone = (id, label) => cdpDevice(id, label, 'DriveGen (phone-sized Chrome)', port => {
  return { port, want: 'index.html', proc: spawn(CHROME, [`--user-data-dir=${path.join(TMP, id)}`, `--remote-debugging-port=${port}`, '--no-first-run', '--window-size=430,900', `--app=${BASE}`], { stdio: 'ignore' }) };
});
/** A DriveGen in the iOS Simulator's Safari: watched through its reports, steps from Tandem.STEPS only. */
function simPhone(id, label, n) {
  let seq = 0; const d = { id, label, kind: 'DriveGen (iOS Simulator, Safari)', udid: null,
    async start() {
      const list = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j']).toString()).devices;
      const phones = Object.entries(list).filter(([rt]) => /iOS/.test(rt)).flatMap(([, ds]) => ds).filter(x => /iPhone/.test(x.name));
      if (!phones[n]) throw new Error('No iPhone simulator: install one in Xcode › Settings › Components');
      // one you already have running is used as it is and left running afterwards
      const rank = x => (x.state === 'Booted' ? 2 : 0) + (/^iPhone \d+( Pro)?$/.test(x.name) ? 1 : 0); // running first, then a regular iPhone
      phones.sort((x, y) => rank(y) - rank(x));
      this.udid = phones[n].udid; if (phones[n].state !== 'Booted') sims.push(this.udid); this.kind = `DriveGen (Safari on the ${phones[n].name} simulator, ${this.udid})`;
      try { execFileSync('xcrun', ['simctl', 'boot', this.udid]); } catch {}
      // the window: Simulator.app (Xcode 26 and before) or DeviceHub (Xcode 27)
      const xc = path.resolve(execFileSync('xcode-select', ['-p']).toString().trim(), '..');
      for (const app of ['Developer/Applications/Simulator.app', 'Applications/DeviceHub.app']) if (fs.existsSync(path.join(xc, app))) { try { execFileSync('open', [path.join(xc, app)]); } catch {} break; }
      execFileSync('xcrun', ['simctl', 'bootstatus', this.udid, '-b']);
      try { execFileSync('xcrun', ['simctl', 'terminate', this.udid, 'com.apple.mobilesafari']); } catch {} // tabs from earlier runs stop running
      execFileSync('xcrun', ['simctl', 'openurl', this.udid, `${SIM_BASE}?tandem=${id}`]);
      for (let i = 0; i < 120 && !reports[id]; i++) await sleep(500);
      if (!reports[id]) throw new Error(`${label}: Safari didn't load the page`);
      // a copy of the app from an earlier run (Safari's offline cache): open it again, now with the new files
      if (!('saidAt' in reports[id])) { delete reports[id]; await sleep(3000); execFileSync('xcrun', ['simctl', 'openurl', this.udid, `${SIM_BASE}?tandem=${id}&fresh=${Date.now()}`]); for (let i = 0; i < 120 && !reports[id]; i++) await sleep(500); if (!reports[id]) throw new Error(`${label}: Safari didn't load the page`); }
      await this.step('name', label); await this.step('tidy');
      // the name must stick before the phone joins anything (it once didn't on a fresh simulator page): check, set again
      for (let i = 0; i < 10 && (await this.state())?.name !== label; i++) { await sleep(1000); await this.step('name', label); }
    },
    async state() { const r = reports[id]; return r && Date.now() - r.at < 10000 ? r : null; },
    async step(name, a) { const sid = `${id}-${++seq}`; (queue[id] ||= []).push({ id: sid, step: name, arg: a }); for (let i = 0; i < 1200; i++) { if (results[sid]) { if (results[sid].err) throw new Error(results[sid].err); return results[sid].out; } await sleep(250); } throw new Error('no answer'); },
    async clip(text) { execFileSync('xcrun', ['simctl', 'pbcopy', this.udid], { input: text }); return 'the iPhone’s clipboard (tap the box, then Paste)'; },
    async shot(file) { execFileSync('xcrun', ['simctl', 'io', this.udid, 'screenshot', '--type=jpeg', file], { stdio: 'ignore' }); },
  };
  return d;
}
const A = studio('a', 'Studio A'), B = studio('b', 'Studio B'), P = PHONE === 'sim' ? simPhone('p', 'Test iPhone', 0) : chromePhone('p', 'Test iPhone');
const devs = [A, B, P];

// ---- the journey: acts of steps (journeys.mjs) ----
const JOURNEY = arg('journey', 'demo'), { journeys } = await import('./journeys.mjs');
const SCENARIOS = journeys({ A, B, P, devs, AUTO, sleep })[JOURNEY]; if (!SCENARIOS) { console.log(`No journey called ${JOURNEY}`); process.exit(2); }

// ---- running ----
const say = (msg, kind = 'info') => { ui.log.push({ t: Date.now(), msg, kind }); console.log(kind === 'pass' ? `  ✓ ${msg}` : kind === 'fail' ? `  ✗ ${msg}` : kind === 'skip' ? `  – ${msg}` : msg); };
async function runStep(sc, s, n) {
  const doAuto = s.always || (AUTO && s.auto), you = !doAuto && s.you ? (typeof s.you === 'function' ? await s.you() : s.you) : null;
  ui.step = { scenario: sc, n, title: s.title, you, auto: !!doAuto, status: 'waiting', note: '' }; ui.act = null; say(`${sc} ${n}. ${s.title}${you ? `\n    You: ${you.replace(/<[^>]+>/g, '')}` : ''}`);
  const t0 = Date.now(); await s.before?.();
  if (doAuto) try { ui.step.note = 'the runner is doing it'; await s.auto(); } catch (e) { ui.step.note = 'runner: ' + e.message; }
  while (true) {
    if (ui.act === 'skip') return { sc, title: s.title, result: 'skipped', ms: Date.now() - t0 };
    if (ui.act === 'fail') return { sc, title: s.title, result: 'failed', note: 'marked failed by you', ms: Date.now() - t0 };
    let ok; try { ok = await s.check(); } catch (e) { ok = e.message; }
    if (ok === true) return { sc, title: s.title, result: 'passed', ms: Date.now() - t0 };
    ui.step.status = ok; if (!you && Date.now() - t0 > (s.wait || 60) * 1000) return { sc, title: s.title, result: 'failed', note: String(ok), ms: Date.now() - t0 };
    await sleep(1000);
  }
}
console.log(`Tandem run ${RUN}, journey ${JOURNEY}: StudioGens as ${STUDIO}, phone as ${PHONE}, ${AUTO ? 'automatic' : 'tandem (you do the marked steps)'}\nControl panel: http://localhost:${PORT}/tandem/`);
if (!AUTO && !process.argv.includes('--no-open')) try { execFileSync('open', [`http://localhost:${PORT}/tandem/`]); } catch {}
ui.step = { title: 'Starting the devices…', status: 'waiting' };
for (const d of devs) { await d.start(); say(`${d.label} ready: ${d.kind}`); }
const done = [];
for (const [sc, steps] of Object.entries(SCENARIOS)) {
  if (ONLY?.length && !ONLY.includes(sc)) continue;
  for (let i = 0; i < steps.length; i++) { const r = await runStep(sc, steps[i], i + 1); done.push(r); say(`${r.title} (${(r.ms / 1000).toFixed(1)} s)${r.note ? ': ' + r.note : ''}`, r.result === 'passed' ? 'pass' : r.result === 'failed' ? 'fail' : 'skip');
    for (const d of devs) await d.shot(path.join(OUT, `${sc}-${i + 1}-${d.id}.jpg`)).catch(() => {}); }
}
const sum = { run: RUN, journey: JOURNEY, mode: AUTO ? 'auto' : 'tandem', studio: STUDIO, phone: PHONE, passed: done.filter(r => r.result === 'passed').length, failed: done.filter(r => r.result === 'failed').length, skipped: done.filter(r => r.result === 'skipped').length, steps: done };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(sum, null, 2));
ui.step = { title: `Finished: ${sum.passed} passed, ${sum.failed} failed, ${sum.skipped} skipped`, status: 'done', you: `Report and screenshots: tests/tandem/out/${RUN}/` };
say(ui.step.title); say(`Report: ${path.join(OUT, 'report.json')}`);
if (process.argv.includes('--hold')) { say('Holding: the apps stay open to look around (Ctrl-C ends)'); console.log(devs.filter(d => d.ws).map(d => `${d.label}: ${d.ws}`).join('\n')); await new Promise(() => {}); }
await sleep(AUTO ? 1500 : 4000); process.exit(sum.failed ? 1 : 0);
