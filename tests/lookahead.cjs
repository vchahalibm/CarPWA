// Lookahead (js/lookahead.js): a route's names, which news counts, sorting by words without a language model, placing a
// cause on the routes, the other way, “on the way”, feeds. Run: node tests/lookahead.cjs (CI too).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const mem = {}, ctx = { console, setInterval() {}, setTimeout, clearTimeout, document: { addEventListener() {} }, ACTIONS: {}, Log: { i() {}, d() {}, w() {} }, navigator: { language: 'en-IN', userAgent: 'test' },
  store: { get: (k, d) => k in mem ? mem[k] : d, set: (k, v) => { mem[k] = v; } }, WATCH_TEMPLATES: [], Agent: { cfg: () => ({}) }, settings: {}, LINK_HOST: false, loc: { lat: 12.97, lon: 77.59, speed: 0, source: 'gps' }, nav: null,
  Link: { ready: () => false }, Mesh: { m: null }, LLM: { ask: async () => { throw new Error('none here'); }, prompt: () => '' }, window: {} };
vm.createContext(ctx);
vm.runInContext(['mapwatch', 'lookahead'].map(f => fs.readFileSync(`${__dirname}/../js/${f}.js`, 'utf8')).join('\n') + '\nthis.M = MapWatch; this.L = Lookahead;', ctx);
const { M, L } = ctx; let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
(async () => {
  const r0 = { i: 0, via: 'Hosur Rd and NH 44/NH 48', steps: 'Take · Intermediate Ring Rd · NH 44 · Santhosapuram · Turn · left · onto · 8th Main Rd · Follow · Chennekothapalli Rd · Attibele · Pass by the gas station (on the right) · 19 min (6.6 km)', min: 46, km: 33, notes: [], warn: [] };
  const nm = L.names(r0);
  ok(nm.roads.includes('Hosur Rd') && nm.roads.includes('Intermediate Ring Rd') && nm.areas.includes('Santhosapuram') && !nm.areas.some(a => /gas station|Turn/.test(a)), 'names: ' + JSON.stringify(nm));
  ok(!L.specific('8th Main Rd') && !L.specific('Main Rd') && L.specific('Hosur Rd') && L.specific('Santhosapuram'), 'specific names only');
  ok(L.mentions('Protest on Hosur Road near Bommanahalli', nm.roads).includes('Hosur Rd') && !L.mentions('Old Delhi stretch set for makeover', nm.roads).length, 'mentions, loosely (Road/Rd)');
  const a = { lat: 12.9568, lon: 77.6489 }, b = { lat: 12.7783, lon: 77.7713 };
  ok(L.onWay(a, { lat: 12.87, lon: 77.70 }, b) && !L.onWay(a, a, b) && !L.onWay(a, { lat: 13.2, lon: 77.4 }, b), 'on the way: between, not at the start, not elsewhere');
  const items = L.rss('<rss><channel><item><title>Waterlogging on Hosur Road</title><link>https://x/1</link><pubDate>Mon, 02 Nov 2026 02:53:56 GMT</pubDate><description><![CDATA[<b>Knee-deep</b> water]]></description></item></channel></rss>', 'T');
  ok(items.length === 1 && items[0].title === 'Waterlogging on Hosur Road' && items[0].text === 'Knee-deep water' && items[0].at > 0, 'a feed: ' + JSON.stringify(items));
  /* without a language model: by words, and only what names the drive */
  const c = await L.classify([{ title: 'Protest on Hosur Road slows traffic', text: '', source: 'News', at: 0 }, { title: 'Mumbai: accident on Western Express Highway', text: '', source: 'News', at: 0 }, { title: 'Hosur Road gets new bus stops', text: '', source: 'News', at: 0 }], { ...nm, cities: ['Bengaluru'], from: 'home', to: 'Attibele' });
  ok(c.length === 1 && c[0].kind === 'protest' && c[0].place === 'Hosur Rd', 'sorted by words: ' + JSON.stringify(c));
  const r1 = { i: 1, via: 'Sarjapur - Marathahalli Rd and Sarjapura - Attibele Rd', steps: '', min: 60, km: 35, notes: [], warn: [], path: [[12.92, 77.66], [12.86, 77.78]] }, got = { from: a, to: { ...b, name: 'Attibele' }, routes: [r0, r1], all: [r0, r1] };
  r0.path = [[12.92, 77.62], [12.85, 77.67]];
  const on = await L.locate({ state: {} }, c[0], got); ok(on.length === 1 && on[0] === 0, 'placed on the Hosur Rd route only: ' + JSON.stringify(on));
  const alt = L.alt(got, r0, [{ ...c[0], routes: on }]); ok(alt && alt.r === r1 && alt.d === 14 && alt.avoids && alt.take.via, 'the other way avoids it: ' + JSON.stringify(alt && { d: alt.d, via: alt.take.via }));
  ok(!L.alt(got, r0, []), 'no cause and not faster: no other way');
  /* the traffic watcher tells it, once, with the other way */
  const w = { detect: { kind: 'traffic', min: 5 }, state: {}, from: 'home' }, cause = { ...c[0], routes: on, fresh: true };
  const h1 = M.detect(w, { ...got, routes: [r0, r1], causes: [cause] });
  ok(/^Protest: Hosur Rd, on your way to Attibele/.test(h1?.headline || '') && h1.items.some(i => /^Or via Sarjapur/.test(i.title)) && h1.shotOf === 1 && h1.take, 'told with the other way: ' + JSON.stringify(h1 && { h: h1.headline, items: h1.items }));
  ok(!M.detect(w, { ...got, routes: [r0, r1], causes: [{ ...cause, fresh: false }] }), 'not told twice');
  console.log(`${n}/${n} lookahead tests pass`);
})().catch(e => { console.error(e.message); process.exit(1); });
