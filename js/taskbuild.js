'use strict';
/* ============================================================
   Build a task by talking (Settings › Scripts & tasks › Build with an LLM, and on Stage: “help me build a task”).
   `TaskBuild` holds the conversation with an engine that runs the build prompt (docs/llm/build-prompt.md plus
   BUILD_ADD for the app): Claude with your key, a command-line AI (Claude Code, Ollama, IBM Bob Shell…), Ollama over
   HTTP, IBM Bob (a hand-off: its chat opens with the prompt, you paste back), or the Mac's own model (js/tasklocal.js).
   `BuildCard` is the panel beside the assistant: the LLM's numbered questions are asked one at a time, spoken on Stage,
   answered by voice (“person is Priya”) or typing; every answer taken shows in the card; the summary is read out, “build
   it” imports it and runs the check (TaskLLM auto mode), a step that misses asks you to show the right thing, then
   “run it” / “save it”. While it's open, what you say goes to it first (`BuildCard.hear`, from Commands.run).
   Loaded after tasklocal.js.
   ============================================================ */
const BUILD_ADD = `

---
## Inside the app (this conversation)
You are talking inside the StudioGen app, often by voice on Stage. Ask your questions as a numbered list, one short question per number, each answerable in a few words; give choices as a) b) c) on the lines under it, and say which one is the default. The app asks them one at a time and sends all the answers back in one message, numbered the same way; “default” means take the default. When you know enough, reply with the short summary and the JSON block in the same message.`;
const BUILD_CFG = () => ({ engine: 'claude', cli: 'claude', cliCmd: '', ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'gpt-oss:20b', ...store.get('buildCfg', {}) });
/** Command-line AIs: the prompt arrives as "$1" (never pasted into the code), the answer is what it prints. */
const BUILD_CLIS = {
  claude: { name: 'Claude Code', cmd: 'cd "${TMPDIR:-/tmp}"; PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" claude -p "$1" --output-format text' },
  ollama: { name: 'Ollama', cmd: 'PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" ollama run "$2" "$1"' },
  bobshell: { name: 'IBM Bob Shell', cmd: 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" bob -p "$1"', unchecked: true },
  custom: { name: 'Your own command', cmd: '' },
};
const BOB_IDE = '/Applications/IBM Bob.app/Contents/Resources/app/bin/bobide';
const stars = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
/* The engines, rated on what this job needs (from the tests on the practice sites: docs/scripts-and-tasks-guide.html#t-llm). */
const BUILD_ENGINES = [
  { id: 'claude', name: 'Claude', how: 'Anthropic, with your key (Settings › Assistant)', r: { build: 5, ask: 5, speed: 4, offline: 1 },
    note: 'Writes new steps, selectors and checks; the best questions. Every task it wrote in the tests ran first time.',
    can: () => !!Brain.key(), why: 'Add your Anthropic key in Settings › Assistant',
    async ask(system, msgs) {
      const c = Brain.cfg(), model = c.provider === 'anthropic' && c.model ? c.model : BRAIN_MODELS.anthropic[0];
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': Brain.key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: 4000, system, messages: msgs }) });
      const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message || `Claude said ${r.status}`);
      return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    } },
  { id: 'cli', name: 'A command-line AI', how: 'Claude Code, Ollama, IBM Bob Shell or your own command, on this Mac', r: { build: 5, ask: 5, speed: 3, offline: 2 },
    note: 'As good as the tool behind it (Claude Code: like Claude, using your subscription, ~15 s a turn). You allow the command once.',
    can: () => typeof OsTasks !== 'undefined' && OsTasks.can(), why: 'Command-line tools run in StudioGen on a Mac',
    async ask(system, msgs) {
      const c = BUILD_CFG(), cmd = c.cli === 'custom' ? c.cliCmd : BUILD_CLIS[c.cli]?.cmd;
      if (!cmd) throw new Error('Set the command in the builder’s settings');
      const text = `${system}\n\n---\nConversation so far:\n${msgs.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}\n\nReply as the assistant, following the prompt above (only your next message).`;
      return String(await OsTasks.run('shell', cmd, [text, c.ollamaModel], `Build a task with ${BUILD_CLIS[c.cli]?.name || 'your command'}`, 300));
    } },
  { id: 'ollama', name: 'Ollama (open-weight, on this Mac)', how: 'A model running on this Mac: nothing leaves it', r: { build: 3, ask: 3, speed: 3, offline: 5 },
    note: 'Private and free. Recommended: gpt-oss 20b (16 GB Macs and up); weaker at selectors than Claude, so expect the check run to ask for Show me more often.',
    can: () => true, why: '',
    async ask(system, msgs) {
      const c = BUILD_CFG(), r = await fetch(`${c.ollamaUrl.replace(/\/$/, '')}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: c.ollamaModel, stream: false, messages: [{ role: 'system', content: system }, ...msgs], options: { num_ctx: 16384, temperature: 0.3 } }) }).catch(() => null);
      if (!r) throw new Error(`Ollama isn’t answering at ${c.ollamaUrl}: is it running?`);
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || `Ollama said ${r.status}`);
      return String(j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    } },
  { id: 'bob', name: 'IBM Bob (hand-off)', how: 'Bob’s chat opens with the prompt; you talk to Bob there and paste its JSON back', r: { build: 4, ask: 4, speed: 2, offline: 2 },
    note: 'For people who work in Bob. Not spoken: the conversation happens in Bob’s window.',
    can: () => typeof OsTasks !== 'undefined' && OsTasks.can(), why: 'IBM Bob is opened by StudioGen on a Mac', handoff: true },
  { id: 'mac', name: 'The Mac’s own model', how: 'Apple’s on-device model: private, offline, small', r: { build: 1, ask: 1, speed: 4, offline: 5 },
    note: 'Only puts together tasks that already exist (no new steps), and asks nothing back: you correct its plan in a form.',
    can: () => typeof TaskLocal !== 'undefined' && TaskLocal.can(), why: 'Needs StudioGen on a Mac, or a phone paired with one', local: true },
];
const TaskBuild = {
  engine() { const id = BUILD_CFG().engine; return BUILD_ENGINES.find(e => e.id === id) || BUILD_ENGINES[0]; },
  /** The prompt, the app's notes, and the tasks already here: their ways to ask aren't to be reused, and they can be run
      as steps (agent.task) rather than written again. */
  async system() {
    const have = Agent.all().filter(t => !t.remoteOnly).map(t => `- ${t.id}: ${t.name}${Object.keys(Agent.params(t)).length ? ` (inputs: ${Object.keys(Agent.params(t)).join(', ')})` : ''}; asked as ${(t.examples || []).slice(0, 4).map(e => `“${e}”`).join(', ')}`).join('\n');
    return `${await TaskLLM.prompt()}${BUILD_ADD}\n\n### Tasks already in this app\nDon't reuse their ways to ask (give the new task its own). When one already does a part of what the user wants, run it with \`agent.task\` instead of writing its steps again.\n${have}`;
  },
  /** One turn: what the user said → the engine's reply, parsed: { kind: 'ask', questions } or { kind: 'done', summary, json }. */
  async turn(msgs) {
    const e = this.engine(), t0 = Date.now();
    const reply = await e.ask(this._sys ||= await this.system(), msgs);
    Log.i('agent', `Builder (${e.id}) answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`, { chars: reply.length });
    return { reply, ...this.parse(reply) };
  },
  /** A reply → questions (numbered, with their a) b) choices) or the finished JSON with the summary before it. */
  parse(reply) {
    const t = String(reply || ''), fence = t.search(/```(?:json)?\s*\{/);
    if (fence >= 0) return { kind: 'done', summary: this.plain(t.slice(0, fence)), json: t.slice(fence) };
    const qs = []; let pre = [];
    for (const line of t.split('\n')) {
      const m = line.match(/^\s*(?:\*\*)?(\d+)[.)]\s*(?:\*\*)?\s*(.+)$/);
      if (m) qs.push({ n: +m[1], text: this.plain(m[2]), choices: [] });
      else if (qs.length && line.trim()) { const c = line.match(/^\s*(?:[-*]\s*)?([a-e])[).]\s+(.+)$/i); if (c) qs.at(-1).choices.push({ k: c[1].toLowerCase(), text: this.plain(c[2]) }); else qs.at(-1).text += ` ${this.plain(line)}`; }
      else if (!qs.length && line.trim()) pre.push(this.plain(line));
    }
    for (let i = qs.length - 1; i >= 0; i--) if (qs[i].text.replace(/[^\p{L}\p{N}]/gu, '').length < 3 && !qs[i].choices.length) qs.splice(i, 1); // an empty number (open-weight models)
    if (!qs.length) return { kind: 'ask', intro: '', questions: [{ n: 1, text: this.plain(t) || 'Tell me more about what it should do.', choices: [] }] };
    return { kind: 'ask', intro: pre.join(' '), questions: qs };
  },
  plain: t => String(t || '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim(),
  /** IBM Bob: its chat opens with the prompt file attached (allowed once, like any command). */
  async bob(said) {
    const code = `f="\${TMPDIR:-/tmp}/studiogen-build-prompt.md"; printf '%s' "$1" > "$f"; "${BOB_IDE}" chat -m ask -n --add-file "$f" "$2"`;
    await OsTasks.run('shell', code, [await this.system(), `Follow the attached StudioGen build prompt. ${said}`], 'Open IBM Bob with the build prompt', 30);
  },
};

/* ---------- The builder card ---------- */
const BuildCard = {
  st: null, // { msgs, qs, i, answers, intro, phase: 'ask'|'think'|'summary'|'check'|'report'|'bob'|'error', summary, json, last, voice }
  el() {
    let b = $('#buildCard'); if (b) return b;
    b = document.createElement('div'); b.id = 'buildCard'; b.hidden = true; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Build a task');
    document.body.appendChild(b); return b;
  },
  /** Open: Stage (spoken, `voice`) or from Settings (typed, spoken only if the assistant is listening). */
  open(o = {}) {
    this.st = { msgs: [], qs: [{ n: 0, text: 'What should the task do? Say it in your own words.', choices: [] }], i: 0, answers: [], intro: '', phase: 'ask', voice: !!o.voice || (typeof Stage !== 'undefined' && Stage.on) };
    this.el().hidden = false; this.render(); this.ask();
    if (o.said) this.answer(o.said);
  },
  close(say) { this.st = null; this.el().hidden = true; Working.stop?.(); if (say) Voice.respond('Okay, I’ve stopped building.'); },
  /** Say the current question (on Stage), and listen for the answer. */
  ask() {
    const s = this.st, q = s?.qs[s.i]; if (!q || !s.voice) return;
    const lead = s.i === 0 && s.intro ? `${s.intro} ` : '';
    Voice.respond(this.speakable(`${lead}${q.text}${q.choices.length ? ` ${q.choices.map(c => `${c.k}: ${c.text}`).join('. ')}.` : ''}`), null, { ask: true });
  },
  speakable: t => String(t).replace(/\{(\w+)\}/g, (m, k) => k.replace(/_/g, ' ')), // “sum up slack channel”, not the braces
  /** Beside the assistant, never over it: the card takes the side of the screen the avatar isn't on. */
  place() {
    const a = [...document.querySelectorAll('canvas.mw-vrm')].find(c => c.isConnected && c.offsetParent), r = a?.getBoundingClientRect();
    this.el().classList.toggle('bc-left', !!r && r.left + r.width / 2 > innerWidth / 2);
  },
  /** While it's open, what you say is for it: an answer, or “stop building”, “skip”, “build it”, “run it”, “save it”, “show me”. */
  hear(raw) {
    const s = this.st; if (!s || this.el().hidden) return false;
    const t = plain(raw);
    if (/^(stop|cancel|quit) (building|the builder|it)$|^(stop building|never mind)$/.test(t)) { this.close(true); return true; }
    if (s.phase === 'ask') { this.answer(raw); return true; }
    if (s.phase === 'summary') { if (/^(build it|yes|go ahead|do it|looks good|thats right)\b/.test(t)) this.build(); else this.change(raw); return true; }
    if (s.phase === 'report') {
      if (/\bsave\b/.test(t)) { this.save(); return true; }
      if (/\b(run|try) it\b/.test(t)) { this.run(); return true; }
      if (/\bshow\b/.test(t)) { const r = s.last?.results?.find(x => x.state === 'bad'); if (r) TaskLLM.showMe(r.i); return true; }
      if (/\b(check|test) (it )?again\b/.test(t)) { TaskLLM.check(s.last.task); return true; }
      if (/\beditor\b/.test(t)) { this.editor(); return true; }
      this.change(raw); return true;
    }
    return s.phase === 'think' || s.phase === 'check'; // busy: swallow, so “next” doesn't move the slides meanwhile
  },
  answer(raw) {
    const s = this.st; if (!s || s.phase !== 'ask') return;
    const q = s.qs[s.i], v = String(raw || '').trim(); if (!v) return;
    const def = /^(skip|default|you (choose|decide|pick)|whatever|any)$/i.test(plain(v));
    s.answers.push({ n: q.n, q: q.text, a: def ? 'default' : v });
    if (s.i + 1 < s.qs.length) { s.i++; this.render(); return this.ask(); }
    // all answered: the first one starts the conversation, later ones go back numbered
    const text = q.n === 0 ? v : s.answers.filter(a => a.n > 0 && a.round === undefined).map(a => `${a.n}: ${a.a}`).join('\n');
    for (const a of s.answers) a.round ??= s.msgs.length;
    this.send(text);
  },
  async send(text) {
    const s = this.st, e = TaskBuild.engine(); if (!s) return;
    if (e.local) { this.close(); return TaskLocal.start(text); }
    if (e.handoff) { s.phase = 'bob'; this.render(); try { await TaskBuild.bob(text); } catch (err) { s.phase = 'error'; s.error = err.message; } return this.render(); }
    if (!e.can()) { s.phase = 'error'; s.error = e.why; return this.render(); }
    s.msgs.push({ role: 'user', content: text }); s.lastSent = text; s.phase = 'think'; this.render();
    if (s.voice) Working.begin({ line: 'Let me think about that.' });
    try {
      const r = await TaskBuild.turn(s.msgs); if (this.st !== s) return;
      s.msgs.push({ role: 'assistant', content: r.reply });
      if (s.voice) await Working.end(true);
      if (r.kind === 'done') { s.phase = 'summary'; s.summary = r.summary; s.json = r.json; this.render(); if (s.voice) Voice.respond(`${this.speakable(r.summary.slice(0, 600))} Shall I build it? Say “build it”, or tell me what to change.`, null, { ask: true }); return; }
      s.phase = 'ask'; s.qs = r.questions; s.intro = r.intro; s.i = 0; this.render(); this.ask();
    } catch (err) {
      if (s.voice) await Working.end(false);
      s.phase = 'error'; s.error = err.message; s.msgs.pop(); this.render(); Log.w('agent', 'Builder failed', { error: err.message });
      if (s.voice) Voice.respond(`That didn’t work: ${err.message}`);
    }
  },
  /** Anything else you say at the summary or after the check goes back to the LLM. */
  change(raw) { const s = this.st; s.answers.push({ n: 'Change', q: '', a: raw, round: s.msgs.length }); this.send(raw); },
  build() {
    const s = this.st; s.phase = 'check'; this.render();
    if (s.voice) Voice.respond('Building it, then checking each step on the page. Nothing gets sent.');
    TaskLLM.import(s.json, { auto: true,
      onError: list => { s.phase = 'summary'; s.error = list.join('; '); this.render(); this.change(`The app found problems: ${list.join('; ')}. Please fix them and write the JSON again.`); },
      onScript: saved => { s.phase = 'done'; this.close(); toast(`Script “${saved.name}” made`); },
      onReport: last => { if (this.st !== s) return; s.last = last; s.phase = 'report'; this.render(); this.spoken(); } });
  },
  spoken() {
    const s = this.st, L = s.last, bad = L.results?.find(r => r.state === 'bad'); if (!s.voice) return;
    if (!L.results) return Voice.respond('I made it, but checking needs StudioGen on a Mac. Say “save it”.', null, { ask: true });
    if (!bad) return Voice.respond(`Every step works${L.card?.headline ? `. It would answer: ${L.card.headline}` : ''}. Say “run it” to watch it, or “save it”.`, null, { ask: true });
    const step = L.task.steps[bad.i];
    Voice.respond(TaskLLM.fixable(step) ? `Step ${bad.i + 1} didn’t find its target. Say “show me”, then click the right thing on the page.` : `Step ${bad.i + 1} stopped: ${bad.why}. Tell me what to change, or open it in the editor.`, null, { ask: true });
  },
  run() { const t = this.st.last.task; AgentWatch.next = true; Agent.start(t, { ...t.test }); },
  save() {
    const t = this.st.last.task; Agent.put(t); const ask = t.examples[0].replace(/\{(\w+)\}/g, (m, k) => t.test?.[k] || `the ${k}`); // said with its test value: “sum up slack sales”
    this.close(); toast(`Saved “${t.name}”`); Voice.respond(`Saved. Say “${ask}” any time.`);
  },
  editor() { const t = this.st.last.task; Agent.put(t); this.close(); TaskUI.open(t.id); },
  render() {
    const s = this.st, b = this.el(); if (!s) return;
    const e = TaskBuild.engine(), q = s.qs[s.i];
    const taken = s.answers.filter(a => a.n !== 0).map(a => `<li><b>${esc(String(a.n))}</b> ${esc(a.a)}${a.q ? `<small>${esc(a.q.length > 70 ? `${a.q.slice(0, 68)}…` : a.q)}</small>` : ''}</li>`).join('');
    const first = s.answers.find(a => a.n === 0);
    const L = s.last, res = L?.results ? `<ol class="tllm-res">${L.results.map(r => `<li class="${r.state}"><span>${esc(TaskLLM.stepName(L.task.steps[r.i]))}</span>${r.why ? `<small>${esc(r.why)}</small>` : ''}${r.state === 'bad' && TaskLLM.fixable(L.task.steps[r.i]) ? `<button class="chip accent" data-bc="showme:${r.i}">Show me</button>` : ''}</li>`).join('')}</ol>` : '';
    const body = {
      ask: () => `${s.intro && s.i === 0 ? `<p class="se-note">${esc(s.intro)}</p>` : ''}<p class="bc-q">${s.qs.length > 1 ? `<small>${s.i + 1} of ${s.qs.length}</small> ` : ''}${esc(q.text)}</p>
        ${q.choices.length ? `<div class="chip-row">${q.choices.map(c => `<button class="chip" data-bc="pick:${esc(c.k)}">${esc(c.k)}) ${esc(c.text)}</button>`).join('')}</div>` : ''}
        <div class="bc-in"><input id="bcIn" placeholder="${s.voice ? 'Say it, or type: person is Priya' : 'Type your answer: person is Priya'}" autocomplete="off"><button class="chip accent" data-bc="send">Send</button>${q.n ? '<button class="chip" data-bc="skip">Default</button>' : ''}</div>`,
      think: () => `<p class="bc-q bc-busy">${esc(e.name)} is thinking…</p>`,
      summary: () => `<p class="bc-q">Here's the plan</p><p>${esc(s.summary)}</p>${s.error ? `<p class="se-note">${esc(s.error)}</p>` : ''}
        <div class="chip-row"><button class="chip accent" data-bc="build">Build it</button></div><div class="bc-in"><input id="bcIn" placeholder="Or say what to change"><button class="chip" data-bc="change">Send</button></div>`,
      check: () => `<p class="bc-q bc-busy">Checking each step on the page…</p>`,
      report: () => { const ok = L.results?.every(r => r.state === 'ok'); return `<p class="bc-q">${!L.results ? 'Made (not checked here)' : ok ? 'Every step works' : 'A step needs you'}</p>${res}${L.warnings?.length ? `<ul class="se-note">${L.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}${ok && L.card?.headline ? `<p class="se-note">It would answer: <b>${esc(L.card.headline)}</b></p>` : ''}
        <div class="chip-row">${ok || !L.results ? '<button class="chip accent" data-bc="save">Save</button><button class="chip" data-bc="run">Run it (watch)</button>' : '<button class="chip accent" data-bc="again">Check again</button>'}<button class="chip" data-bc="editor">Open in the editor</button></div>
        <div class="bc-in"><input id="bcIn" placeholder="Or say what to change"><button class="chip" data-bc="change">Send</button></div>`; },
      bob: () => `<p class="bc-q">Bob's chat is open with the build prompt</p><p class="se-note">Answer Bob's questions there. When it writes the JSON, paste it here.</p><div class="bc-in"><textarea id="bcIn" rows="3" placeholder='{ "format": "studiogen-task", … }'></textarea><button class="chip accent" data-bc="paste">Build it</button></div>`,
      error: () => `<p class="bc-q">That didn't work</p><p class="se-note">${esc(s.error || '')}</p><div class="chip-row"><button class="chip accent" data-bc="retry">Try again</button><button class="chip" data-bc="engine">Change the AI</button></div>`,
    }[s.phase]?.() || '';
    this.place();
    b.innerHTML = `<div class="bc-head"><b>Build a task</b><span class="bc-eng">${esc(e.name)}</span><button class="chip" data-bc="close" aria-label="Close">✕</button></div>
      ${first ? `<p class="bc-what">“${esc(first.a)}”</p>` : ''}${taken ? `<ol class="bc-taken">${taken}</ol>` : ''}<div class="bc-body">${body}</div>`;
    const inp = $('#bcIn', b); if (inp && !s.voice) setTimeout(() => inp.focus(), 50);
  },
  /** Settings › Build with an LLM: the engines with their ratings, and Build a task. */
  html() {
    const c = BUILD_CFG(), cur = TaskBuild.engine();
    return `<p class="se-note">Build a task by answering a few questions: the AI writes it, the app checks it on the real pages. On Stage, say <q class="say">help me build a task</q>.</p>
      <div class="bc-engines">${BUILD_ENGINES.map(e => `<label class="bc-eng-row${e.can() ? '' : ' off'}"><input type="radio" name="bcEng" value="${e.id}"${e.id === cur.id ? ' checked' : ''}>
        <span><b>${esc(e.name)}</b> <small>${esc(e.how)}</small><br><small class="bc-stars">builds ${stars(e.r.build)} · asks ${stars(e.r.ask)} · speed ${stars(e.r.speed)} · private ${stars(e.r.offline)}</small><br><small>${esc(e.note)}${e.can() ? '' : ` <i>${esc(e.why)}</i>`}</small></span></label>`).join('')}</div>
      ${cur.id === 'cli' ? `<label class="se-field"><span>Command-line AI</span><select id="bcCli">${Object.entries(BUILD_CLIS).map(([k, v]) => `<option value="${k}"${k === c.cli ? ' selected' : ''}>${esc(v.name)}${v.unchecked ? ' (set it up first; not checked here)' : ''}</option>`).join('')}</select></label>
        ${c.cli === 'custom' ? `<label class="se-field"><span>Command (the prompt is "$1"; print the answer)</span><input id="bcCmd" value="${esc(c.cliCmd)}" placeholder='my-ai --prompt "$1"'></label>` : `<p class="se-note"><code>${esc(BUILD_CLIS[c.cli].cmd)}</code></p>`}` : ''}
      ${cur.id === 'ollama' || (cur.id === 'cli' && c.cli === 'ollama') ? `<label class="se-field"><span>Ollama model</span><input id="bcModel" value="${esc(c.ollamaModel)}" placeholder="gpt-oss:20b"></label>${cur.id === 'ollama' ? `<label class="se-field"><span>Ollama address</span><input id="bcUrl" value="${esc(c.ollamaUrl)}"></label>` : ''}` : ''}
      <div class="chip-row"><button class="chip accent" data-bc="start">${svg('star')} Build a task</button></div>`;
  },
  saveCfg() {
    const c = BUILD_CFG(), v = id => $(id)?.value;
    store.set('buildCfg', { ...c, engine: $('input[name="bcEng"]:checked')?.value || c.engine, cli: v('#bcCli') ?? c.cli, cliCmd: v('#bcCmd') ?? c.cliCmd, ollamaModel: v('#bcModel')?.trim() || c.ollamaModel, ollamaUrl: v('#bcUrl')?.trim() || c.ollamaUrl });
    TaskBuild._sys = null;
  },
};
document.addEventListener('change', e => { if (e.target.closest('.bc-engines, #bcCli')) { BuildCard.saveCfg(); if (typeof ScriptUI !== 'undefined' && ScriptUI.shown) ScriptUI.render(); } else if (e.target.matches('#bcCmd, #bcModel, #bcUrl')) BuildCard.saveCfg(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-bc]'); if (!b) return; e.stopPropagation();
  const [k, v] = b.dataset.bc.split(':'), s = BuildCard.st, val = () => $('#bcIn')?.value.trim() || '';
  if (k === 'start') { BuildCard.saveCfg(); return BuildCard.open(); }
  if (k === 'close') return BuildCard.close();
  if (!s) return;
  if (k === 'send') return BuildCard.answer(val());
  if (k === 'skip') return BuildCard.answer('default');
  if (k === 'pick') return BuildCard.answer(v);
  if (k === 'build') return BuildCard.build();
  if (k === 'change') return val() && BuildCard.change(val());
  if (k === 'save') return BuildCard.save();
  if (k === 'run') return BuildCard.run();
  if (k === 'editor') return BuildCard.editor();
  if (k === 'again') return TaskLLM.check(s.last.task);
  if (k === 'showme') return TaskLLM.showMe(+v);
  if (k === 'paste') { s.json = val(); return val() && BuildCard.build(); }
  if (k === 'retry') return s.lastSent && BuildCard.send(s.lastSent);
  if (k === 'engine') { BuildCard.close(); return ScriptUI.open?.(); }
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'bcIn' && e.target.tagName === 'INPUT') { e.preventDefault(); $('#buildCard [data-bc="send"], #buildCard [data-bc="change"]')?.click(); } });
