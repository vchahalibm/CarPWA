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
    this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination);
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
  duck(on) { if (this.out && this.ctx) this.out.gain.setTargetAtTime(on ? 0.25 : 1, this.ctx.currentTime, 0.02); this.ducked = on; },
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
  model() { return ['auto', 'en'].includes(settings.voiceLang || 'auto') ? 'moonshine' : 'whisper'; },
  toggle() { return this.active ? this.end('tapped') : this.start(); },
  async start() {
    if (this.active || this.starting) return;
    this.starting = true;
    Voice.hush(); Voice.respId++; Voice.unlock(); Voice.open(); $('#vChips').hidden = true;
    Voice.show('Starting the conversation…', 'Conversation mode (beta) · on-device');
    Log.i('duplex', 'Conversation starting', { model: this.model(), lang: settings.voiceLang });
    try {
      await this.loadSTT();
      await AudioEngine.start(f => this.frame(f), why => this.lost(why));
    } catch (e) {
      this.starting = false; AudioEngine.stop(); Voice.session('auto');
      Log.e('duplex', 'Conversation mode couldn’t start: tap-to-talk instead', e);
      Voice.show('Conversation mode isn’t available here', e.name === 'NotAllowedError' ? 'Allow the microphone for this site' : 'Using tap-to-talk');
      settings.convo = false; setTimeout(() => { Voice.start(); settings.convo = store.get('settings', {}).convo; }, 1200);
      return;
    }
    this.starting = false; this.active = true;
    this.stats = { turns: 0, bargeIns: 0, falseDucks: 0, echoDrops: 0, sttMs: [], started: Date.now() };
    Object.assign(this, { noise: 0.006, utt: null, pre: [], voiced: 0, quiet: 0, lastSpeech: Date.now(), echoGain: 0.15, replyText: '', replyAt: 0, phoneTalking: false });
    $('#vOrb').classList.add('live', 'convo');
    this.listenUI();
    Bus.emit('voice.listen');
    clearInterval(this.idleT); this.idleT = setInterval(() => { if (this.active && !this.utt && !this.speaking() && Date.now() - this.lastSpeech > 30000) this.end('quiet for 30 s'); }, 1000);
  },
  listenUI() { Voice.show('Listening…', 'Conversation · just talk, interrupt any time · say “that’s all” to finish'); },
  end(why) {
    if (!this.active && !this.starting) return;
    this.active = false; this.starting = false; clearInterval(this.idleT);
    AudioEngine.stop(); Voice.session('auto');
    const s = this.stats; Log.i('duplex', `Conversation ended (${why})`, s && { ...s, sttMs: s.sttMs.length ? Math.round(s.sttMs.reduce((a, b) => a + b, 0) / s.sttMs.length) : null, minutes: +((Date.now() - s.started) / 60000).toFixed(1) });
    $('#vOrb').classList.remove('live', 'convo');
    Voice.close();
  },
  lost(why) { if (!this.active) return; Log.w('duplex', why); this.end('microphone lost'); Voice.open(); Voice.show('The conversation paused', `${why}. Tap the mic to start again`); },

  /* ---------- Recognition (one at a time, in a worker) ---------- */
  loadSTT() {
    const want = this.model();
    if (this.stt?.which === want) return Promise.resolve(this.stt);
    this.stt?.dispose?.(); this.stt = null; Budget.drop('convo-stt');
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
  whisperOpts() { const l = LANGS[settings.voiceLang] || LANGS.auto; return { language: l[1], task: l[1] && l[1] !== 'en' ? 'translate' : 'transcribe' }; },
  recognise(audio) {
    const run = async () => {
      const t = performance.now();
      const out = await Promise.race([this.stt(audio), new Promise((_, rej) => setTimeout(() => rej(new Error('Recognition took over 6 s')), 6000))]);
      const ms = Math.round(performance.now() - t); this.stats?.sttMs.push(ms);
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
        this.utt = { frames: [...this.pre], duringReply: talking, at: performance.now() }; this.pre = []; this.quiet = 0; this.voiced = 0;
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
    try { r = await this.recognise(audio); }
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
    if (u.duringReply || Date.now() - this.replyEnd < 1500) {
      const reply = new Set(convoWords(this.replyText)), mine = w.filter(x => reply.has(x)).length;
      if (w.length && mine / w.length >= 0.6 && !BARGE.test(text)) { this.stats.echoDrops++; Log.i('duplex', 'Dropped: its own voice (echo)', { text, reply: this.replyText }); AudioEngine.duck(false); return; }
    }
    if (u.duringReply) {
      this.stats.bargeIns++; Log.i('duplex', 'Interrupted the reply', { text, ms: Math.round(performance.now() - u.at) });
      Voice.hush(); Bus.emit('voice.interrupt', { value: text });
      if (BARGE.test(text) && w.length <= 3) { Voice.show('Okay.', 'Listening…'); setTimeout(() => this.active && this.listenUI(), 900); return; }
    }
    if (BYE.test(text)) { VoiceLog.you(text, { engine: this.stt?.which === 'whisper' ? 'Whisper' : 'Moonshine' }); return Voice.respond('Okay. Talk to you later.', () => this.end('you said goodbye'), { leaves: true }); }
    Voice.heard(text, { engine: this.stt?.which === 'whisper' ? 'Whisper' : 'Moonshine', ms: r.ms });
  },

  /* ---------- Replies ---------- */
  /** Voice.respond tells us what it's saying; when it ends, back to listening. A reply that opens another app ends the conversation. */
  replying(msg, said, o) {
    this.replyText = msg; this.replyAt = Date.now();
    Promise.resolve(said).then(() => { this.replyEnd = Date.now(); if (this.active && !this.utt) { AudioEngine.duck(false); this.listenUI(); } });
    if (o?.leaves) Promise.resolve(said).then(() => this.end('handed off to another app'));
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
Bus.define('voice.interrupt', 'You interrupt a reply', 'what you said');
// The phone's own voice can't go through the engine: track when it talks so the mic is stricter meanwhile.
Bus.on('voice.talk', d => { Convo.phoneTalking = !!d.on; if (!d.on) Convo.replyEnd = Date.now(); });
