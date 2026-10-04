'use strict';
/* ============================================================
   Conversation mode (beta): full-duplex voice (design in docs/duplex-voice.md).
   Tap the mic once and keep talking: DriveDeck listens the whole time, even
   while it's replying, so you can interrupt ("stop", or a new command).
   - AudioEngine: one AudioContext and one microphone stream for the whole
     conversation, the phone's audio session in play-and-record. Replies play
     through the same context, so the engine knows exactly what it's saying
     (the "reference" used to tell your voice from its own). Nothing is
     opened and closed per turn, which is what broke the phone's recognizer.
   - Listening is on the device: Moonshine tiny for English (small and fast),
     Whisper base for other languages (Settings › Voice › Language you speak).
   - Convo: the turn manager. Finds where each utterance starts and ends,
     recognises it, drops its own voice (echo), handles interruptions, runs
     commands. Ends after 30 s of quiet or "that's all".
   Loaded after commands.js.
   ============================================================ */
const MOONSHINE_MODEL = 'onnx-community/moonshine-tiny-ONNX';
// Turns the microphone into 20 ms frames at 16 kHz (averaging, which also filters what would alias), off the main thread.
const CAPTURE_WORKLET = `class C extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.t=0;this.s=0;this.c=0;this.o=new Float32Array(320);this.n=0}
process(i){const c=i[0]&&i[0][0];if(c)for(let k=0;k<c.length;k++){this.s+=c[k];this.c++;this.t+=1;if(this.t>=this.r){this.t-=this.r;this.o[this.n++]=this.s/this.c;this.s=0;this.c=0;
if(this.n===320){this.port.postMessage(this.o,[this.o.buffer]);this.o=new Float32Array(320);this.n=0}}}return true}}registerProcessor('dd-cap',C);`;
Budget.COST['moonshine wasm'] = 70; Budget.COST['moonshine webgpu'] = 90;

const AudioEngine = {
  ctx: null, stream: null, node: null, out: null, cur: null, running: false,
  /** Start capture. `onFrame(f32 16 kHz, 320 samples)` gets every 20 ms of microphone. */
  async start(onFrame, onLost) {
    Voice.session('play-and-record');
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (!this.ctx.audioWorklet) throw new Error('This browser can’t process audio in the background (AudioWorklet)');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' })));
    const src = this.ctx.createMediaStreamSource(this.stream), node = this.node = new AudioWorkletNode(this.ctx, 'dd-cap');
    const mute = this.ctx.createGain(); mute.gain.value = 0; // Safari only runs a worklet that's connected to the output
    src.connect(node); node.connect(mute); mute.connect(this.ctx.destination);
    node.port.onmessage = e => onFrame(e.data);
    // While the microphone runs with echo cancellation, iOS turns all playback down (replies sounded feeble on an iPad):
    // make up for it with gain, and a limiter so loud syllables don't clip.
    const lim = this.ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    this.out = this.ctx.createGain(); this.out.gain.value = this.boost(); this.out.connect(lim); lim.connect(this.ctx.destination);
    const track = this.stream.getAudioTracks()[0];
    track?.addEventListener('ended', () => onLost('The microphone was taken by another app'));
    track?.addEventListener('mute', () => Log.w('duplex', 'Microphone muted by the system'));
    this.ctx.onstatechange = () => { Log.d('duplex', `Audio ${this.ctx?.state}`); if (this.ctx?.state === 'interrupted' || this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {}); };
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    this.running = true;
    Log.i('duplex', 'Audio engine on', { rate: this.ctx.sampleRate, session: navigator.audioSession?.type, mic: track?.label, settings: track?.getSettings?.() });
  },
  stop() {
    this.stopPlayback(); this.running = false;
    try { this.node?.port && (this.node.port.onmessage = null); } catch {}
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.ctx?.close().catch(() => {}); this.ctx = null; this.node = null; this.out = null;
    Log.i('duplex', 'Audio engine off');
  },
  /** Play one reply sentence; resolves when it has finished (or was stopped). */
  play(f32, rate) {
    if (!this.ctx) return Promise.resolve();
    const buf = this.ctx.createBuffer(1, f32.length, rate); buf.copyToChannel(f32, 0);
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.out);
    const t0 = this.ctx.currentTime + 0.02;
    this.cur = { f32, rate, t0, s }; this.duck(false);
    return new Promise(res => { s.onended = () => { if (this.cur?.s === s) this.cur = null; res(); }; s.start(t0); });
  },
  stopPlayback() { const c = this.cur; this.cur = null; try { c?.s.stop(); } catch {} },
  /** Turn the reply down while it might be you talking (soft), back up if it wasn't. */
  duck(on) { if (this.out && this.ctx) this.out.gain.setTargetAtTime((on ? 0.25 : 1) * this.boost(), this.ctx.currentTime, 0.02); this.ducked = on; },
  /** Reply loudness: Settings › Logs › Conversation volume, else 2.5× on iPhone/iPad (whose echo cancellation turns playback down), 1.4× elsewhere. */
  boost() { const d = +Diag.get().convoBoost; return d > 0 ? d : isIOS ? 2.5 : 1.4; },
  playing() { return !!this.cur && this.ctx && this.ctx.currentTime < this.cur.t0 + this.cur.f32.length / this.cur.rate; },
  /** Loudness of what's going to the speaker about `delay` seconds ago (the echo arriving now). */
  ref(delay = 0.08) {
    const c = this.cur; if (!c || !this.ctx) return 0;
    const p = Math.floor((this.ctx.currentTime - delay - c.t0) * c.rate), n = Math.floor(c.rate * 0.03);
    if (p < 0 || p >= c.f32.length) return 0;
    let s = 0; for (let i = Math.max(0, p - n); i < Math.min(c.f32.length, p + n); i++) s += c.f32[i] * c.f32[i];
    return Math.sqrt(s / (2 * n)) * (this.ducked ? 0.25 : 1);
  },
};

const BARGE = /^(stop|wait|cancel|no|pause|quiet|hang on|hold on|never ?mind|shut up|enough|okay stop|ok stop)\b/i;
const BYE = /^(that'?s all|that is all|thanks?( you)?|thank you|stop listening|goodbye|bye|we'?re done|end (the )?conversation)[.!]*$/i;
const convoWords = t => (t || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

const Convo = {
  active: false, stt: null, sttLoading: null, q: Promise.resolve(),
  stats: null,
  /** Which on-device recognizer: Moonshine for English (and auto), Whisper for any other language or "several languages". */
  // English: Settings › Voice › Listening in conversations; "Automatic" is Moonshine on a phone (memory), Whisper on tablets and
  // computers (Moonshine tiny misheard an Indian-English speaker often on an iPad; Whisper base on the GPU takes about 0.4 s there).
  model() {
    // The phone's own recognizer (experimental), unless it failed in this conversation: then the on-device one below.
    if (settings.convoStt === 'native' && SR && !this.nativeFailed) return 'native';
    if (!['auto', 'en'].includes(settings.voiceLang || 'auto')) return 'whisper';
    const c = settings.convoStt === 'native' ? 'auto' : settings.convoStt || 'auto';
    // iPhone and iPad too: with the reply voice and an avatar, Whisper on the GPU got an iPad's app killed for memory.
    return c === 'auto' ? (Budget.cls() === 'phone' || (isIOS && !IS_DESKTOP_APP) ? 'moonshine' : 'whisper') : c;
  },
  toggle() { return this.active ? this.end('tapped') : this.start(); },
  async start() {
    if (this.active || this.starting) return;
    this.starting = true;
    Voice.hush(); Voice.respId++; Voice.unlock(); Voice.open(); $('#vChips').hidden = true;
    Voice.show('Starting the conversation…', 'Conversation mode (beta) · on-device');
    this.nativeFailed = false;
    Log.i('duplex', 'Conversation starting', { model: this.model(), lang: settings.voiceLang });
    try {
      await this.loadSTT();
      if (this.stt.which !== 'native') this.warm();
      await AudioEngine.start(f => this.frame(f), why => this.lost(why));
      if (this.stt.which === 'native') NativeSR.start();
    } catch (e) {
      this.starting = false; AudioEngine.stop(); Voice.session('auto');
      Log.e('duplex', 'Conversation mode couldn’t start: tap-to-talk instead', e);
      Voice.show('Conversation mode isn’t available here', e.name === 'NotAllowedError' ? 'Allow the microphone for this site' : 'Using tap-to-talk');
      settings.convo = false; setTimeout(() => { Voice.start(); settings.convo = store.get('settings', {}).convo; }, 1200);
      return;
    }
    this.starting = false; this.active = true;
    this.stats = { turns: 0, bargeIns: 0, falseDucks: 0, echoDrops: 0, sttMs: [], started: Date.now() };
    Object.assign(this, { noise: 0.006, utt: null, pre: [], voiced: 0, quiet: 0, lastSpeech: Date.now(), echoGain: 0.15, replyText: '', replyAt: 0, replyEnd: 0, phoneTalking: false, leaving: false });
    $('#vOrb').classList.add('live', 'convo');
    this.listenUI();
    Bus.emit('voice.listen');
    clearInterval(this.idleT); this.idleT = setInterval(() => { if (this.active && !this.utt && !this.speaking() && Date.now() - this.lastSpeech > 30000) this.end('quiet for 30 s'); }, 1000);
  },
  listenUI() { Voice.show('Listening…', 'Conversation · just talk, interrupt any time · say “that’s all” to finish'); },
  end(why) {
    if (!this.active && !this.starting) return;
    this.active = false; this.starting = false; clearInterval(this.idleT);
    NativeSR.stop(); AudioEngine.stop(); Voice.session('auto');
    const s = this.stats; if (s && NativeSR.used) s.native = { ...NativeSR.stats, fellBack: !!this.nativeFailed }; Log.i('duplex', `Conversation ended (${why})`, s && { ...s, sttMs: s.sttMs.length ? Math.round(s.sttMs.reduce((a, b) => a + b, 0) / s.sttMs.length) : null, minutes: +((Date.now() - s.started) / 60000).toFixed(1) });
    $('#vOrb').classList.remove('live', 'convo');
    Voice.close();
  },
  lost(why) { if (!this.active) return; Log.w('duplex', why); this.end('microphone lost'); Voice.open(); Voice.show('The conversation paused', `${why}. Tap the mic to start again`); },

  /* ---------- Recognition (one at a time, in a worker) ---------- */
  loadSTT() {
    const want = this.model();
    if (this.stt?.which === want) return Promise.resolve(this.stt);
    this.stt?.dispose?.(); this.stt = null; Budget.drop('convo-stt');
    if (want === 'native') return Promise.resolve(this.stt = { which: 'native', dispose() {} }); // nothing to load
    if (want === 'whisper') return Voice.loadModel().then(p => (this.stt = Object.assign(t => p(t, this.whisperOpts()), { which: 'whisper', dispose() {} })));
    const dev = gpuOK() && Budget.cls() !== 'phone' ? 'webgpu' : 'wasm', files = {};
    const builds = [...(dev === 'webgpu' ? [{ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, label: 'GPU fp32/q4' }] : []), { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, label: 'CPU q8' }];
    Budget.room('convo-stt', Budget.COST[`moonshine ${dev}`], true);
    return (this.sttLoading ||= Heavy.run('Moonshine', async () => {
      let last;
      for (const b of builds) {
        try {
          const t = performance.now(), pipe = await createWhisper(b, p => { Voice.progress(p, files, 'listening model'); }, MOONSHINE_MODEL);
          $('#vProg').hidden = true; store.set('moonshineOK', true);
          Budget.add('convo-stt', `Moonshine ${b.label}`, () => { this.stt?.dispose?.(); this.stt = null; }, Budget.COST[`moonshine ${b.device}`]);
          Log.i('duplex', `Moonshine ready ${Math.round(performance.now() - t)} ms (${b.label}, ${pipe.kind})`); Log.mem('convo-stt', `Moonshine ${b.label}`);
          return Object.assign(a => pipe(a, {}), { which: 'moonshine', dispose: () => pipe.dispose() });
        } catch (e) { last = e; Log.w('duplex', `Moonshine ${b.label} failed to load`, e); }
      }
      throw last;
    })).then(s => (this.stt = s), e => { throw e; }).finally(() => { this.sttLoading = null; });
  },
  /** The first recognition is slow (1.1 s against 0.2 s after): run one on silence while the engine starts. */
  warm() {
    if (this.stt?.warmed) return; const s = this.stt; if (s) s.warmed = true;
    const t = performance.now();
    this.recognise(new Float32Array(16000)).then(() => Log.d('duplex', `Listening model warmed up in ${Math.round(performance.now() - t)} ms`), () => {});
  },
  /** The phone's recognizer isn't hearing (deaf, refused, no network): the on-device one for the rest of this conversation. */
  nativeFallback(why) {
    if (this.nativeFailed || !this.active) return;
    this.nativeFailed = true; NativeSR.stop();
    Log.w('duplex', `Phone recognizer: ${why}. Listening on the device instead for this conversation`, NativeSR.stats);
    Voice.show('Switching to on-device listening', 'The phone’s recognizer wasn’t hearing you');
    this.stt = null;
    this.loadSTT().then(() => { Log.i('duplex', `Now listening with ${this.stt.which}`); if (this.active && !this.utt) this.listenUI(); })
      .catch(e => { Log.e('duplex', 'On-device listening couldn’t load either', e); this.end('no recognizer'); });
  },
  whisperOpts() { const l = LANGS[settings.voiceLang] || LANGS.auto; return { language: l[1], task: l[1] && l[1] !== 'en' ? 'translate' : 'transcribe' }; },
  recognise(audio) {
    const run = async () => {
      const t = performance.now();
      const out = await Promise.race([this.stt(audio), new Promise((_, rej) => setTimeout(() => rej(new Error('Recognition took over 6 s')), 6000))]);
      const ms = Math.round(performance.now() - t); if (this.active) this.stats?.sttMs.push(ms);
      return { text: (out?.text || '').trim().replace(/^[\s"“]+|[\s"”]+$/g, ''), ms };
    };
    return (this.q = this.q.catch(() => {}).then(run));
  },

  /* ---------- Every 20 ms of microphone ---------- */
  speaking() { return AudioEngine.playing() || this.phoneTalking; },
  frame(f) {
    if (!this.active) return;
    let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
    const rms = Math.sqrt(s / f.length), ref = AudioEngine.ref(), talking = this.speaking();
    // While replying, a frame counts as you only if it's well above the echo of the reply (layer 2 of the design).
    const thr = Math.max(0.018, this.noise * 3, talking ? (ref ? this.echoGain * ref * 3 : 0.06) : 0);
    const loud = rms > thr;
    // Learn how loud the echo is in the reply's first 600 ms, from frames that don't already sound like you.
    if (talking && ref > 0.01 && !this.utt && !loud && Date.now() - this.replyAt < 600) this.echoGain = Math.min(2, Math.max(0.02, this.echoGain * 0.9 + (rms / ref) * 0.1));
    if (!this.utt) {
      this.pre.push(f); if (this.pre.length > 15) this.pre.shift(); // 300 ms kept from before speech starts
      if (!talking && !loud) this.noise = this.noise * 0.95 + rms * 0.05;
      this.voiced = loud ? this.voiced + 1 : Math.max(0, this.voiced - 1);
      if (this.voiced >= (talking ? 12 : 8)) { // 240 ms during a reply, 160 ms otherwise
        this.utt = { frames: [...this.pre], duringReply: talking, at: performance.now(), t: Date.now() }; this.pre = []; this.quiet = 0; this.voiced = 0;
        this.lastSpeech = Date.now();
        if (talking) { AudioEngine.duck(true); Log.i('duplex', 'You may be talking over the reply: turned down', { rms: +rms.toFixed(3), ref: +ref.toFixed(3), echoGain: +this.echoGain.toFixed(2) }); }
        else Log.d('duplex', 'Speech started', { rms: +rms.toFixed(3), noise: +this.noise.toFixed(4) });
        Bus.emit('voice.speechstart');
        if (!talking) Voice.show('Listening…', 'Go on…');
      }
      return;
    }
    this.utt.frames.push(f);
    if (loud) { this.quiet = 0; this.lastSpeech = Date.now(); } else this.quiet++;
    const gap = this.utt.duringReply ? 30 : Math.round((+settings.convoGap || 1) * 50); // 0.6 s during a reply
    if (this.quiet >= gap || this.utt.frames.length > 15 * 50) this.finish();
  },
  async finish() {
    const u = this.utt, tail = Math.max(0, this.quiet - 10); this.utt = null; this.quiet = 0; // keep 200 ms of the trailing quiet
    const frames = u.frames.slice(0, u.frames.length - tail), audio = new Float32Array(frames.length * 320);
    frames.forEach((f, i) => audio.set(f, i * 320));
    this.stats.turns++;
    let r;
    if (!this.stt) { Log.w('duplex', 'Not heard: the listening model is still loading', { secs: +(audio.length / 16000).toFixed(1) }); if (u.duringReply) AudioEngine.duck(false); return; }
    if (this.stt.which === 'native') { // the phone's words for this stretch of speech
      r = await NativeSR.take(u.t, audio.length / 16000);
      if (!r.text && audio.length >= 16000 * 0.8 && ++NativeSR.misses >= 2) this.nativeFallback('it heard nothing twice while you spoke');
      if (r.text) NativeSR.misses = 0; this.stats.sttMs.push(r.ms);
    } else try { r = await this.recognise(audio); }
    catch (e) { Log.w('duplex', 'Recognition failed', e); if (u.duringReply) AudioEngine.duck(false); else Voice.show('Sorry, I didn’t catch that', 'Say it again'); return; }
    if (!this.active) return;
    const text = r.text, w = convoWords(text);
    Log.i('duplex', `Heard ${(audio.length / 16000).toFixed(1)} s in ${r.ms} ms${u.duringReply ? ' (during a reply)' : ''}`, { text });
    // Nothing usable, or the recognizer's usual hallucinations on noise.
    if (!w.length || (/^(thank you|thanks for watching|you|bye)[.!]*$/i.test(text) && audio.length < 16000 * 1.2)) {
      if (u.duringReply) { this.stats.falseDucks++; AudioEngine.duck(false); }
      return;
    }
    // Its own voice coming back from the speakers: mostly the reply's own words (layer 3).
    if (u.duringReply || u.t - this.replyEnd < 1500) { // counted from when it started: the echo of the reply's last words
      const reply = new Set(convoWords(this.replyText)), mine = w.filter(x => reply.has(x)).length;
      if (w.length && mine / w.length >= 0.6 && !BARGE.test(text)) { this.stats.echoDrops++; Log.i('duplex', 'Dropped: its own voice (echo)', { text, reply: this.replyText }); AudioEngine.duck(false); return; }
    }
    if (this.leaving && !BARGE.test(text) && !BYE.test(text)) { Log.i('duplex', 'Ignored while handing off to another app', { text }); AudioEngine.duck(false); return; }
    if (u.duringReply) {
      this.stats.bargeIns++; Log.i('duplex', 'Interrupted the reply', { text, ms: Math.round(performance.now() - u.at) });
      Voice.hush(); Bus.emit('voice.interrupt', { value: text });
      if (BARGE.test(text) && w.length <= 3) { Voice.show('Okay.', 'Listening…'); setTimeout(() => this.active && this.listenUI(), 900); return; }
    }
    // On Stage, following the presenter: only their speech counts (their mouth was moving while it was said).
    if (typeof People !== 'undefined' && People.running && People.owner != null && settings.ownerOnly && typeof Stage !== 'undefined' && Stage.on && !People.spoke(u.at, performance.now() - 200)) {
      Log.i('duplex', 'Ignored: not the presenter speaking', { text }); AudioEngine.duck(false); return;
    }
    if (BYE.test(text)) { VoiceLog.you(text, { engine: ({ whisper: 'Whisper', native: 'Phone' })[this.stt?.which] || 'Moonshine' }); return Voice.respond('Okay. Talk to you later.', () => this.end('you said goodbye'), { leaves: true }); }
    Voice.heard(text, { engine: ({ whisper: 'Whisper', native: 'Phone' })[this.stt?.which] || 'Moonshine', ms: r.ms });
  },

  /* ---------- Replies ---------- */
  /** Voice.respond tells us what it's saying; when it ends, back to listening. A reply that opens another app ends the conversation. */
  replying(msg, said, o) {
    this.replyText = msg; this.replyAt = Date.now();
    Promise.resolve(said).then(() => { this.replyEnd = Date.now(); if (this.active && !this.utt) { AudioEngine.duck(false); this.listenUI(); } });
    // A reply that opens another app: only "stop" can cancel it. The conversation pauses if the app really comes to the front.
    this.leaving = !!o?.leaves; if (o?.leaves) Promise.resolve(said).then(() => setTimeout(() => (this.leaving = false), 1500));
  },
  /** A reply sentence from the on-device voice, played through the engine (with lip-sync). */
  async play({ n, f32, rate }) {
    Voice.played = true;
    const done = AudioEngine.play(f32, rate), c = AudioEngine.cur;
    Log.d('tts', `▶ sentence ${n} (conversation engine)`, { secs: +(f32.length / rate).toFixed(2) });
    Bus.emit('voice.audio', { f32, rate, now: () => (AudioEngine.ctx ? AudioEngine.ctx.currentTime - c.t0 : 99) });
    await done; Bus.emit('voice.audio.end');
  },
};
// Another app came to the front (a hand-off, or you switched): the microphone is gone, so pause; tap the mic to carry on.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && Convo.active) { Convo.end('the app went to the background'); Convo.paused = Date.now(); }
  else if (!document.hidden && Convo.paused && Date.now() - Convo.paused < 10 * 60000) {
    Convo.paused = 0; Voice.open(); $('#vChips').hidden = true; Voice.show('Conversation paused', 'Tap the mic to carry on talking');
  }
});
/* The phone's own recognizer inside a conversation (Settings › Voice › Listening in conversations › Phone, experimental).
   It only supplies words: the engine's microphone still finds where you start and stop, tells you from the reply,
   handles interruptions and drives the avatar. It runs continuously and is restarted whenever it stops; results are
   kept with the time they came, and each stretch of your speech takes the words that arrived during and just after it.
   If it errors (refused, no network, no audio) or hears nothing twice while you spoke, Convo switches to on-device
   listening (Convo.nativeFallback). */
const NativeSR = {
  sr: null, on: false, finals: [], interim: null, misses: 0, used: false, stats: null, starts: [],
  start() {
    this.on = true; this.used = true; this.finals = []; this.interim = null; this.misses = 0; this.starts = [];
    this.stats = { restarts: 0, results: 0, errors: {} };
    this.open();
  },
  open() {
    if (!this.on) return;
    const now = Date.now(); this.starts = this.starts.filter(t => now - t < 60000); this.starts.push(now);
    if (this.starts.length > 30) return Convo.nativeFallback('it kept stopping (over 30 restarts a minute)');
    const r = this.sr = new SR();
    r.lang = (LANGS[settings.voiceLang] || LANGS.auto)[2]; r.continuous = true; r.interimResults = true;
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i][0]?.transcript || '').trim(); if (!t) continue;
        if (e.results[i].isFinal) { this.finals.push({ text: t, at: Date.now() }); this.interim = null; this.stats.results++; }
        else this.interim = { text: t, at: Date.now() };
      }
    };
    r.onerror = e => {
      this.stats.errors[e.error] = (this.stats.errors[e.error] || 0) + 1;
      Log.d('duplex', `Phone recognizer: ${e.error}`);
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(e.error)) Convo.nativeFallback(`error “${e.error}”`);
    };
    r.onend = () => { if (this.sr === r && this.on) { this.stats.restarts++; setTimeout(() => this.sr === r && this.open(), 150); } }; // it stops after pauses: start again
    try { r.start(); Log.d('duplex', 'Phone recognizer listening', { lang: r.lang }); }
    catch (e) { Log.w('duplex', 'Phone recognizer wouldn’t start', e); Convo.nativeFallback('it wouldn’t start'); }
  },
  stop() {
    this.on = false; const r = this.sr; this.sr = null;
    if (r) { r.onend = r.onresult = r.onerror = null; try { r.abort(); } catch {} }
  },
  /** The words for speech that started at `since` (ms): final results from then on, waiting up to 2.5 s for them;
      at the deadline, what it was still working on counts too. */
  async take(since, secs) {
    const t0 = performance.now(), from = since - 500, deadline = Date.now() + 2500;
    const got = () => this.finals.filter(f => f.at >= from);
    while (Date.now() < deadline && this.on) {
      if (got().length && (!this.interim || this.interim.at < Date.now() - 600)) break; // a final, and nothing more coming
      await new Promise(r => setTimeout(r, 100));
    }
    let text = got().map(f => f.text).join(' ');
    if (!text && this.interim?.at >= from) text = this.interim.text;
    this.finals = this.finals.filter(f => f.at < from); this.interim = null; // used up
    return { text, ms: Math.round(performance.now() - t0), secs };
  },
};
Bus.define('voice.interrupt', 'You interrupt a reply', 'what you said');
// The phone's own voice can't go through the engine: track when it talks so the mic is stricter meanwhile.
Bus.on('voice.talk', d => { Convo.phoneTalking = !!d.on; if (!d.on) Convo.replyEnd = Date.now(); });
