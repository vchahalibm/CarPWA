'use strict';
/* ============================================================
   Setup: the first start after installing, and the first start after an update. The agent sets the app up in front of
   you: a checklist that fills in live (this device, the natural voice downloading and its speed check, the chosen voice,
   listening, camera recognition, the 3D assistant, the start screen, your Mac, and one question: how long requests wait for
   an offline Mac), each with where to change it in Settings.
   After an update the same screen shows what's new; what's already in place is ticked at once and anything new is
   downloaded. Start (a tap, which also lets iOS play sound) says hello in the chosen voice. Skipped in the tandem tests.
   Loaded after agent.js.
   ============================================================ */
// What's new in this update (shown on the first start after it). Newest first; keep it to a few lines.
const SETUP_NEWS = [
  'Fixed: the built-in model didn’t see its model, so it offered a download and Ollama answered instead',
  '“What’s my day on 2nd Nov”, “my meetings tomorrow”: the calendar task takes a day now',
  'Weather for your place: Settings › Location › Your place; the weather says which place it shows',
  'Turned down the microphone, speech recognition or the camera by mistake? The app now offers to ask again (and Settings › System › Permissions)',
  'The Agent screen’s timeline starts with your earlier results',
  'The language model is built into StudioGen now: nothing else to install (it reads the copy Ollama has, or downloads gpt-oss once)',
  'Workers from the app: Mesh › Workers › + New Worker, in OrbStack (installed for you if needed), light on this Mac, or on another machine; each with its own sign-ins, using this Mac’s model',
  'One language model for everything, on your Mac by default: gpt-oss (picked by this Mac’s memory, downloaded here), Claude as the option; phones and Workers use the Mac’s (Settings › Assistant › Language model)',
  'Read and change every prompt the app sends to the model: Settings › Assistant › Prompts',
  'The Agent screen keeps a timeline of the tasks and scripts that ran, below the newest cards',
  'Sign in on your Mac from your phone: when a task stops at a sign-in, “Sign in from here” shows the agent browser live (your own devices, the same network)',
  'Tasks run side by side: mail, WhatsApp and Slack at once, each in its own browser (Agent settings › Tasks at once)',
  'StudioGen Worker: StudioGen in Docker, with sign-ins of its own, set up and used from your devices (worker/README.md)',
  'StudioGBee (optional, one Docker command, bee/README.md): requests for an offline Mac wait there and the answer comes even if the app was closed, with a notification; backups; a dashboard for mesh owners (Settings › Connections › StudioGBee)',
  'Your sign-ins stay yours: tasks that use your mail, chats or Mac run only for your own devices; shared tasks without a sign-in (a web search) can be run on your StudioGen by anyone in the mesh, just by asking',
  'If your Mac is offline, a request waits for it (10 minutes to start with) and runs when it’s back (Agent › Library › Settings › Waiting requests)',
  'Practice Teams beside the practice inbox, Slack and WhatsApp, and a new task: “what did Priya say on Teams?”',
  'Answers are read in full: up to five items as “who: the gist”, then how many more are on the card; going to another screen lets the reply finish',
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
    if (this.running && document.getElementById('setup')) return; // one checklist at a time (a second run would fill the same list)
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
  async run() { this.running = true; try { await this.run1(); } finally { this.running = false; } },
  async run1() {
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
    r = this.row('mac', IS_DESKTOP_APP ? 'Language model' : 'Your Mac'); await this.wait(gap);
    if (IS_DESKTOP_APP) await this.model(r);
    else r.set(Link.ready() ? 'done' : 'info', Link.ready() ? `Paired with ${Link.macName()}: mail, calendar and chats run there` : 'Pair with StudioGen on your Mac for mail, calendar and chats', 'Settings › Connections');
    // Waiting requests: asked once (install, or the first update that has it), then in Agent settings
    if (typeof Agent !== 'undefined' && !store.get('waitRules', null)) {
      r = this.row('wait', 'When your Mac is offline'); await this.wait(gap); this.asked = true;
      const pick = m => { store.set('waitRules', { ...Agent.waitRules(), ...Object.fromEntries(Agent.WAIT_KINDS.map(([k]) => [k, m])) }); r.set('done', `Requests wait ${m < 0 ? 'until it’s back' : m ? `up to ${Agent.waitLabel(m)}` : 'not at all'}; sending something that waited asks again`, 'Agent › Library › Settings › Waiting requests (each kind)'); };
      r.set('info', 'How long should a request (mail, chats, a web search…) wait for it to come back?', '');
      r.li.querySelector('.su-main').insertAdjacentHTML('beforeend', `<div class="chip-row su-pick">${[[0, 'Don’t wait'], [10, '10 minutes'], [60, '1 hour'], [-1, 'Until it’s back']].map(([m, l]) => `<button class="chip${m === 10 ? ' accent' : ''}" data-suwait="${m}">${l}</button>`).join('')}</div>`);
      r.li.addEventListener('click', e => { const b = e.target.closest('[data-suwait]'); if (!b) return; this.touched = true; r.li.querySelector('.su-pick')?.remove(); pick(+b.dataset.suwait); });
    }
    this.finished = true;
    document.querySelector('#setup .su-orb')?.classList.add('done');
    // After an update with nothing to decide, it closes by itself unless you've touched it.
    if (this.mode === 'update' && !this.asked && !this.rows.some(x => /warn/.test(x.li.className))) setTimeout(() => { if (!this.touched && document.getElementById('setup')) this.close(false); }, 7000);
  },
  /** The language model on this Mac (js/llm.js): this Mac's memory picks the model (gpt-oss 20B on 16 GB and up, 120B on
      80 GB and up); Ollama runs it; the download starts from here; a bigger model is suggested with another Mac in a pool. */
  async model(r) {
    if (typeof LLM === 'undefined' || window.DriveDeckDesktop?.worker) return r.set('info', window.DriveDeckDesktop?.worker ? 'Uses your Mac’s model (through the mesh)' : '—', '');
    const f = await LLM.fit(), ol = await LLM.ollama(), where = 'Settings › Assistant › Language model';
    const pool = f.next ? ` With another Mac in a pool, ${f.next.name} (about ${f.next.need} GB together) would answer better.` : '';
    if (!f.best) return r.set('info', `${f.gb} GB of memory is too little for a local model: add your Claude key, or pool this Mac with another.${pool}`, where);
    // built into StudioGen (desktop/llm.js): Ollama's copy is used as it is; else one download, nothing to install
    const bi = await LLM.builtin(true);
    if (bi.available && !(ol.up && LLM.cfg().roles.cards === 'local')) {
      const m = bi.models?.find(x => x.id === f.best.id) || {};
      if (!bi.model && m.ollama) { await DriveDeckDesktop.llm.use({ id: f.best.id, ollama: true }); await LLM.builtin(true); }
      else if (!bi.model && m.downloaded) { await DriveDeckDesktop.llm.use({ id: f.best.id }); await LLM.builtin(true); }
      if (LLM.biReady()) { r.set('done', `${LLM.bi.model.id} is built into StudioGen${LLM.bi.model.source === 'ollama' ? ' and reads the model file Ollama already has (Ollama itself isn’t used): nothing to download' : ''}. Understanding, cards and building run on this Mac (${f.gb} GB), private and free.${pool}`, where);
        if (LLM.bi.model.source === 'ollama' && !m.downloaded && !LLM.bi.downloading) { r.li.querySelector('.su-main').insertAdjacentHTML('beforeend', `<div class="chip-row su-pick"><button class="chip" data-sumodel="own|${f.best.id}">Download StudioGen’s own copy instead (${f.best.size})</button></div>`);
          r.li.onclick = async e => { const b = e.target.closest('[data-sumodel]'); if (!b) return; this.touched = true; r.li.querySelector('.su-pick')?.remove(); r.set('work', 'Downloading StudioGen’s own copy (it answers with Ollama’s file meanwhile; this goes on after Start)…', where); r.progress(0);
            try { await LLM.biDownload(b.dataset.sumodel.split('|')[1], p => r.progress(p)); r.progress(null); r.set('done', `${f.best.name}: StudioGen’s own copy is in use.${pool}`, where); } catch (err) { r.progress(null); r.set('warn', `The download stopped: ${err.message}`, where); } }; }
        return; }
      const bbtns = h => { r.li.querySelector('.su-pick')?.remove(); r.li.querySelector('.su-main').insertAdjacentHTML('beforeend', `<div class="chip-row su-pick">${h}</div>`); };
      this.asked = true;
      r.set('info', `This Mac (${f.gb} GB${f.chip ? `, ${f.chip}` : ''}) can run ${f.best.name}, built into StudioGen: one ${f.best.size} download, nothing to install. Then everything that needs a model runs here, private and free.${pool}`, where);
      bbtns(`<button class="chip accent" data-sumodel="bidl|${f.best.id}">Download ${esc(f.best.name)}</button><button class="chip" data-sumodel="skip">Later</button>`);
      r.li.onclick = async e => {
        const b = e.target.closest('[data-sumodel]'); if (!b) return; this.touched = true; const [k, id] = b.dataset.sumodel.split('|');
        if (k === 'skip') { r.li.querySelector('.su-pick')?.remove(); return r.set('info', `Not yet: ${f.best.name} can be downloaded later.`, where); }
        r.li.querySelector('.su-pick')?.remove(); r.set('work', `Downloading ${f.best.name}…`, where); r.progress(0);
        try { await LLM.biDownload(id, p => { r.progress(p); r.li.querySelector('.su-d').firstChild.textContent = `Downloading ${f.best.name}… ${Math.round(p * 100)}% `; }); r.progress(null); r.set('done', `${f.best.name} is built into StudioGen.${pool}`, where); }
        catch (err) { r.progress(null); r.set('warn', `The download stopped: ${err.message}. It carries on where it stopped: ${where}.`, where); }
      };
      return;
    }
    if (ol.models.includes(f.best.id)) { if (!LLM.health?.ok && LLM.cfg().model !== f.best.id && !ol.models.includes(LLM.cfg().model)) LLM.useLocal(f.best.id); return r.set('done', `${f.best.name} runs on this Mac (${f.gb} GB): understanding, cards and building, private and free.${pool}`, where); }
    const btns = h => { r.li.querySelector('.su-pick')?.remove(); r.li.querySelector('.su-main').insertAdjacentHTML('beforeend', `<div class="chip-row su-pick">${h}</div>`); };
    this.asked = true;
    if (!ol.up) {
      r.set('info', `This Mac (${f.gb} GB${f.chip ? `, ${f.chip}` : ''}) can run ${f.best.name}. It runs in Ollama (free, from ollama.com)${LLM.canInstall() ? ': I can install it for you, then download the model' : ': install it, open it, then Check again'}.${pool}`, where);
      btns(`${LLM.canInstall() ? '<button class="chip accent" data-sumodel="install">Install Ollama and the model</button>' : ''}<button class="chip${LLM.canInstall() ? '' : ' accent'}" data-sumodel="get">Get Ollama (website)</button><button class="chip" data-sumodel="again">Check again</button><button class="chip" data-sumodel="skip">Later</button>`);
    } else {
      r.set('info', `This Mac (${f.gb} GB${f.chip ? `, ${f.chip}` : ''}) can run ${f.best.name}: a ${f.best.size} download, then everything that needs a model runs here, private and free.${pool}`, where);
      btns(`<button class="chip accent" data-sumodel="pull|${f.best.id}">Download ${esc(f.best.name)}</button><button class="chip" data-sumodel="skip">Later</button>`);
    }
    r.li.onclick = async e => {
      const b = e.target.closest('[data-sumodel]'); if (!b) return; this.touched = true; let [k, id] = b.dataset.sumodel.split('|');
      if (k === 'get') return openExternal('https://ollama.com/download', 'https://ollama.com/download');
      if (k === 'again') { r.li.onclick = null; return this.model(r); }
      if (k === 'install') { r.li.querySelector('.su-pick')?.remove(); r.set('work', 'Installing Ollama…', where);
        try { await LLM.installOllama(t => r.set('work', t, where)); } catch (err) { r.set('warn', err.message, where); return btns('<button class="chip" data-sumodel="again">Check again</button>'); }
        k = 'pull'; }
      if (k === 'skip') { r.li.querySelector('.su-pick')?.remove(); return r.set('info', `Not yet: ${f.best.name} can be downloaded later.`, where); }
      if (k === 'pull') { r.li.querySelector('.su-pick')?.remove(); r.set('work', `Downloading ${f.best.name}…`, where); r.progress(0);
        try { await LLM.pull(id || f.best.id, p => { r.progress(p); r.li.querySelector('.su-d').firstChild.textContent = `Downloading ${f.best.name}… ${Math.round(p * 100)}% `; }); r.progress(null); LLM.useLocal(id); r.set('done', `${f.best.name} runs on this Mac.${pool}`, where); }
        catch (err) { r.progress(null); r.set('warn', `The download stopped: ${err.message}. Try again in ${where}.`, where); } }
    };
  },
  close(greet) {
    store.set('setupDone', this.version || 'v0');
    if (this.asked && !store.get('waitRules', null) && typeof Agent !== 'undefined') store.set('waitRules', Agent.waitRules()); // not picked: the defaults (10 minutes)
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
