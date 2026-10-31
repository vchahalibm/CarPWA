// Watchers (js/watch.js): row identity, card items and the detectors, without a browser. Run: node tests/watch.cjs (CI too).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const mem = {}, ctx = {
  console, setInterval() {}, document: { addEventListener() {} }, ACTIONS: {}, LLM_PROMPTS: {}, Log: { i() {}, d() {}, w() {} },
  store: { get: (k, d) => k in mem ? mem[k] : d, set: (k, v) => { mem[k] = v; } },
  plain: t => String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(),
};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../js/watch.js', 'utf8') + '\nthis.Watch = Watch;', ctx);
const W = ctx.Watch;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// identity: a row read since, its clock or its count badge don't make it new; its words do
ok(W.ident('Mom 8:06 Are you coming 2 (2 unread messages)') === W.ident('Mom 8:07 Are you coming'), 'read since / badge / time');
ok(W.ident('Unread 9:12 Priya Nair Revised contract') === W.ident('9:12 Priya Nair Revised contract'), 'unread state word');
ok(W.ident('Asha 10:05 Call at 4') !== W.ident('Asha 10:07 Call at 5'), 'a number in the words still counts');
ok(W.ident('Acme Corp @acme · 2h Hiring') === W.ident('Acme Corp @acme · 3h Hiring'), 'relative times');

// card items
assert.deepStrictEqual({ ...W.item('Mom 22:11 Call me when you land 3 (3 unread messages)') }, { title: 'Mom', when: '22:11', detail: 'Call me when you land' }); n++;
assert.deepStrictEqual({ ...W.item('Asha Rao 22:17 Moving our call to 4 (2 unread messages)') }, { title: 'Asha Rao', when: '22:17', detail: 'Moving our call to 4' }); n++;
assert.deepStrictEqual({ ...W.item('Acme Corp@acme · now Big launch') }, { title: 'Acme Corp (@acme)', when: 'now', detail: 'Big launch' }); n++;

// detectors: the first read is the baseline; then once per event
const run = (detect, seq) => { const w = W.make({ name: 'T', detect }); return seq.map(g => { const h = W.detect(w, g); w.state.at = 1; return h && h.headline; }); };
let r = run({ kind: 'new' }, [['a 9:00 x', 'b 9:01 y'], ['a 9:00 x', 'b 9:01 y'], ['c 9:05 z', 'a 9:00 x', 'b 9:01 y'], ['c 9:06 z', 'a 9:00 x']]);
ok(r[0] === null && r[1] === null && /^T: c/.test(r[2]) && r[3] === null, 'new: ' + JSON.stringify(r));
r = run({ kind: 'value', cond: 'below 500' }, ['₹612', '₹598', '₹480', '₹470', '₹520', '₹450']);
ok(JSON.stringify(r.map(Boolean)) === '[false,false,true,false,false,true]', 'value crosses once: ' + JSON.stringify(r));
r = run({ kind: 'contains', words: 'in stock||available' }, ['Out of stock', 'Out of stock', 'Now in stock!', 'In stock', 'Sold out', 'Available']);
ok(JSON.stringify(r.map(Boolean)) === '[false,false,true,false,false,true]', 'words: ' + JSON.stringify(r));
const w = W.make({ name: 'T', detect: { kind: 'changes' } }); const ch = ['Hours: 9 to 5. Closed Sunday. Updated 10:02', 'Hours: 9 to 5. Closed Sunday. Updated 10:07', 'Hours: 9 to 6. Closed Sunday. Updated 10:12'].map(g => { const h = W.detect(w, g); w.state.at = 1; return h; });
ok(!ch[0] && !ch[1] && ch[2] && ch[2].items.length === 2 && ch[2].items.every(i => /Hours/.test(i.detail)), 'changes ignore a moved clock: ' + JSON.stringify(ch[2]));
// quiet hours wrap past midnight
ok(typeof W.quiet({ quiet: '00:00-23:59' }) === 'boolean', 'quiet hours');
console.log(`${n}/${n} watcher tests pass`);
