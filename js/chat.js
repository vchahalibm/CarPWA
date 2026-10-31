'use strict';
/* ============================================================
   Talking freely (design: docs/watchers.html § 1). What's said or typed that isn't a command or a task's wording goes to
   the language model (js/llm.js), which either picks something to do (a task, a command, a script) or just talks.
   - Allowed when you called the assistant: typed, the mic tapped, a gesture; in always-listening conversation mode only
     after the wake word (“Hey StudioGen”, Settings › Assistant › Talking freely), and for 30 s after it for follow-ups,
     so the room's chatter on Stage isn't answered.
   - One model call: “ACTION {json}” → it's done (acting ones ask first, as always); anything else is the reply, streamed:
     shown as it comes and spoken sentence by sentence (the avatar's lips follow the voice).
   - It knows: the conversation since 15 quiet minutes, the latest cards, the screen, the time and your place; memory
     across days from js/memory.js (picked for each turn; learned when it pauses).
   Loaded after agent.js.
   ============================================================ */
const Chat = {
  hist: [], at: 0, woke: 0,
  on: () => settings.chatOn !== false,
  /** The wake word, as said (spaces and “studio gen” vs “studiogen” don't matter). */
  wakeRe() {
    const w = String(settings.wakeWord || `Hey ${APP_NAME}`).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/);
    const name = w.slice(1).join('').split('').join('\\s*'); // “studiogen” matches “studio gen”
    return new RegExp(`^\\s*(?:${w[0]}|hey|hi|ok|okay)[\\s,]+(?:${name}|${APP_NAME.toLowerCase().split('').join('\\s*')})\\b[\\s,.!?]*`, 'i');
  },
  /** “Hey StudioGen, what's …” → the rest, and the next 30 s count as woken. */
  wake(raw) { const m = String(raw).match(this.wakeRe()); if (!m) return null; this.woke = Date.now(); return { rest: String(raw).slice(m[0].length).trim() }; },
  /** May this be answered freely? Typed or a tapped mic: yes; always-listening: only after the wake word. */
  allowed(spoken) { if (!this.on()) return false; if (!spoken || !(typeof Convo !== 'undefined' && Convo.active)) return true; return Date.now() - this.woke < 30000; },
  /** The conversation now: forgotten after 15 quiet minutes, at most the last 16 messages (memory keeps more, phase 3). */
  convo() { if (Date.now() - this.at > 15 * 60000) this.hist = []; return this.hist.slice(-16); },
  push(role, content) { this.convo(); this.hist.push({ role, content: String(content).slice(0, 2000), at: Date.now() }); this.at = Date.now();
    /* when the conversation pauses for 3 minutes, memory learns from what's new in it (js/memory.js) */
    clearTimeout(this.lt); this.lt = setTimeout(() => { const n = this.hist.filter(m => m.at > (this.learnedAt || 0)); this.learnedAt = Date.now(); if (n.length >= 2 && typeof Memory !== 'undefined') Memory.learn(n); }, 180000); if (typeof current !== 'undefined' && current === 'agent' && typeof AgentHome !== 'undefined') AgentHome.draw(); },
  forget() { this.hist = []; this.at = 0; clearTimeout(this.lt); this.learnedAt = Date.now(); }, // nothing from it is learned either

  /** What the model is told about now. */
  async context(raw) {
    const cat = typeof Intent !== 'undefined' ? Intent.shortlist(raw, Intent.catalog()) : [];
    const scripts = typeof Scripts !== 'undefined' ? Scripts.all().slice(0, 15).map(s => `- script:${s.name}: present or run the script “${s.name}”`) : [];
    const cards = (typeof Agent !== 'undefined' ? Agent.feed().filter(c => c.status === 'done').slice(0, 3) : []).map(c => `- ${c.title}: ${c.headline}${(c.items || []).slice(0, 5).map(i => `\n  · ${[i.title, i.detail, i.when].filter(Boolean).join(' · ')}`).join('')}`).join('\n') || 'none';
    const screen = `${typeof current !== 'undefined' ? current : ''}${typeof Script !== 'undefined' && Script.running ? `, presenting “${Script.cur?.name}” step ${Script.i + 1}` : ''}${typeof Stage !== 'undefined' && Stage.on ? ' (Stage)' : ''}`;
    const days = Array.from({ length: 8 }, (_, i) => { const x = new Date(Date.now() + i * 864e5); return `${x.toLocaleDateString('en-GB', { weekday: 'long' })} ${x.getDate()} ${x.toLocaleDateString('en-GB', { month: 'short' })}`; }).join(', '); /* the model's own day arithmetic isn't reliable */
    return LLM.prompt('chat', { app: APP_NAME, days, now: new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
      place: typeof placeName === 'function' ? placeName().replace(/ \(default.*$/, '') : '', screen, cards,
      memory: typeof Memory !== 'undefined' ? await Memory.for(raw).catch(() => 'nothing yet') : 'nothing yet',
      actions: [...cat.map(c => `- ${c.id}: ${c.name}${c.slots.length ? ` [${c.slots.join(', ')}]` : ''}`), ...scripts].join('\n') });
  },

  /** One turn: act, or talk (streamed, spoken as it comes). */
  async turn(raw, say) {
    const system = await this.context(raw), messages = [...this.convo().map(({ role, content }) => ({ role, content })), { role: 'user', content: raw }];
    this.push('user', raw); Voice.show?.(`“${raw}”`, 'Thinking…');
    if (typeof Avatar !== 'undefined') Avatar.gesture('Think', 6);
    const live = !(typeof Convo !== 'undefined' && Convo.active); // a conversation plays replies through its own audio path: the whole reply at once there
    let text = '', mode = null, spoken = '', queue = Promise.resolve(), sayId = 0, first = true;
    const speakOut = s => { s = s.replace(/^\s*\d+[.)]\s+|^\s*[-*•]\s+/gm, '').replace(/[*_#`]/g, '').trim(); if (!s || /^\d+[.)]?$/.test(s)) return; /* list numbers and markdown aren't said */ const my = sayId; queue = queue.then(() => my === sayId && Voice.speak(s)); };
    const onChunk = t => {
      text += t;
      if (!mode) { const head = text.trimStart(); if (head.length < 7 && 'ACTION'.startsWith(head.slice(0, 6).toUpperCase())) return; mode = /^ACTION\b/i.test(head) ? 'act' : 'talk'; }
      if (mode !== 'talk' || !live) return;
      if (first) { first = false; this.bubble(text); } else this.bubble(text);
      // whole sentences to the voice as soon as they're complete
      let rest = text.slice(spoken.length), m;
      while ((m = rest.match(/^[\s\S]*?[^\d\s][.!?…](\s|$)/)) && m[0].trim().length > 1) { /* a sentence's end, not “1.” of a list */ speakOut(m[0]); spoken += m[0]; rest = text.slice(spoken.length); }
    };
    let r; try { r = await LLM.ask('fast', { system, messages, onChunk, temperature: 0.5, max: 600 }); }
    catch (e) { Log.w('chat', 'No answer from the model', { error: e.message }); this.hist.pop(); return say('Sorry, I can’t think right now: no language model is answering (Settings › Assistant › Language model).'); }
    text = (r.text || text).trim();
    if (/^ACTION\b/i.test(text)) return this.act(text, raw, say);
    if (!mode) mode = 'talk';
    const tail = text.slice(spoken.length);
    this.push('assistant', text); Log.i('chat', `Talked (${r.via})`, { chars: text.length });
    if (!live) return say(text);
    speakOut(tail); Voice.reply(text); Bus.emit('voice.reply', { value: text });
    if (typeof Avatar !== 'undefined') Avatar.gesture('Explain', 4);
    return queue.then(() => setTimeout(() => { if (!Voice.rec && !Voice.sr) $('#assistant').hidden = true; }, 1800));
  },
  /** The reply so far, in the listening panel (not logged until it's finished). */
  bubble(t) { const el = $('#vReply'); if (!el) return; el.hidden = false; el.innerHTML = `<span>${esc(t)}</span>`; },
  /** “ACTION {…}”: run what the model picked, the same way as if it had been said in its own words. */
  act(text, raw, say) {
    let j; try { j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { this.push('assistant', '(I wanted to act but got muddled)'); return say('Sorry, I got muddled. Could you say that another way?'); }
    const id = String(j.id || ''), inputs = j.inputs && typeof j.inputs === 'object' ? j.inputs : {};
    Log.i('chat', `Acting: ${id}`, { inputs });
    if (/^script:/.test(id) || j.do === 'script') {
      const s = Scripts.all().find(x => plain(x.name) === plain(id.replace(/^script:/, ''))); if (!s) return say('I couldn’t find that script.');
      this.push('assistant', `(asked to start the script ${s.name})`);
      Commands.pending = { at: Date.now(), yes: () => Script.start(s.json), no: () => {} }; return say(`Shall I start “${s.name}”?`, null, { ask: true });
    }
    if (/^task:/.test(id) && typeof Agent !== 'undefined') { const t = Agent.get(id.slice(5)); if (!t) return say('I couldn’t find that task.'); this.push('assistant', `(ran the task “${t.name}”)`); return Agent.start(t, inputs, { say }); }
    const c = Commands.all().find(x => x.id === id); if (!c) return say('Sorry, I can’t do that here.');
    const vars = { text: raw, q: '', ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)])) }, r = { cmd: c, vars, how: 'chat', echo: c.name };
    this.push('assistant', `(did “${c.name}”)`);
    if (Intent.RISKY.test(c.id)) { Commands.pending = { r, raw, at: Date.now() }; return say(`Did you mean “${c.name}”?`, null, { ask: true }); }
    return Commands.exec(r, raw, say);
  },
  /** The conversation on the Agent screen (while it lasts). */
  html() {
    const l = this.convo(); if (!l.length) return '';
    return `<section class="ag-chat" aria-label="Conversation">${l.slice(-6).map(m => `<p class="${m.role === 'user' ? 'you' : 'it'}">${esc(m.content)}</p>`).join('')}<button class="link-btn" data-chat="forget">Forget this conversation</button></section>`;
  },
  settings() {
    sheet('Talking freely', `<p class="se-note">Anything you say or type that isn’t a command is answered by the language model, or turned into the task or command it means. When ${APP_NAME} is always listening (conversation mode), only what starts with the wake word is answered freely, so the room isn’t.</p>
      <label class="se-check"><input type="checkbox" id="chOn" ${this.on() ? 'checked' : ''}> Talk freely</label>
      <label class="se-field"><span>Wake word</span><input id="chWake" value="${esc(settings.wakeWord || `Hey ${APP_NAME}`)}"></label>`,
      [['Save', () => { settings.chatOn = $('#chOn').checked; settings.wakeWord = $('#chWake').value.trim() || `Hey ${APP_NAME}`; store.set('settings', settings); toast('Saved'); }], ['Close']]);
  },
};
ACTIONS.chat = () => Chat.settings();
document.addEventListener('click', e => { if (e.target.closest('[data-chat="forget"]')) { e.stopPropagation(); Chat.forget(); AgentHome.draw(); toast('Forgotten'); } });
