'use strict';
/* ============================================================
   Build with the Mac's model (Settings › Scripts & tasks › Build with an LLM). Apple's on-device model has a small
   context and writes poor selectors, so the build prompt is split into steps that feed each other:
   1) the model turns what you say into a plan: a name, ways to ask and up to three parts, each a tested building block
      (a library or own task, or reading a web page) with its inputs (`plan`, one call with a JSON schema);
   2) a form fills the gaps, test values in the “name is value” protocol (“person is Priya Nair”, `said`), the same
      protocol the Stage assistant will use when it builds tasks by voice;
   3) code assembles the task: an agent.task step per part, card.join when there are several (`assemble`), and it goes
      through TaskLLM.import and its check run like an LLM's task.
   Loaded after taskllm.js.
   ============================================================ */
const TASK_LABELS = { mail: 'Mail', cal: 'Calendar', slack: 'Slack', whatsapp: 'WhatsApp', teams: 'Teams', web: 'Web', car: 'Car', present: 'Presenting' };
const TaskLocal = {
  can() { return typeof MacAI !== 'undefined' && MacAI.can(); },
  /** The building blocks the model may pick: tasks (not ones only the Mac has) and reading a page. */
  blocks() {
    const P = t => Object.keys(Agent.params(t));
    return [...Agent.all().filter(t => !t.remoteOnly).map(t => ({ id: t.id, name: t.name, inputs: P(t), acts: !!t.acts })),
      { id: 'page', name: 'Read a web page and tell me something from it', inputs: ['url', 'ask'] }];
  },
  /** How well a block fits what was said: shared words with its name, id and ways to ask (sites count double, an acting
      block gains when the words ask to send). The small model picks badly from a long list, so it sees a shortlist. */
  score(said, b) {
    const SITE = /^(mail|whatsapp|slack|teams|calendar|outlook|web|page)$/, syn = { email: 'mail', emails: 'mail', inbox: 'mail', mails: 'mail', meeting: 'calendar', meetings: 'calendar', chats: 'chat', messages: 'message', website: 'page', site: 'page' };
    const words = t => new Set(plain(t).split(' ').map(w => syn[w] || w.replace(/(?<=\w{3})s$/, '')).filter(w => w.length > 2 && !STOP.has(w)));
    const t = Agent.get(b.id), have = words(`${b.id.replace(/\./g, ' ')} ${b.id.startsWith('cal.') ? 'calendar' : ''} ${b.name} ${(t?.examples || []).join(' ')} ${t?.about || ''}`);
    const want = words(said); let n = 0; for (const w of want) if (have.has(w)) n += SITE.test(w) ? 2 : 1;
    if (b.acts && /\b(send|reply|tell|post|message|text|write)\b/i.test(said)) n += 1.5; else if (b.acts) n -= 1;
    return n;
  },
  /** Step 1: what the user said → { name, examples, parts: [{ block, <input>: value }] }. */
  async plan(said) {
    const all = this.blocks().map(b => ({ ...b, score: this.score(said, b) })).sort((x, y) => y.score - x.score);
    const B = all.filter(b => b.score > 0).slice(0, 8); if (!B.length) return { name: '', examples: [], parts: [] };
    const names = [...new Set(B.flatMap(b => b.inputs))];
    const schema = { type: 'object', required: ['name', 'examples', 'parts'], properties: {
      name: { type: 'string', description: 'the task name, 2 to 5 words' },
      examples: { type: 'array', description: '3 to 5 short ways the user would ask for it; a word that changes each time is in braces, like {person}', items: { type: 'string' } },
      parts: { type: 'array', description: 'the building blocks that do it, in order, at most 3', items: { type: 'object', required: ['block'], properties: {
        block: { type: 'string', enum: B.map(b => b.id), description: 'a block id from the list' },
        ...Object.fromEntries(names.map(n => [n, { type: 'string', description: `the block's ${n} input if it has one: {${n}} when the user says it each time, else the fixed value, else empty` }])) } } } } };
    const instructions = 'You plan an agent task for the StudioGen app from what the user wants. Pick only the building blocks it needs, in order: usually one, one per thing the user names, at most 3; use only ids from the list. Fill the inputs each block lists: a value the user says each time is written in braces ({person}); a value that never changes is written as is. Ways to ask: short commands the user would say to run the whole task, with the same {names}.';
    const prompt = `Blocks (id: what it does; inputs):\n${B.map(b => `${b.id}: ${b.name}${b.inputs.length ? `; ${b.inputs.join(', ')}` : ''}`).join('\n')}\n\nThe user wants: ${said}`;
    const r = await MacAI.ask({ instructions, prompt, schema, temperature: 0.2, max: 600 });
    const j = JSON.parse(r.json || '{}');
    // keep only the inputs each block has (the model fills others too); one it left out is asked each time ({name});
    // a part that fits far worse than the best one is dropped (the model adds extras), and each block only once
    // and when the words name sites, a part from a site they don't name goes (the model adds acting blocks from other sites)
    const top = Math.max(...(j.parts || []).map(p => B.find(x => x.id === p.block)?.score || 0)), seen = new Set(), named = this.sites(said);
    j.parts = (j.parts || []).filter(p => { const b = B.find(x => x.id === p.block), site = this.site(p.block);
      if (!b || b.score < top * 0.6 || seen.has(b.id) || (named.size && site && !named.has(site))) return false; seen.add(b.id); return true; }).slice(0, 3)
      .map(p => { const b = B.find(x => x.id === p.block); return Object.fromEntries([['block', b.id], ...b.inputs.map(n => { const v = String(p[n] ?? '').trim(), other = v.match(/^\{(\w+)\}$/)?.[1];
        if ((j.examples || []).some(e => String(e).includes(`{${n}}`)) || (other && other !== n)) return [n, `{${n}}`]; // never another input's value
        // a person the words name (“tell Mom”, “to Priya Nair”) though the model left it to be asked
        const who = n === 'person' && (!v || other) && this.named(said);
        return [n, who || this.value(v, n, said)]; })]); });
    // several parts from one site only when the words list several things (“unread chats and Mom's messages”)
    if (!/\band\b|,/.test(said)) j.parts = j.parts.filter((p, i) => !this.site(p.block) || j.parts.findIndex(q => this.site(q.block) === this.site(p.block)) === i);
    j.name = String(j.name || '').replace(/[{}]/g, '');
    j.examples = (j.examples || []).map(String).filter(Boolean).slice(0, 5);
    // every input said each time is in a way to ask, or it would always be asked for; {words} no part uses are plain words;
    // a way to ask that another task already has goes (it would take that task's place)
    const ins = [...new Set(j.parts.flatMap(p => Object.values(p)).flatMap(v => [...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1])))];
    const taken = new Set(Agent.all().flatMap(t => [...(t.examples || []), t.name]).map(e => plain(e)));
    j.examples = [...new Set(j.examples.map(e => e.replace(/\{(\w+)\}/g, (m, k) => ins.includes(k) ? m : k)))].filter(e => !taken.has(plain(e)));
    const missing = ins.filter(x => !j.examples.some(e => e.includes(`{${x}}`)));
    if (missing.length) j.examples.push(`${plain(j.name || 'run my task')} ${missing.map(x => `{${x}}`).join(' ')}`);
    Log.i('agent', 'Local plan', j); return j;
  },
  /** The person the words name (“tell Mom”, “to Priya Nair”), if any. */
  named(said) { const w = String(said).replace(/^\w/, c => c.toLowerCase()).match(/\b(?:tell|to|message|text|ask|remind|email|mail|call)\s+((?:[A-Z][\w’'-]*)(?:\s[A-Z][\w’'-]*)?)/)?.[1]; return w && !this.sites(w).size ? w : ''; },
  site(id) { const k = id.split('.')[0]; return { mail: 'mail', cal: 'calendar', whatsapp: 'whatsapp', slack: 'slack', teams: 'teams' }[k] || ''; },
  sites(said) { const t = plain(said), o = new Set();
    for (const [site, re] of [['mail', /\b(e?mails?|inbox|outlook)\b/], ['calendar', /\b(calendar|meetings?|my day|agenda)\b/], ['whatsapp', /\bwhats ?app\b/], ['slack', /\bslack\b/], ['teams', /\bteams\b/]]) if (re.test(t)) o.add(site);
    return o; },
  /** A value the model filled: braces stay; a fixed value must be in what was said and not a stand-in (“someone”, “I say
      what”), else it's asked each time. */
  value(v, name, said) {
    if (!v || /^\{\w+\}$/.test(v)) return v || `{${name}}`;
    if (this.sites(v).size && plain(v).split(' ').length < 3) return `{${name}}`; // “slack”: the site, not a value
    if (/\b(someone|somebody|anyone|something|whoever|whatever|i say|i name|i tell|i choose|i pick|it sends?)\b/i.test(v) || /^(who|what|it|them|a person|the person|a message|the message)$/i.test(v)) return `{${name}}`;
    return ` ${plain(said)} `.includes(` ${plain(v)} `) ? v : `{${name}}`;
  },
  /** “person is Priya Nair, message is running late” → { person: 'Priya Nair', message: 'running late' }. */
  said(text) {
    const o = {}; for (const m of String(text || '').matchAll(/\b(\w+)\s+(?:is|=)\s+(.+?)(?=(?:,|;|\band\b)\s*\w+\s+(?:is|=)\s|[,;.]?\s*$)/gi)) o[m[1].toLowerCase()] = m[2].trim().replace(/^["“]|["”]$/g, '');
    return o;
  },
  /** Step 3: the plan → a task (agent.task per part; several parts are put together without the model). */
  assemble(p, test = {}) {
    const B = this.blocks(), braces = v => [...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]), params = {};
    const many = p.parts.length > 1, labels = [];
    const steps = p.parts.flatMap((part, i) => {
      const as = many ? `part${i + 1}` : 'card', ins = Object.entries(part).filter(([k]) => k !== 'block');
      for (const [k, v] of ins) for (const x of braces(v)) params[x] ||= Agent.get(part.block)?.params?.[k] ? { ...Agent.get(part.block).params[k] } : { ask: `What ${x}?` };
      if (part.block === 'page') {
        let host = 'Web'; try { host = new URL(part.url).hostname.replace(/^www\./, ''); } catch {}
        labels.push(host);
        return [{ do: 'agent.open', value: part.url || 'https://', args: ['wait=body', `site=${host}`] }, { do: 'wait', value: '2' },
          { do: 'agent.read', value: 'main||[role="main"]||article||body', as: 'read' }, { do: 'ai.card', value: part.ask || 'The main points of this page. Headline: the gist. Items: one per point.', args: ['{read}'], as }];
      }
      labels.push(TASK_LABELS[part.block.split('.')[0]] || Agent.get(part.block)?.name || part.block);
      return [{ do: 'agent.task', value: part.block, args: ins.map(([k, v]) => `${k}=${v}`), as }];
    });
    for (const e of p.examples) for (const x of braces(e)) params[x] ||= { ask: `What ${x}?` };
    // labels: the site, or the task's name when two parts share one (“What’s my day?”, “My next meeting”)
    if (many) steps.push({ do: 'card.join', value: '', args: labels.map((l, i) => `${labels.filter(x => x === l).length > 1 ? Agent.get(p.parts[i].block)?.name || l : l}=part${i + 1}`), as: 'card' });
    const acting = p.parts.map(x => Agent.get(x.block)).filter(t => t?.acts);
    const fill = (s, part) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => part[k] ?? m);
    return { id: `my.${Date.now().toString(36)}`, name: p.name || 'My task', group: 'Mine', about: p.parts.map(x => B.find(b => b.id === x.block)?.name).join(', then '),
      runs: p.parts.some(x => x.block === 'page' || Agent.where(Agent.get(x.block) || {}) === 'mac') ? 'mac' : 'here',
      acts: acting.length > 0, confirm: acting.map(t => fill(t.confirm || t.name, p.parts.find(x => x.block === t.id))).join(', then '),
      params, test: Object.fromEntries(Object.keys(params).map(k => [k, test[k] ?? ''])), examples: p.examples.length ? p.examples : [p.name.toLowerCase()], steps };
  },
  /** Step 1 then the form (step 2); Build assembles and imports it. */
  async start(said) {
    said = String(said || '').trim(); if (!said) return toast('Say what the task should do first');
    if (!this.can()) return toast('This needs Apple’s on-device model: StudioGen on a Mac, or a phone paired with one');
    toast('Planning it with your Mac’s model…');
    let p; try { p = await this.plan(said); } catch (e) { Log.w('agent', 'Local plan failed', { error: e.message }); return toast(`The model didn’t answer (${e.message})`); }
    if (!p.parts?.length) return sheet('No building block fits', `<p>The Mac’s model couldn’t make that from the tasks here. Copy the prompt and ask Claude, or start one in the editor.</p>`, [['Close']]);
    this.form(p, said);
  },
  form(p, said) {
    const B = this.blocks(), opt = id => B.map(b => `<option value="${esc(b.id)}"${b.id === id ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
    const need = () => [...new Set([...p.examples, ...p.parts.flatMap(x => Object.values(x))].flatMap(v => [...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1])))];
    const n = need(), test = { ...(this.named(said) ? { person: this.named(said) } : {}), ...this.said(said) }; // the person named is the test value when the task asks for one
    sheet('Your task, planned', `<p class="se-note">From “${esc(said)}”. Change anything, then build it: it gets a check run on the real pages.</p>
      <label class="se-field"><span>Name</span><input id="tlocName" value="${esc(p.name || '')}"></label>
      <label class="se-field"><span>Ways to ask (one a line; {words} change each time)</span><textarea id="tlocAsk" rows="3">${esc(p.examples.join('\n'))}</textarea></label>
      ${p.parts.map((x, i) => `<div class="se-field"><span>Part ${i + 1}</span><select data-tloc-block="${i}">${opt(x.block)}</select>
        <input data-tloc-in="${i}" value="${esc(Object.entries(x).filter(([k]) => k !== 'block').map(([k, v]) => `${k}=${v}`).join(', '))}" placeholder="inputs: person={person}"></div>`).join('')}
      ${n.length ? `<label class="se-field"><span>Test values: say or type ${n.map(k => `“${esc(k)} is …”`).join(', ')}</span><input id="tlocTest" value="${esc(n.filter(k => test[k]).map(k => `${k} is ${test[k]}`).join(', '))}" placeholder="${esc(n.map(k => `${k} is …`).join(', '))}"></label>` : ''}`,
      [['Build and check', () => {
        p.name = $('#tlocName').value.trim() || p.name; p.examples = $('#tlocAsk').value.split('\n').map(x => x.trim()).filter(Boolean);
        p.parts = p.parts.map((x, i) => ({ block: $(`[data-tloc-block="${i}"]`).value, ...Object.fromEntries($(`[data-tloc-in="${i}"]`).value.split(',').map(s => s.split('=').map(y => y.trim())).filter(([k, v]) => k && v)) }));
        const t = this.assemble(p, this.said($('#tlocTest')?.value || ''));
        setTimeout(() => TaskLLM.import(JSON.stringify({ format: 'studiogen-task', version: 1, task: t })), 50);
      }], ['Cancel']]);
  },
};
