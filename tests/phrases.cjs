// Phrase tests for js/commands.js: run with `node tests/phrases.cjs` from the repo root (CI runs it too).
// Each case: what was said, the command it must find (undefined: none), and optionally a captured value (name=value).
// Loose cases also say whether it should run straight away ('run') or ask “Did you mean …?” first ('ask').
const fs = require('fs'), vm = require('vm');
const ctx = { console, current: 'dashboard', document: { addEventListener() {} }, Log: { i() {}, d() {}, w() {}, e() {} },
  store: { d: {}, get(k, def) { return k in this.d ? this.d[k] : def; }, set(k, v) { this.d[k] = v; } },
  W: { weather: { name: 'Weather' }, chat: { name: 'Assistant' }, clock: { name: 'Clock' }, nowPlaying: { name: 'Now Playing' } },
  CLUSTERS: { twin: {}, arc: {} }, settings: { cluster: 'twin' }, MODES: [], isIOS: true };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/commands.js', 'utf8') + ';this.Commands=Commands;this.LOOSE_RUN=LOOSE_RUN;', ctx);
let bad = 0, n = 0;
const check = (ok, msg) => { n++; if (!ok) { bad++; console.log('FAIL', msg); } };
const has = (r, kv) => { if (!kv) return true; const [k, v] = kv.split('='); return (r.vars[k] || '').toLowerCase() === v.toLowerCase(); };

// Exact phrases, keywords and near-miss spelling
const exact = [
 ['Play music from Maroon 5.','music.play','q=maroon 5'],['play maroon5','music.play','q=maroon5'],['Play Coldplay on Spotify','music.on','q=coldplay'],['play believer on youtube music','music.on','q=believer'],['play believer on youtube','app.youtube','q=believer'],['play jazz on my ipod','music.play'],
 ['play music','music.resume'],['Hey, could you please take me home?','nav.home','q=home'],['navigate to Indiranagar','nav.to','place=indiranagar'],
 ['Navigate to MG Road with Waze','nav.handoff','app=waze'],['what\'s my ETA','nav.eta'],['When will we get there?','nav.eta'],['how far is it','nav.distance'],
 ['call mom','phone.call','who=mom'],['Call 98765 43210','phone.call'],['text Priya saying I\'m running late','phone.text','msg=I\'m running late'],
 ['tell Priya that I\'m late','phone.text'],['WhatsApp Alex that I\'m here','phone.whatsapp'],['read my messages','phone.read'],['what\'s the weather like','info.weather'],
 ['what time is it','info.time'],['What is the date?','info.date'],['what is the time','info.time'],['HUD mode','nav.mode','mode=HUD'],['dark mode','dash.theme','theme=dark'],['stage mode','dash.stage'],['switch to presentation mode','dash.stage'],['start presenting','dash.stage'],['back to drive mode','dash.drive'],['driving mode','dash.drive'],['light mode','dash.theme','theme=light'],['switch to 3D view','nav.mode'],
 ['show the widgets layout','dash.layout'],['analog style','dash.style'],['hide the dock','dash.dockhide'],['open spotify','dash.open'],['open weather','dash.open'],
 ['gas station near me','nav.nearby'],['find the nearest petrol pump','nav.nearby'],['I need fuel','nav.nearby'],['end navigation','nav.end'],['stop the music','music.pause'],
 ['next song','music.next'],['skip','music.next'],['zoom in','nav.zoomin'],['run shortcut Good Morning','app.shortcut','name=Good Morning'],
 ['run shortcut play artist with maroon 5','app.shortcut','q=maroon 5'],['search cats on youtube','app.youtube','q=cats'],['navigte to koramangala','nav.to'],
 ['what can I say','info.help'],['never mind','va.cancel'],['send my eta to Priya','nav.share'],['show the weather widget','dash.widget'],['where am I','nav.where'],
 ['play the radio','music.radio'], ['play radio mirchi','radio.station','station=mirchi'],['next slide','media.next'],['what do you see','vision.what'],['what\'s ahead','vision.what'],['what is in front of me','vision.what'],['describe the road','vision.what'],['turn on object alerts','vision.alertsOn'],['turn off camera alerts','vision.alertsOff'],['what\'s next','nav.next'],['next page','media.next'],['previous slide','media.prev'],['go back one page','media.prev'],['go to slide 5','media.page','n=5'],['page 12','media.page','n=12'],['play the video','media.play'],['pause the video','media.pause'],['stop the video','media.pause'],['pause the music','music.pause'],['next song','music.next'],['play bbc world service radio','radio.station','station=bbc world service'],['tune to vividh bharati','radio.station','station=vividh bharati'],['play big fm on the radio','radio.station','station=big fm'],['next station','radio.next'],['change the station','radio.next'],['stop the radio','radio.stop'],['pause the radio','radio.stop'],['turn off the radio','radio.stop'],['show the stations','radio.list'],['stop the music','music.pause'],['pause','music.pause'],['play coldplay','music.play','q=coldplay'],['play a podcast','music.podcasts'],['start demo drive','nav.demo'],['recenter','nav.recenter'],['blah blah',undefined]];

for (const [t, id, kv] of exact) { const r = ctx.Commands.match(t); check(r.cmd?.id === id && has(r, kv), `${JSON.stringify(t)} → ${r.cmd?.id} ${r.how || ''} ${JSON.stringify(r.vars)}`); }

// Loose: a word or two missed or misheard
const loose = [
  ['navigate costco', 'nav.to', 'place=costco', 'run'],
  ['take me costco', 'nav.to', 'place=costco', 'run'],
  ['directions the airport', 'nav.to', 'place=airport', 'run'],
  ['navigation to the airport', 'nav.to', 'place=airport', 'run'],
  ['calling mom', 'phone.call', 'who=mom', 'run'],
  ['stopping the radio', 'radio.stop', null, 'run'],
  ['turn the music down', 'music.resume', null, 'ask'],
  ['find me nearest coffee shop', 'nav.nearby', 'what=coffee shop', 'run'],
  ['end the route now okay', 'nav.end', null, 'run'],
  ['next slight', undefined],
  ['zoom', 'nav.zoomin', null, 'run'],
  ['the', undefined],
  ['blah blah blah', undefined],
  ['coffee', undefined],
  ['i love this song', undefined],
];
for (const [t, id, kv, how] of loose) {
  const r = ctx.Commands.match(t), got = r.cmd?.id;
  const mode = r.how === 'loose' ? (r.conf >= ctx.LOOSE_RUN ? 'run' : 'ask') : r.cmd ? 'run' : undefined;
  check(got === id && has(r, kv) && (!how || mode === how), `loose ${JSON.stringify(t)} → ${got} ${r.how || ''} ${r.conf != null ? Math.round(r.conf * 100) + '%' : ''} “${r.echo || ''}” ${JSON.stringify(r.vars)} (want ${id} ${how || ''})`);
}

// The recognizer's other guesses count too
{ const r = ctx.Commands.match('cool mom', ['call mom']); check(r.cmd?.id === 'phone.call' && r.vars.who === 'mom', `alternatives → ${r.cmd?.id}`); }

// Your own commands win ties
ctx.store.d.commands = { custom: [{ id: 'my.1', name: 'x', say: ['play {q}'], do: { type: 'shortcut', shortcut: 'DD Play', input: '{q}' } }] };
ctx.Commands.save(ctx.store.d.commands);
{ const r = ctx.Commands.match('play maroon 5'); check(r.cmd?.id === 'my.1' && r.vars.q === 'maroon 5', 'custom command wins: ' + r.cmd?.id); }

console.log(`${n - bad}/${n} phrase tests pass`);
process.exit(bad ? 1 : 0);
