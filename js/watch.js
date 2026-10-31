'use strict';
/* ============================================================
   Watchers (design: docs/watchers.html § 5–7, 11): a task that runs on its own, again and again, and tells you only when
   what it watches for happens. A small pipeline:
     source   page (opened each check) · live (kept open, read again without loading) · feed (RSS/Atom) · json · task
     reader   the part read: list rows (each a line) or a part's text; `keep` words pick lines
     detector new (rows not seen before: identity = the row without times and counts) · changes (the text, a readable
              difference) · value (a number crosses a line, or changes) · contains / gone (words) · appears / disappears
     filters  quiet hours (no toast or voice, still a card and the digest) · only if the model agrees it matters (ask)
     actions  a watch card on the Agent screen and the timeline · a quiet toast · spoken when important · the digest
   Runs in StudioGen's agent browser (the containers' sign-ins), one check at a time per site, leaving a slot for tasks;
   signed out or a robot check: paused, with a card to sign in. Templates for Slack, Teams, Outlook, WhatsApp, X, pages.
   Where (phase 5, design § 7): each watcher runs here or on another StudioGen of yours (a Worker): the definition goes
   there with the mesh request 'watch' (own devices only), it runs there, and its news comes back as 'watch-event' (sealed,
   through the mesh, or StudioGBee while this Mac is away). The news also goes to your DriveGens (a push through the bee
   when the phone is away). Live pages: the bridge's observer pokes a check within seconds. Finders: a picked part keeps
   several ways to find it; when the first stops matching, the next one is tried and kept (self-healing), else it asks you
   to pick it again.
   Stored in dd.watchers (definition + state: seen rows, last text or value). Loaded after memory.js.
   ============================================================ */
const WATCH_EVERY = [['live', 'Live (every 30 s, page kept open)'], ['2m', 'Every 2 minutes'], ['5m', 'Every 5 minutes'], ['15m', 'Every 15 minutes'], ['30m', 'Every 30 minutes'], ['1h', 'Every hour'], ['6h', 'Every 6 hours'], ['1d', 'Once a day']];
const WATCH_MS = { live: 30e3, '2m': 12e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '6h': 216e5, '1d': 864e5 };
/** Where things are, for the templates (the same selectors as the tasks, js/agent.js). */
const WSEL = {
  mailRows: '[role="listbox"] [role="option"]', waRows: '#pane-side [role="listitem"]||#pane-side [role="row"]', teamsRows: '[data-tid="chat-list-item"]||[role="treeitem"]',
  teamsMsgs: '[data-tid="chat-pane-message"]', slackActivity: '[data-qa="activity-item"]', slackMsgs: '[data-qa="message_container"]||[data-qa="virtual-list-item"]', xPosts: 'article[data-testid="tweet"]',
};
/** X's addresses: the real site, or the practice copy (labs/practice/x.html). */
const xUrl = (kind, v = '') => { const base = Agent.sites().x, practice = /x\.html/.test(base);
  return kind === 'user' ? (practice ? `${base}?user=${encodeURIComponent(v.replace(/^@/, ''))}` : `https://x.com/${encodeURIComponent(v.replace(/^@/, ''))}`)
    : kind === 'search' ? (practice ? `${base}?q=${encodeURIComponent(v)}` : `https://x.com/search?q=${encodeURIComponent(v)}&f=live`)
    : kind === 'mentions' ? (practice ? `${base}?view=mentions` : 'https://x.com/notifications/mentions') : base; };
/** The templates: name, what to ask, and the watcher they make. */
const WATCH_TEMPLATES = [
  { id: 'slack.mentions', group: 'Slack', name: 'New Slack mentions', inputs: [], make: () => ({ url: '{slack}', site: 'Slack', ready: '[role="tree"]', steps: [{ do: 'agent.click', args: ['sel=[data-qa="tab_rail_activity_button"]||button[aria-label="Activity"]', 'optional'] }, { do: 'wait', value: '1' }], rows: WSEL.slackActivity, detect: { kind: 'new' } }) },
  { id: 'slack.channel', group: 'Slack', name: 'New messages in a Slack channel', inputs: [['channel', 'Which channel?', 'sales']], make: v => ({ name: `Slack #${v.channel.replace(/^#/, '')}`, url: '{slack}', site: 'Slack', ready: '[role="tree"]', steps: [{ do: 'agent.click', value: v.channel.replace(/^#/, ''), args: ['sel=.p-channel_sidebar__channel||[role="treeitem"]'] }, { do: 'wait', value: '1.5' }], rows: WSEL.slackMsgs, detect: { kind: 'new' } }) },
  { id: 'slack.person', group: 'Slack', name: 'New Slack messages from someone', inputs: [['person', 'From whom?', 'Priya Nair']], make: v => ({ name: `Slack from ${v.person}`, url: '{slack}', site: 'Slack', ready: '[role="tree"]', steps: [{ do: 'agent.click', value: v.person, args: ['sel=.p-channel_sidebar__channel||[role="treeitem"]'] }, { do: 'wait', value: '1.5' }], rows: WSEL.slackMsgs, keep: v.person, detect: { kind: 'new' } }) },
  { id: 'teams.chats', group: 'Teams', name: 'New Teams chats', inputs: [], make: () => ({ url: '{teams}', site: 'Teams', ready: '[data-tid="chat-list"]||[role="tree"]', rows: WSEL.teamsRows, keep: 'Unread', detect: { kind: 'new' } }) },
  { id: 'teams.chat', group: 'Teams', name: 'New messages in a Teams chat', inputs: [['person', 'Which chat?', 'Priya Nair']], make: v => ({ name: `Teams: ${v.person}`, url: '{teams}', site: 'Teams', ready: '[data-tid="chat-list"]||[role="tree"]', steps: [{ do: 'agent.click', value: v.person, args: [`sel=${WSEL.teamsRows}`] }, { do: 'wait', value: '1.5' }], rows: WSEL.teamsMsgs, detect: { kind: 'new' } }) },
  { id: 'mail.new', group: 'Outlook', name: 'New mail', inputs: [], make: () => ({ url: '{outlook}/mail/inbox', site: 'Outlook', ready: '[role="listbox"]', rows: WSEL.mailRows, detect: { kind: 'new' } }) },
  { id: 'mail.from', group: 'Outlook', name: 'New mail from someone', inputs: [['person', 'From whom?', 'Priya Nair']], make: v => ({ name: `Mail from ${v.person}`, url: '{outlook}/mail/inbox', site: 'Outlook', ready: '[role="listbox"]', rows: WSEL.mailRows, keep: v.person, detect: { kind: 'new' } }) },
  { id: 'mail.words', group: 'Outlook', name: 'New mail about something', inputs: [['words', 'Which words? (|| between choices)', 'invoice||contract']], make: v => ({ name: `Mail about ${v.words.split('||')[0]}`, url: '{outlook}/mail/inbox', site: 'Outlook', ready: '[role="listbox"]', rows: WSEL.mailRows, keep: v.words, detect: { kind: 'new' } }) },
  { id: 'wa.new', group: 'WhatsApp', name: 'New WhatsApp messages', inputs: [], make: () => ({ url: '{whatsapp}', site: 'WhatsApp', ready: '#pane-side', rows: WSEL.waRows, keep: 'unread message', detect: { kind: 'new' } }) },
  { id: 'wa.from', group: 'WhatsApp', name: 'New WhatsApp messages from someone', inputs: [['person', 'From whom?', 'Mom']], make: v => ({ name: `WhatsApp from ${v.person}`, url: '{whatsapp}', site: 'WhatsApp', ready: '#pane-side', rows: WSEL.waRows, keep: v.person, detect: { kind: 'new' } }) },
  { id: 'x.timeline', group: 'X', name: 'New posts on my X timeline', inputs: [], make: () => ({ url: xUrl('home'), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'x.user', group: 'X', name: 'New posts by an X account', inputs: [['handle', 'Which account? (@name)', '@acme']], make: v => ({ name: `X: ${v.handle}`, url: xUrl('user', v.handle), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'x.search', group: 'X', name: 'New X posts matching a search', inputs: [['words', 'Search for', 'Acme']], make: v => ({ name: `X search: ${v.words}`, url: xUrl('search', v.words), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'x.mentions', group: 'X', name: 'New X mentions of me', inputs: [], make: () => ({ url: xUrl('mentions'), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'page.changes', group: 'Web pages', name: 'A web page changes', inputs: [['url', 'Which page? (its address)', 'https://example.com']], make: v => ({ name: `Changes: ${v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}`, url: v.url, read: 'main||article||[role="main"]||body', detect: { kind: 'changes' }, every: '1h' }) },
  { id: 'page.words', group: 'Web pages', name: 'Words appear on a web page', inputs: [['url', 'Which page?', 'https://example.com'], ['words', 'Which words? (|| between choices)', 'in stock']], make: v => ({ name: `“${v.words.split('||')[0]}” on ${v.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}`, url: v.url, read: 'body', detect: { kind: 'contains', words: v.words }, every: '1h' }) },
];
const Watch = {
  list: () => store.get('watchers', []),
  put(w) { const l = Watch.list(), i = l.findIndex(x => x.id === w.id); if (i >= 0) l[i] = w; else l.push(w); store.set('watchers', l); },
  del(id) { store.set('watchers', Watch.list().filter(w => w.id !== id)); },
  get: id => Watch.list().find(w => w.id === id),
  can: () => typeof AgentWeb !== 'undefined' && AgentWeb.can(),
  running: new Set(),
  /** A new watcher from a template or Watch something here: { name, url, site, ready, steps, rows | read, keep, detect, every, tell }. */
  make(o) {
    return { id: 'w' + Date.now().toString(36), on: true, created: Date.now(), runOn: 'here', every: '15m', tell: { card: true, toast: true, speak: 'important', digest: true }, ...o, state: { seen: [], fails: 0 } };
  },

  /* ---------- One check ---------- */
  /** The row as an identity: without times, counts and “now”, so a row isn't new just because its clock moved. */
  ident(line) { return plain(String(line).replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, ' ').replace(/(\s\d{1,3})?\s*\(\d+ unread[^)]*\)|\b\d+ unread\b/gi, ' ').replace(/^((unread|read|flagged|pinned|important|unread chat|chat)[,\s]+)+/i, ' ') /* a row read since, with its count badge */.replace(/\b(\d+\s*(s|m|h|d|min|mins|minutes|hours?|days?)( ago)?|now|yesterday|today)\b/gi, ' ')).slice(0, 300); },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); },
  /** What the source gives: lines (rows) or one text. */
  async read(w) {
    const k = w.source || (w.task ? 'task' : 'page');
    if (k === 'feed' || k === 'json') {
      if (!window.DriveDeckDesktop?.fetch) throw new Error('Feeds are read by StudioGen on a Mac');
      const r = await DriveDeckDesktop.fetch(w.url); if (r?.error || r.status >= 400) throw new Error(r?.error || `The address answered ${r.status}`);
      if (k === 'json') { let v; try { v = JSON.parse(r.text); } catch { throw new Error('That address didn’t give JSON'); } for (const p of String(w.path || '').split('.').filter(Boolean)) v = v?.[/^\d+$/.test(p) ? +p : p]; return typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); }
      const doc = new DOMParser().parseFromString(r.text, 'text/xml'), items = [...doc.querySelectorAll('item, entry')];
      if (!items.length) throw new Error('No feed items there (is it an RSS or Atom address?)');
      return items.slice(0, 50).map(i => [i.querySelector('title')?.textContent, i.querySelector('link')?.textContent || i.querySelector('link')?.getAttribute('href')].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim());
    }
    if (k === 'task') { const t = Agent.get(w.task); if (!t) throw new Error('That task isn’t here any more'); const c = Agent.asCard(await Agent.exec(t, w.inputs || {}, { confirmed: true, quiet: true })); return [c.headline, ...(c.items || []).map(i => [i.title, i.detail].filter(Boolean).join(' · '))].filter(Boolean); }
    // a page, opened (or kept open: live) in the agent browser, its steps, then the part read
    const sel = w.rows || w.read || 'body', url = String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m);
    const t = { id: `watch.${w.id}`, name: w.name, runs: 'mac', container: w.container || '', result: 'read',
      steps: [{ do: 'agent.open', value: url, args: [`site=${w.site || new URL(url).hostname}`, `wait=${w.ready || sel.split('||')[0]}`, 'ms=30000', ...(w.every === 'live' ? ['stay'] : [])] },
        ...(w.steps || []), w.detect?.kind === 'appears' || w.detect?.kind === 'disappears' ? { do: 'agent.wait', value: sel, args: ['ms=3000'], as: 'read' } : { do: 'agent.read', value: sel, args: [`max=${w.rows ? 12000 : 20000}`, 'strict', ...(w.keep ? [`keep=${w.keep}`] : [])], as: 'read' }] };
    let out; try { out = await Agent.exec(t, {}, { confirmed: true, quiet: true }); }
    catch (e) { if (!/^NOTFOUND:/.test(e.message)) throw e; out = await this.heal(w, url); }
    if (w.detect?.kind === 'appears' || w.detect?.kind === 'disappears') return !!out;
    const text = String(out ?? ''); if (text === '(none)') return [];
    return w.rows ? text.split('\n').map(l => l.trim()).filter(Boolean) : text;
  },
  /** The browser a page watcher uses ('container|site', as Agent.containersOf): a live one stays open there. */
  viewKey(w) { const url = String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m); try { return `${Containers.for(url, w.container).id}|${AgentWeb.siteKey(url)}`; } catch { return ''; } },
  /** Self-healing: the part's selector found nothing on the page just read; its other finders are tried on the same page,
      and the first that finds it is kept (noted in the log and the list). None: GONE (it asks you to pick it again). */
  async heal(w, url) {
    const v = AgentWeb.views.get(this.viewKey(w)), was = w.rows || w.read;
    for (const f of (w.finders || []).filter(f => f && f !== was)) {
      const r = await AgentWeb.call('read', [f, w.rows ? 12000 : 20000], 20000, { view: v });
      if (!r?.ok || r.sel === 'body') continue;
      if (w.rows) w.rows = f; else w.read = f;
      w.finders = [f, ...w.finders.filter(x => x !== f), was].filter((x, i, l) => x && l.indexOf(x) === i).slice(0, 8);
      w.state.healed = { at: Date.now(), from: was, to: f }; Log.i('watch', `Found it again another way: ${w.name}`, { from: was, to: f });
      if (!w.keep) return r.text;
      const ks = w.keep.toLowerCase().split('||').map(k => k.trim()).filter(Boolean);
      return r.text.split('\n').filter(l => ks.some(k => l.toLowerCase().includes(k))).join('\n') || '(none)';
    }
    throw new Error(`GONE:${url}`);
  },
  /** A live watcher's part changed (the bridge's observer, via AgentWeb): check it now, at most every 10 s. */
  poke(key) {
    for (const w of this.list()) if (w.on && w.every === 'live' && (!w.runOn || w.runOn === 'here') && !w.state?.paused && !this.running.has(w.id) && Date.now() - (w.state?.at || 0) > 10000 && this.viewKey(w) === key) { Log.d('watch', `Changed: ${w.name}`); this.check(w); }
  },
  /** What counts, from what was read and what was seen before: { tell, headline, items, value } or nothing. */
  detect(w, got) {
    const d = w.detect || { kind: 'changes' }, s = w.state || (w.state = { seen: [] }), first = !s.at;
    if (d.kind === 'new') {
      const rows = [].concat(got), fresh = rows.filter(r => !s.seen.includes(this.hash(this.ident(r))));
      s.seen = [...new Set([...rows.map(r => this.hash(this.ident(r))), ...s.seen])].slice(0, 400);
      if (first || !fresh.length) return null;
      const items = fresh.slice(0, 5).map(r => this.item(r));
      return { headline: fresh.length === 1 ? `${w.name}: ${[items[0].title, items[0].detail].filter(Boolean).join(' · ').slice(0, 120)}` : `${fresh.length} new: ${w.name}`, items };
    }
    if (d.kind === 'changes') {
      const text = Array.isArray(got) ? got.join('\n') : String(got), norm = this.ident(text.replace(/\n/g, ' ')), was = s.last;
      s.last = text.slice(0, 20000); s.lastNorm = norm;
      if (first || norm === s.prevNorm || !was) { s.prevNorm = norm; return null; }
      s.prevNorm = norm;
      const bits = x => x.split(/\n|(?<=[.!?])\s+(?=[A-Z0-9“"])/).map(l => l.trim()).filter(Boolean); /* lines, else sentences (a part is read as one line) */
      const a = new Set(bits(was)), b = bits(text), moved = l => this.ident(l), a0 = b.filter(l => !a.has(l)), g0 = [...a].filter(l => !b.includes(l)), ai = new Set(a0.map(moved)), gi = new Set(g0.map(moved));
      const added = a0.filter(l => !gi.has(moved(l))), gone = g0.filter(l => !ai.has(moved(l))); /* not lines where only a time or count moved */
      if (!added.length && !gone.length) return null;
      return { headline: `${w.name}: changed`, items: [...added.slice(0, 4).map(l => ({ title: 'Now', detail: l.slice(0, 160) })), ...gone.slice(0, 2).map(l => ({ title: 'Was', detail: l.slice(0, 160) }))] };
    }
    if (d.kind === 'value') {
      const text = Array.isArray(got) ? got.join(' ') : String(got), m = text.replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(\.\d+)?/), v = m ? +m[0] : NaN;
      if (isNaN(v)) throw new Error(`No number in what it reads (“${text.slice(0, 60)}”)`);
      const was = s.value; s.value = v; if (first || was == null) return null;
      const c = String(d.cond || 'changes').toLowerCase(), n = +(c.match(/-?\d+(\.\d+)?/) || [])[0];
      const hit = /below|under|less/.test(c) ? v < n : /above|over|more/.test(c) ? v > n : /drop|fall/.test(c) ? v < was : /rise|up/.test(c) ? v > was : v !== was;
      const before = s.hit; s.hit = hit; if (!hit || before) return null; /* once when it crosses; again after it crosses back */
      return { headline: `${w.name}: ${was} → ${v}`, items: [{ title: 'Now', detail: String(v) }, { title: 'Was', detail: String(was) }], value: v };
    }
    if (d.kind === 'contains' || d.kind === 'gone') {
      const text = (Array.isArray(got) ? got.join('\n') : String(got)).toLowerCase(), words = String(d.words || '').toLowerCase().split('||').map(x => x.trim()).filter(Boolean);
      const has = words.some(x => text.includes(x)), want = d.kind === 'contains' ? has : !has, before = s.hit; s.hit = want;
      if (first ? !want : !want || before) return null;
      return { headline: d.kind === 'contains' ? `“${words.find(x => text.includes(x))}” is on ${w.name}` : `“${words[0]}” is gone from ${w.name}`, items: [] };
    }
    if (d.kind === 'appears' || d.kind === 'disappears') {
      const want = d.kind === 'appears' ? !!got : !got, before = s.hit; s.hit = want;
      if (!want || before || first && !want) return null;
      return { headline: `${w.name}: ${d.kind === 'appears' ? 'it’s there now' : 'it’s gone'}`, items: [] };
    }
    return null;
  },
  /** A row as a card item: “who · what” where it can tell. */
  item(r) {
    const t = String(r).replace(/^((unread|unread chat|chat)[,\s]+)+/i, '').replace(/\s(\d{1,3})\s*\((\d+) unread/i, (m, a, b) => a === b ? ` (${b} unread` : m).replace(/\(\d+ unread[^)]*\)/gi, '').replace(/\s+/g, ' ').trim(); /* a badge showing the same number as its “(n unread)” */
    let m = t.match(/^(.+?)\s*(@\w+)\s*·\s*(\S+)\s+(.+)$/); if (m) return { title: `${m[1]} (${m[2]})`, when: m[3], detail: m[4].slice(0, 160) }; /* a post: name @handle · when text */
    m = t.match(/^(.*?)\s*\b(\d{1,2}:\d{2}(?:\s*[ap]m)?)\s+(.+)$/i); /* who time what (chats), or time who what (mail) */
    if (m) return m[1] ? { title: m[1], when: m[2], detail: m[3].slice(0, 160) } : { title: m[3].slice(0, 160), when: m[2] };
    return { title: t.slice(0, 160) };
  },
  /** The model's judgement, when asked for: does this matter to the user (with what memory knows)? */
  async judge(w, hit) {
    if (!w.ask || typeof Intent === 'undefined' || !Intent.can()) return { ok: true, important: w.tell?.speak === 'always' };
    const mem = typeof Memory !== 'undefined' ? await Memory.for(`${w.name} ${hit.headline}`).catch(() => '') : '';
    const schema = { type: 'object', required: ['matters', 'important', 'why'], properties: { matters: { type: 'boolean' }, important: { type: 'boolean' }, why: { type: 'string' } } };
    try { const j = (await LLM.ask('fast', { system: LLM.prompt('watch.judge', { rule: w.ask, memory: mem || 'nothing' }), prompt: `${hit.headline}\n${(hit.items || []).map(i => `- ${[i.title, i.detail].filter(Boolean).join(': ')}`).join('\n')}`, schema, temperature: 0 })).json || {}; return { ok: j.matters !== false, important: !!j.important, why: j.why }; }
    catch { return { ok: true, important: false }; }
  },
  quiet(w) { const q = String(w.quiet || store.get('watchQuiet', '22:00-07:00')).match(/(\d\d):(\d\d)-(\d\d):(\d\d)/); if (!q) return false; const n = new Date(), m = n.getHours() * 60 + n.getMinutes(), a = +q[1] * 60 + +q[2], b = +q[3] * 60 + +q[4]; return a < b ? m >= a && m < b : m >= a || m < b; },
  /** Tell: a card (and the timeline), a quiet toast, the voice when important, the digest. */
  tell(w, hit, verdict) {
    if (w.origin) return this.send(w.origin, { id: w.originId, headline: hit.headline, items: hit.items || [], important: !!verdict?.important, why: verdict?.why || '', state: this.brief(w) }).then(r => { if (r?.error === 'No such watcher here') { this.del(w.id); Log.i('watch', `Deleted there, so stopped here: ${w.name}`); } }); /* run here for another StudioGen of yours: it tells */
    const t = w.tell || {}, quiet = this.quiet(w), presenting = typeof Script !== 'undefined' && Script.running;
    const card = { task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'list', headline: hit.headline, items: hit.items || [], status: 'done', watch: w.id, ...(verdict?.why ? { why: verdict.why } : {}) };
    if (t.card !== false) { const c = Agent.post(card); Agent.log({ id: c.id, kind: 'watch', title: card.title, status: 'done', headline: hit.headline, items: hit.items }); }
    if (t.toast !== false && !quiet) toast(`👁 ${hit.headline}`);
    if (!quiet && !presenting && (t.speak === 'always' || (t.speak === 'important' && verdict?.important))) Voice.speak?.(hit.headline);
    if (t.digest !== false) store.set('watchDigest', [...store.get('watchDigest', []), { at: Date.now(), w: w.name, h: hit.headline, items: (hit.items || []).slice(0, 3) }].slice(-200));
    if (t.phone !== false) this.phones({ name: w.name, headline: hit.headline, items: (hit.items || []).slice(0, 5), important: !!verdict?.important });
    Log.i('watch', `Told: ${hit.headline}`, { quiet, important: !!verdict?.important });
  },
  /* ---------- Watchers on other devices of yours (design § 7) ---------- */
  /** StudioGens of yours that can run watchers now (a Worker, another Mac): from their presence. */
  runners() {
    if (typeof Mesh === 'undefined' || !Mesh.m) return [];
    return Mesh.members().filter(m => m.id !== Mesh._me?.id && Mesh.own(m.id) && Mesh.presence[m.id]?.caps?.watch && Date.now() - (Mesh.presence[m.id].at || 0) < 180000);
  },
  where(w) { return !w.runOn || w.runOn === 'here' ? 'here' : Mesh.member?.(w.runOn)?.name || 'another device'; },
  /** What the owner's list shows of a watcher running elsewhere. */
  brief(w) { const s = w.state || {}; return { at: s.at, count: s.count, changedAt: s.changedAt, lastHit: s.lastHit, error: s.fails ? s.error : '', fails: s.fails || 0, paused: s.paused || '', next: s.next, healed: s.healed }; },
  /** A request to the device running it. */
  remote(w, op, more = {}, ms = 120000) { return Mesh.call(w.runOn, 'watch', { op, id: w.id, ...more }, ms); },
  /** News for one of your devices: through the mesh when it's there, else StudioGBee keeps it (push: a phone that's away
      gets “a watcher found something new”, nothing more). */
  async send(to, p, push) {
    try { return await Mesh.call(to, 'watch-event', p, 30000); }
    catch (e) { if (typeof Bee !== 'undefined' && Bee.up()) { Bee.call(to, 'watch-event', p, 86400000, push ? { push: 'watch' } : {}).catch(() => {}); return { queued: true }; } Log.w('watch', 'Couldn’t pass the news on', { to, error: e.message }); }
  },
  /** Your DriveGens in the mesh get the news as a card. */
  phones(p) {
    if (typeof Mesh === 'undefined' || !Mesh.m) return;
    for (const m of Mesh.members()) if (m.app === 'DriveGen' && m.id !== Mesh._me?.id && Mesh.own(m.id)) this.send(m.id, { phone: true, ...p }, true);
  },
  /** Requests from your own StudioGen (Direct.handle 'watch', own devices only): run its watchers here. */
  async answer(p, who) {
    const from = who.meshId || who.id; if (!from) throw new Error('Only through the mesh');
    const mine = () => this.list().filter(w => w.origin === from), find = () => mine().find(w => w.originId === p.id);
    if (p.op === 'list') return { list: mine().map(w => ({ id: w.originId, ...this.brief(w) })) };
    if (p.op === 'save') {
      if (!this.can()) throw new Error('This device can’t run watchers');
      const d = p.w || {}, old = find(), w = { ...d, id: old?.id || 'w' + Date.now().toString(36), originId: d.id, origin: from, originName: who.name || '', runOn: 'here', state: { seen: [], fails: 0 } };
      const r = await this.check(w, { preview: true }); this.detect(w, r.got);
      w.state.at = Date.now(); w.state.count = Array.isArray(r.got) ? r.got.length : null; w.state.next = Date.now() + (WATCH_MS[w.every] || 9e5); this.put(w);
      return { got: Array.isArray(r.got) ? r.got.slice(0, 3) : typeof r.got === 'boolean' ? r.got : String(r.got).slice(0, 300), count: w.state.count, state: this.brief(w) };
    }
    const w = find(); if (!w) throw new Error('That watcher isn’t on this device');
    if (p.op === 'check') { const r = await this.check(w); return { hit: r?.hit?.headline || '', state: this.brief(this.get(w.id) || w) }; }
    if (p.op === 'set') { w.on = !!p.on; if (w.on) { w.state.paused = ''; w.state.next = Date.now(); } this.put(w); return { state: this.brief(w) }; }
    if (p.op === 'del') { this.del(w.id); return { ok: true }; }
    throw new Error(`Unknown watcher request ${p.op}`);
  },
  /** News from a device running one of yours (or, on a DriveGen, from your Mac). */
  event(p, who) {
    const from = who.meshId || who.id;
    if (p.phone) { /* on a phone: a card and a quiet note; the Mac keeps the watcher */
      Agent.post({ task: 'watch.phone', title: `👁 ${p.name || 'Watcher'}`, type: 'list', headline: p.headline, items: p.items || [], status: 'done', where: 'mac' });
      if (!this.quiet({})) toast(`👁 ${p.headline}`); return { ok: true };
    }
    const w = this.list().find(x => x.id === p.id && x.runOn === from); if (!w) return { ok: false, error: 'No such watcher here' };
    w.state = { ...w.state, ...(p.state || {}) };
    if (p.paused) { this.put(w); Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: 'signin', headline: `${p.paused} on ${this.where(w)}, then it carries on (paused)`, watch: w.id }); return { ok: true }; }
    w.state.changedAt = Date.now(); w.state.lastHit = p.headline; this.put(w);
    this.tell({ ...w, origin: '' }, { headline: p.headline, items: p.items || [] }, { important: !!p.important, why: p.why });
    return { ok: true };
  },
  /** One check of one watcher (the scheduler, or Check now). preview: only read, tell nothing, keep nothing. */
  async check(w, o = {}) {
    if (this.running.has(w.id)) return; this.running.add(w.id);
    const t0 = Date.now();
    try {
      const got = await this.read(w);
      if (o.preview) return { got };
      const hit = this.detect(w, got);
      w.state.at = Date.now(); w.state.fails = 0; w.state.paused = ''; w.state.lastMs = Date.now() - t0; w.state.count = Array.isArray(got) ? got.length : null;
      if (hit) { const v = await this.judge(w, hit); if (v.ok) { w.state.changedAt = Date.now(); w.state.lastHit = hit.headline; this.tell(w, hit, v); } }
      if (w.every === 'live' && (w.rows || w.read) && !w.source) { const v = AgentWeb.views.get(this.viewKey(w)); if (v) AgentWeb.call('observe', [w.rows || w.read, true], 5000, { view: v }); } /* told within seconds when it changes */
      return { got, hit };
    } catch (e) {
      const m = e.message; w.state.fails = (w.state.fails || 0) + 1; w.state.error = m;
      if (/^SIGNIN:/.test(m) || /robot|captcha|not a robot/i.test(m)) { /* needs you: paused, said once */
        w.state.paused = /^SIGNIN:/.test(m) ? `Sign in to ${m.slice(7)}` : 'Answer the robot check';
        Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: /^SIGNIN:/.test(m) ? 'signin' : 'failed', headline: `${w.state.paused}, then it carries on (paused)`, watch: w.id });
        if (w.origin && !o.preview) this.send(w.origin, { id: w.originId, paused: w.state.paused, state: this.brief(w) });
      }
      if (/^GONE:/.test(m)) { /* none of its finders found the part: pick it again */
        w.state.paused = 'What it watches isn’t on the page any more';
        if (!o.preview) Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: 'failed', headline: `${w.state.paused}: pick it again`, watch: w.id, gone: true });
        if (w.origin && !o.preview) this.send(w.origin, { id: w.originId, paused: w.state.paused, state: this.brief(w) });
      }
      Log.w('watch', `Check failed: ${w.name}`, { error: m, fails: w.state.fails });
      if (o.preview) throw e;
    } finally {
      this.running.delete(w.id);
      if (!o.preview) { const back = [0, 3e5, 9e5, 36e5][Math.min(3, w.state.fails || 0)]; w.state.next = Date.now() + Math.max(WATCH_MS[w.every] || 9e5, back) * (0.9 + Math.random() * 0.2); /* a little randomness: not robotic */ this.put(w); if (current === 'settings' && $('#sheet .wt-list')) this.sheet(); }
    }
  },

  /* ---------- The scheduler ---------- */
  tick() {
    if (!this.can()) return;
    const busy = typeof Agent !== 'undefined' ? Agent.slots.n : 0, cap = Math.max(1, +Agent.cfg().parallel || 3) - 1; /* a slot stays free for what you ask */
    let started = 0;
    for (const w of this.list()) {
      if (!w.on || w.state?.paused || (w.runOn && w.runOn !== 'here') || this.running.has(w.id) || (w.state?.next || 0) > Date.now()) continue;
      if (busy + started >= cap) break;
      started++; this.check(w);
    }
    this.digest();
  },
  /** The day's digest at the chosen time: one card with what the watchers saw (the model sums it up when it can). */
  async digest() {
    const at = store.get('watchDigestAt', '18:00'), [hh, mm] = at.split(':').map(Number), now = new Date(), due = new Date(now); due.setHours(hh, mm || 0, 0, 0);
    const all = store.get('watchDigest', []), l = all.filter(e => e.at < +due); /* what came after the time waits for tomorrow's */
    if (now < due || store.get('watchDigestDay') === now.toDateString()) return; store.set('watchDigestDay', now.toDateString());
    if (!l.length) return; store.set('watchDigest', all.filter(e => e.at >= +due));
    let headline = `Today your watchers saw ${l.length} thing${l.length > 1 ? 's' : ''}`;
    try { if (typeof Intent !== 'undefined' && Intent.can()) headline = (await LLM.ask('cards', { system: LLM.prompt('watch.digest'), prompt: l.map(e => `${e.w}: ${e.h}`).join('\n'), max: 200 })).text || headline; } catch {}
    Agent.post({ task: 'watch.digest', title: '👁 Today’s watchers', type: 'list', headline, items: l.slice(-5).reverse().map(e => ({ title: e.w, detail: e.items?.[0] ? [e.items[0].title, e.items[0].detail].filter(Boolean).join(' · ') : e.h })), status: 'done' });
  },

  /* ---------- Making one: templates, Watch something here, from a card ---------- */
  fromTemplate(id) {
    const T = WATCH_TEMPLATES.find(x => x.id === id); if (!T) return;
    sheet(T.name, `${T.inputs.map(([k, q, ph]) => `<label class="se-field"><span>${esc(q)}</span><input data-wti="${k}" placeholder="${esc(ph)}"></label>`).join('')}${this.formHtml(T.make(Object.fromEntries(T.inputs.map(([k, , ph]) => [k, ph]))))}`,
      [['Check and save', async () => { const v = Object.fromEntries($$('[data-wti]').map(el => [el.dataset.wti, el.value.trim() || el.placeholder])); const w = this.make({ name: T.name, template: T.id, ...T.make(v) }); this.formRead(w); await this.saveChecked(w); }], ['Back', () => this.templates()]]);
  },
  formHtml(o) {
    const sel = (id, l, cur) => `<select id="${id}">${l.map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    return `<label class="se-row"><span>How often</span>${sel('wtEvery', WATCH_EVERY, o.every || '15m')}</label>
      <label class="se-check"><input type="checkbox" id="wtToast" checked> A quiet notification</label>
      <label class="se-row"><span>Say it aloud</span>${sel('wtSpeak', [['important', 'When it’s important'], ['always', 'Always'], ['never', 'Never']], 'important')}</label>
      <label class="se-check"><input type="checkbox" id="wtDigest" checked> In the daily digest</label>
      ${typeof Mesh !== 'undefined' && Mesh.m && Mesh.members().some(m => m.app === 'DriveGen' && Mesh.own(m.id)) ? '<label class="se-check"><input type="checkbox" id="wtPhone" checked> On my phone too (a push when it’s away)</label>' : ''}
      ${this.runners().length ? `<label class="se-row"><span>Runs on</span>${sel('wtRunOn', [['here', 'This Mac'], ...this.runners().map(m => [m.id, esc(m.name)])], o.runOn || 'here')}</label><p class="se-note">A Worker is always on and keeps its own sign-ins (sign in there with Sign in from here).</p>` : ''}
      <label class="se-field"><span>Only tell me if… (optional, judged by the model)</span><input id="wtAsk" placeholder="it’s from a customer, or needs me today"></label>`;
  },
  formRead(w) { w.every = $('#wtEvery')?.value || w.every; w.tell = { card: true, toast: $('#wtToast')?.checked !== false, speak: $('#wtSpeak')?.value || 'important', digest: $('#wtDigest')?.checked !== false, phone: $('#wtPhone') ? $('#wtPhone').checked : true }; w.runOn = $('#wtRunOn')?.value || w.runOn || 'here'; const a = $('#wtAsk')?.value.trim(); if (a) w.ask = a; },
  /** Read once before saving (the baseline: nothing told), show what it reads now. */
  async saveChecked(w) {
    sheet('Checking…', `<p class="se-note">Reading ${esc(w.name)} once${w.runOn && w.runOn !== 'here' ? ` on ${esc(this.where(w))}` : ''}, so it knows what's there now.</p>`, []);
    if (w.runOn && w.runOn !== 'here') try { /* on another StudioGen of yours: it reads there and keeps the state; this Mac keeps the definition and tells you */
      const { state, ...def } = w, r = await this.remote(w, 'save', { w: def }, 150000);
      w.state = { ...w.state, ...r.state }; this.put(w);
      const got = r.got, now = Array.isArray(got) ? `${r.count} item${r.count === 1 ? '' : 's'} now${got.length ? `, e.g. “${esc(String(got[0]).slice(0, 90))}”` : ''}` : typeof got === 'boolean' ? (got ? 'It’s there now' : 'Not there now') : `Now: “${esc(String(got).slice(0, 140))}”`;
      return sheet('Watching', `<p><b>${esc(w.name)}</b> · ${esc((WATCH_EVERY.find(e => e[0] === w.every) || [])[1] || w.every)} · on ${esc(this.where(w))}</p><p class="se-note">${now}. It tells you when that changes.</p>`, [['Watchers', () => this.sheet()], ['Done']]);
    } catch (e) { return sheet('Couldn’t read it there', `<p>${esc(e.message.replace(/^SIGNIN:(.+)$/, `Sign in to $1 on ${this.where(w)} first (Sign in from here), then try again.`))}</p>`, [['Cancel']]); }
    try {
      const r = await this.check(w, { preview: true }), got = r.got;
      this.detect(w, got); w.state.at = Date.now(); w.state.count = Array.isArray(got) ? got.length : null; w.state.next = Date.now() + (WATCH_MS[w.every] || 9e5); this.put(w);
      const now = Array.isArray(got) ? `${got.length} item${got.length === 1 ? '' : 's'} now${got.length ? `, e.g. “${esc(String(got[0]).slice(0, 90))}”` : ''}` : typeof got === 'boolean' ? (got ? 'It’s there now' : 'Not there now') : `Now: “${esc(String(got).slice(0, 140))}”`;
      sheet('Watching', `<p><b>${esc(w.name)}</b> · ${esc((WATCH_EVERY.find(e => e[0] === w.every) || [])[1] || w.every)}</p><p class="se-note">${now}. It tells you when that changes.</p>`, [['Watchers', () => this.sheet()], ['Done']]);
    } catch (e) { sheet('Couldn’t read it', `<p>${esc(e.message.replace(/^SIGNIN:(.+)$/, 'Sign in to $1 in the agent browser first (it’s open now), then try again.'))}</p>`, [['Save anyway', () => { this.put(w); this.sheet(); }], ['Cancel']]); }
  },
  templates() {
    const groups = {}; for (const t of WATCH_TEMPLATES) (groups[t.group] ||= []).push(t);
    sheet('New watcher', `<p class="se-note">What should it watch? It checks on its own and tells you when something new or different shows up.</p>
      ${Object.entries(groups).map(([g, l]) => `<p class="se-note"><b>${esc(g)}</b></p><div class="pick-list">${l.map(t => `<button class="big-btn" data-wt="tpl|${t.id}">${esc(t.name)}</button>`).join('')}</div>`).join('')}
      ${this.can() ? '<p class="se-note"><b>Anything else</b></p><div class="pick-list"><button class="big-btn" data-wt="here">Watch something on a page (open it, tap it)</button></div>' : ''}`, [['Back', () => this.sheet()]]);
  },
  /** Watch something here: the agent browser's page, a part picked by tapping; the kind suggested from what it is. */
  async here(url, again) {
    if (url) await AgentWeb.go(url);
    AgentWeb.show(true); toast('Tap what to watch on the page');
    const r = await AgentWeb.call('pick', [120000, true], 125000); AgentWeb.show(false);
    if (!r?.ok) return toast('Nothing picked');
    const listy = /^(listitem|row|option|treeitem|article)$/.test(r.role) || r.tag === 'li' || r.tag === 'article';
    const rows = listy ? r.css.replace(/:nth-(child|of-type)\(\d+\)(?!.*:nth-)/, '') : '', num = /\d/.test(r.text) && r.text.length < 40;
    const q = x => String(x).replace(/["\\]/g, '\\$&'), finders = [listy ? rows : r.css, r.testid && `[data-testid="${q(r.testid)}"]`, r.testid && `[data-qa="${q(r.testid)}"]`, r.role && `${r.tag}[role="${q(r.role)}"]`, !listy && r.label && `[aria-label="${q(r.label)}"]`, listy ? r.css : ''].filter(Boolean); /* ways to find it again (self-healing) */
    const old = again && this.get(again);
    if (old) { const k = old.rows ? 'rows' : 'read'; old[k] = finders[0]; old.finders = finders; old.state.paused = ''; old.state.fails = 0; old.state.at = 0; return this.saveChecked(old); } /* picked again: same watcher, new part, a new baseline */
    const page = AgentWeb.url(), title = listy ? `New on ${AgentWeb.siteKey(page).replace(/^www\./, '')}` : (r.text || '').slice(0, 40) || AgentWeb.siteKey(page);
    sheet('Watch this', `<p class="se-note">You picked: “${esc((r.text || r.label || r.css).slice(0, 120))}”</p>
      <label class="se-row"><span>Tell me when</span><select id="wtKind">${[['new', 'new items appear in this list', listy], ['changes', 'it changes', !listy && !num], ['value', 'the number crosses a line', num && !listy], ['contains', 'some words appear', false], ['disappears', 'it disappears', false], ['appears', 'it appears (it isn’t there now)', false]].map(([v, n, on]) => `<option value="${v}" ${on ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="se-field"><span>The line or the words (for the number or the words)</span><input id="wtCond" placeholder="below 500, or: in stock||available"></label>
      <label class="se-field"><span>Its name</span><input id="wtName" value="${esc(title)}"></label>${this.formHtml({ every: '15m' })}`,
      [['Check and save', async () => { const kind = $('#wtKind').value, cond = $('#wtCond').value.trim();
        const w = this.make({ name: $('#wtName').value.trim() || title, url: page, ready: r.css, ...(kind === 'new' ? { rows: rows || r.css } : { read: r.css }), finders, detect: { kind, ...(kind === 'value' ? { cond: cond || 'changes' } : kind === 'contains' ? { words: cond } : {}) } });
        this.formRead(w); await this.saveChecked(w); }], ['Cancel']]);
  },
  /** “Watch this” on a task's card: the task runs on a schedule and its new items are told. */
  fromCard(c) { const t = Agent.get(c.task); if (!t) return; sheet(`Watch: ${t.name}`, `<p class="se-note">It runs “${esc(t.name)}” on its own and tells you when its answer has something new.</p>${this.formHtml({ every: '30m' })}`, [['Check and save', async () => { const w = this.make({ name: t.name, source: 'task', task: t.id, detect: { kind: 'new' }, every: '30m' }); this.formRead(w); await this.saveChecked(w); }], ['Cancel']]); },

  /* ---------- The Watchers list ---------- */
  sheet() {
    const ago = t => { if (!t) return '–'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
    const inn = t => { if (!t) return 'soon'; const m = Math.round((t - Date.now()) / 60000); return m <= 0 ? 'now' : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`; };
    const l = this.list(), away = [...new Set(l.filter(w => w.runOn && w.runOn !== 'here').map(w => w.runOn))];
    if (away.length && !this.refreshing && Date.now() - (this.refreshed || 0) > 20000) { this.refreshing = true; /* how the ones elsewhere are doing */
      Promise.allSettled(away.map(id => Mesh.call(id, 'watch', { op: 'list' }, 20000).then(r => { for (const x of r.list || []) { const w = this.get(x.id); if (w && w.runOn === id) { const { id: _, ...st } = x; w.state = { ...w.state, ...st }; this.put(w); } } })))
        .finally(() => { this.refreshing = false; this.refreshed = Date.now(); if ($('#sheet .wt-list') && !$('#sheet').hidden) this.sheet(); }); }
    sheet('Watchers', `<p class="se-note">They check on their own${this.can() ? ' (in this Mac’s agent browser, with your sign-ins)' : ''} and tell you when something new or different shows up: a card, a quiet notification, the voice when it matters, a daily digest at ${esc(store.get('watchDigestAt', '18:00'))}. Quiet hours ${esc(store.get('watchQuiet', '22:00-07:00'))}.</p>
      <div class="wt-list">${l.map(w => `<div class="mem-row"><span><b>${w.on ? '' : '⏸ '}${esc(w.name)}</b>${w.runOn && w.runOn !== 'here' ? ` <span class="se-note">· on ${esc(this.where(w))}</span>` : ''}<br><span class="se-note">${w.state?.healed && Date.now() - w.state.healed.at < 864e5 ? '🩹 found it again another way · ' : ''}${w.state?.paused ? `⚠️ ${esc(w.state.paused)}` : w.state?.error && w.state.fails ? `⚠️ ${esc(w.state.error.slice(0, 80))}` : `checked ${ago(w.state?.at)}${w.state?.count != null ? ` · ${w.state.count} items` : ''}`} · ${w.state?.changedAt ? `last news ${ago(w.state.changedAt)}` : 'no news yet'} · next ${w.on ? inn(w.state?.next) : 'off'}</span></span>
        <span><button class="link-btn" data-wt="now|${w.id}">Check now</button> ${/isn’t on the page/.test(w.state?.paused || '') ? `<button class="link-btn" data-wt="repick|${w.id}">Pick it again</button> ` : ''}<button class="link-btn" data-wt="onoff|${w.id}">${w.on ? 'Pause' : 'Resume'}</button> <button class="link-btn" data-wt="del|${w.id}">Delete</button></span></div>`).join('') || '<p class="se-note">None yet.</p>'}</div>
      <div class="chip-row"><button class="chip accent" data-wt="new">+ New watcher</button><button class="chip" data-wt="opts">Digest and quiet hours</button></div>`, [['Close']]);
  },
};
ACTIONS.watchers = () => Watch.sheet();
setInterval(() => { try { Watch.tick(); } catch (e) { Log.w('watch', 'Scheduler', e); } }, 30000);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-wt]'); if (!b) return; e.stopPropagation();
  const [k, id] = b.dataset.wt.split('|'), w = id && Watch.get(id);
  if (k === 'new') return Watch.templates();
  if (k === 'list') return Watch.sheet();
  if (k === 'card') { const c = Agent.feed().find(x => x.id === id); return c && Watch.fromCard(c); }
  if (k === 'signin' && w) { const u = String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m); await AgentWeb.go(u, w.container); AgentWeb.show(true); return toast('Sign in, then tap Check now on its card'); }
  if (k === 'tpl') return Watch.fromTemplate(id);
  if (k === 'here') { closeSheet(); return sheet('Watch something on a page', '<label class="se-field"><span>The page (its address; empty: the one open in the agent browser)</span><input id="wtUrl" placeholder="https://…"></label>', [['Open it', () => Watch.here($('#wtUrl').value.trim())], ['Cancel']]); }
  if (k === 'herenow') { AgentWeb.show(false); return Watch.here(); } /* the agent browser's bar */
  if (k === 'repick' && w) { closeSheet(); if (w.runOn && w.runOn !== 'here') return toast(`Pick it again on ${Watch.where(w)} (Sign in from here)`); return Watch.here(String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m), w.id); }
  if (k === 'rsignin' && w) return RemoteView.open({ meshId: w.runOn, name: Watch.where(w) }, 'web');
  if (w && w.runOn && w.runOn !== 'here' && /^(now|onoff|del)$/.test(k)) { /* one running on another device of yours */
    try {
      if (k === 'now') { toast(`Checking ${w.name} on ${Watch.where(w)}…`); const r = await Watch.remote(w, 'check'); w.state = { ...w.state, ...r.state }; Watch.put(w); toast(r.hit || w.state.paused || `${w.name}: nothing new`); }
      if (k === 'onoff') { const r = await Watch.remote(w, 'set', { on: !w.on }, 20000); w.on = !w.on; w.state = { ...w.state, ...r.state }; Watch.put(w); }
      if (k === 'del') { if (!confirm(`Delete the watcher “${w.name}”?`)) return; await Watch.remote(w, 'del', {}, 20000).catch(e => toast(`${Watch.where(w)} didn’t answer: it stops there the next time it has news`)); Watch.del(id); }
    } catch (e) { toast(e.message); }
    return Watch.sheet();
  }
  if (k === 'now' && w) { toast(`Checking ${w.name}…`); const r = await Watch.check(w).catch(() => null); toast(r?.hit ? r.hit.headline : w.state?.paused || `${w.name}: nothing new`); if ($('#sheet .wt-list') && !$('#sheet').hidden) Watch.sheet(); return; }
  if (k === 'onoff' && w) { w.on = !w.on; if (w.on) { w.state.paused = ''; w.state.next = Date.now(); } Watch.put(w); return Watch.sheet(); }
  if (k === 'del' && w) { if (!confirm(`Delete the watcher “${w.name}”?`)) return; Watch.del(id); return Watch.sheet(); }
  if (k === 'opts') return sheet('Digest and quiet hours', `<label class="se-field"><span>Daily digest at</span><input id="wtDig" value="${esc(store.get('watchDigestAt', '18:00'))}" placeholder="18:00"></label><label class="se-field"><span>Quiet hours (no notifications or voice; cards and the digest still)</span><input id="wtQuiet" value="${esc(store.get('watchQuiet', '22:00-07:00'))}"></label>`,
    [['Save', () => { if (/^\d\d:\d\d$/.test($('#wtDig').value)) store.set('watchDigestAt', $('#wtDig').value); if (/^\d\d:\d\d-\d\d:\d\d$/.test($('#wtQuiet').value)) store.set('watchQuiet', $('#wtQuiet').value); Watch.sheet(); }], ['Back', () => Watch.sheet()]]);
}, true);
