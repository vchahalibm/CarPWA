'use strict';
/* Runs in every page of a browser widget, in an isolated world: the page can't see or call it. It loads the app's
   recorder/player (bridge/drivedeck-bridge.js, the same code as for iframes) and answers the DriveDeck page that shows this
   widget: record clicks and typing (never password, payment or one-time-code fields), find elements, replay steps. */
const { ipcRenderer } = require('electron');
const send = m => ipcRenderer.sendToHost('dd-bridge', m);
const lib = ipcRenderer.invoke('dd:bridge-src').then(src => { window.DriveDeckBridgeNoAuto = true; new Function(src)(); });
const dom = new Promise(r => document.readyState === 'loading' ? addEventListener('DOMContentLoaded', r, { once: true }) : r());
let b = null;
ipcRenderer.on('dd-drive', async (e, m) => {
  let r;
  try { await lib; await dom; b ||= window.DriveDeckBridge.create(document, window, send); r = await b[m.op](...(m.args || [])); }
  catch (err) { r = { ok: false, error: String(err && err.message || err) }; }
  send({ id: m.id, ...r });
});
dom.then(() => send({ type: 'ready', url: location.href }));
