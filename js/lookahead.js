'use strict';
/* ============================================================
   Lookahead (map watchers phase 2, design: docs/maps-watchers.html § Lookahead): the traffic watcher looks ahead along
   your drive, from where you are once you're on the way (before that, from the start, against your usual time), for
   anything that slows, blocks or endangers it, in any city:
   - Google Maps' own route warnings (js/mapwatch.js route());
   - news: Google News (RSS, in your country and language) and GDELT (world news), about the city and the roads and
     areas of the drive;
   - posts: Reddit (old.reddit's JSON) and X (the agent browser, when you're signed in to X there);
   - the weather at the start, middle and end (Open-Meteo): heavy rain, storms, fog, strong wind, snow;
   - your own feeds (a city traffic police RSS, say).
   Each item is sorted by the language model (prompt map.causes: kind, place, on the route?, severity, a short line) or,
   without one, by words; it counts when it names a road or area of the drive, or its place, found on the map, lies on a
   route's path (from its turns, js/mapwatch.js steps). Each news is told once; with it the best other route that avoids
   it, Google's map of that route as a picture in the card, and Take it (DriveGen re-routes, or Google Maps navigates).
   Loaded after mapwatch.js.
   ============================================================ */
const CAUSES = {
  accident: { label: 'Accident', sev: 'delay', re: /\b(accidents?|crash\w*|collision|overturn\w*|pile-?up|hit-and-run|mishap)\b/i },
  breakdown: { label: 'Breakdown', sev: 'delay', re: /\b(break-?downs?|broke down|stalled|stranded (vehicle|bus|truck|lorry))\b/i },
  congestion: { label: 'Heavy traffic', sev: 'delay', re: /\b(traffic jams?|jams?|gridlock|congest\w*|snarl\w*|bumper-to-bumper|heavy traffic|traffic chaos|backed up|slow-moving)\b/i },
  roadworks: { label: 'Road works', sev: 'delay', re: /\b(road ?works?|repairs?|resurfac\w*|metro work|construction work|potholes?|digging|maintenance work|white-?topping)\b/i },
  closure: { label: 'Road closed', sev: 'caution', re: /\b(road closed|closures?|closed (for|to) (traffic|vehicles)|shut|blocked|barricad\w*)\b/i },
  diversion: { label: 'Diversion', sev: 'delay', re: /\b(diversions?|diverted|detours?|traffic advisory|traffic restrictions?)\b/i },
  vip: { label: 'VIP movement', sev: 'delay', re: /\b(vip|vvip|convoy|motorcade|cavalcade|(pm|cm|president|governor|minister)'?s? (visit|movement))\b/i },
  protest: { label: 'Protest', sev: 'caution', re: /\b(protests?|demonstrations?|agitation|dharna|sit-in|gherao|rasta roko|road blockade|blockade)\b/i },
  strike: { label: 'Strike', sev: 'caution', re: /\b(bandh|strikes?|hartal|shutdown)\b/i },
  procession: { label: 'Procession', sev: 'delay', re: /\b(processions?|rall(y|ies)|yatra|parade|immersion|jatra|march)\b/i },
  event: { label: 'Event crowd', sev: 'delay', re: /\b(match|concert|stadium|marathon|expo|exhibition|festival|celebrations?)\b/i },
  flooding: { label: 'Flooding', sev: 'caution', re: /\b(waterlog\w*|flood\w*|inundat\w*|submerged|water-?logged)\b/i },
  tree_fall: { label: 'Fallen tree', sev: 'caution', re: /\b(tree (falls?|fell|collapse\w*)|uprooted|fallen trees?)\b/i },
  landslide: { label: 'Landslide', sev: 'danger', re: /\b(landslides?|landslip|rockfall|cave-?in|sinkhole|road (caves?|collapse\w*))\b/i },
  fire: { label: 'Fire', sev: 'danger', re: /\b(fire|blaze|gutted)\b/i },
  signal_failure: { label: 'Signals down', sev: 'delay', re: /\b(signals? (failure|not working|down)|traffic lights? (out|down|not working))\b/i },
  police_check: { label: 'Police checks', sev: 'delay', re: /\b(checkpoints?|nakabandi|naka|police checks?|drunk[- ]driving checks?)\b/i },
  weather: { label: 'Weather', sev: 'caution', re: /\b(heavy rain|downpour|cloudburst|storm|cyclone|hailstorm|dense fog|snowfall|icy roads?)\b/i },
  other: { label: 'On your way', sev: 'delay', re: /$^/ },
};
/** Words that ask the news and posts about trouble on the roads. */
const CAUSE_WORDS = ['traffic', 'accident', 'jam', 'diversion', 'closed', 'protest', 'rally', 'procession', 'bandh', 'strike', 'VIP', 'convoy', 'waterlogging', 'flooding', '"tree fall"', 'roadworks', 'repair', 'blocked', 'landslide'];
const Lookahead = {
  KINDS: CAUSES,
  /* ---------- Where ---------- */
  km(a, b) { const r = d => d * Math.PI / 180, x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); },
  /** Is p on the way from a to b: past the start, not there yet, and not off somewhere else? */
  onWay(a, p, b) { const d = this.km(a, b), ap = this.km(a, p), pb = this.km(p, b); return ap > 0.8 && pb > 0.5 && ap + pb <= d * 1.35 + 2; },
  /** The watcher's lookahead settings (on, and each source), with the defaults. */
  look(w) { return { on: true, news: true, posts: true, x: true, weather: true, feeds: '', ...(w.look || {}) }; },
  /** The town and country of a place (once per place, kept): for the news' language and the questions. */
  async geo(w, p) {
    const k = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`, all = w.state.geo ||= {}; if (all[k]) return all[k];
    try { const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lon}&format=jsonv2&zoom=10&accept-language=en`)).json(), a = j.address || {};
      all[k] = { city: a.city || a.town || a.county || a.state_district || a.village || '', state: a.state || '', cc: (a.country_code || '').toUpperCase() }; }
    catch { all[k] = { city: '', state: '', cc: '' }; }
    const keys = Object.keys(all); for (const x of keys.slice(0, Math.max(0, keys.length - 20))) delete all[x];
    return all[k];
  },
  /** Words naming a route: its roads (via, the turns) and areas (“… in Santhosapuram”, places on the turns). */
  names(r) {
    const ROAD = /\b(rd|road|street|st|highway|hwy|expressway|expy|flyover|bridge|marg|main|cross|avenue|ave|ring|bypass|junction|jn|circle|chowk|lane|nh ?\d+\w*|sh ?\d+|i-\d+|[am]\d+)\b/i;
    const SKIP = /^(take|turn|head|continue|keep|merge|follow|slight|sharp|left|right|onto|toward|towards|details|preview|via|from|the|destination|exit|u-turn|toll road|fastest route.*|some traffic.*|typical traffic|(heavier|lighter) traffic.*|this route has tolls.*|use any lane.*|at the roundabout.*|make a u-turn.*|leave now.*|pass by.*|after|before|stay on.*|to stay on.*)$/i;
    const roads = new Set(), areas = new Set();
    for (const part of String(r.via || '').split(/\s+and\s+|,|\//)) if (part.trim().length > 3) roads.add(part.trim());
    for (const x of String(r.steps || '').split(' · ')) {
      const t = x.replace(/\(.*?\)/g, '').trim(); if (t.length < 4 || t.length > 40 || /,|\d{6}|\bkm\b|\bmin\b/.test(t) || SKIP.test(t)) continue;
      if (ROAD.test(t)) roads.add(t); else if (/^[A-Z]/.test(t) && t.split(' ').length <= 4) areas.add(t);
    }
    return { roads: [...roads].slice(0, 30), areas: [...areas].slice(0, 30) };
  },
  norm: x => String(x || '').toLowerCase().replace(/\broad\b/g, 'rd').replace(/\bjunction\b/g, 'jn').replace(/[^a-z0-9]+/g, ''),
  /** A name specific enough to match news by (not “Main Rd”, “8th Cross”). */
  specific(n) { const k = this.norm(n).replace(/(rd|st|jn)$/, ''); return k.length >= 5 && !/^\d+(st|nd|rd|th)?(main|cross|block|stage|phase|sector|avenue)?$/.test(k) && !/^(main|ring|cross|service|link|new|old)$/.test(k); },
  /** Which of the names a text mentions. */
  mentions(text, names) { const t = this.norm(text); return names.filter(n => this.specific(n) && t.includes(this.norm(n))); },
  /** Points along a path (from, the turns, to) at a share of its length (0..1). */
  along(path, f) {
    const P = path.map(([lat, lon]) => ({ lat, lon })), seg = P.slice(1).map((p, i) => this.km(P[i], p)), all = seg.reduce((a, b) => a + b, 0); let left = all * f;
    for (let i = 0; i < seg.length; i++) { if (left <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, left / seg[i]) : 0; return { lat: P[i].lat + (P[i + 1].lat - P[i].lat) * k, lon: P[i].lon + (P[i + 1].lon - P[i].lon) * k }; } left -= seg[i]; }
    return P[0];
  },
  /** A route's whole path: from, its turns, to. */
  pathOf(got, r) { return [[got.from.lat, got.from.lon], ...(r?.path || []), [got.to.lat, got.to.lon]]; },

  /* ---------- Sources ---------- */
  async text(url) {
    if (window.DriveDeckDesktop?.fetch && /^https?:/.test(url)) { const r = await DriveDeckDesktop.fetch(url); if (r?.error || r.status >= 400) throw new Error(r?.error || `answered ${r.status}`); return r.text || ''; }
    const r = await fetch(url); if (!r.ok) throw new Error(`answered ${r.status}`); return r.text();
  },
  /** An RSS or Atom feed's items: { title, text, url, at, source }. */
  rss(xml, source) {
    const tag = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : ''; };
    const clean = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    return (String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []).slice(0, 40).map(it => ({ title: clean(tag(it, 'title')), text: clean(tag(it, 'description') || tag(it, 'summary') || tag(it, 'content')).slice(0, 400),
      url: clean(tag(it, 'link')) || (it.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || '', at: Date.parse(tag(it, 'pubDate') || tag(it, 'updated') || tag(it, 'published')) || 0, source: clean(tag(it, 'source')) || source }));
  },
  async gnews(q, geo) {
    const hl = (navigator.language || 'en').split('-')[0], gl = geo.cc || (navigator.language || 'en-US').split('-')[1] || 'US';
    return this.rss(await this.text(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}-${gl}&gl=${gl}&ceid=${gl}:${hl}`), 'Google News');
  },
  async gdelt(q) {
    if (Date.now() < (this.gdeltAt || 0)) return []; this.gdeltAt = Date.now() + 6000; /* GDELT takes one question every 5 seconds */
    const raw = await this.text(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&timespan=1d&maxrecords=25&sort=datedesc`).catch(e => { if (/429/.test(e.message)) this.gdeltAt = Date.now() + 300000; throw e; }); /* busy: rest 5 minutes */
    const j = JSON.parse(raw || '{}');
    return (j.articles || []).map(a => ({ title: a.title || '', text: '', url: a.url || '', at: Date.parse(String(a.seendate || '').replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z')) || 0, source: a.domain || 'GDELT' }));
  },
  async reddit(q) { return this.rss(await this.text(`https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&t=day`), 'Reddit'); }, /* its feed: the JSON is refused to apps */
  /** X's latest posts for a search, in the agent browser (your own X sign-in there). */
  async x(w, q, trace) {
    const t = { id: `watch.${w.id}.x`, name: `${w.name}: X`, runs: 'mac', result: 'read', steps: [{ do: 'agent.open', value: xUrl('search', q), args: ['site=X', 'wait=body', 'ms=30000'] },
      { do: 'agent.wait', value: WSEL.xPosts, args: ['ms=15000'] }, { do: 'agent.read', value: WSEL.xPosts, args: ['max=8000', 'strict'], as: 'read' }] }; /* strict: posts or nothing (not a sign-in page's words) */
    const text = String(await Agent.exec(t, {}, { confirmed: true, quiet: true, trace }) ?? '');
    return text.split('\n').filter(Boolean).slice(0, 25).map(l => { const m = l.match(/·\s*(\d+)\s*(s|m|h)\b/), age = m ? +m[1] * { s: 1e3, m: 6e4, h: 36e5 }[m[2]] : 0;
      return { title: l.replace(/ ¦ /g, ' · ').slice(0, 300), text: '', url: '', at: age ? Date.now() - age : 0, source: 'X' }; });
  },
  /** The weather at points of the drive (Open-Meteo), as causes: heavy rain, storms, fog, strong wind, snow. */
  async weather(points) {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${points.map(p => p.lat.toFixed(3)).join(',')}&longitude=${points.map(p => p.lon.toFixed(3)).join(',')}&hourly=precipitation,weather_code,wind_gusts_10m,visibility&forecast_hours=3&timezone=auto`)).json();
    const out = [];
    [].concat(j).forEach((d, i) => { const h = d?.hourly; if (!h) return; const p = points[i];
      for (let k = 0; k < Math.min(3, h.time.length); k++) {
        const code = h.weather_code[k], mm = h.precipitation[k], gust = h.wind_gusts_10m[k], vis = h.visibility?.[k];
        const what = code >= 95 ? 'Thunderstorm' : mm >= 7.6 || [65, 82].includes(code) ? 'Heavy rain' : [71, 73, 75, 77, 85, 86].includes(code) ? 'Snow' : [45, 48].includes(code) && vis < 500 ? 'Dense fog' : gust >= 70 ? 'Strong wind' : '';
        if (what) { out.push({ kind: 'weather', label: what, severity: code >= 95 || gust >= 90 ? 'danger' : 'caution', place: p.name, summary: `${what} ${k ? `in about ${k} h ` : ''}around ${p.name}${mm >= 1 ? ` (${Math.round(mm)} mm/h)` : ''}`, source: 'Open-Meteo', at: Date.now(), points: [p] }); break; }
      } });
    return out;
  },
  /** Everything the sources say about the drive now (items to sort; weather comes back sorted already). */
  async gather(w, got, look, trace) {
    const all = (got.all || got.routes), nm = all.map(r => this.names(r)), roads = [...new Set(nm.flatMap(x => x.roads))].filter(n => this.specific(n)), areas = [...new Set(nm.flatMap(x => x.areas))].filter(n => this.specific(n));
    const g1 = await this.geo(w, got.from), g2 = await this.geo(w, got.to), cities = [...new Set([g1.city, g2.city].filter(Boolean))], geo = g1.cc ? g1 : g2;
    const news = n => n.replace(/\bRd\b/g, 'Road').replace(/\bJn\b/g, 'Junction');
    const pick = [...roads.slice(0, 5), ...areas.slice(0, 3)].map(n => `"${news(n)}"`).join(' OR '), city = cities.map(c => `"${c}"`).join(' OR ');
    const items = [], note = [], ask = async (name, fn) => { try { const l = await fn(); items.push(...l); note.push(`${name} ${l.length}`); } catch (e) { note.push(`${name}: ${e.message.slice(0, 40)}`); } };
    if (Agent.cfg().practice) { await ask('practice news', async () => this.rss(await this.text(new URL('labs/practice/traffic-news.xml', location.href).href), 'Practice news')); }
    else {
      if (look.news) {
        if (pick) await ask('Google News', () => this.gnews(`${city ? `(${city}) ` : ''}(${pick}) (${CAUSE_WORDS.join(' OR ')}) when:1d`, geo));
        if (city) await ask('Google News (city)', () => this.gnews(`(${city}) ("traffic advisory" OR diversion OR bandh OR VIP OR protest OR rally OR procession OR waterlogging OR "road closed") when:1d`, geo));
        if (cities[0]) await ask('GDELT', () => this.gdelt(`"${cities[0]}" (traffic OR accident OR protest OR diversion OR flooding OR rally OR closed)`));
      }
      if (look.posts && cities[0]) await ask('Reddit', () => this.reddit(`${cities[0]} (traffic OR accident OR jam OR diversion OR protest OR closed OR waterlogging)`));
      if (look.x && cities[0] && Date.now() - (w.state.xAt || 0) > 15 * 60000) { w.state.xAt = Date.now();
        try { const l = await this.x(w, `${cities[0]} (traffic OR accident OR jam OR diversion OR protest OR closed OR waterlogging) since:${new Date(Date.now() - 864e5).toISOString().slice(0, 10)}`, trace); items.push(...l); note.push(`X ${l.length}`); }
        catch (e) { note.push(/^SIGNIN/.test(e.message) ? 'X: sign in to X in the agent browser to add posts' : `X: ${e.message.slice(0, 40)}`); } }
      for (const f of String(look.feeds || '').split(/\s+/).filter(u => /^https?:\/\//.test(u))) await ask(new URL(f).host, async () => this.rss(await this.text(f), new URL(f).host));
    }
    const young = Agent.cfg().practice ? items : items.filter(i => !i.at || Date.now() - i.at < 18 * 3600e3), seen = new Set();
    const uniq = young.filter(i => { const k = this.norm(i.title).slice(0, 60); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    trace?.push(`  looked ahead: ${note.join(' · ') || 'no sources'}${cities.length ? ` (${cities.join(', ')})` : ''}`);
    return { items: uniq, roads, areas, cities, nm };
  },

  /* ---------- Sorting ---------- */
  /** Items → causes: the language model's kind, place, on the route, severity and line; without one, by words. */
  async classify(items, ctx, trace) {
    const cand = items.map(i => ({ ...i, kinds: Object.keys(CAUSES).filter(k => CAUSES[k].re.test(`${i.title} ${i.text}`)), match: this.mentions(`${i.title} ${i.text}`, [...ctx.roads, ...ctx.areas]) }))
      .filter(i => i.kinds.length).slice(0, 25);
    if (!cand.length) return [];
    let j = null;
    try {
      const props = { i: { type: 'integer' }, kind: { type: 'string', enum: Object.keys(CAUSES) }, place: { type: 'string' }, on_route: { type: 'string', enum: ['yes', 'maybe', 'no'] }, severity: { type: 'string', enum: ['delay', 'caution', 'danger'] }, until: { type: 'string' }, summary: { type: 'string' } };
      const schema = { type: 'object', required: ['causes'], properties: { causes: { type: 'array', items: { type: 'object', required: ['i', 'kind', 'on_route', 'severity', 'summary'], properties: props } } } };
      const route = `from ${ctx.from} to ${ctx.to}${ctx.cities.length ? ` in ${ctx.cities.join(' and ')}` : ''}; roads: ${ctx.roads.slice(0, 15).join(', ')}; areas: ${ctx.areas.slice(0, 15).join(', ')}`;
      j = (await LLM.ask('fast', { system: LLM.prompt('map.causes', { route, now: new Date().toLocaleString() }), prompt: cand.map((c, k) => `${k + 1}. [${c.source}${c.at ? `, ${this.ago(c.at)}` : ''}] ${c.title}${c.text ? ` — ${c.text.slice(0, 260)}` : ''}`).join('\n'), schema, temperature: 0 })).json;
    } catch (e) { trace?.push(`  sorting by words (no language model: ${String(e.message).slice(0, 40)})`); }
    if (j?.causes) return j.causes.filter(c => cand[c.i - 1] && c.on_route !== 'no').map(c => { const it = cand[c.i - 1]; return { kind: CAUSES[c.kind] ? c.kind : 'other', label: CAUSES[c.kind]?.label || 'On your way', severity: c.severity, place: c.place || it.match[0] || '', summary: c.summary || it.title, until: c.until || '', source: it.source, url: it.url, at: it.at, match: it.match, maybe: c.on_route === 'maybe' }; });
    return cand.filter(c => c.match.length).map(c => ({ kind: c.kinds[0], label: CAUSES[c.kinds[0]].label, severity: CAUSES[c.kinds[0]].sev, place: c.match[0], summary: c.title.slice(0, 140), until: '', source: c.source, url: c.url, at: c.at, match: c.match, maybe: false }));
  },
  /** Which routes a cause is on: by the names of each route, else its place found on the map near a route's path (ahead of
      you). Empty: not on this drive. */
  async locate(w, c, got) {
    const all = got.all || got.routes, nm = all.map(r => this.names(r)), byName = all.filter((r, i) => this.mentions(`${c.place} ${(c.match || []).join(' ')}`, [...nm[i].roads, ...nm[i].areas]).length).map(r => r.i);
    if (byName.length) { if (c.place) { const p = await MapWatch.place(w, c.place).catch(() => null), r = all.find(x => x.i === byName[0]); if (p && MapWatch.offPath(p, this.pathOf(got, r)).km < 2) c.ll = { lat: p.lat, lon: p.lon }; } return byName; } /* where, for the map */
    if (c.points?.length) return all.map(r => r.i); /* the weather: the whole area */
    if (!c.place) return [];
    const mid = this.along(this.pathOf(got, all[0]), 0.5), p = await MapWatch.place(w, c.place).catch(() => null);
    if (!p || this.km(p, mid) > Math.max(40, this.km(got.from, got.to))) return [];
    const on = all.filter(r => { const path = this.pathOf(got, r); return MapWatch.offPath(p, path).km < (r.path?.length ? 1 : Math.max(2, 0.1 * this.km(got.from, got.to))); }).map(r => r.i);
    if (on.length) c.ll = { lat: p.lat, lon: p.lon }; return on;
  },
  /** got.causes: what's on the drive now (each with routes and fresh = not told yet), at most every 10 minutes (else the
      last ones again, not fresh). */
  async causes(w, got, trace) {
    const look = this.look(w); if (!look.on) return [];
    const s = w.state, now = Date.now(), all = got.all || got.routes;
    if (now - (s.causesAt || 0) < 10 * 60000 && s.trip === `${got.to.lat.toFixed(3)},${got.to.lon.toFixed(3)}`) return (s.causesNow || []).map(c => ({ ...c, fresh: false }));
    s.causesAt = now;
    const t0 = Date.now(), ctx = await this.gather(w, got, look, trace), t1 = Date.now(), list = await this.classify(ctx.items, { ...ctx, from: got.from.name, to: got.to.name }, trace);
    trace?.push(`  read the sources in ${Math.round((t1 - t0) / 1000)} s, sorted ${ctx.items.length} items in ${Math.round((Date.now() - t1) / 1000)} s`);
    if (look.weather) try { const pts = [{ ...got.from, name: String(got.from.name).split(',')[0] }, { ...this.along(this.pathOf(got, all[0]), 0.5), name: 'the middle of the drive' }, { ...got.to, name: String(got.to.name).split(',')[0] }]; list.push(...await this.weather(pts)); } catch (e) { trace?.push(`  weather: ${e.message.slice(0, 40)}`); }
    const out = [], seen = s.seenCauses ||= {};
    for (const k in seen) if (now - seen[k] > 24 * 3600e3) delete seen[k];
    for (const c of list) {
      c.routes = await this.locate(w, c, got); if (!c.routes.length) continue;
      const key = `${c.kind}|${this.norm(c.place).slice(0, 30)}|${this.norm(c.summary).slice(0, 40)}`; c.fresh = !seen[key]; seen[key] = seen[key] || now; out.push(c);
    }
    s.causesNow = out.map(({ fresh, ...c }) => c).slice(0, 12);
    trace?.push(`  ahead: ${out.length ? out.map(c => `${c.label}${c.place ? ` near ${c.place}` : ''} (${c.source}${c.fresh ? ', new' : ''})`).join(' · ') : 'nothing found on the way'}`);
    return out;
  },
  ago(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; },

  /* ---------- What to do about it ---------- */
  /** The best other route: not one you avoid, not on a cause told about; with how it compares. */
  alt(got, mine, causes = []) {
    const onMine = causes.filter(c => c.routes.includes(mine.i) && !c.points), bad = r => onMine.some(c => c.routes.includes(r.i)); /* the weather covers every route */
    const r = (got.routes || []).filter(x => x !== mine && !x.skip && !bad(x)).sort((a, b) => a.min - b.min)[0]; if (!r) return null;
    const d = r.min - mine.min; if (d > (onMine.length ? 15 : 0)) return null; /* worth it: faster, or avoids what's on yours at not much more */
    return { r, d, avoids: onMine.length > 0, take: this.takeOf(got, r, mine) };
  },
  /** Where to send navigation along the other route: its turn farthest from yours. */
  takeOf(got, r, mine) {
    let via = null, far = 0; for (const [lat, lon] of r.path || []) { const k = mine.path?.length ? MapWatch.offPath({ lat, lon }, this.pathOf(got, mine)).km : 0; if (k > far) { far = k; via = { lat, lon }; } }
    if (!via && r.path?.length) { const [lat, lon] = r.path[Math.floor(r.path.length / 2)]; via = { lat, lon }; }
    return { dest: { name: String(got.to.name).split(',')[0], lat: got.to.lat, lon: got.to.lon }, via, name: r.via };
  },
  /** Take the other route: DriveGen re-routes through it while navigating; otherwise Google Maps navigates through it. */
  take(c) {
    const t = c?.take; if (!t?.dest) return;
    if (typeof LINK_HOST !== 'undefined' && !LINK_HOST && typeof nav !== 'undefined' && nav && t.via) { startNav({ ...t.dest }, { via: [t.via] }); toast(`Going via ${t.name || 'the other way'}`); return; }
    const ll = p => `${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}`;
    openExternal(/iPhone|iPad|Android/i.test(navigator.userAgent) ? `comgooglemaps://?daddr=${t.via ? `${ll(t.via)}+to:` : ''}${ll(t.dest)}&directionsmode=driving` : null,
      `https://www.google.com/maps/dir/?api=1&destination=${ll(t.dest)}${t.via ? `&waypoints=${ll(t.via)}` : ''}&travelmode=driving&dir_action=navigate`);
  },
  /** A map of your route (grey) and the other way (blue), on the roads (each drawn through its own turns by OSRM), with
      what was found on the way (orange): a small picture for the card, drawn on a canvas from OpenStreetMap's tiles, so it
      works with the window hidden (no animation frames needed) and on the phone alike. (A picture of Google's own map
      isn't possible: the agent browser isn't drawn while it's hidden.) */
  async shot(w, got, i, trace) {
    const all = got.all || got.routes, alt = all.find(r => r.i === i), mine = all.find(r => r.via === w.state.via) || all[0]; if (!alt) return '';
    const road = async r => { const p = this.pathOf(got, r), via = r?.path?.length ? [this.along(p, 1 / 3), this.along(p, 2 / 3)] : []; /* through its own stretches, so the road it takes is drawn */
      try { return (await Routing.route(got.from, got.to, via.length ? { via } : {})).coords; } catch { return p; } };
    const [a, b] = await Promise.all([road(mine), road(alt)]);
    const out = await this.picture([{ c: a, color: '#8e8e93', width: 6 }, { c: b, color: '#1a73e8', width: 7 }], [{ ...got.from, k: 'start' }, { ...got.to, k: 'end' }, ...(got.causes || []).filter(c => c.ll).map(c => ({ ...c.ll, k: 'cause' }))]);
    trace?.push(`  map of the other way: ${out ? `${Math.round(out.length / 1024)} KB` : 'the map tiles didn’t load'}`); return out;
  },
  /** Lines ([[lat, lon]…], colour, width) and points on OpenStreetMap's tiles, fitted: a JPEG data address, or ''. */
  async picture(lines, points, W = 640, H = 400) {
    const merc = (lat, lon, z) => { const n = 256 * 2 ** z, s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
    const ll = [...lines.flatMap(l => l.c), ...points.map(p => [p.lat, p.lon])]; if (ll.length < 2) return '';
    let z = 16; for (; z > 3; z--) { const xy = ll.map(([la, lo]) => merc(la, lo, z)), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]); if (Math.max(...xs) - Math.min(...xs) < W - 80 && Math.max(...ys) - Math.min(...ys) < H - 80) break; }
    const xy = ll.map(([la, lo]) => merc(la, lo, z)), xs = xy.map(p => p[0]), ys = xy.map(p => p[1]), x0 = (Math.max(...xs) + Math.min(...xs)) / 2 - W / 2, y0 = (Math.max(...ys) + Math.min(...ys)) / 2 - H / 2;
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = cv.getContext('2d'); g.fillStyle = '#e9e6df'; g.fillRect(0, 0, W, H);
    const tile = (x, y) => new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; const t = setTimeout(() => res(null), 8000); im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); }; im.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`; }); /* OpenStreetMap's own tiles (a few per news: within its tile policy) */
    const jobs = []; for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) jobs.push(tile(tx, ty).then(im => { if (im) g.drawImage(im, tx * 256 - x0, ty * 256 - y0); return !!im; }));
    const got = (await Promise.all(jobs)).filter(Boolean).length; if (!got) return '';
    g.lineJoin = g.lineCap = 'round';
    for (const l of lines) { g.strokeStyle = '#fff'; g.lineWidth = l.width + 4; const path = () => { g.beginPath(); l.c.forEach(([la, lo], k) => { const [x, y] = merc(la, lo, z); k ? g.lineTo(x - x0, y - y0) : g.moveTo(x - x0, y - y0); }); }; path(); g.stroke(); g.strokeStyle = l.color; g.lineWidth = l.width; path(); g.stroke(); }
    for (const p of points) { const [x, y] = merc(p.lat, p.lon, z); g.beginPath(); g.arc(x - x0, y - y0, p.k === 'cause' ? 9 : 7, 0, 7); g.fillStyle = { cause: '#ff9500', end: '#ea4335' }[p.k] || '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#202124'; g.stroke(); }
    g.font = '12px sans-serif'; const cr = '© OpenStreetMap contributors'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(W - g.measureText(cr).width - 10, H - 18, g.measureText(cr).width + 10, 18); g.fillStyle = '#333'; g.fillText(cr, W - g.measureText(cr).width - 5, H - 5);
    try { return cv.toDataURL('image/jpeg', 0.75); } catch { return ''; }
  },
  /** Your usual time for this trip at this hour of this weekday (from earlier days), and a new sample. */
  usual(w, min) {
    const s = w.state, d = new Date(), key = `${d.getDay()}-${d.getHours()}`, day = d.toDateString(), all = s.usual ||= {}, l = all[key] ||= [];
    if (!l.length || Date.now() - (s.usualAt || 0) > 30 * 60000) { l.push({ d: day, m: min }); all[key] = l.slice(-12); s.usualAt = Date.now(); }
    const past = l.filter(x => x.d !== day).map(x => x.m).sort((a, b) => a - b); return past.length >= 2 ? past[Math.floor(past.length / 2)] : 0;
  },
};

/* ---------- Speaking well while driving (map watchers phase 3) ----------
   A map watcher's news on your phone: important news (traffic, something on the way, leave now, a faster way) as soon as
   the voice is free, never over a turn coming up (within 300 m), a call or another reply; nice-to-know (the next town,
   fuel, food) at most every 4 minutes, dropped when 10 minutes old. With another way: “… Take NH 44? Say yes or no.” */
const RoadVoice = {
  q: [], lastAt: 0,
  busy() { return (typeof call !== 'undefined' && call) || (typeof nav !== 'undefined' && nav?.view && nav.view.toNext < 300) || (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) || (typeof Commands !== 'undefined' && Commands.pending && Date.now() - (Commands.pending.at || 0) < 20000); },
  say(p, card) {
    this.q = this.q.filter(x => Date.now() - x.at < 600000 && x.p.headline !== p.headline);
    this.q.push({ p, card, at: Date.now(), important: !!p.important }); this.q.sort((a, b) => b.important - a.important); this.q = this.q.slice(0, 4);
    this.tick();
  },
  tick() {
    clearTimeout(this.timer); const x = this.q[0]; if (!x) return;
    const spaced = x.important || Date.now() - this.lastAt > 240000;
    if (this.busy() || !spaced) { this.timer = setTimeout(() => this.tick(), x.important ? 5000 : 30000); return; }
    this.q.shift(); this.lastAt = Date.now();
    const p = x.p, t = p.take;
    if (t && typeof Commands !== 'undefined') { Commands.pending = { at: Date.now(), yes: () => Lookahead.take(x.card), no: () => {} }; Voice.respond(`${p.headline}. Take ${t.name || 'the other way'}? Say yes or no.`, null, { ask: true }); }
    else Voice.announce?.(p.headline);
    if (this.q.length) this.timer = setTimeout(() => this.tick(), 8000);
  },
};

/* ---------- Along the way (map watchers phase 3) ----------
   Fuel or charging on the way (Google Maps' places near the route ahead: rating, open now; the gap to the next one), the
   weather ahead (at the time you'll reach each part), the next town (Wikipedia, the weather there, a local headline).
   The same on the phone with no Mac reachable (RoadLocal: OpenStreetMap's fuel stations instead of Google's). */
const Roadside = {
  /** Where p is along a path [[lat, lon]…]: km from its start, and km off it. */
  proj(path, p) {
    let best = { km: 0, off: Infinity }, run = 0;
    for (let i = 1; i < path.length; i++) {
      const a = { lat: path[i - 1][0], lon: path[i - 1][1] }, b = { lat: path[i][0], lon: path[i][1] }, L = Lookahead.km(a, b);
      const kx = 111.32 * Math.cos(p.lat * Math.PI / 180), ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * 110.57, dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * 110.57, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best.off) best = { km: run + t * L, off }; run += L;
    }
    return { ...best, total: run };
  },
  /** Points ahead of `here` on a path, every stepKm up to maxKm, each with when you'll be there (min, at the path's pace). */
  ahead(path, here, min, stepKm = 10, maxKm = 120) {
    const P = this.proj(path, here), pace = min / Math.max(0.5, P.total - P.km) || 1.5, out = []; /* min: the time for the rest of the path */
    for (let k = stepKm; k <= maxKm && P.km + k < P.total; k += stepKm) out.push({ ...Lookahead.along(path, (P.km + k) / P.total), km: k, eta: Math.round(k * pace) });
    out.push({ lat: path.at(-1)[0], lon: path.at(-1)[1], km: Math.round(P.total - P.km), eta: Math.round((P.total - P.km) * pace), end: true });
    return out;
  },
  /** What to search for: fuel by country's words, or charging, or CNG. */
  what(kind, cc) { return kind === 'ev' ? 'EV charging station' : kind === 'cng' ? 'CNG station' : /^(US|CA)$/.test(cc) ? 'gas station' : 'petrol pump'; },
  /** A Google Maps search list near a point → places { name, lat, lon, rating, reviews, open, type }. */
  async google(w, what, p, trace) {
    const url = Agent.cfg().practice ? new URL(`labs/practice/gmaps.html?search=${encodeURIComponent(what)}&at=${p.lat.toFixed(5)},${p.lon.toFixed(5)}`, location.href).href : `https://www.google.com/maps/search/${encodeURIComponent(what)}/@${p.lat.toFixed(5)},${p.lon.toFixed(5)},14z`;
    const ctx = { quiet: true }; await AgentWeb.go(url, w.container, ctx); await AgentWeb.call('waitFor', [{ sel: '[role="feed"] a[href*="/maps/place/"]' }, 15000], 16000, ctx);
    const r = await AgentWeb.call('links', ['[role="feed"] a[href*="/maps/place/"]', 20], 8000, ctx);
    return (r?.links || []).map(l => { const m = l.href.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/), t = l.text, rt = t.match(/(\d[.,]\d)\s*\(([\d,.]+)\)/);
      return m && { name: l.label || t.split(' ¦ ')[0], lat: +m[1], lon: +m[2], rating: rt ? +rt[1].replace(',', '.') : 0, reviews: rt ? rt[2] : '', open: (t.match(/Open 24 hours|Open\s*[⋅·]\s*Closes [^¦·]+|Closes soon[^¦·]*|Closed\s*[⋅·]\s*Opens [^¦·]+|Closed|Open/i) || [''])[0].trim(), type: what }; }).filter(Boolean);
  },
  /** OpenStreetMap's stations within 800 m of the path ahead (Overpass), for the phone with no Mac. */
  async osm(kind, path) {
    const tag = kind === 'ev' ? 'amenity=charging_station' : kind === 'cng' ? 'fuel:cng=yes' : 'amenity=fuel', pts = path.filter((_, i) => i % Math.max(1, Math.ceil(path.length / 90)) === 0).map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(',');
    const [k, v] = tag.split('='), q = `[out:json][timeout:25];node["${k}"="${v}"](around:800,${pts});out 60;`;
    const j = await (await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`)).json();
    return (j.elements || []).map(e => ({ name: e.tags?.brand || e.tags?.name || (kind === 'ev' ? 'Charging station' : 'Fuel station'), lat: e.lat, lon: e.lon, rating: 0, reviews: '', open: e.tags?.opening_hours === '24/7' ? 'Open 24 hours' : '', type: tag }));
  },
  /** The stations on the way ahead (within 1 km of the route), nearest first, each with how far. */
  onWay(path, here, list, minRating = 0) {
    const P = this.proj(path, here), seen = new Set();
    return list.map(s => ({ ...s, ...(x => ({ at: x.km - P.km, off: x.off }))(this.proj(path, s)) })).filter(s => s.off <= 1 && s.at > 0.3 && (!minRating || !s.rating || s.rating >= minRating) && !/^Closed(?!\s*[⋅·]\s*Opens)/i.test(s.open))
      .filter(s => { const k = `${s.name}|${Math.round(s.at)}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at - b.at);
  },
  /** The weather where you'll be when you get there: the first bad stretch ahead. */
  async weatherAhead(pts) {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pts.map(p => p.lat.toFixed(3)).join(',')}&longitude=${pts.map(p => p.lon.toFixed(3)).join(',')}&hourly=precipitation,weather_code,wind_gusts_10m,visibility,temperature_2m&forecast_hours=8&timezone=auto`)).json();
    const l = [].concat(j);
    for (let i = 0; i < pts.length; i++) { const h = l[i]?.hourly; if (!h) continue; const k = Math.min(h.time.length - 1, Math.floor((new Date().getMinutes() + pts[i].eta) / 60));
      const code = h.weather_code[k], mm = h.precipitation[k], gust = h.wind_gusts_10m[k], vis = h.visibility?.[k];
      const what = code >= 95 ? 'A thunderstorm' : mm >= 7.6 || [65, 82].includes(code) ? 'Heavy rain' : [61, 63, 80, 81].includes(code) ? 'Rain' : [71, 73, 75, 77, 85, 86].includes(code) ? 'Snow' : [45, 48].includes(code) && vis < 1000 ? 'Fog' : gust >= 60 ? 'Strong wind' : '';
      if (what) return { what, p: pts[i], mm, temp: h.temperature_2m[k], important: !/^Rain$/.test(what) }; }
    return null;
  },
  /** The town at a point (OpenStreetMap), and a line about it (Wikipedia, in your language when it has one). */
  async town(p) {
    const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lon}&format=jsonv2&zoom=12&accept-language=${(navigator.language || 'en').split('-')[0]}`)).json(), a = j.address || {};
    return { name: a.town || a.city || a.village || a.suburb || a.municipality || a.county || '', state: a.state || '', cc: (a.country_code || '').toUpperCase() };
  },
  async about(name, p) {
    const lang = (navigator.language || 'en').split('-')[0];
    try { const g = await (await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${p.lat}|${p.lon}&gsradius=10000&gslimit=8&format=json&origin=*`)).json();
      const l = g.query?.geosearch || [], t = (l.find(x => Lookahead.norm(x.title).startsWith(Lookahead.norm(name))) || l.find(x => Lookahead.norm(x.title).includes(Lookahead.norm(name))))?.title; if (!t) return '';
      const s = await (await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`)).json();
      return (String(s.extract || '').match(/^.+?[.!?](\s|$)/) || [''])[0].trim().slice(0, 220); } catch { return ''; }
  },
  async now(p) { try { const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}&current=temperature_2m,weather_code`)).json(); const c = j.current || {}; return `${Math.round(c.temperature_2m)}° and ${Roadside.sky(c.weather_code)}`; } catch { return ''; } },
  sky: c => c === 0 ? 'clear' : c <= 3 ? 'some cloud' : c <= 48 ? 'foggy' : c <= 67 ? 'rainy' : c <= 77 ? 'snowy' : c <= 82 ? 'showers' : 'stormy',
  fmt: km => km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km)} km`,

  /* ---------- As map watchers (kinds fuel, weatherahead, town; source gmaps, js/mapwatch.js) ---------- */
  async read(w, got, trace) {
    const best = got.routes[0], path = Lookahead.pathOf(got, best), here = got.from, k = w.detect.kind, out = { path };
    if (k === 'fuel') {
      const pts = this.ahead(path, here, best.min, 15, 60).slice(0, 4), geo = await Lookahead.geo(w, here), what = this.what(w.detect.fuel, geo.cc), all = [];
      if (Date.now() - (w.state.fuelAt || 0) < 10 * 60000 && w.state.fuelList) all.push(...w.state.fuelList);
      else { for (const p of pts) try { all.push(...await this.google(w, what, p, trace)); } catch (e) { trace?.push(`  ${what} near ${Math.round(p.km)} km: ${e.message.slice(0, 40)}`); }
        w.state.fuelAt = Date.now(); w.state.fuelList = all.slice(0, 60); }
      out.fuel = this.onWay(path, here, all, +w.detect.rating || 0); out.what = what; out.searched = Math.round(pts.at(-1)?.km || 0);
      trace?.push(`  ${what}: ${out.fuel.length} on the way in the next ${out.searched} km${out.fuel[0] ? ` (nearest: ${out.fuel[0].name}, ${this.fmt(out.fuel[0].at)})` : ''}`);
    }
    if (k === 'weatherahead') { out.weather = await this.weatherAhead(this.ahead(path, here, best.min, 10, 200)); if (out.weather) out.weather.town = (await this.town(out.weather.p).catch(() => ({}))).name || ''; trace?.push(`  weather ahead: ${out.weather ? `${out.weather.what} in ${out.weather.p.eta} min` : 'fine all the way'}`); }
    if (k === 'town') {
      const pts = this.ahead(path, here, best.min, 5, 80), p = pts.find(x => x.eta >= 12) || pts.at(-1), [cur, next] = await Promise.all([this.town(here), this.town(p)]);
      out.town = { cur: cur.name, next: next.name, state: next.state, cc: next.cc, eta: p.eta, p };
      if (next.name && next.name !== cur.name && !(w.state.towns || []).includes(next.name)) { out.town.about = await this.about(next.name, p); out.town.weather = await this.now(p);
        if (!Agent.cfg().practice) try { const n = (await Lookahead.gnews(`"${next.name}" when:1d`, { cc: next.cc }))[0]; if (n) out.town.news = n.title; } catch {} }
      trace?.push(`  town: ${cur.name || '?'} now, ${next.name || '?'} in ${p.eta} min`);
    }
    return out;
  },
  detect(w, got) {
    const s = w.state, side = got.side || {}, where = String(got.to.name || 'there').split(',')[0], link = MapWatch.gmapsLink(got.to), drive = `${got.to.lat.toFixed(3)},${got.to.lon.toFixed(3)}`;
    if (s.drive !== drive || Date.now() - (s.driveAt || 0) > 3 * 3600e3) { s.drive = drive; s.fuelTold = []; s.towns = []; s.wxTold = ''; } s.driveAt = Date.now();
    if (side.fuel) { const [a, b] = side.fuel, gap = +w.detect.gap || 30, line = x => `${x.name}, ${this.fmt(x.at)}${x.rating ? `, ${x.rating}★` : ''}${x.open ? `, ${x.open.toLowerCase()}` : ''}`;
      if (!a && side.searched >= 20 && !s.fuelTold.includes('none')) { s.fuelTold.push('none'); return { headline: `No ${side.what} on your route in the next ${side.searched} km`, items: [], important: true, link }; }
      if (a && (!b || b.at - a.at > gap) && !s.fuelTold.includes(a.name)) { s.fuelTold.push(a.name);
        return { headline: `Last ${side.what} for a while: ${line(a)}`, items: [{ title: a.name, detail: [this.fmt(a.at) + ' ahead', a.rating ? `${a.rating}★ (${a.reviews})` : '', a.open].filter(Boolean).join(' · ') }, { title: b ? `Next after that: ${b.name}, ${this.fmt(b.at)}` : `None after it in the next ${side.searched} km` }], important: true, link: `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=driving` }; }
      if (a && w.detect.always && !s.fuelTold.includes(`n:${a.name}`)) { s.fuelTold.push(`n:${a.name}`); return { headline: `${side.what[0].toUpperCase()}${side.what.slice(1)} on the way: ${line(a)}`, items: side.fuel.slice(0, 3).map(x => ({ title: x.name, detail: [this.fmt(x.at), x.rating ? `${x.rating}★` : '', x.open].filter(Boolean).join(' · ') })), link: `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}&travelmode=driving` }; }
    }
    if (side.weather) { const x = side.weather, key = `${x.what}@${Math.round(x.p.eta / 30)}`;
      if (s.wxTold !== key) { s.wxTold = key; return { headline: `${x.what} where you'll be in about ${x.p.eta} min${x.town ? ` (near ${x.town})` : ''}`, items: [{ title: `${x.what}${x.mm >= 1 ? `, ${Math.round(x.mm)} mm/h` : ''}, ${Math.round(x.temp)}°`, detail: `${this.fmt(x.p.km)} ahead on your way to ${where}` }], important: x.important, link }; } }
    if (side.town && side.town.next && side.town.next !== side.town.cur && !s.towns.includes(side.town.next)) { const t = side.town; s.towns.push(t.next);
      return { headline: `Coming up: ${t.next}, about ${t.eta} min`, items: [t.about && { title: t.about }, t.weather && { title: t.weather }, t.news && { title: t.news, detail: 'In the news' }].filter(Boolean), important: false, link }; }
    return null;
  },
};

/* ---------- On the phone with no Mac (map watchers phase 3) ----------
   While DriveGen navigates and none of your Macs can be reached, it looks ahead itself with open data, every 5 minutes:
   the weather ahead, the next town, and fuel (OpenStreetMap's stations; the last one for a while). Settings › Location. */
const RoadLocal = {
  state: { fuelTold: [], towns: [], wxTold: '' },
  mac() { try { if (typeof Link !== 'undefined' && Link.ready?.()) return true; } catch {} return typeof Mesh !== 'undefined' && !!Mesh.m && Mesh.members().some(m => m.app === 'StudioGen' && Mesh.own(m.id) && Mesh.presence[m.id]?.caps?.watch && Date.now() - (Mesh.presence[m.id].at || 0) < 180000); },
  async tick() {
    if ((typeof LINK_HOST !== 'undefined' && LINK_HOST) || settings.roadAhead === false || typeof nav === 'undefined' || !nav?.route?.coords?.length || this.mac()) return;
    if (Date.now() - (this.at || 0) < 5 * 60000 || this.busy) return; this.at = Date.now(); this.busy = true;
    try {
      const path = nav.route.coords, here = { lat: loc.lat, lon: loc.lon }, min = (nav.view?.remainT || nav.route.duration || 1800) / 60, to = nav.dest || { lat: path.at(-1)[0], lon: path.at(-1)[1], name: 'there' };
      if (this.state.dest !== `${to.lat},${to.lon}`) this.state = { fuelTold: [], towns: [], wxTold: '', dest: `${to.lat},${to.lon}` };
      const w = { detect: {}, state: { ...this.state, drive: `${to.lat.toFixed(3)},${to.lon.toFixed(3)}`, driveAt: Date.now() } }, got = { to: { ...to, name: to.name || 'there' }, side: {} };
      let i0 = 0, d0 = Infinity; path.forEach(([la, lo], i) => { const d = Math.hypot(la - here.lat, lo - here.lon); if (d < d0) { d0 = d; i0 = i; } });
      const fuel = Roadside.onWay(path, here, await Roadside.osm('fuel', path.slice(i0)).catch(() => [])); /* the stations along the rest of the way */
      const tell = hit => { if (!hit) return; const c = Agent.post({ task: 'road.local', title: '🛣 On the way', type: 'list', headline: hit.headline, items: hit.items || [], status: 'done', ...(hit.link ? { link: hit.link } : {}) }); RoadVoice.say({ headline: hit.headline, important: hit.important }, c); };
      for (const side of [{ fuel, what: 'fuel', searched: 60 }, { weather: await Roadside.weatherAhead(Roadside.ahead(path, here, min, 10, 200)).catch(() => null) }]) { got.side = side; tell(Roadside.detect({ ...w, detect: { kind: 'x', gap: 30 } }, got)); }
      const pts = Roadside.ahead(path, here, min, 5, 80), p = pts.find(x => x.eta >= 12) || pts.at(-1), [cur, next] = await Promise.all([Roadside.town(here), Roadside.town(p)]).catch(() => [{}, {}]);
      if (next.name && next.name !== cur.name && !w.state.towns.includes(next.name)) { got.side = { town: { cur: cur.name, next: next.name, eta: p.eta, about: await Roadside.about(next.name, p), weather: await Roadside.now(p) } }; tell(Roadside.detect(w, got)); }
      Object.assign(this.state, { fuelTold: w.state.fuelTold, towns: w.state.towns, wxTold: w.state.wxTold });
    } catch (e) { Log.w('road', 'Looking ahead on the phone failed', { error: e.message }); }
    this.busy = false;
  },
};
setInterval(() => { try { RoadLocal.tick(); } catch {} }, 60000);
