'use strict';
/* DriveDeck desktop: the same web app in an Electron window.
   The web files (index.html, js/, css/, vendor/, icons/…) are served from a private, secure origin
   (app://drivedeck/), so everything that needs one works as on the web: the microphone, WebGPU, workers, the
   service worker and model caching. Nothing in the web app changes for the desktop; it notices Electron from
   its user agent (bigger memory budget, Whisper for listening). */
const { app, BrowserWindow, protocol, net, shell, session, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'app', HOST = 'drivedeck', ORIGIN = `${SCHEME}://${HOST}`;
// Packaged: the web files are copied into Resources/web. From source: the repo root, one level up.
const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true, stream: true, codeCache: true } }]);

// Permissions the app asks for: microphone and camera (voice, later object detection), location, wake lock, notifications.
const ALLOWED = new Set(['media', 'geolocation', 'notifications', 'screen-wake-lock', 'fullscreen', 'clipboard-sanitized-write']);

let lastExternal = 0; // when another app last opened, to skip the web fallback the page opens if it seems nothing happened

function openOutside(url) {
  shell.openExternal(url).then(() => { lastExternal = Date.now(); }, e => console.warn('No app for', url, e.message));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500, backgroundColor: '#000000', title: 'DriveDeck',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // Links to other apps (music, maps, phone, messages, shortcuts) and web pages open outside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: 'allow' };
    if (/^https?:/.test(url) && Date.now() - lastExternal < 2500) return { action: 'deny' }; // the app already opened
    openOutside(url); return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); openOutside(url); } });
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

app.whenReady().then(() => {
  // Serve the web files; anything outside the web folder is refused.
  protocol.handle(SCHEME, req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(WEB + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
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
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
