'use strict';
/* ============================================================
   Debug log. Loaded first, so it sees everything from boot.
   Off for ordinary users: nothing is recorded and the Logs tab is hidden.
   Turn it on with ?debug=<key> in the URL, or, inside the installed app,
   tap the version row in Settings 7 times and enter the key. ?debug=off
   turns it off. Only a SHA-256 of the key is kept here. This keeps the
   tab away from ordinary users; it isn't security (the logs never leave
   the device unless you share them).
   ============================================================ */
const DEBUG_KEY_SHA256 = '248e61e1904edf1421dfa3905d12511a46dd3b0878f5be978b01bbb4c3e839eb';
const Log = (() => {
  const FLAG = 'dd.debug', BUF = 'dd.logbuf', MAX = 2500, t0 = performance.now();
  let on = false, items = [], seq = 0, saveT = 0;
  const subs = new Set();
  try { on = JSON.parse(localStorage.getItem(FLAG)) === true; } catch {}
  if (on) try { items = JSON.parse(localStorage.getItem(BUF)) || []; seq = items.length ? items[items.length - 1].n + 1 : 0; } catch { items = []; }

  const SECRET = /key|token|secret|password|auth/i;
  const redactUrl = u => String(u).replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&#]*/gi, '$1…');
  /** A short, safe copy of any value for the log: secrets hidden, long text cut, deep objects flattened. */
  function brief(v, depth = 0) {
    if (v == null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v === 'string') return redactUrl(v.length > 300 ? v.slice(0, 300) + '…' : v);
    if (typeof v === 'function') return `ƒ ${v.name || ''}`;
    if (v instanceof Error || (v && v.name && v.message !== undefined && v.stack !== undefined))
      return { error: v.name, message: String(v.message).slice(0, 300), stack: String(v.stack || '').split('\n').slice(0, 4).join(' | ') };
    if (typeof DOMException !== 'undefined' && v instanceof DOMException) return { error: v.name, message: v.message };
    if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length})`;
    if (typeof Event !== 'undefined' && v instanceof Event) return { event: v.type, target: v.target?.tagName || v.target?.constructor?.name };
    if (depth > 2) return Array.isArray(v) ? `[${v.length}]` : '{…}';
    if (Array.isArray(v)) return v.slice(0, 12).map(x => brief(x, depth + 1)).concat(v.length > 12 ? [`…+${v.length - 12}`] : []);
    const o = {}; let n = 0;
    for (const k in v) { if (n++ > 16) { o['…'] = 'more'; break; } try { o[k] = SECRET.test(k) ? (v[k] ? '(hidden)' : v[k]) : brief(v[k], depth + 1); } catch {} }
    return o;
  }
  function save() {
    if (saveT) return;
    saveT = setTimeout(() => { saveT = 0; try { localStorage.setItem(BUF, JSON.stringify(items)); } catch { items.splice(0, items.length >> 1); } }, 1500);
  }
  function add(lvl, cat, msg, data) {
    if (!on) return;
    const e = { n: seq++, at: Date.now(), ms: Math.round(performance.now() - t0), lvl, cat, msg: String(msg).slice(0, 400) };
    if (data !== undefined) try { e.data = brief(data); } catch { e.data = '(unloggable)'; }
    items.push(e); if (items.length > MAX) items.splice(0, items.length - MAX);
    save(); subs.forEach(f => { try { f(e); } catch {} });
  }
  const fmt = e => {
    const d = new Date(e.at), ts = d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    return `${ts} ${e.lvl.toUpperCase().padEnd(5)} [${e.cat}] ${e.msg}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}`;
  };
  /** Everything worth knowing about this device when chasing a bug. */
  function env() {
    const nav = navigator, a = window.AudioContext || window.webkitAudioContext;
    return {
      ua: nav.userAgent, lang: nav.language, standalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, viewport: `${innerWidth}x${innerHeight}`, online: nav.onLine,
      memoryGB: nav.deviceMemory, cores: nav.hardwareConcurrency, crossOriginIsolated: self.crossOriginIsolated,
      sw: !!nav.serviceWorker?.controller, audioSession: nav.audioSession ? nav.audioSession.type : 'unsupported',
      audioWorklet: !!(a && a.prototype && 'audioWorklet' in a.prototype), speechSynthesis: 'speechSynthesis' in window,
      speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition), mic: !!nav.mediaDevices?.getUserMedia,
      wakeLock: 'wakeLock' in nav, share: !!nav.share, storageKB: Math.round(JSON.stringify(localStorage).length / 1024),
    };
  }
  async function sha256(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const api = {
    get on() { return on; }, items, MAX,
    i: (cat, msg, data) => add('info', cat, msg, data),
    d: (cat, msg, data) => add('debug', cat, msg, data),
    w: (cat, msg, data) => add('warn', cat, msg, data),
    e: (cat, msg, data) => add('error', cat, msg, data),
    sub(f) { subs.add(f); return () => subs.delete(f); },
    fmt, env, brief,
    text(list = items) { return list.map(fmt).join('\n'); },
    clear() { items.length = 0; try { localStorage.removeItem(BUF); } catch {} add('info', 'log', 'Log cleared'); },
    /** Turn debug mode on if the key matches. Resolves true/false. */
    async unlock(key) {
      if (!key || !crypto?.subtle) return false;
      if (await sha256(String(key).trim()) !== DEBUG_KEY_SHA256) return false;
      on = true; try { localStorage.setItem(FLAG, 'true'); } catch {}
      add('info', 'log', '── Debug mode on ──', env());
      return true;
    },
    disable() { add('info', 'log', 'Debug mode off'); on = false; items.length = 0; try { localStorage.removeItem(FLAG); localStorage.removeItem(BUF); } catch {} },
    /** Time an async step: Log.time('tts', 'generate', promise). */
    time(cat, what, p, data) {
      if (!on) return p;
      const s = performance.now(); add('debug', cat, `${what} …`, data);
      return Promise.resolve(p).then(v => { add('info', cat, `${what} ✓ ${Math.round(performance.now() - s)} ms`); return v; },
        e => { add('error', cat, `${what} ✗ ${Math.round(performance.now() - s)} ms`, e); throw e; });
    },
  };

  /* ---------- Global capture: errors, console, network, lifecycle ---------- */
  addEventListener('error', e => add('error', 'js', e.message || 'Error', e.error || { file: e.filename, line: e.lineno, col: e.colno }));
  addEventListener('unhandledrejection', e => add('error', 'js', 'Unhandled promise rejection', e.reason));
  for (const [m, lvl] of [['warn', 'warn'], ['error', 'error']]) {
    const orig = console[m].bind(console);
    console[m] = (...a) => { add(lvl, 'console', a.map(x => typeof x === 'string' ? x : '').join(' ').trim() || m, a.find(x => typeof x !== 'string')); orig(...a); };
  }
  const f0 = window.fetch?.bind(window);
  if (f0) window.fetch = function (input, init) {
    if (!on) return f0(input, init);
    const url = redactUrl(typeof input === 'string' ? input : input?.url || String(input)), s = performance.now(), method = init?.method || input?.method || 'GET';
    const short = url.length > 160 ? url.slice(0, 160) + '…' : url;
    return f0(input, init).then(r => {
      add(r.ok ? 'debug' : 'warn', 'net', `${method} ${r.status} ${Math.round(performance.now() - s)} ms ${short}`, { size: r.headers.get('content-length'), type: r.headers.get('content-type') });
      return r;
    }, e => { add('error', 'net', `${method} failed ${Math.round(performance.now() - s)} ms ${short}`, e); throw e; });
  };
  document.addEventListener('visibilitychange', () => add('info', 'app', `Page ${document.visibilityState}`));
  addEventListener('pageshow', e => add('info', 'app', 'pageshow', { restoredFromCache: e.persisted }));
  addEventListener('pagehide', () => { add('info', 'app', 'pagehide'); try { localStorage.setItem(BUF, JSON.stringify(items)); } catch {} });
  addEventListener('online', () => add('info', 'net', 'Online'));
  addEventListener('offline', () => add('warn', 'net', 'Offline'));
  addEventListener('resize', (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => add('debug', 'ui', `Resize ${innerWidth}x${innerHeight}`), 400); }; })());
  // Every tap on something actionable, by what it does.
  document.addEventListener('click', e => {
    if (!on) return;
    const t = e.target.closest?.('button,[data-action],[data-app],[data-open],[data-dash],[data-cmd],[data-set],[data-toggle],a'); if (!t) return;
    const ds = Object.entries(t.dataset || {}).map(([k, v]) => `${k}=${v}`).join(' ');
    add('debug', 'tap', ds || (t.getAttribute('aria-label') || t.textContent || t.tagName).trim().slice(0, 60));
  }, true);
  navigator.serviceWorker?.addEventListener?.('controllerchange', () => add('info', 'sw', 'New service worker took control'));

  /* ---------- Turning it on from the URL ---------- */
  const q = new URLSearchParams(location.search).get('debug');
  if (q === 'off') api.disable();
  else if (q) api.unlock(q).then(ok => {
    if (!ok) return console.warn('Debug key not accepted');
    if (typeof current !== 'undefined' && current === 'settings' && typeof renderSettings === 'function') renderSettings();
  });
  if (on) add('info', 'app', '── DriveDeck started ──', env());
  return api;
})();
