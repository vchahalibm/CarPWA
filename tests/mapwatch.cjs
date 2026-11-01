// Map watchers (js/mapwatch.js): reading a directions route, the traffic / faster / leave-by decisions, the phone's
// position sharing. Run: node tests/mapwatch.cjs (CI too).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const mem = {}, sent = [], ctx = { console, setInterval() {}, setTimeout() {}, document: { addEventListener() {} }, ACTIONS: {}, Log: { i() {}, d() {}, w() {} },
  store: { get: (k, d) => k in mem ? mem[k] : d, set: (k, v) => { mem[k] = v; } }, WATCH_TEMPLATES: [], Agent: { cfg: () => ({}) }, settings: {},
  LINK_HOST: false, loc: { lat: 12.97161, lon: 77.59462, speed: 0, heading: 90, source: 'gps' }, nav: null,
  Link: { ready: () => true, loc: async p => { sent.push(p); return { want: true }; } }, Mesh: { m: null } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../js/mapwatch.js', 'utf8') + '\nthis.M = MapWatch;', ctx);
const M = ctx.M; let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
(async () => {
  let r = M.route('35 min ¦ 15.6 km ¦ via Outer Ring Rd ¦ Fastest route now due to traffic conditions');
  ok(r.min === 35 && r.km === 15.6 && r.via === 'Outer Ring Rd', 'a route: ' + JSON.stringify(r));
  r = M.route('1 hr 12 min ¦ 48.0 km ¦ via NH44 ¦ Heavier traffic than usual ¦ Accident reported ¦ This route has tolls.');
  ok(r.min === 72 && r.via === 'NH44' && r.warn[0] === 'Accident reported', 'hours, warnings: ' + JSON.stringify(r));
  const to = { name: 'Whitefield', lat: 12.97, lon: 77.75 }, R = a => ({ to, routes: a.map(([min, via, warn]) => ({ min, km: 10, via, notes: warn ? [warn] : [], warn: warn ? [warn] : [] })) });
  const tr = { detect: { kind: 'traffic', min: 5 }, state: {} }, t = [[[35, 'ORR'], [42, 'NH44']], [[37, 'ORR'], [42, 'NH44']], [[41, 'ORR'], [42, 'NH44']], [[41, 'ORR', 'Accident reported'], [42, 'NH44']], [[34, 'ORR'], [42, 'NH44']]].map(s => M.detect(tr, R(s))?.headline || null);
  ok(!t[0] && !t[1] && /^Traffic adds 6 min/.test(t[2]) && /^Accident reported/.test(t[3]) && /^Traffic easing/.test(t[4]), 'traffic: ' + JSON.stringify(t));
  const fa = { detect: { kind: 'faster', save: 5 }, state: {} }, f = [[[35, 'ORR'], [42, 'NH44']], [[44, 'ORR'], [38, 'NH44']], [[44, 'ORR'], [37, 'NH44']]].map(s => M.detect(fa, R(s))?.headline || null);
  ok(!f[0] && /via NH44 saves 6 min/.test(f[1]) && !f[2], 'a faster way, once: ' + JSON.stringify(f));
  const lb = { detect: { kind: 'leaveby', buffer: 10 }, state: {} }, start = Date.now() + 55 * 60000, ev = { ...R([[30, 'ORR']]), event: { title: 'Acme review', when: '3:00 PM', place: 'Whitefield', start } };
  const a1 = M.detect(lb, ev)?.headline, a2 = M.detect(lb, ev)?.headline; ok(/^Leave by/.test(a1) && !a2, 'leave by, once: ' + a1);
  lb.state.leave[`Acme review@${start}`] = 1; const late = { ...ev, event: { ...ev.event } }; late.routes[0].min = 50; ok(/^Leave now/.test(M.detect(lb, late)?.headline || ''), 'then leave now');
  ok(M.when('3:05 PM') && new Date(M.when('3:05 PM')).getHours() === 15, '3:05 PM');
  await M.share(); ok(sent.length === 0, 'parked: nothing sent');
  ctx.loc.speed = 14; ctx.nav = { dest: { name: 'Whitefield', lat: 12.9698, lon: 77.75 } }; await M.share(); ok(sent.length === 1 && sent[0].dest.name === 'Whitefield', 'driving: sent with the destination');
  await M.share(); ok(sent.length === 1, 'not again within 30 s');
  console.log(`${n}/${n} map watcher tests pass`);
})().catch(e => { console.error(e.message); process.exit(1); });
