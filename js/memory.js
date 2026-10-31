'use strict';
/* ============================================================
   Memory: curated, on the device (design: docs/watchers.html § 9). Not a log of everything said: a small, tidy set of
   things worth knowing about you, picked for each turn of the conversation (js/chat.js) so it fits the model's window.
   - Facts (one sentence each: who, where, how you like things, plans with dates), with where they came from, how sure,
     when last used, an end date if temporary, and their history; episodes (one line per conversation).
   - Learning: when a conversation pauses (3 minutes), the model proposes add / update / confirm / expire (the memory.learn
     prompt); code applies them; “remember that …” and “forget …” at once. Never kept: passwords, codes, card or bank
     numbers, anything from a sign-in page.
   - Picking: EmbeddingGemma (desktop/llm.js) turns facts and what was said into vectors; the closest facts, mixed with
     words and names in common and recency, plus pinned ones, within ~1,500 tokens.
   - Tidying once a day: near-duplicates merged, expired dropped, unused ones fade, at most 400 facts.
   - Kept on StudioGen in one file locked with the Keychain (DriveDeckDesktop.memory); a phone uses its Mac's memory
     (link request 'memory', own devices only), or its own (words only) when it has no Mac.
   Loaded after chat.js.
   ============================================================ */
const MEM_KINDS = ['person', 'place', 'preference', 'routine', 'project', 'fact'];
const MEM_SECRET = /\b(password|passcode|pass code|pin code|otp|one[- ]time (code|password)|cvv|cvc|card number|ssn|social security|bank account|account number|iban|sort code|security code)\b|\b\d{12,19}\b/i;
const Memory = {
  d: null, loading: null,
  blank: () => ({ v: 1, on: true, facts: [], episodes: [], vec: {}, tidyAt: 0 }),
  /** Where it lives: StudioGen's locked file, else this device's storage. */
  local: () => !!window.DriveDeckDesktop?.memory,
  /** A phone with a Mac: the Mac's memory. */
  remote: () => !LINK_HOST && typeof Link !== 'undefined' && Link.ready() && Date.now() > (Memory.noRemote || 0),
  async load() {
    if (this.d) return this.d;
    return (this.loading ||= (async () => {
      let raw = null; try { raw = this.local() ? await DriveDeckDesktop.memory('read') : store.get('memory', null); } catch {}
      try { this.d = { ...this.blank(), ...(typeof raw === 'string' ? JSON.parse(raw) : raw || {}) }; } catch { this.d = this.blank(); }
      return this.d;
    })());
  },
  save() { clearTimeout(this.st); this.st = setTimeout(() => { const j = JSON.stringify(this.d); if (this.local()) DriveDeckDesktop.memory('write', j).catch(e => Log.w('memory', 'Not saved', { error: e.message })); else store.set('memory', this.d); }, 800); },
  on() { return this.d ? this.d.on !== false : true; },

  /* ---------- Vectors (EmbeddingGemma) ---------- */
  canEmbed: () => !!window.DriveDeckDesktop?.llm?.embed,
  async embed(texts, kind = 'doc') { if (!this.canEmbed() || !texts.length) return null; const r = await DriveDeckDesktop.llm.embed({ texts, kind }); if (r?.error) { Log.w('memory', 'Embeddings unavailable', { error: r.error }); return null; } return r; },
  async index(facts) { const need = facts.filter(f => !this.d.vec[f.id]); if (!need.length) return; const v = await this.embed(need.map(f => f.text)); if (v) need.forEach((f, i) => { this.d.vec[f.id] = v[i]; }); },
  cos(a, b) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); },
  words: t => new Set(plain(t).split(' ').filter(w => w.length > 2 && !/^(the|and|for|you|your|my|me|what|who|is|are|was|that|this|with|about|have|has)$/.test(w))),

  /* ---------- Reading: the memory for this turn ---------- */
  /** What the model should know for what was just said: a few pinned facts and the closest ones, within the budget. */
  async for(raw, budget = 6000) {
    if (this.remote()) { try { const r = await Link.memory({ op: 'for', q: raw }); return r?.text || 'nothing yet'; } catch (e) { if (/Unknown request/.test(e.message)) this.noRemote = Date.now() + 600000; } }
    const d = await this.load(); if (!this.on()) return 'memory is off';
    const now = Date.now(), live = d.facts.filter(f => !f.expires || Date.parse(f.expires) > now);
    if (!live.length) return 'nothing yet';
    await this.index(live).catch(() => {});
    const qv = (await this.embed([raw], 'query').catch(() => null))?.[0], qw = this.words(raw);
    const score = f => { const v = d.vec[f.id], w = this.words(`${f.subject || ''} ${f.text}`); let s = qv && v ? this.cos(qv, v) : 0; for (const x of qw) if (w.has(x)) s += 0.08; s += Math.min(0.05, (f.uses || 0) * 0.005); s += Math.max(0, 0.05 - (now - (f.updated || f.created)) / 864e7); return s; };
    const pinned = live.filter(f => f.pinned), rest = live.filter(f => !f.pinned).map(f => [score(f), f]).sort((a, b) => b[0] - a[0]).filter(([s]) => s > 0.3).map(([, f]) => f);
    const out = []; let n = 0;
    for (const f of [...pinned, ...rest]) { const line = `- ${f.text}${f.expires ? ` (until ${f.expires})` : ''}`; if (n + line.length > budget) break; out.push(line); n += line.length; f.lastUsed = now; f.uses = (f.uses || 0) + 1; }
    const ep = d.episodes.slice(-3).map(e => `- earlier (${e.date}): ${e.summary}`).join('\n');
    if (out.length) this.save();
    return [out.join('\n'), ep].filter(Boolean).join('\n') || 'nothing yet';
  },

  /* ---------- Writing ---------- */
  id: () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  clean(t) { t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300); return !t || MEM_SECRET.test(t) ? '' : t; },
  /** “Remember that …”: kept at once, fully sure. */
  async remember(text, o = {}) {
    if (this.remote()) return Link.memory({ op: 'remember', text });
    const d = await this.load(), t = this.clean(text); if (!t) return { ok: false, why: 'not kept (it looks like a password, code or card number)' };
    const same = d.facts.find(f => plain(f.text) === plain(t)); if (same) { same.confidence = 1; same.updated = Date.now(); this.save(); return { ok: true, f: same }; }
    const f = { id: this.id(), text: t, subject: o.subject || '', kind: MEM_KINDS.includes(o.kind) ? o.kind : 'fact', confidence: 1, source: o.source || 'said', created: Date.now(), updated: Date.now(), uses: 0, ...(o.expires ? { expires: o.expires } : {}) };
    d.facts.push(f); await this.index([f]).catch(() => {}); this.save(); Log.i('memory', 'Remembered', { kind: f.kind }); return { ok: true, f };
  },
  /** “Forget that” (the last thing learned or said), or “forget about Priya” (everything mentioning it). */
  async forget(q) {
    if (this.remote()) return Link.memory({ op: 'forget', q });
    const d = await this.load();
    let gone = [];
    if (!q) { const last = [...d.facts].sort((a, b) => (b.updated || b.created) - (a.updated || a.created))[0]; if (last) gone = [last]; }
    else { const w = plain(q); gone = d.facts.filter(f => plain(`${f.subject} ${f.text}`).includes(w)); }
    d.facts = d.facts.filter(f => !gone.includes(f)); gone.forEach(f => delete d.vec[f.id]); this.save(); return gone.map(f => f.text);
  },
  /** “What do you remember about …”: the facts, most relevant first. */
  async about(q) {
    if (this.remote()) return (await Link.memory({ op: 'about', q }))?.facts || [];
    const d = await this.load(); if (!q || /^(me|myself)$/i.test(q)) return d.facts.slice(-12).map(f => f.text);
    const t = await this.for(q, 2500); return t === 'nothing yet' ? [] : t.split('\n').filter(l => l.startsWith('- ') && !l.startsWith('- earlier')).map(l => l.slice(2));
  },
  /** After a conversation: the model proposes changes; code applies them (merging, history, expiry). */
  async learn(turns) {
    if (!turns?.length) return;
    if (this.remote()) return Link.memory({ op: 'learn', turns }).catch(() => {});
    const d = await this.load(); if (!this.on()) return;
    const convo = turns.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n').slice(-8000);
    const near = (await this.for(convo.slice(-1500), 4000).catch(() => '')) || '';
    const ids = d.facts.filter(f => near.includes(f.text)).map(f => `${f.id}: ${f.text}`).join('\n') || 'nothing yet';
    const schema = { type: 'object', required: ['episode', 'changes'], properties: { episode: { type: 'string', description: 'one line: what this conversation was about, with names' },
      changes: { type: 'array', items: { type: 'object', required: ['op'], properties: { op: { type: 'string', enum: ['add', 'update', 'confirm', 'expire'] }, id: { type: 'string' }, text: { type: 'string' }, kind: { type: 'string', enum: MEM_KINDS }, subject: { type: 'string' }, expires: { type: 'string' } } } } } };
    let j; try { j = (await LLM.ask('cards', { system: LLM.prompt('memory.learn', { today: new Date().toISOString().slice(0, 10), days: Array.from({ length: 14 }, (_, i) => { const x = new Date(Date.now() + i * 864e5); return `${x.toLocaleDateString('en', { weekday: 'long' })} ${x.toISOString().slice(0, 10)}`; }).join(', '), facts: ids }), prompt: convo, schema, temperature: 0.1, max: 800 })).json || {}; }
    catch (e) { return Log.w('memory', 'Nothing learned (no model)', { error: e.message }); }
    let n = 0;
    for (const c of (j.changes || []).slice(0, 12)) {
      const f = c.id && d.facts.find(x => x.id === c.id), t = this.clean(c.text);
      if (c.op === 'add' && t && !d.facts.some(x => plain(x.text) === plain(t))) { d.facts.push({ id: this.id(), text: t, subject: String(c.subject || '').slice(0, 60), kind: MEM_KINDS.includes(c.kind) ? c.kind : 'fact', confidence: 0.7, source: 'learned', created: Date.now(), updated: Date.now(), uses: 0, ...(/^\d{4}-\d\d-\d\d$/.test(c.expires || '') ? { expires: c.expires } : {}) }); n++; }
      else if (c.op === 'update' && f && t) { (f.history ||= []).push({ text: f.text, at: f.updated }); f.text = t; f.updated = Date.now(); delete d.vec[f.id]; n++; }
      else if (c.op === 'confirm' && f) { f.confidence = Math.min(1, (f.confidence || 0.7) + 0.15); f.updated = Date.now(); }
      else if (c.op === 'expire' && f) { f.expires = new Date().toISOString().slice(0, 10); n++; }
    }
    const ep = this.clean(j.episode); if (ep) { d.episodes.push({ id: this.id(), date: new Date().toISOString().slice(0, 10), summary: ep }); d.episodes = d.episodes.slice(-200); }
    await this.index(d.facts).catch(() => {}); this.save(); Log.i('memory', `Learned from a conversation: ${n} change(s)`);
    if (Date.now() - (d.tidyAt || 0) > 864e5) this.tidy();
  },
  /** Once a day: near-duplicates merged (keeping the newer), expired dropped, unused learned ones fade, at most 400. */
  async tidy() {
    const d = await this.load(), now = Date.now();
    d.facts = d.facts.filter(f => !f.expires || Date.parse(f.expires) > now - 864e5);
    await this.index(d.facts).catch(() => {});
    const keep = [];
    for (const f of [...d.facts].sort((a, b) => (b.updated || b.created) - (a.updated || a.created))) {
      const dup = keep.find(k => d.vec[k.id] && d.vec[f.id] && this.cos(d.vec[k.id], d.vec[f.id]) > 0.93);
      if (dup) { dup.confidence = Math.max(dup.confidence || 0, f.confidence || 0); dup.pinned ||= f.pinned; delete d.vec[f.id]; } else keep.push(f);
    }
    const fade = f => f.source === 'learned' && !f.pinned && (f.uses || 0) === 0 && now - f.created > 90 * 864e5; // learned, never used in three months
    d.facts = keep.filter(f => !fade(f)).sort((a, b) => (b.pinned - a.pinned) || ((b.uses || 0) - (a.uses || 0))).slice(0, 400);
    for (const id of Object.keys(d.vec)) if (!d.facts.some(f => f.id === id)) delete d.vec[id];
    d.tidyAt = now; this.save(); Log.i('memory', 'Tidied', { facts: d.facts.length });
  },
  /** On StudioGen: a phone's request (its owner's own devices only). */
  async answer(p, who) {
    if (typeof Agent !== 'undefined' && !Agent.ownDevice(who)) throw new Error('Only this Mac’s owner’s own devices share its memory');
    if (p.op === 'for') return { text: await this.for(String(p.q || '').slice(0, 2000)) };
    if (p.op === 'learn') { this.learn((p.turns || []).slice(-30)); return { ok: true }; }
    if (p.op === 'remember') return this.remember(String(p.text || ''));
    if (p.op === 'forget') return { gone: await this.forget(p.q) };
    if (p.op === 'about') return { facts: await this.about(p.q) };
    throw new Error('Unknown memory request');
  },

  /* ---------- Settings › Assistant › Memory ---------- */
  async settings(q = '') {
    if (this.remote()) return sheet('Memory', `<p>This ${isIOS ? 'phone' : 'device'} uses the memory of ${esc(Link.macName())}: see it there (StudioGen › Settings › Assistant › Memory).</p>`, [['OK']]);
    const d = await this.load(), l = d.facts.filter(f => !q || plain(`${f.subject} ${f.text}`).includes(plain(q))).sort((a, b) => (b.pinned - a.pinned) || ((b.updated || b.created) - (a.updated || a.created)));
    sheet('Memory', `<p class="se-note">What the assistant remembers about you, kept on this ${this.local() ? 'Mac, locked with its Keychain' : 'device'}. It learns from conversations; say “remember that …”, “forget that”, “what do you remember about Priya”.</p>
      <label class="se-check"><input type="checkbox" id="memOn" ${this.on() ? 'checked' : ''}> Remember things</label>
      <label class="se-field"><span>Search (${d.facts.length} facts, ${d.episodes.length} conversations)</span><input id="memQ" value="${esc(q)}"></label>
      <div class="mem-list">${l.slice(0, 80).map(f => `<div class="mem-row"><span>${f.pinned ? '📌 ' : ''}${esc(f.text)}<br><span class="se-note">${f.kind} · ${f.source === 'said' ? 'you said to remember' : 'learned'} ${new Date(f.updated || f.created).toLocaleDateString()}${f.expires ? ` · until ${f.expires}` : ''}${f.uses ? ` · used ${f.uses}×` : ''}</span></span><span><button class="link-btn" data-mem="pin|${f.id}">${f.pinned ? 'Unpin' : 'Pin'}</button> <button class="link-btn" data-mem="edit|${f.id}">Edit</button> <button class="link-btn" data-mem="del|${f.id}">Forget</button></span></div>`).join('') || '<p class="se-note">Nothing yet.</p>'}</div>
      <div class="chip-row"><button class="chip" data-mem="add">+ Add</button><button class="chip" data-mem="wipe">Forget everything</button></div>
      ${this.canEmbed() ? '' : '<p class="se-note">Finding facts by meaning needs StudioGen on a Mac (EmbeddingGemma); here it finds them by their words.</p>'}`,
      [['Search', () => this.settings($('#memQ').value)], ['Close', () => { d.on = $('#memOn').checked; this.save(); }]]);
  },
};
ACTIONS.memory = () => Memory.settings();
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-mem]'); if (!b) return; e.stopPropagation();
  const [k, id] = b.dataset.mem.split('|'), d = await Memory.load(), f = d.facts.find(x => x.id === id);
  if (k === 'pin' && f) { f.pinned = !f.pinned; Memory.save(); }
  if (k === 'del' && f) { d.facts = d.facts.filter(x => x !== f); delete d.vec[f.id]; Memory.save(); }
  if (k === 'edit' && f) return sheet('Edit', `<label class="se-field"><span>The fact</span><input id="memT" value="${esc(f.text)}"></label><label class="se-field"><span>Until (optional, YYYY-MM-DD)</span><input id="memX" value="${esc(f.expires || '')}"></label>`,
    [['Save', () => { const t = Memory.clean($('#memT').value); if (!t) return toast('Not kept'); (f.history ||= []).push({ text: f.text, at: f.updated }); f.text = t; f.updated = Date.now(); const x = $('#memX').value.trim(); if (/^\d{4}-\d\d-\d\d$/.test(x)) f.expires = x; else delete f.expires; delete d.vec[f.id]; Memory.save(); Memory.settings(); }], ['Cancel', () => Memory.settings()]]);
  if (k === 'add') return sheet('Remember', '<label class="se-field"><span>Something to remember</span><input id="memT" placeholder="Priya Nair is my manager"></label>', [['Remember', async () => { const r = await Memory.remember($('#memT').value); toast(r.ok ? 'Remembered' : r.why); Memory.settings(); }], ['Cancel', () => Memory.settings()]]);
  if (k === 'wipe') { if (!confirm('Forget everything the assistant remembers?')) return; Object.assign(d, Memory.blank()); if (Memory.local()) await DriveDeckDesktop.memory('wipe'); Memory.save(); }
  Memory.settings();
}, true);
