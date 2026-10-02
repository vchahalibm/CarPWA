'use strict';
/* ============================================================
   Radio: internet radio stations from the free Radio Browser directory
   (radio-browser.info, no key), India first, plus popular US and European
   stations; search any station by name. One player for the whole app, so
   it keeps playing while the dashboard is rearranged. It pauses while you
   talk to the assistant and resumes afterwards. HLS streams play natively
   in Safari and through vendor/hls (hls.js) elsewhere.
   Loaded after widgets.js.
   ============================================================ */
// Radio Browser mirrors, tried in turn.
const RADIO_API = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://de2.api.radio-browser.info'];
// Long-running HTTPS streams, used when the directory can't be reached.
const RADIO_FALLBACK = [
  { id: 'fb.paradise', name: 'Radio Paradise', url: 'https://stream.radioparadise.com/aac-320', country: 'United States', cc: 'US', tags: 'eclectic, rock' },
  { id: 'fb.kexp', name: 'KEXP 90.3 Seattle', url: 'https://kexp.streamguys1.com/kexp160.aac', country: 'United States', cc: 'US', tags: 'indie, alternative' },
  { id: 'fb.npr', name: 'NPR News', url: 'https://npr-ice.streamguys1.com/live.mp3', country: 'United States', cc: 'US', tags: 'news, talk' },
  { id: 'fb.groove', name: 'SomaFM Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3', country: 'United States', cc: 'US', tags: 'ambient, chill' },
  { id: 'fb.fip', name: 'FIP', url: 'https://icecast.radiofrance.fr/fip-hifi.aac', country: 'France', cc: 'FR', tags: 'eclectic, jazz' },
  { id: 'fb.swissjazz', name: 'Radio Swiss Jazz', url: 'https://stream.srg-ssr.ch/m/rsj/mp3_128', country: 'Switzerland', cc: 'CH', tags: 'jazz' },
];
const RADIO_REGIONS = { in: ['India', ['IN']], us: ['US', ['US']], eu: ['Europe', ['GB', 'DE', 'FR', 'NL', 'IT', 'ES', 'IE']], fav: ['Favourites', []] };
Bus.define('radio.play', 'A radio station starts playing', 'the station’s name');
Bus.define('radio.stop', 'The radio stops', 'the station’s name');

const Radio = {
  cur: store.get('radioCur', null), playing: false, state: 'off', held: false, list: [], tab: 'in',
  favs() { return store.get('radioFav', []); },
  isFav(st) { return !!st && this.favs().some(f => f.id === st.id); },
  /** A Radio Browser station → our small record (HTTPS only: a secure page can't play http streams). */
  norm(s) {
    const url = s.url_resolved || s.url || '';
    if (!/^https:/i.test(url)) return null;
    return { id: s.stationuuid, name: (s.name || '').trim().replace(/\s+/g, ' '), url, favicon: /^https:/i.test(s.favicon || '') ? s.favicon : '',
      country: s.country || '', cc: s.countrycode || '', tags: (s.tags || '').split(',').slice(0, 3).join(', '), hls: !!s.hls || /\.m3u8(\?|$)/i.test(url), codec: s.codec || '' };
  },
  async api(path) {
    let last;
    for (const base of [store.get('radioApi'), ...RADIO_API].filter(Boolean)) {
      try {
        const r = await fetch(base + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout?.(8000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        store.set('radioApi', base); return await r.json();
      } catch (e) { last = e; Log.w('radio', `Directory ${base} failed`, e); }
    }
    throw last || new Error('Radio directory unreachable');
  },
  q: (o) => Object.entries({ hidebroken: true, is_https: true, order: 'clickcount', reverse: true, ...o }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'),
  /** Popular stations for a region, cached for a day. */
  async region(id) {
    if (id === 'fav') return this.favs();
    const cache = store.get('radioDir', {});
    if (cache[id] && Date.now() - cache[id].at < 864e5 && cache[id].list.length) return cache[id].list;
    const ccs = RADIO_REGIONS[id][1], per = ccs.length > 1 ? 6 : 40;
    const got = await Promise.all(ccs.map(cc => this.api(`/json/stations/search?${this.q({ countrycode: cc, limit: per })}`).catch(() => [])));
    const seen = new Set(), list = got.flat().map(s => this.norm(s)).filter(s => s && !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()));
    if (list.length) { cache[id] = { at: Date.now(), list }; store.set('radioDir', cache); return list; }
    if (cache[id]?.list.length) return cache[id].list; // stale is better than nothing
    return RADIO_FALLBACK.filter(s => ccs.includes(s.cc));
  },
  async search(q) {
    const own = [...this.favs(), ...RADIO_FALLBACK, ...Object.values(store.get('radioDir', {})).flatMap(c => c.list)].filter(s => s.name.toLowerCase().includes(q.toLowerCase()));
    let found = [];
    try { found = (await this.api(`/json/stations/search?${this.q({ name: q, limit: 30 })}`)).map(s => this.norm(s)).filter(Boolean); }
    catch (e) { Log.w('radio', 'Search failed', e); }
    // Indian stations first for the same name, then the most played.
    const seen = new Set();
    return [...own, ...found.sort((a, b) => (b.cc === 'IN') - (a.cc === 'IN'))].filter(s => !seen.has(s.id) && seen.add(s.id));
  },

  /* ---------- Playing ---------- */
  audio() {
    if (this.el) return this.el;
    const el = this.el = new Audio(); el.preload = 'none'; el.playsInline = true; el.crossOrigin = null;
    el.addEventListener('playing', () => { this.setState('playing'); if (typeof Voice !== 'undefined') Voice.played = true; });
    el.addEventListener('waiting', () => this.setState('buffering'));
    el.addEventListener('pause', () => { if (this.state !== 'off') this.setState(this.held ? 'held' : 'paused'); });
    el.addEventListener('error', () => { if (!el.getAttribute('src')) return; Log.e('radio', 'Stream failed', { url: this.cur?.url, code: el.error?.code });
      this.setState('error'); toast(`${this.cur?.name || 'The station'} isn’t playing. Try another station`); });
    return el;
  },
  async hls() {
    if (window.Hls) return window.Hls;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/hls/hls.light.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return window.Hls;
  },
  async play(st) {
    st ||= this.cur; if (!st) return this.browse();
    const el = this.audio(); this.held = false;
    if (this.cur?.id !== st.id || !el.getAttribute('src')) {
      this.hlsObj?.destroy(); this.hlsObj = null;
      this.cur = st; store.set('radioCur', st);
      store.set('radioRecent', [st, ...store.get('radioRecent', []).filter(s => s.id !== st.id)].slice(0, 12));
      if (st.hls && !el.canPlayType('application/vnd.apple.mpegurl')) {
        try { const H = await this.hls(); if (H?.isSupported()) { this.hlsObj = new H(); this.hlsObj.loadSource(st.url); this.hlsObj.attachMedia(el); } else el.src = st.url; }
        catch (e) { Log.e('radio', 'HLS player failed to load', e); el.src = st.url; }
      } else el.src = st.url;
      if (!String(st.id).startsWith('fb.')) this.api(`/json/url/${st.id}`).catch(() => {}); // counts the play, as the directory asks
    }
    if (typeof player !== 'undefined' && player.playing) { player.playing = false; updatePlayerUI(); } // one thing playing at a time
    // The assistant is talking (e.g. you asked for this station): start when it finishes.
    if (!$('#assistant').hidden) { this.held = true; this.setState('held'); this.media(); return; }
    this.setState('buffering');
    // A dead stream can leave play() pending for ever: give up after 15 s.
    const late = new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('The station didn’t start'), { name: 'Timeout' })), 15000));
    try { await Promise.race([el.play(), late]); }
    catch (e) {
      Log.w('radio', 'Play failed', e);
      if (this.cur?.id !== st.id) return; // another station was chosen meanwhile
      if (e.name === 'NotAllowedError') { this.setState('paused'); return toast('Tap play to start the radio'); }
      if (e.name === 'Timeout') { el.pause(); this.setState('error'); return toast(`${st.name} isn’t responding. Try another station`); }
      this.setState('paused'); return;
    }
    this.media(); Bus.emit('radio.play', { value: st.name, station: st });
  },
  pause() { this.held = false; this.el?.pause(); },
  stop() {
    const name = this.cur?.name; this.held = false;
    if (this.el) { this.el.pause(); this.hlsObj?.destroy(); this.hlsObj = null; this.el.removeAttribute('src'); this.el.load(); }
    this.setState('off'); if (name) Bus.emit('radio.stop', { value: name });
  },
  toggle() { this.playing || this.state === 'buffering' ? this.pause() : this.play(); },
  /** Next or previous station in your favourites (else the stations last shown). */
  step(dir = 1) {
    const l = this.favs().length > 1 ? this.favs() : this.list.length ? this.list : store.get('radioRecent', []);
    if (!l.length) return this.browse();
    const i = l.findIndex(s => s.id === this.cur?.id);
    this.play(l[(i + dir + l.length) % l.length]);
  },
  /** Find a station by name and play it. Resolves to the station or null. */
  async tune(name) {
    const l = await this.search(name); if (!l.length) return null;
    const n = name.toLowerCase(), best = l.find(s => s.name.toLowerCase() === n) || l[0];
    await this.play(best); return best;
  },
  setState(s) {
    this.state = s; this.playing = s === 'playing';
    if (navigator.mediaSession && this.cur) navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
    this.paint();
  },
  media() {
    if (!navigator.mediaSession || !this.cur || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.cur.name, artist: [this.cur.country, this.cur.tags].filter(Boolean).join(' · '), album: 'DriveDeck Radio',
      artwork: this.cur.favicon ? [{ src: this.cur.favicon }] : [] });
    for (const [a, f] of [['play', () => this.play()], ['pause', () => this.pause()], ['stop', () => this.stop()], ['nexttrack', () => this.step(1)], ['previoustrack', () => this.step(-1)]])
      try { navigator.mediaSession.setActionHandler(a, f); } catch {}
  },
  /** Quiet while you talk to the assistant; back afterwards. */
  hold() { if (this.playing || this.state === 'buffering') { this.held = true; this.el.pause(); Log.d('radio', 'Paused while you talk'); } },
  release() { if (this.held) { this.held = false; Log.d('radio', 'Resuming after the assistant'); setTimeout(() => !this.playing && this.state === 'held' && this.play(), 400); } },

  /* ---------- Widget and station browser ---------- */
  logo(st, cls = 'rw-logo') {
    return st?.favicon ? `<img class="${cls}" src="${esc(st.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} none',innerHTML:svg('radio')}))">`
      : `<span class="${cls} none">${svg('radio')}</span>`;
  },
  widget() {
    const st = this.cur, label = { playing: 'Live', buffering: 'Tuning…', paused: 'Paused', held: 'Paused while you talk', error: 'Not playing', off: st ? 'Off' : 'Choose a station' }[this.state];
    return `${this.logo(st)}<div class="rw-meta"><b>${esc(st?.name || 'Radio')}</b><span>${esc(st ? [st.country, st.tags].filter(Boolean).join(' · ') : 'India, US and Europe')}</span></div>
      <div class="rw-state ${this.state}">${this.playing ? '<i class="rw-live"></i>' : ''}${label}</div>
      <div class="np-controls"><button class="ctl" data-radio="prev" aria-label="Previous station">${svg('prev')}</button>
        <button class="ctl main" data-radio="toggle" aria-label="${this.playing ? 'Pause' : 'Play'} the radio">${svg(this.playing || this.state === 'buffering' ? 'pause' : 'play')}</button>
        <button class="ctl" data-radio="next" aria-label="Next station">${svg('next')}</button></div>
      <button class="w-cta" data-radio="browse">${svg('search')}Stations</button>`;
  },
  paint() { $$('.radiow').forEach(el => el.innerHTML = this.widget()); if (this.sheetOpen) this.paintList(); },
  browse() {
    this.sheetOpen = true;
    sheet('Radio', `<div class="rb">
      <div class="rb-search"><input id="rbQ" placeholder="Search any station, e.g. Radio Mirchi, BBC" autocomplete="off" enterkeyhint="search"></div>
      <div class="rb-tabs">${Object.entries(RADIO_REGIONS).map(([id, [n]]) => `<button class="chip ${id === this.tab ? 'on' : ''}" data-radio="tab:${id}">${n}</button>`).join('')}</div>
      <div class="rb-list" id="rbList"><div class="rb-empty">Loading stations…</div></div></div>`, [['Done', () => { this.sheetOpen = false; }]]);
    const q = $('#rbQ'); let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => q.value.trim().length > 1 ? this.show(this.search(q.value.trim()), 'search') : this.loadTab(this.tab), 450); });
    this.loadTab(this.tab);
  },
  loadTab(id) { this.tab = id; $$('.rb-tabs .chip').forEach(b => b.classList.toggle('on', b.dataset.radio === 'tab:' + id)); this.show(this.region(id), id); },
  async show(p, key) {
    this.showing = key; const box = $('#rbList'); if (box) box.innerHTML = '<div class="rb-empty">Loading stations…</div>';
    let l = []; try { l = await p; } catch (e) { Log.w('radio', 'Stations failed', e); }
    if (this.showing !== key) return;
    this.list = l; this.paintList();
  },
  paintList() {
    const box = $('#rbList'); if (!box) return;
    if (!this.list.length) return box.innerHTML = `<div class="rb-empty">${this.tab === 'fav' && this.showing === 'fav' ? 'Tap ☆ on a station to keep it here.' : 'No stations found. Check the connection or try another name.'}</div>`;
    box.innerHTML = this.list.map((s, i) => `<div class="rb-row ${s.id === this.cur?.id ? 'cur' : ''}"><button class="rb-st" data-radio="play:${i}">${this.logo(s, 'rb-logo')}
        <span><b>${esc(s.name)}</b><small>${esc([s.country, s.tags].filter(Boolean).join(' · '))}</small></span>${s.id === this.cur?.id && this.playing ? '<i class="rw-live"></i>' : ''}</button>
      <button class="rb-fav ${this.isFav(s) ? 'on' : ''}" data-radio="fav:${i}" aria-label="${this.isFav(s) ? 'Remove from' : 'Add to'} favourites">${this.isFav(s) ? '★' : '☆'}</button></div>`).join('');
  },
  fav(st) {
    const f = this.favs(); store.set('radioFav', this.isFav(st) ? f.filter(x => x.id !== st.id) : [...f, st]);
    this.paintList(); toast(this.isFav(st) ? `${st.name} added to favourites` : `${st.name} removed from favourites`);
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-radio]'); if (!b) return;
  e.stopPropagation();
  const [a, x] = b.dataset.radio.split(':');
  if (a === 'toggle') Radio.toggle(); else if (a === 'next') Radio.step(1); else if (a === 'prev') Radio.step(-1);
  else if (a === 'browse') Radio.browse(); else if (a === 'tab') { $('#rbQ').value = ''; Radio.loadTab(x); }
  else if (a === 'play') Radio.play(Radio.list[+x]); else if (a === 'fav') Radio.fav(Radio.list[+x]);
}, true);
Bus.on('voice.listen', () => Radio.hold());
Bus.on('voice.idle', () => Radio.release());

/* ---------- The widget, actions and voice ---------- */
W.radio = { name: 'Radio', html: () => `<div class="radiow">${Radio.widget()}</div>`, config: () => Radio.browse() };
Actions.define('radio.play', { group: 'Radio', name: 'Play a radio station', arg: 'Station name (blank = the last one)', async run(v, say) {
  if (!v) { if (!Radio.cur) return say('Which station? Say “play” and a station name.'); Radio.play(); return say(`Playing ${Radio.cur.name}.`); }
  say(`Tuning to ${v}…`);
  const st = await Radio.tune(v); if (!st) toast(`Couldn’t find a station called ${v}`);
} });
Actions.define('radio.stop', { group: 'Radio', name: 'Stop the radio', arg: '', run: (v, say) => { Radio.stop(); say('Radio off.'); } });
Actions.define('radio.next', { group: 'Radio', name: 'Next station', arg: '', run: (v, say) => { Radio.step(1); say('Next station.'); } });
Actions.define('radio.browse', { group: 'Radio', name: 'Show the stations', arg: '', run: () => Radio.browse() });
if (current === 'dashboard') Dash.render(); // the widget type now exists
