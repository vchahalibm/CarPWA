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
  pipe: null, loading: null, rec: null, sr: null, tts: null, ttsLoading: null, sayId: 0, respId: 0, playing: [],
  open() {
    const box = $('#assistant'); box.hidden = false;
    $('#vReply').hidden = true; $('#vProg').hidden = true; clearTimeout(this.closeT);
  },
  close() {
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
    this.reply(msg); clearTimeout(this.closeT);
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
    if (!text || settings.tts === 'off') return Promise.resolve();
    if (settings.tts === 'neural' && this.tts) return this.speakNeural(text, id).catch(e => { console.warn('Reply voice failed', e); return id === this.sayId && this.speakPhone(text); });
    if (settings.tts === 'neural' && store.get('kokoroOK')) this.loadTTS().catch(() => {}); // from cache, ready for the next reply
    return this.speakPhone(text);
  },
  speakPhone(text) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.03; u.onend = u.onerror = () => res(); speechSynthesis.speak(u); } catch { res(); }
      setTimeout(res, 1500 + text.length * 85);
    });
  },
  async speakNeural(text, id) {
    const ctx = this.audio(); if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') throw new Error('Audio is locked until the screen is tapped');
    // One sentence at a time: the first starts playing while the rest are generated. One generation at a time.
    const prev = this.ttsLock; let release; this.ttsLock = new Promise(r => (release = r)); await prev;
    let at = 0, last = null;
    try {
      if (navigator.audioSession) try { navigator.audioSession.type = 'transient'; } catch {}
      for await (const { audio } of this.tts.stream(text, { voice: TTS_VOICES[settings.ttsVoice] ? settings.ttsVoice : 'af_heart' })) {
        if (id !== this.sayId) return;
        const buf = ctx.createBuffer(1, audio.audio.length, audio.sampling_rate); buf.copyToChannel(audio.audio, 0);
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
        at = Math.max(at, ctx.currentTime + 0.03); src.start(at); at += buf.duration; this.playing.push(src); last = src;
      }
    } finally { release(); }
    if (last) await new Promise(r => { last.onended = r; setTimeout(r, (at - ctx.currentTime) * 1000 + 400); });
    if (id === this.sayId && navigator.audioSession) try { navigator.audioSession.type = 'auto'; } catch {}
  },
  hush() {
    this.sayId++; this.playing.forEach(s => { try { s.stop(); } catch {} }); this.playing = [];
    try { speechSynthesis.cancel(); } catch {}
  },
  audio() { return (this.ac ||= new (window.AudioContext || window.webkitAudioContext)()); },
  /** Phones only let a page play sound after a tap: resume the reply voice's audio on every touch. */
  unlock() { if (this.ac?.state === 'suspended' || (!this.ac && store.get('kokoroOK'))) this.audio().resume().catch(() => {}); },
  loadTTS(show) {
    if (this.tts) return Promise.resolve(this.tts);
    this.ttsLoading ||= (async () => {
      const { KokoroTTS } = await import(KOKORO_URL), files = {};
      const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'wasm', progress_callback: show ? p => this.progress(p, files, 'reply voice') : null });
      $('#vProg').hidden = true; store.set('kokoroOK', true);
      return tts;
    })();
    return this.ttsLoading.then(t => (this.tts = t), e => { this.ttsLoading = null; throw e; });
  },
  progress(p, files, what) {
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
    this.hush(); this.respId++; this.unlock();
    this.open(); $('#vChips').hidden = false;
    this.show('Listening…', this.engine() === 'whisper' ? 'On-device · Whisper base' : 'Phone speech recognition');
    if (this.engine() === 'browser') return this.listenBrowser();
    if (!this.pipe && !store.get('whisperOK')) {
      this.close();
      return sheet('On-device voice', `<p>DriveDeck can understand you on the phone itself with <b>Whisper base</b>, OpenAI’s multilingual speech model. It works offline and understands English, Hindi, Kannada, Tamil and more. Other languages are translated to English commands.</p>
        <p>It can answer in a natural voice made on the phone too (<b>Kokoro</b>), instead of the phone’s robotic one.</p>
        <p class="hint">One-time download: about 80 MB for listening, 90 MB more for the reply voice (use Wi-Fi). Both are kept on this device.</p>`,
        [['Download both', () => { store.set('ttsAsked', true); settings.tts = 'neural'; store.set('settings', settings);
          this.open(); this.loadModel().then(() => { this.listenWhisper(); this.loadTTS().catch(() => {}); }).catch(e => this.fail(e)); }],
          ['Listening only', () => { store.set('ttsAsked', true); this.open(); this.loadModel().then(() => this.listenWhisper()).catch(e => this.fail(e)); }],
          ...(SR ? [['Use phone recognition instead', () => { settings.stt = 'browser'; applySettings(); this.start(); }]] : []), ['Not now']]);
    }
    if (settings.tts === 'neural' && !store.get('kokoroOK') && !store.get('ttsAsked')) {
      store.set('ttsAsked', true); this.close();
      const go = () => { this.open(); this.start(); };
      return sheet('A natural reply voice', `<p>Now that DriveDeck listens on the phone, it can also answer in a natural voice made on the phone (<b>Kokoro</b>) instead of the phone’s built-in one. Works offline once downloaded.</p>
        <p class="hint">One-time download of about 90 MB (use Wi-Fi).</p>`,
        [['Download now', () => { this.loadTTS(true).then(() => this.speak('Hi, this is my new voice.')).catch(e => console.warn(e)); go(); }],
          ['Keep the phone’s voice', () => { settings.tts = 'phone'; applySettings(); go(); }], ['Later', go]]);
    }
    if (settings.tts === 'neural' && store.get('kokoroOK')) this.loadTTS().catch(() => {}); // warm up while you talk
    try { if (!this.pipe) { this.show('Loading voice model…', 'Whisper base · on-device'); await this.loadModel(); } this.listenWhisper(); }
    catch (e) { this.fail(e); }
  },
  fail(e) {
    console.warn('Voice failed', e);
    this.show('Voice isn’t available right now', SR ? 'Switching to phone recognition' : 'Tap a suggestion instead');
    if (SR && this.engine() === 'whisper') setTimeout(() => this.listenBrowser(), 900);
  },

  /* Whisper via transformers.js (ONNX runtime in WebAssembly); model files are cached for offline use. */
  loadModel() {
    if (this.pipe) return Promise.resolve(this.pipe);
    this.loading ||= (async () => {
      const T = await import(TRANSFORMERS_URL);
      T.env.allowLocalModels = false;
      if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;
      const files = {};
      const pipe = await T.pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'wasm',
        progress_callback: p => this.progress(p, files, 'voice model'),
      });
      $('#vProg').hidden = true; store.set('whisperOK', true);
      return pipe;
    })();
    return this.loading.then(p => (this.pipe = p), e => { this.loading = null; throw e; });
  },
  /* Listening: record until you've been quiet for the “act after” time (5 s by default). About 0.7 s into a pause
     Whisper already transcribes what it has; if you say nothing more, that guess is used, so the action happens right at the deadline. */
  async listenWhisper() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { return this.show('Microphone is blocked', 'Allow microphone access for this site in Settings'); }
    let ctx; try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
    const src = ctx.createMediaStreamSource(stream), rate = ctx.sampleRate, limit = Math.max(1, +settings.vadSilence || 5);
    const st = { chunks: [], heard: false, quiet: 0, total: 0, noise: 0.008, guess: null, left: 0 };
    const onChunk = d => {
      if (this.rec?.st !== st) return;
      st.chunks.push(d);
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length), dt = d.length / rate; st.total += dt; this.level(rms);
      if (rms > Math.max(0.018, st.noise * 3)) {
        if (!st.heard || st.left) this.show(st.guess ? $('#asstText').textContent : 'Listening…', 'Speak now · tap the orb when done');
        st.heard = true; st.quiet = 0; st.guess = null; st.left = 0; // more words: the earlier guess is stale
      } else { st.quiet += dt; if (!st.heard) st.noise = st.noise * 0.9 + rms * 0.1; }
      if (st.heard && st.quiet > 0.7) {
        if (!st.guess && !this.inferring) this.guess(st, rate);
        const left = Math.ceil(limit - st.quiet);
        if (left !== st.left && left > 0) { st.left = left; $('#asstHint').textContent = `Acting in ${left} s · tap the orb to go now`; }
      }
      if ((st.heard && st.quiet >= limit) || st.total > 30 || (!st.heard && st.total > 8)) this.stopRec();
    };
    let node = null;
    if (ctx.audioWorklet && window.AudioWorkletNode) try {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([REC_WORKLET], { type: 'text/javascript' })));
      node = new AudioWorkletNode(ctx, 'dd-rec'); node.port.onmessage = e => onChunk(e.data);
    } catch { node = null; }
    if (!node) { node = ctx.createScriptProcessor(4096, 1, 1); node.onaudioprocess = e => onChunk(new Float32Array(e.inputBuffer.getChannelData(0))); }
    src.connect(node); node.connect(ctx.destination);
    this.rec = { stream, ctx, node, src, st };
    $('#vOrb').classList.add('live');
  },
  /** Transcribe what's been said so far, during a pause. */
  guess(st, rate) {
    const p = this.toAudio(st.chunks.slice(), rate).then(a => this.recognise(a));
    st.guess = p;
    p.then(r => { if (st.guess === p && this.rec?.st === st && r.text) $('#asstText').textContent = `“${r.text}”`; }).catch(() => {});
  },
  async stopRec(discard) {
    const r = this.rec; if (!r) return; this.rec = null;
    try { r.node.disconnect(); r.src.disconnect(); if (r.node.port) r.node.port.onmessage = null; } catch {}
    r.stream.getTracks().forEach(t => t.stop());
    const rate = r.ctx.sampleRate, st = r.st; r.ctx.close().catch(() => {});
    $('#vOrb').classList.remove('live');
    if (discard) return;
    if (!st.heard) { this.show('I didn’t hear anything', 'Tap the mic and try again'); this.closeT = setTimeout(() => this.close(), 2500); return; }
    if (!st.guess) this.show('Understanding…', 'Whisper · on-device');
    try {
      const res = await (st.guess || this.toAudio(st.chunks, rate).then(a => this.recognise(a)));
      if (!res.text || /^(thank you|thanks for watching|you)[.!]*$/i.test(res.text) && res.secs < 1.6) return this.show('I didn’t catch that', 'Tap the mic and try again');
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
        return { text: (out.text || '').trim().replace(/^[\s"“]+|[\s"”]+$/g, ''), ms: performance.now() - t0, secs: audio.length / 16000,
          lang: lang[1] && lang[1] !== 'en' ? `${lang[1].toUpperCase()} → EN` : '' };
      } finally { this.inferring = false; }
    };
    return (this.asrQ = (this.asrQ || Promise.resolve()).catch(() => {}).then(run));
  },

  /* Browser engine: live partial results while you speak. */
  listenBrowser() {
    if (!SR) return this.show('Voice input isn’t supported in this browser', 'Tap a suggestion');
    try {
      const r = this.sr = new SR(); r.lang = (LANGS[settings.voiceLang] || LANGS.auto)[2]; r.interimResults = true;
      r.onresult = e => {
        const text = [...e.results].map(x => x[0].transcript).join(' ');
        this.show(`“${text}”`, 'Listening…');
        if (e.results[e.results.length - 1].isFinal) { this.sr = null; $('#vOrb').classList.remove('live'); this.heard(text, { engine: 'Phone' }); }
      };
      r.onerror = () => { this.sr = null; $('#vOrb').classList.remove('live'); this.show('Couldn’t hear you', 'Tap a suggestion or try again'); };
      r.onend = () => $('#vOrb').classList.remove('live');
      r.start(); $('#vOrb').classList.add('live');
    } catch { this.show('Tap a suggestion'); }
  },
  /** A phrase was recognised: show it, log it, act on it. */
  heard(text, meta) {
    this.show(`“${text}”`, 'Heard'); $('#vChips').hidden = true;
    VoiceLog.you(text, meta);
    setTimeout(() => handleCommand(text, true), 350);
  },
};
async function resample(data, from, to) {
  const ctx = new OfflineAudioContext(1, Math.ceil(data.length * to / from), to);
  const buf = ctx.createBuffer(1, data.length, from); buf.copyToChannel(data, 0);
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start();
  return (await ctx.startRendering()).getChannelData(0);
}
$('#vOrb').addEventListener('click', () => Voice.rec ? Voice.stopRec() : Voice.start());
addEventListener('pointerdown', () => Voice.unlock(), { capture: true, passive: true });

/* ---------- Assistant widget: a hands-free conversation view ---------- */
W.chat = { name: 'Assistant', html: () => `<div class="chatw">
    <div class="chat-head"><b>Assistant</b><button class="chat-mic" data-action="assistant" aria-label="Talk">${svg('mic')}<span>Talk</span></button></div>
    <div class="chat-log" data-html="chat" data-scroll></div>
    <div class="chat-quick" data-html="chatQuick"></div></div>` };
