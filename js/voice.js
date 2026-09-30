'use strict';
/* ============================================================
   Voice: speech to text, the listening box and the conversation log.
   Engines: on-device Whisper (base, multilingual, via transformers.js)
   or the browser's own recognizer. Loaded after dash.js.
   ============================================================ */
const WHISPER_MODEL = 'onnx-community/whisper-base';
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
//   engine:  'worker' (Kokoro in a background worker: the app stays responsive and sentence 1 plays while 2 is made) · 'main'
//   device:  'webgpu' (GPU, fp32, ~310 MB: on iPad about 3× faster than real time, so no pauses) where WebGPU exists and
//            hasn't failed here before · else 'wasm' (CPU, q8, ~90 MB: slower than real time on a tablet)
const gpuOK = () => !!navigator.gpu && !store.get('gpuFailed');
/** Which reply-voice models are downloaded ('q8' CPU, 'fp32' GPU). Before this was tracked, only the CPU one existed. */
const ttsDownloaded = () => store.get('kokoroDl') || (store.get('kokoroOK') ? ['q8'] : []);
const Diag = {
  // GPU by default where it works, unless this device already has only the CPU voice (no surprise 310 MB download): then it's opt-in.
  get: () => ({ stt: 'wasm', out: 'data', session: 'playback', engine: 'worker',
    device: gpuOK() && (!ttsDownloaded().length || ttsDownloaded().some(d => d.startsWith('fp'))) ? 'webgpu' : 'wasm', ...store.get('diag', {}) }),
  set(k, v) {
    store.set('diag', { ...store.get('diag', {}), [k]: v }); Log.i('diag', `Reply ${k} → ${v}`);
    if ((k === 'engine' || k === 'device') && typeof Voice !== 'undefined') Voice.resetTTS();
    if (k === 'stt' && typeof Voice !== 'undefined') Voice.resetSTT();
  },
};

/* ---------- Kokoro engines: the same small interface on the main thread or in a worker ----------
   sentences(text, voice) → async iterable of { text, f32, rate } · generate(text, voice) → { f32, rate } · terminate() */
/** Whisper settings per device. The GPU build keeps the encoder in full precision and the decoder 4-bit (the
    combination transformers.js recommends for WebGPU); the CPU build is 8-bit throughout. */
/** Whisper builds to try on a device, best first. On the GPU: a 16-bit encoder where the GPU supports it (half the memory), else 32-bit. */
function whisperBuilds(dev) {
  const cpu = { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, label: 'CPU q8' };
  if (dev !== 'webgpu') return [cpu];
  const gpu = enc => ({ device: 'webgpu', dtype: { encoder_model: enc, decoder_model_merged: 'q4' }, label: `GPU ${enc}/q4` });
  return [...(store.get('gpuF16') ? [gpu('fp16')] : []), gpu('fp32')];
}
async function createWhisper(build, onProgress) {
  const T = await import(TRANSFORMERS_URL);
  T.env.allowLocalModels = false;
  if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;
  return T.pipeline('automatic-speech-recognition', WHISPER_MODEL, { device: build.device, dtype: build.dtype, progress_callback: onProgress });
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
/** Download size of the reply voice for this device, for the prompts. */
const ttsSize = () => Diag.get().device === 'webgpu' ? (store.get('gpuF16') ? '165 MB' : '310 MB') : '90 MB';
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
    sentences(text, voice) {
      const q = [], waiting = []; let over = false, err = null;
      const put = v => (waiting.length ? waiting.shift()(v) : q.push(v));
      const id = call({ type: 'speak', text, voice }, m => {
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
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
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
  },
  show(text, hint = '') { $('#asstText').textContent = text; $('#asstHint').textContent = hint; },
  reply(text) {
    const app = VoiceLog.app(text), [ic, col, name] = APP_LOOK[app];
    $('#vReply').innerHTML = `<span class="av" style="background:${col}">${svg(ic)}</span><span>${esc(text)}</span>`;
    $('#vReply').hidden = false; $('#vChips').hidden = true;
  },
  /** Show and log a reply, say it and act. Hand-offs to other apps wait for the reply to finish (up to 4 s) so it isn't cut off. */
  respond(msg, then, o = {}) {
    this.reply(msg); clearTimeout(this.closeT); Log.i('reply', msg, { leaves: !!o.leaves });
    const id = ++this.respId, t0 = Date.now(), wait = ms => new Promise(r => setTimeout(r, ms)), said = speak(msg) || Promise.resolve();
    const done = () => id === this.respId && !this.rec && !this.sr;
    if (o.leaves) return Promise.race([said, wait(4000)]).then(() => wait(Math.max(0, 700 - (Date.now() - t0)))).then(() => { if (done()) { this.close(); then?.(); } });
    setTimeout(() => { if (id === this.respId) then?.(); }, 600); // in-app actions happen while the reply is spoken
    Promise.race([said, wait(12000)]).then(() => wait(Math.max(400, 1800 - (Date.now() - t0)))).then(() => { if (done()) $('#assistant').hidden = true; });
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
          u.rate = 1.03; u.lang = /^en/i.test(navigator.language) ? navigator.language : 'en-IN';
          const s = performance.now();
          u.onstart = () => Log.d('tts', 'Phone voice started', { waitedMs: Math.round(performance.now() - s) });
          u.onend = () => { Log.i('tts', `Phone voice done ${Math.round(performance.now() - s)} ms`); res(); };
          u.onerror = e => { Log.e('tts', 'Phone voice error', { error: e.error }); res(); };
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
    const watchdog = setTimeout(() => {
      if (started) return;
      fail = new Error('The reply voice took too long'); Log.w('tts', 'Watchdog: no sound after 8 s', { sentences: n });
      // Twice in a row with nothing generated at all: the voice is broken here; stop making every reply wait 8 s.
      if (!n && ++this.ttsStalls >= 2) { this.ttsBroken = 'No sentence generated twice in a row'; Log.e('tts', 'On-device voice marked as not working: replies use the phone voice'); }
      finish();
    }, 8000);
    (async () => {
      try {
        let g = performance.now();
        for await (const { text: sentence, f32, rate } of this.tts.sentences(text, voice)) {
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
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      Log.d('tts', `▶ sentence ${n} (Web Audio)`, { ctxRate: ctx.sampleRate, secs: +secs.toFixed(2) });
      return new Promise(r => { src.onended = r; src.start(); this.src = src; setTimeout(r, secs * 1000 + 1500); });
    }
    const el = this.player(), url = out === 'data' ? await wavDataUrl(f32, rate) : URL.createObjectURL(wavBlob(f32, rate));
    return new Promise((res, rej) => {
      let over = false, guard = 0;
      const end = (ok, why) => { if (over) return; over = true; clearTimeout(guard); if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        ok ? res() : rej(new Error(why || `Audio element error ${el.error?.code || ''} ${el.error?.message || ''}`)); };
      el.onended = () => { Log.d('tts', `■ sentence ${n} ended`); end(true); };
      el.onerror = () => end(false);
      el.src = url;
      // If play() never even starts, give up after 10 s; once it plays, allow the sentence's length plus 2 s for "ended".
      guard = setTimeout(() => end(false, 'Playback never started'), 10000);
      el.play().then(() => {
        Log.d('tts', `▶ sentence ${n} playing (${out})`, { secs: +secs.toFixed(2), volume: el.volume, muted: el.muted, readyState: el.readyState });
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
    this.session('auto');
  },
  /** The phone's audio session (WebKit): 'auto' lets the microphone work; anything else can block it. */
  session(type) {
    try { if (navigator.audioSession && navigator.audioSession.type !== type) { Log.d('audio', `Audio session ${navigator.audioSession.type} → ${type}`); navigator.audioSession.type = type; } }
    catch (e) { Log.w('audio', `Audio session ${type} refused`, e); }
  },
  audio() { return (this.ac ||= new (window.AudioContext || window.webkitAudioContext)()); },
  /** Forget the loaded voice (after changing engine or device in diagnostics); the next reply loads it again. */
  resetSTT() { try { this.pipe?.dispose?.(); } catch {} this.pipe = null; this.loading = null; Log.mem('whisper', null); Log.i('stt', 'Whisper unloaded'); },
  resetTTS() { this.hush(); try { this.tts?.terminate(); } catch {} this.tts = null; this.ttsLoading = null; this.ttsBroken = ''; this.ttsStalls = 0; Log.mem('kokoro', null); Log.i('tts', 'On-device voice unloaded'); },
  player() { if (!this.el) { this.el = new Audio(); this.el.playsInline = true; this.el.preload = 'auto'; } return this.el; },
  /** Phones only let a page make sound after a tap, and replies come seconds later. So on a tap, play a moment
      of silence on the reply player and start an empty utterance: both may then speak later without a tap. */
  unlock() {
    if (this.unlocked) return;
    const el = this.player();
    try { el.src = SILENCE(); const p = el.play(); p?.then(() => { this.unlocked = true; Log.i('audio', 'Reply player unlocked by a tap'); }).catch(e => Log.w('audio', 'Reply player unlock refused', e)); } catch (e) { Log.w('audio', 'Unlock failed', e); }
    try { if ('speechSynthesis' in window && !speechSynthesis.speaking) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); Log.d('audio', 'Phone voice primed by a tap'); } } catch {}
  },
  loadTTS(show) {
    if (this.tts) return Promise.resolve(this.tts);
    this.ttsLoading ||= Heavy.run('reply voice', () => this.loadTTSNow(show));
    return this.ttsLoading.then(t => (this.tts = t), e => { this.ttsLoading = null; Log.e('tts', 'On-device voice failed to load', e); throw e; });
  },
  /** Try the best build first: GPU 16-bit (half the memory) → GPU 32-bit → CPU. Each must load and pass a warm-up. */
  async loadTTSNow(show) {
    const cfg = Diag.get(), files = {}, voice = TTS_VOICES[settings.ttsVoice] ? settings.ttsVoice : 'af_heart';
    const onProgress = show ? p => this.progress(p, files, 'reply voice') : p => p.status && !/progress/.test(p.status) && Log.d('model', `reply voice: ${p.status} ${p.file || ''}`);
    const builds = cfg.device === 'webgpu' ? [...((await gpuFeatures()).f16 ? [['webgpu', 'fp16']] : []), ['webgpu', 'fp32'], ['wasm', 'q8']] : [['wasm', 'q8']];
    let lastErr;
    for (const [device, dtype] of builds) {
      const s = performance.now(); Log.i('tts', 'Loading the on-device voice (Kokoro)', { cached: ttsDownloaded().includes(dtype), engine: cfg.engine, device, dtype });
      let engine = null;
      try {
        if (cfg.engine !== 'main' && typeof Worker !== 'undefined') {
          try { engine = kokoroWorker(); await engine.load({ dtype, device }, onProgress); }
          catch (e) { Log.w('tts', 'Background worker failed: loading on the main thread instead', e); try { engine?.terminate(); } catch {} engine = null; }
        }
        if (!engine) {
          const K = await import(KOKORO_URL);
          engine = kokoroMain(K, await K.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype, device, progress_callback: onProgress }));
        }
        $('#vProg').hidden = true; store.set('kokoroOK', true); store.set('kokoroDl', [...new Set([...ttsDownloaded(), dtype])]);
        Log.i('tts', `On-device voice loaded ${Math.round(performance.now() - s)} ms (${engine.kind}, ${device} ${dtype})`, { streamShim: !!window.__rsIterShim });
        // Warm-up: one short sentence proves the whole chain (dictionary, phonemes, model) works here, and makes the first reply faster.
        const w = performance.now();
        const a = await Promise.race([engine.generate('Ready.', voice), new Promise((_, rej) => setTimeout(() => rej(new Error('Warm-up took over 20 s')), 20000))]);
        this.ttsBroken = ''; Log.i('tts', `On-device voice works: warm-up ${Math.round(performance.now() - w)} ms`, { seconds: +(a.f32.length / a.rate).toFixed(2), engine: engine.kind, device, dtype });
        if (device === 'wasm' && cfg.device === 'webgpu') this.gpuGaveUp(lastErr);
        engine.device = device; engine.dtype = dtype; Log.mem('kokoro', `${device === 'webgpu' ? 'GPU' : 'CPU'} ${dtype} (${engine.kind})`);
        return engine;
      } catch (e) {
        lastErr = e;
        if (device === 'wasm') { // the last option: keep it if it loaded; replies fall back to the phone voice
          if (!engine) throw e;
          this.ttsBroken = e?.message || 'Warm-up failed'; Log.e('tts', 'On-device voice warm-up failed: replies use the phone voice', e);
          Log.mem('kokoro', `CPU q8 (${engine.kind}, not working)`); return engine;
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
    this.hush(); this.respId++; this.unlock();
    this.open(); $('#vChips').hidden = false;
    this.show('Listening…', this.engine() === 'whisper' ? 'On-device · Whisper base' : 'Phone speech recognition');
    if (this.engine() === 'browser') return this.listenBrowser();
    if (!this.pipe && !store.get('whisperOK')) {
      this.close();
      return sheet('On-device voice', `<p>DriveDeck can understand you on the phone itself with <b>Whisper base</b>, OpenAI’s multilingual speech model. It works offline and understands English, Hindi, Kannada, Tamil and more. Other languages are translated to English commands.</p>
        <p>It can answer in a natural voice made on the phone too (<b>Kokoro</b>), instead of the phone’s robotic one.</p>
        <p class="hint">One-time download: about 80 MB for listening, ${ttsSize()} more for the reply voice (use Wi-Fi). Both are kept on this device.</p>`,
        [['Download both', () => { store.set('ttsAsked', true); settings.tts = 'neural'; store.set('settings', settings);
          this.open(); this.loadModel().then(() => { this.listenWhisper(); this.loadTTS().catch(() => {}); }).catch(e => this.fail(e)); }],
          ['Listening only', () => { store.set('ttsAsked', true); this.open(); this.loadModel().then(() => this.listenWhisper()).catch(e => this.fail(e)); }],
          ...(SR ? [['Use phone recognition instead', () => { settings.stt = 'browser'; applySettings(); this.start(); }]] : []), ['Not now']]);
    }
    if (settings.tts === 'neural' && !store.get('kokoroOK') && !store.get('ttsAsked')) {
      store.set('ttsAsked', true); this.close();
      const go = () => { this.open(); this.start(); };
      return sheet('A natural reply voice', `<p>Now that DriveDeck listens on the phone, it can also answer in a natural voice made on the phone (<b>Kokoro</b>) instead of the phone’s built-in one. Works offline once downloaded.</p>
        <p class="hint">One-time download of about ${ttsSize()} (use Wi-Fi).</p>`,
        [['Download now', () => { this.loadTTS(true).then(() => this.speak('Hi, this is my new voice.')).catch(e => console.warn(e)); go(); }],
          ['Keep the phone’s voice', () => { settings.tts = 'phone'; applySettings(); go(); }], ['Later', go]]);
    }
    if (settings.tts === 'neural' && store.get('kokoroOK')) this.loadTTS().catch(() => {}); // warm up while you talk
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
    this.loading ||= Heavy.run('Whisper', async () => {
      const want = Diag.get().stt, s = performance.now(), files = {};
      if (want === 'webgpu') await gpuFeatures();
      Log.i('stt', 'Loading Whisper', { cached: !!store.get('whisperOK'), device: want });
      let lastErr;
      for (const build of [...whisperBuilds(want), ...(want === 'webgpu' ? whisperBuilds('wasm') : [])]) {
        try {
          const pipe = await createWhisper(build, p => this.progress(p, files, 'voice model'));
          if (build.device === 'wasm' && want === 'webgpu') { Log.w('stt', 'Whisper on the GPU failed: using the CPU'); Diag.set('stt', 'wasm'); }
          this.pipeDevice = build.device; this.pipeBuild = build.label; Log.mem('whisper', build.label);
          $('#vProg').hidden = true; store.set('whisperOK', true); if (build.device === 'webgpu') store.set('whisperGpuOK', true);
          Log.i('stt', `Whisper ready ${Math.round(performance.now() - s)} ms (${build.label})`);
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
      this.inferring = true; const t0 = performance.now();
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
  listenBrowser() {
    if (!SR) return this.show('Voice input isn’t supported in this browser', 'Tap a suggestion');
    try {
      this.hush();
      const r = this.sr = new SR(); r.lang = (LANGS[settings.voiceLang] || LANGS.auto)[2]; r.interimResults = true;
      let text = '', done = false, lastChange = performance.now();
      const latency = () => Log.i('stt', `Recognised ${Math.round(performance.now() - lastChange)} ms after your last word (phone recognizer)`, { text });
      const finish = () => { if (this.sr === r) this.sr = null; $('#vOrb').classList.remove('live'); };
      Log.i('stt', 'Phone recognizer starting', { lang: r.lang });
      r.onstart = () => Log.d('stt', 'Phone recognizer listening');
      r.onresult = e => {
        const t = [...e.results].map(x => x[0].transcript).join(' ').trim();
        if (t !== text) lastChange = performance.now();
        text = t;
        Log.d('stt', `Phone recognizer ${e.results[e.results.length - 1].isFinal ? 'final' : 'interim'}`, { text });
        this.show(`“${text}”`, 'Listening…');
        if (e.results[e.results.length - 1].isFinal && !done) { done = true; finish(); latency(); this.heard(text, { engine: 'Phone' }); }
      };
      r.onerror = e => { Log.e('stt', 'Phone recognizer error', { error: e.error, message: e.message }); finish(); if (done) return; done = true;
        this.show(e.error === 'not-allowed' ? 'Microphone or speech permission is off' : 'Couldn’t hear you', e.error === 'not-allowed' ? 'Allow them for this site in the phone’s settings' : 'Tap the mic and try again'); };
      // Some phones end without a “final” result: use what was heard so far, and never leave the mic stuck.
      r.onend = () => { Log.d('stt', 'Phone recognizer ended', { text, done }); finish(); if (done) return; done = true; text ? (latency(), this.heard(text, { engine: 'Phone' })) : this.show('I didn’t hear anything', 'Tap the mic and try again'); };
      r.start(); $('#vOrb').classList.add('live');
    } catch (e) { Log.e('stt', 'Phone recognizer could not start', e); this.show('Tap a suggestion'); }
  },
  /** A phrase was recognised: show it, log it, act on it. */
  heard(text, meta) {
    Log.i('stt', `Heard: “${text}”`, meta);
    this.show(`“${text}”`, 'Heard'); $('#vChips').hidden = true;
    VoiceLog.you(text, meta);
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
