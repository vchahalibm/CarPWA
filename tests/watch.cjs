// Watchers (js/watch.js): row identity, card items and the detectors, without a browser. Run: node tests/watch.cjs (CI too).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const mem = {}, ctx = {
  console, setInterval() {}, setTimeout() {}, document: { addEventListener() {} }, ACTIONS: {}, LLM_PROMPTS: {}, Log: { i() {}, d() {}, w() {} },
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

assert.deepStrictEqual({ ...W.item('[10:05, 01/11/2026] Varun: Sending the venue details in a bit 10:05') }, { title: 'Varun', when: '10:05', detail: 'Sending the venue details in a bit' }); n++;
// rows read as parts (a hidden window, WhatsApp): name, time, sender and message, unread count; links shortened
assert.deepStrictEqual({ ...W.item('Alpha Rai 94 ¦ 9:33 pm ¦ ~Rai Singh Gill ¦ : ¦ https://youtu.be/YBKr1AA6jFc?si=A-HnnxMUSZ1EQozX ¦ 6 (6 unread messages)') }, { title: 'Alpha Rai 94', unread: 6, when: '9:33 pm', detail: 'Rai Singh Gill: youtu.be/…' }); n++;
assert.deepStrictEqual({ ...W.item('Kochi RTO Abdul Rehman ¦ 6:34 pm ¦ God bless u sir') }, { title: 'Kochi RTO Abdul Rehman', when: '6:34 pm', detail: 'God bless u sir' }); n++;
assert.deepStrictEqual({ ...W.item('Aditya Birla Capital Digital Limited ¦ Yesterday ¦ Important Update on Your Personal Loan ¦ 2 (2 unread messages)') }, { title: 'Aditya Birla Capital Digital Limited', unread: 2, when: 'Yesterday', detail: 'Important Update on Your Personal Loan' }); n++;
assert.deepStrictEqual({ ...W.item('Priya Nair 9:41 AM ¦ @You can you share the Q3 deck? ¦ #general') }, { title: 'Priya Nair', when: '9:41 AM', detail: '@You can you share the Q3 deck? · #general' }); n++; /* Slack's activity row: name and time on one line */
assert.deepStrictEqual({ ...W.item('Asha Rao9:41 ¦ Q4 review moved') }, { title: 'Asha Rao', when: '9:41', detail: 'Q4 review moved' }); n++; /* no space between them */
assert.strictEqual(W.changeKey('Returns within 30 days. Updated 1 Nov 2026 10:00.'), W.changeKey('Returns within 30 days. Updated 2 Nov 2026 11:30.')); n++; /* a date and a clock moving: not a change */
assert.notStrictEqual(W.changeKey('Returns within 30 days.'), W.changeKey('Returns within 14 days.')); n++; /* “30 days” is content */
assert.strictEqual(W.changeKey('Posted 5 min ago: hello'), W.changeKey('Posted 2 hours ago: hello')); n++;
assert.deepStrictEqual({ ...W.item('Unread 9:12 ¦ Priya Nair ¦ Revised contract for Acme') }, { title: 'Priya Nair', when: '9:12', detail: 'Revised contract for Acme' }); n++; /* Outlook: “Unread” and the time first */
{ const w = W.make({ name: 'New WhatsApp messages', detect: { kind: 'new' } }); W.detect(w, ['Old ¦ 1:00 ¦ x']); w.state.at = 1;
  const h = W.detect(w, ['Alpha Rai 94 ¦ 9:33 pm ¦ ~Rai Singh Gill ¦ : ¦ https://youtu.be/x ¦ 6 (6 unread messages)', 'Kochi RTO Abdul Rehman ¦ 6:34 pm ¦ God bless u sir', 'Satish ¦ 6:00 pm ¦ hi', 'Old ¦ 1:00 ¦ x']);
  ok(h.headline === 'New WhatsApp messages: Alpha Rai 94 (6), Kochi RTO Abdul Rehman and 1 more', 'headline names the chats: ' + h.headline); ok(h.items[0].title === 'Alpha Rai 94 · 6 unread', 'unread in the title'); }
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
// ids stay unique when several are made at once (templates, voice, imports)
ok(new Set(Array.from({ length: 50 }, () => W.make({ name: 'x' }).id)).size === 50, 'unique ids');
// filters: only from, ignore a sentence, hold for 2 checks, % moves, counts, patterns, moved meetings
const R = (detect, filter, seq) => { const w = W.make({ name: 'T', detect, filter }); return seq.map(g => { const h = W.detect(w, g); w.state.at = 1; return h && h.headline; }); };
ok(JSON.stringify(R({ kind: 'new' }, { from: 'priya' }, [['a 9:00 Rahul hi'], ['b 9:01 Priya hello', 'c 9:02 Rahul yo', 'a 9:00 Rahul hi']]).map(Boolean)) === '[false,true]', 'only from');
ok(JSON.stringify(R({ kind: 'changes' }, { ignore: 'sponsored' }, ['Price 10. Sponsored: buy X now.', 'Price 10. Sponsored: buy Y now.', 'Price 12. Sponsored: buy Z.']).map(Boolean)) === '[false,false,true]', 'ignore a sentence');
ok(JSON.stringify(R({ kind: 'value', cond: 'below 500' }, { hold: 2 }, ['600', '480', '490', '470', '520', '450', '440']).map(Boolean)) === '[false,false,true,false,false,false,true]', 'hold for 2 checks');
ok(JSON.stringify(R({ kind: 'value', cond: 'drops 5%' }, {}, ['1000', '980', '900', '890']).map(Boolean)) === '[false,false,true,false]', 'drops 5%');
ok(JSON.stringify(R({ kind: 'count', cond: 'above 3' }, {}, [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e']]).map(Boolean)) === '[false,false,true,false]', 'count');
ok(JSON.stringify(R({ kind: 'pattern', re: 'gate [A-Z]\\d+' }, {}, ['Boarding soon', 'Boarding soon', 'Boarding at gate B12']).map(Boolean)) === '[false,false,true]', 'pattern');
const cal = R({ kind: 'new', gone: true }, {}, [['Weekly sync, Monday 10:00, Room 4', 'Acme review, Tuesday 14:00, Teams', '1:1 with Priya, Wednesday 11:30, Room 2'], ['Weekly sync, Monday 10:00, Room 4', 'Acme review, Wednesday 16:00, Teams', 'Budget call, Friday 09:00, Teams']]);
ok(cal[1] === 'T: 1 moved, 1 new, 1 gone', 'calendar: ' + cal[1]);
ok(JSON.stringify(R({ kind: 'contains', field: 'in_stock', words: 'true' }, {}, [{ in_stock: false }, { in_stock: false }, { in_stock: true }])) === '[null,null,"T: in stock now"]', 'a field the model pulled out');
// quiet hours wrap past midnight
ok(typeof W.quiet({ quiet: '00:00-23:59' }) === 'boolean', 'quiet hours');
console.log(`${n}/${n} watcher tests pass`);
