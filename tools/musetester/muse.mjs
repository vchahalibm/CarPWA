// MuseTester: drives StudioGen (the installed app or desktop/), its Workers and DriveGen like a person would, through the
// try-it-out tests in tools/musetester/tests/*.json, and writes a report. Design, steps and test format: README.md here.
//   node tools/musetester/muse.mjs [test ids or tags…] [--silent] [--profile scratch|mine] [--app installed|dev]
//        [--restart-mine] [--auto] [--mark] [--list] [--keep] [--config file] [--headful] [--hidden] [--no-open] [--port n]
// Interactive (the default): a control panel window lists the tests and each one's steps (grey to run, blue running,
// green passed, red failed); run them in one go or a step at a time (Next), retry or skip a step, with the apps' windows
// in view. --silent: no panel, StudioGen's window hidden (SG_HIDDEN, 0.18.5+), DriveGen headless; for runs on their own.
// How it drives: the DevTools protocol (a debugging port on 127.0.0.1) for the app's page, its agent browser's pages and
// DriveGen in Chrome; AppleScript (osascript) for what only macOS has. Fixture pages (pages, feeds, JSON a test sets)
// are served here at /muse/fx/<name>.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs'; import path from 'path'; import os from 'os'; import http from 'http'; import readline from 'readline';

const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2), flag = k => argv.includes('--' + k), opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const VALUED = ['profile', 'app', 'config', 'port', 'skip'], want = argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.includes(argv[i - 1].slice(2))));
const PROFILE = opt('profile', 'scratch'), APP = opt('app', fs.existsSync('/Applications/StudioGen.app') ? 'installed' : 'dev'), SILENT = flag('silent'), PANEL = !SILENT && !flag('list');
const AUTO = flag('auto') || SILENT, HIDDEN = SILENT || flag('hidden'), HEADFUL = flag('headful') || (PANEL && !HIDDEN); /* --hidden: the panel, but the apps' windows hidden */
const INSTALLED = '/Applications/StudioGen.app/Contents/MacOS/StudioGen', ELECTRON = path.join(ROOT, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', DEBUG_LOG = path.join(os.homedir(), 'Library/Logs/StudioGen/debug.log');
const RUN = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), OUT = path.join(HERE, 'reports', RUN), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'musetester-'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), started = Date.now(), J = JSON.stringify;
const sh = (c, a) => { try { return execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

/* ---------- config and tests ---------- */
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8')), CFG_FILE = opt('config', path.join(HERE, 'muse.config.json'));
const CONFIG = { ...readJSON(path.join(HERE, 'muse.config.example.json')), ...(fs.existsSync(CFG_FILE) ? readJSON(CFG_FILE) : {}) };
const TESTS = fs.readdirSync(path.join(HERE, 'tests')).filter(f => f.endsWith('.json')).sort().map(f => ({ file: f, ...readJSON(path.join(HERE, 'tests', f)) }));
if (flag('list')) { for (const t of TESTS) console.log(`${t.id.padEnd(30)} ${(t.profile || 'scratch').padEnd(8)} ${(t.tags || []).join(',').padEnd(30)} ${t.title}`); process.exit(0); }
const SKIP = String(opt('skip', '')).split(',').filter(Boolean), chosen = TESTS.filter(t => (!want.length || want.some(w => t.id === w || (t.tags || []).includes(w))) && (t.profile || 'scratch') === PROFILE && !SKIP.some(k => t.id === k || (t.tags || []).includes(k))); /* --skip docker,llm */
if (!chosen.length) { console.log(`No tests for --profile ${PROFILE}${want.length ? ` matching ${want.join(', ')}` : ''}. --list shows them.`); process.exit(1); }

/* ---------- the run log: everything needed to diagnose a run, or to see how the app grows (sent to Claude as it is) ---------- */
const MACHINE = { mac: sh('sysctl', ['-n', 'hw.model']), chip: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), macOS: sh('sw_vers', ['-productVersion']),
  app: sh('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', '/Applications/StudioGen.app/Contents/Info.plist']), desktop: readJSON(path.join(ROOT, 'desktop/package.json')).version, commit: sh('git', ['-C', ROOT, 'log', '-1', '--format=%h %s']).slice(0, 90), node: process.version };
const logStart = fs.existsSync(DEBUG_LOG) ? fs.statSync(DEBUG_LOG).size : 0;
/** The app's state: its watchers, agent-browser windows, storage, errors, and the page's performance (DevTools metrics). */
async function snapshot(a) {
  const s = await a.page.eval(`const ls = Object.keys(localStorage).map(k => [k, (localStorage.getItem(k) || '').length]).sort((x, y) => y[1] - x[1]);
    return { web: store.get('setupDone') || '', app: typeof APP_NAME !== 'undefined' ? APP_NAME : '', ua: navigator.userAgent.match(/(Electron|Chrome)[/][0-9.]+/g)?.join(' ') || '', practice: !!Agent.cfg().practice,
      watchers: Watch.list().map(w => ({ name: w.name, source: w.source || 'page', template: w.template || '', kind: w.detect?.kind || '', every: w.every || '', on: w.on !== false, runOn: w.runOn || 'here',
        lastMs: w.state?.lastMs ?? null, count: w.state?.count ?? null, fails: w.state?.fails || 0, error: w.state?.error || '', paused: w.state?.paused || '', healed: w.state?.healed ? \`\${w.state.healed.from} → \${w.state.healed.to}\`.slice(0, 160) : '', pokeQuiet: w.state?.pokeQuiet || 0, seen: (w.state?.seen || []).length })),
      views: [...AgentWeb.views].map(([k, v]) => { let u = ''; try { u = v.wv.getURL(); } catch {} return { key: k, url: u.split('?')[0].slice(0, 90), loadedMinAgo: v.loadedAt ? Math.round((Date.now() - v.loadedAt) / 60000) : null }; }),
      storageKB: Math.round(ls.reduce((n, x) => n + x[1], 0) * 2 / 1024), storageTop: ls.slice(0, 6).map(([k, n]) => \`\${k} \${Math.round(n * 2 / 1024)} KB\`),
      feed: (store.get('agentFeed', []) || []).length, history: (store.get('agentHistory', []) || []).length, llm: (() => { try { return LLM.cfg?.() || store.get('llmCfg', null); } catch { return null; } })(),
      errors: (window.__museErrors || []).slice(-10), dom: document.getElementsByTagName('*').length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 2 ** 20) : null };`).catch(e => ({ error: e.message }));
  try { await a.page.send('Performance.enable'); const m = Object.fromEntries((await a.page.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    s.perf = { jsHeapMB: Math.round(m.JSHeapUsedSize / 2 ** 20), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, frames: m.Frames, layouts: m.LayoutCount, scriptS: +(m.ScriptDuration || 0).toFixed(1), taskS: +(m.TaskDuration || 0).toFixed(1) }; } catch {}
  return s;
}
function writeLog() {
  const pass = results.filter(r => r.status === 'pass'), fail = results.filter(r => r.status === 'fail'), skip = results.filter(r => r.status === 'skip');
  const debug = fs.existsSync(DEBUG_LOG) ? (() => { const fd = fs.openSync(DEBUG_LOG, 'r'), n = Math.max(0, fs.statSync(DEBUG_LOG).size - logStart), b = Buffer.alloc(Math.min(n, 400000)); fs.readSync(fd, b, 0, b.length, Math.max(logStart, fs.statSync(DEBUG_LOG).size - b.length)); fs.closeSync(fd); return b.toString('utf8').split('\n'); })() : [];
  const crashes = (() => { const d = path.join(os.homedir(), 'Library/Logs/DiagnosticReports'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^(StudioGen|Electron)/.test(f) && fs.statSync(path.join(d, f)).mtimeMs > started) : []; })();
  const kinds = {}; for (const r of results) for (const w of r.snap?.watchers || []) if (w.lastMs != null) (kinds[`${w.source}/${w.kind}`] ||= []).push(w.lastMs);
  const stat = l => { const s = [...l].sort((a, b) => a - b); return `${s.length} checks, median ${Math.round(s[Math.floor(s.length / 2)] / 100) / 10} s, slowest ${Math.round(s.at(-1) / 100) / 10} s`; };
  const L = [];
  L.push(`# MuseTester run log · ${RUN}`, '', 'For Claude: a run of the try-it-out tests on the user\'s Mac. Read the summary, then each failure\'s steps and trace; the app state after each test shows watchers, agent-browser windows, storage and performance; the appendix has the debug log written during the run and any crash reports. The run book at the end says what to look at.', '');
  L.push('## Summary', '', `- Result: **${pass.length} passed, ${fail.length} failed, ${skip.length} skipped or needing the user** (${Math.round((Date.now() - started) / 1000)} s)`, `- Profile: ${PROFILE}${SILENT ? ', silent' : ', interactive'}; app: ${APP === 'dev' ? `desktop/ (${MACHINE.desktop})` : `installed ${MACHINE.app}`}; code: ${MACHINE.commit}`,
    `- Machine: ${MACHINE.mac}, ${MACHINE.chip}, ${MACHINE.cores} cores, ${MACHINE.memoryGB} GB, macOS ${MACHINE.macOS}, Node ${MACHINE.node}`, `- Crash reports during the run: ${crashes.length ? crashes.join(', ') : 'none'}`, '');
  L.push('| Test | Result | Time | Failed at |', '|---|---|---|---|', ...results.map(r => `| ${r.id} | ${r.status} | ${Math.round(r.ms / 1000)} s | ${(r.steps.find(s => !s.ok)?.say || '').replace(/\|/g, '/')} |`), '');
  if (Object.keys(kinds).length) L.push('## How long checks take (for scaling)', '', ...Object.entries(kinds).map(([k, l]) => `- ${k}: ${stat(l)}`), '');
  for (const r of results) {
    L.push(`## ${r.id}: ${r.status.toUpperCase()}`, '', r.title, r.tryitout.length ? `\nTry-it-out items: ${r.tryitout.join('; ')}` : '', '', '| # | Step | OK | Time | Note |', '|---|---|---|---|---|', ...r.steps.map((s, i) => `| ${i + 1} | ${s.say.replace(/\|/g, '/')} | ${s.ok ? '✓' : '✗'} | ${Math.round(s.ms / 100) / 10} s | ${String(s.note).split('\n')[0].replace(/\|/g, '/').slice(0, 160)} |`), '');
    const bad = r.steps.filter(s => !s.ok); if (bad.length) L.push('Failure details:', '', '```', ...bad.map(s => `${s.say}\n${s.note}`), '```', '');
    if (r.snap && !r.snap.error) { const s = r.snap;
      L.push(`App state after the test: web ${s.web}, ${s.ua}, practice ${s.practice}; ${s.watchers.length} watchers, ${s.views.length} agent-browser windows, feed ${s.feed} cards, history ${s.history}; storage ${s.storageKB} KB (${s.storageTop.join(', ')}); page ${s.dom} elements, heap ${s.perf?.jsHeapMB ?? s.heapMB} MB, ${s.perf?.listeners ?? '?'} listeners, script ${s.perf?.scriptS ?? '?'} s, tasks ${s.perf?.taskS ?? '?'} s`, '');
      if (s.watchers.length) L.push('| Watcher | Source/kind | Every | Last check | Read | Fails | Note |', '|---|---|---|---|---|---|---|', ...s.watchers.map(w => `| ${w.name} | ${w.source}/${w.kind} | ${w.every}${w.runOn !== 'here' ? ` on ${w.runOn}` : ''} | ${w.lastMs != null ? `${Math.round(w.lastMs / 100) / 10} s` : '-'} | ${w.count ?? '-'} | ${w.fails} | ${[w.error, w.paused, w.healed && `healed ${w.healed}`, w.pokeQuiet && `quiet pokes ${w.pokeQuiet}`].filter(Boolean).join('; ').replace(/\|/g, '/').slice(0, 140)} |`), '');
      if (s.views.length) L.push('Agent-browser windows: ' + s.views.map(v => `${v.key} → ${v.url || 'blank'}${v.loadedMinAgo != null ? ` (loaded ${v.loadedMinAgo} min ago)` : ''}`).join('; '), '');
      if (s.errors.length) L.push('Errors in the page: ' + s.errors.join(' | '), ''); }
  }
  L.push('## Run book', '', '- A failed watcher step: its trace (in the failure details) names the selector that matched nothing; Diagnose the page (Edit › Diagnose) gives its structure. Sites change: the templates in js/watch.js and js/watchtpl.js get the new selectors and existing watchers heal from them.',
    '- Slow or hung: compare check times above (map watchers read turns once per 12 h; Slack/Outlook should be read in place: windows not reloaded every check, “loaded N min ago” climbing); `quiet pokes` growing means a live page keeps redrawing with nothing new (fine, it backs off).',
    '- Scaling: each site has one agent-browser window; watchers of a site take turns (Agent.slot, cfg().parallel − 1 at once). Heap, elements and listeners after each test show growth; storage near 5 MB starts losing writes (store.set swallows errors). Watchers can move to a Worker (Edit › Run on) to keep a site’s window open all day.',
    '- Crashes: a crash report name above; the .ips in ~/Library/Logs/DiagnosticReports has the stack (llama.cpp frames: the built-in model).', '');
  if (debug.length > 1) L.push('## Appendix: the debug log during the run', '', `(${debug.length} lines${debug.length > 1500 ? ', the last 1500' : ''}; empty unless Settings › System › Debug log is on)`, '', '```', ...debug.slice(-1500), '```');
  fs.writeFileSync(path.join(OUT, 'muse-log.md'), L.join('\n')); fs.writeFileSync(path.join(OUT, 'muse-log.json'), J({ run: RUN, machine: MACHINE, profile: PROFILE, silent: SILENT, results, crashes }, null, 1));
}

/* ---------- the DevTools protocol ---------- */
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && this.wait.has(d.id)) { this.wait.get(d.id)(d); this.wait.delete(d.id); } }; }
  static async open(port, match, ms = 60000) {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(500)) {
      try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(), t = l.find(x => match(x)); if (t) { const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; }); return new Page(ws); } } catch {}
    }
    throw new Error(`no page on port ${port}`);
  }
  send(method, params = {}, ms = 120000) { return new Promise((ok, no) => { const id = ++this.id, t = setTimeout(() => { this.wait.delete(id); no(new Error(`${method} took over ${ms / 1000} s`)); }, ms); this.wait.set(id, d => { clearTimeout(t); d.error ? no(new Error(d.error.message)) : ok(d.result); }); this.ws.send(J({ id, method, params })); }); }
  async eval(js, ms) { const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${/\breturn\b/.test(js) ? js : `return (${js});`} })()`, awaitPromise: true, returnByValue: true }, ms); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text); return r.result?.value; }
  async raw(js, ms) { const r = await this.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }, ms); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text); return r.result?.value; } /* an expression as it is (the tandem journeys') */
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, 15000); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; }
  close() { try { this.ws.close(); } catch {} }
}

/* ---------- the server: the panel, the web files (DriveGen), fixtures ---------- */
const fx = {}, ctl = { mode: 'all', next: null, stop: false, paused: false, queue: [], human: null, quit: false };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.vrm': 'application/octet-stream' };
const body = q => new Promise(r => { let s = ''; q.on('data', c => s += c); q.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), json = o => r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(J(o));
  if (u.pathname === '/muse/' || u.pathname === '/muse') return r.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(path.join(HERE, 'panel.html')));
  if (u.pathname === '/muse/state') return json({ run: RUN, profile: PROFILE, app: APP, mode: ctl.mode, paused: ctl.paused, human: ctl.human, failedAt: ctl.failedAt || null, current: cur?.id || null, waiting: ctl.waiting || null, tests: board });
  if (u.pathname === '/muse/cmd') { const c = await body(q); command(c); return json({ ok: true }); }
  if (u.pathname.startsWith('/muse/shot/')) { const f = path.join(OUT, path.basename(u.pathname)); return fs.existsSync(f) ? r.writeHead(200, { 'content-type': 'image/jpeg' }).end(fs.readFileSync(f)) : r.writeHead(404).end(); }
  if (u.pathname.startsWith('/muse/fx/')) { /* a fixture: what the test set (a page, a feed, JSON) */
    const f = fx[decodeURIComponent(u.pathname.slice(9))]; if (!f) return r.writeHead(404).end('no such fixture');
    return r.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store' }).end(f.body); }
  const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.writeHead(404).end();
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
});
await new Promise(r => server.listen(+opt('port', 0), '127.0.0.1', r)); const PORT = server.address().port, BASE = `http://127.0.0.1:${PORT}`;

/* ---------- the apps ---------- */
const apps = {}, kids = []; let mineWasRunning = false;
const running = () => { try { return execFileSync('pgrep', ['-fl', 'StudioGen.app/Contents/MacOS/StudioGen'], { encoding: 'utf8' }).split('\n').filter(l => l && !/remote-debugging-port/.test(l)).length > 0; } catch { return false; } };
async function launch(s) {
  const as = s.as || 'studio', port = s.port || 9333 + Object.keys(apps).length, profile = s.profile || PROFILE;
  if (profile === 'mine' && PROFILE !== 'mine') throw new Error('this test needs --profile mine');
  if (profile === 'mine' && running()) {
    if (!flag('restart-mine')) throw new Error('StudioGen is open with your profile: quit it first, or run with --restart-mine (it’s opened again afterwards)');
    mineWasRunning = true; execFileSync('osascript', ['-e', 'tell application "StudioGen" to quit']); for (let i = 0; i < 40 && running(); i++) await sleep(500);
  }
  const dir = profile === 'mine' ? null : path.join(TMP, cur?.id || 'run', as), /* a profile per test (kept across a restart within it) */ bin = (s.app || APP) === 'dev' ? ELECTRON : INSTALLED;
  if (dir && s.folders) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'watch-paths.json'), J(s.folders.map(p => path.resolve(String(p).replace(/^~/, os.homedir()))))); } /* folders a file watcher may read (as if picked in the dialog) */
  const args = [...((s.app || APP) === 'dev' ? [path.join(ROOT, 'desktop')] : []), ...(dir ? [`--user-data-dir=${dir}`] : []), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'];
  const env = { ...process.env, ...(HIDDEN ? { SG_HIDDEN: '1' } : {}), ...(s.env || {}) }; delete env.ELECTRON_RUN_AS_NODE;
  const k = spawn(bin, args, { env, stdio: 'ignore' }); kids.push(k);
  const page = await Page.open(port, t => t.type === 'page' && /index\.html/.test(t.url));
  await ready(page);
  apps[as] = { page, port, kind: 'studio', proc: k, profile, practiceWas: await page.eval(`(store.get('agentCfg') || {}).practice ?? false`) };
  if (s.practice != null) await page.eval(`store.set('agentCfg', { ...(store.get('agentCfg') || {}), practice: ${!!s.practice} }); return true`);
  return `${as} on port ${port} (${profile} profile, ${bin === INSTALLED ? 'installed app' : 'desktop/'}${HIDDEN ? ', hidden' : ''})`;
}
/** The app's page is up and settled (a first start reloads itself once: the steps wait through that); its errors are kept. */
async function ready(page) {
  for (let k = 0; k < 6; k++) try {
    await page.eval(`for (let i = 0; i < 120 && !(document.readyState === 'complete' && typeof Watch !== 'undefined' && typeof Agent !== 'undefined'); i++) await new Promise(r => setTimeout(r, 250)); try { Setup.close?.(false); } catch {} document.getElementById('setup')?.remove();
      if (!window.__museErrors) { window.__museErrors = []; addEventListener('error', e => __museErrors.push(String(e.message || e.error).slice(0, 300))); addEventListener('unhandledrejection', e => __museErrors.push(String(e.reason?.message || e.reason).slice(0, 300))); } return true`, 60000);
    await sleep(1500); await page.eval('1'); return;
  } catch (e) { if (!/context was destroyed|Cannot find context|Inspected target navigated/i.test(e.message) || k === 5) throw e; await sleep(1500); }
}
const DEVICES = { iphone: [390, 844, 3, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'], ipad: [1180, 820, 2, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'], 'ipad-portrait': [820, 1180, 2, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'] };
async function drivegen(s) {
  const as = s.as || 'phone', port = s.port || 9433 + Object.keys(apps).length, [w, h, dpr, ua] = DEVICES[s.device || 'iphone'];
  const k = spawn(CHROME, [...(HEADFUL ? [`--app=data:text/html,DriveGen`] : ['--headless=new']), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(TMP, cur?.id || 'run', as)}`, `--window-size=${w},${h + 80}`, '--no-first-run'], { stdio: 'ignore' }); kids.push(k);
  const page = await Page.open(port, t => t.type === 'page');
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Network.setUserAgentOverride', { userAgent: ua });
  const url = !s.url || s.url === 'local' ? `${BASE}/index.html` : s.url;
  await page.send('Page.navigate', { url }); await sleep(2500);
  await page.eval(`localStorage.clear(); ${s.settings ? `localStorage.setItem('dd.settings', ${J(J(s.settings))});` : ''} localStorage.setItem('dd.setupDone', '"skip"'); return true`).catch(() => {});
  await page.send('Page.navigate', { url }); await sleep(4000);
  await page.eval(`for (let i = 0; i < 80 && typeof openView === 'undefined'; i++) await new Promise(r => setTimeout(r, 250)); document.getElementById('setup')?.remove(); [...document.querySelectorAll('#sheet button')].find(b => /not now/i.test(b.textContent))?.click();
    if (!window.__museErrors) { window.__museErrors = []; addEventListener('error', e => __museErrors.push(String(e.message).slice(0, 300))); } return true`);
  apps[as] = { page, port, kind: 'phone', proc: k }; return `${as}: DriveGen as ${s.device || 'iphone'} (${url})`;
}
async function quitApp(as = 'studio') {
  const a = apps[as]; if (!a) return 'not open'; delete apps[as];
  if (a.kind === 'studio' && a.profile === 'mine') try { await a.page.eval(`store.set('agentCfg', { ...(store.get('agentCfg') || {}), practice: ${a.practiceWas} }); return true`); } catch {}
  /* quit as you would (what it stored is saved first): the DevTools Browser.close, then a signal if it's still there */
  try { const v = await (await fetch(`http://127.0.0.1:${a.port}/json/version`)).json(), ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; }); ws.send(J({ id: 1, method: 'Browser.close' })); } catch {}
  for (let i = 0; i < 40 && a.proc.exitCode == null; i++) await sleep(250);
  try { a.page.close(); } catch {} if (a.proc.exitCode == null) { try { a.proc.kill('SIGTERM'); } catch {} for (let i = 0; i < 20 && a.proc.exitCode == null; i++) await sleep(250); }
  return `${as} quit`;
}
const web = (a, host) => Page.open(a.port, t => t.type === 'webview' && t.url.includes(host), 15000); /* a page in the app's agent browser */

/* ---------- steps ---------- */
const vars = { ...CONFIG.vars, fx: new Proxy({}, { get: (o, k) => `${BASE}/muse/fx/${String(k)}` }), base: BASE, tmp: TMP };
const get = k => k.split('.').reduce((o, p) => o?.[p], vars);
const fill = v => typeof v === 'string' && /^\$\{[\w.]+\}$/.test(v) ? (get(v.slice(2, -1)) ?? v) /* the whole value: kept as it is (an object) */
  : typeof v === 'string' ? v.replace(/\$\{([\w.]+)\}/g, (m, k) => { const x = get(k); return x == null ? m : typeof x === 'object' ? J(x) : String(x); })
  : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
const ask = q => new Promise(r => { const i = readline.createInterface({ input: process.stdin, output: process.stdout }); i.question(q, a => { i.close(); r(a); }); });
const pageOf = s => { const a = apps[s.on || 'studio']; if (!a) throw new Error(`${s.on || 'studio'} isn't open (launch it first)`); return a; };
const check = (v, s) => { const txt = typeof v === 'string' ? v : J(v);
  if ('equals' in s && J(v) !== J(s.equals)) return `${String(txt).slice(0, 160)} isn't ${J(s.equals)}`;
  if ('contains' in s && !String(txt).toLowerCase().includes(String(s.contains).toLowerCase())) return `“${String(txt).slice(0, 200)}” doesn't contain “${s.contains}”`;
  if ('lacks' in s && String(txt).toLowerCase().includes(String(s.lacks).toLowerCase())) return `“${String(txt).slice(0, 200)}” contains “${s.lacks}”`;
  if ('match' in s && !new RegExp(s.match, 'i').test(txt)) return `“${String(txt).slice(0, 200)}” doesn't match /${s.match}/`;
  if ('gte' in s && !(+v >= +s.gte)) return `${v} < ${s.gte}`; if ('lte' in s && !(+v <= +s.lte)) return `${v} > ${s.lte}`;
  if (!['equals', 'contains', 'lacks', 'match', 'gte', 'lte'].some(k => k in s) && !v) return `${txt} isn't true`; return ''; };
const W = name => `(Watch.list().find(x => x.name === ${J(name)} || x.id === ${J(name)}) || (() => { throw new Error('no watcher ' + ${J(name)}); })())`;
const STEPS = {
  launch: s => launch(s), quit: s => quitApp(s.as || s.on), drivegen: s => drivegen(s),
  wait: async s => { await sleep((+s.s || 1) * 1000); return `${s.s || 1} s`; },
  eval: async s => { const v = await pageOf(s).page.eval(s.js, (s.timeout || 120) * 1000); if (s.as) vars[s.as] = v; return J(v)?.slice(0, 200); },
  until: async s => { const t0 = Date.now(); for (;;) { const v = await pageOf(s).page.eval(s.js).catch(() => null); if (!check(v, s)) { if (s.as) vars[s.as] = v; return `after ${Math.round((Date.now() - t0) / 1000)} s`; } if (Date.now() - t0 > (s.timeout || 60) * 1000) throw new Error(`still not after ${s.timeout || 60} s: ${J(v)?.slice(0, 160)}`); await sleep((s.every || 1) * 1000); } },
  expect: async s => { /* var (a step's result), js (in the page), sel (shown on screen) or text (anywhere on screen) */
    let v, rule = s;
    if ('var' in s) v = get(s.var); else if ('js' in s) v = await pageOf(s).page.eval(s.js);
    else if ('sel' in s) v = await pageOf(s).page.eval(`const e = document.querySelector(${J(s.sel)}); return !!e && !!e.getClientRects().length`);
    else if ('text' in s) { v = await pageOf(s).page.eval('document.body.innerText'); rule = { contains: s.text }; }
    const e = check(v, rule); if (e) throw new Error(e); return 'ok'; },
  'errors.none': async s => { const l = await pageOf(s).page.eval('window.__museErrors || []'); const bad = l.filter(e => !(s.ignore || []).some(i => e.includes(i))); if (bad.length) throw new Error(`errors in the page: ${bad.slice(0, 3).join(' | ')}`); return 'no errors'; },
  view: s => pageOf(s).page.eval(`openView(${J(s.name)}); return ${J(s.name)}`),
  say: s => pageOf(s).page.eval(`handleCommand(${J(s.text)}); await new Promise(r => setTimeout(r, ${(s.wait || 1.5) * 1000})); return 'said'`),
  click: s => pageOf(s).page.eval(`const want = ${J(s.text || '')}.toLowerCase(), sel = ${J(s.sel || (s.sheet ? '#sheet button' : 'button,[role="button"],a,.app-tile,.chip,.big-btn,.link-btn,[data-wt],[data-ag]'))};
    const l = [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length), el = want ? l.find(e => e.textContent.trim().toLowerCase() === want) || l.find(e => (e.textContent + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase().includes(want)) : l[0];
    if (!el) throw new Error('nothing to click: ' + (want || sel)); el.scrollIntoView({ block: 'center' }); if (typeof Peek !== 'undefined') Peek.tapAt = Date.now(); el.click(); await new Promise(r => setTimeout(r, 500)); return (el.textContent || el.getAttribute('aria-label') || sel).trim().slice(0, 60)`),
  type: s => pageOf(s).page.eval(`const el = document.querySelector(${J(s.sel)}); if (!el) throw new Error('no field ' + ${J(s.sel)}); el.focus(); el.value = ${J(s.text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); ${s.enter ? `el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));` : ''} return 'typed'`),
  key: async s => { const p = pageOf(s).page; for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: s.key, code: s.code || s.key }); return s.key; },
  practice: s => pageOf(s).page.eval(`store.set('agentCfg', { ...(store.get('agentCfg') || {}), practice: ${s.value !== false} }); return Agent.cfg().practice`),
  /* the practice sites have a pretend sign-in: signed in for a throwaway profile, in the agent browser's own storage */
  'practice.signin': async s => { const a = pageOf(s); await a.page.eval(`await AgentWeb.go(Agent.sites().slack, undefined, { quiet: true }); return true`);
    const p = await web(a, 'labs/practice/'); try { await p.eval(`for (const k of ['practiceSlack', 'practiceWa', 'practiceTeams', 'practiceX', 'practiceInbox']) localStorage.setItem(k + 'Auth', '1'); setTimeout(() => location.replace(location.pathname), 50); return true`); } finally { p.close(); }
    await sleep(2500); return 'signed in to the practice Slack, WhatsApp, Teams, X'; },
  'practice.incoming': s => pageOf(s).page.eval(`const site = ${J(s.site)}, base = site === 'shop' ? new URL('labs/practice/shop.html', location.href).href : Agent.sites()[site]; await AgentWeb.go(base + (/\\?/.test(base) ? '&' : '?') + ${J(s.query || '')}.replace(/^\\?/, '') + (${J(s.text || '')} ? '&incoming=' + encodeURIComponent(${J(s.text || '')}) : ''), undefined, { quiet: true }); await new Promise(r => setTimeout(r, 1200)); return 'sent'`),
  /* fixtures: what a page, a feed or a JSON answer says now (served at ${fx.<name>}) */
  fixture: async s => { const items = s.items || [];
    fx[s.name] = s.rss ? { type: 'application/rss+xml', body: `<?xml version="1.0"?><rss version="2.0"><channel><title>${s.title || s.name}</title><link>${BASE}/muse/fx/${s.name}</link>${items.map((it, k) => `<item><title>${it.title}</title><link>${it.link || `${BASE}/muse/fx/${s.name}#${k}`}</link><guid>${it.guid || it.title}</guid><pubDate>${new Date(Date.now() - k * 60000).toUTCString()}</pubDate><description>${it.text || ''}</description></item>`).join('')}</channel></rss>` }
      : s.json !== undefined ? { type: 'application/json', body: J(s.json) }
      : { type: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><title>${s.title || s.name}</title>${s.feed ? `<link rel="alternate" type="application/rss+xml" href="${BASE}/muse/fx/${s.feed}">` : ''}<body>${s.html || ''}${items.length ? `<ul id="list">${items.map(x => `<li class="row">${x}</li>`).join('')}</ul>` : ''}</body>` };
    return `${s.name}: ${fx[s.name].type}`; },
  /* watchers, through the app's own code (js/watch.js) */
  'watch.make': async s => { const r = await pageOf(s).page.eval(`const inputs = ${J(s.inputs || {})}; let made = {}, tid = ${J(s.template || '')}, tname = '';
    if (tid) { const T = WATCH_TEMPLATES.find(t => t.id === tid); if (!T) throw new Error('no template ' + tid); made = T.make(inputs); tname = T.name; }
    const w = Watch.make({ ...(tid ? { template: tid, templateInputs: inputs } : {}), ...made, ...${J(s.set || {})}, name: ${J(s.name || '')} || made.name || tname || 'MuseTester watcher' });
    for (const x of Watch.list().filter(x => x.name === w.name)) Watch.del(x.id); Watch.put(w); return { id: w.id, name: w.name }`); vars[s.as || 'watcher'] = r; return r.name; },
  'watch.check': async s => { const r = await pageOf(s).page.eval(`const w = ${W(s.name)}; const r = await Watch.check(w); const g = Watch.get(w.id) || w;
    return { hit: r?.hit ? { headline: r.hit.headline, items: r.hit.items, shot: !!r.hit.shot, take: r.hit.take || null, share: r.hit.share || null } : null, error: g.state?.error || '', count: g.state?.count ?? null, trace: (g.state?.trace?.lines || []).join('\\n'), url: g.url || '', state: { healed: g.state?.healed || null, paused: g.state?.paused || '' } }`, (s.timeout || 300) * 1000);
    vars[s.as || 'check'] = r; if (r.error && s.ok !== false) throw new Error(r.error + '\n' + r.trace.split('\n').slice(-4).join('\n')); return r.hit ? `news: ${r.hit.headline}` : `${r.count ?? '-'} read, nothing new`; },
  'watch.set': s => pageOf(s).page.eval(`const w = ${W(s.name)}; Object.assign(w, ${J(s.set || {})}); Watch.put(w); return Object.keys(${J(s.set || {})}).join(', ')`),
  'watch.delete': s => pageOf(s).page.eval(`const l = Watch.list().filter(x => x.name === ${J(s.name)} || (${J(!!s.prefix)} && x.name.startsWith(${J(s.name)}))); for (const w of l) Watch.del(w.id); return l.length + ' deleted'`),
  task: async s => { const r = await pageOf(s).page.eval(`const t = Agent.get(${J(s.id)}); if (!t) throw new Error('no task ' + ${J(s.id)}); return Agent.asCard(await Agent.exec(t, ${J(s.inputs || {})}, { confirmed: true, quiet: true }))`, (s.timeout || 300) * 1000); vars[s.as || 'card'] = r; return (r?.headline || '').slice(0, 160); },
  screenshot: async s => { const f = path.join(OUT, `${cur.id}-${s.name || cur.shots.length + 1}.jpg`); fs.mkdirSync(OUT, { recursive: true });
    try { await pageOf(s).page.shot(f); cur.shots.push(path.basename(f)); return path.basename(f); } catch (e) { return `no picture (${SILENT ? 'the window is hidden' : e.message.slice(0, 60)})`; } },
  /* in a page of the agent browser (read only: what the watcher sees) */
  'web.expect': async s => { const p = await web(pageOf(s), s.host); try { const e = check(await p.eval(s.js || 'document.body.innerText'), s); if (e) throw new Error(e); return 'ok'; } finally { p.close(); } },
  /* files on this Mac (a folder watcher's) */
  file: s => { const f = path.resolve(String(s.path).replace(/^~/, os.homedir())); fs.mkdirSync(path.dirname(f), { recursive: true }); if (s.remove) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, s.text ?? ''); return `${s.remove ? 'removed' : 'wrote'} ${path.basename(f)}`; },
  /* macOS itself */
  native: s => execFileSync('osascript', ['-e', s.applescript], { encoding: 'utf8' }).trim(),
  'native.keys': s => execFileSync('osascript', ['-e', `tell application "${s.app || 'StudioGen'}" to activate`, '-e', 'delay 0.3', '-e', `tell application "System Events" to keystroke ${J(s.text)}${s.using ? ` using {${s.using}}` : ''}`], { encoding: 'utf8' }) || 'typed',
  /* health */
  responsive: async s => { const p = pageOf(s).page, secs = s.seconds || 60, end = Date.now() + secs * 1000; let worst = 0, n = 0;
    while (Date.now() < end) { const t0 = Date.now(); await p.eval('1', 30000).catch(() => {}); worst = Math.max(worst, Date.now() - t0); n++; if (worst > (s.maxMs || 2000)) throw new Error(`the app didn't answer for ${worst} ms`); progress(`${Math.round((end - Date.now()) / 1000)} s to go · slowest ${worst} ms`); await sleep((s.every || 5) * 1000); }
    return `${n} pings, slowest ${worst} ms`; },
  'crash.none': async () => { const d = path.join(os.homedir(), 'Library/Logs/DiagnosticReports'), l = fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^(StudioGen|Electron)/.test(f) && fs.statSync(path.join(d, f)).mtimeMs > started) : []; if (l.length) throw new Error(`crash report: ${l.join(', ')}`); return 'no crash report'; },
  log: async s => { const t = fs.existsSync(DEBUG_LOG) ? fs.readFileSync(DEBUG_LOG, 'utf8').slice(-2e6) : ''; const e = check(t, s); if (e) throw new Error(e.slice(0, 200)); return 'ok'; },
  /* a tandem journey: its devices, then each step (done by its auto, then its check until true or its wait) */
  'journey.start': async s => { const l = JSTEPS.get(s.key); for (const d of l) await d.start(); return l.map(d => d.label).join(', ') + ' ready'; },
  'journey.step': async s => { const st = JSTEPS.get(s.key), t0 = Date.now();
    await st.before?.();
    if (st.always || st.auto) { try { await st.auto?.(); } catch (e) { progress(`the step: ${e.message.slice(0, 120)}`); } }
    else if (st.you) { const you = (typeof st.you === 'function' ? await st.you() : st.you).replace(/<[^>]+>/g, ''); if (AUTO) throw Object.assign(new Error(`needs you: ${you}`), { skip: true }); progress(`You: ${you}`); }
    let again = !!st.words; /* a command said too early (the others not online yet): said once more, a third of the way in (only said steps: a join done twice makes two members) */
    for (;;) { let ok; try { ok = await st.check(); } catch (e) { ok = e.message; } if (ok === true) return `after ${Math.round((Date.now() - t0) / 1000)} s`;
      if (again && Date.now() - t0 > (st.wait || 60) * 333) { again = false; progress('doing it once more'); try { await st.auto(); } catch {} }
      progress(`waiting: ${String(ok).slice(0, 160)}`); if (Date.now() - t0 > (st.wait || 60) * 1000 * (st.you && !st.auto ? 5 : 1)) { /* what each device saw, for the run log */
        const seen = await Promise.all((JSTEPS.get(s.key.split('#')[0]) || []).map(async d => { const x = await d.state().catch(() => null); return `${d.label}: ${x ? `mesh ${x.mesh ? `${Object.values(x.mesh.names || {}).join(', ')} (online ${x.mesh.online?.length})` : 'none'}; paired ${(x.paired || []).map(p => `${p.name}${p.online ? ' online' : ''}`).join(', ') || 'none'}; direct ${x.direct}; last said “${(x.said || []).slice(-1)[0] || ''}”` : 'not answering'}`; }));
        throw new Error(`${ok}\n${seen.join('\n')}`); } if (ctl.stop) throw new Error('stopped'); await sleep(1000); } },
  /* a person: what can't be done for you (a real drive, your phone) */
  human: async s => { if (AUTO) throw Object.assign(new Error('needs you (run it interactively)'), { skip: true });
    if (PANEL) { ctl.human = { say: s.say, answer: null }; while (!ctl.human.answer && !ctl.stop) await sleep(200); const a = ctl.human?.answer; ctl.human = null; if (a !== 'done') throw new Error('you said it didn\'t work'); return 'done'; }
    const a = await ask(`\n  👤 ${s.say}\n     Enter when done, n if it didn't work: `); if (/^n/i.test(a)) throw new Error('you said it didn\'t work'); return 'done'; },
};

/* ---------- the tandem journeys (tests/tandem/journeys.mjs): mesh, pairing, shows, remote view, Workers… ----------
   A test with "journey" runs that journey's acts here: its devices are MuseTester's apps (StudioGens with throwaway
   profiles, DriveGen in Chrome), each journey step is a row; it does the step (its auto), then waits for its check. */
const { journeys } = await import(path.join(ROOT, 'tests/tandem/journeys.mjs')), JSTEPS = new Map();
const prep = label => `(()=>{ store.set('onboarded',true); store.set('setupDone','skip'); store.set('meshName',${J(label)}); document.getElementById('setup')?.remove();
  if(typeof Voice!=='undefined') Voice.respond=async(m,then)=>{ VoiceLog.app(String(m)); then?.(); };
  const o=Relay.newPairing.bind(Relay); Relay.newPairing=async(...a)=>(Relay._tandemCode=await o(...a)); closeSheet(); if (LINK_HOST) { const l = Dash.list('stage.side'); if (!l.includes('chat')) Dash.setList('stage.side', ['chat', ...l]); } openView('mesh'); return 1 })()`;
function device(key, d) {
  return { id: key, label: d.label, kind: d.kind === 'phone' ? 'DriveGen (Chrome)' : 'StudioGen', as: `dev${key}`,
    get app() { return apps[this.as]; },
    async start() { if (d.kind === 'phone') await drivegen({ as: this.as, device: d.device || 'iphone' }); else await launch({ as: this.as, practice: d.practice ?? true, ...(d.env ? { env: d.env } : {}) });
      for (let i = 0; i < 60 && !(await this.app.page.raw('typeof Tandem !== "undefined" && typeof Mesh !== "undefined" && typeof MeshView !== "undefined"').catch(() => false)); i++) await sleep(500);
      await this.app.page.raw(prep(d.label)); for (let i = 0; i < 10 && (await this.state().catch(() => ({})))?.name !== d.label; i++) { await sleep(1000); await this.step('name', d.label); } },
    eval(js, ms) { if (!this.app) return Promise.reject(new Error(`${d.label} isn't running`)); return this.app.page.raw(js, ms); },
    async until(c, n = 60) { for (let i = 0; i < n; i++) { try { if (await this.eval(`!!(${c})`, 5000)) return true; } catch {} await sleep(500); } throw new Error(`${d.label}: not ready`); },
    state() { return this.app ? this.app.page.raw('Tandem.state()', 5000) : Promise.reject(new Error('stopped')); },
    async stop() { await quitApp(this.as); }, async restart() { await this.stop(); await this.start(); },
    step(name, a) { return this.eval(`Promise.resolve(Tandem.STEPS[${J(name)}](${J(a)}))`); },
    async clip(text) { execFileSync('pbcopy', { input: text }); return 'the Mac clipboard'; },
    async shot(f) { return this.app?.page.shot(f); } };
}
for (const t of TESTS) if (t.journey) { /* the journey's acts become the test's steps */
  const ds = t.devices || { A: { label: 'Studio A' }, B: { label: 'Studio B' }, P: { label: 'Test iPhone', kind: 'phone' } }, dev = Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, device(k, d)]));
  const J0 = journeys({ ...dev, devs: Object.values(dev), AUTO: true, sleep })[t.journey]; if (!J0) throw new Error(`${t.id}: no journey ${t.journey}`);
  const acts = Object.entries(J0).filter(([a]) => !t.acts || t.acts.includes(a));
  t.steps = [{ do: 'journey.start', key: t.id, why: `Start ${Object.values(ds).map(d => d.label).join(', ')}` }, ...acts.flatMap(([a, l]) => l.map((s, i) => { const k = `${t.id}#${a}#${i}`; JSTEPS.set(k, s); return { do: 'journey.step', key: k, why: `${a}: ${s.title}` }; })), ...(t.then || [])]; /* then: more steps after the journey, on: devA, devB, devP… */
  JSTEPS.set(t.id, Object.values(dev));
}

/* ---------- the board (what the panel shows) and control ---------- */
const label = s => s.why || ({ launch: 'Open StudioGen', drivegen: `Open DriveGen (${s.device || 'iphone'})`, 'watch.make': `Make “${s.name || s.template}”`, 'watch.check': `Check “${s.name}”`, expect: `Expect ${s.var || s.sel || s.text || 'it'}`, say: `Say “${s.text}”`, click: `Click “${s.text || s.sel}”`, view: `Open ${s.name}`, wait: `Wait ${s.s || 1} s`, human: `You: ${s.say}`, 'practice.signin': 'Sign in to the practice sites', 'practice.incoming': `Practice ${s.site}: ${s.text || s.query}`, fixture: `Fixture “${s.name}”`, 'errors.none': 'No errors in the page', 'crash.none': 'No crash report', responsive: `Stays responsive for ${s.seconds || 60} s`, quit: 'Quit', screenshot: `Picture${s.name ? ` “${s.name}”` : ''}` }[s.do] || s.do);
const board = chosen.map(t => ({ id: t.id, title: t.title, tags: t.tags || [], status: 'todo', ms: 0, shots: [], steps: [...(t.steps || []).map(s => ({ label: label(s), do: s.do, status: 'todo', note: '' })), ...(t.cleanup || []).map(s => ({ label: `Tidy up: ${label(s)}`, do: s.do, status: 'todo', note: '', cleanup: true }))] }));
let cur = null, curStep = null; const progress = n => { if (curStep) curStep.note = n; };
function command(c) {
  if (c.cmd === 'mode') ctl.mode = c.mode === 'step' ? 'step' : 'all';
  if (c.cmd === 'run') { ctl.queue.push(...(c.ids?.length ? c.ids : board.filter(b => b.status === 'todo').map(b => b.id))); ctl.stop = false; }
  if (c.cmd === 'next' || c.cmd === 'skip' || c.cmd === 'retry' || c.cmd === 'stoptest') ctl.next = c.cmd;
  if (c.cmd === 'pause') ctl.paused = !ctl.paused;
  if (c.cmd === 'stop') { ctl.stop = true; ctl.queue = []; ctl.next = 'stoptest'; }
  if (c.cmd === 'human' && ctl.human) ctl.human.answer = c.answer;
  if (c.cmd === 'quit') { ctl.quit = true; ctl.stop = true; ctl.next = 'stoptest'; }
}
/** Before a step: in step mode (or paused) it waits for Next; after a failure it waits for Retry, Skip or Stop. */
async function gate(failed) {
  if (!PANEL) return failed ? 'stoptest' : 'next';
  for (;;) { if (ctl.stop) return 'stoptest'; if (ctl.next) { const c = ctl.next; ctl.next = null; return c; } if (!failed && ctl.mode === 'all' && !ctl.paused) return 'next'; await sleep(150); }
}

/* ---------- running ---------- */
const results = [];
async function run(t) {
  const b = board.find(x => x.id === t.id); b.status = 'run'; b.steps.forEach(s => { s.status = 'todo'; s.note = ''; }); b.shots = [];
  cur = { id: t.id, title: t.title, tryitout: t.tryitout || [], status: 'pass', steps: [], shots: b.shots, t0: Date.now() }; console.log(`\n▶ ${t.id}: ${t.title}`);
  const all = [...(t.steps || []).map(s => ({ s, cleanup: false })), ...(t.cleanup || []).map(s => ({ s, cleanup: true }))];
  for (let i = 0; i < all.length; i++) {
    const { s: raw, cleanup } = all[i], row = b.steps[i]; if (!cleanup && cur.status !== 'pass') { row.status = 'skip'; continue; }
    ctl.waiting = { test: t.id, i }; if (!cleanup) { const g = await gate(false); if (g === 'skip') { row.status = 'skip'; continue; } if (g === 'stoptest') { cur.status = 'skip'; row.status = 'skip'; continue; } } ctl.waiting = null;
    for (;;) { /* a failed step can be tried again from the panel */
      const s = fill(raw), fn = STEPS[s.do], t0 = Date.now(); curStep = row; row.status = 'run'; row.note = '';
      try { if (!fn) throw new Error(`no step “${s.do}”`); const note = await fn(s); row.status = 'pass'; row.note = String(note ?? '').slice(0, 300); row.ms = Date.now() - t0;
        cur.steps.push({ do: s.do, say: row.label, ok: true, ms: row.ms, note: row.note }); console.log(`  ✓ ${row.label}${note ? ` · ${String(note).slice(0, 120)}` : ''}`); break; }
      catch (e) { row.status = e.skip ? 'skip' : 'fail'; row.note = e.message.slice(0, 600); row.ms = Date.now() - t0; console.log(`  ${e.skip ? '○' : '✗'} ${row.label} · ${e.message.split('\n')[0].slice(0, 200)}`);
        if (cleanup || s.optional) { cur.steps.push({ do: s.do, say: row.label, ok: false, ms: row.ms, note: row.note }); break; }
        if (!e.skip) try { const k = s.on || Object.keys(apps)[0]; if (k) await STEPS.screenshot({ name: `failed-${i + 1}`, on: k }); } catch {}
        ctl.failedAt = PANEL && !e.skip ? { test: t.id, i } : null; const g = e.skip ? 'stoptest' : await gate(true); ctl.failedAt = null;
        if (g === 'retry') continue; if (g === 'skip') { row.status = 'skip'; cur.steps.push({ do: s.do, say: row.label, ok: false, ms: row.ms, note: `skipped after: ${row.note}` }); break; }
        cur.steps.push({ do: s.do, say: row.label, ok: false, ms: row.ms, note: row.note }); cur.status = e.skip ? 'skip' : 'fail'; break; }
    }
  }
  for (const k of Object.keys(apps)) if (apps[k].kind === 'studio') { cur.snap = await snapshot(apps[k]).catch(e => ({ error: e.message })); break; } /* for the run log */
  for (const k of Object.keys(apps)) if (!flag('keep')) await quitApp(k);
  curStep = null; cur.ms = Date.now() - cur.t0; b.status = cur.status; b.ms = cur.ms; results.push(cur); report(); console.log(`  → ${cur.status.toUpperCase()} in ${Math.round(cur.ms / 1000)} s`);
}
function report() {
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'results.json'), J(results, null, 1));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), col = { pass: '#34c759', fail: '#ff3b30', skip: '#8e8e93' };
  fs.writeFileSync(path.join(OUT, 'report.html'), `<!doctype html><meta charset="utf-8"><title>MuseTester ${RUN}</title><style>body{font:14px system-ui;margin:24px;max-width:1100px}h2{margin-top:28px}.st{display:inline-block;padding:2px 8px;border-radius:6px;color:#fff;font-weight:600}td{padding:3px 8px;vertical-align:top}pre{white-space:pre-wrap;margin:0;font-size:12px}img{max-width:420px;border:1px solid #ccc;border-radius:8px;margin:6px 6px 0 0}</style>
<h1>MuseTester · ${esc(RUN)} · ${PROFILE} profile</h1><p>${results.map(r => `<span class="st" style="background:${col[r.status]}">${r.status}</span> ${esc(r.id)}`).join(' &nbsp; ')}</p>
${results.map(r => `<h2><span class="st" style="background:${col[r.status]}">${r.status}</span> ${esc(r.title)} <small>(${esc(r.id)}, ${Math.round(r.ms / 1000)} s)</small></h2>${r.tryitout.length ? `<p>Try-it-out: ${r.tryitout.map(esc).join('; ')}</p>` : ''}
<table>${r.steps.map(s => `<tr><td>${s.ok ? '✓' : '✗'}</td><td>${esc(s.say || s.do)}</td><td>${Math.round(s.ms / 100) / 10} s</td><td><pre>${esc(s.note)}</pre></td></tr>`).join('')}</table>${r.shots.map(f => `<img src="${esc(f)}">`).join('')}`).join('')}`);
}
function finish() {
  report(); try { writeLog(); console.log(`Run log (send it to Claude): ${path.join(OUT, 'muse-log.md')}`); } catch (e) { console.log('run log:', e.message); } console.log(`\nReport: ${path.join(OUT, 'report.html')}\n${results.filter(r => r.status === 'pass').length} passed, ${results.filter(r => r.status === 'fail').length} failed, ${results.filter(r => r.status === 'skip').length} skipped or need you`);
  if (flag('mark')) { /* ticks the try-it-out list for what passed */
    const f = path.join(ROOT, 'docs/TasksNeedingComeBack.md'); let s = fs.readFileSync(f, 'utf8'), n = 0; const day = new Date().toISOString().slice(0, 10);
    for (const r of results.filter(x => x.status === 'pass')) for (const w of r.tryitout) s = s.split('\n').map(l => l.startsWith('- [ ]') && l.includes(w) ? (n++, `${l.replace('- [ ]', '- [x]')} (MuseTester ${day})`) : l).join('\n');
    fs.writeFileSync(f, s); console.log(`Ticked ${n} try-it-out item${n === 1 ? '' : 's'} in docs/TasksNeedingComeBack.md`);
  }
  const keep = fs.readdirSync(path.join(HERE, 'reports')).sort(); for (const d of keep.slice(0, -10)) fs.rmSync(path.join(HERE, 'reports', d), { recursive: true, force: true }); /* the newest 10 runs */
}
const bye = () => { for (const k of kids) try { k.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} if (mineWasRunning) try { execFileSync('open', ['-a', 'StudioGen']); } catch {} };
process.on('SIGINT', () => { finish(); bye(); process.exit(130); });
fs.mkdirSync(path.join(HERE, 'reports'), { recursive: true });
try {
  if (PANEL) { /* the panel: its own small window; the tests run when you say */
    const url = `${BASE}/muse/`; console.log(`MuseTester panel: ${url}  (Ctrl+C to end)`);
    if (!flag('no-open')) try { if (fs.existsSync(CHROME)) kids.push(spawn(CHROME, [`--app=${url}`, `--user-data-dir=${path.join(TMP, 'panel')}`, '--window-size=560,960', '--window-position=40,40', '--no-first-run'], { stdio: 'ignore' })); else execFileSync('open', [url]); } catch { execFileSync('open', [url]); }
    while (!ctl.quit) { const id = ctl.queue.shift(); if (id) { const t = chosen.find(x => x.id === id); if (t) await run(t); } else await sleep(300); }
  } else for (const t of chosen) await run(t);
} finally { finish(); bye(); }
process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
