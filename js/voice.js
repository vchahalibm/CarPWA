'use strict';
/* ============================================================
   Voice: speech to text, the listening box and the conversation log.
   Engines: on-device Whisper (base, multilingual, via transformers.js)
   or the browser's own recognizer. Loaded after dash.js.
   ============================================================ */
const WHISPER_MODEL = 'onnx-community/whisper-base';
// The desktop app (Electron) has Chromium's recognizer, but it needs a Google key Electron doesn't have: Whisper listens there.
// It also gets the computer's memory budget.
const IS_DESKTOP_APP = /Electron\//.test(navigator.userAgent);
// transformers.js, pinned. Loaded from the CDN on first use (like the ONNX runtime and the model), then cached by the service worker.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
// Replies: Kokoro (82M, q8) through kokoro-js, which bundles its own transformers.js. Same CDN + service-worker caching as Whisper.
const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const TTS_VOICES = { af_heart: ['Heart · US, warm'], af_bella: ['Bella · US, bright'], am_michael: ['Michael · US, calm'], am_fenrir: ['Fenrir · US, deep'],
  bf_emma: ['Emma · British'], bm_george: ['George · British'] };
// Records the microphone off the main thread, so nothing is lost while Whisper is busy.
const REC_WORKLET = `class R extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
process(i){const c=i[0]&&i[0][0];if(c)for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b);this.b=new Float32Array(2048);this.n=0}}return true}}
registerProcessor('dd-rec',R);`;
// Safari (iPhone/iPad) can't `for await` over a ReadableStream. kokoro-js does exactly that while unpacking its
// pronunciation dictionary as it loads; without this the voice never produces a sentence. Must run before the import.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } }
    finally { reader.releaseLock(); }
  };
  ReadableStream.prototype.values ||= ReadableStream.prototype[Symbol.asyncIterator];
  window.__rsIterShim = true;
}
// How replies are played. Adjustable only from the debug Logs tab, to find what works on a given phone.
//   out:     'data' (<audio>, data URL; worked fully on iPad) · 'element' (<audio>, blob URL) · 'webaudio'
//   session: the WebKit audio session while speaking: 'playback' (loudspeaker, ignores the silent switch) · 'auto' · 'transient'
//   engine:  'worker' (Whisper and Kokoro each in a background worker: the app stays responsive, sentence 1 plays while 2 is made,
//            and unloading hands the memory back) · 'main'
//   device:  'webgpu' (GPU, fp32, ~310 MB: on iPad about 3× faster than real time, so no pauses) where WebGPU exists and
//            hasn't failed here before · else 'wasm' (CPU, q8, ~90 MB: slower than real time on a tablet)
const gpuOK = () => !!navigator.gpu && !store.get('gpuFailed');
/** Which reply-voice models are downloaded ('q8' CPU, 'fp32' GPU). Before this was tracked, only the CPU one existed. */
const ttsDownloaded = () => store.get('kokoroDl') || (store.get('kokoroOK') ? ['q8'] : []);
const Diag = {
  // GPU by default where it works, unless this device already has only the CPU voice (no surprise 310 MB download): then it's opt-in.
  // Whisper: the GPU (0.4 s vs 2.2 s on an iPad) on tablets and computers, unless only the CPU build is downloaded here.
  get: () => ({ stt: gpuOK() && Budget.cls() !== 'phone' && (!store.get('whisperOK') || store.get('whisperGpuOK')) ? 'webgpu' : 'wasm', out: 'data', session: 'playback', engine: 'worker', sr: 'reset',
    device: gpuOK() && (!ttsDownloaded().length || ttsDownloaded().some(d => d.startsWith('fp'))) ? 'webgpu' : 'wasm', ...store.get('diag', {}) }),
  set(k, v) {
    store.set('diag', { ...store.get('diag', {}), [k]: v }); Log.i('diag', `Reply ${k} → ${v}`);
    if ((k === 'engine' || k === 'device') && typeof Voice !== 'undefined') Voice.resetTTS();
    if ((k === 'stt' || k === 'engine') && typeof Voice !== 'undefined') Voice.resetSTT();
  },
};

/** Whisper settings per device. The GPU build keeps the encoder in full precision and the decoder 4-bit (the
    combination transformers.js recommends for WebGPU); the CPU build is 8-bit throughout. */
/** Whisper builds to try on a device, best first. On the GPU: a 16-bit encoder where the GPU supports it (half the memory), else 32-bit. */
function whisperBuilds(dev) {
  const cpu = { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, label: 'CPU q8' };
  if (dev !== 'webgpu') return [cpu];
  const gpu = enc => ({ device: 'webgpu', dtype: { encoder_model: enc, decoder_model_merged: 'q4' }, label: `GPU ${enc}/q4` });
  return [...(store.get('gpuF16') ? [gpu('fp16')] : []), gpu('fp32')].filter(b => !Budget.tooBig(`Whisper ${b.label}`));
}
/* Whisper runs in its own worker. Unloading it ends the worker, the only way to hand its WebAssembly memory
   (which never shrinks) and its GPU buffers back to the phone: freed in place, a CPU model left ~200 MB behind
   and the next load got the page killed on iPhone. The runtime is also told not to keep spare memory pools. */
const WHISPER_WORKER = `let pipe;
self.onmessage = async ({ data: m }) => {
  const send = x => self.postMessage({ ...x, id: m.id });
  try {
    if (m.type === 'load') {
      const T = await import(m.url);
      T.env.allowLocalModels = false;
      if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.numThreads = m.threads;
      pipe = await T.pipeline('automatic-speech-recognition', m.model, { device: m.device, dtype: m.dtype,
        session_options: { enableCpuMemArena: false, enableMemPattern: false }, progress_callback: p => send({ type: 'progress', p }) });
      send({ type: 'loaded' });
    } else if (m.type === 'run') {
      const out = await pipe(m.audio, m.opts); send({ type: 'out', text: out.text });
    }
  } catch (e) { send({ type: 'error', message: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 400) }); }
};`;
/** Load a Whisper build. Returns pipe(audio, opts) → { text }, with pipe.dispose() to end it and pipe.kind. */
async function createWhisper(build, onProgress) { return Budget.guard(`Whisper ${build.label}`, () => whisperNow(build, onProgress)); }
async function whisperNow(build, onProgress) {
  const threads = self.crossOriginIsolated ? 4 : 1;
  // On the page only without workers, or when chosen in the Logs tab to compare (its memory then stays until the app closes).
  if (typeof Worker === 'undefined' || Diag.get().engine === 'main') {
    const T = await import(TRANSFORMERS_URL); T.env.allowLocalModels = false;
    if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.numThreads = threads;
    const p = await T.pipeline('automatic-speech-recognition', WHISPER_MODEL, { device: build.device, dtype: build.dtype, progress_callback: onProgress });
    const pipe = (audio, opts) => p(audio, opts); pipe.dispose = () => p.dispose?.(); pipe.kind = 'main thread'; return pipe;
  }
  const w = new Worker(URL.createObjectURL(new Blob([WHISPER_WORKER], { type: 'text/javascript' })), { type: 'module' });
  const pending = new Map(); let seq = 0, dead = null;
  const fail = msg => { dead = msg; for (const h of [...pending.values()]) h({ type: 'error', message: msg }); pending.clear(); };
  w.onmessage = ({ data: m }) => pending.get(m.id)?.(m);
  w.onerror = e => { Log.e('stt', 'Whisper worker error', { message: e.message, file: e.filename, line: e.lineno }); e.preventDefault?.(); fail(e.message || 'Whisper worker crashed'); };
  const call = (msg, onProgress) => new Promise((res, rej) => {
    if (dead) return rej(new Error(dead));
    const id = ++seq;
    pending.set(id, m => {
      if (m.type === 'progress') return onProgress?.(m.p);
      pending.delete(id); m.type === 'error' ? rej(Object.assign(new Error(m.message), { stack: m.stack })) : res(m);
    });
    w.postMessage({ ...msg, id }); // the audio is copied, not moved: callers may use it again
  });
  const pipe = (audio, opts) => call({ type: 'run', audio, opts });
  pipe.dispose = () => { w.terminate(); fail('Whisper unloaded'); };
  pipe.alive = () => !dead;
  pipe.kind = 'background worker';
  try { await call({ type: 'load', url: TRANSFORMERS_URL, model: WHISPER_MODEL, device: build.device, dtype: build.dtype, threads }, onProgress); }
  catch (e) { pipe.dispose(); throw e; } // a failed build must not keep its memory while the next one loads
  return pipe;
}
/** What the GPU can do. 16-bit ('shader-f16') lets the models use half the memory, which matters: iOS kills a page that uses too much. */
async function gpuFeatures() {
  if (Voice.gpuInfo) return Voice.gpuInfo;
  let info = { f16: false };
  try {
    const a = await navigator.gpu?.requestAdapter();
    info = { f16: !!a?.features?.has('shader-f16'), maxBufferMB: a?.limits ? Math.round(a.limits.maxBufferSize / 1048576) : null };
  } catch (e) { info.error = e.message; }
  store.set('gpuF16', info.f16); Log.i('gpu', `GPU ${info.f16 ? 'supports' : 'lacks'} 16-bit models`, info);
  return (Voice.gpuInfo = info);
}
/** Big model loads one at a time: loading two at once roughly doubles peak memory. */
const Heavy = { q: Promise.resolve(), run(name, f) { const p = this.q.then(() => { Log.d('mem', `Loading ${name}`); return f(); }); this.q = p.catch(() => {}); return p; } };
/* ---------- Memory budget ----------
   iOS kills a page that uses too much memory, at a limit it never reveals, and nothing can catch it. So each device
   class gets a memory allowance for on-device models, and each model build has an estimated cost (what it holds once
   loaded, not its download). A model needed now makes room by unloading the least recently used ones; background
   preloads only use what's free. A model alone is always allowed. If the app dies while a model is loading, that build
   is remembered as too big for this device and skipped from then on, and if other models were loaded at the time, the
   allowance drops by a quarter. On a phone the reply voice and the object detector fit together; Whisper takes turns. */
const Budget = {
  MB: { phone: 400, tablet: 1100, desktop: 3200 },
  /** Estimated memory per model build, in MB. */
  COST: { 'whisper wasm': 250, 'whisper webgpu': 300, 'kokoro wasm': 180, 'kokoro webgpu fp16': 220, 'kokoro webgpu fp32': 380, detector: 90 },
  loaded: new Map(), // name → { label, mb, used, unload }
  auto() {
    const ua = navigator.userAgent, touch = navigator.maxTouchPoints > 1, small = Math.min(screen.width, screen.height);
    if (IS_DESKTOP_APP) return 'desktop';
    if (/iPhone|iPod/.test(ua) || /Android.*Mobile/.test(ua) || (touch && small < 600)) return 'phone';
    if (/iPad|Android/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'tablet'; // iPads report a Mac user agent, but with touch
    return 'desktop';
  },
  cls() { return this.MB[store.get('devClass')] ? store.get('devClass') : this.auto(); },
  /** The allowance in MB, lowered a quarter for each crash during a load with other models loaded. */
  total() { return Math.round(this.MB[this.cls()] * 0.75 ** Math.min(3, store.get('slotsLost', 0))); },
  used() { let n = 0; for (const m of this.loaded.values()) n += m.mb; return n; },
  add(name, label, unload, mb) { this.loaded.set(name, { label, mb: mb || 100, used: Date.now(), unload }); },
  drop(name) { this.loaded.delete(name); },
  use(name) { const m = this.loaded.get(name); if (m) m.used = Date.now(); },
  /** Room for `name` (needing `mb`)? If `need`, unload the least recently used models until it fits; a preload never unloads anything. */
  room(name, mb, need) {
    const others = () => [...this.loaded].filter(([k]) => k !== name).sort((a, b) => a[1].used - b[1].used);
    const free = () => this.total() - others().reduce((n, [, m]) => n + m.mb, 0);
    while (others().length && free() < mb) {
      if (!need) { Log.d('mem', `No room to preload ${name} (${mb} MB)`, { free: free(), total: this.total(), loaded: [...this.loaded.keys()] }); return false; }
      const [k, m] = others()[0];
      Log.i('mem', `Unloading ${k} (${m.label}, ${m.mb} MB) to make room for ${name} (${mb} MB)`, { class: this.cls(), total: this.total() });
      try { m.unload(); } catch {} this.loaded.delete(k);
    }
    return true;
  },
  tooBig: label => store.get('tooBig', []).includes(label),
  /** Run a model load, noting it so a crash during it is caught on the next launch. */
  async guard(label, f) {
    store.set('loadingModel', { label, at: Date.now(), others: [...this.loaded.keys()] });
    try { return await f(); } finally { store.set('loadingModel', null); }
  },
  /** At launch: did the app die while a model was loading last time? */
  boot() {
    const m = store.get('loadingModel'); if (!m) return;
    store.set('loadingModel', null);
    store.set('tooBig', [...new Set([...store.get('tooBig', []), m.label])]);
    if (m.others.length && store.get('slotsLost', 0) < 3) store.set('slotsLost', store.get('slotsLost', 0) + 1);
    Log.e('mem', `The app stopped while loading ${m.label}: skipping it on this device from now on`, { others: m.others, totalMB: this.total(), class: this.cls() });
  },
  reset() { store.set('tooBig', []); store.set('slotsLost', 0); Log.i('mem', 'Memory history cleared', { totalMB: this.total() }); },
};
Budget.boot();
// Closing the app on purpose isn't a crash.
addEventListener('pagehide', () => { if (store.get('loadingModel')) store.set('loadingModel', null); });
/** Download size of the reply voice for this device, for the prompts. */
const ttsSize = () => Diag.get().device === 'webgpu' ? (store.get('gpuF16') ? '165 MB' : '310 MB') : '90 MB';
/* ---------- Kokoro engines: the same small interface on the main thread or in a worker ----------
   sentences(text, voice) → async iterable of { text, f32, rate } · generate(text, voice) → { f32, rate } · terminate() */
const STREAM_SHIM = `if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () { const r = this.getReader();
    try { for (;;) { const { done, value } = await r.read(); if (done) return; yield value; } } finally { r.releaseLock(); } }; }`;
const KOKORO_WORKER = `${STREAM_SHIM}
let K, tts, chain = Promise.resolve(); const cancelled = new Set();
const send = (m, t) => self.postMessage(m, t || []);
self.onmessage = ({ data: m }) => {
  if (m.type === 'cancel') { cancelled.add(m.id); return; }
  const job = async () => {
    try {
      if (m.type === 'load') {
        K = await import(m.url);
        tts = await K.KokoroTTS.from_pretrained(m.model, { dtype: m.dtype, device: m.device, progress_callback: p => send({ type: 'progress', id: m.id, p }) });
        send({ type: 'loaded', id: m.id });
      } else if (m.type === 'generate') {
        const a = await tts.generate(m.text, { voice: m.voice }), f = new Float32Array(a.audio);
        send({ type: 'audio', id: m.id, f32: f, rate: a.sampling_rate }, [f.buffer]);
      } else if (m.type === 'speak') {
        if (cancelled.has(m.id)) { send({ type: 'done', id: m.id }); return; } // replaced before it began
        send({ type: 'start', id: m.id });
        // A closed splitter: given a plain string, kokoro-js waits for more text and never speaks the last sentence.
        const split = new K.TextSplitterStream(); split.push(m.text); split.close();
        for await (const { text, audio } of tts.stream(split, { voice: m.voice })) {
          await new Promise(r => setTimeout(r, 0)); // let a "cancel" message in between sentences
          if (cancelled.has(m.id)) break;
          const f = new Float32Array(audio.audio);
          send({ type: 'chunk', id: m.id, text, f32: f, rate: audio.sampling_rate }, [f.buffer]);
        }
        send({ type: 'done', id: m.id });
      }
    } catch (e) { send({ type: 'error', id: m.id, message: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 400) }); }
  };
  chain = chain.then(job, job); // one job at a time
};`;
function kokoroMain(K, tts) {
  let lock = Promise.resolve();
  return { kind: 'main thread',
    async generate(text, voice) { const a = await tts.generate(text, { voice }); return { f32: a.audio, rate: a.sampling_rate }; },
    async *sentences(text, voice) {
      const prev = lock; let release; lock = new Promise(r => (release = r)); await prev;
      try {
        const split = new K.TextSplitterStream(); split.push(text); split.close();
        for await (const { text: t, audio } of tts.stream(split, { voice })) yield { text: t, f32: audio.audio, rate: audio.sampling_rate };
      } finally { release(); }
    },
    terminate() {} };
}
function kokoroWorker() {
  const w = new Worker(URL.createObjectURL(new Blob([KOKORO_WORKER], { type: 'text/javascript' })), { type: 'module' });
  const pending = new Map(); let seq = 0;
  w.onmessage = ({ data: m }) => pending.get(m.id)?.(m);
  w.onerror = e => { Log.e('tts', 'Voice worker error', { message: e.message, file: e.filename, line: e.lineno }); e.preventDefault?.();
    for (const h of [...pending.values()]) h({ type: 'error', message: e.message || 'Voice worker crashed' }); };
  const call = (msg, h) => { const id = ++seq; pending.set(id, h); w.postMessage({ ...msg, id }); return id; };
  return { kind: 'background worker',
    load(opts, onProgress) {
      return new Promise((res, rej) => call({ type: 'load', url: KOKORO_URL, model: KOKORO_MODEL, ...opts }, m => {
        if (m.type === 'progress') return onProgress?.(m.p);
        pending.delete(m.id); m.type === 'loaded' ? res() : rej(Object.assign(new Error(m.message), { stack: m.stack }));
      }));
    },
    generate(text, voice) {
      return new Promise((res, rej) => call({ type: 'generate', text, voice }, m => {
        pending.delete(m.id); m.type === 'audio' ? res({ f32: m.f32, rate: m.rate }) : rej(new Error(m.message));
      }));
    },
    sentences(text, voice, onStart) {
      const q = [], waiting = []; let over = false, err = null;
      const put = v => (waiting.length ? waiting.shift()(v) : q.push(v));
      const id = call({ type: 'speak', text, voice }, m => {
        if (m.type === 'start') return onStart?.();
        if (m.type === 'chunk') return put({ text: m.text, f32: m.f32, rate: m.rate });
        pending.delete(m.id); if (m.type === 'error') err = new Error(m.message); put(null);
      });
      return { [Symbol.asyncIterator]() { return this; },
        async next() {
          if (over) return { done: true, value: undefined };
          const v = q.length ? q.shift() : await new Promise(r => waiting.push(r));
          if (v) return { done: false, value: v };
          over = true; if (err) throw err; return { done: true, value: undefined };
        },
        async return() { if (!over) { over = true; w.postMessage({ type: 'cancel', id }); pending.delete(id); } return { done: true, value: undefined }; } };
    },
    terminate() { w.terminate(); for (const h of [...pending.values()]) h({ type: 'error', message: 'Voice worker stopped' }); pending.clear(); },
  };
}
const SR = IS_DESKTOP_APP ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
const LANGS = { auto: ['Auto-detect', null, navigator.language || 'en-IN'], en: ['English', 'en', 'en-IN'], hi: ['हिन्दी Hindi', 'hi', 'hi-IN'],
  kn: ['ಕನ್ನಡ Kannada', 'kn', 'kn-IN'], ta: ['தமிழ் Tamil', 'ta', 'ta-IN'], te: ['తెలుగు Telugu', 'te', 'te-IN'], mr: ['मराठी Marathi', 'mr', 'mr-IN'] };
// Which app a reply belongs to, so the log can show where the action went.
const APP_OF = [[/call|dial/i, 'phone'], [/message|text|whatsapp|sms/i, 'messages'], [/play|music|paus|spotify|song|radio|podcast/i, 'music'],
  [/weather|degrees|forecast/i, 'weather'], [/route|direction|arriv|to go|turn|recenter|zoom|navigat|parking|gas|charg|coffee|food|mode|map/i, 'maps'],
  [/layout|style|dock|theme|dashboard|widget/i, 'dashboard']];
const APP_LOOK = { phone: ['phone', '#30d158', 'Phone'], messages: ['messages', '#30d158', 'Messages'], music: ['music', '#fa233b', 'Music'],
  weather: ['weather', '#1a5fd6', 'Weather'], maps: ['maps', '#0a84ff', 'Maps'], dashboard: ['dash', '#8e8e93', 'Dashboard'], assistant: ['mic', '#bf5af2', 'Assistant'] };

/* ---------- Conversation log (feeds the Assistant widget) ---------- */
const VoiceLog = {
  items: store.get('voiceLog', []),
  add(e) {
    this.items.push({ ...e, at: Date.now() }); this.items = this.items.slice(-80);
    store.set('voiceLog', this.items); if (typeof Dash !== 'undefined') Dash.update(true);
  },
  you(text, meta = {}) { this.add({ who: 'you', text, ...meta }); },
  app(text) { const app = (APP_OF.find(([re]) => re.test(text)) || [0, 'assistant'])[1]; this.add({ who: 'app', text, app }); return app; },
  clear() { this.items = []; store.set('voiceLog', []); Dash.update(true); },
  html() {
    if (!this.items.length) return `<div class="chat-empty">${svg('mic')}<b>Say “Hey” with the mic button</b><span>Try “take me home”, “what’s my ETA” or “call Mom”. Everything you say and what DriveDeck did shows up here.</span></div>`;
    let day = '';
    return this.items.slice(-30).map(e => {
      const d = new Date(e.at), dk = d.toDateString(), time = fmtClock(d);
      const sep = dk !== day ? (day = dk, `<div class="chat-day">${dk === new Date().toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</div>`) : '';
      if (e.who === 'you') return `${sep}<div class="chat-row you"><div class="bub"><q>${esc(e.text)}</q></div>
        <div class="meta">${svg('mic')}${time}${e.lang ? ` · ${esc(e.lang)}` : ''}${e.engine ? ` · ${esc(e.engine)}` : ''}</div></div>`;
      const [ic, col, name] = APP_LOOK[e.app] || APP_LOOK.assistant, open = { phone: 'phone', messages: 'messages', music: 'music', weather: 'weather', maps: 'maps' }[e.app];
      return `${sep}<div class="chat-row app"><span class="av" style="background:${col}">${svg(ic)}</span><div class="bub">${esc(e.text)}
        ${open ? `<button class="act" data-open="${open}">${svg(ic)}${name}</button>` : ''}</div><div class="meta">${time}</div></div>`;
    }).join('');
  },
  /** The three phrases you use most, for one-tap repeats. */
  quick() {
    const n = {}; this.items.filter(e => e.who === 'you').forEach(e => { const k = e.text.toLowerCase().replace(/[.?!]$/, ''); n[k] = (n[k] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `<button class="chip" data-cmd="${esc(k)}">${esc(k)}</button>`).join('');
  },
};

/* ---------- Listening box ---------- */
const Voice = {
  pipe: null, loading: null, rec: null, sr: null, tts: null, ttsLoading: null, ttsBroken: '', ttsStalls: 0, sayId: 0, respId: 0, playing: [],
  open() {
    const box = $('#assistant'); box.hidden = false;
    $('#vReply').hidden = true; $('#vProg').hidden = true; clearTimeout(this.closeT);
  },
  close() {
    this.startTok = (this.startTok || 0) + 1; // a listen still waiting for its model must not start after this
    this.hush(); this.stopRec(true); try { this.sr?.abort(); } catch {} this.sr = null;
    $('#assistant').hidden = true; $('#vOrb').classList.remove('live');
    Bus.emit('voice.idle');
  },
  show(text, hint = '') { $('#asstText').textContent = text; $('#asstHint').textContent = hint; },
  reply(text) {
    const app = VoiceLog.app(text), [ic, col, name] = APP_LOOK[app];
    $('#vReply').innerHTML = `<span class="av" style="background:${col}">${svg(ic)}</span><span>${esc(text)}</span>`;
    $('#vReply').hidden = false; $('#vChips').hidden = true;
  },
  /** Show and log a reply, say it and act. Hand-offs to other apps wait for the reply to finish (up to 4 s) so it isn't cut off. */
  respond(msg, then, o = {}) {
    this.reply(msg); clearTimeout(this.closeT); Log.i('reply', msg, { leaves: !!o.leaves }); Bus.emit('voice.reply', { value: msg });
    const id = ++this.respId, t0 = Date.now(), wait = ms => new Promise(r => setTimeout(r, ms)), said = speak(msg) || Promise.resolve();
    const done = () => id === this.respId && !this.rec && !this.sr;
    if (o.leaves) return Promise.race([said, wait(4000)]).then(() => wait(Math.max(0, 700 - (Date.now() - t0)))).then(() => { if (done()) { this.close(); then?.(); } });
    setTimeout(() => { if (id === this.respId) then?.(); }, 600); // in-app actions happen while the reply is spoken
    Promise.race([said, wait(12000)]).then(() => wait(Math.max(400, 1800 - (Date.now() - t0)))).then(() => { if (done()) { $('#assistant').hidden = true; Bus.emit('voice.idle'); } });
  },

  /* ---------- Speaking: Kokoro on the phone when downloaded, else the phone's own voice ---------- */
  speak(text) {
    this.hush(); const id = ++this.sayId;
    text = String(text || '').replace(/[“”"«»]/g, '').trim();
    if (!text || settings.tts === 'off') { Log.d('tts', 'Not spoken', { setting: settings.tts, text }); return Promise.resolve(); }
    if (settings.tts === 'neural' && this.tts && this.ttsBroken) Log.w('tts', 'On-device voice not working on this device: phone voice', { reason: this.ttsBroken });
    else if (settings.tts === 'neural' && this.tts) return this.speakNeural(text, id).catch(e => {
      Log.w('tts', 'On-device voice failed; using the phone voice', e); return id === this.sayId && this.speakPhone(text, id); });
    if (settings.tts === 'neural') Log.i('tts', store.get('kokoroOK') ? 'On-device voice still loading: phone voice this time' : 'On-device voice not downloaded: phone voice', { text });
    if (settings.tts === 'neural' && store.get('kokoroOK')) this.loadTTS().catch(() => {}); // from cache, ready for the next reply
    return this.speakPhone(text, id);
  },
  speakPhone(text, id) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      // Speaking straight after cancel() is dropped on some phones: give it a moment.
      setTimeout(() => {
        if (id !== this.sayId) return res();
        try {
          const u = this.utt = new SpeechSynthesisUtterance(text); // kept referenced, or onend may never fire
          this.played = true;
          u.rate = 1.03; u.lang = /^en/i.test(navigator.language) ? navigator.language : 'en-IN';
          const s = performance.now();
          u.onstart = () => { Log.d('tts', 'Phone voice started', { waitedMs: Math.round(performance.now() - s) }); Bus.emit('voice.talk', { on: true }); };
          u.onend = () => { Log.i('tts', `Phone voice done ${Math.round(performance.now() - s)} ms`); Bus.emit('voice.talk', { on: false }); res(); };
          u.onerror = e => { Log.e('tts', 'Phone voice error', { error: e.error }); Bus.emit('voice.talk', { on: false }); res(); };
          Log.i('tts', 'Phone voice', { text, lang: u.lang, voices: speechSynthesis.getVoices().length, pending: speechSynthesis.pending, speaking: speechSynthesis.speaking });
          speechSynthesis.speak(u);
        } catch { res(); }
      }, this.cancelled ? 150 : 0);
      setTimeout(res, 1800 + text.length * 85);
    });
  },
  /** Kokoro, one sentence at a time (the first plays while the rest are generated), through an <audio> element:
      unlike Web Audio, it isn't silenced by the phone's ring/silent switch. */
  async speakNeural(text, id) {
    const cfg = Diag.get(), queue = [], voice = TTS_VOICES[settings.ttsVoice] ? settings.ttsVoice : 'af_heart', t0 = performance.now();
    Budget.use('kokoro');
    let generating = true, playing = false, started = false, fail = null, finish, n = 0;
    const done = new Promise(r => (finish = r)); this.stopNeural = () => finish();
    Log.i('tts', 'On-device voice', { text, voice, out: cfg.out, session: cfg.session, unlocked: !!this.unlocked });
    const next = async () => {
      if (id !== this.sayId) return finish();
      const item = queue.shift();
      if (!item) { playing = false; if (!generating) finish(); return; }
      if (!started) { this.session(cfg.session); Log.i('tts', `First sound after ${Math.round(performance.now() - t0)} ms`, { engine: this.tts.kind }); } // loudspeaker, whatever the mic did last
      playing = started = true;
      try { await this.playChunk(item, cfg.out); }
      catch (e) { Log.e('tts', `Sentence ${item.n} could not play`, e); this.blocked = true; queue.length = 0; generating = false; return finish(); }
      next();
    };
    // A stuck or very slow model must not leave you in silence: after 8 s without sound, the phone's voice takes over.
    let watchdog = 0;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => {
      if (started) return;
      fail = new Error('The reply voice took too long'); Log.w('tts', 'Watchdog: no sound after 8 s', { sentences: n });
      // Twice in a row with nothing generated at all: the voice is broken here; stop making every reply wait 8 s.
      if (!n && ++this.ttsStalls >= 2) { this.ttsBroken = 'No sentence generated twice in a row'; Log.e('tts', 'On-device voice marked as not working: replies use the phone voice'); }
      finish();
    }, 8000); };
    // The timer starts when the worker begins this reply: a sentence of the previous reply may still be finishing.
    arm();
    (async () => {
      try {
        let g = performance.now();
        for await (const { text: sentence, f32, rate } of this.tts.sentences(text, voice, () => { if (!started && !n) arm(); })) {
          if (id !== this.sayId || fail) return; // leaving the loop cancels the rest of the reply
          const item = { n: ++n, f32, rate }; this.ttsStalls = 0; this.ttsBroken = '';
          Log.i('tts', `Sentence ${n} generated in ${Math.round(performance.now() - g)} ms`, { sentence, seconds: +(item.f32.length / item.rate).toFixed(2), rate: item.rate });
          g = performance.now();
          queue.push(item); if (!playing) next();
        }
      } catch (e) { fail ||= e; Log.e('tts', 'Generation failed', e); } finally { generating = false; if (!playing && !queue.length) finish(); }
    })();
    await done; clearTimeout(watchdog);
    if (id === this.sayId) this.session('auto');
    Log.i('tts', `On-device voice finished in ${Math.round(performance.now() - t0)} ms`, { sentences: n, started, blocked: !!this.blocked, failed: !!fail });
    if (this.blocked) { this.blocked = false; throw new Error('Audio playback was blocked'); }
    if (fail && !started) throw fail;
  },
  /** Play one generated sentence and resolve when it has finished. */
  async playChunk({ n, f32, rate }, out) {
    const secs = f32.length / rate;
    if (out === 'webaudio') {
      const ctx = this.audio(); if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      if (ctx.state !== 'running') throw new Error(`Web Audio is ${ctx.state}`);
      const buf = ctx.createBuffer(1, f32.length, rate); buf.copyToChannel(f32, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); this.played = true;
      Log.d('tts', `▶ sentence ${n} (Web Audio)`, { ctxRate: ctx.sampleRate, secs: +secs.toFixed(2) });
      const at = ctx.currentTime; Bus.emit('voice.audio', { f32, rate, now: () => ctx.currentTime - at });
      return new Promise(r => { src.onended = r; src.start(); this.src = src; setTimeout(r, secs * 1000 + 1500); }).finally(() => Bus.emit('voice.audio.end'));
    }
    this.played = true; // the next phone-recognizer turn resets the microphone first
    const el = this.player(), url = out === 'data' ? await wavDataUrl(f32, rate) : URL.createObjectURL(wavBlob(f32, rate));
    return new Promise((res, rej) => {
      let over = false, guard = 0;
      const end = (ok, why) => { if (over) return; over = true; clearTimeout(guard); if (url.startsWith('blob:')) URL.revokeObjectURL(url); Bus.emit('voice.audio.end');
        ok ? res() : rej(new Error(why || `Audio element error ${el.error?.code || ''} ${el.error?.message || ''}`)); };
      el.onended = () => { Log.d('tts', `■ sentence ${n} ended`); end(true); };
      el.onerror = () => end(false);
      el.src = url;
      // If play() never even starts, give up after 10 s; once it plays, allow the sentence's length plus 2 s for "ended".
      guard = setTimeout(() => end(false, 'Playback never started'), 10000);
      el.play().then(() => {
        Log.d('tts', `▶ sentence ${n} playing (${out})`, { secs: +secs.toFixed(2), volume: el.volume, muted: el.muted, readyState: el.readyState });
        Bus.emit('voice.audio', { f32, rate, now: () => el.currentTime }); // lip-sync for the avatar
        clearTimeout(guard);
        guard = setTimeout(() => { if (!over) Log.w('tts', `Sentence ${n}: no "ended" event, moving on`, { paused: el.paused, currentTime: el.currentTime }); end(true); }, secs * 1000 + 2000);
      }, e => end(false, e?.message || 'play() refused'));
    });
  },
  hush() {
    this.sayId++; this.stopNeural?.(); this.stopNeural = null;
    if (this.el && !this.el.paused && this.el.src !== silenceUrl) try { this.el.pause(); Log.d('tts', 'Reply cut off'); } catch {}
    try { this.src?.stop(); } catch {} this.src = null;
    this.cancelled = false;
    try { if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); this.cancelled = true; } } catch {}
    Bus.emit('voice.talk', { on: false }); Bus.emit('voice.audio.end');
    this.session('auto');
  },
  /** The phone's audio session (WebKit): 'auto' lets the microphone work; anything else can block it. */
  session(type) {
    try { if (navigator.audioSession && navigator.audioSession.type !== type) { Log.d('audio', `Audio session ${navigator.audioSession.type} → ${type}`); navigator.audioSession.type = type; } }
    catch (e) { Log.w('audio', `Audio session ${type} refused`, e); }
  },
  audio() { return (this.ac ||= new (window.AudioContext || window.webkitAudioContext)()); },
  /** Forget the loaded voice (after changing engine or device in diagnostics); the next reply loads it again. */
  resetSTT() { try { this.pipe?.dispose?.(); } catch {} this.pipe = null; this.loading = null; this.asrQ = null; Budget.drop('whisper'); Log.mem('whisper', null); Log.i('stt', 'Whisper unloaded'); },
  resetTTS() { this.hush(); try { this.tts?.terminate(); } catch {} this.tts = null; this.ttsLoading = null; this.ttsBroken = ''; this.ttsStalls = 0; Budget.drop('kokoro'); Log.mem('kokoro', null); Log.i('tts', 'On-device voice unloaded'); },
  player() { if (!this.el) { this.el = new Audio(); this.el.playsInline = true; this.el.preload = 'auto'; } return this.el; },
  /** Phones only let a page make sound after a tap, and replies come seconds later. So on a tap, play a moment
      of silence on the reply player and start an empty utterance: both may then speak later without a tap. */
  unlock() {
    if (this.unlocked) return;
    const el = this.player();
    try { el.src = SILENCE(); const p = el.play(); p?.then(() => { this.unlocked = true; Log.i('audio', 'Reply player unlocked by a tap'); }).catch(e => Log.w('audio', 'Reply player unlock refused', e)); } catch (e) { Log.w('audio', 'Unlock failed', e); }
    try { if ('speechSynthesis' in window && !speechSynthesis.speaking) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); Log.d('audio', 'Phone voice primed by a tap'); } } catch {}
  },
  /** Memory the reply voice needs: the build given, or the best one this device will try first. */
  ttsCost(device = Diag.get().device, dtype = device === 'webgpu' && store.get('gpuF16') ? 'fp16' : 'fp32') {
    return Budget.COST[device === 'webgpu' ? `kokoro webgpu ${dtype}` : 'kokoro wasm'] || 220;
  },
  /** Load the reply voice. `show` (asked for by you: progress shown) makes room for it; otherwise it's a preload that only uses a free slot. */
  loadTTS(show) {
    if (this.tts) { Budget.use('kokoro'); return Promise.resolve(this.tts); }
    if (!this.ttsLoading && !Budget.room('kokoro', this.ttsCost(), !!show)) return Promise.reject(new Error('No memory to spare for the reply voice on this device right now'));
    this.ttsLoading ||= Heavy.run('reply voice', () => this.loadTTSNow(show));
    return this.ttsLoading.then(t => (this.tts = t), e => { this.ttsLoading = null; Log.e('tts', 'On-device voice failed to load', e); throw e; });
  },
  /** Try the best build first: GPU 16-bit (half the memory) → GPU 32-bit → CPU. Each must load and pass a warm-up. */
  async loadTTSNow(show) {
    const cfg = Diag.get(), files = {}, voice = TTS_VOICES[settings.ttsVoice] ? settings.ttsVoice : 'af_heart';
    const onProgress = show ? p => this.progress(p, files, 'reply voice') : p => p.status && !/progress/.test(p.status) && Log.d('model', `reply voice: ${p.status} ${p.file || ''}`);
    const builds = (cfg.device === 'webgpu' ? [...((await gpuFeatures()).f16 ? [['webgpu', 'fp16']] : []), ['webgpu', 'fp32'], ['wasm', 'q8']] : [['wasm', 'q8']])
      .filter(([d, t]) => d === 'wasm' || !Budget.tooBig(`Reply voice ${d} ${t}`)); // the CPU build is always kept as the last resort
    let lastErr;
    for (const [device, dtype] of builds) {
      const s = performance.now(); Log.i('tts', 'Loading the on-device voice (Kokoro)', { cached: ttsDownloaded().includes(dtype), engine: cfg.engine, device, dtype });
      let engine = null;
      try {
        if (cfg.engine !== 'main' && typeof Worker !== 'undefined') {
          try { engine = kokoroWorker(); await Budget.guard(`Reply voice ${device} ${dtype}`, () => engine.load({ dtype, device }, onProgress)); }
          catch (e) { Log.w('tts', 'Background worker failed: loading on the main thread instead', e); try { engine?.terminate(); } catch {} engine = null; }
        }
        if (!engine) {
          const K = await import(KOKORO_URL);
          engine = kokoroMain(K, await Budget.guard(`Reply voice ${device} ${dtype}`, () => K.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype, device, progress_callback: onProgress })));
        }
        $('#vProg').hidden = true; store.set('kokoroOK', true); store.set('kokoroDl', [...new Set([...ttsDownloaded(), dtype])]);
        Log.i('tts', `On-device voice loaded ${Math.round(performance.now() - s)} ms (${engine.kind}, ${device} ${dtype})`, { streamShim: !!window.__rsIterShim });
        // Warm-up: one short sentence proves the whole chain (dictionary, phonemes, model) works here, and makes the first reply faster.
        const w = performance.now();
        const a = await Promise.race([engine.generate('Ready.', voice), new Promise((_, rej) => setTimeout(() => rej(new Error('Warm-up took over 20 s')), 20000))]);
        this.ttsBroken = ''; Log.i('tts', `On-device voice works: warm-up ${Math.round(performance.now() - w)} ms`, { seconds: +(a.f32.length / a.rate).toFixed(2), engine: engine.kind, device, dtype });
        if (device === 'wasm' && cfg.device === 'webgpu') this.gpuGaveUp(lastErr);
        engine.device = device; engine.dtype = dtype; Log.mem('kokoro', `${device === 'webgpu' ? 'GPU' : 'CPU'} ${dtype} (${engine.kind})`);
        Budget.add('kokoro', `${device} ${dtype}`, () => this.resetTTS(), this.ttsCost(device, dtype));
        return engine;
      } catch (e) {
        lastErr = e;
        if (device === 'wasm') { // the last option: keep it if it loaded; replies fall back to the phone voice
          if (!engine) throw e;
          this.ttsBroken = e?.message || 'Warm-up failed'; Log.e('tts', 'On-device voice warm-up failed: replies use the phone voice', e);
          Log.mem('kokoro', `CPU q8 (${engine.kind}, not working)`); Budget.add('kokoro', 'wasm q8', () => this.resetTTS(), Budget.COST['kokoro wasm']); return engine;
        }
        try { engine?.terminate(); } catch {}
        Log.w('tts', `On-device voice ${device} ${dtype} failed: trying the next option`, e);
      }
    }
    throw lastErr;
  },
  /** No GPU build worked: remember it; the CPU from now on. */
  gpuGaveUp(e) {
    Log.w('tts', 'GPU voice failed: switching to the CPU for good on this device', e);
    store.set('gpuFailed', true); const d = store.get('diag', {}); if (d.device === 'webgpu') { delete d.device; store.set('diag', d); }
  },
  progress(p, files, what) {
    if (p.status && !/progress/.test(p.status)) Log.d('model', `${what}: ${p.status} ${p.file || ''}`);
    if (p.status !== 'progress' || !p.total) return;
    files[p.file] = [p.loaded, p.total];
    const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
    $('#vProg').hidden = false; $('#vProg i').style.width = (l / t * 100).toFixed(1) + '%';
    $('#vProg span').textContent = `Downloading ${what} · ${Math.round(l / 1e6)} of ${Math.round(t / 1e6)} MB`;
  },
  level(rms) { $('#vOrb').style.setProperty('--lv', Math.min(1, rms * 12).toFixed(2)); },
  engine() { return settings.stt === 'browser' && SR ? 'browser' : settings.stt === 'whisper' ? 'whisper' : SR ? 'browser' : 'whisper'; },

  async start() {
    if (!$('#assistant').hidden && (this.rec || this.sr)) return this.stopRec(); // tap again = done talking
    Log.i('voice', 'Mic tapped', { engine: this.engine(), tts: settings.tts, whisperLoaded: !!this.pipe, whisperDownloaded: !!store.get('whisperOK'),
      voiceLoaded: !!this.tts, voiceDownloaded: !!store.get('kokoroOK'), playerUnlocked: !!this.unlocked, silence: settings.vadSilence, lang: settings.voiceLang });
    this.hush(); this.respId++; this.unlock(); Bus.emit('voice.listen');
    if (this.pipe?.alive && !this.pipe.alive()) { Log.w('stt', 'Whisper worker had stopped: reloading it'); this.resetSTT(); }
    this.open(); $('#vChips').hidden = false;
    this.show('Listening…', this.engine() === 'whisper' ? 'On-device · Whisper base' : 'Phone speech recognition');
    const whisperFirst = this.engine() === 'whisper' && !this.pipe && !store.get('whisperOK'); // its prompt offers both downloads
    if (settings.tts === 'neural' && !store.get('kokoroOK') && !store.get('ttsAsked') && !whisperFirst) {
      store.set('ttsAsked', true); this.close();
      const go = () => { this.open(); this.start(); };
      return sheet('A natural reply voice', `<p>DriveDeck can answer in a natural voice made on this device (<b>Kokoro</b>) instead of the built-in, mechanical-sounding one. Works offline once downloaded.</p>
        <p class="hint">One-time download of about ${ttsSize()} (use Wi-Fi).</p>`,
        [['Download now', () => { this.loadTTS(true).then(() => this.speak('Hi, this is my new voice.')).catch(e => console.warn(e)); go(); }],
          ['Keep the phone’s voice', () => { settings.tts = 'phone'; applySettings(); go(); }], ['Later', go]]);
    }
    if (settings.tts === 'neural' && store.get('kokoroOK')) this.loadTTS().catch(() => {}); // warm up while you talk
    if (this.engine() === 'browser') return this.listenBrowser();
    if (!this.pipe && !store.get('whisperOK')) {
      this.close();
      return sheet('On-device voice', `<p>DriveDeck can understand you on the phone itself with <b>Whisper base</b>, OpenAI’s multilingual speech model. It works offline and understands English, Hindi, Kannada, Tamil and more. Other languages are translated to English commands.</p>
        <p>It can answer in a natural voice made on the phone too (<b>Kokoro</b>), instead of the phone’s robotic one.</p>
        <p class="hint">One-time download: about ${Diag.get().stt === 'webgpu' ? 140 : 80} MB for listening, ${ttsSize()} more for the reply voice (use Wi-Fi). Both are kept on this device.</p>`,
        [['Download both', () => { store.set('ttsAsked', true); settings.tts = 'neural'; store.set('settings', settings);
          this.open(); this.loadModel().then(() => { this.listenWhisper(); this.loadTTS().catch(() => {}); }).catch(e => this.fail(e)); }],
          ['Listening only', () => { store.set('ttsAsked', true); this.open(); this.loadModel().then(() => this.listenWhisper()).catch(e => this.fail(e)); }],
          ...(SR ? [['Use phone recognition instead', () => { settings.stt = 'browser'; applySettings(); this.start(); }]] : []), ['Not now']]);
    }
    const tok = this.startTok;
    try {
      if (!this.pipe) { this.show('Loading voice model…', 'Whisper base · on-device'); await this.loadModel(); }
      if (tok !== this.startTok) return Log.d('voice', 'Closed while the model loaded: not listening');
      this.listenWhisper(tok);
    }
    catch (e) { this.fail(e); }
  },
  fail(e) {
    Log.e('voice', 'Voice failed', e);
    this.show('Voice isn’t available right now', SR ? 'Switching to phone recognition' : 'Tap a suggestion instead');
    if (SR && this.engine() === 'whisper') setTimeout(() => this.listenBrowser(), 900);
  },

  /* Whisper via transformers.js (ONNX runtime in WebAssembly); model files are cached for offline use. */
  loadModel() {
    if (this.pipe) return Promise.resolve(this.pipe);
    if (!this.loading) Budget.room('whisper', Budget.COST[`whisper ${Diag.get().stt}`] || 300, true);
    this.loading ||= Heavy.run('Whisper', async () => {
      const want = Diag.get().stt, s = performance.now(), files = {};
      if (want === 'webgpu') await gpuFeatures();
      Log.i('stt', 'Loading Whisper', { cached: !!store.get('whisperOK'), device: want });
      let lastErr;
      for (const build of [...whisperBuilds(want), ...(want === 'webgpu' ? whisperBuilds('wasm') : [])]) {
        try {
          const pipe = await createWhisper(build, p => this.progress(p, files, 'voice model'));
          if (build.device === 'wasm' && want === 'webgpu') { Log.w('stt', 'Whisper on the GPU failed: using the CPU'); Diag.set('stt', 'wasm'); }
          this.pipeDevice = build.device; this.pipeBuild = build.label; Log.mem('whisper', `${build.label} (${pipe.kind})`);
          Budget.add('whisper', build.label, () => this.resetSTT(), Budget.COST[`whisper ${build.device}`]);
          $('#vProg').hidden = true; store.set('whisperOK', true); if (build.device === 'webgpu') store.set('whisperGpuOK', true);
          Log.i('stt', `Whisper ready ${Math.round(performance.now() - s)} ms (${build.label}, ${pipe.kind})`);
          return pipe;
        } catch (e) { lastErr = e; Log.w('stt', `Whisper ${build.label} failed to load`, e); }
      }
      throw lastErr;
    });
    return this.loading.then(p => (this.pipe = p), e => { this.loading = null; Log.e('stt', 'Whisper failed to load', e); throw e; });
  },
  /* Listening: record until you've been quiet for the “act after” time (5 s by default). About 0.7 s into a pause
     Whisper already transcribes what it has; if you say nothing more, that guess is used, so the action happens right at the deadline. */
  async listenWhisper(tok = this.startTok) {
    // Nothing may be playing or holding the audio session while the microphone opens.
    this.hush();
    const opts = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    let stream;
    const g = performance.now();
    try { stream = await navigator.mediaDevices.getUserMedia(opts); }
    catch (e) {
      // Often the microphone is still being released from the last turn or a reply: reset and try once more.
      Log.w('mic', 'Microphone refused, retrying', { name: e.name, message: e.message, session: navigator.audioSession?.type }); this.session('auto'); await new Promise(r => setTimeout(r, 400));
      try { stream = await navigator.mediaDevices.getUserMedia(opts); }
      catch (e2) { Log.e('mic', 'Microphone refused', { name: e2.name, message: e2.message }); return this.micError(e2); }
    }
    if (tok !== this.startTok) { stream.getTracks().forEach(t => t.stop()); return Log.d('voice', 'Closed while the microphone opened: not listening'); }
    const track = stream.getAudioTracks()[0];
    Log.i('mic', `Microphone open ${Math.round(performance.now() - g)} ms`, { label: track?.label, settings: track?.getSettings?.() });
    track?.addEventListener('mute', () => Log.w('mic', 'Microphone muted by the system'));
    track?.addEventListener('ended', () => Log.w('mic', 'Microphone track ended'));
    let ctx; try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
    const src = ctx.createMediaStreamSource(stream), rate = ctx.sampleRate, limit = Math.max(1, +settings.vadSilence || 5);
    const st = { chunks: [], heard: false, quiet: 0, total: 0, noise: 0.008, guess: null, left: 0 };
    const onChunk = d => {
      if (this.rec?.st !== st) return;
      st.chunks.push(d);
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length), dt = d.length / rate; st.total += dt; this.level(rms);
      if (rms > Math.max(0.018, st.noise * 3)) {
        if (!st.heard) Log.i('stt', `Speech started at ${st.total.toFixed(1)} s`, { rms: +rms.toFixed(3), noise: +st.noise.toFixed(4) });
        else if (st.left) Log.d('stt', 'More speech; waiting again');
        if (!st.heard || st.left) this.show(st.guess ? $('#asstText').textContent : 'Listening…', 'Speak now · tap the orb when done');
        st.heard = true; st.quiet = 0; st.guess = null; st.left = 0; st.lastVoice = performance.now(); // more words: the earlier guess is stale
      } else { st.quiet += dt; if (!st.heard) st.noise = st.noise * 0.9 + rms * 0.1; }
      if (st.heard && st.quiet > 0.7) {
        if (!st.guess && !this.inferring) this.guess(st, rate);
        const left = Math.ceil(limit - st.quiet);
        if (left !== st.left && left > 0) { st.left = left; $('#asstHint').textContent = `Acting in ${left} s · tap the orb to go now`; }
      }
      if ((st.heard && st.quiet >= limit) || st.total > 30 || (!st.heard && st.total > 8)) {
        Log.i('stt', st.heard ? (st.total > 30 ? 'Stopped: 30 s limit' : `Stopped: ${limit} s of quiet`) : 'Stopped: no speech in 8 s', { seconds: +st.total.toFixed(1) });
        this.stopRec();
      }
    };
    let node = null;
    if (ctx.audioWorklet && window.AudioWorkletNode) try {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([REC_WORKLET], { type: 'text/javascript' })));
      node = new AudioWorkletNode(ctx, 'dd-rec'); node.port.onmessage = e => onChunk(e.data);
    } catch { node = null; }
    if (!node) { node = ctx.createScriptProcessor(4096, 1, 1); node.onaudioprocess = e => onChunk(new Float32Array(e.inputBuffer.getChannelData(0))); }
    src.connect(node); node.connect(ctx.destination);
    Log.i('mic', 'Recording', { ctxRate: ctx.sampleRate, ctxState: ctx.state, recorder: node.port ? 'AudioWorklet' : 'ScriptProcessor', actAfter: limit });
    this.rec = { stream, ctx, node, src, st };
    $('#vOrb').classList.add('live');
  },
  micError(e) {
    Log.e('mic', 'Microphone unavailable', { name: e?.name, message: e?.message });
    $('#vOrb').classList.remove('live');
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError')
      return this.show('Microphone permission is off', 'Allow the microphone for this site in the phone’s settings, then reopen DriveDeck');
    this.show('The microphone is busy', `Another app may be using it${e?.name ? ` (${e.name})` : ''}. Tap the mic to try again`);
  },
  /** Transcribe what's been said so far, during a pause. */
  guess(st, rate) {
    Log.d('stt', 'Pause: transcribing what was said so far');
    const p = this.toAudio(st.chunks.slice(), rate).then(a => this.recognise(a));
    st.guess = p;
    p.then(r => { if (st.guess === p && this.rec?.st === st && r.text) $('#asstText').textContent = `“${r.text}”`; }).catch(() => {});
  },
  async stopRec(discard) {
    const r = this.rec; if (!r) return; this.rec = null;
    Log.d('mic', discard ? 'Recording discarded' : 'Recording stopped', { heard: r.st.heard, usingGuess: !!r.st.guess });
    try { r.node.disconnect(); r.src.disconnect(); if (r.node.port) r.node.port.onmessage = null; } catch {}
    r.stream.getTracks().forEach(t => t.stop());
    const rate = r.ctx.sampleRate, st = r.st; r.ctx.close().catch(() => {});
    $('#vOrb').classList.remove('live'); this.session('auto');
    if (discard) return;
    if (!st.heard) { this.show('I didn’t hear anything', 'Tap the mic and try again'); this.closeT = setTimeout(() => this.close(), 2500); return; }
    if (!st.guess) this.show('Understanding…', 'Whisper · on-device');
    try {
      const res = await (st.guess || this.toAudio(st.chunks, rate).then(a => this.recognise(a)));
      if (!res.text || /^(thank you|thanks for watching|you)[.!]*$/i.test(res.text) && res.secs < 1.6) { Log.w('stt', 'Nothing usable recognised', res); return this.show('I didn’t catch that', 'Tap the mic and try again'); }
      Log.i('stt', `Recognised ${Math.round(res.doneAt - st.lastVoice)} ms after you stopped talking (Whisper ${this.pipeDevice === 'webgpu' ? 'GPU' : 'CPU'}, ${res.ms} ms to transcribe)`,
        { text: res.text, actAfterSeconds: +settings.vadSilence || 5, note: 'the action waits for the act-after time' });
      this.heard(res.text, { engine: 'Whisper', lang: res.lang, ms: res.ms });
    } catch (e) { this.fail(e); }
  },
  async toAudio(chunks, rate) {
    let audio = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)), o = 0;
    for (const c of chunks) { audio.set(c, o); o += c.length; }
    return rate === 16000 ? audio : resample(audio, rate, 16000);
  },
  /** Whisper, one run at a time. */
  recognise(audio) {
    const lang = LANGS[settings.voiceLang] || LANGS.auto;
    const run = async () => {
      this.inferring = true; Budget.use('whisper'); const t0 = performance.now();
      try {
        const out = await this.pipe(audio, { language: lang[1], task: lang[1] === 'en' ? 'transcribe' : 'translate' });
        Log.i('stt', `Whisper ${Math.round(performance.now() - t0)} ms for ${(audio.length / 16000).toFixed(1)} s of audio`, { text: out.text, lang: lang[1] || 'auto' });
        return { text: (out.text || '').trim().replace(/^[\s"“]+|[\s"”]+$/g, ''), ms: Math.round(performance.now() - t0), doneAt: performance.now(), secs: audio.length / 16000,
          lang: lang[1] && lang[1] !== 'en' ? `${lang[1].toUpperCase()} → EN` : '' };
      } finally { this.inferring = false; }
    };
    return (this.asrQ = (this.asrQ || Promise.resolve()).catch(() => {}).then(run));
  },

  /* Browser engine: live partial results while you speak. */
  /* Phone recognizer. On iPhone/iPad it works once, then often hears nothing after a reply has played: WebKit leaves the
     phone's audio session set up for playback, so the recognizer gets no microphone audio and gives up with "No speech
     detected". So before listening: free the reply player, put the session in record mode, and (after anything has played)
     open and close the microphone once, which resets the session. If it still gets no audio within 3 s, it's reset and
     restarted once, and after that Whisper takes over for the turn when it's downloaded. Diag 'sr' = 'plain' turns this off. */
  async listenBrowser(retry = 0) {
    if (!SR) return this.show('Voice input isn’t supported in this browser', 'Tap a suggestion');
    const tok = this.startTok, cfg = Diag.get();
    this.hush();
    if (cfg.sr !== 'plain') {
      this.releasePlayer();
      if (this.played || retry) await this.primeMic();
      if (tok !== this.startTok) return;
      this.session('play-and-record');
    }
    try {
      const r = this.sr = new SR(); r.lang = (LANGS[settings.voiceLang] || LANGS.auto)[2]; r.interimResults = true;
      let text = '', done = false, lastChange = performance.now(), audio = false, guard = 0;
      const latency = () => Log.i('stt', `Recognised ${Math.round(performance.now() - lastChange)} ms after your last word (phone recognizer)`, { text });
      const finish = () => { clearTimeout(guard); if (this.sr === r) this.sr = null; $('#vOrb').classList.remove('live'); if (cfg.sr !== 'plain') this.session('auto'); };
      Log.i('stt', 'Phone recognizer starting', { lang: r.lang, retry, primed: cfg.sr !== 'plain' && (this.played || !!retry), session: navigator.audioSession?.type });
      r.onstart = () => {
        Log.d('stt', 'Phone recognizer listening');
        // No microphone audio at all within 3 s means the recognizer is stuck, not that you're quiet.
        guard = setTimeout(() => { if (audio || done || this.sr !== r) return; Log.w('stt', 'Phone recognizer gets no audio: resetting'); done = true; this.recover(r, retry); }, 3000);
      };
      r.onaudiostart = () => { audio = true; Log.d('stt', 'Phone recognizer audio started'); };
      r.onsoundstart = () => Log.d('stt', 'Phone recognizer hears sound');
      r.onspeechstart = () => Log.d('stt', 'Phone recognizer hears speech');
      r.onresult = e => {
        audio = true;
        const t = [...e.results].map(x => x[0].transcript).join(' ').trim();
        if (t !== text) lastChange = performance.now();
        text = t;
        Log.d('stt', `Phone recognizer ${e.results[e.results.length - 1].isFinal ? 'final' : 'interim'}`, { text });
        this.show(`“${text}”`, 'Listening…');
        if (e.results[e.results.length - 1].isFinal && !done) { done = true; finish(); latency(); this.srFails = 0; this.heard(text, { engine: 'Phone' }); }
      };
      r.onerror = e => {
        Log.e('stt', 'Phone recognizer error', { error: e.error, message: e.message, audio }); finish(); if (done) return; done = true;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') return this.show('Microphone or speech permission is off', 'Allow them for this site in the phone’s settings');
        if (e.error === 'aborted' && $('#assistant').hidden) return; // you closed it
        if (!audio && cfg.sr !== 'plain') return this.recover(r, retry);
        this.show('Couldn’t hear you', 'Tap the mic and try again');
      };
      // Some phones end without a “final” result: use what was heard so far, and never leave the mic stuck.
      r.onend = () => { Log.d('stt', 'Phone recognizer ended', { text, done, audio }); finish(); if (done) return; done = true;
        if (text) { latency(); this.srFails = 0; return this.heard(text, { engine: 'Phone' }); }
        if (!audio && cfg.sr !== 'plain') return this.recover(r, retry);
        this.show('I didn’t hear anything', 'Tap the mic and try again'); };
      r.start(); $('#vOrb').classList.add('live');
    } catch (e) { Log.e('stt', 'Phone recognizer could not start', e); this.session('auto'); this.show('Tap a suggestion'); }
  },
  /** The recognizer got no audio: try once more after resetting the microphone, then Whisper (if downloaded). */
  recover(r, retry) {
    try { r.abort(); } catch {}
    if (this.sr === r) this.sr = null;
    this.srFails = (this.srFails || 0) + 1;
    if ($('#assistant').hidden) return;
    if (!retry) { this.show('Listening…', 'Resetting the microphone'); return this.listenBrowser(1); }
    if (store.get('whisperOK')) { Log.w('stt', 'Phone recognizer still deaf: Whisper takes this turn'); this.show('Listening…', 'On-device · Whisper base');
      return this.loadModel().then(() => this.listenWhisper()).catch(e => this.fail(e)); }
    this.show('The phone’s recognizer isn’t hearing the microphone', 'Tap the mic to try again, or choose Whisper in Settings › Voice');
  },
  /** Stop the reply player holding the audio session (iOS keeps it in playback mode while an <audio> has a source). */
  releasePlayer() {
    const el = this.el; if (el && el.getAttribute('src') && el.src !== silenceUrl) { try { el.pause(); el.removeAttribute('src'); el.load(); } catch {} }
    // The radio, paused while you talk, holds the session too: let go of its stream (it reconnects when it resumes).
    if (typeof Radio !== 'undefined' && Radio.held && Radio.el?.getAttribute('src')) { try { Radio.hlsObj?.destroy(); Radio.hlsObj = null; Radio.el.removeAttribute('src'); Radio.el.load(); } catch {} }
  },
  /** Open and close the microphone: resets the phone's audio session so the recognizer can hear again. */
  async primeMic() {
    const t = performance.now();
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(x => x.stop()); this.played = false;
      Log.d('mic', `Microphone primed for the recognizer in ${Math.round(performance.now() - t)} ms`); }
    catch (e) { Log.w('mic', 'Priming the microphone failed', { name: e.name, message: e.message }); }
  },
  /** A phrase was recognised: show it, log it, act on it. */
  heard(text, meta) {
    Log.i('stt', `Heard: “${text}”`, meta);
    this.show(`“${text}”`, 'Heard'); $('#vChips').hidden = true;
    VoiceLog.you(text, meta); Bus.emit('voice.heard', { value: text, engine: meta?.engine });
    setTimeout(() => handleCommand(text, true), 350);
  },
};
/** 16-bit mono WAV, for the reply player. */
function wavBlob(f32, rate) {
  const n = f32.length, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i])) * 0x7fff, true);
  return new Blob([b], { type: 'audio/wav' });
}
function wavDataUrl(f32, rate) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(wavBlob(f32, rate)); });
}
let silenceUrl;
const SILENCE = () => (silenceUrl ||= URL.createObjectURL(wavBlob(new Float32Array(1200), 24000)));
async function resample(data, from, to) {
  const ctx = new OfflineAudioContext(1, Math.ceil(data.length * to / from), to);
  const buf = ctx.createBuffer(1, data.length, from); buf.copyToChannel(data, 0);
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start();
  return (await ctx.startRendering()).getChannelData(0);
}
$('#vOrb').addEventListener('click', () => Voice.rec ? Voice.stopRec() : Voice.start());
// Load the downloaded reply voice soon after launch, so even the first reply (or spoken direction) uses it.
setTimeout(() => { if (settings.tts === 'neural' && store.get('kokoroOK') && !Voice.tts) { Log.d('tts', 'Preloading the reply voice'); Voice.loadTTS().catch(() => {}); } }, 4000);
addEventListener('pointerdown', () => Voice.unlock(), { capture: true, passive: true });

/* ---------- Assistant widget: a hands-free conversation view ---------- */
W.chat = { name: 'Assistant', html: () => `<div class="chatw">
    <div class="chat-head"><b>Assistant</b><button class="chat-mic" data-action="assistant" aria-label="Talk">${svg('mic')}<span>Talk</span></button></div>
    <div class="chat-log" data-html="chat" data-scroll></div>
    <div class="chat-quick" data-html="chatQuick"></div></div>` };
