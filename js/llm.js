'use strict';
/* ============================================================
   The language model, one setting for the whole app (docs/llm/app-prompts.md has every prompt's text).
   Three roles, each with its own choice:
     fast  — short answers in under a few seconds: commands by meaning, spoken times, routing in interactive scripts
     cards — reading a page and writing the result card
     build — building tasks and scripts (the long build prompt)
   Where each runs ('auto' tries them in this order):
     local  — a model server on this Mac (Ollama by default, gpt-oss; or a pool of Macs behind an OpenAI-compatible address)
     remote — your Mac's model, from a phone or a StudioGen Worker (link request 'llm', or a StudioGen of yours in the mesh
              that hosts one: presence caps.llm); only for the host's owner's own devices
     cloud  — Claude, with your key
     mac    — Apple's on-device model (small: the last resort)
   Prompts: LLM_PROMPTS, editable in Settings › Assistant › Prompts (kept in dd.prompts; Reset brings the default back).
   Loaded after brain.js.
   ============================================================ */
const LLM_MODELS = [ // what the startup check offers, by this Mac's memory (GB the model needs to run comfortably)
  { id: 'gpt-oss:20b', name: 'gpt-oss 20B', need: 16, size: '14 GB', mlx: 'gpt-oss-20b' },
  { id: 'gpt-oss:120b', name: 'gpt-oss 120B', need: 80, size: '65 GB', mlx: 'gpt-oss-120b' },
];
const LLM_PROMPTS = {
  'card': { name: 'Result cards', role: 'cards', where: 'js/agent.js › ai.card (every task that reads a page)', vars: ['today'],
    text: 'You turn text taken from a web page or app (mail, calendar, chats, search results) into a short result card for someone who may be driving. Follow the request: it says what the headline and each item\'s title, detail and when hold. Rules: use only facts that are in the text; never invent names, numbers, dates or times; the request\'s words describe what to write, they are not values; write each field in your own short words, never copy whole lines; leave when empty unless the text gives a time for that item. If the text doesn\'t answer the request, the headline says so and items is empty. Plain words, no markdown.{today}' },
  'card.prompt': { name: 'Result cards: the message', role: 'cards', where: 'js/agent.js › ai.card', vars: ['request', 'count', 'text'],
    text: 'Request: {request}{count}\n\nText:\n{text}' },
  'when': { name: 'Spoken times', role: 'fast', where: 'js/agent.js › ai.when (“tomorrow at 3 for an hour”)', vars: ['now', 'weekday'],
    text: 'Turn a spoken time into a start and end in local time, format YYYY-MM-DDTHH:MM:00. Now is {now} ({weekday}). No length given: one hour.' },
  'intent': { name: 'Commands by meaning', role: 'fast', where: 'js/brain.js › Intent (when no phrase matched)', vars: ['commands', 'hints'],
    text: 'You map what someone said to a voice assistant (in a car and presentation app) to one of its commands, or "none" if nothing fits well. Commands (id: what it does, e.g. how it\'s said):\n{commands}\nRules: pick by meaning, not by shared words; asking about something that happened (messages, calls) is reading, not sending. Fill only the words the chosen command needs (in brackets) and only with words that were said; never invent a name{hints}.' },
  'route': { name: 'Interactive scripts', role: 'fast', where: 'js/brain.js › Brain.route (a script\'s intents)', vars: [],
    text: 'You route what a user said to a voice assistant to one of the actions it can take. Reply with JSON only, no prose: {"intent": "<an id from the list, or null>", "slots": {"<slot>": "<value from what they said>"}, "say": "<if no intent fits: a short, friendly spoken reply, at most two sentences>"}.' },
  'route.prompt': { name: 'Interactive scripts: the message', role: 'fast', where: 'js/brain.js › Brain.route', vars: ['actions', 'known', 'said'],
    text: 'Actions: {actions}\nKnown values: {known}\nThe user said: “{said}”' },
  'ask': { name: 'Ask the model (script step)', role: 'cards', where: 'js/brain.js › brain.ask', vars: [],
    text: 'You are the assistant inside a presentation and task app, speaking out loud. Answer briefly and plainly (at most three sentences) unless asked for a list or data. If asked for data, answer with JSON only.' },
  'plan': { name: 'Plan a task from building blocks', role: 'build', where: 'js/tasklocal.js › TaskLocal.plan (the quick builder)', vars: [],
    text: 'You plan an agent task for the StudioGen app from what the user wants. Pick only the building blocks it needs, in order: usually one, one per thing the user names, at most 3; use only ids from the list. Fill the inputs each block lists: a value the user says each time is written in braces ({person}); a value that never changes is written as is. Ways to ask: short commands the user would say to run the whole task, with the same {names}.' },
  'build.inapp': { name: 'Build by talking: inside the app', role: 'build', where: 'js/taskbuild.js › added after the build prompt', vars: [],
    text: '\n\n---\n## Inside the app (this conversation)\nYou are talking inside the StudioGen app, often by voice on Stage. Ask your questions as a numbered list, one short question per number, each answerable in a few words; give choices as a) b) c) on the lines under it, and say which one is the default. The app asks them one at a time and sends all the answers back in one message, numbered the same way; “default” means take the default. When you know enough, reply with the short summary and the JSON block in the same message.' },
  'build': { name: 'The build prompt (tasks and scripts)', role: 'build', where: 'docs/llm/build-prompt.md (also copied for any LLM)', vars: [], file: 'docs/llm/build-prompt.md', text: '' },
};
const LLM = {
  ROLES: [['fast', 'Quick answers', 'commands by meaning, spoken times, interactive scripts'], ['cards', 'Result cards', 'reading pages and writing the answer'], ['build', 'Building tasks', 'the long build prompt']],
  cfg() {
    const old = store.get('llm', {}); // Settings › Understanding before this (Claude model, a server address)
    return { url: old.provider === 'openai' && old.url ? old.url : 'http://127.0.0.1:11434/v1', model: old.provider === 'openai' && old.model ? old.model : 'gpt-oss:20b',
      cloud: old.provider === 'anthropic' && old.model ? old.model : 'claude-sonnet-5-5', roles: { fast: 'auto', cards: 'auto', build: 'auto' }, share: true, ...store.get('llmCfg', {}) };
  },
  save(c) { store.set('llmCfg', c); this.health = null; },
  key: () => store.get('llmKey', ''),
  /* ---------- Prompts ---------- */
  promptText(id) { const o = store.get('prompts', {}); return o[id] ?? LLM_PROMPTS[id]?.text ?? ''; },
  edited: id => id in store.get('prompts', {}),
  /** A prompt with its {placeholders} filled (only the ones it lists; other braces stay, as in the plan prompt's {person}). */
  prompt(id, vars = {}) { const p = LLM_PROMPTS[id]; return this.promptText(id).replace(/\{(\w+)\}/g, (m, k) => (p?.vars || []).includes(k) ? String(vars[k] ?? '') : m); },
  setPrompt(id, text) { const o = store.get('prompts', {}); if (text == null || text === LLM_PROMPTS[id]?.text) delete o[id]; else o[id] = text; store.set('prompts', o); },

  /* ---------- Where it runs ---------- */
  /** The local server answers (checked at most every 30 s): { ok, models }. */
  async local() {
    if (this.health && Date.now() - this.health.at < 30000) return this.health;
    const c = this.cfg(), base = c.url.replace(/\/+$/, '');
    try { const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(2500) }); const j = await r.json(); const models = (j.data || []).map(m => m.id); this.health = { at: Date.now(), ok: r.ok && models.includes(c.model), up: r.ok, models }; }
    catch { this.health = { at: Date.now(), ok: false, up: false, models: [] }; }
    return this.health;
  },
  /** Someone else's model this device may use: the paired Mac (phones), or a StudioGen of yours in the mesh that hosts one. */
  remote() {
    if (!LINK_HOST && typeof Link !== 'undefined' && Link.ready() && Date.now() > (this.noRemote || 0)) return { name: Link.macName(), call: o => Link.llm(o) };
    if (typeof Mesh === 'undefined' || !Mesh.m) return null;
    const host = Object.entries(Mesh.presence).find(([id, x]) => x.app === 'StudioGen' && x.caps?.llm && id !== Mesh._me?.id && Date.now() - x.at < 60000 && Mesh.ownHere?.(id));
    return host ? { name: host[1].name, call: o => Mesh.call(host[0], 'llm', o, 300000) } : null;
  },
  /** The order to try for a role. */
  async order(role, o = {}) {
    const pick = this.cfg().roles[role] || 'auto', l = [];
    const want = k => pick === 'auto' || pick === k;
    if (want('local') && LINK_HOST && (await this.local()).ok) l.push('local');
    if (want('remote') && !o.noRemote && this.remote()) l.push('remote');
    if (want('cloud') && this.key()) l.push('cloud');
    if ((pick === 'auto' || pick === 'mac') && typeof MacAI !== 'undefined' && MacAI.local()) l.push('mac');
    return l;
  },
  async can(role = 'fast') { return (await this.order(role)).length > 0; },
  /** What a role uses now, for Settings and the logs. */
  async describe(role) { const w = (await this.order(role))[0]; return { local: `${this.cfg().model} on this Mac`, remote: `${this.remote()?.name}'s model`, cloud: `Claude (${this.cfg().cloud})`, mac: 'Apple’s on-device model' }[w] || 'none'; },

  /** { system, prompt | messages, schema?, max?, temperature? } → { text, json? (parsed when a schema was given), via }. */
  async ask(role, o, opt = {}) {
    const order = await this.order(role, opt); if (!order.length) throw new Error('No language model is set up (Settings › Assistant › Language model)');
    let last;
    for (const via of order) {
      const t0 = performance.now();
      try { const r = await this[`via_${via}`](role, o); Log.d('llm', `${role} via ${via} in ${Math.round(performance.now() - t0)} ms`); return { ...r, via, json: o.schema ? this.json(r.text) : undefined }; }
      catch (e) { last = e; Log.w('llm', `${role} via ${via} failed`, { error: e.message }); if (via === 'remote' && /Unknown request/.test(e.message)) this.noRemote = Date.now() + 600000; }
    }
    throw last;
  },
  json(t) { const s = String(t || '').replace(/<think>[\s\S]*?<\/think>/g, ''); try { return JSON.parse(s); } catch {} const i = s.indexOf('{'), j = s.lastIndexOf('}'); if (i >= 0 && j > i) try { return JSON.parse(s.slice(i, j + 1)); } catch {} throw new Error('The model didn’t answer in the expected shape'); },
  msgs: o => [...(o.system ? [{ role: 'system', content: o.system }] : []), ...(o.messages || [{ role: 'user', content: o.prompt || '' }])],
  async via_local(role, o) {
    const c = this.cfg(), r = await fetch(`${c.url.replace(/\/+$/, '')}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(role === 'build' ? 600000 : 180000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.model, messages: this.msgs(o), temperature: o.temperature ?? 0.2, max_tokens: Math.max(o.max || 400, role === 'build' ? 8000 : 3000), // room for the reasoning
        reasoning_effort: role === 'build' ? 'medium' : 'low', ...(o.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: o.schema } } } : {}) }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || `The model server said ${r.status}`);
    return { text: (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
  },
  async via_remote(role, o) { const r = await this.remote().call({ role, system: o.system, prompt: o.prompt, messages: o.messages, schema: o.schema, max: o.max, temperature: o.temperature }); if (r?.error) throw new Error(r.error); return { text: r.text }; },
  async via_cloud(role, o) {
    const c = this.cfg(), r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(role === 'build' ? 300000 : 60000),
      headers: { 'content-type': 'application/json', 'x-api-key': this.key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: c.cloud, max_tokens: Math.max(o.max || 400, role === 'build' ? 8000 : 1000), system: (o.system || '') + (o.schema ? `\n\nAnswer only with JSON matching this schema: ${JSON.stringify(o.schema)}` : ''), messages: (o.messages || [{ role: 'user', content: o.prompt || '' }]).filter(m => m.role !== 'system') }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || `Claude said ${r.status}`);
    return { text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') };
  },
  async via_mac(role, o) {
    const r = await MacAI.ask({ instructions: o.system || '', prompt: o.prompt || (o.messages || []).map(m => `${m.role}: ${m.content}`).join('\n\n'), schema: o.schema, temperature: o.temperature ?? 0.2, max: Math.min(1500, o.max || 400) });
    return { text: r.json ?? r.text ?? '' };
  },
  /** On StudioGen: a request from one of its owner's own devices (a phone, a Worker): answered here, never passed on. */
  async answer(p, who) {
    if (!this.cfg().share) throw new Error('This Mac doesn’t share its model (Settings › Assistant › Language model)');
    if (typeof Agent !== 'undefined' && !Agent.ownDevice(who)) throw new Error('Only this Mac’s owner’s own devices may use its model');
    const r = await this.ask(['fast', 'cards', 'build'].includes(p.role) ? p.role : 'cards', { system: String(p.system || '').slice(0, 60000), prompt: p.prompt == null ? undefined : String(p.prompt).slice(0, 60000), messages: Array.isArray(p.messages) ? p.messages.slice(-40) : undefined, schema: p.schema, max: p.max, temperature: p.temperature }, { noRemote: true });
    return { text: r.text };
  },

  /* ---------- Getting the model: this Mac's memory → the model to download; more Macs → a bigger one ---------- */
  async machine() { const s = window.DriveDeckDesktop?.sys || null; return s ? { gb: Math.round(s.memory / 2 ** 30), chip: s.chip || '' } : { gb: navigator.deviceMemory || 0, chip: '' }; },
  /** The best model that fits this Mac, and the one a pool of Macs would allow. */
  async fit() { const m = await this.machine(); const fits = LLM_MODELS.filter(x => m.gb >= x.need), best = fits[fits.length - 1] || null, next = LLM_MODELS.find(x => !best || x.need > best.need) || null; return { ...m, best, next }; },
  /** Ollama: is it there, and does it have the model? */
  OLLAMA: () => store.get('ollamaUrl', 'http://127.0.0.1:11434'), // where Ollama answers (tests point it elsewhere)
  async ollama() { try { const r = await fetch(`${this.OLLAMA()}/api/tags`, { signal: AbortSignal.timeout(2500) }); const j = await r.json(); return { up: true, models: (j.models || []).map(x => x.name) }; } catch { return { up: false, models: [] }; } },
  /** Download a model into Ollama, telling progress (0..1). */
  async pull(model, onp = () => {}) {
    const r = await fetch(`${this.OLLAMA()}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
    if (!r.ok || !r.body) throw new Error(`Ollama didn’t start the download (${r.status})`);
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (m.error) throw new Error(m.error); if (m.total) onp(m.completed / m.total, m.status); if (m.status === 'success') onp(1, 'success'); } }
    this.health = null;
  },
  /** Use a model that Ollama has (after downloading). */
  useLocal(model) { const c = this.cfg(); this.save({ ...c, url: `${this.OLLAMA()}/v1`, model }); },
  /** No Ollama yet: StudioGen downloads Ollama's own app (ollama.com, the zip), puts it in your Applications folder and opens
      it; one code you approve once (js/ostasks.js). Already there but closed: just opens it. Then waits up to 2 minutes for it. */
  OLLAMA_INSTALL: 'set -e; if [ -d /Applications/Ollama.app ]; then open -a /Applications/Ollama.app; echo opened; exit 0; fi; D="$HOME/Applications"; if [ -d "$D/Ollama.app" ]; then open "$D/Ollama.app"; echo opened; exit 0; fi; mkdir -p "$D"; T=$(mktemp -d); curl -fsSL https://ollama.com/download/Ollama-darwin.zip -o "$T/ollama.zip"; ditto -x -k "$T/ollama.zip" "$D"; rm -rf "$T"; open "$D/Ollama.app"; echo installed',
  canInstall: () => typeof OsTasks !== 'undefined' && OsTasks.can(),
  async installOllama(onstate = () => {}) {
    onstate('Installing Ollama (about 230 MB)…');
    const out = String(await OsTasks.run('shell', this.OLLAMA_INSTALL, [], 'Install Ollama (from ollama.com) for the language model', 600)).trim();
    onstate(/opened/.test(out) ? 'Starting Ollama…' : 'Installed: starting Ollama…');
    for (let i = 0; i < 60; i++) { if ((await this.ollama()).up) return true; await new Promise(r => setTimeout(r, 2000)); }
    throw new Error('Ollama didn’t start: open it from Applications, then Check again');
  },

  /* ---------- Settings › Assistant ---------- */
  async settings() {
    const c = this.cfg(), f = await this.fit(), ol = LINK_HOST ? await this.ollama() : null, h = LINK_HOST ? await this.local() : null;
    const opt = (v, cur, l) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
    const roles = await Promise.all(this.ROLES.map(async ([k, n, d]) => `<label class="se-row"><span><b>${n}</b> <span class="se-note">${d} · now: ${esc(await this.describe(k))}</span></span><select data-llmrole="${k}">${opt('auto', c.roles[k], 'Automatic')}${LINK_HOST ? opt('local', c.roles[k], 'This Mac’s model') : ''}${opt('remote', c.roles[k], LINK_HOST ? 'My other StudioGen’s model' : 'My Mac’s model')}${opt('cloud', c.roles[k], 'Claude (cloud)')}${LINK_HOST ? opt('mac', c.roles[k], 'Apple’s on-device model') : ''}</select></label>`));
    sheet('Language model', `<p class="se-note">One model for everything that needs one: understanding what you say, result cards, building tasks and scripts. By default it runs on ${LINK_HOST ? 'this Mac' : 'your Mac'}, so nothing leaves it; Claude is the option in the cloud. <b>Automatic</b> tries ${LINK_HOST ? 'this Mac’s model, then Claude (if you add a key), then Apple’s small model' : 'your Mac’s model, then Claude (if you add a key)'}.</p>
      ${LINK_HOST ? `<div class="lk-direct ${h.ok ? 'on' : ''}"><p><b>On this Mac</b>: ${h.ok ? `✓ ${esc(c.model)} is ready` : h.up ? `the server answers, but hasn’t got ${esc(c.model)}` : 'no model server running'} · ${f.gb} GB memory${f.chip ? ` · ${esc(f.chip)}` : ''}</p>
        ${!ol.up ? `<p class="se-note">The model runs in <b>Ollama</b> (free, from ollama.com). ${this.canInstall() ? 'StudioGen can install it for you (you approve it once), then download the model.' : 'Install it, open it, then come back: the model downloads from here.'}</p><div class="chip-row">${this.canInstall() ? '<button class="chip accent" data-llm="install">Install Ollama for me</button>' : ''}<button class="chip${this.canInstall() ? '' : ' accent'}" data-llm="getollama">Get Ollama (website)</button><button class="chip" data-llm="recheck">Check again</button></div>`
          : f.best && !ol.models.includes(f.best.id) ? `<div class="chip-row"><button class="chip accent" data-llm="pull|${f.best.id}">Download ${esc(f.best.name)} (${f.best.size})</button></div><div class="su-bar" id="llmBar" hidden><i></i></div>` : ''}
        ${f.next ? `<p class="se-note"><b>A better model with more Macs:</b> ${esc(f.next.name)} needs about ${f.next.need} GB. Pool this Mac with another (Thunderbolt or the same network) using a pooling server such as exo or mlx-swarm (their instructions), then put its address and model below.</p>` : ''}
        <label class="se-field"><span>Model server (OpenAI-compatible: Ollama, LM Studio, or a pool of Macs)</span><input id="llmUrl" value="${esc(c.url)}" autocapitalize="off" autocorrect="off"></label>
        <label class="se-field"><span>Model</span><input id="llmModel" list="llmModels" value="${esc(c.model)}" autocapitalize="off" autocorrect="off"><datalist id="llmModels">${(h.models || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
        <label class="se-check"><input type="checkbox" id="llmShare" ${c.share ? 'checked' : ''}> My phones, iPads and StudioGen Workers may use this Mac’s model</label></div>` : ''}
      <label class="se-field"><span>Claude model (cloud)</span><input id="llmCloud" value="${esc(c.cloud)}" list="llmCl"><datalist id="llmCl">${BRAIN_MODELS.anthropic.map(m => `<option value="${m}">`).join('')}</datalist></label>
      <label class="se-field"><span>Anthropic API key (kept on this device)</span><input id="llmKey" type="password" value="${esc(this.key())}" autocomplete="off"></label>
      <p class="se-note"><b>Each job</b></p>${roles.join('')}
      <div class="chip-row"><button class="chip" data-llm="prompts">Prompts…</button><button class="chip" data-llm="test">Test it</button></div>`,
      [['Save', () => { this.saveForm(); toast('Saved'); }], ['Close']]);
  },
  saveForm() {
    const c = this.cfg(), roles = { ...c.roles }; for (const el of $$('[data-llmrole]')) roles[el.dataset.llmrole] = el.value;
    this.save({ ...c, url: $('#llmUrl')?.value.trim() || c.url, model: $('#llmModel')?.value.trim() || c.model, cloud: $('#llmCloud').value.trim() || c.cloud, share: $('#llmShare') ? $('#llmShare').checked : c.share, roles });
    store.set('llmKey', $('#llmKey').value.trim());
  },
  /** Settings › Assistant › Prompts: every prompt the app sends, to read and change (Reset brings the default back). */
  prompts(open) {
    const ids = Object.keys(LLM_PROMPTS);
    if (!open) return sheet('Prompts', `<p class="se-note">What the app tells the language model, for each job. Change one to tune how it answers; words in {braces} are filled in by the app (keep them). The full text of each is also in docs/llm/app-prompts.md.</p>
      <div class="pick-list">${ids.map(id => `<button class="big-btn" data-llm="prompt|${id}">${esc(LLM_PROMPTS[id].name)}${this.edited(id) ? ' · <b>changed</b>' : ''}<br><span class="se-note">${esc(LLM_PROMPTS[id].where)} · ${LLM_PROMPTS[id].role}</span></button>`).join('')}</div>`, [['Close']]);
    const p = LLM_PROMPTS[open], show = t => sheet(p.name, `<p class="se-note">${esc(p.where)} · job: ${p.role}${p.vars.length ? ` · filled in by the app: ${p.vars.map(v => `{${v}}`).join(' ')}` : ''}</p><textarea id="llmPrompt" rows="16" class="se-wide" spellcheck="false">${esc(t)}</textarea>`,
      [['Save', () => { const v = $('#llmPrompt').value; const miss = p.vars.filter(x => !v.includes(`{${x}}`)); if (miss.length && !confirm(`It no longer has ${miss.map(x => `{${x}}`).join(', ')}: the app can’t fill that in. Save anyway?`)) return; this.setPrompt(open, p.file ? (v === this.fileText ? null : v) : v); toast('Saved: used from the next request'); this.prompts(); }],
       ['Reset to the default', () => { this.setPrompt(open, null); toast('Back to the default'); this.prompts(); }], ['Back', () => this.prompts()]]);
    if (p.file) return (this.edited(open) ? Promise.resolve(this.promptText(open)) : fetch(p.file, { cache: 'no-store' }).then(r => r.text()).then(t => (this.fileText = t))).then(show, () => toast('The build prompt isn’t available offline here'));
    show(this.promptText(open));
  },
};
ACTIONS.llm = () => LLM.settings();
ACTIONS.prompts = () => LLM.prompts();
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-llm]'); if (!b) return; e.stopPropagation();
  const [k, arg] = b.dataset.llm.split('|');
  if (k === 'prompts') return LLM.prompts();
  if (k === 'prompt') return LLM.prompts(arg);
  if (k === 'getollama') return openExternal('https://ollama.com/download', 'https://ollama.com/download');
  if (k === 'recheck') { LLM.health = null; return LLM.settings(); }
  if (k === 'install') { b.disabled = true; try { await LLM.installOllama(t => { b.textContent = t; }); toast('Ollama is running: now the model'); LLM.settings(); } catch (err) { b.disabled = false; b.textContent = 'Install Ollama for me'; toast(err.message); } return; }
  if (k === 'test') { LLM.saveForm(); toast('Asking…'); try { const r = await LLM.ask('fast', { system: 'Answer in five words or fewer.', prompt: 'Say hello.' }); toast(`${r.via}: ${r.text.slice(0, 80)}`); } catch (err) { toast(`Didn’t work: ${err.message}`); } return; }
  if (k === 'pull') { const bar = $('#llmBar'); b.disabled = true; if (bar) bar.hidden = false;
    try { await LLM.pull(arg, f => { if (bar) bar.firstElementChild.style.width = `${Math.round(f * 100)}%`; b.textContent = `Downloading… ${Math.round(f * 100)}%`; }); LLM.useLocal(arg); toast('Downloaded: this Mac’s model is ready'); LLM.settings(); }
    catch (err) { b.disabled = false; toast(err.message); } }
}, true);
// StudioGen: is the model server there (for Automatic, the mesh's presence and Settings)
setTimeout(() => { if (LINK_HOST) { LLM.local(); setInterval(() => LLM.local(), 60000); } }, 1500);
