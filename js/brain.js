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
  ready() { const c = this.cfg(); return c.provider === 'anthropic' ? !!this.key() : c.provider === 'openai' ? !!c.url : false; },
  /** One question → the model's text. */
  async complete(system, user, max = 400) {
    const c = this.cfg(), ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    try {
      if (c.provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': this.key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: c.model || BRAIN_MODELS.anthropic[0], max_tokens: max, system, messages: [{ role: 'user', content: user }] }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || `${r.status}`);
        return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      }
      if (c.provider === 'openai') {
        const r = await fetch(`${c.url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', ...(this.key() ? { authorization: `Bearer ${this.key()}` } : {}) },
          body: JSON.stringify({ model: c.model || 'llama3.2', max_tokens: max, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || `${r.status}`);
        return j.choices?.[0]?.message?.content || '';
      }
      throw new Error('No model set up (Settings › Assistant › Understanding)');
    } finally { clearTimeout(t); }
  },
  /** What was heard → { intent, slots } (one of the script's intents) or { say } (a short answer), or null. */
  async route(text, intents, vars = {}) {
    const list = intents.map(i => ({ id: i.id, title: i.title, examples: i.on.slice(0, 4), slots: [...new Set([...Object.keys(i.ask || {}), ...i.on.flatMap(p => [...p.matchAll(/\{(\w+)\}/g)].map(m => m[1]))])] }));
    const sys = 'You route what a user said to a voice assistant to one of the actions it can take. Reply with JSON only, no prose: {"intent": "<an id from the list, or null>", "slots": {"<slot>": "<value from what they said>"}, "say": "<if no intent fits: a short, friendly spoken reply, at most two sentences>"}.';
    const known = Object.fromEntries(Object.entries(vars).filter(([, v]) => typeof v !== 'object').slice(0, 20));
    const out = await this.complete(sys, `Actions: ${JSON.stringify(list)}\nKnown values: ${JSON.stringify(known)}\nThe user said: “${text}”`, 300);
    const m = out.match(/\{[\s\S]*\}/); if (!m) return { say: out.trim().slice(0, 300) };
    const r = JSON.parse(m[0]); if (r.intent && !intents.some(i => i.id === r.intent)) r.intent = null;
    Log.i('brain', 'Routed', { intent: r.intent, slots: r.slots }); return r;
  },
  /** A script asks the model (action brain.ask); the answer is plain text, short enough to say. */
  async ask(q) {
    const sys = 'You are the assistant inside a presentation and task app, speaking out loud. Answer briefly and plainly (at most three sentences) unless asked for a list or data. If asked for data, answer with JSON only.';
    const a = (await this.complete(sys, q, 800)).trim(); Log.i('brain', 'Asked', { chars: a.length }); return a;
  },
  /** Settings › Assistant › Understanding. */
  settings() {
    const c = this.cfg(), o = (v, cur, l = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
    sheet('Understanding (optional)', `<p class="se-note">In interactive scripts the assistant matches what you say to what it can do on this device. A language model can take over when nothing matches (and scripts can ask it questions). What you said is sent to the provider only then.</p>
      <label class="se-field"><span>Model</span><select id="llmP">${o('off', c.provider, 'Off: only the phrases in scripts')}${o('anthropic', c.provider, 'Claude (your Anthropic API key)')}${o('openai', c.provider, 'OpenAI-compatible server (Ollama, LM Studio, others)')}</select></label>
      <label class="se-field"><span>Which model</span><input id="llmM" class="se-wz-in" list="llmML" value="${esc(c.model)}" placeholder="${c.provider === 'openai' ? 'llama3.2' : BRAIN_MODELS.anthropic[0]}"><datalist id="llmML">${BRAIN_MODELS.anthropic.map(m => `<option value="${m}">`).join('')}</datalist></label>
      <label class="se-field"><span>Server address (OpenAI-compatible)</span><input id="llmU" class="se-wz-in" value="${esc(c.url)}"></label>
      <label class="se-field"><span>API key (kept on this device; not needed for a local server)</span><input id="llmK" class="se-wz-in" type="password" value="${esc(this.key())}" autocomplete="off"></label>`,
      [['Save', () => this.save()], ['Save and test', async () => { this.save(); try { toast(`Model says: ${(await this.ask('Say hello in five words.')).slice(0, 80)}`); } catch (e) { toast(`Didn’t work: ${e.message}`); } }], ['Cancel']]);
  },
  save() { store.set('llm', { provider: $('#llmP').value, model: $('#llmM').value.trim(), url: $('#llmU').value.trim() }); store.set('llmKey', $('#llmK').value.trim()); if (current === 'settings') renderSettings(); toast('Saved'); },
};
ACTIONS.brain = () => Brain.settings();
Actions.define('brain.ask', { group: 'Scripts', name: 'Ask the model (Understanding)', arg: 'The question ({variables} are filled in); keep the answer with “as”', run: v => Brain.ask(v) });
