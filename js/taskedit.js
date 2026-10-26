'use strict';
/* ============================================================
   Agent tasks in Settings › Scripts & tasks: the list (run watched, edit, share in the mesh, delete), the visual editor
   (name, ways to ask, inputs, “acts for me”, steps as cards to add, change, reorder and delete) and “Teach me”: the
   agent browser opens and the clicks and typing you do become steps; “Read this part” marks what the agent reads; a
   guided finish asks what it should tell you and which typed words change each time (they become inputs).
   A built-in task you edit is saved as your own copy, which takes its place (Reset brings the built-in back).
   Tasks are scripts (js/script.js step format) with inputs and example sentences: see docs/agent-tasks.md.
   Loaded after agent.js.
   ============================================================ */
// The steps the editor offers: what each needs, read from and written to the script step ({ do, value, args, as }).
const TASK_STEPS = {
  'agent.open': { name: 'Open a page', icon: 'globe', fields: [['value', 'Web address', 'https://outlook.office.com/mail/inbox'], ['wait', 'Wait until this shows (CSS selector, optional)', '[role="listbox"]'], ['site', 'Site name (to ask you to sign in)', 'Outlook']] },
  'agent.wait': { name: 'Wait for something', icon: 'clock', fields: [['value', 'CSS selector', '[role="main"]'], ['text', 'or this text', ''], ['ms', 'At most (ms)', '10000']] },
  'agent.click': { name: 'Click', icon: 'locate', fields: [['value', 'The text on it', 'Send'], ['sel', 'or a CSS selector (|| between choices)', 'button[aria-label="Send"]']] },
  'agent.type': { name: 'Type into a field', icon: 'keypad', fields: [['value', 'The field’s label or placeholder', 'Search'], ['text', 'What to type ({input} words allowed)', '{person}'], ['enter', 'Press Enter after', 'check'], ['sel', 'or a CSS selector', '']] },
  'agent.key': { name: 'Press a key', icon: 'keypad', fields: [['value', 'Key', 'Enter'], ['sel', 'Focus this first (CSS selector, optional)', '']] },
  'agent.read': { name: 'Read part of the page', icon: 'doc', as: 'read', fields: [['value', 'What to read (CSS selectors, || between; the whole page if none fit)', '[role="main"]'], ['keep', 'Only lines with these words (optional, || between)', 'Unread']] },
  'ai.card': { name: 'Make the answer card (the model)', icon: 'star', as: 'card', fields: [['value', 'What to tell me', 'Sum up the unread emails: who and what they want'], ['from', 'From', '{read}'], ['as', 'Keep it as (card = the answer; another name to put cards together)', 'card']] },
  'card.join': { name: 'Put cards together', icon: 'grid', as: 'card', fields: [['value', 'Headline (empty: the counts)', ''], ['inputs', 'One line per source: Label=card name', 'WhatsApp=wa_card\nSlack=slack_card']] },
  'agent.task': { name: 'Run another task', icon: 'grid', fields: [['value', 'Task', '', 'task'], ['inputs', 'Its inputs (name=value, one a line)', 'person={person}']] },
  'wait': { name: 'Pause', icon: 'clock', fields: [['value', 'Seconds', '2']] },
  'agent.confirm': { name: 'Ask yes or no', icon: 'alert', fields: [['value', 'The question (values read so far allowed)', 'Priya said “{last}”. Send “{message}”?']] },
  'agent.fail': { name: 'Stop with a message', icon: 'alert', fields: [['value', 'What to say', 'I couldn’t find that.']] },
  'say': { name: 'Say something', icon: 'speaker', fields: [['value', 'What to say ({input} words allowed)', 'Looking now.']] },
  'raw': { name: 'Advanced step (JSON)', icon: 'sliders', fields: [['json', 'The step as JSON (if, set, repeat or any action)', '{"if": "{read} is empty", "then": [{"do": "agent.fail", "value": "Nothing there"}]}']] },
};
const stepArgs = s => { const o = { rest: [], order: [] }; for (const a of s.args || []) { const t = String(a), i = t.indexOf('='); if (!t.startsWith('?') && i > 0 && /^(wait|site|ms|sel|text|keep)$/.test(t.slice(0, i))) { o[t.slice(0, i)] = t.slice(i + 1); o.order.push(t.slice(0, i)); } else if (t === 'enter') o.enter = true; else o.rest.push(t); } return o; };
/** A script step → the editor's fields. */
function stepFields(s) {
  if (s.say != null && !s.do) return { type: 'say', value: s.say };
  if (!s.do) return { type: 'raw', json: JSON.stringify(s) }; // if / set / repeat…: kept as written
  const a = stepArgs(s), f = { type: s.do, value: s.value ?? '', as: s.as || '' };
  if (s.do === 'agent.type') { f.text = a.rest.shift() ?? ''; f.enter = !!a.enter; f.sel = a.sel || ''; }
  else if (s.do === 'ai.card') f.from = a.rest.shift() ?? '{read}';
  else if (s.do === 'agent.task' || s.do === 'card.join') f.inputs = a.rest.join('\n');
  else Object.assign(f, { wait: a.wait || '', site: a.site || '', ms: a.ms || '', sel: a.sel || '', text: a.text || '', keep: a.keep || '', order: a.order });
  f.more = (s.do === 'agent.task' || s.do === 'card.join' || s.do === 'ai.card' || s.do === 'agent.type') ? '' : a.rest.join('\n'); // ?name=value address inputs and others
  return f;
}
/** The editor's fields → a script step. */
function fieldsStep(f) {
  if (f.type === 'say') return { say: f.value };
  if (f.type === 'raw') { try { return JSON.parse(f.json || '{}'); } catch { toast('An advanced step isn’t valid JSON: kept as it was'); return { say: '' }; } }
  const s = { do: f.type, ...(f.value !== '' && f.value != null ? { value: f.value } : {}) }, args = [], more = String(f.more || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (f.type === 'agent.type') { args.push(f.text || ''); if (f.enter) args.push('enter'); if (f.sel) args.push(`sel=${f.sel}`); }
  else if (f.type === 'ai.card') args.push(f.from || '{read}');
  else if (f.type === 'agent.task' || f.type === 'card.join') args.push(...String(f.inputs || '').split('\n').map(x => x.trim()).filter(Boolean));
  else for (const k of [...new Set([...(f.order || []), 'wait', 'site', 'ms', 'sel', 'text', 'keep'])]) if (f[k]) args.push(`${k}=${f[k]}`); // in the order they were written
  args.push(...more); if (args.length) s.args = args;
  const as = f.as || TASK_STEPS[f.type]?.as; if (as) s.as = as;
  return s;
}

const TaskUI = {
  draft: null, editId: null,
  /** The Agent tasks section of Settings › Scripts & tasks. */
  listHtml() {
    const desk = AgentWeb.can(), mine = new Set(Agent.mine().map(t => t.id)), groups = {};
    for (const t of Agent.all().filter(t => !t.remoteOnly)) (groups[t.group || 'Mine'] ||= []).push(t);
    const ic = (n, label, attr) => `<button class="icon-btn" ${attr} aria-label="${esc(label)}" title="${esc(label)}">${svg(n)}</button>`;
    return `<p class="se-note">Tasks are what the agent does when you ask in your own words (“summarise my unread mail”). Each is a short list of steps on a web page or your Mac, with inputs filled from what you said. Scripts are presentations and longer sequences; a task can run a script, and a script step can run a task. <button class="link-btn" data-tui="guide">The step-by-step guide</button></p>
      <div class="chip-row"><button class="chip accent" data-tui="guided">${svg('plus')}New task (guided)</button>${desk ? `<button class="chip" data-tui="teach"><i class="rec-dot"></i>Teach me</button>` : ''}<button class="chip" data-tui="blank">${svg('plus')}Blank task</button></div>
      ${Object.entries(groups).map(([g, l]) => `<p class="se-note"><b>${esc(g)}</b></p>${l.map(t => `<div class="sui-item"><div class="main"><div class="t">${esc(t.name)} ${t.acts ? '<span class="ag-tag">acts</span>' : ''}${mine.has(t.id) && AGENT_TASKS.some(b => b.id === t.id) ? '<span class="ag-tag">edited</span>' : ''}${t.share ? '<span class="ag-tag on">shared</span>' : ''}</div><div class="s">“${esc((t.examples || [])[0] || '')}”</div></div>
        ${ic('play', 'Run (watch it)', `data-tui="run:${esc(t.id)}"`)}${ic('sliders', 'Edit', `data-tui="edit:${esc(t.id)}"`)}${mine.has(t.id) ? ic('del', AGENT_TASKS.some(b => b.id === t.id) ? 'Reset to the built-in task' : 'Delete', `data-tui="del:${esc(t.id)}"`) : ''}</div>`).join('')}`).join('')}`;
  },
  open(id) {
    const t = id ? Agent.get(id) : null;
    this.editId = id || null;
    this.draft = t ? JSON.parse(JSON.stringify(t)) : { id: `my.${Date.now().toString(36)}`, name: 'New task', group: 'Mine', runs: AgentWeb.can() ? 'mac' : 'here', examples: [], params: {}, steps: [] };
    this.draft.steps = (this.draft.steps || []).map(stepFields);
    ScriptUI.page = 'task'; ScriptUI.shown = true; if (current !== 'settings') openView('settings'); else renderSettings();
  },
  /** The editor (Settings, in place of the script list). */
  render() {
    const d = this.draft, P = Agent.params({ ...d, steps: [] }), ins = Object.keys({ ...P, ...Object.fromEntries((JSON.stringify(d.steps).match(/\{(\w+)\}/g) || []).map(x => [x.slice(1, -1), 1])) }).filter(k => !/^(read|card|outlook|time|date)$/.test(k) && !/_(email|phone)$/.test(k));
    const field = (i, [k, label, ph, kind]) => {
      const v = d.steps[i][k] ?? '';
      if (ph === 'check') return `<label class="se-check"><input type="checkbox" data-tf="${i}:${k}" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
      if (kind === 'task') return `<label class="se-field"><span>${esc(label)}</span><select data-tf="${i}:${k}">${Agent.all().filter(t => t.id !== d.id).map(t => `<option value="${esc(t.id)}" ${t.id === v ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`;
      const big = k === 'inputs' || k === 'more' || k === 'json' || (k === 'value' && d.steps[i].type === 'ai.card');
      return `<label class="se-field"><span>${esc(label)}</span>${big ? `<textarea rows="2" data-tf="${i}:${k}" placeholder="${esc(ph)}">${esc(v)}</textarea>` : `<input data-tf="${i}:${k}" value="${esc(v)}" placeholder="${esc(ph)}" autocapitalize="off">`}</label>`;
    };
    const card = (s, i) => { const T = TASK_STEPS[s.type] || { name: s.type, icon: 'grid', fields: [['value', 'Value', '']] };
      return `<div class="te-step"><div class="te-step-h"><span class="te-n">${i + 1}</span>${svg(T.icon)}<b>${esc(T.name)}</b><span class="te-sp"></span>
        <button class="icon-btn" data-tui="up:${i}" aria-label="Move up" ${i ? '' : 'disabled'}>${svg('chevUp')}</button><button class="icon-btn" data-tui="down:${i}" aria-label="Move down" ${i < d.steps.length - 1 ? '' : 'disabled'}>${svg('chevDown')}</button><button class="icon-btn" data-tui="rm:${i}" aria-label="Remove">${svg('del')}</button></div>
        ${T.fields.map(f => field(i, f)).join('')}${!['say', 'agent.task', 'card.join', 'ai.card', 'agent.type', 'raw'].includes(s.type) ? `<details class="te-more"><summary>More inputs</summary>${field(i, ['more', 'One a line (e.g. ?q={topic} adds to the address)', ''])}</details>` : ''}</div>`; };
    $('#settingsBody').innerHTML = `<div class="te">
      <div class="te-top"><button class="chip" data-tui="back">${svg('back')} Tasks</button><span class="te-sp"></span>${AgentWeb.can() ? `<button class="chip" data-tui="teachmore"><i class="rec-dot"></i>Teach more steps</button>` : ''}<button class="chip" data-tui="test">${svg('play')} Test (watch)</button><button class="chip accent" data-tui="save">Save</button></div>
      <label class="se-field"><span>Name</span><input data-td="name" value="${esc(d.name)}"></label>
      <label class="se-field"><span>Ways to ask (one a line; {words} in braces become inputs)</span><textarea rows="3" data-td="examples" placeholder="read the mail from {person}">${esc((d.examples || []).join('\n'))}</textarea></label>
      ${ins.length ? `<div class="se-field"><span>Inputs</span>${ins.map(k => `<div class="te-in"><b>{${esc(k)}}</b><input data-tp="${esc(k)}:ask" value="${esc(d.params?.[k]?.ask || '')}" placeholder="Question when it's missing, e.g. From whom?"><input data-tp="${esc(k)}:default" value="${esc(d.params?.[k]?.default ?? '')}" placeholder="Default (optional)"><input data-tv="${esc(k)}" value="${esc(d.test?.[k] ?? '')}" placeholder="Test value, e.g. Priya"><label class="se-check"><input type="checkbox" data-tp="${esc(k)}:person" ${d.params?.[k]?.type === 'person' ? 'checked' : ''}> a person (email/number from People)</label></div>`).join('')}</div>` : ''}
      <div class="chip-row"><label class="se-check"><input type="checkbox" data-td="acts" ${d.acts ? 'checked' : ''}> It acts for me (sends, books, posts): ask before running</label>
        <label class="se-check"><input type="checkbox" data-td="mac" ${d.runs === 'mac' ? 'checked' : ''}> Runs on my Mac (its agent browser)</label>
        ${LINK_HOST ? `<label class="se-check"><input type="checkbox" data-td="share" ${d.share ? 'checked' : ''}> Share in the mesh</label>` : ''}</div>
      ${d.runs === 'mac' && typeof Containers !== 'undefined' ? `<label class="se-field"><span>Container (whose sign-ins it uses)</span><select data-td="container"><option value="">By site (Agent › Library › Settings › Containers)</option>${Containers.all().map(c => `<option value="${esc(c.id)}"${d.container === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      ${d.acts ? `<label class="se-field"><span>Question before acting (inputs allowed; “Shall I …?” is added)</span><input data-td="confirm" value="${esc(d.confirm || '')}" placeholder="send “{message}” to {person}"></label>` : ''}
      <p class="se-note"><b>Steps</b> · run in order; the answer is the last “Make the answer card” (or what a step keeps as {card}).</p>
      <div class="te-steps">${d.steps.map(card).join('') || '<p class="se-empty">No steps yet: Teach me, or add one.</p>'}</div>
      <div class="chip-row te-add">${Object.entries(TASK_STEPS).map(([k, T]) => `<button class="chip" data-tui="add:${k}">${svg(T.icon)} ${esc(T.name)}</button>`).join('')}</div></div>`;
  },
  /** Collect the form into the draft. */
  read() {
    const d = this.draft; if (!d || !$('#settingsBody .te')) return d;
    for (const el of $$('[data-td]')) { const k = el.dataset.td;
      if (k === 'examples') d.examples = el.value.split('\n').map(x => x.trim()).filter(Boolean);
      else if (k === 'acts' || k === 'share') d[k] = el.checked; else if (k === 'mac') d.runs = el.checked ? 'mac' : 'here'; else d[k] = el.value; }
    for (const el of $$('[data-tf]')) { const [i, k] = el.dataset.tf.split(':'); d.steps[+i][k] = el.type === 'checkbox' ? el.checked : el.value; }
    d.test ||= {}; for (const el of $$('[data-tv]')) { if (el.value.trim()) d.test[el.dataset.tv] = el.value.trim(); else delete d.test[el.dataset.tv]; }
    d.params ||= {}; for (const el of $$('[data-tp]')) { const [k, f] = el.dataset.tp.split(':'); const p = (d.params[k] ||= {});
      if (f === 'person') { if (el.checked) p.type = 'person'; else delete p.type; } else if (el.value) p[f] = el.value; else delete p[f]; }
    return d;
  },
  task() { const d = this.read(); return { ...d, steps: d.steps.map(fieldsStep) }; },
  save(quiet) {
    const t = this.task(); if (!t.name.trim()) return toast('A name, please'); if (!t.examples.length) return toast('At least one way to ask, please');
    Agent.put(t); this.editId = t.id; if (!quiet) toast('Saved'); if (typeof Mesh !== 'undefined') Mesh.pres?.();
  },
  /** The inputs a task takes, then a form to fill them for a run (prefilled with its test values); runs it, watched. */
  inputsOf(t) { return Object.entries(Agent.params(t)).map(([k, p]) => ({ k, ...p })); },
  runForm(t, saveBack) {
    const ins = this.inputsOf(t), go = vals => { AgentWatch.force = true; Agent.start(t, vals, {}).finally(() => { AgentWatch.force = false; }); };
    if (!ins.length) return go({});
    sheet(`Test: ${t.name}`, `<p class="se-note">The values to run it with (as if you had said them). They’re kept as the task’s test values for next time.</p>
      ${ins.map(p => `<label class="se-field te-run"><span>{${esc(p.k)}}${p.ask ? ` · ${esc(p.ask)}` : ''}${p.optional || p.default != null ? ' (optional)' : ''}</span><input data-trun="${esc(p.k)}" value="${esc(t.test?.[p.k] ?? '')}" placeholder="${esc(p.default ?? '')}" autocapitalize="off"></label>`).join('')}`,
      [['Run (watch)', () => {
        const vals = {}; for (const el of $$('[data-trun]')) if (el.value.trim()) vals[el.dataset.trun] = el.value.trim();
        const miss = ins.find(p => !vals[p.k] && !p.optional && p.default == null); if (miss) { toast(`A value for {${miss.k}}, please`); return false; }
        saveBack?.(vals); go(vals);
      }], ['Cancel']]);
  },
  async test() {
    const t = this.task();
    this.runForm(t, vals => { for (const [k, v] of Object.entries(vals)) { const el = $(`[data-tv="${CSS.escape(k)}"]`); if (el) el.value = v; } // the editor's boxes too, so the form's values win
      const next = this.task(); if (this.editId) Agent.put(next); this.render(); });
  },
  cmd(c) {
    const [k, ...r] = c.split(':'), v = r.join(':'), d = this.draft;
    if (k === 'back') { this.draft = null; ScriptUI.page = 'list'; return renderSettings(); }
    if (k === 'save') return this.save();
    if (k === 'test') return this.test();
    if (k === 'edit') return this.open(v);
    if (k === 'run') { const t = Agent.get(v); return t && this.runForm(t, vals => { if (Agent.mine().some(x => x.id === t.id)) Agent.put({ ...t, test: { ...(t.test || {}), ...vals } }); }); }
    if (k === 'del') { const built = AGENT_TASKS.some(b => b.id === v); return sheet(built ? 'Reset this task?' : 'Delete this task?', `<p>${built ? 'Your changes go and the built-in task comes back.' : 'It can’t be undone.'}</p>`, [[built ? 'Reset' : 'Delete', () => { Agent.del(v); renderSettings(); }], ['Cancel']]); }
    if (k === 'guide') return openExternal('', 'https://vchahalibm.github.io/CarPWA/docs/scripts-and-tasks-guide.html');
    if (k === 'guided') return TaskTeach.wizard();
    if (k === 'teach') return TaskTeach.wizard(true);
    if (k === 'blank') return this.open();
    this.read();
    if (k === 'teachmore') return TaskTeach.start(null, { append: true });
    if (k === 'add') { d.steps.push({ type: v, value: '', as: TASK_STEPS[v]?.as || '' }); return this.render(); }
    if (k === 'rm') { d.steps.splice(+v, 1); return this.render(); }
    if (k === 'up' || k === 'down') { const i = +v, j = k === 'up' ? i - 1 : i + 1; [d.steps[i], d.steps[j]] = [d.steps[j], d.steps[i]]; return this.render(); }
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-tui]'); if (!b) return; e.stopPropagation(); TaskUI.cmd(b.dataset.tui); }, true);

/* ---------- Teach me: you do it in the agent browser, it becomes steps ---------- */
const TaskTeach = {
  on: false, steps: [], start0: '', typed: [], append: false,
  /** The guided way in: a name, how you'll ask, and where it starts (or another way to get it done). */
  wizard(teach) {
    const desk = AgentWeb.can();
    sheet(teach ? 'Teach me a task' : 'New task', `<label class="se-field"><span>What should I call it?</span><input id="ttName" placeholder="Read my latest Outlook mail"></label>
      <label class="se-field"><span>How will you ask? (one a line; {words} become inputs)</span><textarea id="ttAsk" rows="2" placeholder="read my latest mail&#10;read the mail from {person}"></textarea></label>
      <label class="se-field"><span>How does it get done?</span><select id="ttHow">${[...(desk ? [['teach', 'I’ll show you (Teach me, in the agent browser)']] : []), ['page', 'Read a web page and answer'], ['tasks', 'Run other tasks in order'], ['script', 'Run one of my scripts'], ['blank', 'I’ll add the steps myself']].map(([v, l]) => `<option value="${v}" ${teach && v === 'teach' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="se-field" id="ttUrlF"><span>Start at (web address)</span><input id="ttUrl" placeholder="https://outlook.office.com/mail/inbox" autocapitalize="off"></label>`,
      [['Next', () => this.fromWizard()], ['Cancel']]);
  },
  fromWizard() {
    const name = $('#ttName').value.trim() || 'New task', ask = $('#ttAsk').value.split('\n').map(x => x.trim()).filter(Boolean), how = $('#ttHow').value, url = $('#ttUrl').value.trim();
    const d = { id: `my.${Date.now().toString(36)}`, name, group: 'Mine', runs: AgentWeb.can() ? 'mac' : 'here', examples: ask.length ? ask : [name.toLowerCase()], params: {}, steps: [] };
    if (how === 'page') { if (!/^https?:\/\//.test(url)) return toast('The address should start with https://'); d.steps = [{ do: 'agent.open', value: url, args: ['wait=body'] }, { do: 'wait', value: '2' }, { do: 'agent.read', value: 'main||body', as: 'read' }, { do: 'ai.card', value: `Tell me ${name}`, args: ['{read}'], as: 'card' }]; }
    if (how === 'script') d.steps = [{ do: 'script.run', value: Scripts.all()[0]?.name || '' }, { set: 'card', value: '{"type":"status","headline":"Running the script"}' }];
    if (how === 'tasks') d.steps = [{ do: 'agent.task', value: 'cal.today', as: 'day' }, { set: 'card', value: '{"type":"none"}' }];
    TaskUI.editId = null; TaskUI.draft = { ...d, steps: d.steps.map(stepFields) }; ScriptUI.page = 'task'; ScriptUI.shown = true;
    if (current !== 'settings') openView('settings'); else renderSettings();
    if (how === 'teach') { if (!/^https?:\/\//.test(url)) return toast('Where does it start? Add the web address, then Teach me again'); this.start(url); }
  },
  /** Start recording in the agent browser at `url` (or where it is, to add steps). */
  async start(url, o = {}) {
    if (!AgentWeb.can()) return toast('Teach me needs StudioGen on a Mac');
    this.on = true; this.steps = []; this.typed = []; this.append = !!o.append; this.start0 = url || AgentWeb.url();
    AgentWeb.show(true); this.bar(true);
    if (url) await AgentWeb.go(url);
    await AgentWeb.call('record', [true]);
    toast('Teaching: click and type as you would. Read this part when the answer is on screen, then Done.');
  },
  bar(on) {
    const box = $('#agentWeb'); if (!box) return; let b = $('.ag-teach', box);
    if (!on) return b?.remove();
    if (!b) { box.querySelector('.ag-web-bar').insertAdjacentHTML('afterend', `<div class="ag-teach"><i class="rec-dot"></i><span class="ag-teach-n">Teaching: 0 steps</span><span class="te-sp"></span><button class="chip" data-teach="read">Read this part</button><button class="chip accent" data-teach="done">Done</button><button class="chip" data-teach="cancel">Cancel</button></div>`); b = $('.ag-teach', box); }
  },
  count() { const n = $('#agentWeb .ag-teach-n'); if (n) n.textContent = `Teaching: ${this.steps.length} step${this.steps.length === 1 ? '' : 's'}`; },
  /** A recorded step from the page (the bridge's recorder). */
  step(s) {
    if (!this.on || !s?.loc) return; const L = s.loc;
    const sel = L.testid ? `[data-testid="${L.testid}"]` : L.id && !/\d{4,}/.test(L.id) ? `#${L.id}` : L.css || '';
    // a row of a list (a mail, a chat): its text changes every time, so it's found by its place, not its words
    const row = /^(option|listitem|row|gridcell|treeitem|article)$/.test(L.role || '') || /role=(option|listitem|row|treeitem)|\[role="?(option|row)/.test(sel);
    if (s.t === 'click') this.steps.push({ do: 'agent.click', value: !row && (L.text || '').length <= 40 ? L.text || '' : '', args: sel ? [`sel=${sel}`] : [] });
    else if (s.t === 'type') {
      if (s.secret) { toast('Password and code fields aren’t recorded: sign in once in the agent browser instead'); return; }
      const last = this.steps.at(-1); if (last?.do === 'agent.click' && last.args?.[0] === `sel=${sel}`) this.steps.pop(); // the click that focused it
      this.steps.push({ do: 'agent.type', value: L.text || L.name || '', args: [s.value || '', ...(sel ? [`sel=${sel}`] : [])] }); this.typed.push({ i: this.steps.length - 1, label: L.text || L.name || 'text', value: s.value || '' });
    }
    this.count();
  },
  /** A new page loaded in the agent browser: keep recording there. */
  page() { if (this.on) AgentWeb.call('record', [true]); },
  async read() {
    toast('Click the part to read (the list, the message…)');
    const r = await AgentWeb.call('pick', [120000], 125000);
    if (!r.ok) return toast('Nothing picked');
    const role = r.role ? `[role="${r.role}"]` : ''; this.steps.push({ do: 'agent.wait', value: role || r.css, args: ['ms=10000'] }, { do: 'agent.read', value: [role, r.css].filter(Boolean).join('||'), as: 'read' }); this.count();
    toast(`Will read: ${r.text.slice(0, 60)}…`);
  },
  async done(cancel) {
    this.on = false; AgentWeb.call('record', [false], 3000); this.bar(false); AgentWeb.show(false); // no waiting on the page
    if (cancel) return toast('Teaching cancelled');
    const d = TaskUI.read() || TaskUI.draft; if (!d) return;
    const host = (() => { try { return new URL(this.start0).hostname; } catch { return ''; } })();
    const first = this.append || !this.start0 ? [] : [{ do: 'agent.open', value: this.start0, args: [`site=${host.replace(/^www\./, '').split('.')[0]}`, 'wait=body'] }, { do: 'wait', value: '2' }];
    const recorded = [...first, ...this.steps.flatMap(s => s.do === 'agent.click' ? [s, { do: 'wait', value: '1.5' }] : [s])];
    // The guided finish: what to tell you, and which typed words change each time (they become inputs).
    sheet('Finish teaching', `<p class="se-note">${this.steps.length} steps recorded.</p>
      ${recorded.some(s => s.do === 'agent.read') ? `<label class="se-field"><span>What should I tell you from what I read?</span><input id="tfAsk" value="Sum it up: who, what and anything they ask for"></label>` : '<p class="se-note">Nothing marked to read: it just does the steps. (Teach more steps and use Read this part to get an answer.)</p>'}
      ${this.typed.length ? `<p class="se-note"><b>Words you typed</b>: should I ask for them each time?</p>${this.typed.map((t, k) => `<div class="te-in"><label class="se-check"><input type="checkbox" data-tt="${k}" ${k === 0 ? 'checked' : ''}> “${esc(t.value)}” in ${esc(t.label)} → </label><input data-ttn="${k}" value="${esc(plain(t.label).split(' ')[0] || 'text')}" placeholder="input name"></div>`).join('')}` : ''}`,
      [['Add the steps', () => {
        const ask = $('#tfAsk')?.value.trim();
        for (const [k, t] of this.typed.entries()) if ($(`[data-tt="${k}"]`)?.checked) {
          const name = ($(`[data-ttn="${k}"]`).value || 'text').replace(/\W/g, '') || 'text'; d.params ||= {};
          const st = recorded.find(s => s.do === 'agent.type' && s.args?.[0] === t.value); if (st) st.args[0] = `{${name}}`;
          d.params[name] = { ask: `What ${t.label.toLowerCase()}?` };
          if (!d.examples.some(e => e.includes(`{${name}}`))) d.examples.push(`${d.name.toLowerCase()} {${name}}`);
        }
        if (ask && recorded.some(s => s.do === 'agent.read')) recorded.push({ do: 'ai.card', value: ask, args: ['{read}'], as: 'card' });
        d.steps.push(...recorded.map(stepFields)); TaskUI.draft = d; ScriptUI.page = 'task'; renderSettings(); toast('Steps added: Test (watch) to try it, then Save');
      }], ['Discard']]);
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-teach]'); if (!b) return; e.stopPropagation(); const k = b.dataset.teach; if (k === 'read') TaskTeach.read(); else TaskTeach.done(k === 'cancel'); }, true);
// “It acts for me” shows the question to ask before acting: redraw when it changes.
document.addEventListener('change', e => { if (e.target.matches?.('[data-td="acts"]') && TaskUI.draft) { TaskUI.read(); TaskUI.render(); } });
