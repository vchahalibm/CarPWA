'use strict';
/* ============================================================
   Setup: the first start after installing, and the first start after an update. The agent sets the app up in front of
   you: a checklist that fills in live (this device, the natural voice downloading and its speed check, the chosen voice,
   listening, camera recognition, the 3D assistant, the start screen, your Mac), each with where to change it in Settings.
   After an update the same screen shows what's new; what's already in place is ticked at once and anything new is
   downloaded. Start (a tap, which also lets iOS play sound) says hello in the chosen voice. Skipped in the tandem tests.
   Loaded after agent.js.
   ============================================================ */
// What's new in this update (shown on the first start after it). Newest first; keep it to a few lines.
const SETUP_NEWS = [
  'Sign-ins in the agent browser are kept when StudioGen restarts or updates',
  'Containers for the agent browser, like Firefox’s: Work and Personal sign-ins kept apart (Agent › Library › Settings)',
  'Settings › System › Debug log: turn on the log with the key, to send it with a problem',
  'The Agent screen shows the assistant beside your cards (and beside the watch panel while a task runs)',
  'Fixed: the window can be dragged again after a task has run; the mail summary is spoken in full, with the right count',
  'WhatsApp Web works in the agent browser, and any task whose page needs a sign-in now stops and opens the agent browser for you',
  'On Stage, say “help me build a task”: the assistant asks, you answer by voice or typing, and it builds, checks and runs the task (Claude, a command-line AI, Ollama, IBM Bob or the Mac’s model)',
  'Tasks can ask yes or no in the middle (“Priya said … Send ‘on my way’?”)',
  'Build tasks by describing them: copy the prompt into Claude, or plan one with your Mac’s own model, then check it on the real pages (Settings › Scripts & tasks › Build with an LLM)',
  'Practice Slack and WhatsApp beside the practice inbox, to try tasks safely (Agent › Library › Settings › Use the practice sites)',
  'Make and change agent tasks in Settings › Scripts & tasks › Agent tasks, or Teach me: do it once in the agent browser',
  'While presenting, weather, messages, “what can I say” and other screens open as cards over the slides; say “close card”',
  'Agent tasks can be watched step by step (Agent › Library › Settings › Show the browser while tasks run)',
  'On Stage, a gesture of your choice opens the microphone for the presenter (Settings › Stage)',
  'Conversation mode plays the natural voice without the small gaps',
  'A new natural voice, Phonon: about 3× faster than speech on an iPhone, and it starts at once',
  'While it works on something, the assistant says so, types and then thinks',
  'Camera recognition runs on the CPU on phones and tablets, leaving the graphics chip to the voice and the assistant',
];
const Setup = {
  rows: [], version: null,
  async check() {
    const q = new URLSearchParams(location.search);
    if (q.has('tandem') || q.has('linktest') || q.has('view') || store.get('setupDone') === 'skip') return;
    try { this.version = (/VERSION = '([^']+)'/.exec(await (await fetch('sw.js', { cache: 'no-store' })).text()) || [])[1] || 'v0'; } catch { this.version = 'v0'; }
    const done = store.get('setupDone', null);
    if (!done) return this.show('install');
    if (done !== this.version) return this.show('update');
  },
  show(mode) {
    this.mode = mode; this.rows = []; this.touched = false;
    document.getElementById('setup')?.remove();
    const el = document.createElement('div'); el.id = 'setup'; el.className = 'su-root';
    el.innerHTML = `<div class="su-card">
      <div class="su-head"><div class="su-orb" aria-hidden="true"><i></i></div><div><h1 class="su-title"></h1><p class="su-sub">${mode === 'install' ? `I’m getting ${APP_NAME} ready on this ${this.deviceName().toLowerCase()}. Everything here can be changed later in Settings.` : `${APP_NAME} was updated. Here’s what’s new, what’s already in place and what I’m updating.`}</p></div></div>
      ${mode === 'update' ? `<div class="su-news"><b>What’s new</b><ul>${SETUP_NEWS.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
      <ol class="su-list"></ol>
      <div class="su-foot"><button class="big-btn" data-su="settings">Settings</button><button class="big-btn accent" data-su="start">Start</button></div></div>`;
    document.body.appendChild(el);
    el.addEventListener('pointerdown', () => { this.touched = true; }, { once: true });
    this.type(el.querySelector('.su-title'), mode === 'install' ? `Setting up ${APP_NAME} for you` : `${APP_NAME} is up to date`);
    this.run();
  },
  /** The headline appears as if typed. */
  type(h, text) { let i = 0; const t = setInterval(() => { h.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(t); }, 28); },
  deviceName() { return IS_DESKTOP_APP ? 'Mac' : Budget.cls() === 'phone' ? (isIOS ? 'iPhone' : 'phone') : Budget.cls() === 'tablet' ? (isIOS ? 'iPad' : 'tablet') : 'computer'; },
  /** A checklist row: state 'work' (spinner), 'done' (✓), 'info' (i), 'warn' (!); where = the Settings place to change it. */
  row(key, title) {
    const li = document.createElement('li'); li.className = 'su-row work'; li.innerHTML = `<span class="su-ic"></span><div class="su-main"><b>${esc(title)}</b><span class="su-d">…</span><div class="su-bar" hidden><i></i></div></div>`;
    document.querySelector('#setup .su-list')?.appendChild(li); requestAnimationFrame(() => li.classList.add('in'));
    const r = { li, set: (state, detail, where) => { li.className = `su-row in ${state}`; li.querySelector('.su-d').innerHTML = `${esc(detail)}${where ? ` <span class="su-where">${esc(where)}</span>` : ''}`; },
      progress: f => { const b = li.querySelector('.su-bar'); b.hidden = f == null; if (f != null) b.firstElementChild.style.width = `${Math.round(f * 100)}%`; } };
    this.rows.push(r); return r;
  },
  wait: ms => new Promise(r => setTimeout(r, ms)),
  async run() {
    const gap = this.mode === 'update' ? 120 : 380;
    // This device
    let r = this.row('device', 'This device');
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
    await this.wait(gap); r.set('done', `${this.deviceName()} · ${adapter ? 'graphics chip available to the app (WebGPU)' : 'no graphics chip access here: the CPU does the work'}`);
    // The natural voice
    const b = Phonon.build(), english = /^(auto|en)/.test(settings.voiceLang || 'auto');
    r = this.row('voice', 'Natural voice');
    if (!english) r.set('info', 'Phonon speaks English only: replies use the device’s voice for your language', 'Settings › Voice');
    else if (Phonon.ok() && this.mode === 'update') { r.set('done', `Phonon is already here (${b.label}, ${b.mb} MB)`, 'Settings › Voice'); Phonon.load().catch(() => {}); }
    else {
      r.set('work', `Downloading Phonon for the ${b.label === 'GPU' ? 'graphics chip' : 'CPU'} · ${b.mb} MB, once`);
      try {
        await Phonon.load((a, t) => { if (t > 1e6) { r.progress(a / t); r.set('work', `Downloading Phonon · ${Math.round(a / 1e6)} of ${Math.round(t / 1e6)} MB`); } });
        r.progress(null); r.set('done', `Phonon is ready (${Phonon.build().label}), works offline from now on`, 'Settings › Voice');
      } catch (e) { r.progress(null); r.set('warn', `Didn’t download (${e.message}): the device’s voice answers for now; try again in Settings`, 'Settings › Voice › Download the natural voice'); }
    }
    // Its speed here
    if (english && Phonon.engine) {
      r = this.row('speed', 'Speed check');
      try {
        const t0 = performance.now(); let n = 0;
        await Phonon.engine.speak('Checking how fast I can speak on this device.', Phonon.voiceId(), pcm => { n += pcm.length; }).done;
        const ms = performance.now() - t0, sec = n / PHONON_RATE, s = Phonon.learn(ms, sec), x = sec / (ms / 1000);
        r.set(x >= 1.05 ? 'done' : 'warn', x >= 1.05 ? `${x.toFixed(1)}× faster than speech: replies use the natural voice` : `${x.toFixed(1)}× speech speed: too slow here, replies use the device’s voice`, 'Settings › Voice › Check the voices');
        if (s && s.r > 0.95 && settings.tts === 'phonon') { settings.tts = 'auto'; applySettings(); }
      } catch (e) { r.set('warn', `Couldn’t time it (${e.message})`); }
    }
    // The voice chosen
    r = this.row('who', 'Voice');
    await this.wait(gap);
    const name = (store.get('phononVoices', []) || []).find(v => v.id === Phonon.voiceId())?.name || (settings.voiceGender === 'male' ? 'Preston' : 'Harper');
    r.set('done', english ? `${name}, ${settings.voiceGender === 'male' ? 'male' : 'female'} (25 English voices to choose from)` : `${PhoneVoices.pick()?.name || 'The device’s voice'}`, 'Settings › Voice › Natural voice');
    Phonon.voices().catch(() => {});
    // Listening
    r = this.row('ears', 'Listening'); await this.wait(gap);
    r.set('done', IS_DESKTOP_APP ? 'Apple’s speech recognizer, on this Mac' : typeof SR !== 'undefined' && SR ? 'This device’s own recognizer (nothing to download)' : 'Whisper on this device (downloads when you first talk)', 'Settings › Voice › Speech recognition');
    // Camera recognition
    r = this.row('eyes', 'Camera recognition'); await this.wait(gap);
    r.set('info', `${Budget.cls() === 'desktop' && adapter ? 'On the graphics chip' : 'On the CPU, leaving the graphics chip to the voice and the assistant'}; the model (about 10 MB) downloads the first time you use the camera`, 'Settings › Camera & objects');
    // The 3D assistant
    r = this.row('face', '3D assistant'); await this.wait(gap);
    r.set('info', `${settings.appMode === 'stage' ? 'Full gestures on Stage' : 'Expressions only while driving'}; the character downloads when it’s first shown`, 'Settings › Assistant › Avatars');
    // Start screen
    r = this.row('home', 'Start screen'); await this.wait(gap);
    r.set('done', ({ start: 'The start page', agent: 'The Agent screen (your results)', dashboard: 'The dashboard' })[settings.startScreen] || 'The dashboard', 'Settings › System › Start screen');
    // Your Mac / Apple's model
    r = this.row('mac', IS_DESKTOP_APP ? 'Apple’s on-device model' : 'Your Mac'); await this.wait(gap);
    if (IS_DESKTOP_APP) { const st = await MacAI.status().catch(() => null); r.set(st?.available ? 'done' : 'info', st?.available ? 'Available: commands by meaning and summaries run on this Mac' : 'Not available on this Mac (macOS 26 and Apple Intelligence needed): everything else works', 'Settings › Voice › Understand commands by meaning'); }
    else r.set(Link.ready() ? 'done' : 'info', Link.ready() ? `Paired with ${Link.macName()}: mail, calendar and chats run there` : 'Pair with StudioGen on your Mac for mail, calendar and chats', 'Settings › Connections');
    this.finished = true;
    document.querySelector('#setup .su-orb')?.classList.add('done');
    // After an update with nothing to decide, it closes by itself unless you've touched it.
    if (this.mode === 'update' && !this.rows.some(x => /warn/.test(x.li.className))) setTimeout(() => { if (!this.touched && document.getElementById('setup')) this.close(false); }, 7000);
  },
  close(greet) {
    store.set('setupDone', this.version || 'v0');
    const el = document.getElementById('setup'); if (!el) return;
    el.classList.add('out'); setTimeout(() => el.remove(), 350);
    if (greet) Voice.speak(this.mode === 'install' ? `Hi, I’m ready. Ask me anything.` : 'All set.');
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-su]'); if (!b) return;
  if (b.dataset.su === 'start') Setup.close(true);
  else { Setup.close(false); openView('settings'); }
});
addEventListener('DOMContentLoaded', () => setTimeout(() => Setup.check(), 600));
