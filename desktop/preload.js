'use strict';
/* What the desktop app (StudioGen) adds for the web page, as window.DriveDeckDesktop. The web files only use it behind a
   feature check (`window.DriveDeckDesktop?.…`), so they stay the same as on the web. Sandboxed: only these calls. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DriveDeckDesktop', {
  version: 1,
  /** StudioGen Worker (in a container): { name, invite, practice, llm } from its environment, else null (desktop/main.js). */
  worker: ipcRenderer.sendSync('dd:worker'),
  /** The language model built into StudioGen (desktop/llm.js): status(); chat({ system, prompt|messages, schema, max, temperature, effort })
      → { text } or { error }; download(id) (progress: onProgress(f) with { id, done, total, ok }); use({ id, ollama }); remove(id). */
  llm: {
    status: () => ipcRenderer.invoke('dd:llm', 'status'),
    chat: o => ipcRenderer.invoke('dd:llm', 'chat', o),
    download: id => ipcRenderer.invoke('dd:llm', 'download', id),
    use: o => ipcRenderer.invoke('dd:llm', 'use', o),
    remove: id => ipcRenderer.invoke('dd:llm', 'remove', id),
    onProgress: f => { const h = (e, p) => f(p); ipcRenderer.on('dd:llm-progress', h); return () => ipcRenderer.removeListener('dd:llm-progress', h); },
  },
  /** Light Workers (desktop/main.js LightWorkers): op 'list' | 'create' {id,name,invite,llm} | 'start' id | 'stop' id | 'show' id | 'remove' {id,data}. */
  light: (op, a) => ipcRenderer.invoke('dd:light', op, a),
  /** This computer: { memory (bytes), chip, cpus }. */
  sys: ipcRenderer.sendSync('dd:sys'),
  /** Web widgets are real browsers here (<webview>, see webview-preload.js). */
  browser: {
    /** Sign out of everything in one container of the browsers ('persist:browse' or 'persist:c-<id>'). */
    forget: p => ipcRenderer.invoke('dd:browser-forget', p),
  },
  /** The screens attached: [{ id, label, primary, here, w, h }] (`here`: the one the main window is on). */
  displays: () => ipcRenderer.invoke('dd:displays'),
  /** Show DriveDeck full screen on a screen (the wall), and the presenter view on another one if there is one. */
  present: id => ipcRenderer.invoke('dd:present', id),
  /** Back to a normal window; closes the presenter view. */
  stopPresenting: () => ipcRenderer.invoke('dd:stop-presenting'),
  /** Open (or bring forward) the presenter view, on another screen when there is one. */
  presenter: () => ipcRenderer.invoke('dd:presenter'),
  /** Start DriveDeck when you log in (in the menu bar). */
  loginItem: on => ipcRenderer.invoke('dd:login-item', on),
  /** Real input in this window (script steps): mouse and key events as Electron's sendInputEvent takes them. */
  input: evs => ipcRenderer.invoke('dd:input', evs),
  /** A picture of this window (PNG data URL), for finding a captured area of the screen again. */
  capture: () => ipcRenderer.invoke('dd:capture'),
  /** Type text into whatever has the focus, as the keyboard would. */
  insertText: text => ipcRenderer.invoke('dd:insert-text', text),
  /** Updates: { shell, serving, latest, webReady, shellReady, canSwap, phase, error } (see desktop/updater.js). */
  updates: {
    status: () => ipcRenderer.invoke('dd:update-status'),
    check: () => ipcRenderer.invoke('dd:update-check'),
    /** 'web': reload on the downloaded files; 'shell': install the new app and restart. */
    apply: kind => ipcRenderer.invoke('dd:update-apply', kind),
    on: f => ipcRenderer.on('dd:update', (e, s) => f(s)),
  },
  /** Tasks on this computer for scripts (desktop/tasks.js): { id, kind: applescript | jxa | shortcut | shell, code, args, label, timeout }
      → { ok, out, err, code, ms }. The user approves each piece of code first (a native dialog). */
  tasks: {
    run: o => ipcRenderer.invoke('dd:task-run', o),
    stop: id => ipcRenderer.invoke('dd:task-stop', id),
    approvals: () => ipcRenderer.invoke('dd:task-approvals'),
    forget: h => ipcRenderer.invoke('dd:task-forget', h),
  },
  /** Data for the data widget (desktop/data.js): query({ file, sql, params }) → { ok, columns, rows, total } read-only SQLite;
      read({ file }) → { ok, text } a CSV/JSON file; pick({ kind: 'db' | 'text' }) → a path the user chose. */
  data: {
    query: o => ipcRenderer.invoke('dd:data-query', o),
    read: o => ipcRenderer.invoke('dd:data-read', o),
    pick: o => ipcRenderer.invoke('dd:data-pick', o),
  },
  /** Apple's speech recognizer (desktop/speech.js), when this build has it: start({ lang, continuous, onDevice, context, pause }),
      stop() (finish what was heard), abort(); on(f): f({ ev: 'ready'|'start'|'result'|'error'|'end', … }). js/voice.js wraps it
      as a Web Speech API recognizer. local: languages it recognises on this Mac; server: only through Apple's servers. */
  speech: (langs => langs ? {
    local: langs.local, server: langs.server,
    start: o => ipcRenderer.invoke('dd:speech-start', o),
    stop: () => ipcRenderer.invoke('dd:speech-stop'),
    abort: () => ipcRenderer.invoke('dd:speech-abort'),
    on: f => { const h = (e, m) => f(m); ipcRenderer.on('dd:speech', h); return () => ipcRenderer.removeListener('dd:speech', h); },
  } : null)(ipcRenderer.sendSync('dd:speech-available')),
  /** Apple's on-device language model (desktop/ai.js): status() → { available, reason }; ask({ instructions, prompt,
      schema, temperature, max }) → { text } or, with a JSON schema, { json } (a string), or { error }. */
  ai: ipcRenderer.sendSync('dd:ai-available') ? { status: () => ipcRenderer.invoke('dd:ai-status'), ask: o => ipcRenderer.invoke('dd:ai-ask', o) } : null,
  /** The link to DriveGen (desktop/link.js): status() → { listening, tailscale, signedIn, url, sharing, devices, pairing },
      share(on) on the tailnet, pair() → { code, until }, revoke(id); onAsk(f): f(kind, payload) answers DriveGen's requests
      ('offers', 'run', 'say', 'paired'). */
  link: {
    status: () => ipcRenderer.invoke('dd:link-status'),
    share: on => ipcRenderer.invoke('dd:link-share', on),
    pair: () => ipcRenderer.invoke('dd:link-pair'),
    revoke: id => ipcRenderer.invoke('dd:link-revoke', id),
    onAsk: f => ipcRenderer.on('dd:link-ask', async (e, m) => {
      try { ipcRenderer.invoke('dd:link-reply', { id: m.id, result: await f(m.kind, m.payload) }); }
      catch (err) { ipcRenderer.invoke('dd:link-reply', { id: m.id, error: err?.message || String(err) }); }
    }),
  },
  /** The menu bar asks the page for something (e.g. 'settings'). */
  onMenu: f => ipcRenderer.on('dd:menu', (e, what) => f(what)),
});
