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
        ${info('This device', `${E.standalone ? 'Installed app' : 'Browser tab'} · WebGPU: ${!!navigator.gpu ? 'yes' : 'no'} · CPU cores: ${E.cores || '?'} · audio session: ${E.audioSession} · AudioWorklet: ${E.audioWorklet ? 'yes' : 'no'} · phone voice: ${E.speechSynthesis ? 'yes' : 'no'} · phone recognizer: ${E.speechRecognition ? 'yes' : 'no'}`)}
        ${info('Voice state', `Listening: ${settings.stt === 'whisper' ? `Whisper ${V.pipe ? 'loaded' : store.get('whisperOK') ? 'downloaded' : 'not downloaded'}` : 'phone recognizer'} · Replies: ${settings.tts}${settings.tts === 'neural' ? ` (Kokoro ${V.tts ? `loaded in ${V.tts.kind}` : store.get('kokoroOK') ? 'downloaded, not loaded' : 'not downloaded'}${V.ttsBroken ? `, NOT WORKING: ${V.ttsBroken}` : ''})` : ''} · reply player ${V.unlocked ? 'unlocked' : 'not unlocked yet'}`)}
        ${btn('test:neural:0', 'Test the on-device voice now')}
        ${btn('test:neural:3000', 'Test the on-device voice in 3 s', 'no tap, like a reply')}
        ${btn('test:phone:0', 'Test the phone voice now')}
        ${btn('test:phone:3000', 'Test the phone voice in 3 s', 'no tap, like a reply')}
        ${btn('test:mic', 'Test the microphone (3 s)')}
        ${btn('bench', 'Compare speech recognition', 'phone · Whisper CPU · GPU')}
        <div class="row"><div class="main"><div class="t">Whisper computes on</div><div class="s">${navigator.gpu ? 'GPU (WebGPU): about 140 MB more to download' : 'This browser has no WebGPU'}</div></div>${seg('stt', [['wasm', 'CPU'], ...(navigator.gpu ? [['webgpu', 'GPU (beta)']] : [])])}</div>
        <div class="row"><div class="main"><div class="t">Phone recognizer</div><div class="s">Reset: free the audio player and reset the microphone before listening (fixes iPhone/iPad hearing nothing after a reply)</div></div>${seg('sr', [['reset', 'Reset'], ['plain', 'Plain']])}</div>
        <div class="row"><div class="main"><div class="t">Voice models run in</div><div class="s">Background: the app stays smooth, speech starts sooner, and unloading frees the memory</div></div>${seg('engine', [['worker', 'Background'], ['main', 'Main thread']])}</div>
        <div class="row"><div class="main"><div class="t">On-device voice computes on</div><div class="s">${!!navigator.gpu ? 'GPU (WebGPU) can be much faster; about 310 MB to download' : 'This browser has no WebGPU'}</div></div>${seg('device', [['wasm', 'CPU'], ...(!!navigator.gpu ? [['webgpu', 'GPU (beta)']] : [])])}</div>
        <div class="row"><div class="main"><div class="t">On-device voice plays through</div><div class="s">Try another if replies are silent</div></div>${seg('out', [['data', 'Audio (data)'], ['element', 'Audio'], ['webaudio', 'Web Audio']])}</div>
        <div class="row"><div class="main"><div class="t">Conversation volume</div><div class="s">Reply loudness in conversation mode. Auto: 2.5× on iPhone/iPad (echo cancellation turns playback down), 1.4× elsewhere; a limiter stops clipping</div></div>${seg('convoBoost', [['', 'Auto'], ['1', '1×'], ['2', '2×'], ['3', '3×'], ['4', '4×']])}</div>
        <div class="row"><div class="main"><div class="t">Audio mode while replying</div><div class="s">Playback: loudspeaker, ignores the silent switch</div></div>${seg('session', [['playback', 'Playback'], ['auto', 'Auto'], ['transient', 'Transient']])}</div>
      </div>
      <div class="group-title">Memory</div>
      <div class="group">
        ${info('Budget', `${Budget.cls()} class${store.get('devClass') ? ' (set here)' : ' (detected)'}: ${Budget.total()} MB for models, ${Budget.used()} MB in use · loaded: ${[...Budget.loaded].map(([k, m]) => `${k} (${m.label}, ${m.mb} MB)`).join(', ') || 'none'}${store.get('tooBig', []).length ? ` · too big here: ${store.get('tooBig', []).join(', ')}` : ''}${store.get('slotsLost', 0) ? ` · lowered ${store.get('slotsLost', 0)}× after a crash` : ''}`)}
        <div class="row"><div class="main"><div class="t">Device class</div><div class="s">Memory for models: phone 400 MB (reply voice + detector; Whisper takes turns) · tablet 1.1 GB · computer 3.2 GB</div></div><div class="seg">${[['', 'Auto'], ['phone', 'Phone'], ['tablet', 'Tablet'], ['desktop', 'Computer']].map(([v, l]) => `<button data-dbg="cls:${v}" class="${(store.get('devClass') || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${btn('budgetReset', 'Forget the crash history', 'try skipped builds again')}
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
      if (!store.get('kokoroOK') && !confirm(`The on-device voice isn’t downloaded yet (about ${ttsSize()}). Download it now?`)) return;
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
  else if (a === 'bench') STTBench.ask();
  else if (a === 'cls') { store.set('devClass', x || null); Log.i('mem', `Device class → ${Budget.cls()}`, { totalMB: Budget.total() }); DebugUI.render(); }
  else if (a === 'budgetReset') { Budget.reset(); DebugUI.render(); }
  else if (a === 'env') { Log.i('app', 'Device details', { ...Log.env(), settings, reply: Diag.get(), memory: { class: Budget.cls(), totalMB: Budget.total(), usedMB: Budget.used(), loaded: [...Budget.loaded.keys()], tooBig: store.get('tooBig', []) } }); }
  else if (a === 'copy') navigator.clipboard?.writeText(Log.text()).then(() => toast('Log copied'), () => toast('Copy isn’t allowed here: use Share'));
  else if (a === 'share') DebugUI.share();
  else if (a === 'pause') { DebugUI.paused = !DebugUI.paused; b.textContent = DebugUI.paused ? 'Resume' : 'Pause'; if (!DebugUI.paused) DebugUI.list(); }
  else if (a === 'clear') { Log.clear(); DebugUI.list(); }
  else if (a === 'off') sheet('Turn off debug mode?', '<p>The Logs tab disappears and the log is deleted. Turn it back on with the key.</p>',
    [['Turn off', () => { DebugUI.leave(); Log.disable(); DebugUI.tab = 'main'; renderSettings(); toast('Debug mode off'); }], ['Cancel']]);
});
// Settings may already be on screen (e.g. ?view=settings): show the Logs tab switch now that it exists.
if (current === 'settings') renderSettings();

/* ---------- Speech recognition comparison ----------
   You say one phrase. The phone's recognizer listens live while the app records the same audio; Whisper then
   transcribes that recording on the CPU and on the GPU. For each: the text, how long after your last word the
   result was ready, word accuracy against the phrase, and the command it would trigger. */
const STT_PHRASES = ['Take me to Koramangala', 'Play music from Maroon 5', 'Send a text to Priya saying I am running late',
  'Find the nearest petrol pump', 'What is my ETA', 'Call Mom', 'Switch to dark mode', 'Navigate to Indiranagar with Waze'];
const NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const words = t => String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map(w => NUM[w] || w);
/** Word accuracy (1 − word error rate) of what was heard against what should have been said. */
function wordAccuracy(ref, hyp) {
  const a = words(ref), b = words(hyp); if (!a.length) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return Math.max(0, 1 - d[b.length] / a.length);
}
const STTBench = {
  ask(phrase = STT_PHRASES[Math.floor(Math.random() * STT_PHRASES.length)]) {
    const gpu = !!navigator.gpu;
    sheet('Compare speech recognition', `<p>Tap <b>Start</b>, then say, at your normal pace:</p><p class="bench-phrase">“${esc(phrase)}”</p>
      <p class="hint">The phone’s recognizer listens while the app records you. Whisper then recognises the same recording on the CPU${gpu ? ' and on the GPU' : ''}.
      ${gpu && !store.get('whisperGpuOK') ? ' The first run downloads Whisper for the GPU (about 140 MB).' : ''}</p>`,
      [['Start', () => this.run(phrase)], ['Another phrase', () => this.ask()], ['Cancel']]);
  },
  async run(phrase) {
    if (this.running) return toast('A comparison is already running');
    this.running = true;
    try { await this.runOnce(phrase); } finally { this.running = false; }
  },
  async runOnce(phrase) {
    const R = { phrase, native: {}, whisper: [] }, SRx = window.SpeechRecognition || window.webkitSpeechRecognition;
    Log.i('diag', 'STT comparison: start', { phrase });
    Voice.hush(); Voice.open(); $('#vChips').hidden = true; Voice.show(`Say: “${phrase}”`, 'Recording for the comparison…');
    // 1. The phone's recognizer, started inside the tap (it must be)
    const N = R.native; let sr = null;
    if (SRx) try {
      sr = new SRx(); sr.lang = (LANGS[settings.voiceLang] || LANGS.auto)[2]; sr.interimResults = true; sr.continuous = false;
      N.text = ''; N.t0 = performance.now();
      sr.onresult = e => { const t = [...e.results].map(x => x[0].transcript).join(' ').trim();
        if (!N.firstAt) N.firstAt = performance.now(); if (t !== N.text) N.lastChange = performance.now(); N.text = t;
        if (e.results[e.results.length - 1].isFinal) N.finalAt = performance.now(); };
      sr.onspeechend = () => { N.speechEndAt = performance.now(); };
      sr.onerror = e => { N.error = e.error || 'error'; };
      N.ended = new Promise(r => { sr.onend = () => { N.endAt = performance.now(); r(); }; });
      sr.start();
    } catch (e) { N.error = e.message; sr = null; }
    else N.error = 'not available in this browser';
    // 2. The app's own recording of the same speech
    let rec;
    try { rec = await this.record(); } catch (e) { Log.e('diag', 'STT comparison: microphone refused', e); Voice.show('Microphone refused', e.name || ''); return; }
    if (sr) { await Promise.race([N.ended, new Promise(r => setTimeout(r, 4000))]); try { sr.abort(); } catch {} }
    if (!rec.heard) { Voice.show('I didn’t hear anything', 'Try again'); Log.w('diag', 'STT comparison: no speech recorded'); return; }
    // 3. Whisper on the same recording, CPU and GPU. Memory is tight on a phone (iOS kills the page when it runs out), so the
    //    voice models are unloaded first and each Whisper build is loaded, used and freed before the next.
    const hadVoice = !!Voice.tts;
    Log.i('diag', 'STT comparison: freeing the voice models to make room'); Voice.resetTTS(); Voice.resetSTT();
    for (const dev of ['wasm', ...(navigator.gpu && !store.get('gpuFailed') ? ['webgpu'] : [])]) {
      const W = { device: dev === 'webgpu' ? 'GPU' : 'CPU' }; R.whisper.push(W);
      let pipe = null;
      try {
        Voice.show(`Whisper on the ${W.device}…`, 'Loading the model');
        pipe = await this.pipe(dev); W.build = pipe.build;
        const lang = LANGS[settings.voiceLang] || LANGS.auto, opts = { language: lang[1], task: lang[1] && lang[1] !== 'en' ? 'translate' : 'transcribe' };
        Voice.show(`Whisper on the ${W.device}…`, 'Recognising');
        let t = performance.now(); let out = await pipe(rec.audio, opts); W.firstMs = Math.round(performance.now() - t);
        t = performance.now(); out = await pipe(rec.audio, opts); W.ms = Math.round(performance.now() - t); // second run: warm, what you'd get in use
        W.text = (out.text || '').trim();
      } catch (e) { W.error = e.message || String(e); Log.e('diag', `STT comparison: Whisper ${W.device} failed`, e); }
      try { await pipe?.dispose?.(); } catch {} Log.mem('bench-whisper', null);
    }
    if (hadVoice || settings.tts === 'neural') Voice.loadTTS().catch(() => {}); // the reply voice back, in the background
    // 4. Results
    const rows = [];
    const cmd = t => { if (!t) return '—'; const m = Commands.match(t); return m.cmd ? m.cmd.name : 'no command'; };
    if (SRx) {
      const end = rec.lastVoiceAt, done = N.finalAt || N.endAt;
      N.readyMs = done && N.text ? Math.round(done - end) : null;
      N.afterLastWordMs = done && N.lastChange ? Math.round(done - N.lastChange) : null;
      N.firstWordsMs = N.firstAt ? Math.round(N.firstAt - rec.speechAt) : null;
      rows.push({ engine: 'Phone recognizer', text: N.text, ready: N.readyMs, acc: wordAccuracy(phrase, N.text), cmd: cmd(N.text), note: N.error ? `error: ${N.error}` : N.firstAt ? (N.firstWordsMs > 0 ? `first words shown ${(N.firstWordsMs / 1000).toFixed(1)} s after you started` : 'words shown as you speak') : '' });
    }
    for (const W of R.whisper) rows.push({ engine: `Whisper · ${W.build || W.device}`, text: W.text, ready: W.ms, acc: wordAccuracy(phrase, W.text), cmd: cmd(W.text),
      note: W.error ? `error: ${W.error}` : W.firstMs > W.ms * 1.5 ? `first run ${W.firstMs} ms` : '' });
    Log.i('diag', 'STT comparison: result', { phrase, speechSeconds: rec.seconds, rows: rows.map(r => ({ engine: r.engine, text: r.text, readyMs: r.ready, accuracy: Math.round(r.acc * 100), command: r.cmd, note: r.note })) });
    Voice.close();
    const ms = v => v == null ? '—' : v < 0 ? 'before you stopped' : `${(v / 1000).toFixed(1)} s`;
    sheet('Speech recognition compared', `<p>You said: <b>“${esc(phrase)}”</b> (${rec.seconds.toFixed(1)} s)</p>
      <table class="bench"><tr><th></th><th>Heard</th><th>Ready after your last word</th><th>Words right</th><th>Command</th></tr>
      ${rows.map(r => `<tr><td><b>${esc(r.engine)}</b>${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td><td>${esc(r.text || '—')}</td><td>${ms(r.ready)}</td><td>${r.text ? Math.round(r.acc * 100) + '%' : '—'}</td><td>${esc(r.cmd)}</td></tr>`).join('')}</table>
      <p class="hint">Whisper times are the time to recognise the recording (warm). In use, Whisper starts about 0.7 s into your pause, so it is usually ready before the “act after” wait ends. The phone recognizer decides by itself when you have finished, and its words show live while you speak.</p>`,
      [['Again', () => this.ask(phrase)], ['Another phrase', () => this.ask()], ['Done']]);
  },
  /** Record until 1.2 s of quiet after speech (or 12 s). Returns 16 kHz audio and timings. */
  async record() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let ctx; try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
    const src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1), chunks = [], rate = ctx.sampleRate;
    let heard = false, quiet = 0, total = 0, noise = 0.008, speechAt = 0, lastVoiceAt = 0;
    await new Promise(resolve => {
      node.onaudioprocess = e => {
        const d = new Float32Array(e.inputBuffer.getChannelData(0)); chunks.push(d);
        let sum = 0; for (const x of d) sum += x * x; const rms = Math.sqrt(sum / d.length), dt = d.length / rate; total += dt; Voice.level(rms);
        if (rms > Math.max(0.018, noise * 3)) { if (!heard) speechAt = performance.now(); heard = true; quiet = 0; lastVoiceAt = performance.now(); }
        else { quiet += dt; if (!heard) noise = noise * 0.9 + rms * 0.1; }
        if ((heard && quiet > 1.2) || total > 12 || (!heard && total > 8)) resolve();
      };
      src.connect(node); node.connect(ctx.destination);
    });
    node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); Voice.session('auto');
    let audio = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)), o = 0; for (const c of chunks) { audio.set(c, o); o += c.length; }
    if (rate !== 16000) audio = await resample(audio, rate, 16000);
    return { audio, heard, speechAt, lastVoiceAt, seconds: audio.length / 16000 };
  },
  /** A Whisper pipeline for this test only (freed after use): the best build for the device that loads. */
  async pipe(dev) {
    if (dev === 'webgpu') await gpuFeatures();
    let lastErr;
    for (const build of whisperBuilds(dev)) {
      try {
        const s = performance.now(), files = {};
        const pipe = await Heavy.run(`Whisper ${build.label} (comparison)`, () => createWhisper(build, p => Voice.progress(p, files, `Whisper (${build.label})`)));
        $('#vProg').hidden = true; if (dev === 'webgpu') store.set('whisperGpuOK', true);
        pipe.build = build.label; Log.mem('bench-whisper', build.label);
        Log.i('diag', `STT comparison: Whisper ${build.label} loaded in ${Math.round(performance.now() - s)} ms`);
        return pipe;
      } catch (e) { lastErr = e; Log.w('diag', `STT comparison: Whisper ${build.label} failed to load`, e); }
    }
    throw lastErr;
  },
};
