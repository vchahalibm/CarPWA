// Lookahead (js/lookahead.js): a route's names, which news counts, sorting by words without a language model, placing a
// cause on the routes, the other way, “on the way”, feeds. Run: node tests/lookahead.cjs (CI too).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const mem = {}, ctx = { console, setInterval() {}, setTimeout, clearTimeout, document: { addEventListener() {} }, ACTIONS: {}, Log: { i() {}, d() {}, w() {} }, navigator: { language: 'en-IN', userAgent: 'test' },
  store: { get: (k, d) => k in mem ? mem[k] : d, set: (k, v) => { mem[k] = v; } }, WATCH_TEMPLATES: [], Agent: { cfg: () => ({}) }, settings: {}, LINK_HOST: false, loc: { lat: 12.97, lon: 77.59, speed: 0, source: 'gps' }, nav: null,
  Link: { ready: () => false }, Mesh: { m: null }, LLM: { ask: async () => { throw new Error('none here'); }, prompt: () => '' }, window: {} };
vm.createContext(ctx);
vm.runInContext(['mapwatch', 'lookahead'].map(f => fs.readFileSync(`${__dirname}/../js/${f}.js`, 'utf8')).join('\n') + '\nthis.M = MapWatch; this.L = Lookahead; this.R = Roadside;', ctx);
const { M, L, R } = ctx; let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
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
  /* along the way (phase 3): where you are on the path, points ahead, stations on the way, the last fuel for a while, towns */
  const path = [[12.85, 77.66], [12.80, 77.74], [12.70, 77.85], [12.52, 78.21]], here = { lat: 12.81, lon: 77.72 }, P = R.proj(path, here);
  ok(P.off < 1 && P.km > 5 && P.km < 15 && P.total > 70, 'on the path: ' + JSON.stringify(P));
  const ah = R.ahead(path, here, 60, 10, 40); ok(ah.length === 5 && ah[0].km === 10 && ah[0].eta > 5 && ah.at(-1).end, 'points ahead with times: ' + JSON.stringify(ah.map(p => [p.km, p.eta])));
  const st = [{ name: 'A', ...L.along(path, 0.2), open: 'Open 24 hours', rating: 4.2 }, { name: 'B', ...L.along(path, 0.75), open: '' }, { name: 'Behind', ...L.along(path, 0.02) }, { name: 'Far off', lat: 13.2, lon: 77.0 }, { name: 'Shut', ...L.along(path, 0.3), open: 'Closed' }];
  const on2 = R.onWay(path, here, st); ok(on2.map(x => x.name).join() === 'A,B', 'stations on the way, ahead, open: ' + on2.map(x => x.name));
  const fw = { detect: { kind: 'fuel', gap: 30 }, state: {} }, fg = { to: { lat: 12.52, lon: 78.21, name: 'Krishnagiri' } };
  const f1 = R.detect(fw, { ...fg, side: { fuel: on2, what: 'petrol pump', searched: 60 } }), f2 = R.detect(fw, { ...fg, side: { fuel: on2, what: 'petrol pump', searched: 60 } });
  ok(/^Last petrol pump for a while: A, \d+ km, 4.2★, open 24 hours/.test(f1?.headline || '') && /^Next after that: B/.test(f1.items[1].title) && !f2, 'the last fuel for a while, once: ' + (f1 && f1.headline));
  const t1 = R.detect({ detect: { kind: 'town' }, state: {} }, { ...fg, side: { town: { cur: 'Attibele', next: 'Hosur', eta: 15, about: 'Hosur is an industrial city.', weather: '28° and clear' } } });
  ok(t1?.headline === 'Coming up: Hosur, about 15 min' && t1.items.length === 2 && !t1.important, 'the next town: ' + JSON.stringify(t1));
  /* phase 4: food, parking, ten minutes away (send it), cameras, tolls, poor air, sunset, a state crossing, tomorrow */
  const D = (kind, side, w = { detect: { kind }, state: {} }) => R.detect(w, { ...fg, side });
  const food = D('food', { food: { meal: 'Lunch', eta: 15, list: [{ name: 'Udupi Grand', rating: 4.4, reviews: '2,100', at: 12, open: 'Open', lat: 12.7, lon: 77.8 }] } });
  ok(/^Lunch on the way: Udupi Grand, 4.4★, 12 km ahead \(about 15 min\)/.test(food?.headline || ''), 'food: ' + (food && food.headline));
  const park = D('parking', { parking: [{ name: 'City Parking', from: 0.3, rating: 4, open: 'Open 24 hours', lat: 12.52, lon: 78.21 }] }); ok(/^Parking near Krishnagiri: City Parking, 300 m from it/.test(park?.headline || ''), 'parking: ' + (park && park.headline));
  const aw = { detect: { kind: 'arrive', min: 10, who: '+91 98000 00000' }, state: {} }, near1 = D('arrive', { left: 14 }, aw), near2 = D('arrive', { left: 9 }, aw), near3 = D('arrive', { left: 8 }, aw);
  ok(!near1 && /^9 min from Krishnagiri/.test(near2?.headline || '') && near2.share.text === "I'm about 9 minutes away from Krishnagiri" && near2.share.to && !near3, 'ten minutes away, once, with a message to send: ' + JSON.stringify(near2));
  const cw = { detect: { kind: 'cameras' }, state: {} }, cam1 = D('cameras', { cameras: [{ id: 1, at: 3, limit: '60' }, { id: 2, at: 11, limit: '' }] }, cw), cam2 = D('cameras', { cameras: [{ id: 2, at: 8 }] }, cw);
  ok(cam1?.headline === '2 speed cameras ahead: 3 km (60), 11 km' && !cam2, 'speed cameras, each once: ' + (cam1 && cam1.headline));
  const toll = D('tolls', { tolls: [{ id: 7, at: 12, name: 'Attibele (BETL)' }] }); ok(toll?.headline === 'Toll plaza ahead: Attibele (BETL), 12 km', 'tolls: ' + (toll && toll.headline));
  const air = D('weatherahead', { air: { aqi: 180, p: { eta: 20 }, town: 'Hosur' } }); ok(/^Poor air ahead near Hosur: AQI 180 in about 20 min/.test(air?.headline || ''), 'air quality: ' + (air && air.headline));
  const sun = D('weatherahead', { sunset: { at: Date.now() + 30 * 60000, before: 25 } }); ok(/^Sunset at .+, 25 min before you reach Krishnagiri/.test(sun?.headline || ''), 'sunset: ' + (sun && sun.headline));
  const cr = D('town', { town: { cur: 'Attibele', next: 'Hosur', from: 'Karnataka', state: 'Tamil Nadu', cc: 'IN', ccFrom: 'IN', eta: 15 } }); ok(/^Crossing into Tamil Nadu from Karnataka in about 15 min: Hosur next/.test(cr?.headline || '') && cr.important, 'a state crossing: ' + (cr && cr.headline));
  const tw = { detect: { kind: 'tomorrow', buffer: 15 }, state: {} }, at = Date.now() + 864e5, tmh = M.detect(tw, { ...fg, routes: [{ min: 50, via: 'NH 44', notes: [], warn: [] }], tomorrow: { at, arrive: '09:30' }, weather: { code: 61, mm: 3, temp: 24 }, news: [{ title: 'Bandh called tomorrow', source: 'News' }] });
  ok(/^Tomorrow: Krishnagiri by 09:30, about 50 min at today's traffic: leave by/.test(tmh?.headline || '') && /^Rain there around 09:30/.test(tmh.items[0].title) && tmh.items[1].title === 'Bandh called tomorrow', 'tomorrow: ' + JSON.stringify(tmh && tmh.items));
  console.log(`${n}/${n} lookahead tests pass`);
})().catch(e => { console.error(e.message); process.exit(1); });
