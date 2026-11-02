'use strict';
/* ============================================================
   Map watchers, phase 1 (design: docs/maps-watchers.html): watchers that know where you are and where you're going.
   - Places: home and work (Settings › Location), besides Your place.
   - Where you are: DriveGen sends its position (and where it's navigating to) to your own StudioGens every 30 s while
     you drive: the link to your Mac ('loc'), and your StudioGens in the mesh; sealed, own devices only, not kept (the
     latest only, forgotten after 15 minutes). StudioGen keeps it in MapWatch.here.
   - Google Maps, read in the agent browser: directions with traffic and the other routes (each: minutes, km, via,
     notes). Practice copy: labs/practice/gmaps.html.
   - Watchers (source 'gmaps'): traffic on my route (5+ minutes more), a faster way (5+ minutes saved), leave by (the next
     meeting with a place, from home, work or here). Their news reaches DriveGen as cards, spoken when important.
   Loaded after watchtpl.js.
   ============================================================ */
const places = () => store.get('places', {});
const MapWatch = {
  here: store.get('mapHere', null), /* { lat, lon, speed, heading, at, dest: { name, lat, lon }, from } */
  fresh: () => MapWatch.here && Date.now() - MapWatch.here.at < 15 * 60000 ? MapWatch.here : null,

  /* ---------- Where you are: from DriveGen ---------- */
  /** On StudioGen: a position from one of your own devices (Direct.handle 'loc', own devices only). */
  got(p, who) {
    if (!(+p.lat && +p.lon)) return { ok: false };
    this.here = { lat: +p.lat, lon: +p.lon, speed: +p.speed || 0, heading: +p.heading || 0, at: Date.now(), dest: p.dest?.lat ? { name: String(p.dest.name || '').slice(0, 80), lat: +p.dest.lat, lon: +p.dest.lon } : null, from: who?.name || '' };
    store.set('mapHere', this.here);
    const want = Watch.list().some(w => w.on && w.source === 'gmaps' && !w.origin);
    if (want) for (const w of Watch.list()) if (w.on && w.source === 'gmaps' && w.from === 'here' && w.state && (w.state.next || 0) - Date.now() > WATCH_MS['5m']) { w.state.next = Date.now(); Watch.put(w); } /* a drive started: check soon */
    return { ok: true, want }; /* want: the phone keeps sending (else it sends less often) */
  },
  /** On DriveGen (or StudioGen with GPS): send where you are to your Mac and your StudioGens, every 30 s while driving. */
  async share() {
    if (typeof LINK_HOST !== 'undefined' && LINK_HOST) return;
    if (settings.shareLoc === false || !/^(gps|demo)$/.test(loc.source) || !(loc.speed > 1.5 || nav)) return;
    if (Date.now() - (this.sentAt || 0) < (this.wanted === false ? 300000 : 28000)) return; this.sentAt = Date.now();
    const p = { lat: +loc.lat.toFixed(5), lon: +loc.lon.toFixed(5), speed: Math.round(loc.speed || 0), heading: Math.round(loc.heading || 0), ...(nav?.dest ? { dest: { name: nav.dest.name, lat: nav.dest.lat, lon: nav.dest.lon } } : {}) };
    let want = false;
    try { if (typeof Link !== 'undefined' && Link.ready?.()) want = (await Link.loc(p))?.want || want; } catch {}
    if (typeof Mesh !== 'undefined' && Mesh.m) for (const m of Mesh.members()) if (m.id !== Mesh._me?.id && m.app === 'StudioGen' && Mesh.own(m.id) && Mesh.presence[m.id]?.caps?.watch && Date.now() - (Mesh.presence[m.id].at || 0) < 180000)
      try { want = (await Mesh.call(m.id, 'loc', p, 20000))?.want || want; } catch {}
    this.wanted = want;
  },

  /* ---------- Google Maps ---------- */
  /** A place to drive from or to: here (from DriveGen), home, work, where DriveGen is navigating to, coordinates, or an
      address (found once with the place search, then kept). */
  async place(w, what) {
    if (what && typeof what === 'object' && +what.lat) return what; /* picked in the form */
    const v = String(what || '').trim(), saved = (places().others || []).find(p => p.name.toLowerCase() === v.toLowerCase()); if (saved) return saved;
    if (v === 'here') { const h = this.fresh(); return h && { name: 'where you are', lat: h.lat, lon: h.lon }; }
    if (v === 'nav') return this.fresh()?.dest || null;
    if (v === 'home' || v === 'work') { const p = places()[v]; return p && { name: v === 'home' ? 'home' : 'work', lat: p.lat, lon: p.lon }; }
    const m = v.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/); if (m) return { name: v, lat: +m[1], lon: +m[3] };
    w.found ||= {}; if (w.found[v]) return w.found[v];
    const r = (await Routing.search(v, this.fresh() || places().home || loc).catch(() => []))[0]; if (!r) throw new Error(`Couldn’t find “${v}” on the map`);
    return (w.found[v] = { name: r.name, lat: r.lat, lon: r.lon });
  },
  /** Where a directions page lists its routes. */
  ROWS: '[data-trip-index]||[id^="section-directions-trip-"]||rows-in:#pane||rows-in:[role="main"]',
  /** Google Maps' directions address (or the practice copy's). */
  dirUrl(from, to, avoid = {}) {
    const ll = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`, flg = `${avoid.tolls ? 't' : ''}${avoid.highways ? 'h' : ''}`;
    if (Agent.cfg().practice) return new URL(`labs/practice/gmaps.html?origin=${ll(from)}&destination=${encodeURIComponent(to.name ? `${to.name}@${ll(to)}` : ll(to))}${flg ? `&dirflg=d${flg}` : ''}`, location.href).href;
    /* avoid tolls / highways: Google's older address form takes them (dirflg); the newer one doesn't */
    return flg ? `https://www.google.com/maps?saddr=${ll(from)}&daddr=${ll(to)}&dirflg=d${flg}` : `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=driving`;
  },
  /** This app's own route rules (Google Maps has none of them): skip routes with construction or closures, routes along
      roads you avoid; prefer roads you like. Each route gets skip (why) or prefer. */
  rules(w, routes) {
    /* loose: case, spaces and Road/Rd don't matter (“silkboard”, “Silk Board Junction”; “MG Road”, “M G Rd”) */
    const norm = x => String(x || '').toLowerCase().replace(/\broad\b/g, 'rd').replace(/[^a-z0-9]+/g, '');
    const names = x => String(x || '').split(/\|\||,/).map(t => t.trim()).filter(Boolean), avoid = names(w.avoidRoads), prefer = names(w.preferRoads);
    for (const r of routes) {
      const t = norm(`${r.via} ${r.notes.join(' ')} ${r.steps || ''}`), hit = avoid.find(a => t.includes(norm(a)));
      r.skip = w.avoid?.work && r.warn.length ? r.warn[0] : hit ? `along ${hit}` : '';
      r.prefer = prefer.some(p => t.includes(norm(p)));
    }
    const ok = routes.filter(r => !r.skip); return ok.length ? ok.sort((a, b) => (b.prefer - a.prefer) || 0) : routes;
  },
  /** Days and hours to watch (weekdays 8–10, say): outside them, nothing is read. */
  activeNow(w) {
    const a = w.active; if (!a) return true; const d = new Date(), m = d.getHours() * 60 + d.getMinutes(), hm = x => { const [h, mi] = String(x || '').split(':').map(Number); return h * 60 + (mi || 0); };
    if (a.days?.length && !a.days.includes(d.getDay())) return false;
    if (a.from && a.to) { const f = hm(a.from), t = hm(a.to); return f <= t ? m >= f && m < t : m >= f || m < t; }
    return true;
  },
  /** What a directions page says about one route: minutes (in traffic), km, via, notes (traffic, tolls, accidents). */
  route(line) {
    const t = String(line).replace(/ ¦ /g, ' · ');
    const h = +(t.match(/(\d+)\s*(h|hr|hrs|hour|hours)\b/i) || [])[1] || 0, mn = +(t.match(/(\d+)\s*(min|mins|minutes)\b/i) || [])[1] || 0, min = h * 60 + mn;
    const km = +((t.match(/(\d+(?:[.,]\d+)?)\s*km\b/i) || [])[1] || '0').replace(',', '.') || (+(t.match(/(\d+(?:[.,]\d+)?)\s*m\b/) || [])[1] || 0) / 1000;
    const via = (t.match(/\bvia\s+([^·|\n]+?)(?=\s*(·|\||$|\d+\s*(min|h|km)\b|fastest|best route|this route|typical|heavier|lighter|usual|due to|$))/i) || [])[1]?.trim() || '';
    const notes = [/fastest route[^·|]*/i, /best route[^·|]*/i, /(heavier|lighter|usual|typical) traffic[^·|]*/i, /this route has tolls?[^·|]*/i, /\b(accident|crash|road closed|closure|construction|road work)[^·|]*/i].map(re => (t.match(re) || [])[0]).filter(Boolean).map(x => x.trim());
    return min ? { min, km: Math.round(km * 10) / 10, via, notes, warn: notes.filter(n => /accident|crash|closed|closure|construction|road work/i.test(n)) } : null;
  },
  /** Read Google Maps' directions from → to in the agent browser: { from, to, routes: [{ min, km, via, notes }] }. */
  async directions(w, from, to, trace) {
    const url = this.dirUrl(from, to, w.avoid), rows = this.ROWS;
    const t = { id: `watch.${w.id}`, name: w.name, runs: 'mac', result: 'read', steps: [{ do: 'agent.open', value: url, args: ['site=Google Maps', 'wait=body', 'ms=30000'] },
      { do: 'agent.wait', value: rows, args: ['ms=20000'] }, { do: 'agent.read', value: rows, args: ['max=8000', 'strict'], as: 'read' }] };
    const text = String(await Agent.exec(t, {}, { confirmed: true, quiet: true, trace }) ?? '');
    const routes = text.split('\n').map(l => this.route(l)).filter(Boolean).slice(0, 4); routes.forEach((r, i) => { r.i = i; }); /* i: its place on Google's page */
    if (!routes.length) { trace?.push('  routes: none read'); throw new Error(`NOTFOUND:${rows}`); }
    if (w.avoidRoads || w.preferRoads || this.looking(w)) await this.steps(w, url, routes, trace, from, to).catch(e => trace?.push(`  turns: couldn’t read them (${e.message})`));
    const pool = this.rules(w, routes);
    trace?.push(`  routes: ${routes.map(r => `${r.min} min${r.via ? ` via ${r.via}` : ''}${r.warn.length ? ` (${r.warn[0]})` : ''}${r.skip ? ` [skipped: ${r.skip}]` : r.prefer ? ' [preferred]' : ''}`).join(' · ')}`);
    if (routes.every(r => r.skip)) trace?.push('  every route has something you avoid: it tells you about them all');
    return { from, to, routes: pool, all: routes, url };
  },
  /** A traffic watcher that looks ahead (js/lookahead.js): it reads each route's turns and where they are. */
  looking(w) { return typeof Lookahead !== 'undefined' && (w.detect?.kind === 'traffic' ? Lookahead.look(w).on : this.SIDE.includes(w.detect?.kind)); },
  /** Kinds about what's along the way (js/lookahead.js Roadside): they need the route's turns and where they are. */
  SIDE: ['fuel', 'weatherahead', 'town'],
  /** Each route's turn-by-turn steps (Google's Details: every road and landmark on the way, not just its “via”), for avoid
      and prefer roads; and, when a name isn't in them (a junction such as Silk Board: Google names roads, not what they
      cross), where each turn is (a click on a turn moves the map there), so a place can be checked against the route's
      path. Kept 12 hours per route (its via and length), so most checks don't open them again. */
  async steps(w, url, routes, trace, from, to) {
    /* kept for every map watcher to the same place (12 hours): one reads the turns, the others use them */
    const shared = store.get('mapTurns', {}), dest = `${to.lat.toFixed(3)},${to.lon.toFixed(3)}`, keep = shared[dest] ||= {}, now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), ctx = { quiet: true };
    for (const d in shared) if (!Object.values(shared[d]).some(x => now - x.at < 12 * 3600e3)) delete shared[d];
    const norm = x => String(x || '').toLowerCase().replace(/\broad\b/g, 'rd').replace(/[^a-z0-9]+/g, '');
    const names = String(`${w.avoidRoads || ''},${w.preferRoads || ''}`).split(/\|\||,/).map(x => x.trim()).filter(Boolean);
    for (const k in keep) if (now - keep[k].at > 12 * 3600e3) delete keep[k];
    let opened = 0, pts = 0;
    const only = this.SIDE.includes(w.detect?.kind) && !w.avoidRoads && !w.preferRoads; /* along the way: only the route you'll drive */
    for (const [i, r] of routes.entries()) {
      if (only && i) break;
      const key = r.via || `${r.km}`; if (keep[key]) { r.steps = keep[key].t; r.path = keep[key].p; continue; }
      if (opened++) { await AgentWeb.go(url, w.container, ctx); await AgentWeb.call('waitFor', [{ sel: this.ROWS }, 15000], 16000, ctx); }
      const view = { view: AgentWeb.views.get(Watch.viewKey(w)) };
      /* the selected route has Details already (and a click on it opens them); another is selected first. exists before
         clickOn: clickOn looks for the words anywhere when the selector has none, which would be another route's Details */
      const det = { sel: `[data-trip-index="${i}"] button`, text: 'Details' }, has = async (ms = 0) => { for (const t0 = Date.now(); ; await sleep(300)) { if ((await AgentWeb.call('exists', [det], 4000, view))?.ok) return true; if (Date.now() - t0 >= ms) return false; } };
      let d = await has() ? await AgentWeb.call('clickOn', [det], 8000, view) : null;
      if (!d?.ok) { await AgentWeb.call('clickOn', [{ sel: `[data-trip-index="${i}"]` }], 8000, view); await sleep(700);
        const open = (await AgentWeb.call('exists', [{ sel: '[data-trip-index]' }], 4000, view))?.ok === false; /* it opened its details */
        d = open ? { ok: true } : await has(3000) ? await AgentWeb.call('clickOn', [det], 8000, view) : null; }
      if (!d?.ok) { trace?.push(`  turns: no Details for route ${i + 1}`); continue; }
      await sleep(2500);
      const t = (await AgentWeb.call('words', ['[role="main"]||#pane||body', 40000], 10000, view))?.text || '';
      r.steps = [...new Set(t.split('\n').filter(x => x.length > 2 && !/^\d+(\.\d+)?\s*(m|km|min)$/.test(x)))].join(' · ').slice(0, 6000);
      r.path = [];
      if (this.looking(w) || names.some(n => !norm(`${r.via} ${r.steps}`).includes(norm(n)))) for (let j = 0; j < 40; j++) {
        const m = await AgentWeb.call('mapAt', ['[data-stepindex]', j, 1500], 3000, view); if (!m?.ok) break;
        const [la, lo, z] = String(m.at || '').split(',').map(Number); if (z >= 15) r.path.push([Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]); /* zoomed in on a turn, not the whole route */
      }
      pts += r.path.length; keep[key] = { at: now, t: r.steps, p: r.path };
    }
    trace?.push(`  turns read for ${routes.filter(r => r.steps).length} of ${routes.length} routes${opened ? (pts ? ` (${pts} turns placed on the map)` : '') : ' (kept from earlier)'}`);
    /* a name the turns don't have: the place on the map, near a route's path (from turn to turn) */
    for (const name of names) {
      if (!from || !to || routes.every(r => norm(`${r.via} ${r.steps || ''}`).includes(norm(name)))) continue;
      const p = await this.place(w, name).catch(() => null); if (!p) { trace?.push(`  ${name}: not found on the map`); continue; }
      const near = [];
      for (const r of routes) {
        if (norm(`${r.via} ${r.steps || ''}`).includes(norm(name)) || !r.path?.length) continue;
        const d = this.offPath(p, [[from.lat, from.lon], ...r.path, [to.lat, to.lon]]);
        if (d.near) { r.steps = `${r.steps || ''} · ${name}`; near.push(`${r.via || 'a route'} (${Math.round(d.km * 1000)} m)`); }
      }
      trace?.push(`  ${name}: ${near.length ? `on the way of ${near.join(', ')}` : 'not on any route'}`);
    }
    if (opened) await AgentWeb.go(url, w.container, ctx); /* the routes list again, for Show me */
    try { store.set('mapTurns', shared); } catch { store.set('mapTurns', { [dest]: keep }); }
  },
  /** How far p is from a path (points [lat, lon], straight between them): { km, near }. Near: within 300 m, or a little more
      along long stretches between turns (roads bend: up to 800 m). */
  offPath(p, path) {
    const kx = 111.32 * Math.cos(p.lat * Math.PI / 180), ky = 110.57, xy = ([la, lo]) => [(lo - p.lon) * kx, (la - p.lat) * ky];
    let min = Infinity, near = false;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = xy(path[i - 1]), [bx, by] = xy(path[i]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, km = Math.hypot(ax + t * dx, ay + t * dy), tol = Math.min(0.8, Math.max(0.3, 0.06 * Math.sqrt(L2)));
      min = Math.min(min, km); if (km < tol) near = true;
    }
    return { km: min, near };
  },
  /** The source 'gmaps' (js/watch.js read): traffic and faster ways between two places, or the next meeting's leave-by. */
  async read(w, trace) {
    if (!this.activeNow(w)) { trace?.push('  not now (outside the days and hours it watches)'); return { idle: true }; }
    if (w.detect?.kind === 'leaveby') return this.leaveRead(w, trace);
    let from = await this.place(w, w.from || 'here'), onWay = (w.from || 'here') === 'here' && !!from; const to = await this.place(w, w.to || 'nav'), h = this.fresh();
    if (!from || !to) { trace?.push(`  waiting: ${!from ? 'no recent position from your phone (it sends one while you drive)' : 'no destination (navigate in DriveGen, or set one in Edit)'}`); return { idle: true }; }
    /* on the way (your phone's position between the start and the end): only the road still ahead counts */
    if (!onWay && h && typeof Lookahead !== 'undefined' && Lookahead.onWay(from, h, to)) { from = { name: 'where you are', lat: h.lat, lon: h.lon }; onWay = true; trace?.push('  on the way: from where you are now'); }
    if (!onWay && /^(fuel|town)$/.test(w.detect?.kind)) { trace?.push('  waiting: it starts once you’re on the way (your phone between the start and the end)'); return { idle: true }; }
    const d = await this.directions(w, from, to, trace); d.onWay = onWay;
    if (w.detect?.kind === 'traffic' && this.looking(w)) d.causes = await Lookahead.causes(w, d, trace).catch(e => { trace?.push(`  looking ahead failed: ${e.message.slice(0, 60)}`); return []; });
    if (this.SIDE.includes(w.detect?.kind)) d.side = await Roadside.read(w, d, trace);
    return d;
  },
  /** Leave by: the next meeting with a place (the calendar task), then directions to it from home, work or here. */
  async leaveRead(w, trace) {
    if (w.arrive) { /* be somewhere by a time (no calendar) */
      const start = this.when(w.arrive), to = await this.place(w, w.to), from = await this.place(w, w.from || 'home') || await this.place(w, 'home');
      if (!to || !from) throw new Error(!to ? 'Where to? (Edit the watcher)' : 'Where from? (Edit the watcher, or set Home in Places)');
      if (!start || start < Date.now() || start - Date.now() > 3 * 3600e3) { trace?.push(`  ${w.arrive} isn't within the next 3 hours`); return { idle: true }; }
      const d = await this.directions(w, from, to, trace); return { ...d, event: { title: to.name, when: w.arrive, place: to.name, start } };
    }
    const t = Agent.get('cal.next'); if (!t) throw new Error('No calendar task here (Agent › Library)');
    const c = Agent.asCard(await Agent.exec(t, {}, { confirmed: true, quiet: true, trace })), it = c.items?.[0];
    const start = it && this.when(it.when), placeName = it && (it.place || '').trim();
    if (!it || !start || !placeName || /online|teams|zoom|meet|call/i.test(placeName)) { trace?.push(`  no meeting to drive to${it ? ` (next: ${it.title}${placeName ? `, ${placeName}` : ''})` : ''}`); return { idle: true }; }
    if (start - Date.now() > 3 * 3600e3 || start < Date.now()) { trace?.push(`  next meeting at ${it.when}: not within 3 hours`); return { idle: true }; }
    const from = await this.place(w, w.from || 'home') || await this.place(w, 'home'), to = await this.place(w, placeName);
    if (!from) throw new Error('Set your home (or work) in Settings › Location for leave-by');
    const d = await this.directions(w, from, to, trace);
    return { ...d, event: { title: it.title, when: it.when, place: placeName, start } };
  },
  /** “3:00 PM”, “15:00”, “3 pm” today → a time; null when it can't tell. */
  when(s) { const m = String(s || '').match(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i); if (!m) return null; let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase(); if (ap.startsWith('p') && h < 12) h += 12; if (ap.startsWith('a') && h === 12) h = 0; const d = new Date(); d.setHours(h, mi, 0, 0); return +d; },
  clock: t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  gmapsLink(to) { return `https://www.google.com/maps/dir/?api=1&destination=${to.lat.toFixed(5)},${to.lon.toFixed(5)}&travelmode=driving`; },

  /* ---------- Deciding ---------- */
  /** Map kinds (js/watch.js detect): traffic, faster, leaveby. */
  detect(w, got) {
    const d = w.detect, s = w.state; if (!got || got.idle || !got.routes?.length) return null;
    if (this.SIDE.includes(d.kind)) return typeof Roadside !== 'undefined' ? Roadside.detect(w, got) : null; /* fuel, weather ahead, next town */
    const trip = `${got.to.lat.toFixed(3)},${got.to.lon.toFixed(3)}`, best = got.routes.reduce((a, b) => b.min < a.min ? b : a), now = Date.now();
    if (s.trip !== trip || now - (s.tripAt || 0) > 3 * 3600e3) { s.trip = trip; s.base = best.min; s.told = best.min; s.via = best.via; s.suggested = ''; s.leave = {}; } /* a new trip: what's there now is the starting point */
    s.tripAt = now;
    const link = this.gmapsLink(got.to), arrive = m => this.clock(now + m * 60000), where = String(got.to.name || 'there').split(',')[0]; /* “DoubleTree by Hilton Bengaluru Whitefield”, not its whole address */
    if (d.kind === 'traffic') {
      const mine = got.routes.find(r => r.via && r.via === s.via) || got.routes[0], step = +d.min || 5, look = typeof Lookahead !== 'undefined';
      const causes = got.causes || [], fresh = causes.filter(c => c.fresh && c.routes.includes(mine.i)), usual = look && !got.onWay && w.from !== 'here' ? Lookahead.usual(w, best.min) : 0;
      /* the other way, when it's faster or avoids what's on yours: said with the news, its map in the card, Take it */
      const withAlt = hit => { const a = look && Lookahead.alt(got, mine, causes); if (!hit || !a) return hit;
        hit.items.push({ title: `Or via ${a.r.via || 'another way'}: ${a.r.min} min`, detail: [a.d < 0 ? `${-a.d} min faster` : a.d === 0 ? 'the same time' : `${a.d} min longer`, a.avoids ? 'avoids it' : '', ...a.r.notes.filter(n => !/fastest/i.test(n))].filter(Boolean).join(' · ') });
        return { ...hit, shotOf: a.r.i, take: a.take, alt: a.r.via }; };
      if (fresh.length) { const c = fresh[0], ago = x => x.at ? Lookahead.ago(x.at) : '';
        return withAlt({ headline: fresh.length === 1 ? `${c.label}${c.place ? `: ${c.place},` : ''} on your way to ${where}` : `${fresh.length} things on your way to ${where}: ${fresh.slice(0, 3).map(x => `${x.label.toLowerCase()}${x.place ? ` (${x.place})` : ''}`).join(', ')}`,
          items: fresh.slice(0, 4).map(x => ({ title: x.summary, detail: [x.source, ago(x), x.until ? `until ${x.until}` : '', x.severity === 'danger' ? 'avoid it' : x.severity === 'caution' ? 'take care' : ''].filter(Boolean).join(' · ') })),
          value: mine.min, important: true, severity: fresh.some(x => x.severity === 'danger') ? 'danger' : fresh.some(x => x.severity === 'caution') ? 'caution' : 'delay', link }); }
      if (mine.min - s.told >= step) { const more = Math.max(mine.min - s.base, mine.min - s.told); s.told = mine.min; /* never “adds 0 min” (the start was another route) */
        return withAlt({ headline: `Traffic adds ${more} min to ${where}: arriving about ${arrive(mine.min)}`, items: [{ title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''}`, detail: [`${more} min more than when you set off`, ...mine.notes].join(' · ') }], value: mine.min, important: true, link }); }
      if (usual && best.min - usual >= Math.max(5, usual * 0.2) && s.usualTold !== new Date().toDateString()) { s.usualTold = new Date().toDateString();
        return withAlt({ headline: `Today ${best.min} min to ${where}: usually ${usual} at this time`, items: [{ title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''}`, detail: mine.notes.join(' · ') }, ...causes.filter(c => c.routes.includes(mine.i)).slice(0, 2).map(c => ({ title: c.summary, detail: c.source }))], value: best.min, important: true, link }); }
      if (s.told - mine.min >= step) { s.told = mine.min; return { headline: `Traffic easing to ${where}: ${mine.min} min, arriving about ${arrive(mine.min)}`, items: [], value: mine.min, link }; }
      if (mine.warn.length && s.warned !== mine.warn[0]) { s.warned = mine.warn[0]; return withAlt({ headline: `${mine.warn[0]} on your route to ${where}`, items: [{ title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''}` }], important: true, link }); }
      return null;
    }
    if (d.kind === 'faster') {
      const mine = got.routes.find(r => r.via && r.via === s.via) || got.routes[0], save = mine.min - best.min;
      if (best !== mine && save >= (+d.save || 5) && s.suggested !== best.via) { s.suggested = best.via;
        return { headline: `A faster way to ${where}${best.via ? ` via ${best.via}` : ''} saves ${save} min`, items: [{ title: `${best.min} min${best.via ? ` via ${best.via}` : ''}`, detail: best.notes.join(' · ') }, { title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''} (your way)` }], value: save, important: true, link }; }
      if (s.suggested && s.suggested !== best.via) s.suggested = ''; /* that one's gone: a new one may be told */
      return null;
    }
    if (d.kind === 'leaveby') {
      const e = got.event; if (!e) return null; const buf = +d.buffer || 10, leave = e.start - (best.min + buf) * 60000, key = `${e.title}@${e.start}`, told = s.leave[key] || 0;
      if (leave - now <= 2 * 60000 && told < 2) { s.leave[key] = 2; return { headline: `Leave now for ${e.title} at ${e.when}: ${best.min} min to ${e.place}`, items: [{ title: e.place, when: e.when, detail: `${best.min} min with traffic${best.via ? ` via ${best.via}` : ''}` }], important: true, link }; }
      if (leave - now <= 30 * 60000 && told < 1) { s.leave[key] = 1; return { headline: `Leave by ${this.clock(leave)} for ${e.title} at ${e.when} (${best.min} min with traffic)`, items: [{ title: e.place, when: e.when, detail: `${best.min} min${best.via ? ` via ${best.via}` : ''} · ${buf} min to spare` }], important: true, link }; }
      s.nextAt = Math.max(now + 60000, Math.min(leave - 30 * 60000, leave - 2 * 60000 > now ? leave - 2 * 60000 : now + 300000)); /* check again in time for the next step */
      return null;
    }
    return null;
  },

  /* ---------- The form: from, to, route options, when ---------- */
  /** A place field: quick choices (where I am, where DriveGen is navigating, home, work, your places) or a search. */
  field(id, label, v, o = {}) {
    const P = places(), quick = [...(o.here ? [['here', 'Where I am (my phone)']] : []), ...(o.nav ? [['nav', 'Where DriveGen is navigating']] : []), ...(P.home ? [['home', 'Home']] : []), ...(P.work ? [['work', 'Work']] : []), ...(P.others || []).map(p => [p.name, p.name])];
    const shown = !v ? 'not chosen' : typeof v === 'object' ? v.name : (quick.find(q => q[0] === v) || [v, v])[1];
    return `<div class="se-field mp-field"><span>${esc(label)}: <b id="mpn_${id}">${esc(shown)}</b></span><input type="hidden" data-mpv="${id}" value="${esc(typeof v === 'object' ? JSON.stringify(v) : v || '')}">
      <div class="chip-row">${quick.map(([k, n]) => `<button type="button" class="chip" data-mpchip="${id}|${esc(k)}|${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="chip-row"><input data-mpq="${id}" placeholder="Or search an address or place" style="flex:1;min-width:12em"><button type="button" class="chip" data-mps="${id}">Search</button></div><div class="pick-list" id="mpr_${id}"></div></div>`;
  },
  value(id) { const v = $(`[data-mpv="${id}"]`)?.value || ''; if (!v) return ''; try { return v.startsWith('{') ? JSON.parse(v) : v; } catch { return v; } },
  /** Route options and when: Google's (tolls, highways) and this app's own (construction, roads to avoid or prefer, days). */
  options(w = {}) {
    const a = w.avoid || {}, act = w.active || {}, day = (d, n) => `<label class="se-check" style="display:inline-flex;margin-right:10px"><input type="checkbox" data-mpday="${d}" ${(act.days || []).includes(d) ? 'checked' : ''}> ${n}</label>`;
    return `<p class="se-note"><b>Route options</b></p>
      <label class="se-check"><input type="checkbox" id="mpTolls" ${a.tolls ? 'checked' : ''}> Avoid tolls</label>
      <label class="se-check"><input type="checkbox" id="mpHighways" ${a.highways ? 'checked' : ''}> Avoid highways</label>
      <label class="se-check"><input type="checkbox" id="mpWork" ${a.work ? 'checked' : ''}> Avoid routes with construction or closures</label>
      <label class="se-field"><span>Avoid these roads or places on the way (commas between)</span><input id="mpAvoid" value="${esc(w.avoidRoads || '')}" placeholder="Silk Board, MG Road"></label>
      <label class="se-field"><span>Prefer these roads (commas between)</span><input id="mpPrefer" value="${esc(w.preferRoads || '')}" placeholder="NH44"></label>
      <p class="se-note"><b>When to watch</b> (empty: always)</p><div>${[[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']].map(([d, n]) => day(d, n)).join('')}</div>
      <div class="chip-row"><label class="se-row"><span>From</span><input id="mpFrom" type="time" value="${esc(act.from || '')}"></label><label class="se-row"><span>to</span><input id="mpTo" type="time" value="${esc(act.to || '')}"></label></div>`;
  },
  /** Fuel or charging: which, the least rating, and how long a gap to warn about. */
  fuelOptions(w) {
    const d = w.detect || {}, o = (v, t) => `<option value="${v}" ${(d.fuel || 'petrol') === v ? 'selected' : ''}>${t}</option>`;
    return `<p class="se-note"><b>What to look for</b></p><label class="se-row"><span>Fuel</span><select id="mfKind">${o('petrol', 'Petrol or diesel')}${o('cng', 'CNG')}${o('ev', 'EV charging')}</select></label>
      <label class="se-row"><span>At least ★ (0: any)</span><input id="mfRating" type="number" min="0" max="5" step="0.5" value="${esc(d.rating ?? 0)}"></label>
      <label class="se-row"><span>Warn when the next one is more than (km)</span><input id="mfGap" type="number" min="5" max="200" value="${esc(d.gap ?? 30)}"></label>
      <label class="se-check"><input type="checkbox" id="mfAlways" ${d.always ? 'checked' : ''}> Also tell me the nearest one on the way (not only before a long gap)</label>`;
  },
  /** Looking ahead (js/lookahead.js): what it reads besides Google Maps. */
  lookOptions(w) {
    if (typeof Lookahead === 'undefined') return ''; const l = Lookahead.look(w), c = (id, on, t) => `<label class="se-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${t}</label>`;
    return `<p class="se-note"><b>Look ahead</b>: besides Google Maps, what's happening on the way (accidents, jams, road works, closures, diversions, VIP movement, protests, strikes, processions, crowds, flooding, fallen trees, the weather), in any city</p>
      ${c('mlOn', l.on, 'Look ahead along the drive')}${c('mlNews', l.news, 'News (Google News, GDELT)')}${c('mlPosts', l.posts, 'Posts on Reddit')}${c('mlX', l.x, 'Posts on X (sign in to X in the agent browser)')}${c('mlWeather', l.weather, 'Weather on the way (rain, storms, fog, wind)')}
      <label class="se-field"><span>Your own feeds (RSS addresses, e.g. your city's traffic police; spaces between)</span><input id="mlFeeds" value="${esc(l.feeds || '')}" placeholder="https://…/rss"></label>`;
  },
  readOptions(w) {
    if ($('#mfKind')) w.detect = { ...w.detect, fuel: $('#mfKind').value, rating: +$('#mfRating').value || 0, gap: +$('#mfGap').value || 30, always: $('#mfAlways').checked };
    if ($('#mlOn')) w.look = { on: $('#mlOn').checked, news: $('#mlNews').checked, posts: $('#mlPosts').checked, x: $('#mlX').checked, weather: $('#mlWeather').checked, feeds: $('#mlFeeds').value.trim() };
    w.avoid = { tolls: !!$('#mpTolls')?.checked, highways: !!$('#mpHighways')?.checked, work: !!$('#mpWork')?.checked };
    w.avoidRoads = $('#mpAvoid')?.value.trim() || ''; w.preferRoads = $('#mpPrefer')?.value.trim() || '';
    const days = $$('[data-mpday]').filter(c => c.checked).map(c => +c.dataset.mpday), from = $('#mpFrom')?.value || '', to = $('#mpTo')?.value || '';
    w.active = days.length || (from && to) ? { days, from, to } : null;
  },
  /** The whole form for a map template, or a map watcher's Edit (fields first, then how to tell). */
  formHtml(w, kind) {
    const lb = kind === 'leaveby';
    return `${this.field('from', 'From', w.from ?? (lb ? 'home' : 'here'), { here: true })}${lb && !w.arrive && !w.to ? '<p class="se-note">To: your next meeting with a place (from your calendar).</p>' : this.field('to', 'To', w.to ?? (lb ? '' : 'nav'), { nav: !lb })}
      ${lb ? `<label class="se-row"><span>Be there by (empty: your next meeting)</span><input id="mpArrive" type="time" value="${esc(w.arrive || '')}"></label>` : ''}${kind === 'fuel' ? this.fuelOptions(w) : ''}${this.options(w)}${kind === 'traffic' ? this.lookOptions(w) : ''}`;
  },
  formRead(w) { w.from = this.value('from') || w.from; if ($('[data-mpv="to"]')) w.to = this.value('to') || w.to; if ($('#mpArrive')) w.arrive = $('#mpArrive').value || ''; this.readOptions(w); },
  formSheet(T) {
    const base = T.make({}), kind = base.detect?.kind;
    sheet(T.name, `${T.about ? `<p class="se-note">${esc(T.about)}</p>` : ''}${this.formHtml(base, kind)}${Watch.formHtml(base)}`,
      [['Check and save', async () => { const w = Watch.make({ name: T.name, template: T.id, templateInputs: {}, ...base }); this.formRead(w); Watch.formRead(w);
        if (kind !== 'leaveby' || w.arrive) { if (!w.to) return toast('Where to? Choose or search a place'); }
        if (w.to && typeof w.to === 'object') w.name = `${{ faster: 'Faster way', leaveby: 'Be there', fuel: w.detect.fuel === 'ev' ? 'Charging' : 'Fuel', weatherahead: 'Weather', town: 'Towns' }[kind] || 'Lookahead'} to ${w.to.name.split(',')[0]}`;
        await Watch.saveChecked(w); }], ['Back', () => Watch.templates()]]);
  },
  /* ---------- Places: home, work and your own ---------- */
  placesSheet() {
    const P = places(), row = (k, n, p) => `<div class="mem-row"><span><b>${esc(n)}</b><br><span class="se-note">${esc(p?.name || 'not set')}</span></span><span class="acts"><button class="link-btn" data-mpset="${esc(k)}">${p ? 'Change' : 'Set'}</button>${p ? `<button class="link-btn" data-mpdel="${esc(k)}">Forget</button>` : ''}</span></div>`;
    sheet('Places', `<p class="se-note">For map watchers (from, to, leave by). On this device and your own devices only.</p>${row('home', 'Home', P.home)}${row('work', 'Work', P.work)}${(P.others || []).map(p => row(`o:${p.name}`, p.label || p.name, p)).join('')}
      <div class="chip-row"><button class="chip accent" data-mpset="new">+ Add a place</button></div>`, [['Back', () => Watch.sheet()], ['Close']]);
  },
  /* ---------- Settings: home and work ---------- */
  placeSheet(which) {
    const named = which === 'new' || which.startsWith('o:'), p = which.startsWith('o:') ? (places().others || []).find(x => `o:${x.name}` === which) : places()[which];
    if (named) return sheet(which === 'new' ? 'Add a place' : 'Change the place', `<label class="se-field"><span>Its name (e.g. Mom's, Gym, Client office)</span><input id="mpName" value="${esc(p?.label || '')}"></label><label class="se-field"><span>Address</span><input id="mpQ" value="${esc(p?.name || '')}"></label><div id="mpRes" class="pick-list"></div>`,
      [['Search', async () => { const q = $('#mpQ').value.trim(); if (!q) return; const box = $('#mpRes'); box.textContent = 'Looking…';
        try { const l = await Routing.search(q, loc); box.innerHTML = l.slice(0, 6).map(r => `<button class="big-btn" data-mplace="${esc(which)}|${r.lat},${r.lon}|${esc([r.name, r.sub].filter(Boolean).join(', '))}">${esc(r.name)}<br><small>${esc(r.sub || '')}</small></button>`).join('') || 'Nothing found'; } catch { box.textContent = 'The place search didn’t answer (offline?)'; } }], ['Back', () => this.placesSheet()]]);
    sheet(which === 'home' ? 'Home' : 'Work', `<p class="se-note">For leave-by and trips (only on this device and your own devices). Type the address or a landmark.</p><label class="se-field"><span>Address</span><input id="mpQ" value="${esc(p?.name || '')}"></label><div id="mpRes" class="pick-list"></div>`,
      [['Search', async () => { const q = $('#mpQ').value.trim(); if (!q) return; const box = $('#mpRes'); box.textContent = 'Looking…';
        try { const l = await Routing.search(q, loc); box.innerHTML = l.slice(0, 6).map(r => `<button class="big-btn" data-mplace="${which}|${r.lat},${r.lon}|${esc([r.name, r.sub].filter(Boolean).join(', '))}">${esc(r.name)}<br><small>${esc(r.sub || '')}</small></button>`).join('') || 'Nothing found'; }
        catch { box.textContent = 'The place search didn’t answer (offline?)'; } }], ...(p ? [['Forget it', () => { const all = places(); delete all[which]; store.set('places', all); closeSheet(); if (current === 'settings') renderSettings(); }]] : []), ['Cancel']]);
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mplace]');
  if (b) { const [which, ll, name] = b.dataset.mplace.split('|'), [lat, lon] = ll.split(',').map(Number), all = places();
    if (which === 'new' || which.startsWith('o:')) { const label = ($('#mpName')?.value.trim() || name.split(',')[0]).slice(0, 40); all.others = [...(all.others || []).filter(x => `o:${x.name}` !== which && x.label !== label), { label, name: label, address: name, lat, lon }]; }
    else all[which] = { name, lat, lon };
    store.set('places', all); toast(`Saved: ${name.split(',')[0]}`); if (current === 'settings') renderSettings(); return MapWatch.placesSheet(); }
  const c = e.target.closest('[data-mpchip]'); if (c) { const [id, v, n] = c.dataset.mpchip.split('|'); const i = $(`[data-mpv="${id}"]`); if (i) i.value = v; const t = $(`#mpn_${id}`); if (t) t.textContent = n; return; }
  const s = e.target.closest('[data-mps]'); if (s) { const id = s.dataset.mps, q = $(`[data-mpq="${id}"]`)?.value.trim(), box = $(`#mpr_${id}`); if (!q || !box) return; box.textContent = 'Looking…';
    Routing.search(q, MapWatch.fresh() || places().home || loc).then(l => { box.innerHTML = l.slice(0, 5).map(r => `<button type="button" class="big-btn" data-mpick="${id}|${r.lat},${r.lon}|${esc([r.name, r.sub].filter(Boolean).join(', ').slice(0, 90))}">${esc(r.name)}<br><small>${esc(r.sub || '')}</small></button>`).join('') || 'Nothing found'; }).catch(() => { box.textContent = 'The place search didn’t answer (offline?)'; }); return; }
  const k = e.target.closest('[data-mpick]'); if (k) { const [id, ll, name] = k.dataset.mpick.split('|'), [lat, lon] = ll.split(',').map(Number); const i = $(`[data-mpv="${id}"]`); if (i) i.value = JSON.stringify({ name, lat, lon }); const t = $(`#mpn_${id}`); if (t) t.textContent = name; $(`#mpr_${id}`).innerHTML = ''; return; }
  const set = e.target.closest('[data-mpset]'); if (set) return MapWatch.placeSheet(set.dataset.mpset);
  const del = e.target.closest('[data-mpdel]'); if (del) { const k2 = del.dataset.mpdel, all = places(); if (k2.startsWith('o:')) all.others = (all.others || []).filter(x => `o:${x.name}` !== k2); else delete all[k2]; store.set('places', all); return MapWatch.placesSheet(); }
});
ACTIONS.placeHome = () => MapWatch.placeSheet('home');
ACTIONS.placeWork = () => MapWatch.placeSheet('work');
setInterval(() => { try { MapWatch.share(); } catch {} }, 10000);

/* The templates (group “On the road”) */
WATCH_TEMPLATES.push(
  { id: 'map.arrive', group: 'On the road', map: true, name: 'Be there by a time (leave-by for any trip)', about: 'Choose where from and where to, and when you want to be there (and which days): it checks the drive on Google Maps and tells you when to leave, then when to go.', inputs: [],
    make: () => ({ name: 'Be there by', source: 'gmaps', from: 'home', to: '', arrive: '09:30', detect: { kind: 'leaveby', buffer: 10 }, every: '15m', tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
  { id: 'map.traffic', group: 'On the road', map: true, name: 'Lookahead: traffic and what’s on the way', about: 'Your Mac checks Google Maps every few minutes, from where you are once you’re on the way, and looks ahead for anything that slows or endangers the drive (accidents, jams, road works, closures, VIP movement, protests, processions, flooding, the weather) in the news, posts and the weather. It tells you when traffic adds 5 minutes or more, what it found on the way, and a better way with its map.', inputs: [['to', 'Where to? (empty: where DriveGen is navigating)', '']],
    make: v => ({ name: v.to ? `Traffic to ${v.to}` : 'Traffic on my route', source: 'gmaps', from: 'here', to: v.to || 'nav', detect: { kind: 'traffic', min: 5 }, every: '5m', record: true, tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
  { id: 'map.faster', group: 'On the road', map: true, name: 'A faster way (5+ minutes saved)', about: 'Compares your way with the other routes Google Maps offers; tells you when one saves 5 minutes or more.', inputs: [['to', 'Where to? (empty: where DriveGen is navigating)', '']],
    make: v => ({ name: v.to ? `Faster way to ${v.to}` : 'A faster way', source: 'gmaps', from: 'here', to: v.to || 'nav', detect: { kind: 'faster', save: 5 }, every: '5m', tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
  { id: 'map.fuel', group: 'On the road', map: true, name: 'Fuel or charging on the way', about: 'While you drive, it finds petrol pumps, CNG or EV chargers along the route ahead on Google Maps (rating, open now) and tells you before a long stretch without one: “Last petrol pump for a while: HP, 3 km, 4.2★, open 24 hours; next after that in 38 km.”', inputs: [],
    make: () => ({ name: 'Fuel on the way', source: 'gmaps', from: 'here', to: 'nav', detect: { kind: 'fuel', fuel: 'petrol', gap: 30, rating: 0 }, every: '15m', tell: { card: true, toast: true, speak: 'important', digest: false, phone: true } }) },
  { id: 'map.weather', group: 'On the road', map: true, name: 'Weather ahead', about: 'Checks the weather along your route at the time you will reach each part (Open-Meteo): “Heavy rain where you’ll be in about 30 min (near Hosur).”', inputs: [],
    make: () => ({ name: 'Weather ahead', source: 'gmaps', from: 'here', to: 'nav', detect: { kind: 'weatherahead' }, every: '15m', tell: { card: true, toast: true, speak: 'important', digest: false, phone: true } }) },
  { id: 'map.town', group: 'On the road', map: true, name: 'Next town', about: 'While you drive, tells you the next town about 15 minutes ahead: a line about it (Wikipedia), the weather there and a local headline.', inputs: [],
    make: () => ({ name: 'Next town', source: 'gmaps', from: 'here', to: 'nav', detect: { kind: 'town' }, every: '5m', tell: { card: true, toast: true, speak: 'always', digest: false, phone: true } }) },
  { id: 'map.leaveby', group: 'On the road', map: true, name: 'Leave by (my next meeting)', about: 'Reads your next meeting with a place from your calendar, checks the drive on Google Maps, and tells you when to leave (10 minutes to spare), then when to go.', inputs: [['from', 'Leaving from (home, work or here)', 'home']],
    make: v => ({ name: 'Leave by', source: 'gmaps', from: /^(home|work|here)$/i.test(v.from) ? v.from.toLowerCase() : 'home', detect: { kind: 'leaveby', buffer: 10 }, every: '15m', tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
);
