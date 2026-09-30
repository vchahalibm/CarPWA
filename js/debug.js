'use strict';
/* ============================================================
   Debug mode (see js/log.js): records what the app does, and the
   Settings › Logs tab with diagnostics. Loaded last. Nothing here
   runs for ordinary users beyond cheap "is debug on?" checks.
   ============================================================ */

/* ---------- Record what the app does ---------- */
(() => {
  /** Wrap a function so each call (and its result or failure) is logged. Calls made through the global name are covered. */
  const wrap = (owner, name, cat, args = a => undefined, result) => {
    const f = owner[name]; if (typeof f !== 'function' || f.logged) return;
    const w = function (...a) {
      if (!Log.on) return f.apply(this, a);
      let info; try { info = args(a); } catch {}
      Log.i(cat, `${name}`, info);
      let r; try { r = f.apply(this, a); } catch (e) { Log.e(cat, `${name} threw`, e); throw e; }
      if (r && typeof r.then === 'function') r.then(v => result && Log.i(cat, `${name} →`, result(v)), e => Log.e(cat, `${name} failed`, e));
      else if (result) try { Log.d(cat, `${name} →`, result(r)); } catch {}
      return r;
    };
    w.logged = true; owner[name] = w;
  };
  const place = d => d && { name: d.name, lat: +(+d.lat).toFixed(5), lon: +(+d.lon).toFixed(5) };
  const G = window;
  // Screens, modes, dialogs
  wrap(G, 'openView', 'ui', a => ({ view: a[0] }));
  wrap(G, 'openApp', 'ui', a => ({ app: a[0] }));
  wrap(G, 'setMode', 'ui', a => ({ mode: a[0] }));
  wrap(G, 'sheet', 'ui', a => ({ title: a[0], buttons: (a[2] || []).map(b => b[0]) }));
  wrap(G, 'toast', 'ui', a => ({ text: a[0] }));
  wrap(G, 'notify', 'ui', a => ({ app: a[0]?.app, title: a[0]?.title }));
  wrap(G, 'showUpdate', 'sw', () => ({ note: 'Update available' }));
  // Location & navigation
  wrap(G, 'startGPS', 'gps', a => ({ quiet: !!a[0] }));
  wrap(G, 'stopGPS', 'gps');
  wrap(G, 'startDemo', 'gps');
  wrap(G, 'stopDemo', 'gps');
  wrap(G, 'onPositionError', 'gps', a => ({ code: a[0]?.code, message: a[0]?.message }));
  let lastFix = 0;
  const onPos = G.onPosition;
  if (typeof onPos === 'function') G.onPosition = function (p) {
    if (Log.on && (!lastFix || Date.now() - lastFix > 15000)) {
      Log.d('gps', lastFix ? 'Position' : 'First position', { lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5),
        accuracyM: Math.round(p.coords.accuracy), speed: p.coords.speed, heading: p.coords.heading });
      lastFix = Date.now();
    }
    return onPos.apply(this, arguments);
  };
  wrap(G, 'recenterAll', 'nav');
  wrap(G, 'startNav', 'nav', a => place(a[0]), () => nav && { provider: nav.route?.provider, km: +(nav.route?.cum?.at(-1) / 1000).toFixed(1), min: Math.round(nav.route?.tcum?.at(-1) / 60), steps: nav.route?.steps?.length });
  wrap(G, 'endNav', 'nav');
  wrap(G, 'reroute', 'nav', a => ({ quiet: !!a[0] }));
  wrap(G, 'arrive', 'nav');
  if (typeof Routing !== 'undefined') {
    wrap(Routing, 'route', 'route', a => ({ from: place(a[0]), to: place(a[1]), router: settings.router }),
      r => r && { provider: r.provider, km: +(r.cum?.at(-1) / 1000).toFixed(1), min: Math.round(r.tcum?.at(-1) / 60), steps: r.steps?.length, approx: r.provider === 'approx' });
    wrap(Routing, 'search', 'route', a => ({ q: a[0] }), r => ({ results: r?.length, first: r?.[0]?.name }));
  }
  wrap(G, 'loadWeather', 'app');
  // Hand-offs to the phone's apps
  wrap(G, 'openExternal', 'handoff', a => ({ link: a[0], fallback: a[1] }));
  wrap(G, 'openCall', 'handoff', a => ({ name: a[0]?.n, sample: !!a[0]?.sample, hasNumber: !!a[0]?.num }));
  wrap(G, 'textContact', 'handoff', a => ({ name: a[0]?.n, body: a[1] }));
  wrap(G, 'whatsappContact', 'handoff', a => ({ name: a[0]?.n, body: a[1] }));
  wrap(G, 'playInMusicApp', 'handoff', a => ({ q: a[0], app: a[1] || settings.musicApp }));
  wrap(G, 'openInMaps', 'handoff', a => ({ app: a[0], dest: place(a[1] || nav?.dest) }));
  wrap(G, 'openLink', 'handoff', a => ({ app: a[0], q: a[1], url: a[2] }));
  wrap(G, 'runShortcut', 'handoff', a => ({ name: a[0], text: a[1] }));
  // Media & dashboard
  wrap(G, 'playerAction', 'media', a => ({ action: a[0] }));
  wrap(G, 'setSource', 'media', a => ({ source: a[0] }));
  wrap(G, 'playTrack', 'media', a => ({ index: a[0] }));
  if (typeof Dash !== 'undefined') wrap(Dash, 'cmd', 'dash', a => ({ cmd: a[0] }));
  // Commands: what was matched, how, and with which words
  if (typeof Commands !== 'undefined') {
    const match = Commands.match.bind(Commands);
    Commands.match = text => {
      const r = match(text);
      if (Log.on) r.cmd ? Log.i('cmd', `“${text}” → ${r.cmd.id}`, { how: r.how, score: r.score, action: r.cmd.do, vars: r.vars, fixed: r.fixed })
        : Log.w('cmd', `“${text}” matched no command`, { normalised: r.text });
      return r;
    };
  }
  // Settings: log exactly what changed
  let before = JSON.stringify(settings);
  const apply = G.applySettings;
  G.applySettings = function () {
    const r = apply.apply(this, arguments), now = JSON.stringify(settings);
    if (Log.on && now !== before) {
      const a = JSON.parse(before), b = settings, diff = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diff[k] = [a[k], b[k]];
      Log.i('settings', 'Changed', diff);
    }
    before = now; return r;
  };
  // Service worker lifecycle
  navigator.serviceWorker?.getRegistration?.().then(reg => {
    if (!reg || !Log.on) return;
    Log.d('sw', 'Service worker', { active: reg.active?.state, waiting: !!reg.waiting, installing: !!reg.installing });
    reg.addEventListener('updatefound', () => Log.i('sw', 'Downloading an update'));
  }).catch(() => {});
  caches?.keys?.().then(k => Log.d('sw', 'Caches', k.filter(n => n.startsWith('dd-')))).catch(() => {});
  if (Log.on) Log.i('app', 'Ready', { view: current, settings: { stt: settings.stt, tts: settings.tts, ttsVoice: settings.ttsVoice, musicApp: settings.musicApp, router: settings.router, vadSilence: settings.vadSilence }, reply: Diag.get() });
})();

/* ---------- Settings › Logs ---------- */
const LOG_FILTERS = [['all', 'All'], ['problems', 'Problems'], ['voice', 'Voice'], ['cmd', 'Commands'], ['nav', 'Navigation'], ['net', 'Network'], ['app', 'App']];
const LOG_CATS = { voice: ['voice', 'stt', 'tts', 'audio', 'mic', 'reply', 'model', 'diag'], cmd: ['cmd', 'handoff'], nav: ['nav', 'route', 'gps'],
  net: ['net', 'sw'], app: ['app', 'ui', 'tap', 'settings', 'dash', 'media', 'js', 'console', 'log'] };
const DebugUI = {
  tab: 'main', filter: 'all', q: '', paused: false, unsub: null, taps: [],
  tabs() {
    return `<div class="set-tabs"><div class="seg"><button class="${this.tab === 'main' ? 'on' : ''}" data-dbg="tab:main">Settings</button>
      <button class="${this.tab === 'logs' ? 'on' : ''}" data-dbg="tab:logs">Logs</button></div></div>`;
  },
  shown(e) {
    if (this.filter === 'problems') { if (e.lvl !== 'warn' && e.lvl !== 'error') return false; }
    else if (this.filter !== 'all' && !LOG_CATS[this.filter].includes(e.cat)) return false;
    return !this.q || Log.fmt(e).toLowerCase().includes(this.q);
  },
  row(e) {
    const d = new Date(e.at), ts = d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    return `<div class="lg lg-${e.lvl}"><div class="lg-h"><span class="lg-t">${ts}</span><span class="lg-c">${esc(e.cat)}</span><span class="lg-m">${esc(e.msg)}</span></div>
      ${e.data !== undefined ? `<pre class="lg-d">${esc(JSON.stringify(e.data)).slice(0, 2000)}</pre>` : ''}</div>`;
  },
  list() {
    const box = $('#logList'); if (!box) return;
    const rows = Log.items.filter(e => this.shown(e)).slice(-300).reverse();
    box.innerHTML = rows.map(e => this.row(e)).join('') || '<div class="lg-empty">Nothing logged yet for this filter.</div>';
    $('#logCount').textContent = `${Log.items.length} entries · newest first`;
  },
  render() {
    const V = typeof Voice !== 'undefined' ? Voice : {}, cfg = Diag.get(), E = Log.env();
    const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-dbg="diag:${k}:${v}" class="${cfg[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const btn = (a, t, v = '') => `<button class="row btn" data-dbg="${a}"><div class="main"><div class="t">${t}</div></div><span class="val">${v}</span></button>`;
    const info = (t, s) => `<div class="row"><div class="main"><div class="t">${t}</div><div class="s wrap">${esc(s)}</div></div></div>`;
    $('#settingsBody').innerHTML = `${this.tabs()}
      <div class="group-title">Voice diagnostics</div>
      <div class="group">
        ${info('This device', `${E.standalone ? 'Installed app' : 'Browser tab'} · audio session: ${E.audioSession} · AudioWorklet: ${E.audioWorklet ? 'yes' : 'no'} · phone voice: ${E.speechSynthesis ? 'yes' : 'no'} · phone recognizer: ${E.speechRecognition ? 'yes' : 'no'}`)}
        ${info('Voice state', `Listening: ${settings.stt === 'whisper' ? `Whisper ${V.pipe ? 'loaded' : store.get('whisperOK') ? 'downloaded' : 'not downloaded'}` : 'phone recognizer'} · Replies: ${settings.tts}${settings.tts === 'neural' ? ` (Kokoro ${V.tts ? 'loaded' : store.get('kokoroOK') ? 'downloaded, not loaded' : 'not downloaded'}${V.ttsBroken ? `, NOT WORKING: ${V.ttsBroken}` : ''})` : ''} · reply player ${V.unlocked ? 'unlocked' : 'not unlocked yet'}`)}
        ${btn('test:neural:0', 'Test the on-device voice now')}
        ${btn('test:neural:3000', 'Test the on-device voice in 3 s', 'no tap, like a reply')}
        ${btn('test:phone:0', 'Test the phone voice now')}
        ${btn('test:phone:3000', 'Test the phone voice in 3 s', 'no tap, like a reply')}
        ${btn('test:mic', 'Test the microphone (3 s)')}
        <div class="row"><div class="main"><div class="t">On-device voice plays through</div><div class="s">Try another if replies are silent</div></div>${seg('out', [['element', 'Audio'], ['data', 'Audio (data)'], ['webaudio', 'Web Audio']])}</div>
        <div class="row"><div class="main"><div class="t">Audio mode while replying</div><div class="s">Playback: loudspeaker, ignores the silent switch</div></div>${seg('session', [['playback', 'Playback'], ['auto', 'Auto'], ['transient', 'Transient']])}</div>
        ${btn('env', 'Write device details to the log')}
      </div>
      <div class="group-title" id="logCount"></div>
      <div class="group log-group">
        <div class="log-filters">${LOG_FILTERS.map(([id, l]) => `<button class="chip ${this.filter === id ? 'on' : ''}" data-dbg="filter:${id}">${l}</button>`).join('')}</div>
        <div class="log-search"><input id="logSearch" placeholder="Search the log" value="${esc(this.q)}" autocomplete="off" autocapitalize="off"></div>
        <div class="log-actions"><button class="big-btn" data-dbg="copy">Copy</button><button class="big-btn" data-dbg="share">Share</button>
          <button class="big-btn" data-dbg="pause">${this.paused ? 'Resume' : 'Pause'}</button><button class="big-btn" data-dbg="clear">Clear</button></div>
        <div class="log-list" id="logList"></div>
      </div>
      <div class="group-title"></div>
      <div class="group">${btn('off', 'Turn off debug mode')}</div>`;
    $('#logSearch').addEventListener('input', e => { this.q = e.target.value.trim().toLowerCase(); this.list(); });
    this.list();
    this.unsub?.();
    let t = 0;
    this.unsub = Log.sub(() => { if (this.paused || t || !$('#logList')) return; t = requestAnimationFrame(() => { t = 0; this.list(); }); });
  },
  leave() { this.unsub?.(); this.unsub = null; },
  async test(kind, delay) {
    const V = Voice, text = kind === 'neural' ? 'This is the on-device voice. If you can hear me, replies work.' : 'This is the phone voice. If you can hear me, replies work.';
    Log.i('diag', `Test: ${kind === 'neural' ? 'on-device' : 'phone'} voice${delay ? ` in ${delay / 1000} s, without a tap` : ''}`, { unlocked: !!V.unlocked, reply: Diag.get() });
    if (kind === 'neural' && !V.tts) {
      if (!store.get('kokoroOK') && !confirm('The on-device voice isn’t downloaded yet (about 90 MB). Download it now?')) return;
      toast('Loading the on-device voice…');
      try { await V.loadTTS(true); } catch (e) { toast('The on-device voice failed to load (see the log)'); return; }
    }
    if (delay) toast(`Speaking in ${delay / 1000} s…`);
    setTimeout(() => {
      V.hush(); const id = ++V.sayId;
      const run = kind === 'neural' ? V.speakNeural(text, id) : V.speakPhone(text, id);
      Promise.resolve(run).then(() => Log.i('diag', 'Test finished'), e => { Log.e('diag', 'Test failed', e); toast('Test failed: ' + (e?.message || e)); });
    }, delay);
  },
  async micTest() {
    Log.i('diag', 'Test: microphone for 3 s');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { Log.e('diag', 'Microphone refused', { name: e.name, message: e.message, session: navigator.audioSession?.type }); return toast(`Microphone refused: ${e.name}`); }
    const ctx = new AudioContext(), an = ctx.createAnalyser(), d = new Float32Array(2048); ctx.createMediaStreamSource(stream).connect(an);
    let peak = 0, sum = 0, n = 0;
    const iv = setInterval(() => { an.getFloatTimeDomainData(d); let s = 0; for (const x of d) s += x * x; const r = Math.sqrt(s / d.length); peak = Math.max(peak, r); sum += r; n++; }, 50);
    toast('Say something…');
    setTimeout(() => {
      clearInterval(iv); stream.getTracks().forEach(t => t.stop()); ctx.close();
      const res = { peakRms: +peak.toFixed(4), avgRms: +(sum / Math.max(1, n)).toFixed(4), ctxRate: ctx.sampleRate, track: stream.getAudioTracks()[0]?.getSettings?.() };
      Log.i('diag', 'Microphone test result', res); Voice.session('auto');
      toast(peak > 0.02 ? `Microphone OK (peak ${res.peakRms})` : `Very quiet (peak ${res.peakRms}): check the microphone`);
    }, 3000);
  },
  async share() {
    const text = `DriveDeck debug log\n${JSON.stringify(Log.env())}\n\n${Log.text()}`, name = `drivedeck-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    try {
      const file = new File([text], name, { type: 'text/plain' });
      if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: 'DriveDeck log' });
    } catch (e) { if (e?.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  /** Hidden way in for the installed app (which has no address bar): tap the version row 7 times. */
  versionTap() {
    const now = Date.now(); this.taps = [...this.taps.filter(t => now - t < 4000), now];
    if (this.taps.length < 7) return;
    this.taps = [];
    if (Log.on) return toast('Debug mode is already on: see the Logs tab');
    const key = prompt('Debug key'); if (!key) return;
    Log.unlock(key).then(ok => { toast(ok ? 'Debug mode on' : 'That key isn’t right'); if (ok) { this.tab = 'logs'; renderSettings(); } });
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-dbg]'); if (!b) return;
  const [a, x, y] = b.dataset.dbg.split(':');
  if (a === 'tab') { DebugUI.tab = x; if (x === 'main') DebugUI.leave(); renderSettings(); }
  else if (a === 'filter') { DebugUI.filter = x; DebugUI.render(); }
  else if (a === 'diag') { Diag.set(x, y); DebugUI.render(); }
  else if (a === 'test') x === 'mic' ? DebugUI.micTest() : DebugUI.test(x, +y || 0);
  else if (a === 'env') { Log.i('app', 'Device details', { ...Log.env(), settings, reply: Diag.get() }); }
  else if (a === 'copy') navigator.clipboard?.writeText(Log.text()).then(() => toast('Log copied'), () => toast('Copy isn’t allowed here: use Share'));
  else if (a === 'share') DebugUI.share();
  else if (a === 'pause') { DebugUI.paused = !DebugUI.paused; b.textContent = DebugUI.paused ? 'Resume' : 'Pause'; if (!DebugUI.paused) DebugUI.list(); }
  else if (a === 'clear') { Log.clear(); DebugUI.list(); }
  else if (a === 'off') sheet('Turn off debug mode?', '<p>The Logs tab disappears and the log is deleted. Turn it back on with the key.</p>',
    [['Turn off', () => { DebugUI.leave(); Log.disable(); DebugUI.tab = 'main'; renderSettings(); toast('Debug mode off'); }], ['Cancel']]);
});
// Settings may already be on screen (e.g. ?view=settings): show the Logs tab switch now that it exists.
if (current === 'settings') renderSettings();
