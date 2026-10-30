'use strict';
/* ============================================================
   Understanding (optional): a language model for what the phrase matcher
   doesn't get, in interactive scripts (Script.unmatched picks the intent
   and fills its slots, or answers briefly), and the script step “Ask the
   model” (action brain.ask, its answer kept with `as`).
   - Off by default. Settings › Assistant › Understanding: Claude with your
     own Anthropic key, or any OpenAI-compatible server (a local one such as
     Ollama or LM Studio: http://localhost:11434/v1, no key).
   - The key stays on this device (dd.llmKey) and is never logged. What you
     said goes to the provider only when nothing matched locally, or when a
     script asks the model.
   Loaded after script.js.
   ============================================================ */
const BRAIN_MODELS = { anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], openai: [] };
const Brain = {
  cfg: () => ({ provider: 'off', model: '', url: 'http://localhost:11434/v1', ...store.get('llm', {}) }),
  key: () => store.get('llmKey', ''),
  ready() { return LLM.biReady() || LLM.health?.ok || !!LLM.remote() || !!LLM.key() || (typeof MacAI !== 'undefined' && MacAI.local()); }, // the language model (js/llm.js)
  /** One question → the model's text (the cards job: a few sentences). */
  async complete(system, user, max = 400) { return (await LLM.ask('cards', { system, prompt: user, max })).text; },
  /** What was heard → { intent, slots } (one of the script's intents) or { say } (a short answer), or null. */
  async route(text, intents, vars = {}) {
    const list = intents.map(i => ({ id: i.id, title: i.title, examples: i.on.slice(0, 4), slots: [...new Set([...Object.keys(i.ask || {}), ...i.on.flatMap(p => [...p.matchAll(/\{(\w+)\}/g)].map(m => m[1]))])] }));
    const known = Object.fromEntries(Object.entries(vars).filter(([, v]) => typeof v !== 'object').slice(0, 20)), slotNames = [...new Set(list.flatMap(i => i.slots))];
    const schema = { type: 'object', required: ['intent'], properties: { intent: { type: 'string', enum: [...list.map(i => i.id), 'none'] }, say: { type: 'string', description: 'if no action fits: a short answer to say' }, ...Object.fromEntries(slotNames.map(n => [n, { type: 'string', description: `the ${n}, from what was said` }])) } };
    const j = (await LLM.ask('fast', { system: LLM.prompt('route'), prompt: LLM.prompt('route.prompt', { actions: JSON.stringify(list), known: JSON.stringify(known), said: text }), schema, temperature: 0, max: 200 })).json || {};
    const r = { intent: j.intent && j.intent !== 'none' && list.some(i => i.id === j.intent) ? j.intent : null, slots: Object.fromEntries(slotNames.filter(n => j[n] && !/^(none|null)$/i.test(j[n])).map(n => [n, j[n]])), say: !j.intent || j.intent === 'none' ? j.say : undefined };
    Log.i('brain', 'Routed', { intent: r.intent, slots: r.slots }); return r;
  },
  /** A script asks the model (action brain.ask); the answer is plain text, short enough to say. */
  async ask(q) {
    const a = (await this.complete(LLM.prompt('ask'), q, 800)).trim(); Log.i('brain', 'Asked', { chars: a.length }); return a;
  },
  settings() { LLM.settings(); }, // one setting now: Settings › Assistant › Language model (js/llm.js)
};
ACTIONS.brain = () => Brain.settings();
Actions.define('brain.ask', { group: 'Scripts', name: 'Ask the model (Understanding)', arg: 'The question ({variables} are filled in); keep the answer with “as”', run: v => Brain.ask(v) });

/* ---------- Apple's on-device model (Foundation Models): StudioGen through its helper (desktop/ai), a phone through its
   paired Mac (the link's 'ai' request, js/link.js). Needs macOS 26+, Apple silicon, Apple Intelligence on. ---------- */
const MacAI = {
  local: () => !!window.DriveDeckDesktop?.ai,
  /** Possible here: this Mac has the helper, or this phone has a link to its Mac (which may still say it can't). */
  can() { return this.local() || (!LINK_HOST && typeof Link !== 'undefined' && Link.ready() && Date.now() > (this.noUntil || 0)); },
  async status() { if (this.local()) return (this.st ||= await DriveDeckDesktop.ai.status()); return { available: this.can(), via: 'your Mac' }; },
  /** { instructions, prompt, schema?, temperature?, max? } → { text } or { json }. */
  async ask(o) {
    const t0 = performance.now(); let r;
    if (this.local()) r = await DriveDeckDesktop.ai.ask(o);
    else if (!LINK_HOST && typeof Link !== 'undefined' && Link.ready()) { try { r = await Link.ai(o); } catch (e) { if (/not available|macOS 26|Apple Intelligence|Unknown request/i.test(e.message)) this.noUntil = Date.now() + 600000; throw e; } }
    else throw new Error('Apple’s on-device model needs StudioGen on a Mac (macOS 26 or later)');
    if (r?.error) { if (/not available|macOS 26|Apple Intelligence/i.test(r.error)) this.noUntil = Date.now() + 600000; throw new Error(r.error); }
    Log.d('brain', `Mac model answered in ${Math.round(performance.now() - t0)} ms`, { json: !!r.json }); return r;
  },
  async text(system, user, max) { return (await this.ask({ instructions: system, prompt: user, max, temperature: 0.3 })).text || ''; },
  /** On StudioGen: a paired phone's request (Direct.handle / LinkHost 'ai'): run it here, within limits. */
  async answer(p) { if (!this.local()) throw new Error('Apple’s on-device model isn’t available on this Mac'); return DriveDeckDesktop.ai.ask({ instructions: p.instructions, prompt: p.prompt, schema: p.schema, temperature: p.temperature, max: p.max }); },
};

/* ---------- Commands by intent: when no phrase matched, the on-device model picks the command and fills its slots
   (one of this device's commands, described by name and an example; known script, device and contact names as
   hints). A phone asks its Mac. Things that are hard to undo (calls, messages, removing devices…) are asked first. ---------- */
const Intent = {
  RISKY: /^(phone\.(call|text|whatsapp)|mesh\.(remove|leave|deny|private)|link\.rekey)/,
  // always in the shortlist: everyday things asked in words that share nothing with their phrases (“is it going to pour?”)
  CORE: ['info.weather', 'info.time', 'info.date', 'info.help', 'nav.to', 'nav.eta', 'nav.nearby', 'music.play', 'music.pause', 'phone.call', 'phone.read', 'mesh.who', 'mac.run'],
  can: () => !!(LLM.biReady() || LLM.health?.ok || LLM.remote() || LLM.key() || (typeof MacAI !== 'undefined' && MacAI.local())), // a language model (js/llm.js); checked again when asked
  /** The commands: id, what it does, one way to say it, the words it needs (its {slots}). */
  catalog() {
    const eg = l => String(l).replace(/\[[^\]]*\]\s*/g, '').replace(/\(([^)|]*)[^)]*\)/g, '$1').replace(/\{(\w+)\}/g, '<$1>').replace(/\s+/g, ' ').trim();
    return Commands.all().filter(c => c.on !== false && (c.match || 'phrase') !== 'regex').map(c => {
      const say = [].concat(c.say || []).map(String), slots = [...new Set(say.flatMap(l => [...l.matchAll(/\{(\w+)\}/g)].map(m => m[1])))];
      const ex = (c.match === 'keywords' ? say.slice(0, 2).map(l => l.replace(/[|,]/g, ' ')) : say.slice(0, 2).map(eg)).map(x => x.slice(0, 50));
      return { id: c.id, name: c.name, eg: ex, slots, words: `${c.name} ${say.join(' ')}`.toLowerCase() };
    }).concat(typeof Agent !== 'undefined' ? Agent.catalog() : []);
  },
  /** The commands worth showing the model for this: those sharing words with what was said (stems), at most 20. */
  shortlist(text, cat) {
    const stop = /^(the|a|an|to|me|my|i|you|it|is|of|on|in|for|and|or|please|can|could|would|what|let|some|that|this|be|do|up|with|at|from)$/;
    const stem = w => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ing|ed|es|s)$/, '').slice(0, 6);
    const words = text.split(/\s+/).map(stem).filter(w => w.length > 2 && !stop.test(w));
    const scored = cat.map(c => ({ c, n: words.filter(w => c.words.includes(w)).length })).sort((a, b) => b.n - a.n);
    const top = scored.filter(x => x.n > 0).slice(0, 16).map(x => x.c);
    return [...new Set([...top, ...cat.filter(c => this.CORE.includes(c.id))])];
  },
  hints(text = '') {
    const h = {};
    try { h.scripts = Scripts.all().map(s => s.name).slice(0, 30); } catch {}
    try { if (typeof Mesh !== 'undefined' && Mesh.m) h.devices = Mesh.members().map(x => x.name); } catch {}
    // people only when one was named: a list of names made the model put “Mom” into “who called me”
    try { if (typeof CONTACTS !== 'undefined') { const ppl = CONTACTS.map(c => c.n || c.name).filter(n => n && new RegExp(`\\b${n.split(' ')[0]}\\b`, 'i').test(text)); if (ppl.length) h.people = ppl; } } catch {}
    return h;
  },
  request(text) {
    const cat = this.shortlist(text, this.catalog()), h = this.hints(text), slots = [...new Set(cat.flatMap(c => c.slots))];
    const instructions = LLM.prompt('intent', { commands: cat.map(c => `- ${c.id}: ${c.name} (e.g. ${c.eg.map(e => `“${e}”`).join(', ')})${c.slots.length ? ` [${c.slots.join(', ')}]` : ''}`).join('\n'),
      hints: `${h.scripts ? `. Scripts are: ${h.scripts.join(', ')}` : ''}${h.devices ? `. Devices are: ${h.devices.join(', ')}` : ''}${h.people ? `. People named: ${h.people.join(', ')}` : ''}` });
    const schema = { type: 'object', required: ['intent'], properties: { intent: { type: 'string', enum: [...cat.map(c => c.id), 'none'] }, ...Object.fromEntries(slots.map(s => [s, { type: 'string', description: `the ${s}, if the command needs it` }])) } };
    return { instructions, prompt: text, schema, temperature: 0, max: 200 };
  },
  /** What was heard and matched nothing → a command (run, or asked first), else `fallback()`. */
  async handle(raw, say, fallback) {
    Voice.show(`“${raw}”`, LINK_HOST ? 'Understanding…' : 'Asking your Mac…');
    let j; const t0 = performance.now();
    try { const q = this.request(raw); j = (await LLM.ask('fast', { system: q.instructions, prompt: q.prompt, schema: q.schema, temperature: 0, max: 200 })).json || {}; }
    catch (e) { Log.w('cmd', 'Commands by intent: no answer', { error: e.message }); return fallback(); }
    if (/^task:/.test(j.intent || '') && typeof Agent !== 'undefined') { // a task of the agent's library, its inputs filled from what was said
      const t = Agent.get(j.intent.slice(5)); Log.i('cmd', `“${raw}” → ${j.intent} (by intent, ${Math.round(performance.now() - t0)} ms)`, { answer: j });
      if (t) { const ps = {}; for (const k of Object.keys(Agent.params(t))) if (j[k] != null && String(j[k]).trim()) ps[k] = String(j[k]).trim(); return Agent.start(t, ps, { say }); }
    }
    const c = j.intent && j.intent !== 'none' && Commands.all().find(x => x.id === j.intent);
    Log.i('cmd', `“${raw}” → ${c ? c.id : 'nothing'} (by intent, ${Math.round(performance.now() - t0)} ms)`, { answer: j });
    if (!c) return fallback();
    const want = new Set([].concat(c.say || []).flatMap(l => [...String(l).matchAll(/\{(\w+)\}/g)].map(m => m[1])));
    const vars = { text: raw, q: '' }; for (const k of want) { const v = String(j[k] ?? '').trim(); if (v && !/^(none|null|n\/a)$/i.test(v)) vars[k] = v; }
    if ([...want].some(k => !vars[k]) && want.size) { Log.d('cmd', 'By intent: a needed word is missing', { want: [...want], vars }); }
    const r = { cmd: c, vars, how: 'intent', echo: `${c.name}${Object.entries(vars).filter(([k, v]) => v && k !== 'text').map(([, v]) => ` · ${v}`).join('')}` };
    if (this.RISKY.test(c.id)) { Commands.pending = { r, raw, at: Date.now() }; return say(`Did you mean “${r.echo}”?`, null, { ask: true }); }
    Commands.exec(r, raw, say);
  },
};
