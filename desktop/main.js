'use strict';
/* StudioGen (the desktop app of DriveGen/DriveDeck): the same web app in an Electron window.
   The web files (index.html, js/, css/, vendor/, icons/…) are served from a private, secure origin
   (app://drivedeck/), so everything that needs one works as on the web: the microphone, WebGPU, workers, the
   service worker and model caching. Nothing in the web app changes for the desktop; it notices Electron from
   its user agent (bigger memory budget, Whisper for listening).
   It also lives in the menu bar (Tray): open it, present on another screen (the wall) with the presenter view on this
   one, start at login. The page reaches these through preload.js (window.DriveDeckDesktop). */
const { app, BrowserWindow, protocol, net, shell, session, Menu, Tray, nativeImage, screen, ipcMain, desktopCapturer, dialog, systemPreferences } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'app', HOST = 'drivedeck', ORIGIN = `${SCHEME}://${HOST}`; // the internal origin keeps its name: your data lives there
// StudioGen Worker (worker/README.md, docs/studiogbee.html § 8): StudioGen in a Linux container without a screen of its own
// (a virtual one, Xvfb). No updates (the image is rebuilt), no menu bar or dialogs, data in SG_DATA; set up from the
// environment (SG_NAME, SG_MESH_INVITE, the model), then seen and used from your devices (js/remoteview.js).
// A light Worker (SG_LIGHT=1) is the same on a Mac: a second, hidden StudioGen with its own profile, started by StudioGen
// itself (Workers in js/workers.js, LightWorkers below); SIGUSR2 shows or hides its window.
const WORKER = process.env.SG_WORKER === '1', LIGHT = WORKER && process.env.SG_LIGHT === '1';
if (WORKER) {
  if (process.platform === 'linux') { for (const sw of ['no-sandbox', 'disable-gpu', 'disable-dev-shm-usage']) app.commandLine.appendSwitch(sw); app.commandLine.appendSwitch('password-store', 'basic'); }
  if (process.env.SG_DATA) app.setPath('userData', process.env.SG_DATA);
}
const fs = require('fs');
// Errors in this process: written with their stack to ~/Library/Logs/StudioGen/main.log (kept short), and shown once a
// minute at most, instead of Electron's bare “A JavaScript error occurred in the main process” box. StudioGen keeps running.
let lastErrBox = 0;
function mainError(kind, e) {
  const text = `${new Date().toISOString()} ${kind}: ${e?.stack || e}\n`;
  try { const dir = app.getPath('logs'), f = path.join(dir, 'main.log'); fs.mkdirSync(dir, { recursive: true });
    const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-150000) : ''; fs.writeFileSync(f, old + text); } catch {}
  console.error(text);
  if (kind === 'error' && !WORKER && app.isReady() && Date.now() - lastErrBox > 60000) {
    lastErrBox = Date.now();
    dialog.showMessageBox({ type: 'warning', message: 'StudioGen hit an error (it keeps running)', detail: `${e?.message || e}\n\nThe details are in ~/Library/Logs/StudioGen/main.log.`,
      buttons: ['OK', 'Copy details'] }).then(r => { if (r.response === 1) require('electron').clipboard.writeText(text); }).catch(() => {});
  }
}
process.on('uncaughtException', e => mainError('error', e));
process.on('unhandledRejection', e => mainError('promise', e));
// Renamed from DriveDeck: carry its folder over (settings, scripts, downloaded models), once, before anything opens it.
try { const ud = app.getPath('userData'), old = path.join(path.dirname(ud), 'DriveDeck'); if (!fs.existsSync(ud) && fs.existsSync(old)) fs.renameSync(old, ud); } catch (e) { console.warn('Could not move the DriveDeck folder', e.message); }
// Packaged: the web files are copied into Resources/web, and updates (desktop/updater.js) may serve newer ones. From source: the repo root.
const BUNDLED = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..');
const Updates = require('./updater')({ app, net, bundled: BUNDLED });
const Tasks = require('./tasks')({ app, dialog, getWindow: () => mainWin }); // scripts' tasks on this computer (AppleScript, Shortcuts, shell)
const Data = require('./data')({ app, dialog, getWindow: () => mainWin }); // SQLite (read-only) and data files for the data widget
const Speech = require('./speech')({ app, getWindow: () => mainWin }); // Apple's speech recognizer (desktop/speech/main.swift) for voice commands
const AI = require('./ai')({ app });
const Builtin = require('./llm')({ app, send: p => mainWin?.webContents.send('dd:llm-progress', p) }); // the language model built in (llama.cpp, desktop/llm.js) // Apple's on-device language model (desktop/ai/main.swift): the Brain's “This Mac” and commands by intent
// The link to DriveGen on a phone or iPad (desktop/link.js): its requests are done by the page (js/link.js), asked here.
const linkWaits = new Map();
const linkAsk = (kind, payload) => new Promise((res, rej) => {
  if (!mainWin) return rej(new Error('StudioGen’s window is closed'));
  const id = Math.random().toString(36).slice(2), t = setTimeout(() => { linkWaits.delete(id); rej(new Error('No answer from StudioGen')); }, kind === 'run' || kind === 'say' ? 600000 : 15000);
  linkWaits.set(id, { res, rej, t }); mainWin.webContents.send('dd:link-ask', { id, kind, payload });
});
const Link = require('./link')({ app, ask: linkAsk });
let WEB = BUNDLED, VENDOR = path.join(BUNDLED, 'vendor');
function useWeb() { const a = app.isPackaged ? Updates.active() : { app: BUNDLED, vendor: path.join(BUNDLED, 'vendor'), version: 0 }; WEB = a.app; VENDOR = a.vendor; Updates.served(a.version); bridgeSrc = null; return a; }

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true, stream: true, codeCache: true } }]);

// Permissions the app asks for: microphone and camera (voice, later object detection), location, wake lock, notifications.
const ALLOWED = new Set(['media', 'geolocation', 'notifications', 'screen-wake-lock', 'fullscreen', 'clipboard-sanitized-write', 'display-capture']);

let lastExternal = 0; // when another app last opened, to skip the web fallback the page opens if it seems nothing happened

function openOutside(url) {
  shell.openExternal(url).then(() => { lastExternal = Date.now(); }, e => console.warn('No app for', url, e.message));
}

let mainWin = null, presWin = null, tray = null, presenting = false;
const webPrefs = { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js'), webviewTag: true };

/* ---------- Browser widgets: <webview> in the page, a real browser per web widget ----------
   Any site, logins kept (the 'persist:browse' session, apart from the app's own). Each page gets webview-preload.js in an
   isolated world (the page can't see or reach it): the recorder/player from bridge/drivedeck-bridge.js, so clicks can be
   recorded and replayed on any site. The page itself never gets Node or the app's powers. */
const BROWSE = 'persist:browse';
const Browse = require('./browse')(); // containers, and sign-ins kept across restarts (desktop/browse.js)
/** A browsing session (Default or a container), set up once: the app's own pages served, and no camera, microphone,
    location or notifications for web pages. */
const browseReady = new Set();
function browseSession(p) {
  if (browseReady.has(p)) return; browseReady.add(p);
  const s = session.fromPartition(p);
  if (serveWeb) s.protocol.handle(SCHEME, serveWeb); // the app's own pages (samples, labs/practice) in browsers
  s.setPermissionRequestHandler((wc, perm, cb) => cb(['fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  s.setPermissionCheckHandler((wc, perm) => ['fullscreen', 'clipboard-sanitized-write'].includes(perm));
}
let serveWeb = null;
function guestRules(contents) {
  contents.on('will-attach-webview', (e, wp, params) => {
    if (!/^https?:\/\//.test(params.src || '') && !String(params.src || '').startsWith(ORIGIN) && params.src !== 'about:blank') { e.preventDefault(); return; }
    delete wp.preloadURL; Object.assign(wp, { preload: path.join(__dirname, 'webview-preload.js'), nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
    params.partition = Browse.use(params.partition); browseSession(params.partition); // Default or a container (logins kept), apart from the app's own session
  });
  contents.on('did-attach-webview', (e, guest) => {
    // Pop-ups and new tabs open in the same widget; other apps' links open outside.
    guest.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) guest.loadURL(url); else openOutside(url); return { action: 'deny' }; });
    guest.on('will-navigate', (ev, url) => { if (!/^(https?:|about:)/.test(url) && !url.startsWith(ORIGIN)) { ev.preventDefault(); openOutside(url); } });
  });
}
let bridgeSrc = null;
const readBridge = () => (bridgeSrc ??= fs.readFileSync(path.join(WEB, 'bridge', 'drivedeck-bridge.js'), 'utf8'));

/** Pages of the app open inside it; links to other apps and web pages open outside. */
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${ORIGIN}/presenter.html`)) { openPresenter(); return { action: 'deny' }; }
    if (url.startsWith(ORIGIN)) return { action: 'allow' };
    if (/^https?:/.test(url) && Date.now() - lastExternal < 2500) return { action: 'deny' }; // the app already opened
    openOutside(url); return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); openOutside(url); } });
}

function createWindow({ show = true } = {}) {
  const win = mainWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500, backgroundColor: '#000000', title: 'StudioGen', show,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', webPreferences: LIGHT ? { ...webPrefs, paintWhenInitiallyHidden: true } : webPrefs, // a light Worker paints while hidden (seen from afar)
  });
  guard(win); guestRules(win.webContents);
  win.on('closed', () => { if (mainWin === win) mainWin = null; presenting = false; presWin?.close(); menu(); });
  win.on('leave-full-screen', () => { if (presenting) { presenting = false; menu(); } });
  // Hidden or minimized (and not presenting): let Chromium slow the page down, so the 3D assistant and timers stop costing
  // battery (about 22% CPU in the background otherwise); back to full speed as soon as it's shown again.
  const throttle = on => { try { if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(on && !presenting); } catch {} };
  win.on('hide', () => throttle(true)); win.on('minimize', () => throttle(true));
  win.on('show', () => throttle(false)); win.on('restore', () => throttle(false));
  // Esc on the wall stops presenting (the presenter view stays open).
  win.webContents.on('before-input-event', (e, i) => { if (presenting && i.type === 'keyDown' && i.key === 'Escape') { presenting = false; win.setFullScreen(false); menu(); } });
  if (!WORKER) win.webContents.once('did-finish-load', () => Updates.start()); // it runs: tidy up after an update, then check now and then
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}
function showMain() { if (!mainWin) createWindow(); else { mainWin.show(); mainWin.focus(); } return mainWin; }

/* ---------- Screens: present on the wall, the presenter view here ---------- */
const otherDisplay = d => screen.getAllDisplays().find(x => x.id !== d.id) || null;
function displays() {
  const here = mainWin ? screen.getDisplayMatching(mainWin.getBounds()).id : screen.getPrimaryDisplay().id, prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Screen ${i + 1}`, primary: d.id === prim, here: d.id === here, w: d.size.width, h: d.size.height }));
}
function openPresenter(onDisplay) {
  if (presWin) { presWin.show(); presWin.focus(); return presWin; }
  const main = mainWin ? screen.getDisplayMatching(mainWin.getBounds()) : screen.getPrimaryDisplay();
  const d = onDisplay || (presenting && otherDisplay(main)) || main, w = Math.min(1180, d.workArea.width - 40), h = Math.min(780, d.workArea.height - 40);
  presWin = new BrowserWindow({ width: w, height: h, x: d.workArea.x + Math.round((d.workArea.width - w) / 2), y: d.workArea.y + Math.round((d.workArea.height - h) / 2),
    minWidth: 640, minHeight: 420, backgroundColor: '#000000', title: 'StudioGen · Presenter', webPreferences: webPrefs });
  guard(presWin);
  presWin.on('closed', () => { presWin = null; menu(); });
  presWin.loadURL(`${ORIGIN}/presenter.html`);
  menu(); return presWin;
}
/** StudioGen full screen on display `id` (the wall); the presenter view on another screen when there is one. */
function present(id) {
  const win = showMain(), d = screen.getAllDisplays().find(x => x.id === +id) || otherDisplay(screen.getDisplayMatching(win.getBounds())) || screen.getPrimaryDisplay();
  const go = () => {
    win.setBounds({ ...d.workArea }); win.setFullScreen(true); presenting = true;
    const other = otherDisplay(d);
    if (other) { if (presWin) presWin.setBounds({ x: other.workArea.x + 20, y: other.workArea.y + 20, width: Math.min(1180, other.workArea.width - 40), height: Math.min(780, other.workArea.height - 40) }); else openPresenter(other); }
    menu();
  };
  if (win.isFullScreen()) { win.once('leave-full-screen', () => setTimeout(go, 300)); win.setFullScreen(false); } else go();
  return true;
}
function stopPresenting() { presenting = false; if (mainWin?.isFullScreen()) mainWin.setFullScreen(false); presWin?.close(); menu(); return true; }
function loginItem(on) {
  if (on != null) app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true });
  menu(); return app.getLoginItemSettings().openAtLogin;
}

/* ---------- The menu bar ---------- */
function menu() {
  if (!tray) return;
  const ds = displays();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open StudioGen', click: showMain },
    { type: 'separator' },
    { label: 'Present on', submenu: ds.map(d => ({ label: `${d.label} (${d.w}×${d.h})${d.primary ? ' · main screen' : ''}`, click: () => present(d.id) })) },
    { label: 'Presenter view', click: () => { showMain(); openPresenter(); } },
    { label: 'Stop presenting', enabled: presenting || !!presWin, click: stopPresenting },
    { type: 'separator' },
    { label: 'Mesh…', click: () => showMain().webContents.send('dd:menu', 'mesh') },
    { label: 'Settings…', click: () => showMain().webContents.send('dd:menu', 'settings') },
    { label: 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => loginItem(i.checked) },
    { type: 'separator' },
    { label: 'Check for updates…', click: () => { showMain(); Updates.check(true); } },
    { label: 'Quit StudioGen', role: 'quit' },
  ]));
}
function makeTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img); tray.setToolTip('StudioGen');
  menu();
  screen.on('display-added', menu); screen.on('display-removed', menu);
}

// The direct link to DriveGen (js/direct.js): the Mac's real local address in its WebRTC code instead of an mDNS name, which
// some networks (hotspots, office Wi-Fi) don't resolve. The code is only ever shown as a QR on this screen.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
/* ---------- Light Workers: hidden StudioGens on this Mac, each with its own profile (sign-ins, tasks) in
   <userData>/workers/<id>; started with StudioGen and stopped with it. ---------- */
const LightWorkers = (() => {
  const { spawn } = require('child_process'), kids = new Map();
  const file = () => path.join(app.getPath('userData'), 'light-workers.json');
  const list = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; } };
  const keep = l => fs.writeFileSync(file(), JSON.stringify(l, null, 2));
  const OK = /^[a-z0-9-]{1,30}$/;
  function start(w) {
    if (kids.get(w.id)?.exitCode === null) return true;
    const env = { ...process.env, SG_WORKER: '1', SG_LIGHT: '1', SG_NAME: w.name, SG_DATA: path.join(app.getPath('userData'), 'workers', w.id), SG_MESH_INVITE: w.invite || '', ...(w.llm ? { SG_LLM_PROVIDER: 'openai', SG_LLM_URL: w.llm.url, SG_LLM_MODEL: w.llm.model } : {}) };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawn(process.execPath, app.isPackaged ? [] : [__dirname], { env, stdio: 'ignore' });
    p.on('exit', () => { if (kids.get(w.id) === p) kids.delete(w.id); });
    kids.set(w.id, p); return true;
  }
  return {
    list: () => list().map(w => ({ id: w.id, name: w.name, running: kids.get(w.id)?.exitCode === null, created: w.created })),
    create(o) {
      const id = String(o.id || '').toLowerCase(); if (!OK.test(id)) throw new Error('Name: letters, digits and dashes');
      const l = list(); if (l.some(w => w.id === id)) throw new Error('There is a Worker by that name already');
      const w = { id, name: String(o.name || id).slice(0, 40), invite: String(o.invite || ''), llm: o.llm && /^https?:\/\//.test(o.llm.url) ? { url: String(o.llm.url), model: String(o.llm.model || '') } : null, created: new Date().toISOString() };
      keep([...l, w]); return start(w);
    },
    start: id => { const w = list().find(x => x.id === id); return !!w && start({ ...w, invite: '' }); }, // the invite is used once
    stop: id => { const p = kids.get(id); if (p) p.kill(); return true; },
    show: id => { const p = kids.get(id); if (p) p.kill('SIGUSR2'); return !!p; },
    remove(id, data) { this.stop(id); keep(list().filter(w => w.id !== id)); if (data && OK.test(id)) setTimeout(() => fs.rmSync(path.join(app.getPath('userData'), 'workers', id), { recursive: true, force: true }), 1500); return true; },
    resume() { for (const w of list()) if (w.auto !== false) start({ ...w, invite: '' }); }, // at StudioGen's start
    stopAll() { for (const p of kids.values()) try { p.kill(); } catch {} },
  };
})();
app.whenReady().then(async () => {
  // last session's sign-ins back before any page loads (desktop/browse.js)
  await Browse.restore().then(n => n && console.log(`browse: ${n} session cookies restored`)).catch(e => console.warn('browse restore', e.message));
  // Serve the web files; anything outside the web folder is refused.
  useWeb();
  // vendor/ may come from its own folder (libraries update separately from the app's files).
  // Avatars and the MediaPipe models aren't in the app: they come down the first time they're asked for (desktop/updater.js).
  const serve = async req => {
    const { pathname } = new URL(req.url), rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const base = rel.startsWith('/vendor/') ? path.dirname(VENDOR) : WEB;
    let file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep)) return new Response('Not found', { status: 404 });
    if (app.isPackaged && Updates.isLazy(rel) && !fs.existsSync(file)) {
      try { file = await Updates.asset(rel); } catch (e) { console.warn('asset', e.message); return new Response('Not available offline yet', { status: 503 }); }
    }
    return net.fetch(pathToFileURL(file).toString());
  };
  protocol.handle(SCHEME, serve);
  serveWeb = serve; browseSession(BROWSE);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED.has(perm) && wc.getURL().startsWith(ORIGIN)));
  ses.setPermissionCheckHandler((wc, perm, origin) => ALLOWED.has(perm) && String(origin || wc?.getURL() || '').startsWith(ORIGIN));
  // YouTube's embedded player now requires a referrer, which pages served from app:// don't send: give it the app's web address.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] }, (d, cb) => {
    if (!d.requestHeaders.Referer) d.requestHeaders.Referer = 'https://vchahalibm.github.io/CarPWA/';
    cb({ requestHeaders: d.requestHeaders });
  });
  // Web-page and document widgets: many sites (SharePoint among them) refuse to be shown inside another app. In this app, which
  // shows only pages the user chose, let them show inside the widget. Only frames inside DriveDeck's own page are affected.
  ses.webRequest.onHeadersReceived((d, cb) => {
    if (d.resourceType !== 'subFrame' || !d.frame?.parent || !String(d.frame.parent.url || '').startsWith(ORIGIN)) return cb({});
    const h = {};
    for (const [k, v] of Object.entries(d.responseHeaders || {})) {
      if (k.toLowerCase() === 'x-frame-options') continue;
      h[k] = k.toLowerCase() === 'content-security-policy' ? v.map(x => x.replace(/frame-ancestors[^;]*;?/gi, '')) : v;
    }
    cb({ responseHeaders: h });
  });
  // The presenter view's live preview: the main window, without asking which window each time.
  ses.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['window'] }).then(list => cb({ video: list.find(x => mainWin && x.id === mainWin.getMediaSourceId()) || list[0] }), () => cb({}));
  });
  // Calls from the page (preload.js), only from the app's own pages.
  const own = f => (e, ...a) => String(e.senderFrame?.url || '').startsWith(ORIGIN) ? f(...a) : null;
  ipcMain.handle('dd:displays', own(displays));
  ipcMain.handle('dd:present', own(present));
  ipcMain.handle('dd:stop-presenting', own(stopPresenting));
  ipcMain.handle('dd:presenter', own(() => { openPresenter(); return true; }));
  ipcMain.handle('dd:login-item', own(loginItem));
  // Tasks on this computer (desktop/tasks.js): each piece of code needs the user's yes in a native dialog first.
  ipcMain.handle('dd:task-run', own(o => Tasks.run(o)));
  ipcMain.handle('dd:task-stop', own(id => Tasks.stop(id)));
  ipcMain.handle('dd:task-approvals', own(() => Tasks.approvals()));
  ipcMain.handle('dd:task-forget', own(h => Tasks.forget(h)));
  // Data (desktop/data.js): read-only SQLite queries, data files; each file needs the user's yes once.
  ipcMain.handle('dd:data-query', own(o => Data.query(o)));
  ipcMain.handle('dd:data-read', own(o => Data.read(o)));
  ipcMain.handle('dd:data-pick', own(o => Data.pick(o)));
  // Speech (desktop/speech.js): Apple's recognizer, which Electron lacks; the page wraps it as a Web Speech API recognizer.
  ipcMain.on('dd:speech-available', e => { e.returnValue = String(e.senderFrame?.url || '').startsWith(ORIGIN) && Speech.available() ? Speech.langs() : null; });
  ipcMain.handle('dd:speech-start', own(o => Speech.start(o)));
  ipcMain.handle('dd:speech-stop', own(() => Speech.stop()));
  ipcMain.handle('dd:speech-abort', own(() => Speech.abort()));
  // The on-device language model (desktop/ai.js), when this Mac has it (macOS 26+, Apple Intelligence on).
  ipcMain.on('dd:ai-available', e => { e.returnValue = String(e.senderFrame?.url || '').startsWith(ORIGIN) && AI.available(); });
  ipcMain.handle('dd:ai-status', own(() => AI.status()));
  ipcMain.handle('dd:ai-ask', own(o => AI.ask(o).catch(e => ({ error: e.message }))));
  // The link to DriveGen (desktop/link.js): status, sharing on the tailnet, pairing, revoking; and the page's answers.
  ipcMain.handle('dd:link-status', own(() => Link.status()));
  ipcMain.handle('dd:link-share', own(on => Link.share(on)));
  ipcMain.handle('dd:link-pair', own(() => Link.pair()));
  ipcMain.handle('dd:link-revoke', own(id => Link.revoke(id)));
  ipcMain.handle('dd:link-reply', own(({ id, result, error }) => { const w = linkWaits.get(id); if (!w) return; clearTimeout(w.t); linkWaits.delete(id); error ? w.rej(new Error(error)) : w.res(result); }));
  Link.start();
  // Script steps (js/appsteps.js): real mouse and keyboard input in the app's own window, as a person would, so anything on
  // screen reacts (canvases, maps, web widgets). Only the app's own page can ask, and only for its own window.
  const INPUT = new Set(['mouseMove', 'mouseDown', 'mouseUp', 'mouseWheel', 'keyDown', 'keyUp', 'char']);
  ipcMain.handle('dd:input', (e, evs) => {
    if (!String(e.senderFrame?.url || '').startsWith(ORIGIN)) return false;
    for (const ev of [].concat(evs || [])) if (ev && INPUT.has(ev.type)) e.sender.sendInputEvent(ev);
    return true;
  });
  // A picture of the window that asks (script steps that find an area of the screen by its picture).
  ipcMain.handle('dd:capture', async e => String(e.senderFrame?.url || '').startsWith(ORIGIN) ? (await e.sender.capturePage()).toDataURL() : null);
  ipcMain.handle('dd:insert-text', (e, text) => String(e.senderFrame?.url || '').startsWith(ORIGIN) ? e.sender.insertText(String(text || '')).then(() => true) : false);
  ipcMain.handle('dd:bridge-src', () => readBridge());
  ipcMain.handle('dd:browser-forget', own(p => Browse.forget(p)));
  // This computer's memory and chip (the language model's startup check, js/llm.js)
  ipcMain.on('dd:sys', e => { const os = require('os'); e.returnValue = String(e.senderFrame?.url || '').startsWith(ORIGIN) ? { memory: os.totalmem(), chip: os.cpus()[0]?.model || '', cpus: os.cpus().length } : null; });
  // Permissions (js/perms.js): macOS asks only once; a “no” (often by mistake) is reset for this app and asked again
  const PERM = { mic: ['microphone', 'Microphone', 'Privacy_Microphone'], camera: ['camera', 'Camera', 'Privacy_Camera'], speech: [null, 'SpeechRecognition', 'Privacy_SpeechRecognition'] };
  const bundleId = () => app.isPackaged ? 'io.github.vchahalibm.studiogen' : 'com.github.Electron';
  ipcMain.handle('dd:perm', own(async (op, kind) => {
    const p = PERM[kind]; if (!p || process.platform !== 'darwin') return null;
    if (op === 'status') return p[0] ? systemPreferences.getMediaAccessStatus(p[0]) : 'unknown'; // not-determined | granted | denied | restricted
    if (op === 'reset') return new Promise(res => require('child_process').execFile('/usr/bin/tccutil', ['reset', p[1], bundleId()], e => res(!e)));
    if (op === 'ask') return p[0] ? systemPreferences.askForMediaAccess(p[0]) : true; // speech: asked by the helper when it next starts
    if (op === 'open') { shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${p[2]}`); return true; }
    return null;
  }));
  // The built-in language model (desktop/llm.js): status, chat, download, use, remove
  ipcMain.handle('dd:llm', own((op, a) => ({ status: () => Builtin.status(), chat: () => Builtin.chat(a).catch(e => ({ error: e.message })), download: () => Builtin.download(a).then(() => true, e => ({ error: e.message })), use: () => { try { return Builtin.use(a || {}); } catch (e) { return { error: e.message }; } }, remove: () => Builtin.remove(a), unload: () => Builtin.unload() })[op]?.() ?? null));
  // Light Workers (js/workers.js): create, start, stop, show, remove; only from StudioGen's own page
  ipcMain.handle('dd:light', own((op, a) => ({ list: () => LightWorkers.list(), create: () => LightWorkers.create(a || {}), start: () => LightWorkers.start(a), stop: () => LightWorkers.stop(a), show: () => LightWorkers.show(a), remove: () => LightWorkers.remove(a?.id, a?.data) })[op]?.() ?? null));
  // A Worker's settings for the page (once at start): its name, the invite to join, the model to use for cards
  ipcMain.on('dd:worker', e => { e.returnValue = WORKER && String(e.senderFrame?.url || '').startsWith(ORIGIN) ? { light: LIGHT, name: process.env.SG_NAME || 'StudioGen Worker', invite: process.env.SG_MESH_INVITE || '', practice: process.env.SG_PRACTICE === '1',
    llm: process.env.SG_LLM_PROVIDER ? { provider: process.env.SG_LLM_PROVIDER, url: process.env.SG_LLM_URL || '', model: process.env.SG_LLM_MODEL || '', key: process.env.SG_LLM_KEY || '' } : null } : null; });
  // Updates (desktop/updater.js): state, check now, and apply (web: reload on the new files; shell: install and restart).
  ipcMain.handle('dd:update-status', own(() => Updates.status()));
  ipcMain.handle('dd:update-check', own(() => Updates.check(true)));
  ipcMain.handle('dd:update-apply', own(kind => {
    if (kind === 'shell') { if (!Updates.installShell(true)) return false; app.quit(); return true; }
    // A real restart: the new files from the start, and nothing left over from before.
    Updates.applied(); app.relaunch(); app.quit(); return true;
  }));
  Updates.on(s => { for (const w of [mainWin, presWin]) w?.webContents.send('dd:update', s); }); // for webview-preload.js; a public file of the app
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
  if (!WORKER) makeTray(); else if (LIGHT) app.dock?.hide();
  if (LIGHT) process.on('SIGUSR2', () => { if (!mainWin) return; if (mainWin.isVisible()) mainWin.hide(); else { mainWin.show(); mainWin.focus(); } }); // StudioGen › Workers › Show its window
  if (!WORKER) LightWorkers.resume();
  // Started at login: just the menu bar until you open it.
  createWindow({ show: WORKER ? !LIGHT : !app.getLoginItemSettings().wasOpenedAtLogin });
  app.on('activate', showMain);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Quitting (also for an update): the browsers' session cookies saved first, at most 3 s (desktop/browse.js)
let browseSaved = false;
app.on('before-quit', e => {
  if (browseSaved) return; e.preventDefault();
  Promise.race([Browse.save(), new Promise(r => setTimeout(r, 3000))]).catch(err => console.warn('browse save', err.message)).finally(() => { browseSaved = true; app.quit(); });
});
// A downloaded new version of the app installs when you quit (and opens next time you start it).
app.on('will-quit', () => { Speech.quit(); AI.quit(); Builtin.unload(); LightWorkers.stopAll(); Updates.installShell(false); });
