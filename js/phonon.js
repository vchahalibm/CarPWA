'use strict';
/* ============================================================
   Phonon: the natural reply voice (Gradium's Phonon 31M, English, through Transformers.js: vendor/transformers-phonon).
   - Measured on an iPhone 15 Pro Max: 3.2× faster than speech on the GPU (q4f16, 40 MB), first sound ~70 ms; 2.3× with
     the 3D assistant and camera recognition running; 1.1× on the CPU (q4, 67 MB). Kokoro was 2.4× slower there.
   - The build per device: GPU (WebGPU) q4f16 where WebGPU works, else CPU q4; the first reply after loading is timed and
     a build that can't keep up falls back (GPU → CPU → the device's voice). `store 'phononBuild'` keeps the choice.
   - Long text, as in Phonon FM (github.com/nico-martin/phonon-fm): Phonon takes at most 50 tokens a call, so the
     processor splits the text into sentences and long ones at clause boundaries; generate_speech() streams 1920-sample
     frames (80 ms at 24 kHz) as each is made. The player keeps only a fraction of a second in the audio graph and the rest
     queued, so “stop” and interruptions cut in at once; a slower build buffers enough before starting that it never pauses.
   - In a worker (so the CPU build doesn't stall the page); on the main thread if the worker can't load it.
   Loaded after voice.js.
   ============================================================ */
const PHONON_MODEL = 'onnx-community/phonon-31m-en-ONNX';
const PHONON_URL = new URL('vendor/transformers-phonon/transformers.min.js', location.href).href;
const PHONON_RATE = 24000;
// Defaults for Settings › Voice › female / male (Phonon's voices/voices.jsonl); any English voice can be chosen by name.
const PHONON_VOICES = { female: '4SZHfMpw-p46Ywgs', male: 'qIxlZ7Ei8KvWlyQH' }; // Harper, Preston
const PHONON_BUILDS = { gpu: { device: 'webgpu', dtype: 'q4f16', mb: 40, label: 'GPU' }, cpu: { device: 'wasm', dtype: 'q4', mb: 67, label: 'CPU' } };

const PHONON_WORKER = `let T, proc, model; const voices = new Map(), cancelled = new Set(); let chain = Promise.resolve();
const send = (m, t) => self.postMessage(m, t || []);
self.onmessage = ({ data: m }) => {
  if (m.type === 'cancel') { cancelled.add(m.id); return; }
  const job = async () => {
    try {
      if (m.type === 'load') {
        T = await import(m.url); T.env.allowLocalModels = false;
        const files = {};
        const progress_callback = p => { if (p.status === 'progress' && p.file) { files[p.file] = [p.loaded || 0, p.total || 0]; let a = 0, b = 0; for (const [x, y] of Object.values(files)) { a += x; b += y; } send({ type: 'progress', id: m.id, loaded: a, total: b }); } };
        proc = await T.AutoProcessor.from_pretrained(m.model);
        model = await T.GradiumPhononTTSForConditionalGeneration.from_pretrained(m.model, { dtype: m.dtype, device: m.device, progress_callback });
        send({ type: 'loaded', id: m.id });
      } else if (m.type === 'speak') {
        if (cancelled.has(m.id)) { send({ type: 'done', id: m.id }); return; }
        let v = voices.get(m.voice); if (!v) { v = await model.load_voice(m.voice ? 'voices/' + m.voice + '.bin' : undefined); voices.set(m.voice, v); }
        const chunks = await proc(m.text); send({ type: 'start', id: m.id, pieces: chunks.length });
        for await (const pcm of model.generate_speech({ chunks, speaker_embeddings: v })) {
          if (cancelled.has(m.id)) break;
          const f = pcm instanceof Float32Array ? pcm : new Float32Array(pcm); send({ type: 'frame', id: m.id, pcm: f }, [f.buffer]);
        }
        send({ type: 'done', id: m.id });
      }
    } catch (e) { send({ type: 'error', id: m.id, message: String((e && e.message) || e) }); }
  };
  chain = chain.then(job, job);
};`;

const Phonon = {
  engine: null, loading: null, broken: '', list: null,
  /** The build for this device: what was chosen (measured, or after a fallback), else GPU where WebGPU works, else CPU. */
  buildKey() { const k = store.get('phononBuild'); return PHONON_BUILDS[k] ? k : typeof gpuOK === 'function' && gpuOK() ? 'gpu' : 'cpu'; },
  build() { return PHONON_BUILDS[this.buildKey()]; },
  /** Downloaded once (the files are in the browser's cache from then on). */
  ok: () => !!store.get('phononOK'),
  speed: () => store.get('phononSpeed', null), // { r: seconds to make per second of speech, n, build }
  /** Fast enough here for Automatic: no measurement yet counts as fast (the first reply measures). */
  keepsUp() { const s = this.speed(); return !this.broken && !(s && s.n >= 1 && s.build === this.buildKey() && s.r > 0.95); },
  voiceId() { return settings.phononVoice || PHONON_VOICES[settings.voiceGender === 'male' ? 'male' : 'female']; },
  /** Phonon's voices (name, gender, accent, description), English only, from the model's voices.jsonl; cached. */
  async voices() {
    if (this.list) return this.list;
    const cached = store.get('phononVoices', null); if (cached?.length) return (this.list = cached);
    const t = await (await fetch(`https://huggingface.co/${PHONON_MODEL}/resolve/main/voices/voices.jsonl`)).text();
    this.list = t.split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(v => v.language === 'en' && v.gender)
      .map(v => ({ id: v.voice_id, name: v.name, gender: v.gender, locale: v.locale, about: v.description }));
    store.set('phononVoices', this.list); return this.list;
  },
  /** Load (downloading the first time). onProgress(loaded, total) in bytes. Falls back from the GPU build to the CPU one. */
  load(onProgress) {
    if (this.engine) return Promise.resolve(this.engine);
    return (this.loading ||= (async () => {
      for (const key of [...new Set([this.buildKey(), 'cpu'])]) {
        const b = PHONON_BUILDS[key], t0 = performance.now();
        if (typeof Budget !== 'undefined' && !Budget.room('phonon', b.mb * 3)) Log.w('tts', 'Phonon: little memory free; loading anyway (it is small)');
        try {
          const eng = await this.worker(b, onProgress).catch(async e => { Log.w('tts', `Phonon ${b.label}: the worker couldn't load it, trying the main thread`, { error: e.message }); return this.main(b, onProgress); });
          // Warm up: the first generation compiles the GPU's shaders (and sizes its buffers), several times slower than the rest.
          const w0 = performance.now(); await eng.speak('Ready.', this.voiceId(), () => {}).done.catch(() => {});
          Log.d('tts', `Phonon warmed up in ${Math.round(performance.now() - w0)} ms`);
          this.engine = eng; store.set('phononOK', true); if (key !== this.buildKey()) store.set('phononBuild', key);
          if (typeof Budget !== 'undefined') Budget.add('phonon', `Phonon ${b.label} ${b.dtype}`, () => this.unload(), b.mb * 3);
          Log.i('tts', `Phonon loaded in ${Math.round(performance.now() - t0)} ms (${b.label} ${b.dtype}, ${eng.kind})`);
          return eng;
        } catch (e) { Log.w('tts', `Phonon ${b.label} ${b.dtype} didn't load`, { error: e.message }); if (key === 'gpu') store.set('phononBuild', 'cpu'); }
      }
      this.broken = 'didn’t load'; throw new Error('The natural voice didn’t load');
    })().finally(() => { this.loading = null; }));
  },
  unload() { this.engine?.terminate(); this.engine = null; },
  /** The engine in a worker: speak(text, voice, onFrame, onStart) → { done, cancel }. */
  worker(b, onProgress) {
    const w = new Worker(URL.createObjectURL(new Blob([PHONON_WORKER], { type: 'text/javascript' })), { type: 'module' });
    const handlers = new Map(); let seq = 0;
    w.onmessage = ({ data: m }) => handlers.get(m.id)?.(m);
    w.onerror = e => { e.preventDefault?.(); for (const h of [...handlers.values()]) h({ type: 'error', message: e.message || 'The voice worker stopped' }); };
    const call = (msg, h) => { const id = ++seq; handlers.set(id, h); w.postMessage({ ...msg, id }); return id; };
    return new Promise((res, rej) => call({ type: 'load', url: PHONON_URL, model: PHONON_MODEL, device: b.device, dtype: b.dtype }, m => {
      if (m.type === 'progress') return onProgress?.(m.loaded, m.total);
      handlers.delete(m.id);
      if (m.type !== 'loaded') { w.terminate(); return rej(new Error(m.message)); }
      res({ kind: 'worker', build: b,
        speak(text, voice, onFrame, onStart) {
          let finish, fail; const done = new Promise((a, z) => { finish = a; fail = z; });
          const id = call({ type: 'speak', text, voice }, m => {
            if (m.type === 'start') return onStart?.(m.pieces);
            if (m.type === 'frame') return onFrame(m.pcm);
            handlers.delete(m.id); m.type === 'done' ? finish() : fail(new Error(m.message));
          });
          return { done, cancel: () => w.postMessage({ type: 'cancel', id }) };
        },
        terminate() { w.terminate(); } });
    }));
  },
  /** The same on the main thread (where a worker can't use WebGPU). */
  async main(b, onProgress) {
    const T = await import(PHONON_URL); T.env.allowLocalModels = false; const files = {};
    const proc = await T.AutoProcessor.from_pretrained(PHONON_MODEL);
    const model = await T.GradiumPhononTTSForConditionalGeneration.from_pretrained(PHONON_MODEL, { dtype: b.dtype, device: b.device,
      progress_callback: p => { if (p.status === 'progress' && p.file) { files[p.file] = [p.loaded || 0, p.total || 0]; let x = 0, y = 0; for (const [a, c] of Object.values(files)) { x += a; y += c; } onProgress?.(x, y); } } });
    const voices = new Map();
    return { kind: 'main thread', build: b,
      speak(text, voice, onFrame, onStart) {
        let stop = false;
        const done = (async () => {
          let v = voices.get(voice); if (!v) { v = await model.load_voice(voice ? `voices/${voice}.bin` : undefined); voices.set(voice, v); }
          const chunks = await proc(text); onStart?.(chunks.length);
          for await (const pcm of model.generate_speech({ chunks, speaker_embeddings: v })) { if (stop) break; onFrame(pcm); await new Promise(r => setTimeout(r, 0)); }
        })();
        return { done, cancel: () => { stop = true; } };
      },
      terminate() {} };
  },
  /** One reply's speed, learned per build: seconds to make ÷ seconds of speech (below 1 keeps up). */
  learn(ms, sec) {
    if (sec < 0.8) return;
    const r = ms / 1000 / sec, key = this.buildKey(), s = this.speed(), same = s && s.build === key;
    const next = { r: same ? +(s.r * 0.6 + r * 0.4).toFixed(3) : +r.toFixed(3), n: same ? s.n + 1 : 1, build: key };
    store.set('phononSpeed', next);
    // Can't keep up on the GPU: the CPU build next time (rare: GPU busy with something heavier); on the CPU: the device's voice.
    if (next.n >= 2 && next.r > 1.05 && key === 'gpu') { Log.w('tts', `Phonon on the GPU is ${next.r.toFixed(2)}× here: the CPU build next`); store.set('phononBuild', 'cpu'); this.unload(); }
    return next;
  },
};

/* ---------- Playing it: frames into Web Audio (or the conversation's audio engine), lip-sync per block ---------- */
const SCHEDULE_AHEAD = 0.3; // seconds handed to the audio graph; the rest waits in the queue, so a stop cuts in at once
Object.assign(Voice, {
  /** Speak with Phonon; resolves when the speech has played (or was stopped). Throws when it didn't start, for the fallback. */
  async speakPhonon(text, id) {
    const t0 = performance.now(); let eng = Phonon.engine;
    if (!eng) {
      if (!Phonon.ok()) { Phonon.load().catch(() => {}); throw new Error('The natural voice isn’t downloaded yet'); }
      eng = await Promise.race([Phonon.load(), new Promise((_, rej) => setTimeout(() => rej(new Error('The natural voice is still loading')), 6000))]);
    }
    if (id !== this.sayId) return;
    if (typeof Budget !== 'undefined') Budget.use('phonon');
    const convo = typeof Convo !== 'undefined' && Convo.active, ctx = convo ? null : this.audio();
    if (ctx && ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (ctx && ctx.state !== 'running') throw new Error(`Web Audio is ${ctx.state}`);
    this.session(Diag.get().session);
    const sp = Phonon.speed(), r = sp?.build === Phonon.buildKey() ? sp.r : 0.4;
    // A build slower than ~0.85: buffer before starting so the rest is made before it's needed (as in speakNeural).
    const needAhead = r > 0.85 ? Math.min(4, (text.length / 14) * (r - 0.8) + 0.4) : 0.15;
    const blocks = [], sources = new Set(); let pending = [], pendingN = 0, made = 0, started = false, firstAt = 0, nextT = 0, gaps = 0, stopped = false, genDone = false, genMs = 0;
    let finish; const done = new Promise(a => (finish = a));
    const blockLen = () => (started ? 0.48 : 0.24) * PHONON_RATE; // a small first block so speech starts at once
    const flush = force => {
      if (!pendingN || (!force && pendingN < blockLen())) return;
      const f = new Float32Array(pendingN); let o = 0; for (const p of pending) { f.set(p, o); o += p.length; }
      pending = []; pendingN = 0; blocks.push(f); pump();
    };
    const queued = () => blocks.reduce((s, b) => s + b.length, 0) / PHONON_RATE;
    let playing = false; // conversation: one block after another through its engine
    const pump = async () => {
      if (stopped || id !== this.sayId) return;
      if (!started && !genDone && queued() < needAhead) return;
      if (convo) {
        if (playing) return; playing = true;
        while (blocks.length && !stopped && id === this.sayId) { const f = blocks.shift(); if (!started) { started = true; Log.i('tts', `First sound after ${Math.round(performance.now() - t0)} ms (Phonon ${eng.build.label}, conversation)`); } await Convo.play({ n: 0, f32: f, rate: PHONON_RATE }); }
        playing = false; if (genDone && !blocks.length) finish(); return;
      }
      while (blocks.length && (nextT - ctx.currentTime) < SCHEDULE_AHEAD) {
        const f = blocks.shift(), now = ctx.currentTime;
        if (!started) { started = true; nextT = now + 0.05; Log.i('tts', `First sound after ${Math.round(performance.now() - t0)} ms (Phonon ${eng.build.label} ${eng.build.dtype}, ${eng.kind})`); }
        else if (nextT < now) { gaps++; nextT = now + 0.02; } // making fell behind playing
        const buf = ctx.createBuffer(1, f.length, PHONON_RATE); buf.copyToChannel(f, 0);
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(nextT); sources.add(src); this.played = true;
        const at = nextT; setTimeout(() => { if (!stopped && id === this.sayId) Bus.emit('voice.audio', { f32: f, rate: PHONON_RATE, now: () => ctx.currentTime - at }); }, Math.max(0, (at - now) * 1000));
        src.onended = () => { sources.delete(src); if (genDone && !blocks.length && !sources.size) finish(); };
        nextT += buf.duration;
      }
    };
    const tick = setInterval(() => { flush(false); pump(); }, 80);
    const job = eng.speak(text, Phonon.voiceId(), pcm => {
      if (stopped || id !== this.sayId) return job?.cancel();
      firstAt ||= performance.now(); made += pcm.length; pending.push(pcm); pendingN += pcm.length; flush(false);
    });
    this.stopNeural = () => { stopped = true; job.cancel(); for (const s of sources) { try { s.stop(); } catch {} } sources.clear(); finish(); };
    // No sound within 8 s: the device's voice takes over (speak() catches the throw).
    const watchdog = setTimeout(() => { if (!firstAt) { stopped = true; job.cancel(); finish(new Error('The natural voice took too long')); } }, 8000);
    job.done.then(() => { genMs = performance.now() - t0; genDone = true; flush(true); pump(); if (!blocks.length && !sources.size && !playing) finish(); },
      e => { Log.e('tts', 'Phonon generation failed', e); genDone = true; if (!started) { stopped = true; finish(e); } else { flush(true); pump(); } });
    const err = await done; clearInterval(tick); clearTimeout(watchdog);
    Bus.emit('voice.audio.end');
    if (ctx) { clearTimeout(this.acIdle); this.acIdle = setTimeout(() => ctx.state === 'running' && ctx.suspend().catch(() => {}), 4000); }
    if (id === this.sayId) this.session('auto');
    const sec = made / PHONON_RATE, learned = genDone && !stopped ? Phonon.learn(genMs, sec) : null;
    Log.i('tts', `Phonon finished: ${sec.toFixed(1)} s of speech, made in ${(genMs / 1000).toFixed(1)} s`, { gaps, stopped, speed: learned?.r, build: Phonon.buildKey() });
    if (err instanceof Error && !started) throw err;
  },
});
// Ready a few seconds after launch (from the cache, once downloaded), so the first reply doesn't wait.
setTimeout(() => { if (Phonon.ok() && /^(auto|phonon)$/.test(settings.tts) && !Phonon.engine) Phonon.load().catch(() => {}); }, 3000);
