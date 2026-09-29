'use strict';
/* ============================================================
   Voice: speech to text, the listening box and the conversation log.
   Engines: on-device Whisper (base, multilingual, via transformers.js)
   or the browser's own recognizer. Loaded after dash.js.
   ============================================================ */
const WHISPER_MODEL = 'onnx-community/whisper-base';
// transformers.js, pinned. Loaded from the CDN on first use (like the ONNX runtime and the model), then cached by the service worker.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
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
  pipe: null, loading: null, rec: null, sr: null, busy: false,
  open() {
    const box = $('#assistant'); box.hidden = false;
    $('#vReply').hidden = true; $('#vProg').hidden = true; clearTimeout(this.closeT);
  },
  close() {
    this.stopRec(true); try { this.sr?.abort(); } catch {} this.sr = null;
    $('#assistant').hidden = true; $('#vOrb').classList.remove('live');
  },
  show(text, hint = '') { $('#asstText').textContent = text; $('#asstHint').textContent = hint; },
  reply(text) {
    const app = VoiceLog.app(text), [ic, col, name] = APP_LOOK[app];
    $('#vReply').innerHTML = `<span class="av" style="background:${col}">${svg(ic)}</span><span>${esc(text)}</span>`;
    $('#vReply').hidden = false; $('#vChips').hidden = true;
  },
  level(rms) { $('#vOrb').style.setProperty('--lv', Math.min(1, rms * 12).toFixed(2)); },
  engine() { return settings.stt === 'browser' && SR ? 'browser' : settings.stt === 'whisper' ? 'whisper' : SR ? 'browser' : 'whisper'; },

  async start() {
    if (!$('#assistant').hidden && (this.rec || this.sr)) return this.stopRec(); // tap again = done talking
    this.open(); $('#vChips').hidden = false;
    this.show('Listening…', this.engine() === 'whisper' ? 'On-device · Whisper base' : 'Phone speech recognition');
    if (this.engine() === 'browser') return this.listenBrowser();
    if (!this.pipe && !store.get('whisperOK')) {
      this.close();
      return sheet('On-device voice', `<p>DriveDeck can understand you on the phone itself with <b>Whisper base</b>, OpenAI’s multilingual speech model. It works offline and understands English, Hindi, Kannada, Tamil and more. Other languages are translated to English commands.</p>
        <p class="hint">One-time download of about 80 MB (use Wi-Fi). It’s kept on this device.</p>`,
        [['Download now', () => { this.open(); this.loadModel().then(() => this.listenWhisper()).catch(e => this.fail(e)); }],
          ...(SR ? [['Use phone recognition instead', () => { settings.stt = 'browser'; applySettings(); this.start(); }]] : []), ['Not now']]);
    }
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
        progress_callback: p => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = [p.loaded, p.total];
          const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
          $('#vProg').hidden = false; $('#vProg i').style.width = (l / t * 100).toFixed(1) + '%';
          $('#vProg span').textContent = `Downloading voice model · ${Math.round(l / 1e6)} of ${Math.round(t / 1e6)} MB`;
        },
      });
      $('#vProg').hidden = true; store.set('whisperOK', true);
      return pipe;
    })();
    return this.loading.then(p => (this.pipe = p), e => { this.loading = null; throw e; });
  },
  async listenWhisper() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { return this.show('Microphone is blocked', 'Allow microphone access for this site in Settings'); }
    let ctx; try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = []; let heard = false, quiet = 0, total = 0, noise = 0.008;
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length), dt = d.length / ctx.sampleRate; total += dt; this.level(rms);
      // End of speech: about a second of quiet after talking; give up after a silent 6 s or 10 s in all.
      if (rms > Math.max(0.018, noise * 3)) { if (!heard) this.show('Listening…', 'Speak now · tap the orb when done'); heard = true; quiet = 0; }
      else { quiet += dt; if (!heard) noise = noise * 0.9 + rms * 0.1; }
      if ((heard && quiet > 1.1) || total > 10 || (!heard && total > 6)) this.stopRec();
    };
    src.connect(proc); proc.connect(ctx.destination);
    this.rec = { stream, ctx, proc, src, chunks, heard: () => heard };
    $('#vOrb').classList.add('live');
  },
  async stopRec(discard) {
    const r = this.rec; if (!r) return; this.rec = null;
    try { r.proc.disconnect(); r.src.disconnect(); } catch {}
    r.stream.getTracks().forEach(t => t.stop());
    const rate = r.ctx.sampleRate; r.ctx.close().catch(() => {});
    $('#vOrb').classList.remove('live');
    if (discard) return;
    if (!r.heard()) { this.show('I didn’t hear anything', 'Tap the mic and try again'); this.closeT = setTimeout(() => this.close(), 2500); return; }
    let audio = new Float32Array(r.chunks.reduce((n, c) => n + c.length, 0)); let o = 0;
    for (const c of r.chunks) { audio.set(c, o); o += c.length; }
    if (rate !== 16000) audio = await resample(audio, rate, 16000);
    this.transcribe(audio);
  },
  async transcribe(audio) {
    this.show('Understanding…', 'Whisper · on-device');
    const lang = LANGS[settings.voiceLang] || LANGS.auto, t0 = performance.now();
    try {
      const out = await this.pipe(audio, { language: lang[1], task: lang[1] === 'en' ? 'transcribe' : 'translate' });
      const text = (out.text || '').trim().replace(/^[\s"“]+|[\s"”]+$/g, '');
      if (!text || /^(thank you|thanks for watching|you)[.!]*$/i.test(text) && audio.length < 16000 * 1.6) return this.show('I didn’t catch that', 'Tap the mic and try again');
      this.heard(text, { engine: 'Whisper', lang: lang[1] && lang[1] !== 'en' ? `${lang[1].toUpperCase()} → EN` : '', ms: performance.now() - t0 });
    } catch (e) { this.fail(e); }
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

/* ---------- Assistant widget: a hands-free conversation view ---------- */
W.chat = { name: 'Assistant', html: () => `<div class="chatw">
    <div class="chat-head"><b>Assistant</b><button class="chat-mic" data-action="assistant" aria-label="Talk">${svg('mic')}<span>Talk</span></button></div>
    <div class="chat-log" data-html="chat" data-scroll></div>
    <div class="chat-quick" data-html="chatQuick"></div></div>` };
