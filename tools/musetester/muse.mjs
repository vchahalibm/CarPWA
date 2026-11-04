// MuseTester: drives StudioGen (the installed app or desktop/), its Workers and DriveGen like a person would, through the
// try-it-out tests in tools/musetester/tests/*.json, and writes a report. Design and test format: tools/musetester/README.md.
//   node tools/musetester/muse.mjs [test ids or tags…] [--profile scratch|mine] [--app installed|dev] [--restart-mine]
//        [--auto] [--mark] [--list] [--keep] [--config file]
// How it drives: the DevTools protocol (the app started with a debugging port on 127.0.0.1) for the app's page, its agent
// browser's pages and DriveGen in Chrome; AppleScript (osascript) for what only macOS has (menus, keystrokes, other apps).
// Profiles: scratch (a throwaway one: the default, with the practice sites) or mine (your own: your sign-ins; only with
// --profile mine, and StudioGen is quit and opened again for it with --restart-mine).
import { spawn, execFileSync } from 'child_process';
import fs from 'fs'; import path from 'path'; import os from 'os'; import http from 'http'; import readline from 'readline';

const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2), flag = k => argv.includes('--' + k), opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const PROFILE = opt('profile', 'scratch'), APP = opt('app', fs.existsSync('/Applications/StudioGen.app') ? 'installed' : 'dev'), AUTO = flag('auto');
const INSTALLED = '/Applications/StudioGen.app/Contents/MacOS/StudioGen', ELECTRON = path.join(ROOT, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', REPORT_LOG = path.join(os.homedir(), 'Library/Logs/StudioGen/debug.log');
const RUN = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), OUT = path.join(HERE, 'reports', RUN), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'musetester-'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), started = Date.now();
const VALUED = ['profile', 'app', 'config'], named = () => argv.filter((a, i) => !a.startsWith('--') && !(i && VALUED.includes(argv[i - 1].slice(2)))); /* test ids and tags */

/* ---------- config and tests ---------- */
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const CONFIG = { ...readJSON(path.join(HERE, 'muse.config.example.json')), ...(fs.existsSync(opt('config', path.join(HERE, 'muse.config.json'))) ? readJSON(opt('config', path.join(HERE, 'muse.config.json'))) : {}) };
const TESTS = fs.readdirSync(path.join(HERE, 'tests')).filter(f => f.endsWith('.json')).sort().map(f => ({ file: f, ...readJSON(path.join(HERE, 'tests', f)) }));
const want = named();
const chosen = TESTS.filter(t => (!want.length || want.some(w => t.id === w || (t.tags || []).includes(w))) && (t.profile || 'scratch') === PROFILE);
if (flag('list')) { for (const t of TESTS) console.log(`${t.id.padEnd(28)} ${(t.profile || 'scratch').padEnd(8)} ${(t.tags || []).join(',').padEnd(24)} ${t.title}`); process.exit(0); }
if (!chosen.length) { console.log(`No tests for --profile ${PROFILE}${want.length ? ` matching ${want.join(', ')}` : ''}. --list shows them.`); process.exit(1); }

/* ---------- the DevTools protocol ---------- */
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && this.wait.has(d.id)) { this.wait.get(d.id)(d); this.wait.delete(d.id); } }; }
  static async open(port, match, ms = 60000) {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(500)) {
      try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(), t = l.find(x => match(x)); if (t) { const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; }); return new Page(ws); } } catch {}
    }
    throw new Error(`no page on port ${port}`);
  }
  send(method, params = {}, ms = 120000) { return new Promise((ok, no) => { const id = ++this.id, t = setTimeout(() => { this.wait.delete(id); no(new Error(`${method} took over ${ms / 1000} s`)); }, ms); this.wait.set(id, d => { clearTimeout(t); d.error ? no(new Error(d.error.message)) : ok(d.result); }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(js, ms) { const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${/\breturn\b/.test(js) ? js : `return (${js});`} })()`, awaitPromise: true, returnByValue: true }, ms); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text); return r.result?.value; }
  async shot(file) { const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }, 30000); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; }
  close() { try { this.ws.close(); } catch {} }
}

/* ---------- the apps ---------- */
const apps = {}, kids = [];
let mineWasRunning = false;
const running = () => { try { return execFileSync('pgrep', ['-fl', 'StudioGen.app/Contents/MacOS/StudioGen'], { encoding: 'utf8' }).split('\n').filter(l => l && !/remote-debugging-port/.test(l)).length > 0; } catch { return false; } };
async function launch(s) {
  const as = s.as || 'studio', port = s.port || 9333 + Object.keys(apps).length, profile = s.profile || PROFILE;
  if (profile === 'mine' && PROFILE !== 'mine') throw new Error('this test needs --profile mine');
  if (profile === 'mine' && running()) {
    if (!flag('restart-mine')) throw new Error('StudioGen is open with your profile: quit it first, or run with --restart-mine (it’s opened again afterwards)');
    mineWasRunning = true; execFileSync('osascript', ['-e', 'tell application "StudioGen" to quit']); for (let i = 0; i < 40 && running(); i++) await sleep(500);
  }
  const dir = profile === 'mine' ? null : path.join(TMP, as), bin = (s.app || APP) === 'dev' ? ELECTRON : INSTALLED;
  const args = [...((s.app || APP) === 'dev' ? [path.join(ROOT, 'desktop')] : []), ...(dir ? [`--user-data-dir=${dir}`] : []), `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'];
  const env = { ...process.env, ...(s.env || {}) }; delete env.ELECTRON_RUN_AS_NODE;
  const k = spawn(bin, args, { env, stdio: 'ignore', detached: false }); kids.push(k);
  const page = await Page.open(port, t => t.type === 'page' && /index\.html/.test(t.url));
  await ready(page);
  apps[as] = { page, port, kind: 'studio', proc: k, profile, practiceWas: await page.eval(`(store.get('agentCfg') || {}).practice ?? false`) };
  if (s.practice != null) await page.eval(`store.set('agentCfg', { ...(store.get('agentCfg') || {}), practice: ${!!s.practice} }); return true`);
  return `${as} on port ${port} (${profile} profile, ${bin === INSTALLED ? 'installed app' : 'desktop/'})`;
}
/** The app's page is up and settled (a first start reloads itself once: the steps wait through that). */
async function ready(page) {
  for (let k = 0; k < 6; k++) try { await page.eval(`for (let i = 0; i < 120 && !(document.readyState === 'complete' && typeof Watch !== 'undefined' && typeof Agent !== 'undefined'); i++) await new Promise(r => setTimeout(r, 250)); try { Setup.close?.(false); } catch {} document.getElementById('setup')?.remove(); return true`, 60000); await sleep(1500); await page.eval('1'); return; }
    catch (e) { if (!/context was destroyed|Cannot find context|Inspected target navigated/i.test(e.message) || k === 5) throw e; await sleep(1500); }
}
let server = null;
async function serve() { /* the web files, for DriveGen in Chrome */
  if (server) return server.port; const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml' };
  server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.writeHead(404).end(); r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); server.port = server.address().port; return server.port;
}
const DEVICES = { iphone: [390, 844, 3, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'], ipad: [1180, 820, 2, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'], 'ipad-portrait': [820, 1180, 2, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'] };
async function drivegen(s) {
  const as = s.as || 'phone', port = s.port || 9433 + Object.keys(apps).length, [w, h, dpr, ua] = DEVICES[s.device || 'iphone'];
  const k = spawn(CHROME, [...(flag('headful') ? [] : ['--headless=new']), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(TMP, as)}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' }); kids.push(k);
  const page = await Page.open(port, t => t.type === 'page');
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await page.send('Network.setUserAgentOverride', { userAgent: ua });
  const url = !s.url || s.url === 'local' ? `http://127.0.0.1:${await serve()}/index.html` : s.url;
  if (s.settings) { await page.send('Page.navigate', { url }); await sleep(2500); await page.eval(`localStorage.clear(); localStorage.setItem('dd.settings', ${JSON.stringify(JSON.stringify(s.settings))}); return true`); }
  await page.send('Page.navigate', { url }); await sleep(5000);
  await page.eval(`for (let i = 0; i < 80 && typeof openView === 'undefined'; i++) await new Promise(r => setTimeout(r, 250)); document.getElementById('setup')?.remove(); [...document.querySelectorAll('#sheet button')].find(b => /not now/i.test(b.textContent))?.click(); return true`);
  apps[as] = { page, port, kind: 'phone', proc: k }; return `${as}: DriveGen as ${s.device || 'iphone'} (${url})`;
}
async function quitApp(as = 'studio') {
  const a = apps[as]; if (!a) return 'not open'; delete apps[as];
  if (a.kind === 'studio' && a.profile === 'mine') try { await a.page.eval(`store.set('agentCfg', { ...(store.get('agentCfg') || {}), practice: ${a.practiceWas} }); return true`); } catch {}
  try { a.page.close(); } catch {} try { a.proc.kill('SIGTERM'); } catch {}
  for (let i = 0; i < 40 && a.proc.exitCode == null && !a.proc.killed; i++) await sleep(250); await sleep(1500); return `${as} quit`;
}
async function web(a, host) { /* a page in the app's agent browser (a <webview>), by its address */
  return Page.open(a.port, t => t.type === 'webview' && t.url.includes(host), 15000);
}

/* ---------- steps ---------- */
const vars = { ...CONFIG.vars };
const fill = v => typeof v === 'string' && /^\$\{[\w.]+\}$/.test(v) ? (v.slice(2, -1).split('.').reduce((o, p) => o?.[p], vars) ?? v) /* the whole value: kept as it is (an object) */
  : typeof v === 'string' ? v.replace(/\$\{([\w.]+)\}/g, (m, k) => { const x = k.split('.').reduce((o, p) => o?.[p], vars); return x == null ? m : typeof x === 'object' ? JSON.stringify(x) : String(x); }) : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
const J = JSON.stringify, ask = q => new Promise(r => { const i = readline.createInterface({ input: process.stdin, output: process.stdout }); i.question(q, a => { i.close(); r(a); }); });
const pageOf = s => { const a = apps[s.on || 'studio']; if (!a) throw new Error(`${s.on || 'studio'} isn't open (launch it first)`); return a; };
const check = (got, s) => { /* expectations on a value */
  const v = got, txt = typeof v === 'string' ? v : J(v);
  if ('equals' in s && J(v) !== J(s.equals)) return `${txt?.slice(0, 160)} isn't ${J(s.equals)}`;
  if ('contains' in s && !String(txt).toLowerCase().includes(String(s.contains).toLowerCase())) return `“${String(txt).slice(0, 200)}” doesn't contain “${s.contains}”`;
  if ('lacks' in s && String(txt).toLowerCase().includes(String(s.lacks).toLowerCase())) return `“${String(txt).slice(0, 200)}” contains “${s.lacks}”`;
  if ('match' in s && !new RegExp(s.match, 'i').test(txt)) return `“${String(txt).slice(0, 200)}” doesn't match /${s.match}/`;
  if ('gte' in s && !(+v >= +s.gte)) return `${v} < ${s.gte}`;
  if ('lte' in s && !(+v <= +s.lte)) return `${v} > ${s.lte}`;
  if (!['equals', 'contains', 'lacks', 'match', 'gte', 'lte'].some(k => k in s) && !v) return `${txt} isn't true`;
  return '';
};
const STEPS = {
  launch: s => launch(s), quit: s => quitApp(s.as || s.on), drivegen: s => drivegen(s),
  wait: async s => { await sleep((+s.s || 1) * 1000); return `${s.s || 1} s`; },
  eval: async s => { const v = await pageOf(s).page.eval(s.js, (s.timeout || 120) * 1000); if (s.as) vars[s.as] = v; return J(v)?.slice(0, 200); },
  until: async s => { const t0 = Date.now(); for (;;) { const v = await pageOf(s).page.eval(s.js).catch(e => null); if (!check(v, s)) return `after ${Math.round((Date.now() - t0) / 1000)} s`; if (Date.now() - t0 > (s.timeout || 60) * 1000) throw new Error(`still not after ${s.timeout || 60} s: ${J(v)?.slice(0, 160)}`); await sleep((s.every || 1) * 1000); } },
  expect: async s => { /* var (a step's result), js (in the page), sel (shown on screen) or text (anywhere on screen) */
    let v, rule = s;
    if ('var' in s) v = s.var.split('.').reduce((o, p) => o?.[p], vars);
    else if ('js' in s) v = await pageOf(s).page.eval(s.js);
    else if ('sel' in s) v = await pageOf(s).page.eval(`const e = document.querySelector(${J(s.sel)}); return !!e && !!e.getClientRects().length`);
    else if ('text' in s) { v = await pageOf(s).page.eval('document.body.innerText'); rule = { contains: s.text }; }
    const e = check(v, rule); if (e) throw new Error(e); return 'ok'; },
  view: s => pageOf(s).page.eval(`openView(${J(s.name)}); return ${J(s.name)}`),
  say: s => pageOf(s).page.eval(`handleCommand(${J(s.text)}); return 'said'`),
  click: s => pageOf(s).page.eval(`const want = ${J(s.text || '')}.toLowerCase(), sel = ${J(s.sel || (s.sheet ? '#sheet button' : 'button,[role="button"],a,.app-tile,.chip,.big-btn,.link-btn'))};
    const l = [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length), el = want ? l.find(e => e.textContent.trim().toLowerCase() === want) || l.find(e => (e.textContent + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase().includes(want)) : l[0];
    if (!el) throw new Error('nothing to click: ' + (want || sel)); el.scrollIntoView({ block: 'center' }); el.click(); return (el.textContent || el.getAttribute('aria-label') || sel).trim().slice(0, 60)`),
  type: s => pageOf(s).page.eval(`const el = document.querySelector(${J(s.sel)}); if (!el) throw new Error('no field ' + ${J(s.sel)}); el.focus(); el.value = ${J(s.text)}; el.dispatchEvent(new Event('input', { bubbles: true })); ${s.enter ? `el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));` : ''} return 'typed'`),
  key: async s => { const p = pageOf(s).page; for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: s.key, code: s.code || s.key, windowsVirtualKeyCode: s.keyCode || 0 }); return s.key; },
  practice: s => pageOf(s).page.eval(`store.set('agentCfg', { ...(store.get('agentCfg') || {}), practice: ${s.on !== false && s.value !== false} }); return Agent.cfg().practice`),
  /* watchers, through the app's own code (js/watch.js) */
  'watch.make': async s => { const r = await pageOf(s).page.eval(`const T = WATCH_TEMPLATES.find(t => t.id === ${J(s.template)}); if (!T) throw new Error('no template ' + ${J(s.template)});
    const inputs = ${J(s.inputs || {})}, made = T.make(inputs), w = Watch.make({ template: T.id, templateInputs: inputs, ...made, ...${J(s.set || {})}, name: ${J(s.name || '')} || made.name || T.name });
    for (const x of Watch.list().filter(x => x.name === w.name && x.id !== w.id)) Watch.del ? Watch.del(x.id) : store.set('watchers', Watch.list().filter(y => y.id !== x.id));
    Watch.put(w); return { id: w.id, name: w.name }`); vars[s.as || 'watcher'] = r; return r.name; },
  'watch.check': async s => { const r = await pageOf(s).page.eval(`const w = Watch.list().find(x => x.name === ${J(s.name)} || x.id === ${J(s.name)}); if (!w) throw new Error('no watcher ' + ${J(s.name)});
    const r = await Watch.check(w); const g = Watch.get(w.id) || w; return { hit: r?.hit ? { headline: r.hit.headline, items: r.hit.items, shot: !!r.hit.shot, take: r.hit.take || null } : null, error: g.state?.error || '', count: g.state?.count ?? null, trace: (g.state?.trace?.lines || []).join('\\n'), url: g.url || '' }`, (s.timeout || 300) * 1000);
    vars[s.as || 'check'] = r; if (r.error && s.ok !== false) throw new Error(r.error + '\n' + r.trace.split('\n').slice(-4).join('\n')); return r.hit ? `news: ${r.hit.headline}` : `${r.count ?? '-'} read, nothing new`; },
  'watch.delete': s => pageOf(s).page.eval(`const l = Watch.list().filter(x => x.name === ${J(s.name)}); for (const w of l) Watch.del ? Watch.del(w.id) : store.set('watchers', Watch.list().filter(y => y.id !== w.id)); return l.length + ' deleted'`),
  /* the practice sites have a pretend sign-in: signed in for a throwaway profile, in the agent browser's own storage */
  'practice.signin': async s => { const a = pageOf(s); await a.page.eval(`await AgentWeb.go(Agent.sites().slack, undefined, { quiet: true }); return true`);
    const p = await web(a, 'labs/practice/'); try { await p.eval(`for (const k of ['practiceSlack', 'practiceWa', 'practiceTeams', 'practiceX', 'practiceInbox']) localStorage.setItem(k + 'Auth', '1'); setTimeout(() => location.replace(location.pathname), 50); return true`); } finally { p.close(); } await sleep(2500); /* it was showing the sign-in page: shown again signed in */
    return 'signed in to the practice Slack, WhatsApp, Teams, X'; },
  'practice.incoming': s => pageOf(s).page.eval(`const ctx = { quiet: true }; await AgentWeb.go(Agent.sites()[${J(s.site)}] + (/\\?/.test(Agent.sites()[${J(s.site)}]) ? '&' : '?') + 'incoming=' + encodeURIComponent(${J(s.text)}), undefined, ctx); await new Promise(r => setTimeout(r, 1200)); return 'sent'`),
  task: async s => { const r = await pageOf(s).page.eval(`const t = Agent.get(${J(s.id)}); if (!t) throw new Error('no task ' + ${J(s.id)}); return Agent.asCard(await Agent.exec(t, ${J(s.inputs || {})}, { confirmed: true, quiet: true }))`, (s.timeout || 300) * 1000); vars[s.as || 'card'] = r; return (r?.headline || '').slice(0, 160); },
  screenshot: async s => { const f = path.join(OUT, `${cur.id}-${s.name || cur.shots.length + 1}.jpg`); fs.mkdirSync(OUT, { recursive: true }); await pageOf(s).page.shot(f); cur.shots.push(path.basename(f)); return path.basename(f); },
  /* in a page of the agent browser (read only: what the watcher sees) */
  'web.expect': async s => { const p = await web(pageOf(s), s.host); try { const v = await p.eval(s.js || 'document.body.innerText'); const e = check(v, s); if (e) throw new Error(e); return 'ok'; } finally { p.close(); } },
  /* macOS itself */
  native: s => execFileSync('osascript', ['-e', s.applescript], { encoding: 'utf8' }).trim(),
  'native.keys': s => execFileSync('osascript', ['-e', `tell application "${s.app || 'StudioGen'}" to activate`, '-e', 'delay 0.3', '-e', `tell application "System Events" to keystroke ${J(s.text)}${s.using ? ` using {${s.using}}` : ''}`], { encoding: 'utf8' }) || 'typed',
  /* health */
  responsive: async s => { const p = pageOf(s).page, end = Date.now() + (s.seconds || 60) * 1000; let worst = 0, n = 0;
    while (Date.now() < end) { const t0 = Date.now(); await p.eval('1', 30000).catch(() => {}); worst = Math.max(worst, Date.now() - t0); n++; if (worst > (s.maxMs || 2000)) throw new Error(`the app didn't answer for ${worst} ms (after ${Math.round((Date.now() - end) / 1000 + (s.seconds || 60))} s)`); await sleep((s.every || 5) * 1000); }
    return `${n} pings, slowest ${worst} ms`; },
  'crash.none': async () => { const d = path.join(os.homedir(), 'Library/Logs/DiagnosticReports'), l = fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^(StudioGen|Electron)/.test(f) && fs.statSync(path.join(d, f)).mtimeMs > started) : []; if (l.length) throw new Error(`crash report: ${l.join(', ')}`); return 'no crash report'; },
  log: async s => { const t = fs.existsSync(REPORT_LOG) ? fs.readFileSync(REPORT_LOG, 'utf8').slice(-2e6) : ''; const e = check(t.split('\n').filter(l => !s.since || l >= s.since).join('\n'), s); if (e) throw new Error(e.slice(0, 200)); return 'ok'; },
  /* a person: what can't be done for you (a real drive, your phone) */
  human: async s => { if (AUTO) throw Object.assign(new Error('needs you (run without --auto)'), { skip: true }); const a = await ask(`\n  👤 ${fill(s.say)}\n     Enter when done, n if it didn't work: `); if (/^n/i.test(a)) throw new Error('you said it didn\'t work'); return 'done'; },
};

/* ---------- running ---------- */
let cur = null; const results = [];
async function run(t) {
  cur = { id: t.id, title: t.title, tryitout: t.tryitout || [], status: 'pass', steps: [], shots: [], t0: Date.now() };
  console.log(`\n▶ ${t.id}: ${t.title}`);
  for (const phase of ['steps', 'cleanup']) for (const raw of t[phase] || []) {
    if (phase === 'steps' && cur.status !== 'pass') break;
    const s = fill(raw), fn = STEPS[s.do]; const t0 = Date.now();
    try { if (!fn) throw new Error(`no step “${s.do}”`); const note = await fn(s); cur.steps.push({ do: s.do, say: s.why || '', ok: true, ms: Date.now() - t0, note: String(note ?? '').slice(0, 300) }); console.log(`  ✓ ${s.why || s.do} ${note ? `· ${String(note).slice(0, 120)}` : ''}`); }
    catch (e) { cur.steps.push({ do: s.do, say: s.why || '', ok: false, ms: Date.now() - t0, note: e.message.slice(0, 600) }); console.log(`  ${e.skip ? '○' : '✗'} ${s.why || s.do} · ${e.message.split('\n')[0].slice(0, 200)}`);
      if (phase === 'steps' && !s.optional) { cur.status = e.skip ? 'skip' : 'fail'; if (!e.skip) try { const a = apps[s.on || 'studio'] || Object.values(apps)[0]; if (a) await STEPS.screenshot({ name: 'failed', on: Object.keys(apps).find(k => apps[k] === a) }); } catch {} } }
  }
  for (const k of Object.keys(apps)) if (!flag('keep') || k !== 'studio') await quitApp(k);
  cur.ms = Date.now() - cur.t0; results.push(cur); console.log(`  → ${cur.status.toUpperCase()} in ${Math.round(cur.ms / 1000)} s`);
}
function report() {
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'results.json'), J(results, null, 1));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), col = { pass: '#34c759', fail: '#ff3b30', skip: '#8e8e93' };
  fs.writeFileSync(path.join(OUT, 'report.html'), `<!doctype html><meta charset="utf-8"><title>MuseTester ${RUN}</title><style>body{font:14px system-ui;margin:24px;max-width:1100px}h2{margin-top:28px}.st{display:inline-block;padding:2px 8px;border-radius:6px;color:#fff;font-weight:600}td{padding:3px 8px;vertical-align:top}pre{white-space:pre-wrap;margin:0;font-size:12px}img{max-width:420px;border:1px solid #ccc;border-radius:8px;margin:6px 6px 0 0}</style>
<h1>MuseTester · ${esc(RUN)} · ${PROFILE} profile</h1><p>${results.map(r => `<span class="st" style="background:${col[r.status]}">${r.status}</span> ${esc(r.id)}`).join(' &nbsp; ')}</p>
${results.map(r => `<h2><span class="st" style="background:${col[r.status]}">${r.status}</span> ${esc(r.title)} <small>(${esc(r.id)}, ${Math.round(r.ms / 1000)} s)</small></h2>${r.tryitout.length ? `<p>Try-it-out: ${r.tryitout.map(esc).join('; ')}</p>` : ''}
<table>${r.steps.map(s => `<tr><td>${s.ok ? '✓' : '✗'}</td><td>${esc(s.say || s.do)}</td><td>${Math.round(s.ms / 100) / 10} s</td><td><pre>${esc(s.note)}</pre></td></tr>`).join('')}</table>${r.shots.map(f => `<img src="${esc(f)}">`).join('')}`).join('')}`);
  console.log(`\nReport: ${path.join(OUT, 'report.html')}\n${results.filter(r => r.status === 'pass').length} passed, ${results.filter(r => r.status === 'fail').length} failed, ${results.filter(r => r.status === 'skip').length} need you`);
  if (flag('mark')) { /* ticks the try-it-out list for what passed */
    const f = path.join(ROOT, 'docs/TasksNeedingComeBack.md'); let s = fs.readFileSync(f, 'utf8'), n = 0; const day = new Date().toISOString().slice(0, 10);
    for (const r of results.filter(x => x.status === 'pass')) for (const want of r.tryitout) s = s.split('\n').map(l => l.startsWith('- [ ]') && l.includes(want) ? (n++, `${l.replace('- [ ]', '- [x]')} (MuseTester ${day})`) : l).join('\n');
    fs.writeFileSync(f, s); console.log(`Ticked ${n} try-it-out item${n === 1 ? '' : 's'} in docs/TasksNeedingComeBack.md`);
  }
  const keep = fs.readdirSync(path.join(HERE, 'reports')).sort(); for (const d of keep.slice(0, -10)) fs.rmSync(path.join(HERE, 'reports', d), { recursive: true, force: true }); /* the newest 10 runs */
}
const bye = () => { for (const k of kids) try { k.kill(); } catch {} try { server?.close(); } catch {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  if (mineWasRunning) try { execFileSync('open', ['-a', 'StudioGen']); } catch {} };
process.on('SIGINT', () => { bye(); process.exit(130); });
fs.mkdirSync(path.join(HERE, 'reports'), { recursive: true });
try { for (const t of chosen) await run(t); } finally { report(); bye(); }
process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
