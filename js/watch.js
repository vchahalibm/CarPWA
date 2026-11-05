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
/** What a watcher can tell you about (docs/watchers.html § 11, detectors). */
const WATCH_KINDS = [['new', 'new items appear in a list'], ['gone', 'items disappear from a list'], ['changes', 'it changes'], ['value', 'a number crosses a line, or moves'], ['count', 'how many there are crosses a line'],
  ['contains', 'some words appear'], ['pattern', 'a pattern matches (advanced)'], ['appears', 'it appears (it isn’t there now)'], ['disappears', 'it disappears'], ['visual', 'it looks different (a picture of it)'], ['stale', 'nothing has changed for too long']];
const WATCH_MS = { live: 30e3, '2m': 12e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '6h': 216e5, '1d': 864e5 };
/** Where things are, for the templates (the same selectors as the tasks, js/agent.js). */
const WSEL = {
  slackReady: '.p-ia4_client||[data-qa="tab_rail_desktop"]||.p-channel_sidebar||[role="tree"]', slackItem: '.p-channel_sidebar__channel||[role="treeitem"]||[data-qa^="channel_sidebar_name_"]',
  slackHome: { do: 'agent.click', args: ['sel=[data-qa="tab_rail_home_button"]||button[aria-label="Home"]', 'optional'] }, mailReady: '[role="listbox"]||[aria-label*="Message list"]||[role="main"]',
  mailRows: '[role="listbox"] [role="option"]||[aria-label*="Message list"] [role="option"]||[data-convid]||rows-in:[role="listbox"]', waRows: '#pane-side [role="listitem"]||#pane-side [role="row"]||rows-in:#pane-side', teamsRows: '[data-tid="chat-list-item"]||[role="treeitem"]',
  teamsMsgs: '[data-tid="chat-pane-message"]', slackActivity: '[data-qa="activity-item-container"]||[data-qa="activity-item"]||rows-in:.p-view_sidebar--list--activity_inbox' /* Slack's new layout (Nov 2026): activity-item-container */, slackMsgs: '[data-qa="message_container"]||[data-qa="virtual-list-item"]', xPosts: 'article[data-testid="tweet"]',
};
/** X's addresses: the real site, or the practice copy (labs/practice/x.html). */
const xUrl = (kind, v = '') => { const base = Agent.sites().x, practice = /x\.html/.test(base);
  return kind === 'user' ? (practice ? `${base}?user=${encodeURIComponent(v.replace(/^@/, ''))}` : `https://x.com/${encodeURIComponent(v.replace(/^@/, ''))}`)
    : kind === 'search' ? (practice ? `${base}?q=${encodeURIComponent(v)}` : `https://x.com/search?q=${encodeURIComponent(v)}&f=live`)
    : kind === 'mentions' ? (practice ? `${base}?view=mentions` : 'https://x.com/notifications/mentions') : base; };
/** The templates: name, what to ask, and the watcher they make. */
const WATCH_TEMPLATES = [
  { id: 'slack.mentions', group: 'Slack', name: 'New Slack mentions', inputs: [], make: () => ({ url: '{slack}', site: 'Slack', ready: WSEL.slackReady, steps: [{ do: 'agent.click', args: ['sel=[data-qa="tab_rail_activity_button"]||button[aria-label="Activity"]', 'optional'] }, { do: 'wait', value: '1' },
    { do: 'agent.click', value: 'Mentions', args: ['sel=.p-view_sidebar [role="tab"]||.p-view_sidebar [role="radio"]||.p-view_sidebar button[aria-pressed]', 'optional'] }, { do: 'wait', value: '1' }], rows: WSEL.slackActivity, detect: { kind: 'new' } }) }, /* Activity, its Mentions filter when it has one */
  { id: 'slack.channel', group: 'Slack', name: 'New messages in a Slack channel', inputs: [['channel', 'Which channel?', 'sales']], make: v => ({ name: `Slack #${v.channel.replace(/^#/, '')}`, url: '{slack}', site: 'Slack', ready: WSEL.slackReady, jump: v.channel.replace(/^#/, ''), steps: [], rows: WSEL.slackMsgs, detect: { kind: 'new' } }) },
  { id: 'slack.person', group: 'Slack', name: 'New Slack messages from someone', inputs: [['person', 'From whom?', 'Priya Nair']], make: v => ({ name: `Slack from ${v.person}`, url: '{slack}', site: 'Slack', ready: WSEL.slackReady, jump: v.person, steps: [], rows: WSEL.slackMsgs, keep: v.person, detect: { kind: 'new' } }) },
  { id: 'slack.search', group: 'Slack', name: 'New Slack messages matching a search', inputs: [['words', 'Search for', 'invoice']], make: v => ({ name: `Slack search: ${v.words}`, url: '{slack}', site: 'Slack', ready: WSEL.slackReady,
    steps: [{ do: 'agent.click', args: ['sel=[data-qa="top_nav_search"]||button[aria-label^="Search"]', 'optional'] }, { do: 'wait', value: '0.8' }, /* optional: the search may be open already (the box instead of the button) */ { do: 'agent.type', value: 'Search', args: [v.words, 'enter', 'sel=[data-qa="search_input"]||[data-qa="focusable_search_input"] [contenteditable="true"]||[role="combobox"]||input[type="search"]'] }, { do: 'wait', value: '2.5' }],
    rows: '[data-qa="search_message_result"]||[data-qa="search_message_group"]||[data-qa="search_result"]||rows-in:[role="main"]', detect: { kind: 'new' } }) }, /* searched again in the open Slack each check */
  { id: 'slack.dms', group: 'Slack', name: 'New Slack direct messages (the DMs tab)', inputs: [], make: () => ({ name: 'Slack DMs', url: '{slack}', site: 'Slack', ready: WSEL.slackReady,
    steps: [{ do: 'agent.click', args: ['sel=[data-qa="tab_rail_dms_button"]||button[aria-label="DMs"]||button[aria-label="Direct messages"]'] }, { do: 'wait', value: '1.5' }],
    rows: '[data-qa="dms_list_item"]||.p-view_sidebar--list--dms [role="listitem"]||rows-in:.p-view_sidebar||rows-in:[role="main"]', detect: { kind: 'new' } }) },
  { id: 'slack.threads', group: 'Slack', name: 'New replies in Slack threads (Threads)', inputs: [], make: () => ({ name: 'Slack threads', url: '{slack}', site: 'Slack', ready: WSEL.slackReady,
    steps: [WSEL.slackHome, { do: 'wait', value: '0.8' }, { do: 'agent.click', value: 'Threads', args: ['sel=[data-qa="threads_view_link"]||.p-channel_sidebar__link||[role="treeitem"]||a||button'] }, { do: 'wait', value: '2' }],
    rows: '[data-qa="threads_view"] [role="listitem"]||[data-qa="thread_message"]||[data-qa="message_container"]||rows-in:[role="main"]', detect: { kind: 'new' } }) },
  { id: 'teams.chats', group: 'Teams', name: 'New Teams chats', inputs: [], make: () => ({ url: '{teams}', site: 'Teams', ready: '[data-tid="chat-list"]||[role="tree"]', rows: WSEL.teamsRows, keep: 'Unread', detect: { kind: 'new' } }) },
  { id: 'teams.chat', group: 'Teams', name: 'New messages in a Teams chat', inputs: [['person', 'Which chat?', 'Priya Nair']], make: v => ({ name: `Teams: ${v.person}`, url: '{teams}', site: 'Teams', ready: '[data-tid="chat-list"]||[role="tree"]', steps: [{ do: 'agent.click', value: v.person, args: [`sel=${WSEL.teamsRows}`] }, { do: 'wait', value: '1.5' }], rows: WSEL.teamsMsgs, detect: { kind: 'new' } }) },
  { id: 'mail.new', group: 'Outlook', name: 'New mail', inputs: [], make: () => ({ url: '{outlook}/mail/inbox', site: 'Outlook', ready: WSEL.mailReady, rows: WSEL.mailRows, detect: { kind: 'new' } }) },
  { id: 'mail.from', group: 'Outlook', name: 'New mail from someone', inputs: [['person', 'From whom?', 'Priya Nair']], make: v => ({ name: `Mail from ${v.person}`, url: '{outlook}/mail/inbox', site: 'Outlook', ready: WSEL.mailReady, rows: WSEL.mailRows, keep: v.person, detect: { kind: 'new' } }) },
  { id: 'mail.words', group: 'Outlook', name: 'New mail about something', inputs: [['words', 'Which words? (|| between choices)', 'invoice||contract']], make: v => ({ name: `Mail about ${v.words.split('||')[0]}`, url: '{outlook}/mail/inbox', site: 'Outlook', ready: WSEL.mailReady, rows: WSEL.mailRows, keep: v.words, detect: { kind: 'new' } }) },
  { id: 'wa.new', group: 'WhatsApp', name: 'New WhatsApp messages', inputs: [], make: () => ({ url: '{whatsapp}', site: 'WhatsApp', stay: true, ready: '#pane-side', rows: WSEL.waRows, keep: 'unread message', detect: { kind: 'new' } }) },
  { id: 'wa.from', group: 'WhatsApp', name: 'New WhatsApp messages from someone', inputs: [['person', 'From whom?', 'Mom']], make: v => ({ name: `WhatsApp from ${v.person}`, url: '{whatsapp}', site: 'WhatsApp', stay: true, ready: '#pane-side', rows: WSEL.waRows, keep: v.person, detect: { kind: 'new' } }) },
  { id: 'x.timeline', group: 'X', name: 'New posts on my X timeline', inputs: [], make: () => ({ url: xUrl('home'), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'x.user', group: 'X', name: 'New posts by an X account', inputs: [['handle', 'Which account? (@name)', '@acme']], make: v => ({ name: `X: ${v.handle}`, url: xUrl('user', v.handle), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'x.search', group: 'X', name: 'New X posts matching a search', inputs: [['words', 'Search for', 'Acme']], make: v => ({ name: `X search: ${v.words}`, url: xUrl('search', v.words), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'x.mentions', group: 'X', name: 'New X mentions of me', inputs: [], make: () => ({ url: xUrl('mentions'), site: 'X', ready: '[data-testid="primaryColumn"]', rows: WSEL.xPosts, detect: { kind: 'new' }, every: '30m' }) },
  { id: 'page.changes', group: 'Web pages', name: 'A web page changes', inputs: [['url', 'Which page? (its address)', 'https://example.com']], make: v => ({ name: `Changes: ${v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}`, url: v.url, read: 'main||article||[role="main"]||body', detect: { kind: 'changes' }, every: '1h' }) },
  { id: 'page.words', group: 'Web pages', name: 'Words appear on a web page', inputs: [['url', 'Which page?', 'https://example.com'], ['words', 'Which words? (|| between choices)', 'in stock']], make: v => ({ name: `“${v.words.split('||')[0]}” on ${v.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}`, url: v.url, read: 'body', detect: { kind: 'contains', words: v.words }, every: '1h' }) },
];
const Watch = {
  list: () => store.get('watchers', []),
  put(w) { const l = Watch.list(), i = l.findIndex(x => x.id === w.id); if (i >= 0) l[i] = w; else l.push(w); store.set('watchers', l); if (i < 0) Watch.counted(); },
  del(id) { store.set('watchers', Watch.list().filter(w => w.id !== id)); Watch.counted(); },
  /** The “👁 Watchers · n” on the Agent screen and in Settings, kept in step when one is made or deleted. */
  counted() { const n = Watch.list().filter(w => !w.origin).length; $$('.wt-count').forEach(e => { e.textContent = n ? ` · ${n}` : ''; }); },
  get: id => Watch.list().find(w => w.id === id),
  can: () => typeof AgentWeb !== 'undefined' && AgentWeb.can(),
  running: new Set(),
  /** A new watcher from a template or Watch something here: { name, url, site, ready, steps, rows | read, keep, detect, every, tell }. */
  make(o) {
    return { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), on: true, created: Date.now(), runOn: 'here', every: '15m', tell: { card: true, toast: true, speak: 'important', digest: true }, ...o, state: { seen: [], fails: 0 } };
  },

  /* ---------- One check ---------- */
  /** The row as an identity: without times, counts and “now”, so a row isn't new just because its clock moved. */
  ident(line) { return plain(String(line).replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, ' ').replace(/(\s\d{1,3})?\s*\(\d+ unread[^)]*\)|\b\d+ unread\b/gi, ' ').replace(/^((unread|read|flagged|pinned|important|unread chat|chat)[,\s]+)+/i, ' ') /* a row read since, with its count badge */.replace(/\b(\d+\s*(s|m|h|d|min|mins|minutes|hours?|days?)( ago)?|now|yesterday|today)\b/gi, ' ')).slice(0, 300); },
  /** A page's text without what moves by itself: dates, clock times, “5 min ago” (not “30 days”: that's content). */
  changeKey(t) { return plain(this.undate(t).replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/gi, ' ').replace(/\b\d+\s*(s|m|h|d)\b(?!\w)/g, ' ').replace(/\b\d+\s*(sec|secs|seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?)\s+ago\b/gi, ' ').replace(/\b(just now|yesterday|today)\b/gi, ' ')).slice(0, 300); },
  /** Dates out of a page's text, for “it changes” (not for list rows: two mails may differ only by their date). */
  undate(t) {
    const M = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
    return String(t).replace(new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+${M},?(\\s+\\d{4})?\\b`, 'gi'), ' ').replace(new RegExp(`\\b${M}\\s+\\d{1,2}(st|nd|rd|th)?,?(\\s+\\d{4})?\\b`, 'gi'), ' ')
      .replace(/\b\d{4}-\d{2}-\d{2}(t[\d:.]+z?)?\b/gi, ' ').replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ');
  },
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); },
  /** What the source gives: lines (rows) or one text. */
  async read(w, trace) {
    const k = w.source || (w.task ? 'task' : 'page');
    if (k === 'hook' || k === 'chain') return (w.state.inbox || []).splice(0);
    if (k === 'gmaps') return MapWatch.read(w, trace); /* map watchers (js/mapwatch.js) */ /* what arrived since the last check (hookIn, chainOut) */
    if (k === 'files') {
      if (!window.DriveDeckDesktop?.files) throw new Error('Folders and files are watched by StudioGen on a Mac');
      if (w.file && w.detect?.kind !== 'new') { const r = await DriveDeckDesktop.files('read', { path: w.path }); if (r?.error) throw new Error(r.error); return r.text; }
      const r = await DriveDeckDesktop.files('list', { path: w.path, depth: w.depth || 1 }); if (r?.error) throw new Error(r.error);
      const size = b => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} bytes`;
      return r.entries.filter(e => !e.dir).sort((a, b) => b.mtime - a.mtime).map(e => `${e.p} · ${size(e.size)} · ${new Date(e.mtime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`);
    }
    if (k === 'window') return this.windowText(w);
    if (k === 'feed' || k === 'json') {
      if (!window.DriveDeckDesktop?.fetch) throw new Error('Feeds are read by StudioGen on a Mac');
      let r = await DriveDeckDesktop.fetch(w.feedUrl || w.url); if (r?.error || r.status >= 400) throw new Error(r?.error || `The address answered ${r.status}`);
      if (k === 'feed' && !w.feedUrl && /<html[\s>]|<!doctype html/i.test(r.text.slice(0, 3000))) { /* a web page: its own feed, if it names one (blogs, YouTube channels, status pages) */
        const l = r.text.match(/<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*>/i), h = l?.[0].match(/href=["']([^"']+)["']/i)?.[1];
        if (!h) throw new Error('That page doesn’t name a feed (RSS or Atom)');
        w.feedUrl = new URL(h.replace(/&amp;/g, '&'), w.url).href; r = await DriveDeckDesktop.fetch(w.feedUrl); if (r?.error || r.status >= 400) throw new Error(r?.error || `Its feed answered ${r.status}`);
      }
      if (k === 'json') { let v; try { v = JSON.parse(r.text); } catch { throw new Error('That address didn’t give JSON'); } for (const p of String(w.path || '').split('.').filter(Boolean)) v = v?.[/^\d+$/.test(p) ? +p : p]; return typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); }
      const doc = new DOMParser().parseFromString(r.text, 'text/xml'), items = [...doc.querySelectorAll('item, entry')];
      if (!items.length) throw new Error('No feed items there (is it an RSS or Atom address?)');
      return items.slice(0, 50).map(i => [i.querySelector('title')?.textContent, i.querySelector('link')?.textContent || i.querySelector('link')?.getAttribute('href')].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim());
    }
    if (k === 'task') { const t = Agent.get(w.task); if (!t) throw new Error('That task isn’t here any more'); const c = Agent.asCard(await Agent.exec(t, w.inputs || {}, { confirmed: true, quiet: true })); return [c.headline, ...(c.items || []).map(i => [i.title, i.detail].filter(Boolean).join(' · '))].filter(Boolean); }
    // a page, opened (or kept open: live) in the agent browser, its steps, then the part read
    if (!w.jump && /^slack\.(channel|person)$/.test(w.template || '')) { w.jump = String(w.templateInputs?.channel || w.templateInputs?.person || '').replace(/^#/, ''); if (w.jump) w.steps = []; } /* made before Jump to: it clicked the sidebar, which isn't on every tab */
    if (w.jump && (!w.jumped || this.elsewhere(w))) await this.jumpTo(w, trace); /* a Slack channel or person: found with Jump to, then its own address; inside the open Slack, moved there with Jump to (no reload) */
    const sel = w.rows || w.read || 'body', url = String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m);
    const t = { id: `watch.${w.id}`, name: w.name, runs: 'mac', container: w.container || '', result: 'read',
      // the page opens waiting for its frame only (a part that's gone mustn't look like a page that didn't open: self-healing
      // needs the page), then up to 15 s for the part itself (pages that fill in late)
      steps: [{ do: 'agent.open', value: url, args: [`site=${w.site || new URL(url).hostname}`, `wait=${w.ready && !sel.split('||').includes(w.ready) ? w.ready : 'body'}`, 'ms=30000', ...(w.every === 'live' || w.stay || this.tplStay(w) || this.appSite(url) ? ['stay'] : [])] }, /* stay: a page that updates itself (WhatsApp, Slack, Outlook…) is read where it is, not reloaded each check */
        ...(w.steps || []), ...(w.detect?.kind === 'appears' || w.detect?.kind === 'disappears' ? [] : [{ do: 'agent.wait', value: sel, args: ['ms=15000'] }]), w.detect?.kind === 'appears' || w.detect?.kind === 'disappears' ? { do: 'agent.wait', value: sel, args: ['ms=3000'], as: 'read' } : { do: 'agent.read', value: sel, args: [`max=${w.rows ? 12000 : 20000}`, 'strict', ...(w.keep ? [`keep=${w.keep}`] : [])], as: 'read' }] };
    let out, byModel = false; try { out = await Agent.exec(t, {}, { confirmed: true, quiet: true, trace }); }
    catch (e) { if (!/^NOTFOUND:/.test(e.message)) throw e;
      { const v = AgentWeb.views.get(this.viewKey(w)); await new Promise(r => setTimeout(r, 3000)); const again = v && await AgentWeb.call('read', [sel, w.rows ? 12000 : 20000], 20000, { view: v }); /* just loaded: once more, 3 s later */
        trace?.push(`  read again after 3 s: ${(again?.tried || []).map(([x, n]) => `${x.length > 40 ? x.slice(0, 37) + '…' : x} → ${n}`).join(' · ') || 'no answer'}`);
        if (again?.ok && again.sel !== 'body') { let txt = again.text; if (w.keep) { const ks = w.keep.toLowerCase().split('||').map(k => k.trim()).filter(Boolean); txt = txt.split('\n').filter(l => ks.some(k => l.toLowerCase().includes(k))).join('\n') || '(none)'; } out = txt; } }
      if (out === undefined)
      try { out = await this.heal(w, url); } catch (h) { if (!w.extract || !/^GONE:|^CONFIRM:/.test(h.message)) throw h; byModel = true; w.state.proposal = null; out = (await AgentWeb.call('read', ['body', 20000], 20000, { view: AgentWeb.views.get(this.viewKey(w)) })).text; } } /* the model reads the price from the whole page */
    if (w.detect?.kind === 'appears' || w.detect?.kind === 'disappears') return !!out;
    if (w.detect?.kind === 'visual') return this.shot(w, sel);
    if (w.extract && (!w.extract.fallback || byModel)) return this.extract(w, String(out ?? '')); /* fallback: only when the selectors found nothing */
    const text = String(out ?? ''); if (text === '(none)') return [];
    return w.rows ? text.split('\n').map(l => l.trim()).filter(Boolean) : text.replace(/ ¦ /g, ' ');
  },
  /** Fields the model pulls out of what was read (“the price and whether it's in stock”): { price, in_stock, … }. */
  async extract(w, text) {
    if (typeof Intent === 'undefined' || !Intent.can()) throw new Error('Pulling out fields needs the language model (Settings › Assistant › Language model)');
    const f = [].concat(w.extract.fields || w.extract), props = Object.fromEntries(f.map(k => [k, /price|cost|amount|total|count|number|rating|seats|stock_count/.test(k) ? { type: ['number', 'null'] } : /^(in_|is_|has_|available)/.test(k) ? { type: ['boolean', 'null'] } : { type: ['string', 'null'] }]));
    const j = (await LLM.ask('fast', { system: LLM.prompt('watch.extract', { fields: f.join(', '), about: w.extract.about || w.name }), prompt: text.slice(0, 12000), schema: { type: 'object', required: f, properties: props }, temperature: 0 })).json;
    if (!j) throw new Error('The model didn’t find those on the page'); return j;
  },
  /** A small grey picture of the part (visual changes): 32×32, as text. */
  async shot(w, sel) {
    const v = AgentWeb.views.get(this.viewKey(w)); if (!v) throw new Error('The page isn’t open');
    const r = await AgentWeb.call('rect', [sel], 8000, { view: v }); if (!r?.ok) throw new Error(`NOTFOUND:${sel}`);
    const R = r.rect, img = await v.wv.capturePage({ x: Math.max(0, Math.round(R.x)), y: Math.max(0, Math.round(R.y)), width: Math.max(1, Math.round(R.w)), height: Math.max(1, Math.round(R.h)) });
    const bmp = img.resize({ width: 32, height: 32 }).toBitmap(); let out = ''; /* BGRA */
    for (let i = 0; i < bmp.length; i += 4) out += String.fromCharCode(Math.round(bmp[i] * 0.114 + bmp[i + 1] * 0.587 + bmp[i + 2] * 0.299));
    return { sig: btoa(out) };
  },
  /** An app window on this Mac, read by the screen model: its lines top to bottom (needs Screen Recording). */
  async windowText(w) {
    if (!window.DriveDeckDesktop?.windows) throw new Error('App windows are watched by StudioGen on a Mac');
    const r = await DriveDeckDesktop.windows('shot', { name: w.window }); if (r?.error) throw new Error(/Screen Recording/.test(r.error) || r.access === 'denied' ? 'PERM:screen' : r.error);
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Couldn’t read the picture of that window')); i.src = r.png; });
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0);
    const lines = (await ScreenAI.read(null, { canvas: c, k: 1 })).sort((a, b) => Math.round(a.box[1] / 8) - Math.round(b.box[1] / 8) || a.box[0] - b.box[0]).map(l => l.text).filter((l, i, all) => all.findIndex(x => x.replace(/\s/g, '').toLowerCase() === l.replace(/\s/g, '').toLowerCase()) === i); /* the tiles overlap: once each */
    return w.detect?.kind === 'new' || w.detect?.kind === 'gone' ? lines : lines.join('\n');
  },
  /** Whether a watcher's template keeps its page open (watchers made before a template said so learn it here). */
  /** Slack: go to a channel or person with Jump to (Cmd/Ctrl+K, the name, Enter), whichever tab Slack opened on, and keep the
      address it lands on (…/client/<team>/<channel>): later checks open that directly. */
  /** Sites that are apps (they update themselves): a watcher reads the open window where it is instead of loading it again,
      so all the Slack watchers share one Slack, all the Outlook ones one Outlook (each loaded again after 45 minutes). */
  appSite(url) { try { const u = new URL(url, location.href); return /(^|\.)(slack\.com|outlook\.(office|live)\.com|outlook\.cloud\.microsoft|teams\.microsoft\.com|teams\.live\.com|web\.whatsapp\.com|x\.com|twitter\.com)$/.test(u.hostname) || /\/labs\/practice\/(slack|inbox|teams|whatsapp|x)\.html$/.test(u.pathname); } catch { return false; } },
  /** The open, fresh Slack shows another channel than this watcher's: moving there inside it beats loading Slack again. */
  elsewhere(w) {
    const v = AgentWeb.views.get(this.viewKey(w)); let cur = ''; try { cur = v?.wv.getURL() || ''; } catch {}
    return !!cur && Date.now() - (v.loadedAt || 0) < 45 * 60000 && /^https?:|^app:/.test(w.url || '') && (() => { try { return new URL(cur).host === new URL(w.url).host && !cur.startsWith(w.url); } catch { return false; } })();
  },
  async jumpTo(w, trace) {
    const ctx = { quiet: true }, sleep = ms => new Promise(r => setTimeout(r, ms)), home = String(w.jumped ? w.url : w.url || '{slack}').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m);
    if (w.jumped && this.elsewhere(w)) ctx.view = AgentWeb.views.get(this.viewKey(w)); /* Slack is open: Jump to inside it */
    else { await AgentWeb.go(home, w.container, ctx); await AgentWeb.call('waitFor', [{ sel: WSEL.slackReady }, 20000], 22000, ctx); }
    const was = AgentWeb.url(ctx), mac = /Mac/i.test(navigator.platform || navigator.userAgent), at = u => u.match(/^(.*\/client\/[^/]+\/[CDG][A-Z0-9]+)/)?.[1] || (/[?&]ch=/.test(u) ? u : '');
    let id = ''; /* a hidden page has no focus (so :focus never matches): whether it worked shows in the address */
    for (const k of mac ? ['Meta+K', 'Ctrl+K'] : ['Ctrl+K']) {
      AgentWeb.key(k, ctx); await sleep(900); await AgentWeb.insert(w.jump, ctx); await sleep(1800); AgentWeb.key('Enter', ctx); await sleep(2500);
      const now = AgentWeb.url(ctx); if (now !== was && at(now)) { id = at(now); break; } AgentWeb.key('Escape', ctx); await sleep(400);
    }
    if (!id) throw new Error(`Slack’s Jump to didn’t find “${w.jump}”`);
    const moved = w.jumped; w.url = id; w.jumped = true; w.steps = []; trace?.push(moved ? `  moved to “${w.jump}” inside the open Slack (Jump to)` : `  found “${w.jump}” with Jump to: ${w.url.replace(/^https?:\/\//, '').slice(0, 70)}`); this.put(w);
  },
  tplStay(w) { const T = w.template && WATCH_TEMPLATES.find(t => t.id === w.template); if (!T) return false; try { return !!T.make(Object.fromEntries(T.inputs.map(([k, , ph]) => [k, ph || 'x']))).stay; } catch { return false; } },
  /** The browser a page watcher uses ('container|site', as Agent.containersOf): a live one stays open there. */
  viewKey(w) { const url = w.source === 'gmaps' ? MapWatch.dirUrl({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }) : String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m); try { return `${Containers.for(url, w.container).id}|${AgentWeb.siteKey(url)}`; } catch { return ''; } },
  /** Self-healing: the part's selector found nothing on the page just read; its other finders are tried on the same page,
      and the first that finds it is kept (noted in the log and the list). None: GONE (it asks you to pick it again). */
  async heal(w, url) {
    const v = AgentWeb.views.get(this.viewKey(w)), was = w.rows || w.read;
    // a watcher from a template also tries the template's selectors as they are now (templates get fixed when sites change;
    // older watchers made from them pick that up here)
    const T = w.template && WATCH_TEMPLATES.find(t => t.id === w.template);
    let fresh = '', made = null; try { made = T && T.make({ ...Object.fromEntries(T.inputs.map(([k, , ph]) => [k, ph || ''])), ...(w.templateInputs || {}) }); fresh = made && (w.rows ? made.rows : made.read) || ''; } catch {}
    for (const f of [...(w.finders || []), fresh].filter(f => f && f !== was)) {
      const r = await AgentWeb.call('read', [f, w.rows ? 12000 : 20000], 20000, { view: v });
      if (!r?.ok || r.sel === 'body') continue;
      if (w.rows) w.rows = f; else w.read = f;
      if (f === fresh && made) { if (made.ready) w.ready = made.ready; if (made.steps) w.steps = made.steps; } /* the template's way there, as it is now */
      w.finders = [f, ...(w.finders || []).filter(x => x !== f), was].filter((x, i, l) => x && l.indexOf(x) === i).slice(0, 8);
      w.state.healed = { at: Date.now(), from: was, to: f }; if (w.state.count == null && !(w.state.seen || []).length && w.state.last == null && w.state.value == null) w.state.rebase = true; /* it never read anything: what's there now is the starting point, not news */ Log.i('watch', `Found it again another way: ${w.name}`, { from: was, to: f });
      if (!w.keep) return r.text;
      const ks = w.keep.toLowerCase().split('||').map(k => k.trim()).filter(Boolean);
      return r.text.split('\n').filter(l => ks.some(k => l.toLowerCase().includes(k))).join('\n') || '(none)';
    }
    // its words (the text it had when picked), then the screen model on a picture of the page; you're asked once
    const where = w.what && await AgentWeb.call('findText', [w.what.slice(0, 60)], 8000, { view: v }).catch(() => null);
    let pt = where?.ok ? [where.rect.x + where.rect.w / 2, where.rect.y + where.rect.h / 2] : null, how = 'its words';
    if (!pt && w.what && typeof ScreenAI !== 'undefined' && v) try {
      const img = await v.wv.capturePage(), z = img.getSize(), c = Object.assign(document.createElement('canvas'), { width: z.width, height: z.height }), k = z.width / (v.wv.clientWidth || z.width);
      const pic = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = img.toDataURL(); }); c.getContext('2d').drawImage(pic, 0, 0);
      const { result, map } = await ScreenAI.run('<CAPTION_TO_PHRASE_GROUNDING>', w.what.slice(0, 80), null, { canvas: c, k }, { x: 0, y: 0, w: z.width / k, h: z.height / k });
      const b = result?.bboxes?.[0]?.map(map); if (b) { pt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; how = 'the screen model'; }
    } catch (e) { Log.w('watch', 'Screen model fallback', e.message); }
    const at = pt && await AgentWeb.call('cssAt', [pt[0], pt[1], !!w.rows], 5000, { view: v });
    if (at?.ok) { w.state.proposal = { sel: at.css, text: at.text, how }; throw new Error(`CONFIRM:${at.text.slice(0, 80)}`); }
    throw new Error(`GONE:${url}`);
  },
  /** “Is this it?”: yes keeps what the words or the screen model found. */
  healYes(w) { const p = w.state.proposal; if (!p) return; if (w.rows) w.rows = p.sel; else w.read = p.sel; w.finders = [p.sel, ...(w.finders || [])].slice(0, 8); w.state.healed = { at: Date.now(), to: p.sel, how: p.how }; w.state.proposal = null; w.state.paused = ''; w.state.at = 0; w.state.next = Date.now(); this.put(w); toast(`${w.name}: watching it again`); },
  /** A live watcher's part changed (the bridge's observer, via AgentWeb): check it now, at most every 10 s. */
  /** How long between checks: its every; a map watcher on live still every 5 minutes (it reopens Google Maps each time). */
  gap(w) { return w.source === 'gmaps' && w.every === 'live' ? WATCH_MS['5m'] : WATCH_MS[w.every] || 9e5; },
  /** A live page changed: check it, at least 30 s apart, longer (to 8 min) while the changes bring nothing new (a page that
      keeps redrawing itself, like Outlook's list, mustn't keep the agent browser busy). */
  poke(key) {
    for (const w of this.list()) if (w.on && w.every === 'live' && w.source !== 'gmaps' && (!w.runOn || w.runOn === 'here') && !w.state?.paused && !this.running.has(w.id) && Date.now() - (w.state?.at || 0) > 30000 * 2 ** Math.min(4, w.state?.pokeQuiet || 0) && this.viewKey(w) === key) { Log.d('watch', `Changed: ${w.name}`); this.check(w, { poked: true }); }
  },
  /** Filters before deciding: ignore lines (ads, clocks: words, || between), only from / not from people (rows). */
  filter(w, got) {
    const f = w.filter || {}, list = x => String(x || '').toLowerCase().split('||').map(t => t.trim()).filter(Boolean);
    const ig = list(f.ignore), from = list(f.from), not = list(f.notFrom), keep = l => { const t = l.toLowerCase(); return !ig.some(x => t.includes(x)) && (!from.length || from.some(x => t.includes(x))) && !not.some(x => t.includes(x)); };
    if (Array.isArray(got)) return got.filter(keep);
    if (typeof got === 'string' && ig.length) return got.split(/\n|(?<=[.!?])\s+(?=[A-Z0-9“"])/).filter(l => !ig.some(x => l.toLowerCase().includes(x))).join('\n'); /* lines, else sentences */
    return got;
  },
  /** A condition that holds or not: told once when it has held for `hold` checks in a row; again only after it stops. */
  cross(w, want) { const s = w.state, n = Math.max(1, +w.filter?.hold || 1); s.streak = want ? (s.streak || 0) + 1 : 0; s.hit = want; return want && s.streak === n; },
  /** What counts, from what was read and what was seen before: { headline, items, value } or nothing. */
  detect(w, got) {
    if (w.source === 'gmaps' && typeof MapWatch !== 'undefined') return MapWatch.detect(w, got); /* traffic, faster, leaveby */
    const d = w.detect || { kind: 'changes' }, s = w.state || (w.state = { seen: [] }), first = !s.at || !!s.rebase, id = r => this.hash(w.rawIds ? String(r) : this.ident(r));
    got = this.filter(w, got); delete s.rebase;
    if (got && typeof got === 'object' && !Array.isArray(got) && !got.sig) { s.fields = got; got = d.field ? got[d.field] ?? '' : JSON.stringify(got); } /* fields the model pulled out */
    if (d.kind === 'new' || d.kind === 'gone') {
      const rows = [].concat(got).map(String), now = new Set(rows.map(id)), fresh = d.kind === 'new' ? rows.filter(r => !s.seen.includes(id(r))) : [];
      const gone = (d.kind === 'gone' || d.gone) && s.rows ? s.rows.filter(([h]) => !now.has(h)).map(([, t]) => t) : [];
      s.seen = [...new Set([...rows.map(id), ...s.seen])].slice(0, 400); s.rows = rows.slice(0, 200).map(r => [id(r), r]);
      if (first || (!fresh.length && !gone.length)) return null;
      // moved: one gone and one new that start the same (a meeting at a new time)
      const key = r => plain(String(r).replace(/^((unread|unread chat|chat)[,\s]+)+/i, '').split(/,| · |\s\d{1,2}:\d{2}/)[0]).split(' ').slice(0, 4).join(' '), /* its name: before the first comma or time */ moved = fresh.filter(r => gone.some(g => key(g) === key(r)));
      const added = fresh.filter(r => !moved.includes(r)), cancelled = gone.filter(g => !moved.some(r => key(r) === key(g)));
      const items = [...moved.map(r => ({ ...this.item(r), title: `Moved: ${this.item(r).title}` })), ...added.map(r => this.item(r)), ...cancelled.map(g => ({ ...this.item(g), title: `Gone: ${this.item(g).title}` }))].slice(0, 6);
      const parts = [moved.length && `${moved.length} moved`, added.length && `${added.length} new`, cancelled.length && `${cancelled.length} gone`].filter(Boolean);
      const one = items.length === 1 && !moved.length && !cancelled.length;
      for (const i of items) if (i.unread) i.title = `${i.title} · ${i.unread} unread`;
      const names = items.map(i => i.title.replace(/^(Moved|Gone): /, '')).filter(Boolean), many = !one && !moved.length && !cancelled.length && names.length > 1;
      const said = one && items[0].detail && plain(w.name).includes(plain(items[0].title.replace(/ · \d+ unread$/, ''))) ? items[0].detail : one && [items[0].title.replace(/ · \d+ unread$/, ''), items[0].detail].filter(Boolean).join(' — '); /* “WhatsApp from Mom: …”, not “…: Mom · …” */
      return { headline: one ? `${w.name}: ${said.slice(0, 120)}` : many ? `${w.name}: ${names.slice(0, 2).map(x => x.replace(/ · (\d+) unread$/, ' ($1)')).join(', ')}${fresh.length > 2 ? ` and ${fresh.length - 2} more` : ''}` : `${w.name}: ${parts.join(', ')}`, items, count: rows.length };
    }
    if (d.kind === 'changes' || d.kind === 'stale') {
      const text = Array.isArray(got) ? got.join('\n') : String(got), norm = this.changeKey(text.replace(/\n/g, ' ')), was = s.last; /* a date or a clock moving (“Updated 2 Nov 2026 11:30”) isn't a change */
      s.last = text.slice(0, 20000); s.lastNorm = norm;
      if (first || norm !== s.prevNorm) s.sameSince = Date.now();
      if (d.kind === 'stale') { s.prevNorm = norm; const mins = +d.mins || 1440, want = Date.now() - (s.sameSince || Date.now()) > mins * 60000; return first ? (this.cross(w, want), null) : this.cross(w, want) ? { headline: `${w.name}: nothing has changed for ${mins >= 1440 ? `${Math.round(mins / 1440)} day${mins >= 2880 ? 's' : ''}` : mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`}`, items: [] } : null; }
      if (first || norm === s.prevNorm || !was) { s.prevNorm = norm; return null; }
      s.prevNorm = norm;
      const bits = x => x.split(/\n|(?<=[.!?])\s+(?=[A-Z0-9“"])/).map(l => l.trim()).filter(Boolean); /* lines, else sentences (a part is read as one line) */
      const a = new Set(bits(was)), b = bits(text), moved = l => this.changeKey(l), a0 = b.filter(l => !a.has(l)), g0 = [...a].filter(l => !b.includes(l)), ai = new Set(a0.map(moved)), gi = new Set(g0.map(moved));
      const added = a0.filter(l => !gi.has(moved(l))), gone = g0.filter(l => !ai.has(moved(l))); /* not lines where only a time or count moved */
      if (!added.length && !gone.length) return null;
      return { headline: `${w.name}: changed`, items: [...added.slice(0, 4).map(l => ({ title: 'Now', detail: l.slice(0, 160) })), ...gone.slice(0, 2).map(l => ({ title: 'Was', detail: l.slice(0, 160) }))] };
    }
    if (d.kind === 'value' || d.kind === 'count') {
      const text = Array.isArray(got) ? got.join(' ') : String(got), m = text.replace(/,(?=\d{2,3}\b)/g, '').match(/-?\d+(\.\d+)?/);
      const v = d.kind === 'count' ? (Array.isArray(got) ? got.length : m ? +m[0] : NaN) : m ? +m[0] : NaN;
      if (isNaN(v)) throw new Error(`No number in what it reads (“${text.slice(0, 60)}”)`);
      const was = s.value; s.value = v; if (first || was == null) return null;
      const c = String(d.cond || 'changes').toLowerCase(), n = +(c.match(/-?\d+(\.\d+)?/) || [])[0], pct = /%/.test(c) ? Math.abs(v - was) / Math.max(1e-9, Math.abs(was)) * 100 : 0;
      const hit = /%/.test(c) ? pct >= n && (/drop|fall|down/.test(c) ? v < was : /rise|up/.test(c) ? v > was : true) : /below|under|less/.test(c) ? v < n : /above|over|more/.test(c) ? v > n : /drop|fall|down/.test(c) ? v < was : /rise|up/.test(c) ? v > was : v !== was;
      const moving = !/below|under|less|above|over|more/.test(c) || /%/.test(c); /* a change, not a state: told each time it happens */
      if (moving ? !hit : !this.cross(w, hit)) return null;
      return { headline: `${w.name}: ${d.kind === 'count' ? `${v} (was ${was})` : `${was} → ${v}`}`, items: [{ title: 'Now', detail: String(v) }, { title: 'Was', detail: String(was) }], value: v };
    }
    if (d.kind === 'contains' || d.kind === 'pattern') {
      const text = Array.isArray(got) ? got.join('\n') : String(got), words = String(d.words || '').toLowerCase().split('||').map(x => x.trim()).filter(Boolean);
      let re = null; if (d.kind === 'pattern') try { re = new RegExp(d.re || d.words || '.', 'i'); } catch { throw new Error('That pattern isn’t valid'); }
      const found = re ? (text.match(re) || [])[0] : words.find(x => text.toLowerCase().includes(x)), want = d.not ? !found : !!found;
      if (first) { this.cross(w, want); return null; }
      if (!this.cross(w, want)) return null;
      if (d.field && /^(true|false)$/.test(String(got))) return { headline: `${w.name}: ${d.field.replace(/_/g, ' ')} ${d.not ? 'no more' : 'now'}`, items: [] }; /* in_stock: “in stock now” */
      return { headline: d.not ? `“${words[0] || d.re}” is gone from ${w.name}` : `${w.name}: “${String(found).slice(0, 60)}”`, items: [] };
    }
    if (d.kind === 'appears' || d.kind === 'disappears') {
      const want = d.kind === 'appears' ? !!got : !got; if (first) { this.cross(w, want); return null; }
      if (!this.cross(w, want)) return null;
      return { headline: `${w.name}: ${d.kind === 'appears' ? 'it’s there now' : 'it’s gone'}`, items: [] };
    }
    if (d.kind === 'visual') { /* a picture of the part, 32×32 grey: told when it differs by more than pct */
      const sig = got?.sig || '', was = s.sig; s.sig = sig; if (first || !was || !sig) return null;
      const a = atob(was), b = atob(sig); let diff = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs(a.charCodeAt(i) - b.charCodeAt(i));
      const pct = diff / (Math.min(a.length, b.length) * 255) * 100; s.visualPct = Math.round(pct * 10) / 10;
      return pct >= (+d.pct || 8) ? { headline: `${w.name}: looks different (${Math.round(pct)}%)`, items: [], value: Math.round(pct) } : null;
    }
    return null;
  },
  /** A row as a card item: “who · what” where it can tell. */
  item(r) {
    if (String(r).includes(' ¦ ')) return this.rowItem(r);
    const t = String(r).replace(/^((unread|unread chat|chat)[,\s]+)+/i, '').replace(/\s(\d{1,3})\s*\((\d+) unread/i, (m, a, b) => a === b ? ` (${b} unread` : m).replace(/\(\d+ unread[^)]*\)/gi, '').replace(/\s+/g, ' ').trim(); /* a badge showing the same number as its “(n unread)” */
    let m = t.match(/^\[([^\]]{3,40})\]\s*([^:]{1,40}):\s*(.+?)(?:\s+\d{1,2}:\d{2}(?:\s*[ap]m)?)?$/i); if (m) return { title: m[2].trim(), when: m[1].split(',')[0].trim(), detail: m[3].slice(0, 160) }; /* a WhatsApp message: [10:05, 01/11/2026] Varun: text */
    m = t.match(/^(.+?)\s*(@\w+)\s*·\s*(\S+)\s+(.+)$/); if (m) return { title: `${m[1]} (${m[2]})`, when: m[3], detail: m[4].slice(0, 160) }; /* a post: name @handle · when text */
    m = t.match(/^(.*?)\s*\b(\d{1,2}:\d{2}(?:\s*[ap]m)?)\s+(.+)$/i); /* who time what (chats), or time who what (mail) */
    if (m) { const rest = m[3].replace(/^·\s*/, ''); return m[1] ? { title: m[1], when: m[2], detail: rest.slice(0, 160) } : rest.includes(' · ') ? { title: rest.split(' · ')[0].slice(0, 160), when: m[2], detail: rest.split(' · ').slice(1).join(' · ').slice(0, 160) } : { title: rest.slice(0, 160), when: m[2] }; }
    m = t.match(/^(.+?) · (.+)$/); if (m) return { title: m[1].slice(0, 160), detail: m[2].slice(0, 160) }; /* a file: name · size · when; a webhook: when · what */
    return { title: t.slice(0, 160) };
  },
  /** A list row read as its parts (name ¦ time ¦ preview…, js bridge read): title = the name (with its unread count),
      when = its time, detail = the rest (the sender in a group: their name, then the message), links shortened. */
  rowItem(r) {
    let t = String(r).trim(); const n = +(t.match(/\((\d+) unread[^)]*\)/i) || [])[1] || 0; t = t.replace(/\s*\(\d+ unread[^)]*\)/gi, '');
    let p = t.split(' ¦ ').map(x => x.trim()).filter(Boolean).filter(x => !/^\d{1,3}$/.test(x) && !/^(unread|unread chat|chat)$/i.test(x)); /* badge digits, state words */
    const isWhen = x => /^(\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?|now|today|yesterday|(mon|tues|wednes|thurs|fri|satur|sun)day|mon|tue|wed|thu|fri|sat|sun|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})$/i.test(x);
    let when = p.find(isWhen); p = p.filter(x => x !== when);
    if (!when && p[0]) { const m = p[0].match(/^(.*?[^\d\s:])\s*(\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?)$/i); if (m) { p[0] = m[1]; when = m[2]; } } /* “Priya Nair 9:41 AM”: a name and its time on one line (Slack) */
    if (p[0]) { p[0] = p[0].replace(/^((unread|read|flagged|pinned)[,\s]+)+/i, '').trim(); if (!p[0] || /^(unread|read|flagged|pinned)$/i.test(p[0])) p.shift(); } /* “Unread 9:12” (Outlook): the first piece is its state, not its name */
    const short = x => x.replace(/https?:\/\/(www\.)?([^/\s]+)(\/\S*)?/g, (m, w, host, path) => path && path.length > 1 ? `${host}/…` : host).replace(/^~\s*/, '').replace(/\s+:\s+/, ': ');
    const title = short(p[0] || ''), detail = short(p.slice(1).join(' · ').replace(/\s*·\s*:\s*(·\s*)?/g, ': ')); /* “~Rai Singh Gill ¦ : ¦ link” → “Rai Singh Gill: link” */
    return { title: title.slice(0, 80), ...(n ? { unread: n } : {}), ...(when ? { when } : {}), ...(detail ? { detail: detail.slice(0, 140) } : {}) };
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
    if (w.origin) return this.send(w.origin, { id: w.originId, headline: hit.headline, items: hit.items || [], value: hit.value, important: !!verdict?.important, why: verdict?.why || '', state: this.brief(w) }).then(r => { if (r?.error === 'No such watcher here') { this.del(w.id); Log.i('watch', `Deleted there, so stopped here: ${w.name}`); } }); /* run here for another StudioGen of yours: it tells */
    const t = w.tell || {}, quiet = this.quiet(w), presenting = typeof Script !== 'undefined' && Script.running;
    const card = { task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'list', headline: hit.headline, items: hit.items || [], status: 'done', watch: w.id, ...(verdict?.why ? { why: verdict.why } : {}), ...(hit.link ? { link: hit.link } : {}), ...(hit.shot ? { shot: Agent.img(hit.shot) } : {}), ...(hit.take ? { take: hit.take } : {}), ...(hit.share ? { share: hit.share } : {}) };
    if (t.card !== false) { const c = Agent.post(card); Agent.log({ id: c.id, kind: 'watch', title: card.title, status: 'done', headline: hit.headline, items: hit.items }); }
    if (t.toast !== false && !quiet) toast(`👁 ${hit.headline}`);
    if (!quiet && !presenting && (t.speak === 'always' || (t.speak === 'important' && (verdict?.important || hit.important)))) Voice.announce(hit.headline); /* the assistant's voice, with its gestures */
    if (t.digest !== false) store.set('watchDigest', [...store.get('watchDigest', []), { at: Date.now(), w: w.name, h: hit.headline, items: (hit.items || []).slice(0, 3) }].slice(-200));
    if (t.phone !== false) this.phones({ name: w.name, headline: hit.headline, items: (hit.items || []).slice(0, 5), important: !!verdict?.important || !!hit.important, ...(hit.link ? { link: hit.link } : {}), ...(hit.shot && hit.shot.length < 160000 ? { shot: hit.shot } : {}), ...(hit.take ? { take: hit.take, alt: hit.alt } : {}), ...(hit.severity ? { severity: hit.severity } : {}), ...(hit.share ? { share: hit.share } : {}), ...(w.source === 'gmaps' ? { map: true } : {}) });
    this.record(w, hit); this.chainOut(w, hit); this.act(w, hit);
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
    if (p.op === 'all') return { mac: typeof LinkHost !== 'undefined' ? LinkHost.name?.() || '' : '', list: this.list().filter(w => !w.origin).map(w => ({ id: w.id, name: w.name, on: w.on, where: this.where(w), paused: w.state?.paused || '', lastHit: w.state?.lastHit || '', changedAt: w.state?.changedAt })) }; /* your phone: this Mac's watchers */
    if (p.op === 'pnow' || p.op === 'ponoff') { const w = this.get(p.id); if (!w || w.origin) throw new Error('No such watcher');
      if (p.op === 'ponoff') { w.on = !w.on; if (w.on) { w.state.paused = ''; w.state.next = Date.now(); } this.put(w); if (w.runOn && w.runOn !== 'here') this.remote(w, 'set', { on: w.on }, 20000).catch(() => {}); return { on: w.on }; }
      if (w.runOn && w.runOn !== 'here') { const r = await this.remote(w, 'check'); return { hit: r.hit || '' }; }
      const r = await this.check(w); return { hit: r?.hit?.headline || '', paused: w.state.paused || '' }; }
    const from = who.meshId || who.id; if (!from) throw new Error('Only through the mesh');
    const mine = () => this.list().filter(w => w.origin === from), find = () => mine().find(w => w.originId === p.id);
    if (p.op === 'list') return { list: mine().map(w => ({ id: w.originId, ...this.brief(w) })) };
    if (p.op === 'save') {
      if (!this.can()) throw new Error('This device can’t run watchers');
      const d = p.w || {}, old = find(), w = { ...d, id: old?.id || 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), originId: d.id, origin: from, originName: who.name || '', runOn: 'here', state: { seen: [], fails: 0 } };
      const r = await this.check(w, { preview: true }); this.detect(w, r.got);
      w.state.at = Date.now(); w.state.count = Array.isArray(r.got) ? r.got.length : null; w.state.next = Date.now() + this.gap(w); this.put(w);
      return { got: Array.isArray(r.got) ? r.got.slice(0, 3) : typeof r.got === 'boolean' ? r.got : String(r.got).slice(0, 300), count: w.state.count, state: this.brief(w) };
    }
    const w = find(); if (!w) throw new Error('That watcher isn’t on this device');
    if (p.op === 'check') { const r = await this.check(w); return { hit: r?.hit?.headline || '', state: this.brief(this.get(w.id) || w) }; }
    if (p.op === 'set') { w.on = !!p.on; if (w.on) { w.state.paused = ''; w.state.next = Date.now(); } this.put(w); return { state: this.brief(w) }; }
    if (p.op === 'del') { this.del(w.id); return { ok: true }; }
    if (p.op === 'hist') return { csv: await this.historyCsv(w) };
    throw new Error(`Unknown watcher request ${p.op}`);
  },
  /** News from a device running one of yours (or, on a DriveGen, from your Mac). */
  event(p, who) {
    const from = who.meshId || who.id;
    if (p.phone) { /* on a phone: a card and a quiet note; the Mac keeps the watcher */
      const c = Agent.post({ task: 'watch.phone', title: `👁 ${p.name || 'Watcher'}`, type: 'list', headline: p.headline, items: p.items || [], status: 'done', where: 'mac', ...(p.link ? { link: p.link } : {}), ...(p.shot ? { shot: Agent.img(p.shot) } : {}), ...(p.take ? { take: p.take } : {}), ...(p.share ? { share: p.share } : {}) });
      if (!this.quiet({})) { toast(`👁 ${p.headline}`); if (p.map && typeof RoadVoice !== 'undefined') RoadVoice.say(p, c); else if (p.important && typeof Voice !== 'undefined') Voice.announce?.(p.headline); } /* in the car: important news said (traffic, a faster way, leave now), spaced (js/lookahead.js) */ return { ok: true };
    }
    const w = this.list().find(x => x.id === p.id && x.runOn === from); if (!w) return { ok: false, error: 'No such watcher here' };
    w.state = { ...w.state, ...(p.state || {}) };
    if (p.paused) { this.put(w); Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: 'signin', headline: `${p.paused} on ${this.where(w)}, then it carries on (paused)`, watch: w.id }); return { ok: true }; }
    w.state.changedAt = Date.now(); w.state.lastHit = p.headline; this.put(w);
    this.tell({ ...w, origin: '' }, { headline: p.headline, items: p.items || [], value: p.value }, { important: !!p.important, why: p.why });
    return { ok: true };
  },
  /** One check of one watcher (the scheduler, or Check now). preview: only read, tell nothing, keep nothing. */
  async check(w, o = {}) {
    if (this.running.has(w.id)) return; this.running.add(w.id);
    const t0 = Date.now(), trace = [];
    try {
      const got = await this.read(w, trace);
      trace.push(`read ${Array.isArray(got) ? `${got.length} item${got.length === 1 ? '' : 's'}` : typeof got === 'string' ? `${got.length} characters` : got?.routes ? `${got.routes.length} route${got.routes.length === 1 ? '' : 's'}${got.event ? ` to ${got.event.title}` : ''}` : got?.idle ? 'nothing yet (waiting)' : JSON.stringify(got).slice(0, 80)}`);
      if (o.preview) { w.state.trace = { at: Date.now(), ms: Date.now() - t0, lines: trace.slice(-40) }; return { got }; }
      const before = (w.state.seen || []).length, hit = this.detect(w, got);
      if (o.poked || hit) w.state.pokeQuiet = hit ? 0 : (w.state.pokeQuiet || 0) + 1; /* changes that bring nothing new: wait longer for the next */
      if (hit?.shotOf != null && typeof Lookahead !== 'undefined') hit.shot = await Lookahead.shot(w, got, hit.shotOf, trace).catch(e => { trace.push(`  no map picture: ${e.message.slice(0, 60)}`); return ''; }); /* the other way, as Google draws it */
      trace.push(hit ? `news: ${hit.headline.slice(0, 140)}` : `nothing new${w.detect?.kind === 'new' ? ` (${before} seen before)` : ''}`);
      w.state.at = Date.now(); w.state.fails = 0; w.state.paused = ''; w.state.lastMs = Date.now() - t0; w.state.count = Array.isArray(got) ? got.length : null;
      if (hit) { const v = await this.judge(w, hit);
        const cool = +w.filter?.cooldown || 0, cooling = cool && Date.now() - (w.state.toldAt || 0) < cool * 60000;
        if (v.ok && cooling) { Log.i('watch', `Held (at most once per ${cool} min): ${hit.headline}`); this.record(w, hit); }
        else if (v.ok) { w.state.changedAt = w.state.toldAt = Date.now(); w.state.lastHit = hit.headline;
          if (!w.origin && w.filter?.presenting !== false && typeof Script !== 'undefined' && Script.running) { (w.state.held ||= []).push({ hit, v }); w.state.held = w.state.held.slice(-20); Log.i('watch', `Held while presenting: ${hit.headline}`); }
          else this.tell(w, hit, v); } }
      if (w.every === 'live' && (w.rows || w.read) && !w.source) { const v = AgentWeb.views.get(this.viewKey(w)); if (v) AgentWeb.call('observe', [w.rows || w.read, true], 5000, { view: v }); } /* told within seconds when it changes */
      return { got, hit };
    } catch (e) {
      const m = e.message; w.state.fails = (w.state.fails || 0) + 1; w.state.error = m; trace.push(`stopped: ${this.why(m)}`);
      if (/^SIGNIN:/.test(m) || /robot|captcha|not a robot/i.test(m)) { /* needs you: paused, said once */
        w.state.paused = /^SIGNIN:/.test(m) ? `Sign in to ${m.slice(7)}` : 'Answer the robot check';
        Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: /^SIGNIN:/.test(m) ? 'signin' : 'failed', headline: `${w.state.paused}, then it carries on (paused)`, watch: w.id });
        if (w.origin && !o.preview) this.send(w.origin, { id: w.originId, paused: w.state.paused, state: this.brief(w) });
      }
      if (/^CONFIRM:/.test(m)) { /* found it again by its words or the screen model: you say yes once */
        w.state.paused = 'Is this what it watches?';
        if (!o.preview) Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: 'ask', headline: `I lost what it watches; is this it? “${m.slice(8)}” (found by ${w.state.proposal?.how || 'its words'})`, watch: w.id, confirm: true });
      }
      if (m === 'PERM:screen') { w.state.paused = 'Allow StudioGen to see other windows (Screen Recording)'; w.state.error = w.state.paused;
        if (!o.preview) { Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: 'failed', headline: w.state.paused, watch: w.id }); if (typeof Perm !== 'undefined') Perm.denied('screen', () => { w.state.paused = ''; w.state.next = Date.now(); this.put(w); }); } }
      if (/^GONE:/.test(m)) { /* none of its finders found the part: pick it again */
        w.state.paused = 'What it watches isn’t on the page any more';
        if (!o.preview) Agent.post({ task: `watch.${w.id}`, title: `👁 ${w.name}`, type: 'summary', status: 'failed', headline: `${w.state.paused}: pick it again`, watch: w.id, gone: true });
        if (w.origin && !o.preview) this.send(w.origin, { id: w.originId, paused: w.state.paused, state: this.brief(w) });
      }
      Log.w('watch', `Check failed: ${w.name}`, { error: m, fails: w.state.fails });
      if (o.preview) throw e;
    } finally {
      this.running.delete(w.id);
      w.state.trace = { at: Date.now(), ms: Date.now() - t0, lines: trace.slice(-40) };
      if (!o.preview) { const back = [0, 3e5, 9e5, 36e5][Math.min(3, w.state.fails || 0)]; w.state.next = Date.now() + Math.max(this.gap(w), back) * (0.9 + Math.random() * 0.2); /* a little randomness: not robotic */
        if (w.state.nextAt) { if (!w.state.fails && w.state.nextAt < w.state.next) w.state.next = w.state.nextAt; delete w.state.nextAt; } /* leave-by: in time for the next step */ if (this.get(w.id)) this.put(w); /* deleted while it was checking: it stays deleted */ if (current === 'settings' && $('#sheet .wt-list')) this.sheet(); }
    }
  },

  /* ---------- The scheduler ---------- */
  tick() {
    if (!this.can()) return;
    if (typeof Script === 'undefined' || !Script.running) for (const w of this.list()) if (w.state?.held?.length) { const l = w.state.held.splice(0); this.put(w); /* held while presenting: told now */
      if (l.length === 1) this.tell(w, l[0].hit, l[0].v); else this.tell(w, { headline: `${w.name}: ${l.length} things while you presented`, items: l.flatMap(x => x.hit.items?.length ? x.hit.items : [{ title: x.hit.headline }]).slice(0, 6) }, { important: l.some(x => x.v?.important) }); }
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
  /** A template's form: its questions (text, a folder or file picked in StudioGen, an open window, another watcher), then
      how often and how to tell; templates with pick: open the page and you tap the list or part. */
  async fromTemplate(id) {
    const T = WATCH_TEMPLATES.find(x => x.id === id); if (!T) return;
    if (T.map && typeof MapWatch !== 'undefined') return MapWatch.formSheet(T); /* from, to, route options (js/mapwatch.js) */
    const wins = T.inputs.some(x => x[3] === 'window') && window.DriveDeckDesktop?.windows ? (await DriveDeckDesktop.windows('list').catch(() => ({}))).list || [] : [];
    const field = ([k, q, ph, type]) => type === 'folder' || type === 'file' ? `<div class="se-field"><span>${esc(q)}</span><div class="chip-row"><button class="chip" data-wt="pickpath|${type}|${k}">Choose…</button><span class="se-note" id="wtp_${k}">none yet</span><input type="hidden" data-wti="${k}"></div></div>`
      : type === 'window' ? `<label class="se-field"><span>${esc(q)}</span><select data-wti="${k}">${wins.map(n => `<option>${esc(n)}</option>`).join('') || '<option value="">(no windows: allow Screen Recording, or open the app)</option>'}</select></label>`
      : type === 'watcher' ? `<label class="se-field"><span>${esc(q)}</span><select data-wti="${k}">${this.list().map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>`
      : `<label class="se-field"><span>${esc(q)}</span><input data-wti="${k}" placeholder="${esc(ph)}"></label>`;
    const sample = T.make(Object.fromEntries(T.inputs.map(([k, , ph]) => [k, ph || ''])));
    sheet(T.name, `${T.about ? `<p class="se-note">${esc(T.about)}</p>` : ''}${T.inputs.map(field).join('')}${T.pick ? '<p class="se-note">Next, the page opens: tap the list (or the part) to watch.</p>' : this.formHtml(sample)}`,
      [[T.pick ? 'Open it' : 'Check and save', async () => {
        const v = Object.fromEntries($$('[data-wti]').map(el => [el.dataset.wti, el.value.trim() || (el.tagName === 'INPUT' && el.type !== 'hidden' ? el.placeholder : '')]));
        const miss = T.inputs.find(([k, , , type]) => (type === 'folder' || type === 'file' || type === 'window' || type === 'watcher') && !v[k]); if (miss) return toast(`${miss[1]} first`);
        const made = T.make(v);
        if (T.pick) { closeSheet(); await AgentWeb.go(made.url); const r = await this.pick(made.tip || 'Tap the list (or the part) to watch'); if (!r) return; return this.picked(r, AgentWeb.url(), made.steps || []); }
        const w = this.make({ name: T.name, template: T.id, templateInputs: v, ...made });
        if (w.source === 'hook') { try { Object.assign(w, await Bee.hookNew(w.name)); } catch (e) { return sheet('No webhook', `<p>${esc(e.message)}</p><p class="se-note">Webhooks come in through StudioGBee (Mesh › StudioGBee).</p>`, [['Close']]); } }
        this.formRead(w); await this.saveChecked(w); }], ['Back', () => this.templates()]]);
  },
  formHtml(o) {
    const sel = (id, l, cur) => `<select id="${id}">${l.map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    return `<label class="se-row"><span>How often</span>${sel('wtEvery', WATCH_EVERY, o.every || '15m')}</label>
      <label class="se-check"><input type="checkbox" id="wtToast" ${o.tell?.toast === false ? '' : 'checked'}> A quiet notification</label>
      <label class="se-row"><span>Say it aloud</span>${sel('wtSpeak', [['important', 'When it’s important'], ['always', 'Always'], ['never', 'Never']], o.tell?.speak || 'important')}</label>
      <label class="se-check"><input type="checkbox" id="wtDigest" ${o.tell?.digest === false ? '' : 'checked'}> In the daily digest</label>
      <label class="se-check"><input type="checkbox" id="wtRecord" ${o.record ? 'checked' : ''}> Record changes (a CSV you can see in the data widget)</label>
      ${typeof Mesh !== 'undefined' && Mesh.m && Mesh.members().some(m => m.app === 'DriveGen' && Mesh.own(m.id)) ? `<label class="se-check"><input type="checkbox" id="wtPhone" ${o.tell?.phone === false ? '' : 'checked'}> On my phone too (a push when it’s away)</label>` : ''}
      ${this.runners().length ? `<label class="se-row"><span>Runs on</span>${sel('wtRunOn', [['here', 'This Mac'], ...this.runners().map(m => [m.id, esc(m.name)])], o.runOn || 'here')}</label><p class="se-note">A Worker is always on and keeps its own sign-ins (sign in there with Sign in from here).</p>` : ''}
      <label class="se-field"><span>Only tell me if… (optional, judged by the model)</span><input id="wtAsk" value="${esc(o.ask || '')}" placeholder="it’s from a customer, or needs me today"></label>`;
  },
  formRead(w) { w.every = $('#wtEvery')?.value || w.every; w.tell = { card: true, toast: $('#wtToast')?.checked !== false, speak: $('#wtSpeak')?.value || 'important', digest: $('#wtDigest')?.checked !== false, phone: $('#wtPhone') ? $('#wtPhone').checked : true }; w.record = !!$('#wtRecord')?.checked; w.runOn = $('#wtRunOn')?.value || w.runOn || 'here'; const a = $('#wtAsk')?.value.trim(); if (a) w.ask = a; else delete w.ask; },
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
      this.detect(w, got); w.state.at = Date.now(); w.state.count = Array.isArray(got) ? got.length : null; w.state.next = Date.now() + this.gap(w); this.put(w);
      const now = got?.routes ? `Now: ${got.routes[0].min} min${got.routes[0].via ? ` via ${esc(got.routes[0].via)}` : ''}${got.routes.length > 1 ? ` (${got.routes.length - 1} other way${got.routes.length > 2 ? 's' : ''})` : ''}${got.event ? ` to ${esc(got.event.title)} at ${esc(got.event.when)}` : ''}` : got?.idle ? 'Nothing to read yet: it starts when there is (you drive, or the time comes)' : Array.isArray(got) ? `${got.length} item${got.length === 1 ? '' : 's'} now${got.length ? `, e.g. “${esc(String(got[0]).slice(0, 90))}”` : ''}` : typeof got === 'boolean' ? (got ? 'It’s there now' : 'Not there now') : `Now: “${esc(String(got).slice(0, 140))}”`;
      sheet('Watching', `<p><b>${esc(w.name)}</b> · ${esc((WATCH_EVERY.find(e => e[0] === w.every) || [])[1] || w.every)}</p><p class="se-note">${now}. It tells you when that changes.</p>`, [['Watchers', () => this.sheet()], ['Done']]);
    } catch (e) { sheet('Couldn’t read it', `<p>${esc(this.why(e.message))}</p>${w.state?.trace?.lines?.length ? `<pre style="white-space:pre-wrap;font-size:12px;max-height:12em;overflow:auto;background:rgba(127,127,127,.12);padding:8px;border-radius:8px">${esc(w.state.trace.lines.join('\n'))}</pre>` : ''}`, [['Show me', () => this.showPage(w)], ...(window.DriveDeckDesktop?.diag ? [['Diagnose the page', () => this.diagnose(w)]] : []), ...(this.where(w) === 'here' && (w.url || '').length ? [['Pick it again', () => { closeSheet(); this.put(w); this.here(String(w.url).replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m), w.id); }]] : []), ['Save anyway', () => { this.put(w); this.sheet(); }], ['Cancel']]); }
  },
  /** An error in words for you (not GONE:…). */
  why(m) {
    return String(m).replace(/^SIGNIN:(.+)$/, 'Sign in to $1 in the agent browser first, then try again.').replace(/^GONE:.*$/, 'The page opened, but what it watches wasn’t on it (the site may have changed). Show me shows the page as the watcher saw it; Pick it again lets you tap it.')
      .replace(/^CONFIRM:(.*)$/, 'It found something like it: “$1”. Check the card to say whether that’s it.').replace(/^PERM:screen$/, 'StudioGen needs Screen Recording to see other windows.').replace(/^NOTFOUND:.*$/, 'What it watches wasn’t on the page.');
  },
  /** Diagnose: the page's structure (words as shapes), each selector this page's watchers use tried on it, and their last
      checks, into a file in StudioGen's diagnostics folder (to look at, or to send). w: a watcher (its own browser), or
      none (the page in the agent browser). */
  async diagnose(w) {
    if (!window.DriveDeckDesktop?.diag) return toast('Diagnosing needs StudioGen 0.18.3 or later on a Mac');
    const v = w ? AgentWeb.views.get(this.viewKey(w)) : AgentWeb.views.get(AgentWeb.cur), url = v ? AgentWeb.url({ view: v }) : '';
    if (!v || !url || url === 'about:blank') return toast(w ? 'The watcher hasn’t opened its page yet: Check now first' : 'Open a page in the agent browser first');
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })(), mine = w ? [w] : this.list().filter(x => { try { return new URL(String(x.url || '').replace(/\{(\w+)\}/g, (m, k) => Agent.sites()[k] ?? m)).host === host; } catch { return false; } });
    const selectors = mine.flatMap(x => [x.ready && { for: `${x.name}: ready`, sel: x.ready }, (x.rows || x.read) && { for: `${x.name}: ${x.rows ? 'rows' : 'part'}`, sel: x.rows || x.read }, x.source === 'gmaps' && { for: `${x.name}: routes`, sel: MapWatch.ROWS }, ...(x.finders || []).map(f => ({ for: `${x.name}: another finder`, sel: f }))]).filter(Boolean);
    // the templates for this site as they are now: the watcher's own, or (no watchers here yet) every one that opens this site
    const hostOf = u => { try { return new URL(String(u || '').replace(/\{(\w+)\}/g, (m, k) => Agent.sites()[k] ?? m)).host; } catch { return ''; } };
    for (const T of WATCH_TEMPLATES) {
      if (mine.length ? !mine.some(x => x.template === T.id) : false) continue;
      try { const d = T.make(Object.fromEntries(T.inputs.map(([k, , ph]) => [k, ph || '']))); if ((mine.length || hostOf(d.url) === host) && (d.rows || d.read) && !selectors.some(x => x.sel === (d.rows || d.read))) { if (d.ready) selectors.push({ for: `template ${T.id}: ready`, sel: d.ready }); selectors.push({ for: `template ${T.id} now`, sel: d.rows || d.read }); } } catch {}
    }
    toast('Diagnosing the page…');
    // deep where lists usually are (and where the selectors point), shallow elsewhere
    const focus = [...selectors.map(x => x.sel.split('||')[0]).filter(x => !/^rows-in:/.test(x)), ...selectors.flatMap(x => x.sel.split('||').filter(y => /^rows-in:/.test(y)).map(y => y.slice(8))), '#pane-side', '#side', '#main', '[role="grid"]', '[role="list"]', '[role="listbox"]', '[role="tree"]', 'main', '[role="main"]'];
    const page = await AgentWeb.call('diagnose', [{ selectors, focus: [...new Set(focus)].join('||'), max: 6000 }], 45000, { view: v });
    if (!page?.ok) return toast(`Couldn’t diagnose: ${page?.error || 'the page didn’t answer'}`);
    const report = { what: 'StudioGen page diagnosis (words replaced by shapes)', at: new Date().toISOString(), app: store.get('setupDone') || '', page,
      watchers: mine.map(x => ({ name: x.name, template: x.template || '', url: x.url, ready: x.ready || '', rows: x.rows || '', read: x.read || '', keep: x.keep ? '(set)' : '', detect: x.detect, every: x.every, error: x.state?.error ? this.why(x.state.error) : '', fails: x.state?.fails || 0, lastCheck: x.state?.trace || null })) };
    const f = await DriveDeckDesktop.diag('write', { name: `${host || 'page'}${w ? '-' + w.name : ''}`, text: JSON.stringify(report, null, 1) });
    if (f?.error) return toast(`Couldn’t save it: ${f.error}`);
    sheet('Page diagnosed', `<p class="se-note">Saved (no words from the page, only their shapes):</p><p><code>${esc(f)}</code></p><p class="se-note">${page.trials.map(t => `${esc(t.for)}: ${t.results.map(r => `${esc(r.sel.slice(0, 50))} → ${r.visible ?? 0}`).join(' · ')}`).join('<br>') || 'No watchers on this page yet.'}</p>`,
      [['Copy the path', () => { navigator.clipboard?.writeText(f); toast('Copied'); }], ['Close']]);
  },
  /** The selector tester in the agent browser's bar: matches outlined on the page, how many, the first lines. */
  tester() {
    const box = AgentWeb.el() && $('#agentWeb'); if (!box || $('.ag-test', box)) return $('.ag-test input', box)?.focus();
    box.querySelector('.ag-web-bar').insertAdjacentHTML('afterend', `<div class="ag-teach ag-test"><span>🔎</span><input placeholder="A selector, || between choices, or rows-in:#container" style="flex:1;min-width:12em;height:32px;border-radius:8px;border:0;padding:0 10px"><span class="ag-test-out se-note"></span><button class="chip" data-wt="testclose">Close</button></div>`);
    const i = $('.ag-test input', box); i.focus();
    i.addEventListener('keydown', async e => { if (e.key !== 'Enter') return; const r = await AgentWeb.call('highlight', [i.value.trim(), true], 8000);
      $('.ag-test-out', box).textContent = !r?.ok ? (r?.error || 'The page didn’t answer') : r.n ? `${r.n} match${r.n > 1 ? 'es' : ''}${r.used !== r.css ? ` (${r.used} → ${r.css.slice(0, 60)})` : ''}: ${r.lines.map(l => `“${l.slice(0, 40)}”`).join(' ')}` : `No match (${(r.trials || []).map(t => `${t.sel.slice(0, 30)} → ${t.matches ?? 0}`).join(' · ')})`; });
  },
  /** Show me: the page in the watcher's own browser, as it last saw it. */
  showPage(w) { const v = AgentWeb.views.get(this.viewKey(w)); closeSheet(); if (v) AgentWeb.use(v.id); AgentWeb.show(true); toast(v ? 'This is the page as the watcher saw it' : 'The watcher hasn’t opened a page yet'); },
  templates() {
    const groups = {}; for (const t of WATCH_TEMPLATES) (groups[t.group] ||= []).push(t);
    sheet('New watcher', `<p class="se-note">What should it watch? It checks on its own and tells you when something new or different shows up.</p>
      ${Object.entries(groups).map(([g, l]) => `<p class="se-note"><b>${esc(g)}</b></p><div class="pick-list">${l.map(t => `<button class="big-btn" data-wt="tpl|${t.id}">${esc(t.name)}</button>`).join('')}</div>`).join('')}
      ${this.can() ? '<p class="se-note"><b>Anything else</b></p><div class="pick-list"><button class="big-btn" data-wt="here">Watch something on a page (open it, tap it)</button><button class="big-btn" data-wt="teach">Teach it: do the steps (search, tabs), then tap what to watch</button><button class="big-btn" data-wt="paste">Paste a watcher (JSON, from an LLM or a friend)</button></div>' : ''}`, [['Back', () => this.sheet()]]);
  },
  /** Waiting for a tap in the agent browser: a bar says what to tap, with Cancel; the page outlines what's under the
      pointer. keep: leave the browser shown afterwards (Teach it carries on). */
  async pick(tip, keep) {
    const box = AgentWeb.el() && $('#agentWeb'); AgentWeb.show(true); $('.ag-pick', box)?.remove(); await AgentWeb.useHere(); /* WhatsApp's “open in another window”: not something to tap as the part */
    box?.querySelector('.ag-web-bar')?.insertAdjacentHTML('afterend', `<div class="ag-teach ag-pick"><span>👁 ${esc(tip || 'Tap what to watch')}</span><span class="te-sp"></span><button class="chip" data-wt="pickcancel">Cancel</button></div>`);
    const r = await AgentWeb.call('pick', [180000, true], 185000);
    $('.ag-pick', box)?.remove(); if (!keep) AgentWeb.show(false);
    if (!r?.ok && r?.error !== 'cancelled') toast('Nothing picked');
    return r?.ok ? r : null;
  },
  /** Watch something here: the agent browser's page, a part picked by tapping; the kind suggested from what it is. */
  async here(url, again) {
    if (url) await AgentWeb.go(url);
    const r = await this.pick(again ? 'Tap what it should watch now' : 'Tap what to watch: a chat, a list, a price, a paragraph'); if (!r) return;
    return this.picked(r, AgentWeb.url(), [], again);
  },
  /** Teach it: do the steps in the agent browser (searches, tabs), then tap what to watch (js/taskedit.js TaskTeach). */
  teach(url) { if (!this.can()) return toast('Teaching needs StudioGen on a Mac'); closeSheet(); TaskTeach.forWatch = true; TaskTeach.start(url); },
  /** A part was picked (tapped, or at the end of Teach it): the watcher form, with the kind suggested. */
  picked(r, page, steps = [], again) {
    // a list: by its role (row, listitem…), else by shape (look-alike siblings around the tap: today's WhatsApp, many sites)
    const listy = /^(listitem|row|option|treeitem|article)$/.test(r.role) || r.tag === 'li' || r.tag === 'article' || r.tag === 'tr' || !!r.row;
    const rows = r.row?.css || (listy ? r.css.replace(/:nth-(child|of-type)\(\d+\)(?!.*:nth-)/, '') : ''), num = /\d/.test(r.text) && r.text.length < 40 && !r.row;
    const q = x => String(x).replace(/["\\]/g, '\\$&'), finders = [listy ? rows : r.css, r.row && r.css.replace(/:nth-(child|of-type)\(\d+\)(?!.*:nth-)/, ''), r.testid && `[data-testid="${q(r.testid)}"]`, r.testid && `[data-qa="${q(r.testid)}"]`, r.role && `${r.tag}[role="${q(r.role)}"]`, !listy && r.label && `[aria-label="${q(r.label)}"]`, listy ? r.css : ''].filter(Boolean); /* ways to find it again (self-healing) */
    const what = (listy ? '' : r.text || r.label || '').slice(0, 80); /* its words: found again by them, or by the screen model */
    const old = again && this.get(again);
    if (old) { const k = old.rows ? 'rows' : 'read'; old[k] = finders[0]; old.finders = finders; old.what = what || old.what; old.state.paused = ''; old.state.fails = 0; old.state.at = 0; return this.saveChecked(old); } /* picked again: same watcher, new part, a new baseline */
    // a chat or mail row tapped (not after Teach it's steps): it's about that person, so only their rows count
    const opened = steps.find(x => x.do === 'agent.click' && x.value)?.value, who = listy && !steps.length ? (r.row?.name || this.item(r.text || '').title.replace(/\s*\(.*$/, '')).trim() : '';
    const person = who && who.length <= 40 && !/\d{3,}/.test(who) ? who : '';
    const title = person ? `New from ${person}` : opened ? `New in ${String(opened).slice(0, 40)}` : listy ? `New on ${AgentWeb.siteKey(page).replace(/^www\./, '')}` : (r.text || '').slice(0, 40) || AgentWeb.siteKey(page);
    sheet('Watch this', `<p class="se-note">You picked: “${esc((r.row?.text || r.text || r.label || r.css).slice(0, 120))}”${r.row ? ` (one of ${r.row.n} in a list)` : ''}${steps.length ? ` after ${steps.length} step${steps.length > 1 ? 's' : ''}` : ''}</p>
      <label class="se-row"><span>Tell me when</span><select id="wtKind">${WATCH_KINDS.filter(([v]) => !['stale'].includes(v)).map(([v, n]) => `<option value="${v}" ${(v === 'new' && listy) || (v === 'changes' && !listy && !num) || (v === 'value' && num && !listy) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="se-field"><span>The line, the words or the pattern (for those kinds)</span><input id="wtCond" placeholder="below 500 · drops 5% · in stock||available"></label>
      ${listy ? `<label class="se-field"><span>Only items with these words (|| between; empty: every new item)</span><input id="wtKeep" value="${esc(person)}" placeholder="a name, or words"></label>` : ''}
      <label class="se-field"><span>Its name</span><input id="wtName" value="${esc(title)}"></label>${this.formHtml({ every: '15m' })}`,
      [['Check and save', async () => { const kind = $('#wtKind').value, cond = $('#wtCond').value.trim();
        const keep = $('#wtKeep')?.value.trim();
        const w = this.make({ name: $('#wtName').value.trim() || title, url: page, steps, ...(keep ? { keep } : {}), /* no ready: the tapped element may only show after the steps, and it moves; the page, then the part, are waited for */ ...(kind === 'new' || kind === 'gone' ? { rows: rows || r.css } : { read: r.css }), finders, what, detect: this.kindDetect(kind, cond) });
        this.formRead(w); await this.saveChecked(w); }], ['Cancel']]);
    this.condShow();
  },
  /** The line/words box only for the kinds that use it (and “gone or moved” only for new items). */
  condShow() { const k = $('#wtKind')?.value, c = $('#wtCond')?.closest('label'), g = $('#weGone')?.closest('label'); if (c) c.hidden = !/^(value|count|contains|pattern|stale|visual)$/.test(k || ''); if (g) g.hidden = k !== 'new'; },
  /** The detector for a kind and what was typed for it. */
  kindDetect(kind, cond = '') {
    return { kind, ...(kind === 'value' || kind === 'count' ? { cond: cond || 'changes' } : kind === 'contains' ? { words: cond } : kind === 'pattern' ? { re: cond } : kind === 'stale' ? { mins: +cond || 1440 } : kind === 'visual' ? { pct: +cond || 8 } : kind === 'new' && /gone|moved|cancel/i.test(cond) ? { gone: true } : {}) };
  },

  /* ---------- What happens besides telling: the change history, actions, chains ---------- */
  /** The change history (Record changes): a row per thing told, in a CSV for the data widget. */
  record(w, hit) {
    if (!w.record) return;
    const row = { time: new Date().toISOString().replace('T', ' ').slice(0, 19), watcher: w.name, headline: hit.headline, value: hit.value ?? '', items: (hit.items || []).map(i => [i.title, i.detail].filter(Boolean).join(': ')).join(' | ').slice(0, 1000) };
    if (window.DriveDeckDesktop?.watchlog) return DriveDeckDesktop.watchlog('add', { id: w.id, row }).catch(e => Log.w('watch', 'History', e.message));
    const k = `watchHist.${w.id}`; store.set(k, [...store.get(k, []), row].slice(-2000)); /* without the desktop app: the newest 2,000 here */
  },
  async historyCsv(w) {
    if (window.DriveDeckDesktop?.watchlog) return await DriveDeckDesktop.watchlog('read', { id: w.id }) || '';
    const l = store.get(`watchHist.${w.id}`, []); return l.length ? ['time,watcher,headline,value,items', ...l.map(r => ['time', 'watcher', 'headline', 'value', 'items'].map(c => { const v = String(r[c] ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(','))].join('\n') : '';
  },
  /** Show history: the CSV in the data widget (a line chart of the value when there is one). */
  async showHistory(w) {
    const csv = w.runOn && w.runOn !== 'here' ? (await this.remote(w, 'hist', {}, 30000).catch(() => ({}))).csv || await this.historyCsv(w) : await this.historyCsv(w);
    if (!csv || csv.split('\n').filter(Boolean).length < 2) return toast(`${w.name}: nothing recorded yet${w.record ? '' : ' (turn on Record changes)'}`);
    const d = DataViz.from(csv), id = DataViz.target(), vals = d.rows.some(r => r.value !== '' && r.value != null);
    await DataViz.set(id, d, { kind: 'watch', label: `👁 ${w.name}` });
    if (vals) { Wcfg.set(id, { chart: { type: 'line', x: 'time', y: ['value'] } }); DataViz.draw?.(id); }
    closeSheet(); Peek.tapAt = Date.now(); openView('dashboard'); if (!document.querySelector(`[data-wid="${id}"]`)) { Dash.render(); await DataViz.set(id, d, { kind: 'watch', label: `👁 ${w.name}` }); } /* drawn now even when the layout didn't change */ /* the data widget lives there (on Stage too: its zones are the dashboard's) */ toast(`${w.name}: ${d.rows.length} rows`);
  },
  /** Actions on news: run a task (one that acts asks first, as always), a script (asked first when it can act), start a watcher. */
  act(w, hit) {
    const fill = x => String(x ?? '').replace(/\{(headline|item|detail|value|watcher)\}/g, (m, k) => ({ headline: hit.headline, item: hit.items?.[0]?.title || '', detail: hit.items?.[0]?.detail || '', value: hit.value ?? '', watcher: w.name })[k]);
    for (const a of w.actions || []) try {
      if (a.do === 'task') { const t = Agent.get(a.id); if (!t) continue; const p = Object.fromEntries(Object.entries(a.inputs || {}).map(([k, v]) => [k, fill(v)])); Log.i('watch', `Runs ${t.name} for ${w.name}`); Agent.start(t, p); }
      if (a.do === 'script') { const sc = Scripts.find(a.name); if (!sc) continue; const risky = /"(os\.|agent\.(type|key|click|confirm)|phone\.|mail\.|mac\.run)/.test(JSON.stringify(sc.json));
        const run = () => { if (Script.running) return toast(`Not now: a script is running (${sc.name})`); Script.start(sc.json); };
        if (risky) sheet(`${w.name}: run “${sc.name}”?`, `<p>${esc(hit.headline)}</p><p class="se-note">This script can act on things, so it asks first.</p>`, [['Run it', run], ['Not now']]); else run(); }
      if (a.do === 'start') { const o = this.get(a.id); if (o && !o.on) { o.on = true; o.state.paused = ''; o.state.next = Date.now(); this.put(o); toast(`👁 Started watching: ${o.name}`); } }
    } catch (e) { Log.w('watch', `Action failed for ${w.name}`, e.message); }
  },
  /** Chains: watchers whose source is this one's news get it as new items, and check at once. */
  chainOut(w, hit) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    for (const c of this.list()) if (c.source === 'chain' && c.from === w.id && c.on) { (c.state.inbox ||= []).push(...(hit.items?.length ? hit.items : [{ title: hit.headline }]).map(i => `${t} · ${[i.title, i.detail].filter(Boolean).join(' · ')}`)); c.state.inbox = c.state.inbox.slice(-100); c.state.next = Date.now(); this.put(c); setTimeout(() => this.check(this.get(c.id)), 500); }
  },
  /** A webhook's message (StudioGBee passes it on, js/bee.js): the watcher with that hook gets it as a new item. */
  hookIn(m) {
    const w = this.list().find(x => x.source === 'hook' && x.hook === m.token); if (!w) return;
    let b = m.body; try { b = JSON.parse(b); } catch {}
    const text = typeof b === 'object' && b ? Object.entries(b).slice(0, 8).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : v}`).join(', ') : String(b || '(empty)');
    (w.state.inbox ||= []).push(`${new Date(m.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${text.slice(0, 300)}`); w.state.inbox = w.state.inbox.slice(-100); w.state.next = Date.now(); this.put(w);
    setTimeout(() => this.check(this.get(w.id)), 300);
  },

  /* ---------- Sharing and importing (a watcher written by an LLM from the build prompt, or from the mesh) ---------- */
  exportDef(w) { const { id, state, origin, originId, originName, created, runOn, hook, hookUrl, share, on, ...def } = w; return { format: 'studiogen-watcher', version: 1, watcher: def }; },
  import(o, opt = {}) {
    const d = o.watcher || o; if (!d.name || !(d.url || d.source)) { const e = 'A watcher needs a name and a url (or a source)'; return opt.auto ? opt.onError?.([e]) : sheet('Didn’t import', `<p>${esc(e)}</p>`, [['Close']]); }
    const w = this.make({ ...d, name: opt.from ? `${d.name} (from ${opt.from})` : d.name, on: !opt.quiet });
    if (opt.quiet) { this.put(w); return w; } /* from the mesh: here, off until you turn it on */
    toast(`Imported the watcher “${w.name}”`); return this.saveChecked(w);
  },

  /* ---------- Your Mac's watchers on DriveGen ---------- */
  async phoneSheet() {
    sheet('Watchers', '<p class="se-note">Asking your Mac…</p>', [['Close']]);
    let r; try { r = await Link.watch({ op: 'all' }); } catch (e) { return sheet('Watchers', `<p>${esc(e.message)}</p><p class="se-note">They run on your Mac; pair in Settings › Connections.</p>`, [['Close']]); }
    sheet('Watchers', `<p class="se-note">On your Mac${r.mac ? ` (${esc(r.mac)})` : ''}; news comes here as cards. Make and edit them in StudioGen.</p><div class="wt-list">${(r.list || []).map(w => `<div class="mem-row"><span><b>${w.on ? '' : '⏸ '}${esc(w.name)}</b><br><span class="se-note">${w.paused ? `⚠️ ${esc(w.paused)}` : w.lastHit ? esc(w.lastHit.slice(0, 90)) : 'no news yet'}</span></span>
      <span class="acts"><button class="link-btn" data-wt="pnow|${esc(w.id)}">Check now</button> <button class="link-btn" data-wt="ponoff|${esc(w.id)}">${w.on ? 'Pause' : 'Resume'}</button></span></div>`).join('') || '<p class="se-note">None yet.</p>'}</div>`, [['Close']]);
  },
  /** “Watch this” on a task's card: the task runs on a schedule and its new items are told. */
  fromCard(c) { const t = Agent.get(c.task); if (!t) return; sheet(`Watch: ${t.name}`, `<p class="se-note">It runs “${esc(t.name)}” on its own and tells you when its answer has something new.</p>${this.formHtml({ every: '30m' })}`, [['Check and save', async () => { const w = this.make({ name: t.name, source: 'task', task: t.id, detect: { kind: 'new' }, every: '30m' }); this.formRead(w); await this.saveChecked(w); }], ['Cancel']]); },

  /* ---------- By voice ---------- */
  /** “Tell me when the Acme widget is under 500”: the model drafts it (a template, or a page and a kind), you say yes. */
  async fromWords(text, say) {
    if (!this.can()) return say('Watchers run on your Mac: say it to StudioGen there.');
    if (typeof Intent === 'undefined' || !Intent.can()) { this.templates(); return say('I need the language model for that. Pick one here instead.'); }
    const usable = WATCH_TEMPLATES.filter(t => !t.pick && !t.inputs.some(x => x[3])), cat = usable.map(t => `${t.id}: ${t.name}${t.inputs.length ? ` (${t.inputs.map(x => x[0]).join(', ')})` : ''}`).join('\n');
    const schema = { type: 'object', required: ['template', 'inputs', 'url', 'kind', 'cond', 'every', 'name'], properties: { template: { type: ['string', 'null'] }, inputs: { type: 'object', additionalProperties: { type: 'string' } }, url: { type: ['string', 'null'] }, kind: { type: 'string' }, cond: { type: 'string' }, every: { type: 'string' }, name: { type: 'string' } } };
    let j; try { j = (await LLM.ask('fast', { system: LLM.prompt('watch.draft', { templates: cat, now: new Date().toDateString() }), prompt: text, schema, temperature: 0 })).json; } catch (e) { Log.w('watch', 'Draft', e.message); }
    if (!j) { this.templates(); return say('I couldn’t work that out. Pick one here.'); }
    // the model's draft, put right in code: shop addresses use their template, a line or a % means a price, defaults filled
    const url = (text.match(/https?:\/\/\S+/) || [])[0] || j.url || '', inp = { ...(j.inputs || {}) }, cond = j.cond || inp.cond || '';
    const shop = /amazon\./.test(url) ? (/stock|available/i.test(text) ? 'amazon.stock' : 'amazon.price') : /flipkart\./.test(url) ? (/stock|available/i.test(text) ? 'flipkart.stock' : 'flipkart.price') : '';
    const T = usable.find(t => t.id === (shop || j.template)); if (T && url && T.inputs.some(([k]) => k === 'url')) inp.url ||= url; if (T && cond && T.inputs.some(([k]) => k === 'cond')) inp.cond ||= cond;
    if (T) for (const [k, , ph] of T.inputs) if (!String(inp[k] || '').trim() && ph && !/…|^https?:/.test(ph)) inp[k] = ph; /* a default that fits (inr, drops) */
    if (T && T.inputs.some(([k]) => !String(inp[k] || '').trim())) { this.fromTemplate(T.id); return say(`That's “${T.name}”: fill in the rest here.`); }
    if (!T && /below|under|above|over|drop|fall|rise|%/.test(cond) && !['value', 'count'].includes(j.kind)) j.kind = 'value';
    const asked = /\bevery\b|minute|hourly|\blive\b|often|daily/i.test(text), every = asked && WATCH_MS[j.every] ? j.every : T ? '' : j.kind === 'value' ? '1h' : '30m';
    const made = T && T.make(inp), w = T ? this.make({ name: made.name || j.name || T.name, template: T.id, templateInputs: inp, ...made, every: every || made.every || '30m' })
      : /^https?:\/\//.test(url) ? this.make({ name: j.name || url, url, read: 'main||article||[role="main"]||body', ...(j.kind === 'value' ? { extract: { fields: ['price'], about: j.name || 'the page' } } : {}), detect: { ...this.kindDetect(WATCH_KINDS.some(k => k[0] === j.kind) ? j.kind : 'changes', cond), ...(j.kind === 'value' ? { field: 'price' } : {}) }, record: j.kind === 'value', every }) : null;
    if (!w) { this.templates(); return say('Which page should I watch? Pick it here, or open it in the agent browser and tap it.'); }
    const often = (WATCH_EVERY.find(e => e[0] === w.every) || [])[1]?.toLowerCase() || w.every;
    return new Promise(res => {
      const p = { at: Date.now(), yes: () => { clearInterval(keep); this.saveChecked(w); res(); }, no: () => { clearInterval(keep); say('Okay, I won’t.'); res(); } };
      const keep = setInterval(() => { if (Commands.pending === p) p.at = Date.now(); else { clearInterval(keep); res(); } }, 5000);
      Commands.pending = p; say(`I'll watch ${w.name}, ${often}${w.detect?.cond ? `, and tell you when it's ${w.detect.cond}` : w.detect?.words ? `, for “${w.detect.words.split('||')[0]}”` : ''}. Shall I?`, null, { ask: true });
    });
  },
  find(name) { const q = plain(name).replace(/\b(the|my|watcher)\b/g, ' ').trim(); return this.list().filter(w => !w.origin).find(w => plain(w.name) === q) || (q && this.list().filter(w => !w.origin).find(w => plain(w.name).includes(q) || q.includes(plain(w.name)))); },
  sayList(say) {
    const l = this.list().filter(w => !w.origin); if (!l.length) { say('You have no watchers yet. Say “tell me when …”, or pick one.'); return this.templates(); }
    const on = l.filter(w => w.on && !w.state?.paused), off = l.length - on.length;
    say(`${l.length} watcher${l.length > 1 ? 's' : ''}: ${on.slice(0, 5).map(w => w.name).join(', ')}${on.length > 5 ? ` and ${on.length - 5} more` : ''}${off ? `; ${off} paused` : ''}.`); this.sheet();
  },
  voiceOnOff(name, on, say) {
    const w = this.find(name); if (!w) return say(`I don't have a watcher called ${name}.`);
    w.on = on; if (on) { w.state.paused = ''; w.state.next = Date.now(); } this.put(w); if (w.runOn && w.runOn !== 'here') this.remote(w, 'set', { on }, 20000).catch(() => {});
    say(on ? `Watching ${w.name} again.` : `Paused ${w.name}.`);
  },
  sayToday(say) {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const l = (typeof Agent !== 'undefined' ? Agent.history() : []).filter(h => h.kind === 'watch' && h.at >= +d0);
    if (!l.length) return say('Nothing from your watchers today.');
    say(`Today your watchers saw ${l.length} thing${l.length > 1 ? 's' : ''}. ${l.slice(0, 3).map(h => h.headline).join('. ')}${l.length > 3 ? '. And more on the Agent screen.' : '.'}`);
  },

  /* ---------- Editing one ---------- */
  edit(id) {
    const w = this.get(id); if (!w) return; const f = w.filter || {}, d = w.detect || {}, src = w.source || (w.task ? 'task' : 'page');
    const opt = (l, cur) => l.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const condOf = d.kind === 'value' || d.kind === 'count' ? d.cond : d.kind === 'contains' ? d.words : d.kind === 'pattern' ? d.re : d.kind === 'stale' ? d.mins : d.kind === 'visual' ? d.pct : '';
    const acts = (w.actions || []).map((a, i) => `<div class="mem-row"><span>${a.do === 'task' ? `Run the task “${esc(Agent.get(a.id)?.name || a.id)}”${Object.keys(a.inputs || {}).length ? ` (${esc(Object.entries(a.inputs).map(([k, v]) => `${k}=${v}`).join('; '))})` : ''}` : a.do === 'script' ? `Run the script “${esc(a.name)}”` : `Start watching “${esc(this.get(a.id)?.name || a.id)}”`}</span><button class="link-btn" data-wt="actdel|${w.id}|${i}">Remove</button></div>`).join('');
    sheet(`Edit: ${w.name}`, `<label class="se-field"><span>Its name</span><input id="weName" value="${esc(w.name)}"></label>
      ${src === 'gmaps' && typeof MapWatch !== 'undefined' ? MapWatch.formHtml(w, d.kind) : ''}
      ${src === 'page' || src === 'feed' || src === 'json' ? `<label class="se-field"><span>The address</span><input id="weUrl" value="${esc(w.url || '')}"></label>` : src === 'files' ? `<p class="se-note">Watching ${esc(w.path)}</p>` : src === 'window' ? `<label class="se-field"><span>The window</span><input id="weWin" value="${esc(w.window || '')}"></label>` : src === 'hook' ? `<p class="se-note">Its webhook: <code>${esc(w.hookUrl || '')}</code></p>` : ''}
      ${src === 'page' ? `<label class="se-field"><span>What it reads (selectors, || between; picked for you when you tap)</span><input id="weSel" value="${esc(w.rows || w.read || '')}"></label><label class="se-field"><span>Only lines with these words (|| between)</span><input id="weKeep" value="${esc(w.keep || '')}"></label>` : ''}
      ${src === 'json' ? `<label class="se-field"><span>The value in it (a path like current.price)</span><input id="wePath" value="${esc(w.path || '')}"></label>` : ''}
      ${src === 'gmaps' ? '' : `<label class="se-row"><span>Tell me when</span><select id="wtKind">${opt(WATCH_KINDS, d.kind || 'changes')}</select></label>
      <label class="se-field"><span>The line, words, pattern, minutes or % (for those kinds)</span><input id="wtCond" value="${esc(condOf ?? '')}" placeholder="below 500 · drops 5% · in stock||available · 1440"></label>
      <label class="se-check"><input type="checkbox" id="weGone" ${d.gone ? 'checked' : ''}> Also tell me what's gone or moved</label>`}
      ${w.extract ? `<label class="se-field"><span>The model pulls out (fields, comma between)</span><input id="weFields" value="${esc([].concat(w.extract.fields || w.extract).join(', '))}"></label><label class="se-field"><span>…and the one to watch</span><input id="weField" value="${esc(d.field || '')}"></label>` : ''}
      <p class="se-note"><b>When not to tell</b></p>
      <label class="se-field"><span>Ignore lines with (ads, clocks; || between)</span><input id="weIgnore" value="${esc(f.ignore || '')}"></label>
      <label class="se-field"><span>Only from (people, || between)</span><input id="weFrom" value="${esc(f.from || '')}"></label>
      <label class="se-field"><span>Not from</span><input id="weNot" value="${esc(f.notFrom || '')}"></label>
      <label class="se-row"><span>At most once per (minutes)</span><input id="weCool" type="number" min="0" value="${esc(f.cooldown || '')}" style="width:6em"></label>
      <label class="se-row"><span>Only after it holds for (checks)</span><input id="weHold" type="number" min="1" value="${esc(f.hold || 1)}" style="width:6em"></label>
      <label class="se-check"><input type="checkbox" id="wePres" ${f.presenting === false ? '' : 'checked'}> While I'm presenting, keep it for later</label>
      <p class="se-note"><b>How to tell me</b></p>${this.formHtml(w)}
      <p class="se-note"><b>And then</b> (on news; {headline} {item} {detail} {value} go into inputs)</p>${acts || '<p class="se-note">Nothing else.</p>'}
      <div class="chip-row"><select id="weTask"><option value="">Run a task…</option>${opt(Agent.all().filter(t => !/^watch\./.test(t.id)).map(t => [t.id, t.name]), '')}</select><input id="weTaskIn" placeholder="inputs: name=value; …" style="flex:1;min-width:10em"><button class="chip" data-wt="actadd|${w.id}|task">Add</button></div>
      <div class="chip-row"><select id="weScript"><option value="">Run a script…</option>${opt(Scripts.all().map(x => [x.name, x.name]), '')}</select><button class="chip" data-wt="actadd|${w.id}|script">Add</button></div>
      <div class="chip-row"><select id="weStart"><option value="">Start a watcher…</option>${opt(this.list().filter(x => x.id !== w.id).map(x => [x.id, x.name]), '')}</select><button class="chip" data-wt="actadd|${w.id}|start">Add</button></div>
      <p class="se-note"><b>Last check</b>${w.state?.trace ? ` · ${esc(new Date(w.state.trace.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))} · ${Math.round(w.state.trace.ms / 100) / 10} s` : ''}</p>
      <pre class="wt-trace" style="white-space:pre-wrap;font-size:12px;max-height:14em;overflow:auto;background:var(--code, rgba(127,127,127,.12));padding:8px;border-radius:8px">${esc((w.state?.trace?.lines || ['Not checked yet']).join('\n'))}</pre>
      <label class="se-check"><input type="checkbox" id="weShare" ${w.share ? 'checked' : ''}> Share in the mesh</label><p class="se-note">Others get a copy that runs with their own sign-ins.</p>`,
      [['Save', () => this.saveEdit(w)], ...(src === 'page' && this.where(w) === 'here' ? [['Check for noise (1 minute)', () => this.noise(w)]] : []), ['Show history', () => this.showHistory(w)], ...(this.where(w) === 'here' && window.DriveDeckDesktop?.diag ? [['Diagnose the page', () => this.diagnose(w)]] : []), ['Copy as JSON', () => { navigator.clipboard?.writeText(JSON.stringify(this.exportDef(w), null, 2)); toast('Copied: paste it to share, or to an LLM'); }], ['Back', () => this.sheet()]]);
    this.condShow();
  },
  formEdit(w) {
    const v = id => $(id)?.value.trim() ?? '', before = JSON.stringify([w.url, w.rows, w.read, w.keep, w.detect, w.path, w.window, w.extract, w.from, w.to, w.avoid, w.avoidRoads, w.preferRoads, w.arrive, w.look]);
    if (w.source === 'gmaps' && typeof MapWatch !== 'undefined') MapWatch.formRead(w);
    w.name = v('#weName') || w.name; if ($('#weUrl')) w.url = v('#weUrl'); if ($('#weWin')) w.window = v('#weWin'); if ($('#wePath')) w.path = v('#wePath');
    if ($('#weSel')) { if (w.rows) w.rows = v('#weSel'); else w.read = v('#weSel'); } if ($('#weKeep')) { if (v('#weKeep')) w.keep = v('#weKeep'); else delete w.keep; }
    if (w.source !== 'gmaps') w.detect = { ...this.kindDetect($('#wtKind').value, v('#wtCond')), ...($('#weGone')?.checked && $('#wtKind').value === 'new' ? { gone: true } : {}), ...(v('#weField') ? { field: v('#weField') } : {}) };
    if ($('#weFields')) w.extract = { ...(typeof w.extract === 'object' && !Array.isArray(w.extract) ? w.extract : {}), fields: v('#weFields').split(/\s*,\s*/).filter(Boolean) };
    w.filter = { ignore: v('#weIgnore'), from: v('#weFrom'), notFrom: v('#weNot'), cooldown: +v('#weCool') || 0, hold: Math.max(1, +v('#weHold') || 1), presenting: !!$('#wePres')?.checked };
    w.share = !!$('#weShare')?.checked; this.formRead(w);
    return before !== JSON.stringify([w.url, w.rows, w.read, w.keep, w.detect, w.path, w.window, w.extract, w.from, w.to, w.avoid, w.avoidRoads, w.preferRoads, w.arrive, w.look]);
  },
  async saveEdit(w) {
    const changed = this.formEdit(w);
    if (changed || this.where(w) !== 'here') { w.state = { seen: [], fails: 0, held: w.state.held }; return this.saveChecked(w); } /* what it reads changed: a new baseline */
    this.put(w); toast(`Saved: ${w.name}`); this.sheet();
  },
  /** Check for noise: reads twice a minute apart; what changed by itself (a clock, an ad) can be ignored. */
  async noise(w) {
    this.formEdit(w); const copy = JSON.parse(JSON.stringify({ ...w, state: { seen: [], fails: 0 } }));
    sheet('Checking for noise…', '<p class="se-note">Reading it now and again in a minute: whatever changes by itself can be ignored.</p><p id="wtNoiseT" class="se-note">60 s</p>', [['Cancel', () => { this.noiseOff = true; this.edit(w.id); }]]);
    this.noiseOff = false;
    try {
      const a = (await this.check(copy, { preview: true })).got;
      for (let i = 60; i > 0 && !this.noiseOff; i--) { const t = $('#wtNoiseT'); if (t) t.textContent = `${i} s`; await new Promise(r => setTimeout(r, 1000)); }
      if (this.noiseOff) return;
      const b = (await this.check(copy, { preview: true })).got, bits = x => Array.isArray(x) ? x.map(String) : typeof x === 'string' ? x.split(/\n|(?<=[.!?])\s+(?=[A-Z0-9])/).map(l => l.trim()).filter(Boolean) : [];
      const A = bits(a), B = bits(b), diff = [...B.filter(l => !A.includes(l)), ...A.filter(l => !B.includes(l))].filter(l => this.ident(l) && !A.some(x => x !== l && this.ident(x) === this.ident(l)));
      if (!diff.length) return sheet('No noise', '<p>Nothing changed by itself in a minute.</p>', [['Back', () => this.edit(w.id)]]);
      sheet('These changed by themselves', `<p class="se-note">Tick what to ignore from now on (a line with these words is skipped).</p>${diff.slice(0, 12).map((l, i) => `<label class="se-check"><input type="checkbox" data-wtn="${i}" checked> ${esc(l.slice(0, 120))}</label>`).join('')}`,
        [['Ignore them', () => { const add = diff.slice(0, 12).filter((_, i) => $(`[data-wtn="${i}"]`)?.checked).map(l => l.replace(/\|\|/g, ' ').slice(0, 40).trim());
          w.filter = { ...(w.filter || {}), ignore: [...String(w.filter?.ignore || '').split('||').filter(Boolean), ...add].join('||') }; this.put(w); toast(`Ignoring ${add.length} line${add.length === 1 ? '' : 's'}`); this.edit(w.id); }], ['Back', () => this.edit(w.id)]]);
    } catch (e) { sheet('Couldn’t check', `<p>${esc(e.message)}</p>`, [['Back', () => this.edit(w.id)]]); }
  },

  /* ---------- The Watchers list ---------- */
  sheet() {
    if (!this.can() && typeof LINK_HOST !== 'undefined' && !LINK_HOST) return this.phoneSheet(); /* DriveGen: your Mac's */
    const ago = t => { if (!t) return '–'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
    const inn = t => { if (!t) return 'soon'; const m = Math.round((t - Date.now()) / 60000); return m <= 0 ? 'now' : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`; };
    const l = this.list(), away = [...new Set(l.filter(w => w.runOn && w.runOn !== 'here').map(w => w.runOn))];
    if (away.length && !this.refreshing && Date.now() - (this.refreshed || 0) > 20000) { this.refreshing = true; /* how the ones elsewhere are doing */
      Promise.allSettled(away.map(id => Mesh.call(id, 'watch', { op: 'list' }, 20000).then(r => { for (const x of r.list || []) { const w = this.get(x.id); if (w && w.runOn === id) { const { id: _, ...st } = x; w.state = { ...w.state, ...st }; this.put(w); } } })))
        .finally(() => { this.refreshing = false; this.refreshed = Date.now(); if ($('#sheet .wt-list') && !$('#sheet').hidden) this.sheet(); }); }
    sheet('Watchers', `<p class="se-note">They check on their own${this.can() ? ' (in this Mac’s agent browser, with your sign-ins)' : ''} and tell you when something new or different shows up: a card, a quiet notification, the voice when it matters, a daily digest at ${esc(store.get('watchDigestAt', '18:00'))}. Quiet hours ${esc(store.get('watchQuiet', '22:00-07:00'))}.</p>
      <div class="wt-list">${l.map(w => `<div class="mem-row"><span><b>${w.on ? '' : '⏸ '}${esc(w.name)}</b>${w.runOn && w.runOn !== 'here' ? ` <span class="se-note">· on ${esc(this.where(w))}</span>` : ''}<br><span class="se-note">${w.state?.healed && Date.now() - w.state.healed.at < 864e5 ? '🩹 found it again another way · ' : ''}${w.state?.paused ? `⚠️ ${esc(w.state.paused)}` : w.state?.error && w.state.fails ? `⚠️ ${esc(this.why(w.state.error).slice(0, 90))}` : `checked ${ago(w.state?.at)}${w.state?.count != null ? ` · ${w.state.count} item${w.state.count === 1 ? '' : 's'}` : ''}`} · ${w.state?.changedAt ? `last news ${ago(w.state.changedAt)}` : 'no news yet'} · next ${w.on ? inn(w.state?.next) : 'off'}</span></span>
        <span class="acts"><button class="link-btn" data-wt="edit|${w.id}">Edit</button> <button class="link-btn" data-wt="now|${w.id}">Check now</button> ${/isn’t on the page/.test(w.state?.paused || '') ? `<button class="link-btn" data-wt="repick|${w.id}">Pick it again</button> ` : ''}${w.state?.error && w.state.fails || w.state?.paused ? `<button class="link-btn" data-wt="showme|${w.id}">Show me</button> ` : ''}<button class="link-btn" data-wt="onoff|${w.id}">${w.on ? 'Pause' : 'Resume'}</button> <button class="link-btn" data-wt="del|${w.id}">Delete</button></span></div>`).join('') || '<p class="se-note">None yet.</p>'}</div>
      <div class="chip-row"><button class="chip accent" data-wt="new">+ New watcher</button><button class="chip" data-wt="opts">Digest and quiet hours</button>${typeof MapWatch !== 'undefined' ? '<button class="chip" data-wt="places">Places</button>' : ''}</div>`, [['Close']]);
  },
};
ACTIONS.watchers = () => Watch.sheet();
document.addEventListener('change', e => { if (e.target.id === 'wtKind') Watch.condShow(); });
setInterval(() => { try { Watch.tick(); } catch (e) { Log.w('watch', 'Scheduler', e); } }, 30000);
setTimeout(() => { try { Watch.tick(); } catch {} }, 10000); /* after a start or an update: watchers carry on by themselves, the first check soon */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-wt]'); if (!b) return; e.stopPropagation();
  const [k, id] = b.dataset.wt.split('|'), w = id && Watch.get(id);
  if (k === 'new') return Watch.templates();
  if (k === 'list') return Watch.sheet();
  if (k === 'card') { const c = Agent.feed().find(x => x.id === id); return c && Watch.fromCard(c); }
  if (k === 'signin' && w) { const u = String(w.url || '').replace(/\{(\w+)\}/g, (m, x) => Agent.sites()[x] ?? m); await AgentWeb.go(u, w.container); AgentWeb.show(true); return toast('Sign in, then tap Check now on its card'); }
  if (k === 'tpl') return Watch.fromTemplate(id);
  if (k === 'here') { closeSheet(); return sheet('Watch something on a page', '<label class="se-field"><span>The page (its address; empty: the one open in the agent browser)</span><input id="wtUrl" placeholder="https://…"></label>', [['Open it', () => Watch.here($('#wtUrl').value.trim())], ['Cancel']]); }
  const [, , extra] = b.dataset.wt.split('|');
  if (k === 'edit' && w) return Watch.edit(id);
  if (k === 'hist' && w) return Watch.showHistory(w);
  if (k === 'healyes' && w) return Watch.healYes(w);
  if (k === 'teach') { closeSheet(); return sheet('Teach it', '<label class="se-field"><span>The page to start on (empty: the one open in the agent browser)</span><input id="wtUrl" placeholder="https://…"></label><p class="se-note">Do what you would (search, open a tab), then tap <b>Watch this part</b> in the bar and tap it.</p>', [['Start', () => Watch.teach($('#wtUrl').value.trim())], ['Cancel']]); }
  if (k === 'paste') return sheet('Paste a watcher', '<textarea id="wtJson" rows="10" style="width:100%" placeholder="{ &quot;format&quot;: &quot;studiogen-watcher&quot;, … }"></textarea>', [['Import', () => TaskLLM.import($('#wtJson').value)], ['Back', () => Watch.templates()]]);
  if (k === 'pickpath') { const p = await DriveDeckDesktop.files('pick', { file: id === 'file' }); if (!p) return; const i = $(`[data-wti="${extra}"]`), t = $(`#wtp_${extra}`); if (i) i.value = p; if (t) t.textContent = p; return; }
  if (k === 'actdel' && w) { w.actions.splice(+extra, 1); Watch.put(w); return Watch.edit(id); }
  if (k === 'actadd' && w) { Watch.formEdit(w);
    const a = extra === 'task' ? $('#weTask').value && { do: 'task', id: $('#weTask').value, inputs: Object.fromEntries($('#weTaskIn').value.split(';').map(x => x.split('=').map(y => y.trim())).filter(([x, y]) => x && y != null)) } : extra === 'script' ? $('#weScript').value && { do: 'script', name: $('#weScript').value } : $('#weStart').value && { do: 'start', id: $('#weStart').value };
    if (!a) return toast('Choose one first'); (w.actions ||= []).push(a); Watch.put(w); return Watch.edit(id); }
  if (k === 'pnow' || k === 'ponoff') { try { const r = await Link.watch({ op: k, id }); if (k === 'pnow') toast(r.hit || r.paused || 'Nothing new'); } catch (e) { toast(e.message); } return Watch.phoneSheet(); }
  if (k === 'showme' && w) return Watch.showPage(w);
  if (k === 'places') return MapWatch.placesSheet();
  if (k === 'diagnose') return Watch.diagnose(w || null);
  if (k === 'tester') return Watch.tester();
  if (k === 'testclose') { AgentWeb.call('highlight', ['', false], 3000); return $('#agentWeb .ag-test')?.remove(); }
  if (k === 'pickcancel') return AgentWeb.call('pickCancel', [], 3000);
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
