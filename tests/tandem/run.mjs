// Tandem tests: several StudioGens and DriveGens on this Mac, steps done by you or by the runner,
// every step checked by watching the apps. Design and use: tests/tandem/README.md.
//   node tests/tandem/run.mjs [--auto] [--only pair,mesh,…] [--phone sim|chrome] [--studio electron|chrome] [--port 8822]
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
const bye = () => { for (const k of kids) try { k.kill(); } catch {} for (const s of sims) try { execFileSync('xcrun', ['simctl', 'shutdown', s]); } catch {} };
process.on('exit', bye); process.on('SIGINT', () => process.exit(130));
const hasSim = () => { try { execFileSync('xcrun', ['simctl', 'help'], { stdio: 'ignore' }); return true; } catch { return false; } };
const PHONE = arg('phone', hasSim() ? 'sim' : 'chrome'), STUDIO = arg('studio', fs.existsSync(ELECTRON) ? 'electron' : 'chrome');
const sims = [];

// ---- the server: the app's files, the panel, and the simulator pages' reports (js/linktest.js › Tandem) ----
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary' };
const ui = { step: null, log: [], act: null }, reports = {}, queue = {}, results = {};
const body = q => new Promise(r => { let s = ''; q.on('data', c => s += c); q.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), json = o => r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(o));
  if (u.pathname.endsWith('/tandem/report')) { const d = u.searchParams.get('dev'); reports[d] = { ...(await body(q)), at: Date.now() }; const s = queue[d] || []; queue[d] = []; return json(s); }
  if (u.pathname.endsWith('/tandem/result')) { const b = await body(q); results[b.id] = b; return json({}); }
  if (u.pathname === '/tandem/') return r.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(path.join(ROOT, 'tests/tandem/panel.html')));
  if (u.pathname === '/tandem/state') return json({ step: ui.step, log: ui.log, auto: AUTO, devices: await Promise.all(devs.map(async d => ({ id: d.id, label: d.label, kind: d.kind, s: await d.state().catch(() => null) }))) });
  if (u.pathname === '/tandem/act') { ui.act = (await body(q)).act; return json({}); }
  const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!f.startsWith(ROOT) || f.includes('/tests/tandem/out')) return r.writeHead(403).end();
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => e ? r.writeHead(404).end() : r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(d));
}).listen(PORT, '0.0.0.0');
const BASE = `http://localhost:${PORT}/index.html`;

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
    async start() { const { proc, port, want } = launch(); kids.push(proc); this.ws = await cdpTarget(port, want); await this.until('typeof Tandem !== "undefined" && typeof Mesh !== "undefined" && typeof MeshView !== "undefined"', 60);
      await this.eval(`(()=>{ store.set('onboarded',true); store.set('meshName',${JSON.stringify(label)}); if(typeof Voice!=='undefined') Voice.respond=async()=>{}; const o=Relay.newPairing.bind(Relay); Relay.newPairing=async(...a)=>(Relay._tandemCode=await o(...a)); closeSheet(); ${AUTO ? "openView('mesh');" : ''} return 1 })()`); },
    async eval(js, ms) { const r = await cdp(this.ws, 'Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }, ms); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'error'); return r.result.value; },
    async until(cond, n = 60) { for (let i = 0; i < n; i++) { try { if (await this.eval(`!!(${cond})`, 5000)) return true; } catch {} await sleep(500); } throw new Error(`${label}: not ready`); },
    state() { return this.eval('Tandem.state()', 5000); },
    step(name, a) { return this.eval(`Promise.resolve(Tandem.STEPS[${JSON.stringify(name)}](${JSON.stringify(a)}))`); },
    async clip(text) { execFileSync('pbcopy', { input: text }); return 'the Mac clipboard'; },
    async shot(file) { const r = await cdp(this.ws, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
  };
  return d;
}
let nextPort = 9700;
const studio = (id, label) => cdpDevice(id, label, STUDIO === 'electron' ? 'StudioGen (desktop app)' : 'StudioGen (Chrome, lab mode)', () => {
  const port = nextPort++, dir = path.join(TMP, id);
  if (STUDIO === 'electron') { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; return { port, want: 'index.html', proc: spawn(ELECTRON, ['.', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], { cwd: path.join(ROOT, 'desktop'), env, stdio: 'ignore' }) }; }
  return { port, want: 'index.html', proc: spawn(CHROME, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--no-first-run', '--window-size=1280,800', `--app=${BASE}?linktest=host`], { stdio: 'ignore' }) };
});
const chromePhone = (id, label) => cdpDevice(id, label, 'DriveGen (phone-sized Chrome)', () => {
  const port = nextPort++; return { port, want: 'index.html', proc: spawn(CHROME, [`--user-data-dir=${path.join(TMP, id)}`, `--remote-debugging-port=${port}`, '--no-first-run', '--window-size=430,900', `--app=${BASE}`], { stdio: 'ignore' }) };
});
/** A DriveGen in the iOS Simulator's Safari: watched through its reports, steps from Tandem.STEPS only. */
function simPhone(id, label, n) {
  let seq = 0; const d = { id, label, kind: 'DriveGen (iOS Simulator, Safari)', udid: null,
    async start() {
      const list = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j']).toString()).devices;
      const phones = Object.entries(list).filter(([rt]) => /iOS/.test(rt)).flatMap(([, ds]) => ds).filter(x => /iPhone/.test(x.name));
      if (!phones[n]) throw new Error('No iPhone simulator: install one in Xcode › Settings › Components');
      this.udid = phones[n].udid; sims.push(this.udid);
      try { execFileSync('xcrun', ['simctl', 'boot', this.udid]); } catch {}
      // the window: Simulator.app (Xcode 26 and before) or DeviceHub (Xcode 27)
      const xc = path.resolve(execFileSync('xcode-select', ['-p']).toString().trim(), '..');
      for (const app of ['Developer/Applications/Simulator.app', 'Applications/DeviceHub.app']) if (fs.existsSync(path.join(xc, app))) { try { execFileSync('open', [path.join(xc, app)]); } catch {} break; }
      execFileSync('xcrun', ['simctl', 'bootstatus', this.udid, '-b']);
      execFileSync('xcrun', ['simctl', 'openurl', this.udid, `${BASE}?tandem=${id}`]);
      for (let i = 0; i < 120 && !reports[id]; i++) await sleep(500);
      if (!reports[id]) throw new Error(`${label}: Safari didn't load the page`);
      await this.step('name', label);
    },
    async state() { const r = reports[id]; return r && Date.now() - r.at < 10000 ? r : null; },
    async step(name, a) { const sid = `${id}-${++seq}`; (queue[id] ||= []).push({ id: sid, step: name, arg: a }); for (let i = 0; i < 120; i++) { if (results[sid]) { if (results[sid].err) throw new Error(results[sid].err); return results[sid].out; } await sleep(250); } throw new Error('no answer'); },
    async clip(text) { execFileSync('xcrun', ['simctl', 'pbcopy', this.udid], { input: text }); return 'the iPhone’s clipboard (tap the box, then Paste)'; },
    async shot(file) { execFileSync('xcrun', ['simctl', 'io', this.udid, 'screenshot', '--type=jpeg', file], { stdio: 'ignore' }); },
  };
  return d;
}
const A = studio('a', 'Studio A'), B = studio('b', 'Studio B'), P = PHONE === 'sim' ? simPhone('p', 'Test iPhone', 0) : chromePhone('p', 'Test iPhone');
const devs = [A, B, P];

// ---- the scenarios: each step has what you do (you), what the runner can do instead (auto), and the check ----
const S = {}, st = async d => (await d.state().catch(() => null)) || {};
const SCENARIOS = {
  pair: [
    { title: 'Make a pairing code on Studio A', you: 'On <b>Studio A</b>: Settings › Connections › <b>Pair a phone or iPad (once)</b>. Leave the code on screen.',
      auto: () => A.eval('Relay.newPairing()'), check: async () => (S.code = await A.eval('Relay._tandemCode || ""')) ? true : 'no code yet' },
    { title: 'Pair the phone', you: async () => `On <b>Test iPhone</b>: Settings › Connections › <b>Pair once</b> › <b>No camera? Paste the code</b>. The code is on ${await P.clip(S.code)}. Then <b>Use this code</b>.`,
      auto: () => P.step('pair', S.code), check: async () => { const p = await st(P), a = await st(A); return p.paired?.[0]?.online && a.paired?.some(x => x.online) || 'not linked yet'; }, wait: 120 },
  ],
  mesh: [
    { title: 'Create a mesh on Studio A', you: 'On <b>Studio A</b>: open <b>Mesh</b> (the app list) › <b>Create a mesh</b>, name it “Tandem mesh”.',
      auto: () => A.eval('Mesh.create("Tandem mesh")'), check: async () => (await st(A)).mesh?.owner || 'no mesh yet' },
    { title: 'The phone joins by itself (paired with Studio A)', check: async () => (await st(P)).mesh?.member || 'not a member yet', wait: 90 },
    { title: 'Invite Studio B', you: 'On <b>Studio A</b>: Mesh › <b>Invite</b> › copy the invite. On <b>Studio B</b>: Mesh › <b>Join with an invite</b> › paste it › Join.',
      auto: async () => B.step('join', await A.eval('Mesh.invite()')), check: async () => { const [a, b, p] = await Promise.all([st(A), st(B), st(P)]); return b.mesh?.member && [a, b, p].every(x => x.mesh?.members?.length === 3) || `rosters ${[a, b, p].map(x => x.mesh?.members?.length ?? '–').join('/')}`; }, wait: 120 },
    { title: 'Everyone sees everyone online', check: async () => { const s = await Promise.all(devs.map(st)); return s.every(x => x.mesh?.online?.length >= 2) || `online seen: ${s.map(x => x.mesh?.online?.length ?? '–').join('/')}`; }, wait: 60 },
  ],
  request: [
    { title: 'Studio B offers a script', auto: () => B.eval(`(()=>{ const s=Scripts.add({ name:'Sales summary', beats:[{ id:'a', title:'S', do:[{say:'Sales are up 12 percent.'}], next:{after:0.3} }] }); store.set('linkOffers',[...store.get('linkOffers',[]), s.id]); Mesh.pres(); return 1 })()`), always: true, check: async () => true },
    { title: 'Run it on Studio B from the phone', you: 'On <b>Test iPhone</b>: open <b>Mesh</b> › in Who’s around, under Studio B, tap <b>▶ Sales summary</b>.',
      auto: P.eval ? async () => P.eval(`Mesh.runOn(${JSON.stringify((await st(B)).mesh.me)}, 'Sales summary').then(j => j.said || j)`) : null,
      check: async () => (await st(A)).mesh?.events?.some(e => e.kind === 'request') || (await st(B)).mesh?.events?.some(e => e.kind === 'request') || 'no request seen yet', wait: 120 },
  ],
  show: [
    { title: 'Start a show on Studio B from Studio A', you: 'On <b>Studio A</b>: Mesh › <b>Shows</b> › pick a script, <b>Steps</b>, tick <b>Studio B</b> › <b>Start the show</b>.',
      auto: async () => A.eval(`(()=>{ const s=Scripts.add({ name:'Keynote', beats:[{id:'a',title:'One',say:'one',next:{key:true}},{id:'b',title:'Two',say:'two'}] }); return Mesh.showStart(s.id, [${JSON.stringify((await st(B)).mesh.me)}], 'steps') })()`),
      check: async () => { const s = (await st(B)).mesh?.show; return s && /ready|on/.test(s.state) || 'Studio B not in the show yet'; }, wait: 90 },
  ],
  secret: [
    { title: 'Change the phone’s secret', you: 'On <b>Studio A</b>: Settings › Connections › the phone › <b>Change secret</b>.', before: async () => { S.key = (await st(P)).paired?.[0]?.key; },
      auto: async () => A.eval(`Relay.rekey(Relay.peers()[0].id)`), check: async () => { const p = (await st(P)).paired?.[0]; return p && p.key !== S.key && p.online || 'old secret still in use'; }, wait: 120 },
  ],
  remove: [
    { title: 'Remove Studio B from the mesh', you: 'On <b>Studio A</b>: Mesh › <b>Devices</b> › Studio B › <b>Remove</b>.',
      auto: async () => A.eval(`Mesh.remove(${JSON.stringify((await st(B)).mesh.me)})`), check: async () => { const a = await st(A), bid = (await st(B)).mesh?.me; return a.mesh?.members?.length === 2 && !a.mesh.members.includes(bid) || 'Studio B still in the roster'; }, wait: 90 },
    { title: 'The phone still talks to Studio A, with the new key', check: async () => { const [a, p] = await Promise.all([st(A), st(P)]); return a.mesh?.key === p.mesh?.key && p.mesh?.members?.length === 2 || 'phone not on the new key yet'; }, wait: 90 },
  ],
};

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
console.log(`Tandem run ${RUN}: StudioGens as ${STUDIO}, phone as ${PHONE}, ${AUTO ? 'automatic' : 'tandem (you do the marked steps)'}\nControl panel: http://localhost:${PORT}/tandem/`);
if (!AUTO) try { execFileSync('open', [`http://localhost:${PORT}/tandem/`]); } catch {}
ui.step = { title: 'Starting the devices…', status: 'waiting' };
for (const d of devs) { await d.start(); say(`${d.label} ready: ${d.kind}`); }
const done = [];
for (const [sc, steps] of Object.entries(SCENARIOS)) {
  if (ONLY?.length && !ONLY.includes(sc)) continue;
  for (let i = 0; i < steps.length; i++) { const r = await runStep(sc, steps[i], i + 1); done.push(r); say(`${r.title} (${(r.ms / 1000).toFixed(1)} s)${r.note ? ': ' + r.note : ''}`, r.result === 'passed' ? 'pass' : r.result === 'failed' ? 'fail' : 'skip');
    for (const d of devs) await d.shot(path.join(OUT, `${sc}-${i + 1}-${d.id}.jpg`)).catch(() => {}); }
}
const sum = { run: RUN, mode: AUTO ? 'auto' : 'tandem', studio: STUDIO, phone: PHONE, passed: done.filter(r => r.result === 'passed').length, failed: done.filter(r => r.result === 'failed').length, skipped: done.filter(r => r.result === 'skipped').length, steps: done };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(sum, null, 2));
ui.step = { title: `Finished: ${sum.passed} passed, ${sum.failed} failed, ${sum.skipped} skipped`, status: 'done', you: `Report and screenshots: tests/tandem/out/${RUN}/` };
say(ui.step.title); say(`Report: ${path.join(OUT, 'report.json')}`);
await sleep(AUTO ? 1500 : 4000); process.exit(sum.failed ? 1 : 0);
