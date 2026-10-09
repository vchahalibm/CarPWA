'use strict';
/* DriveDeck desktop: the same web app in an Electron window.
   The web files (index.html, js/, css/, vendor/, icons/…) are served from a private, secure origin
   (app://drivedeck/), so everything that needs one works as on the web: the microphone, WebGPU, workers, the
   service worker and model caching. Nothing in the web app changes for the desktop; it notices Electron from
   its user agent (bigger memory budget, Whisper for listening).
   It also lives in the menu bar (Tray): open it, present on another screen (the wall) with the presenter view on this
   one, start at login. The page reaches these through preload.js (window.DriveDeckDesktop). */
const { app, BrowserWindow, protocol, net, shell, session, Menu, Tray, nativeImage, screen, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'app', HOST = 'drivedeck', ORIGIN = `${SCHEME}://${HOST}`;
// Packaged: the web files are copied into Resources/web. From source: the repo root, one level up.
const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..');

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
const fs = require('fs');

/* ---------- Browser widgets: <webview> in the page, a real browser per web widget ----------
   Any site, logins kept (the 'persist:browse' session, apart from the app's own). Each page gets webview-preload.js in an
   isolated world (the page can't see or reach it): the recorder/player from bridge/drivedeck-bridge.js, so clicks can be
   recorded and replayed on any site. The page itself never gets Node or the app's powers. */
const BROWSE = 'persist:browse';
function guestRules(contents) {
  contents.on('will-attach-webview', (e, wp, params) => {
    if (!/^https?:\/\//.test(params.src || '') && !String(params.src || '').startsWith(ORIGIN) && params.src !== 'about:blank') { e.preventDefault(); return; }
    delete wp.preloadURL; Object.assign(wp, { preload: path.join(__dirname, 'webview-preload.js'), nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
    params.partition = BROWSE; // its own session (logins kept), apart from the app's; it serves the app's pages too (samples)
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
    width: 1280, height: 800, minWidth: 800, minHeight: 500, backgroundColor: '#000000', title: 'DriveDeck', show,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', webPreferences: webPrefs,
  });
  guard(win); guestRules(win.webContents);
  win.on('closed', () => { if (mainWin === win) mainWin = null; presenting = false; presWin?.close(); menu(); });
  win.on('leave-full-screen', () => { if (presenting) { presenting = false; menu(); } });
  // Esc on the wall stops presenting (the presenter view stays open).
  win.webContents.on('before-input-event', (e, i) => { if (presenting && i.type === 'keyDown' && i.key === 'Escape') { presenting = false; win.setFullScreen(false); menu(); } });
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
    minWidth: 640, minHeight: 420, backgroundColor: '#000000', title: 'DriveDeck · Presenter', webPreferences: webPrefs });
  guard(presWin);
  presWin.on('closed', () => { presWin = null; menu(); });
  presWin.loadURL(`${ORIGIN}/presenter.html`);
  menu(); return presWin;
}
/** DriveDeck full screen on display `id` (the wall); the presenter view on another screen when there is one. */
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
    { label: 'Open DriveDeck', click: showMain },
    { type: 'separator' },
    { label: 'Present on', submenu: ds.map(d => ({ label: `${d.label} (${d.w}×${d.h})${d.primary ? ' · main screen' : ''}`, click: () => present(d.id) })) },
    { label: 'Presenter view', click: () => { showMain(); openPresenter(); } },
    { label: 'Stop presenting', enabled: presenting || !!presWin, click: stopPresenting },
    { type: 'separator' },
    { label: 'Settings…', click: () => showMain().webContents.send('dd:menu', 'settings') },
    { label: 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => loginItem(i.checked) },
    { type: 'separator' },
    { label: 'Quit DriveDeck', role: 'quit' },
  ]));
}
function makeTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img); tray.setToolTip('DriveDeck');
  menu();
  screen.on('display-added', menu); screen.on('display-removed', menu);
}

app.whenReady().then(() => {
  // Serve the web files; anything outside the web folder is refused.
  const serve = req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(WEB + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  };
  protocol.handle(SCHEME, serve);
  session.fromPartition(BROWSE).protocol.handle(SCHEME, serve); // the app's own pages (samples/demo-page.html) in browser widgets
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
  ipcMain.handle('dd:bridge-src', () => readBridge()); // for webview-preload.js; a public file of the app
  // The browsing session: no camera, microphone, location or notifications for web pages in widgets.
  const browse = session.fromPartition(BROWSE);
  browse.setPermissionRequestHandler((wc, perm, cb) => cb(['fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  browse.setPermissionCheckHandler((wc, perm) => ['fullscreen', 'clipboard-sanitized-write'].includes(perm));
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
  makeTray();
  // Started at login: just the menu bar until you open it.
  createWindow({ show: !app.getLoginItemSettings().wasOpenedAtLogin });
  app.on('activate', showMain);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
