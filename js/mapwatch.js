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
    const v = String(what || '').trim();
    if (v === 'here') { const h = this.fresh(); return h && { name: 'where you are', lat: h.lat, lon: h.lon }; }
    if (v === 'nav') return this.fresh()?.dest || null;
    if (v === 'home' || v === 'work') { const p = places()[v]; return p && { name: v === 'home' ? 'home' : 'work', lat: p.lat, lon: p.lon }; }
    const m = v.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/); if (m) return { name: v, lat: +m[1], lon: +m[3] };
    w.found ||= {}; if (w.found[v]) return w.found[v];
    const r = (await Routing.search(v, this.fresh() || places().home || loc).catch(() => []))[0]; if (!r) throw new Error(`Couldn’t find “${v}” on the map`);
    return (w.found[v] = { name: r.name, lat: r.lat, lon: r.lon });
  },
  /** Google Maps' directions address (or the practice copy's). */
  dirUrl(from, to) {
    const ll = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    return Agent.cfg().practice ? new URL(`labs/practice/gmaps.html?origin=${ll(from)}&destination=${encodeURIComponent(to.name ? `${to.name}@${ll(to)}` : ll(to))}`, location.href).href
      : `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=driving`;
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
    const url = this.dirUrl(from, to), rows = '[data-trip-index]||[id^="section-directions-trip-"]||rows-in:#pane||rows-in:[role="main"]';
    const t = { id: `watch.${w.id}`, name: w.name, runs: 'mac', result: 'read', steps: [{ do: 'agent.open', value: url, args: ['site=Google Maps', 'wait=body', 'ms=30000'] },
      { do: 'agent.wait', value: rows, args: ['ms=20000'] }, { do: 'agent.read', value: rows, args: ['max=8000', 'strict'], as: 'read' }] };
    const text = String(await Agent.exec(t, {}, { confirmed: true, quiet: true, trace }) ?? '');
    const routes = text.split('\n').map(l => this.route(l)).filter(Boolean).slice(0, 4);
    trace?.push(`  routes: ${routes.map(r => `${r.min} min${r.via ? ` via ${r.via}` : ''}${r.warn.length ? ` (${r.warn[0]})` : ''}`).join(' · ') || 'none read'}`);
    if (!routes.length) throw new Error(`NOTFOUND:${rows}`);
    return { from, to, routes, url };
  },
  /** The source 'gmaps' (js/watch.js read): traffic and faster ways between two places, or the next meeting's leave-by. */
  async read(w, trace) {
    if (w.detect?.kind === 'leaveby') return this.leaveRead(w, trace);
    const from = await this.place(w, w.from || 'here'), to = await this.place(w, w.to || 'nav');
    if (!from || !to) { trace?.push(`  waiting: ${!from ? 'no recent position from your phone (it sends one while you drive)' : 'no destination (navigate in DriveGen, or set one in Edit)'}`); return { idle: true }; }
    return this.directions(w, from, to, trace);
  },
  /** Leave by: the next meeting with a place (the calendar task), then directions to it from home, work or here. */
  async leaveRead(w, trace) {
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
    const trip = `${got.to.lat.toFixed(3)},${got.to.lon.toFixed(3)}`, best = got.routes.reduce((a, b) => b.min < a.min ? b : a), now = Date.now();
    if (s.trip !== trip || now - (s.tripAt || 0) > 3 * 3600e3) { s.trip = trip; s.base = best.min; s.told = best.min; s.via = best.via; s.suggested = ''; s.leave = {}; } /* a new trip: what's there now is the starting point */
    s.tripAt = now;
    const link = this.gmapsLink(got.to), arrive = m => this.clock(now + m * 60000);
    if (d.kind === 'traffic') {
      const mine = got.routes.find(r => r.via && r.via === s.via) || got.routes[0], step = +d.min || 5;
      if (mine.min - s.told >= step) { const more = mine.min - s.base; s.told = mine.min;
        return { headline: `Traffic adds ${more} min to ${got.to.name}: arriving about ${arrive(mine.min)}`, items: [{ title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''}`, detail: [`${more} min more than when you set off`, ...mine.notes].join(' · ') }], value: mine.min, important: true, link }; }
      if (s.told - mine.min >= step) { s.told = mine.min; return { headline: `Traffic easing to ${got.to.name}: ${mine.min} min, arriving about ${arrive(mine.min)}`, items: [], value: mine.min, link }; }
      if (mine.warn.length && s.warned !== mine.warn[0]) { s.warned = mine.warn[0]; return { headline: `${mine.warn[0]} on your route to ${got.to.name}`, items: [{ title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''}` }], important: true, link }; }
      return null;
    }
    if (d.kind === 'faster') {
      const mine = got.routes.find(r => r.via && r.via === s.via) || got.routes[0], save = mine.min - best.min;
      if (best !== mine && save >= (+d.save || 5) && s.suggested !== best.via) { s.suggested = best.via;
        return { headline: `A faster way to ${got.to.name}${best.via ? ` via ${best.via}` : ''} saves ${save} min`, items: [{ title: `${best.min} min${best.via ? ` via ${best.via}` : ''}`, detail: best.notes.join(' · ') }, { title: `${mine.min} min${mine.via ? ` via ${mine.via}` : ''} (your way)` }], value: save, important: true, link }; }
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

  /* ---------- Settings: home and work ---------- */
  placeSheet(which) {
    const p = places()[which];
    sheet(which === 'home' ? 'Home' : 'Work', `<p class="se-note">For leave-by and trips (only on this device and your own devices). Type the address or a landmark.</p><label class="se-field"><span>Address</span><input id="mpQ" value="${esc(p?.name || '')}"></label><div id="mpRes" class="pick-list"></div>`,
      [['Search', async () => { const q = $('#mpQ').value.trim(); if (!q) return; const box = $('#mpRes'); box.textContent = 'Looking…';
        try { const l = await Routing.search(q, loc); box.innerHTML = l.slice(0, 6).map(r => `<button class="big-btn" data-mplace="${which}|${r.lat},${r.lon}|${esc([r.name, r.sub].filter(Boolean).join(', '))}">${esc(r.name)}<br><small>${esc(r.sub || '')}</small></button>`).join('') || 'Nothing found'; }
        catch { box.textContent = 'The place search didn’t answer (offline?)'; } }], ...(p ? [['Forget it', () => { const all = places(); delete all[which]; store.set('places', all); closeSheet(); if (current === 'settings') renderSettings(); }]] : []), ['Cancel']]);
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-mplace]'); if (!b) return; const [which, ll, name] = b.dataset.mplace.split('|'), [lat, lon] = ll.split(',').map(Number);
  store.set('places', { ...places(), [which]: { name, lat, lon } }); closeSheet(); toast(`${which === 'home' ? 'Home' : 'Work'}: ${name}`); if (current === 'settings') renderSettings(); });
ACTIONS.placeHome = () => MapWatch.placeSheet('home');
ACTIONS.placeWork = () => MapWatch.placeSheet('work');
setInterval(() => { try { MapWatch.share(); } catch {} }, 10000);

/* The templates (group “On the road”) */
WATCH_TEMPLATES.push(
  { id: 'map.traffic', group: 'On the road', name: 'Traffic on my route', about: 'While you drive with DriveGen, your Mac checks Google Maps every few minutes and tells you when traffic adds 5 minutes or more (and when it eases, or an accident is on the way).', inputs: [['to', 'Where to? (empty: where DriveGen is navigating)', '']],
    make: v => ({ name: v.to ? `Traffic to ${v.to}` : 'Traffic on my route', source: 'gmaps', from: 'here', to: v.to || 'nav', detect: { kind: 'traffic', min: 5 }, every: '5m', record: true, tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
  { id: 'map.faster', group: 'On the road', name: 'A faster way (5+ minutes saved)', about: 'Compares your way with the other routes Google Maps offers; tells you when one saves 5 minutes or more.', inputs: [['to', 'Where to? (empty: where DriveGen is navigating)', '']],
    make: v => ({ name: v.to ? `Faster way to ${v.to}` : 'A faster way', source: 'gmaps', from: 'here', to: v.to || 'nav', detect: { kind: 'faster', save: 5 }, every: '5m', tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
  { id: 'map.leaveby', group: 'On the road', name: 'Leave by (my next meeting)', about: 'Reads your next meeting with a place from your calendar, checks the drive on Google Maps, and tells you when to leave (10 minutes to spare), then when to go.', inputs: [['from', 'Leaving from (home, work or here)', 'home']],
    make: v => ({ name: 'Leave by', source: 'gmaps', from: /^(home|work|here)$/i.test(v.from) ? v.from.toLowerCase() : 'home', detect: { kind: 'leaveby', buffer: 10 }, every: '15m', tell: { card: true, toast: true, speak: 'always', digest: true, phone: true } }) },
);
