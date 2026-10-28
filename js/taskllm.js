'use strict';
/* ============================================================
   Build with an LLM (Settings › Scripts & tasks): copy the build prompt (docs/llm/build-prompt.md) into Claude or another
   LLM, which interviews you and writes a task or script as JSON; paste or import it here. It's checked (format, inputs,
   steps), then a task gets a check run on the real page: each step in turn, watched, with its test values; a step that
   would send or post only checks its button or field is there. A step that fails gets “Show me”: point at the right
   thing on the page and its selector is replaced, then it checks again.
   Keep docs/llm/build-prompt.md and docs/scripts-and-tasks-guide.html in step with what tasks and scripts can do.
   Loaded after taskedit.js.
   ============================================================ */
const LOGIC_KEYS = ['say', 'set', 'if', 'each', 'repeat', 'until', 'wait', 'await', 'goto', 'stop', 'intent'];
const TaskLLM = {
  last: null, // { task, results }
  sectionHtml() {
    return `${typeof BuildCard !== 'undefined' ? BuildCard.html() : ''}
      <p class="se-note"><b>Or in any chat or terminal:</b> copy the prompt, paste it into the LLM, answer its questions, then paste its JSON here. Tasks are checked on the real page step by step; a step that doesn't find its target gets <b>Show me</b>.</p>
      <div class="chip-row"><button class="chip accent" data-tllm="copy">${svg('doc')} Copy the prompt</button><button class="chip" data-tllm="file">${svg('upload')} Import a file</button></div>
      <label class="se-field te-run"><span>Paste what the LLM wrote</span><textarea id="tllmIn" rows="5" placeholder='{ "format": "studiogen-task", "version": 1, "task": { … } }'></textarea></label>
      <div class="chip-row"><button class="chip accent" data-tllm="import">Import</button></div>
`;
  },
  async prompt() {
    for (const u of ['docs/llm/build-prompt.md', 'https://vchahalibm.github.io/CarPWA/docs/llm/build-prompt.md']) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.text(); } catch {} }
    throw new Error('The prompt isn’t available offline here');
  },
  async copy() {
    try { const t = await this.prompt(); await navigator.clipboard.writeText(t); toast(`Prompt copied (${Math.round(t.length / 1000)}k characters): paste it into the LLM`); }
    catch (e) { toast(e.message); }
  },
  /** The JSON in what the LLM wrote (code fences and words around it are fine). */
  parse(text) {
    const t = String(text || ''), fence = t.match(/```(?:json)?\s*([\s\S]*?)```/), body = fence ? fence[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
    try { return JSON.parse(body); } catch (e) { throw new Error(`That isn’t valid JSON (${e.message.replace(/^JSON\.parse: /, '')})`); }
  },
  /** Problems with a task: errors stop the import, warnings are shown. */
  checkTask(t) {
    const errors = [], warnings = [];
    if (!t || typeof t !== 'object') return { errors: ['No task in it'], warnings };
    if (!t.name) errors.push('It has no name');
    if (!Array.isArray(t.steps) || !t.steps.length) errors.push('It has no steps');
    if (!Array.isArray(t.examples) || !t.examples.length) errors.push('It has no ways to ask');
    const said = new Set((t.examples || []).flatMap(e => [...String(e).matchAll(/\{(\w+)\}/g)].map(m => m[1]))), P = t.params || {};
    for (const k of said) if (!P[k]) warnings.push(`{${k}} is in a way to ask but not an input: added with a question`);
    for (const k of Object.keys(P)) if (!said.has(k) && P[k].default == null && !P[k].optional) warnings.push(`Input {${k}} isn’t in any way to ask: it will always be asked for`);
    const conds = JSON.stringify(t.steps || []).match(/"if":"[^"]*"/g)?.join(' ') || '';
    const walk = (l, where) => (l || []).forEach((s, i) => {
      if (!s || typeof s !== 'object') return errors.push(`${where} ${i + 1}: not a step`);
      if (s.do) { if (!Actions.list[s.do]) errors.push(`${where} ${i + 1}: unknown step “${s.do}”`); }
      else if (!LOGIC_KEYS.some(k => k in s)) errors.push(`${where} ${i + 1}: not a step this app knows`);
      for (const k of ['then', 'else', 'steps']) if (Array.isArray(s[k])) walk(s[k], `${where} ${i + 1} ›`);
      if (s.do === 'agent.task' && !Agent.get(s.value)) warnings.push(`${where} ${i + 1}: runs a task “${s.value}” that isn’t here`);
      // a click whose result an if tests must not stop the task on a miss (fixed here: LLMs often leave optional out)
      if (s.do === 'agent.click' && s.as && conds.includes(`{${s.as}}`) && !(s.args || []).includes('optional')) { (s.args ||= []).push('optional'); warnings.push(`${where} ${i + 1}: made the click optional so the task’s own message is used when it misses`); }
      if (s.do === 'ai.card' && String(s.value || '').length > 600) warnings.push(`${where} ${i + 1}: a long card request; the on-device model follows 2–4 short sentences best`);
    });
    walk(t.steps, 'Step');
    const asksInSteps = JSON.stringify(t.steps || []).includes('"agent.confirm"');
    if (t.acts && !t.confirm && !asksInSteps) warnings.push('It acts for you but has no question to ask first: its name is used');
    // the question before acting is asked before any step runs: only inputs are known then
    const unknown = [...String(t.confirm || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => !P[k] && !said.has(k));
    if (unknown.length) warnings.push(`The question before acting uses ${unknown.map(k => `{${k}}`).join(', ')}, which isn’t known until the task runs: ask with an “Ask yes or no” step after reading it instead`);
    for (const e of t.examples || []) { const o = Agent.all().find(x => x.id !== t.id && (x.examples || []).some(y => plain(y) === plain(e))); if (o) warnings.push(`“${e}” is also how you ask for “${o.name}”: change one of them`); }
    return { errors, warnings };
  },
  /** Import what an LLM wrote. With `opt.auto` (the builder, js/taskbuild.js) a task goes straight to its check run and
      the results go to `opt.onReport(last)` instead of sheets; problems to `opt.onError(list)`. */
  import(text, opt = {}) {
    let o; try { o = this.parse(text); } catch (e) { return opt.auto ? opt.onError?.([e.message]) : sheet('Didn’t import', `<p>${esc(e.message)}</p>`, [['Close']]); }
    const kind = o.format === 'studiogen-script' || o.script || o.beats || o.intents ? 'script' : 'task';
    if (kind === 'script') {
      const s = o.script || o, chk = scriptCheck(s);
      if (chk.errors.length && opt.auto) return opt.onError?.(chk.errors.map(e => e.msg || e));
      if (chk.errors.length) return sheet('The script has problems', `<ul>${chk.errors.map(e => `<li>${esc(e.msg || e)}</li>`).join('')}</ul>`, [['Close']]);
      const saved = Scripts.add(s); toast(`Imported the script “${saved.name}”`); opt.onScript?.(saved); return ScriptUI.edit(saved.id, JSON.parse(JSON.stringify(saved.json)));
    }
    const t = o.task || o, chk = this.checkTask(t);
    if (chk.errors.length && opt.auto) return opt.onError?.(chk.errors);
    if (chk.errors.length) return sheet('The task has problems', `<ul>${chk.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul><p class="se-note">Ask the LLM to fix these, or paste it again.</p>`, [['Close']]);
    t.params ||= {}; for (const k of new Set((t.examples || []).flatMap(e => [...String(e).matchAll(/\{(\w+)\}/g)].map(m => m[1])))) t.params[k] ||= { ask: `What ${k}?` };
    t.id = !t.id || Agent.get(t.id) ? `my.${Date.now().toString(36)}` : String(t.id).startsWith('my.') ? t.id : `my.${t.id}`;
    t.group ||= 'Mine'; t.runs ||= /"agent\./.test(JSON.stringify(t.steps)) ? 'mac' : 'here';
    this.last = { task: t, verify: o.verify || [], results: null, warnings: chk.warnings, opt };
    if (opt.auto) return AgentWeb.can() ? this.check(t) : opt.onReport?.(this.last); // no agent browser here: saved unchecked
    sheet(`Imported: ${t.name}`, `<p class="se-note">${t.steps.length} steps · asked as “${esc(t.examples[0])}”${Object.keys(t.params).length ? ` · inputs ${Object.keys(t.params).map(k => `{${esc(k)}}`).join(', ')}` : ''}${t.acts ? ' · acts for you (asked first)' : ''}</p>
      ${chk.warnings.length ? `<ul class="se-note">${chk.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${(o.verify || []).length ? `<p class="se-note"><b>The LLM wasn’t sure of</b>: ${o.verify.map(v => `step ${esc(v.step)} (${esc(v.what || '')})`).join(', ')}. The check run tests them.</p>` : ''}
      <p>${AgentWeb.can() ? 'Next: a check run on the page, step by step (nothing is sent).' : 'Check runs need StudioGen on a Mac: it’s saved and can be checked there.'}</p>`,
      [...(AgentWeb.can() ? [['Check it now', () => this.check(t)]] : []), ['Open in the editor', () => { Agent.put(t); TaskUI.open(t.id); }], ['Save', () => { Agent.put(t); toast('Saved'); }], ['Cancel']]);
  },
  /** The inputs' values for a check run: the task's test values, else asked here. */
  values(t, then) {
    const P = Agent.params(t), need = Object.keys(P).filter(k => (t.test?.[k] ?? '') === '' && P[k].default == null && !P[k].optional);
    if (!need.length) return then({ ...t.test });
    sheet('Values to check it with', need.map(k => `<label class="se-field te-run"><span>{${esc(k)}}${P[k].ask ? ` · ${esc(P[k].ask)}` : ''}</span><input data-tchk="${esc(k)}" autocapitalize="off"></label>`).join(''),
      [['Check it', () => { const v = { ...t.test }; for (const el of $$('[data-tchk]')) if (el.value.trim()) v[el.dataset.tchk] = el.value.trim(); if (need.some(k => !v[k])) { toast('A value for each, please'); return false; } t.test = v; then(v); }], ['Cancel']]);
  },
  /** Each top-level step in turn on the real page (watched); stops at the first that fails. */
  check(t) {
    this.values(t, async vals => {
      const run = Agent.runner(t, vals); run.ctx.check = true; const results = [];
      AgentWatch.force = true; Agent.ctx = run.ctx; AgentWatch.begin(t, run.ctx); let failed = '';
      try {
        for (const [i, s] of t.steps.entries()) {
          if (failed) { results.push({ i, state: 'skip' }); continue; }
          await run.steps([s], { tok: 1 });
          if (run.ctx.failed) { failed = run.ctx.failed; results.push({ i, state: 'bad', why: failed }); } else results.push({ i, state: 'ok' });
        }
      } finally { Agent.ctx = null; AgentWatch.end(run.ctx, !failed, failed); AgentWatch.force = false; }
      this.last = { ...this.last, task: t, results, card: run.vars.card };
      Log.i('agent', `Check run: ${t.name}`, { results: results.map(r => r.state), failed });
      this.report();
    });
  },
  report() {
    const { task: t, results, card, opt } = this.last, ok = results.every(r => r.state === 'ok');
    if (AgentWeb.can()) { AgentWeb.watch(false); AgentWeb.show(false); } // the report lists the steps: the watch panel would cover it
    if (opt?.onReport) return opt.onReport(this.last);
    const name = s => this.stepName(s), fixable = s => this.fixable(s);
    sheet(ok ? 'Every step works' : 'A step needs you', `<ol class="tllm-res">${results.map(r => { const s = t.steps[r.i];
      return `<li class="${r.state}"><span>${esc(name(s))}</span>${r.why ? `<small>${esc(r.why)}</small>` : ''}${r.state === 'bad' && fixable(s) ? `<button class="chip accent" data-tllm="showme:${r.i}">Show me</button>` : ''}</li>`; }).join('')}</ol>
      ${ok && card?.headline ? `<p class="se-note">It would answer: <b>${esc(card.headline)}</b></p>` : ''}
      ${!ok ? '<p class="se-note">Show me opens the page where it stopped: click the right thing, and it checks again. Or open it in the editor.</p>' : ''}`,
      [...(ok ? [['Save', () => { Agent.put(t); toast(`Saved: say “${t.examples[0]}”`); }]] : [['Check again', () => this.check(t)]]), ['Open in the editor', () => { Agent.put(t); TaskUI.open(t.id); }], ['Close']]);
  },
  stepName: s => s.do ? AgentWatch.label(s.do, s.value, s) : s.say != null ? `Say “${String(s.say).slice(0, 40)}”` : Object.keys(s)[0] === 'set' ? `Remember {${s.set}}` : `${Object.keys(s)[0]} …`,
  fixable: s => ['agent.click', 'agent.type', 'agent.wait', 'agent.read', 'agent.key'].includes(s?.do),
  /** Point at the right element where the check stopped; its selector replaces the step's, then check again. */
  async showMe(i) {
    const t = this.last.task, s = t.steps[i]; closeSheet();
    AgentWeb.watch(false); AgentWeb.show(true);
    toast(s.do === 'agent.read' || s.do === 'agent.wait' ? 'Click the part it should read or wait for' : 'Click the thing it should click or type into');
    const r = await AgentWeb.call('pick', [120000, !(s.do === 'agent.read' || s.do === 'agent.wait')], 125000);
    AgentWeb.show(false);
    if (!r.ok) return toast('Nothing picked');
    const esc2 = v => v.replace(/"/g, '\\"');
    const sel = [r.testid ? `[data-qa="${esc2(r.testid)}"]` : '', r.label ? `[aria-label="${esc2(r.label)}"]` : '', r.css].filter(Boolean).join('||');
    if (s.do === 'agent.read' || s.do === 'agent.wait') s.value = sel;
    else { s.args = (s.args || []).filter(a => !String(a).startsWith('sel=')); s.args.push(`sel=${sel}`); }
    Log.i('agent', `Show me: step ${i + 1} now finds ${sel}`); toast('Got it: checking again');
    this.check(t);
  },
  file() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json,text/plain';
    inp.onchange = async () => { const f = inp.files[0]; if (f) this.import(await f.text()); }; inp.click();
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tllm]'); if (!b) return; e.stopPropagation();
  const [k, v] = b.dataset.tllm.split(':');
  if (k === 'copy') return TaskLLM.copy();
  if (k === 'file') return TaskLLM.file();
  if (k === 'import') return TaskLLM.import($('#tllmIn')?.value || '');
  if (k === 'showme') return TaskLLM.showMe(+v);
}, true);
