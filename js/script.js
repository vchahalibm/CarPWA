'use strict';
/* ============================================================
   Scripts: avatar-led presentations and demos (Stage mode).
   A script is JSON: a few setup steps, then beats. Each beat can run
   widget actions (any Actions id: a slide, a web page, the radio…), have
   the avatar say something with a mood and a gesture, and wait for what
   moves it on: a phrase, a hand gesture, the clicker, an app event or a
   timer. Branches jump elsewhere on other phrases or gestures.
   Presenting goes wrong sometimes, so you can always go back a few steps
   ("go back", "back two steps", ←) or start over ("start over", Home):
   going back replays the earlier steps' actions silently, so the deck,
   the web page and the rest are where they were at that step.
   Format, examples and help: Settings › Scripts (ScriptUI below), and
   docs/scripts.md. Loaded after stage.js.
   ============================================================ */
Bus.define('script.beat', 'A script step starts', 'the step’s title');
Bus.define('script.end', 'A script ends', 'the script’s name');

// The avatar's motions (js/motions.js); older names (Yes, No…) still work through motionName().
const SCRIPT_GESTURES = Object.keys(MOTIONS);
const SCRIPT_MOODS = ['Happy', 'Sad', 'Angry', 'Surprised', 'Relaxed'];
// Hand gestures the people tracker reports (js/people.js); scripts can wait for them.
const SCRIPT_HAND = ['Open_Palm', 'Closed_Fist', 'Thumb_Up', 'Thumb_Down', 'Pointing_Up', 'Victory', 'ILoveYou', 'Swipe_Left', 'Swipe_Right'];
// While a script runs, these always work (before any other voice command).
const SCRIPT_CONTROL = [
  [/^(next|next (step|slide|one|please)|continue|go on|carry on|move on|go ahead)$/, 'next'],
  [/^((go|step) back|back|previous|previous (step|slide)|go back one( step)?)$/, 'back'],
  [/^(?:go |step )?back (two|three|four|five|2|3|4|5) (?:steps|slides)$/, 'backN'],
  [/^(start over|restart|start again|from the (top|start|beginning)|start from the beginning)$/, 'restart'],
  [/^(repeat( that)?|say (that|it) again|again|one more time)$/, 'repeat'],
  [/^(stop|end|quit|close) (the )?(script|demo|presentation|show)$/, 'stop'],
];
const NUMW = { two: 2, three: 3, four: 4, five: 5 };
const plain = t => String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const asList = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/\s*[,|]\s*/)).map(x => String(x).trim()).filter(Boolean);

/** Any shape we accept → the one the runner uses. Unknown fields are kept (for the editor). */
function scriptNorm(s) {
  const step = x => typeof x === 'string' ? { say: x } : { ...x, value: x.value == null ? '' : String(x.value) };
  const next = n => { n = typeof n === 'string' ? { on: n } : n || {};
    return { on: asList(n.on), gesture: n.gesture || '', key: n.key !== false, after: +n.after || 0, event: n.event || '', goto: n.goto || '' }; };
  return {
    name: String(s?.name || 'Untitled script'), about: s?.about || '',
    setup: (s?.setup || []).map(step),
    beats: (s?.beats || []).map((b, i) => ({ ...b, id: String(b.id || `step${i + 1}`), title: b.title || b.id || `Step ${i + 1}`, say: b.say || '', mood: b.mood || '', gesture: b.gesture || '',
      do: (b.do || []).map(step), next: next(b.next), branches: (b.branches || []).map(r => ({ on: asList(r.on), gesture: r.gesture || '', goto: String(r.goto || '') })) })),
  };
}
/** Problems that stop a script running (errors) and things worth a look (warnings), each with where. */
function scriptCheck(raw) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['The file isn’t a script (expected { "name": …, "beats": [ … ] })'], warnings };
  if (!Array.isArray(raw.beats) || !raw.beats.length) errors.push('beats: a script needs at least one beat');
  const s = scriptNorm(raw), ids = new Set();
  const stepCheck = (x, where) => {
    if (x.do && !Actions.list[x.do]) warnings.push(`${where}: no action “${x.do}” here (it may come with a later version)`);
    if (!x.do && !x.say && x.wait == null) errors.push(`${where}: a step needs "do" (an action), "say" or "wait"`);
    if (x.gesture && !motionName(x.gesture)) warnings.push(`${where}: “${x.gesture}” isn’t one of the assistant’s motions`);
  };
  s.setup.forEach((x, i) => stepCheck(x, `setup[${i + 1}]`));
  s.beats.forEach((b, i) => {
    const w = `beat ${i + 1} (${b.id})`;
    if (ids.has(b.id)) errors.push(`${w}: the id “${b.id}” is used twice`); ids.add(b.id);
    b.do.forEach((x, k) => stepCheck(x, `${w} › do[${k + 1}]`));
    if (b.mood && !SCRIPT_MOODS.includes(b.mood)) warnings.push(`${w}: mood “${b.mood}” isn’t one of ${SCRIPT_MOODS.join(', ')}`);
    if (b.gesture && !motionName(b.gesture)) warnings.push(`${w}: “${b.gesture}” isn’t one of the assistant’s motions`);
    for (const g of [b.next.gesture, ...b.branches.map(r => r.gesture)]) if (g && !SCRIPT_HAND.includes(g)) warnings.push(`${w}: hand gesture “${g}” isn’t one of ${SCRIPT_HAND.join(', ')}`);
  });
  s.beats.forEach((b, i) => {
    for (const t of [b.next.goto, ...b.branches.map(r => r.goto)]) if (t && !ids.has(t)) errors.push(`beat ${i + 1} (${b.id}): goes to “${t}”, which no beat has as its id`);
    b.branches.forEach((r, k) => { if (!r.on.length && !r.gesture) warnings.push(`beat ${i + 1} (${b.id}) › branch ${k + 1}: no phrase or gesture, so it never happens`); });
  });
  return { errors, warnings, script: s };
}

const Script = {
  cur: null, i: -1, running: false, token: 0, history: [], timer: 0,
  get beat() { return this.cur?.beats[this.i]; },
  /** Start a script (any accepted shape) at a beat. */
  async start(raw, from = 0) {
    const chk = scriptCheck(raw); if (chk.errors.length) { Log.w('script', 'Script has errors', chk.errors); toast(chk.errors[0]); return false; }
    this.stop(true);
    this.cur = chk.script; this.running = true; this.history = [];
    if (current !== 'dashboard') openView('dashboard'); // a script presents on the dashboard
    // The natural voice before the first line (making room for it), so the presenter doesn't start in the device's voice.
    if (settings.tts === 'neural' && store.get('kokoroOK') && !Voice.tts) await Promise.race([Voice.loadTTS(false, true).catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
    Log.i('script', `Script: ${this.cur.name}`, { beats: this.cur.beats.length, from });
    const tok = ++this.token;
    await this.steps(this.cur.setup, { quiet: false, tok });
    if (tok !== this.token) return true;
    await this.restore(typeof from === 'string' ? this.index(from) : from, tok);
    return true;
  },
  index(id) { return this.cur.beats.findIndex(b => b.id === id); },
  /** Play beat i: its actions, then what the avatar says, then wait for what moves it on. */
  async go(i, tok = ++this.token) {
    clearTimeout(this.timer);
    if (!this.running) return;
    if (i >= this.cur.beats.length) return this.finish();
    i = Math.max(0, i); this.i = i; this.history.push(i);
    const b = this.cur.beats[i];
    Log.i('script', `Step ${i + 1}/${this.cur.beats.length}: ${b.title}`);
    Bus.emit('script.beat', { value: b.title, index: i, id: b.id });
    this.paint();
    await this.steps(b.do, { tok }); if (tok !== this.token) return;
    if (b.say || b.mood || b.gesture) await this.say(b, tok); if (tok !== this.token) return;
    if (b.next.after > 0) this.timer = setTimeout(() => tok === this.token && this.next(), b.next.after * 1000);
  },
  /** The avatar's line: mood and gesture as it starts; {notes} is the current slide's speaker notes. */
  async say(x, tok) {
    if (x.mood) Avatar.face(x.mood, 2600);
    if (x.gesture) Avatar.gesture(x.gesture);
    const text = this.fill(x.say); if (!text) return;
    const said = Voice.respond(text);
    await Promise.race([said, new Promise(r => setTimeout(r, Math.max(4000, text.length * 90)))]); // never stuck on a silent voice
  },
  fill(t) {
    return String(t || '').replace(/\{notes\}/g, () => { const id = Media.first('doc'); return id ? Media.notes(id) : ''; })
      .replace(/\{page\}/g, () => String(Media.pdf[Media.first('doc')]?.page || '')).trim();
  },
  /** Run steps in order. Quiet (going back): actions only, nothing said, no waiting. */
  async steps(list, { quiet = false, tok = this.token } = {}) {
    for (const x of list) {
      if (tok !== this.token) return;
      if (x.wait != null) { if (!quiet) await new Promise(r => setTimeout(r, +x.wait || 0)); continue; }
      if (x.do) {
        const r = Actions.run(x.do, this.fill(x.value), quiet ? quietSay : (m, then) => { if (m) Voice.respond(m); then?.(); }, { quiet }); // quiet: going back (web steps skip the pointer)
        if (r && typeof r.then === 'function') await r.catch(() => {});
        await new Promise(r2 => setTimeout(r2, quiet ? 30 : 120)); // let widgets redraw between steps
      }
      if (x.say && !quiet) await this.say(x, tok);
    }
  },
  /** Get to beat k as if the show had run up to it: replay the actions before it silently, then play it. */
  async restore(k, tok = ++this.token) {
    clearTimeout(this.timer); Voice.hush?.();
    k = Math.max(0, Math.min(k, this.cur.beats.length - 1));
    if (k > 0) {
      Log.i('script', `Back to step ${k + 1}: replaying ${k} step${k > 1 ? 's' : ''} quietly`);
      await this.steps(this.cur.setup, { quiet: true, tok });
      for (let j = 0; j < k && tok === this.token; j++) await this.steps(this.cur.beats[j].do, { quiet: true, tok });
    }
    if (tok === this.token) await this.go(k, tok);
  },
  next() {
    if (!this.running) return false;
    const b = this.beat, to = b?.next.goto ? this.index(b.next.goto) : this.i + 1;
    this.go(to); return true;
  },
  back(n = 1) { if (!this.running) return false; this.restore(this.i - n); return true; },
  restart() { if (!this.running) return false; Log.i('script', 'Start over'); this.restore(0); return true; },
  repeat() { if (!this.running) return false; this.go(this.i); return true; },
  jump(id) { const k = typeof id === 'number' ? id : this.index(id); if (k < 0) return false; this.restore(k); return true; },
  finish() {
    Log.i('script', `Script finished: ${this.cur?.name}`);
    Bus.emit('script.end', { value: this.cur?.name || '' });
    this.running = false; this.paint();
  },
  stop(silent) {
    if (!this.running) return;
    this.token++; clearTimeout(this.timer); this.running = false; this.paint();
    if (!silent) { Log.i('script', 'Script stopped'); Bus.emit('script.end', { value: this.cur?.name || '' }); }
  },
  /** Words heard while a script runs: its controls, the beat's own phrases and branches. True if it took them. */
  hear(text) {
    if (!this.running) return false;
    const t = plain(text).replace(/^(ok(ay)?|so|um|uh|please|can you|lets|let us)\s+/, '').replace(/\s+please$/, '');
    for (const [re, what] of SCRIPT_CONTROL) {
      const m = t.match(re); if (!m) continue;
      Log.i('script', `Heard “${text}”: ${what}`);
      if (what === 'backN') return this.back(NUMW[m[1]] || +m[1] || 1);
      return this[what]();
    }
    const b = this.beat; if (!b) return false;
    const has = p => { const q = plain(p); return q && (` ${t} `).includes(` ${q} `); };
    const br = b.branches.find(r => r.on.some(has));
    if (br) { Log.i('script', `Heard “${text}”: branch to ${br.goto}`); this.jump(br.goto); return true; }
    if (b.next.on.some(has)) { Log.i('script', `Heard “${text}”: next`); return this.next(); }
    return false;
  },
  /** A hand gesture from the people tracker. */
  gesture(g) {
    if (!this.running || !this.beat) return false;
    const b = this.beat, br = b.branches.find(r => r.gesture === g);
    if (br) { this.jump(br.goto); return true; }
    if (b.next.gesture === g) return this.next();
    return false;
  },

  /* ---------- On screen: step dots and controls in the Stage layout ---------- */
  paint() {
    const box = $('#dashRoot .st-beats'); if (!box) return;
    box.hidden = !this.running;
    if (!this.running) { box.innerHTML = ''; return; }
    box.innerHTML = `<button class="st-ctl" data-script="restart" aria-label="Start over">${svg('restart')}</button>
      <button class="st-ctl" data-script="back" aria-label="Previous step">${svg('back')}</button>
      <button class="st-dots" data-script="list" aria-label="All steps">${this.cur.beats.map((b, k) => `<i class="${k === this.i ? 'on' : k < this.i ? 'done' : ''}" title="${esc(b.title)}"></i>`).join('')}</button>
      <button class="st-ctl" data-script="next" aria-label="Next step">${svg('back').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button>
      <button class="st-ctl" data-script="stop" aria-label="Stop the script">${svg('close')}</button>`;
  },
  /** Every step, to jump to one (presenting off-script after a glitch). */
  list() {
    if (!this.running) return;
    sheet(this.cur.name, `<div class="pick-list">${this.cur.beats.map((b, k) => `<button class="big-btn ${k === this.i ? 'accent' : ''}" data-scriptjump="${k}">${k + 1}. ${esc(b.title)}</button>`).join('')}</div>`, [['Close']]);
  },
};
Bus.on('dash.rendered', () => Script.paint());
Bus.on('*', (d, name) => { const b = Script.running ? Script.beat : null; if (b?.next?.event && b.next.event === name && !name.startsWith('script.')) Script.next(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-script],[data-scriptjump]'); if (!b) return;
  e.stopPropagation();
  if (b.dataset.scriptjump != null) { closeSheet(); return Script.jump(+b.dataset.scriptjump); }
  const a = b.dataset.script; if (a === 'list') Script.list(); else Script[a]?.();
}, true);
// Clicker and keyboard drive the script while one runs (Stage's own keys turn slides otherwise).
addEventListener('keydown', e => {
  if (!Script.running || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = { ArrowRight: 'next', PageDown: 'next', ' ': 'next', ArrowLeft: 'back', PageUp: 'back', Home: 'restart' }[e.key];
  if (!k || (k === 'next' && Script.beat && !Script.beat.next.key)) return;
  e.preventDefault(); Script[k]();
}, true);

/* ---------- Actions: scripts from voice commands and links; arranging the Stage layout ---------- */
Actions.define('script.run', { group: 'Scripts', name: 'Run a script', arg: 'Script name', run(v, say) {
  const s = Scripts.find(v); if (!s) return say(`I don’t have a script called ${v || 'that'}.`); Script.start(s.json); } });
Actions.define('script.next', { group: 'Scripts', name: 'Next step', arg: '', run: () => Script.next() });
Actions.define('script.back', { group: 'Scripts', name: 'Go back steps', arg: 'How many (1 if blank)', run: v => Script.back(parseInt(v, 10) || 1) });
Actions.define('script.restart', { group: 'Scripts', name: 'Start over', arg: '', run: () => Script.restart() });
Actions.define('script.goto', { group: 'Scripts', name: 'Go to a step', arg: 'Step id or number', run: v => Script.jump(/^\d+$/.test(v) ? +v - 1 : v) });
Actions.define('script.stop', { group: 'Scripts', name: 'Stop the script', arg: '', run: () => Script.stop() });
Actions.define('stage.widgets', { group: 'Dashboard', name: 'Arrange the Stage layout', arg: 'main=doc~stage,web~stage; side=model~stage,camera', run(v) {
  for (const part of v.split(';')) {
    const [z, l] = part.split('='); if (!l) continue;
    const where = 'stage.' + z.trim(), ids = asList(l).filter(id => W[wtype(id)]);
    if (STAGE_ZONES.includes(where)) Dash.setList(where, ids);
  }
  if (settings.dashLayout !== 'stage') settings.dashLayout = 'stage';
  if (current === 'dashboard') Dash.render(); else openView('dashboard');
} });
Actions.define('wait', { group: 'Scripts', name: 'Wait', arg: 'Seconds', run: v => new Promise(r => setTimeout(r, (parseFloat(v) || 1) * 1000)) });

/* ---------- Saved scripts (localStorage: they're small; decks and files are referred to by link) ---------- */
const SAMPLE_SCRIPT = {
  name: `${APP_NAME} tech demo`,
  about: 'A sample: the avatar presents the demo deck, shows a live web page beside the charts, and answers to “next”, “go back” and “show me the live data”.',
  setup: [
    { do: 'mode.set', value: 'stage' },
    { do: 'stage.widgets', value: 'main=doc~stage,web~stage; side=model~stage' },
    { do: 'doc.open', value: 'samples/drivedeck-demo.pptx' },
    { do: 'web.open', value: 'samples/demo-page.html#usage' },
  ],
  beats: [
    { id: 'intro', title: 'Welcome', do: [{ do: 'doc.page', value: '1' }], say: '{notes}', mood: 'Happy', gesture: 'Wave',
      next: { on: ['next', 'lets begin', 'begin'], gesture: 'Swipe_Left' } },
    { id: 'usage', title: 'Usage this quarter', do: [{ do: 'doc.page', value: '2' }, { do: 'web.open', value: 'samples/demo-page.html#usage' }], say: '{notes} The page beside the chart shows the same numbers, live.', gesture: 'ThumbsUp',
      next: { on: ['next'], gesture: 'Swipe_Left' }, branches: [{ on: ['show me the live data', 'live data', 'show live'], goto: 'live' }] },
    { id: 'speed', title: 'Response time', do: [{ do: 'doc.page', value: '3' }, { do: 'web.open', value: 'samples/demo-page.html#speed' }], say: '{notes}', mood: 'Relaxed',
      next: { on: ['next'], gesture: 'Swipe_Left' } },
    { id: 'live', title: 'Live page', do: [{ do: 'web.open', value: 'samples/demo-page.html#live' }], say: 'This is the live page. The numbers update as drivers use ${APP_NAME}, so you can see it working, not just on a slide.', gesture: 'Yes',
      next: { on: ['next', 'back to the slides'], gesture: 'Swipe_Left' } },
    { id: 'thanks', title: 'Thank you', do: [{ do: 'doc.page', value: '4' }], say: '{notes}', mood: 'Happy', gesture: 'Wave', next: { on: ['thank you', 'done'] } },
  ],
};
/* A complex sample on a live site (desktop app): built from steps recorded and captured on goindigo.in. */
const INDIGO_DEMO = {
  "name": "IndiGo live booking demo",
  "about": "A complex sample on a live site (goindigo.in, desktop app): a site helper, recorded steps, text, a screen picture and the screen model, with the assistant speaking and moving.",
  "setup": [
    {
      "do": "mode.set",
      "value": "stage"
    },
    {
      "do": "stage.widgets",
      "value": "main=web~stage; side=model~stage"
    },
    {
      "do": "web.open",
      "value": "https://www.goindigo.in/"
    },
    {
      "do": "wait",
      "value": "6"
    }
  ],
  "beats": [
    {
      "id": "welcome",
      "title": "Welcome",
      "say": "Hello everyone! Today I will book a flight on a live website, IndiGo, all by myself.",
      "mood": "Happy",
      "gesture": "Welcome",
      "next": {
        "on": [
          "next"
        ],
        "after": 1
      }
    },
    {
      "id": "helper",
      "title": "Tidy the page (site helper)",
      "do": [
        {
          "do": "web.helper",
          "value": "IndiGo: ready for the demo"
        },
        {
          "do": "wait",
          "value": "3"
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"click\",\"optional\":true,\"loc\":{\"match\":{\"text\":\"Accept Essential Only\"},\"wx\":0.35,\"wy\":0.9}}"
        }
      ],
      "say": "First, a site helper tidies the page for us: essential cookies only, pop-ups closed, and the booking box in view.",
      "gesture": "PresentLeft",
      "next": {
        "on": [
          "next"
        ],
        "after": 1
      }
    },
    {
      "id": "recorded",
      "title": "Recorded clicks",
      "do": [
        {
          "say": "These two clicks were recorded: round trip, and back to one way."
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"web\",\"wid\":\"web~stage\",\"step\":{\"t\":\"click\",\"loc\":{\"testid\":\"\",\"id\":\"\",\"css\":\"div:nth-of-type(1) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div > label:nth-of-type(2)\",\"tag\":\"label\",\"role\":\"\",\"text\":\"Round Trip\",\"name\":\"\",\"x\":0.279,\"y\":0.653,\"w\":0.11,\"h\":0.057,\"type\":\"\"},\"at\":\"\"}}"
        },
        {
          "do": "wait",
          "value": "1.7"
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"web\",\"wid\":\"web~stage\",\"step\":{\"t\":\"click\",\"loc\":{\"testid\":\"\",\"id\":\"\",\"css\":\"div:nth-of-type(1) > div:nth-of-type(2) > div > div:nth-of-type(1) > div > div > label:nth-of-type(1)\",\"tag\":\"label\",\"role\":\"\",\"text\":\"One Way\",\"name\":\"\",\"x\":0.133,\"y\":0.653,\"w\":0.099,\"h\":0.057,\"type\":\"\"},\"at\":\"\"}}"
        }
      ],
      "gesture": "PointLeft",
      "next": {
        "on": [
          "next"
        ],
        "after": 1
      }
    },
    {
      "id": "where",
      "title": "Destination (text on screen)",
      "do": [
        {
          "say": "Now I find the To field by its text, type Bengaluru, and pick the airport from the list."
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"click\",\"loc\":{\"match\":{\"text\":\"Going to?\"},\"wx\":0.4,\"wy\":0.6}}"
        },
        {
          "do": "wait",
          "value": "1.2"
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"type\",\"value\":\"Bengaluru\",\"loc\":{\"match\":{\"text\":\"Start typing\"},\"wx\":0.4,\"wy\":0.3}}"
        },
        {
          "do": "wait",
          "value": "2"
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"click\",\"loc\":{\"match\":{\"text\":\"Kempegowda\"},\"wx\":0.4,\"wy\":0.45}}"
        },
        {
          "do": "wait",
          "value": "1"
        }
      ],
      "gesture": "Explain",
      "next": {
        "on": [
          "next"
        ],
        "after": 1
      }
    },
    {
      "id": "swap",
      "title": "Swap (a picture of the screen)",
      "do": [
        {
          "say": "This little swap icon has no text, so I find it by its picture. Delhi and Bengaluru trade places,"
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"click\",\"loc\":{\"match\":{\"img\":\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABICAYAAABhlHJbAAAEDklEQVR4AezcyyttcRQH8O8hIY+RicfASBiQiUcxUUSKIzIxkAklIqKQMPFmLDMxRCnEAH+ByCNl4DnyZuD9uNf61Rnczc3dZ92zf3tnqXW0z7bOPr/PWXv/1m+f4vdLflgCfpAfloAAsvgAARRApgAzXSpQAJkCzHSpQAFkCjDTpQIFkCnATJcKFEDTAv81QSqQySmAAsgUYKZLBQogU4CZLhUogEwBZrpUoAAyBZjptqnAj6/G8PT0hOvra+aQrE23BSDhXV5eYmpqChMTE7i9vbVWgXE07YCEd35+ruBaWlowPj4ugP/6gXrwJicnMTQ0hMDAQJSVlSEyMtLwEvbd1FaBHjw6ZT14VVVVqK2tRUBAgH3FDO9MCyDhnZ2dqdN2cHAQj4+PyM/Ph9vtxtXVFU5OTkzH6ekp3t/fDcPz/aYWwPv7eywtLWFgYAAESRX3/PyM0dFRDA8Pm46RkRGMjY1he3vb92KGI2gBpIrb3d3FxcUFqBpp1l1cXMTMzIxXMT09jdnZWezs7BiG5/tNLYChoaHIy8tDRkYG/P39ERISgpycHDQ2NnoVTU1NqKurQ1ZWlu/FDEfQAkizbVpaGjo7O5Geno6Xlxd1HczOzkZDQ4PpqK+vR0VFBWJiYgzD8/2mFkAaVlBQkKoYQkxKSsLc3Bz6+vqwublJux0T2gBJ6CtEmhBubm5otyNCKyAJeRC7urrU6UztCE0qtO+reHt7AwHT76/2W/2cdkAasAeRekJqpKOioujpT0FoBwcHqmVZXl4GtT6f/sjiJ2wBSGOmiSU5ORkFBQV/XYkQ4P7+Pvr7+9HW1qZ6Sd2ItgEkxO+CGu6EhAQUFRWBKrG7u1s7ou8Av9PwYr/L5UJ0dDTa29tRWFhoC0QtgLT6eHh4wNHREQ4PD03F8fGxoi8vL0dKSopavumsRC2AhLe6uqrWvDRxmA1qdejma3BwMF5fX1Xv2NPTg42NDYVr5YMWQFoLr62tYX5+HgsLC14F3YxYX19XVrSSocrc29tT21Y+aAEMCwtDSUkJ6A50c3MzvAlqd1JTU9VaOjw8HLm5ucjMzLTSTh1LCyDNpomJiaiurkZNTY3pqKysRHx8vLoVRj1kcXExWltbERsbqwZl5YMWQM4A6fq5srKC3t5ebG1tgfCoJ4yLi+O8rNe5jgKkRpquc3bBI3XHAdLXn3d3dygtLVWrEV2VR3gUjgKkayfd+qJbYB0dHdCN5zhAl8uFiIgIuD++fNIxYRCYMRxVgcY3b4dtAWR+Cn8AMl/rR6YLIPNjF0ABZAow06UCBZApwEyXChRApgAzXSpQAJkCzHSpQAFkCjDTf3wFMv3kn48JIFeAmS+nsAAyBZjpUoECyBRgpksFCiBTgJn+GwAA//+wZg3SAAAABklEQVQDAOGJi35Zj3CHAAAAAElFTkSuQmCC\",\"w\":40,\"h\":36,\"at\":[0.343,0.2512]},\"wx\":0.343,\"wy\":0.2512}}"
        },
        {
          "do": "wait",
          "value": "1.5"
        },
        {
          "say": "and back again.",
          "gesture": "Laugh"
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"click\",\"loc\":{\"match\":{\"img\":\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABICAYAAABhlHJbAAAEDklEQVR4AezcyyttcRQH8O8hIY+RicfASBiQiUcxUUSKIzIxkAklIqKQMPFmLDMxRCnEAH+ByCNl4DnyZuD9uNf61Rnczc3dZ92zf3tnqXW0z7bOPr/PWXv/1m+f4vdLflgCfpAfloAAsvgAARRApgAzXSpQAJkCzHSpQAFkCjDTpQIFkCnATJcKFEDTAv81QSqQySmAAsgUYKZLBQogU4CZLhUogEwBZrpUoAAyBZjptqnAj6/G8PT0hOvra+aQrE23BSDhXV5eYmpqChMTE7i9vbVWgXE07YCEd35+ruBaWlowPj4ugP/6gXrwJicnMTQ0hMDAQJSVlSEyMtLwEvbd1FaBHjw6ZT14VVVVqK2tRUBAgH3FDO9MCyDhnZ2dqdN2cHAQj4+PyM/Ph9vtxtXVFU5OTkzH6ekp3t/fDcPz/aYWwPv7eywtLWFgYAAESRX3/PyM0dFRDA8Pm46RkRGMjY1he3vb92KGI2gBpIrb3d3FxcUFqBpp1l1cXMTMzIxXMT09jdnZWezs7BiG5/tNLYChoaHIy8tDRkYG/P39ERISgpycHDQ2NnoVTU1NqKurQ1ZWlu/FDEfQAkizbVpaGjo7O5Geno6Xlxd1HczOzkZDQ4PpqK+vR0VFBWJiYgzD8/2mFkAaVlBQkKoYQkxKSsLc3Bz6+vqwublJux0T2gBJ6CtEmhBubm5otyNCKyAJeRC7urrU6UztCE0qtO+reHt7AwHT76/2W/2cdkAasAeRekJqpKOioujpT0FoBwcHqmVZXl4GtT6f/sjiJ2wBSGOmiSU5ORkFBQV/XYkQ4P7+Pvr7+9HW1qZ6Sd2ItgEkxO+CGu6EhAQUFRWBKrG7u1s7ou8Av9PwYr/L5UJ0dDTa29tRWFhoC0QtgLT6eHh4wNHREQ4PD03F8fGxoi8vL0dKSopavumsRC2AhLe6uqrWvDRxmA1qdejma3BwMF5fX1Xv2NPTg42NDYVr5YMWQFoLr62tYX5+HgsLC14F3YxYX19XVrSSocrc29tT21Y+aAEMCwtDSUkJ6A50c3MzvAlqd1JTU9VaOjw8HLm5ucjMzLTSTh1LCyDNpomJiaiurkZNTY3pqKysRHx8vLoVRj1kcXExWltbERsbqwZl5YMWQM4A6fq5srKC3t5ebG1tgfCoJ4yLi+O8rNe5jgKkRpquc3bBI3XHAdLXn3d3dygtLVWrEV2VR3gUjgKkayfd+qJbYB0dHdCN5zhAl8uFiIgIuD++fNIxYRCYMRxVgcY3b4dtAWR+Cn8AMl/rR6YLIPNjF0ABZAow06UCBZApwEyXChRApgAzXSpQAJkCzHSpQAFkCjDTf3wFMv3kn48JIFeAmS+nsAAyBZjpUoECyBRgpksFCiBTgJn+GwAA//+wZg3SAAAABklEQVQDAOGJi35Zj3CHAAAAAElFTkSuQmCC\",\"w\":40,\"h\":36,\"at\":[0.343,0.2512]},\"wx\":0.343,\"wy\":0.2512}}"
        },
        {
          "do": "wait",
          "value": "1"
        }
      ],
      "gesture": "PointLeft",
      "next": {
        "on": [
          "next"
        ],
        "after": 1
      }
    },
    {
      "id": "search",
      "title": "Search (the screen model)",
      "do": [
        {
          "say": "Last, the screen model finds the Search button from those words alone, and presses it."
        },
        {
          "do": "app.step",
          "value": "{\"t\":\"click\",\"loc\":{\"match\":{\"ai\":\"the Search button\",\"in\":\"web\"},\"wx\":0.3,\"wy\":0.6}}"
        },
        {
          "do": "wait",
          "value": "6"
        }
      ],
      "say": "And here are the flights from Delhi to Bengaluru.",
      "gesture": "PresentBoth",
      "next": {
        "on": [
          "next"
        ],
        "after": 2
      }
    },
    {
      "id": "thanks",
      "title": "Thank you",
      "say": "That was StudioGen working a live website: a site helper, recorded clicks, text on screen, a picture of the screen, and the screen model. Thank you!",
      "mood": "Happy",
      "gesture": "Bow",
      "next": {
        "on": [
          "thank you",
          "done"
        ]
      }
    }
  ]
};
const Scripts = {
  mine: () => store.get('scripts', []),
  all() { return [{ id: 'sample', name: SAMPLE_SCRIPT.name, json: SAMPLE_SCRIPT, sample: true }, ...(window.DriveDeckDesktop?.browser ? [{ id: 'sample-indigo', name: INDIGO_DEMO.name, json: INDIGO_DEMO, sample: true }] : []), ...this.mine()]; },
  get(id) { return this.all().find(s => s.id === id); },
  find(name) { const q = plain(name); return this.all().find(s => plain(s.name) === q) || (q && this.all().find(s => plain(s.name).includes(q))) || (!q ? this.all()[0] : null); },
  put(s) { const l = this.mine(), i = l.findIndex(x => x.id === s.id); if (i >= 0) l[i] = s; else l.push(s); store.set('scripts', l); return s; },
  add(json) { return this.put({ id: 's' + Date.now().toString(36), name: json.name || 'Untitled script', json }); },
  del(id) { store.set('scripts', this.mine().filter(s => s.id !== id)); },
  download(json) {
    const a = document.createElement('a'), b = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    a.href = URL.createObjectURL(b); a.download = (plain(json.name) || 'script').replace(/\s+/g, '-') + '.json'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
};

/* ---------- Settings › Scripts: the list, the editor and the help page ---------- */
const ScriptUI = {
  shown: false, page: 'list', draft: null, editId: null, problems: null,
  open(page = 'list') { this.shown = true; this.page = page; if (current !== 'settings') openView('settings'); else this.render(); },
  close() { this.shown = false; this.draft = null; renderSettings(); },
  render() {
    const body = $('#settingsBody');
    if (this.page === 'help') return body.innerHTML = this.helpHtml();
    if (this.page === 'edit' && this.draft) return this.renderEditor();
    const open = store.get('suiOpen', { scripts: true }), sec = (id, title, sub, inner) => `<details class="sui-sec" data-sec="${id}" ${open[id] ? 'open' : ''}>
        <summary><div class="main"><div class="t">${title}</div><div class="s">${sub}</div></div><span class="chev">${svg('back')}</span></summary><div class="sui-sec-body">${inner}</div></details>`;
    const ic = (n, label, attr, cls = '') => `<button class="icon-btn ${cls}" ${attr} aria-label="${esc(label)}" title="${esc(label)}">${svg(n)}</button>`;
    const desk = !!window.DriveDeckDesktop?.browser;
    const scripts = `<div class="chip-row">
        <button class="chip accent" data-sui="new">${svg('plus')}New script</button>
        ${typeof AppSteps !== 'undefined' ? `<button class="chip" data-sui="recscript"><i class="rec-dot"></i>Record a new script</button>` : ''}
        <button class="chip" data-sui="upload">${svg('upload')}Import</button><button class="chip" data-sui="library">📦 Library</button>
        <button class="chip" data-sui="exportall">${svg('download')}Export all</button>
        <button class="chip" data-sui="help">How to write one</button><input type="file" id="suiFile" accept=".json,application/json" hidden></div>
      <div class="sui-note">Library (where Library lists bundles from): <code>${esc(store.get('libraryUrl', '') || LIBRARY_URL)}</code> <button class="link-btn" data-sui="libset">Change</button></div>
      <div class="sui-list">${Scripts.all().map(s => `<div class="sui-item"><div class="main"><div class="t">${esc(s.name)}${s.sample ? ' <span class="tag">sample</span>' : ''}</div>
          <div class="s">${(s.json.beats || []).length} step${(s.json.beats || []).length === 1 ? '' : 's'}${s.json.about ? ' · ' + esc(s.json.about) : ''}</div></div>
          <div class="sui-actions"><button class="mini-btn accent" data-sui="run:${esc(s.id)}">${svg('play')}Run</button><button class="mini-btn" data-sui="edit:${esc(s.id)}">${s.sample ? 'Copy' : 'Edit'}</button>
          ${ic('download', `Export ${s.name} (with what it uses)`, `data-sui="dl:${esc(s.id)}"`)}${s.sample ? '' : ic('del', `Delete ${s.name}`, `data-sui="del:${esc(s.id)}"`)}</div></div>`).join('')}</div>`;
    const motions = typeof Mocap !== 'undefined' ? MotionUI.html() : '';
    const recs = typeof WebDrive !== 'undefined' ? `<p class="sui-note">Older, page-only recordings: clicks and typing on the page in a web widget, played by “Play a recorded sequence”. <b>Record a new script</b> above records the same and everything else in ${APP_NAME}, and its steps can also find things by text, a screen area or a description.</p>
      <div class="sui-list">${WebDrive.recs().map(r => `<div class="sui-item"><div class="main"><div class="t">${esc(r.name)}</div><div class="s">${r.steps.length} steps · ${esc(r.url || '')}</div></div>
          <div class="sui-actions"><button class="mini-btn" data-sui="recplay:${esc(r.name)}">${svg('play')}Play</button>${ic('del', `Delete ${r.name}`, `data-sui="recdel:${esc(r.name)}"`)}</div></div>`).join('') || '<div class="sui-empty">None yet</div>'}</div>
      <div class="chip-row"><button class="chip" data-sui="recalone"><i class="rec-dot"></i>Record a page sequence</button></div>` : '';
    body.innerHTML = `
      <button class="row btn back-row" data-sui="back"><div class="main"><div class="t">‹ Settings</div></div></button>
      <p class="cmd-help">The assistant leads a presentation or demo on Stage: it says each step with an expression and a motion, turns your slides, opens and works web pages, and moves on when you say “next”, show a hand gesture, press the clicker or after a pause.</p>
      ${sec('scripts', 'Scripts', `${Scripts.all().length} · make, record, run`, scripts)}
      ${motions ? sec('motions', 'Assistant motions', `${Object.keys(MOTIONS).length} · preview them, or capture your own with the camera`, motions) : ''}
      ${recs ? sec('recs', 'Web page recordings', `${WebDrive.recs().length} · page-only sequences`, recs) : ''}
      ${desk && typeof WebDrive !== 'undefined' ? sec('helpers', 'Site helpers', `${WebDrive.helperList().length} · your CSS and JavaScript for chosen sites`, WebDrive.helpersHtml()) : ''}
      ${typeof ScreenAI !== 'undefined' ? sec('models', 'Screen understanding', ScreenAI.downloaded ? 'Florence-2 ready' : 'Models that find things on screen', ScreenAI.html()) : ''}`;
    $('#suiFile').addEventListener('change', e => this.upload(e.target.files[0]));
    $$('.sui-sec', body).forEach(d => d.addEventListener('toggle', () => { const o = store.get('suiOpen', { scripts: true }); o[d.dataset.sec] = d.open; store.set('suiOpen', o); if (d.dataset.sec === 'motions') MotionUI.toggled(d.open); }));
    if (open.motions && typeof MotionUI !== 'undefined') MotionUI.toggled(true);
  },
  async upload(f) {
    if (!f) return;
    let json; try { json = JSON.parse(await f.text()); } catch (e) { return sheet('Not a script', `<p>${esc(f.name)} isn’t valid JSON: ${esc(e.message)}</p>`, [['OK']]); }
    if (json?.format === BUNDLE_FORMAT) return Bundles.offer(json, f.name); // a bundle: scripts with their motions, helpers, recordings
    const chk = scriptCheck(json);
    if (chk.errors.length) return sheet('This script has problems', this.problemsHtml(chk), [['OK']]);
    const s = Scripts.add(json); Log.i('script', 'Script uploaded', { name: s.name, beats: chk.script.beats.length, warnings: chk.warnings.length });
    toast(`Added “${s.name}”`); this.render();
    if (chk.warnings.length) sheet('Added, with notes', this.problemsHtml(chk), [['OK']]);
  },
  problemsHtml(chk) {
    return `${chk.errors.length ? `<p><b>Must fix</b></p><ul class="sui-probs err">${chk.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${chk.warnings.length ? `<p><b>Worth a look</b></p><ul class="sui-probs">${chk.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  },
  cmd(v) {
    const [a, id] = [v.split(':')[0], v.split(':').slice(1).join(':')];
    if (a === 'back') return this.page === 'list' ? this.close() : (this.page = 'list', this.draft = null, this.render());
    if (a === 'help') { this.page = 'help'; return this.render(); }
    if (a === 'upload') return $('#suiFile').click();
    if (a === 'template') return Scripts.download(SAMPLE_SCRIPT);
    if (a === 'new') return this.edit(null, JSON.parse(JSON.stringify({ ...SAMPLE_SCRIPT, name: 'My script' })));
    if (a === 'run') { const s = Scripts.get(id); if (s) { this.close(); openView('dashboard'); Script.start(s.json); } return; }
    if (a === 'edit') { const s = Scripts.get(id); return this.edit(s.sample ? null : id, JSON.parse(JSON.stringify(s.sample ? { ...s.json, name: s.json.name + ' (copy)' } : s.json))); }
    if (a === 'dl') return Bundles.export([Scripts.get(id)]);
    if (a === 'exportall') return Bundles.export(Scripts.mine(), { all: true });
    if (a === 'library') return Bundles.library();
    if (a === 'libset') return sheet('Library address', `<label class="se-field"><span>An index.json listing bundles: your team's shared folder on a web server, a GitHub Pages site, a raw GitHub link…</span><input id="libUrl2" class="se-wz-in" value="${esc(store.get('libraryUrl', '') || LIBRARY_URL)}"></label>
      <p class="se-note">Format: { "bundles": [ { "name", "about", "url" } ] }, with each url relative to the index or absolute.</p>`,
      [['Save', () => { const u = $('#libUrl2').value.trim(); store.set('libraryUrl', u && u !== LIBRARY_URL ? u : null); this.render(); toast('Library address saved'); }], ['Use the default', () => { store.set('libraryUrl', null); this.render(); }], ['Cancel']]);
    if (a === 'recalone') { this.shown = false; return WebDrive.recordAlone(); }
    if (a === 'recplay') { const r = WebDrive.recs().find(x => x.name === id); if (r) { this.shown = false; openView('dashboard'); setTimeout(() => WebDrive.playAll(r.steps), 400); } return; }
    if (a === 'recdel') return sheet('Delete this recording?', `<p>${esc(id)}</p>`, [['Delete', () => { WebDrive.delRec(id); this.render(); }], ['Cancel']]);
    if (a === 'rec' && this.draft) { this.shown = false; return WebDrive.recordInto(this, +id.split('.')[1]); }
    if (a === 'recapp' && this.draft) { this.shown = false; return AppSteps.recordInto(this, +id.split('.')[1]); }
    if (a === 'recscript') return AppSteps.recordScript();
    if (a === 'del') return sheet('Delete this script?', `<p>${esc(Scripts.get(id)?.name)}</p>`, [['Delete', () => { Scripts.del(id); this.render(); }], ['Cancel']]);
    // Editor
    const d = this.draft; if (!d) return;
    // A step's actions: add one of a kind, move, try, pick its target on screen.
    const listAt = path => path.startsWith('setup') ? (d.setup ||= []) : (d.beats[+path.split('.')[1]].do ||= []);
    const idxAt = path => +path.split('.').at(-1);
    if (a === 'add') {
      const [what, where] = id.split('@'), L = listAt(where === 'setup' ? 'setup' : `beats.${where}.do`), app = st => ({ do: 'app.step', value: JSON.stringify(st) });
      const pickThen = async (fn, make) => { this.shown = false; openView('dashboard'); await new Promise(r => setTimeout(r, 450)); const m = await fn(); this.shown = true; this.page = 'edit'; openView('settings'); if (m) { L.push(make(m)); this.renderEditor(); } };
      if (what === 'say') L.push({ say: '' });
      else if (what === 'motion') L.push({ do: 'avatar.gesture', value: 'Wave' });
      else if (what === 'point') L.push({ do: 'avatar.pointAt', value: 'doc' });
      else if (what === 'wait') L.push({ do: 'wait', value: '1' });
      else if (what === 'action') L.push({ do: 'doc.next', value: '' });
      else if (what === 'clicktext') return pickThen(() => AppSteps.pickText(), m => app({ t: 'click', loc: { match: { text: m.text }, wx: m.at[0], wy: m.at[1] } }));
      else if (what === 'clickarea') return pickThen(() => AppSteps.pickArea(), m => app({ t: 'click', loc: { match: m.img ? m : { text: '' }, wx: m.at[0], wy: m.at[1] } }));
      else if (what === 'type') L.push(app({ t: 'type', value: '', loc: { match: { text: '' } } }));
      else if (what === 'scroll') L.push(app({ t: 'scroll', amount: 'down', loc: { match: { text: '' } } }));
      return this.renderEditor();
    }
    if (a === 'mvup' || a === 'mvdn') { const L = listAt(id), i = idxAt(id), j = i + (a === 'mvup' ? -1 : 1); if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; return this.renderEditor(); }
    if (a === 'picktext' || a === 'pickarea') {
      const L = listAt(id), i = idxAt(id), st = appStepOf(L[i].value) || { t: 'click', loc: {} };
      this.shown = false; openView('dashboard');
      return setTimeout(async () => { const m = a === 'picktext' ? await AppSteps.pickText() : await AppSteps.pickArea(); this.shown = true; this.page = 'edit'; openView('settings');
        if (m) { st.loc = { ...st.loc, match: st.loc.match?.det ? st.loc.match : a === 'picktext' ? { text: m.text } : m, wx: m.at[0], wy: m.at[1] }; L[i].value = JSON.stringify(st); } this.renderEditor(); }, 450);
    }
    if (a === 'try1') { // play this one action on the dashboard, then come back
      const x = listAt(id)[idxAt(id)]; this.shown = false; openView('dashboard');
      return setTimeout(async () => {
        try { if (x.do) { const r = Actions.run(x.do, Script.fill(x.value), (m, then) => { if (m) Voice.respond(m); then?.(); }); if (r?.then) await r; } if (x.say) await Script.say(x, Script.token); }
        catch (e) { toast(e.message || 'That didn’t work'); }
        setTimeout(() => { this.shown = true; this.page = 'edit'; openView('settings'); }, 1500);
      }, 400);
    }
    if (a === 'save') return this.save();
    if (a === 'try') { const chk = scriptCheck(d); if (chk.errors.length) return sheet('Fix these first', this.problemsHtml(chk), [['OK']]); this.save(true); this.close(); openView('dashboard'); return Script.start(d, +id || 0); }
    if (a === 'check') { const chk = scriptCheck(d); return sheet(chk.errors.length + chk.warnings.length ? 'Check' : 'Looks good', chk.errors.length + chk.warnings.length ? this.problemsHtml(chk) : '<p>No problems found.</p>', [['OK']]); }
    if (a === 'json') return this.jsonSheet();
    if (a === 'addbeat') d.beats.push({ id: `step${d.beats.length + 1}`, title: 'New step', say: '', do: [], next: { on: ['next'] } });
    if (a === 'addsetup') (d.setup ||= []).push({ do: 'doc.page', value: '1' });
    const [kind, i, k] = id.split('.'); const n = +i;
    if (a === 'up' && n > 0) [d.beats[n - 1], d.beats[n]] = [d.beats[n], d.beats[n - 1]];
    if (a === 'down' && n < d.beats.length - 1) [d.beats[n + 1], d.beats[n]] = [d.beats[n], d.beats[n + 1]];
    if (a === 'rmbeat') d.beats.splice(n, 1);
    if (a === 'adddo') (d.beats[n].do ||= []).push({ do: 'doc.next', value: '' });
    if (a === 'rmdo') (kind === 'setup' ? d.setup : d.beats[n].do).splice(+k, 1);
    if (a === 'addbr') (d.beats[n].branches ||= []).push({ on: [''], goto: d.beats[0]?.id || '' });
    if (a === 'rmbr') d.beats[n].branches.splice(+k, 1);
    this.renderEditor();
  },
  edit(id, json) { this.editId = id; this.draft = json; json.beats ||= []; json.beats.forEach(b => { b.next ||= {}; }); this.page = 'edit'; this.render(); },
  save(quiet) {
    const d = this.draft, chk = scriptCheck(d);
    if (chk.errors.length && !quiet) return sheet('Not saved: fix these first', this.problemsHtml(chk), [['OK']]);
    const s = this.editId ? Scripts.put({ id: this.editId, name: d.name, json: d }) : Scripts.add(d); this.editId = s.id;
    Log.i('script', 'Script saved', { name: d.name, beats: d.beats.length }); if (!quiet) toast('Saved');
  },
  jsonSheet() {
    sheet('Script as JSON', `<textarea id="suiJson" class="sui-json" spellcheck="false">${esc(JSON.stringify(this.draft, null, 2))}</textarea><p class="hint">Edit freely; Apply checks it.</p>`,
      [['Apply', () => { let j; try { j = JSON.parse($('#suiJson').value); } catch (e) { toast('Not valid JSON: ' + e.message); return; } this.edit(this.editId, j); }], ['Cancel']]);
  },
  /** Inputs edit the draft in place by path ("beats.2.say"); lists of phrases are comma-separated. */
  setPath(path, val) {
    const keys = path.split('.'); let o = this.draft;
    for (const k of keys.slice(0, -1)) o = o[k] ??= (/^\d+$/.test(k) ? [] : {});
    const last = keys.at(-1);
    o[last] = /\.(on)$/.test(path) || last === 'on' ? asList(val) : last === 'after' ? (+val || 0) : last === 'key' ? !!val : val;
  },
  /** The editor: storyboard cards on a timeline, with a picker and a wizard (js/scriptedit.js). */
  renderEditor() { return StepEditor.render(this); },
  helpHtml() {
    return `<button class="row btn back-row" data-sui="back"><div class="main"><div class="t">‹ Scripts</div></div></button>
      <div class="group-title">Writing a script</div>
      <div class="group sui-help">
        <p>A script is a list of <b>steps</b> the assistant presents one after another, plus a few <b>setup</b> actions that run first (switch to Stage, arrange the widgets, open the deck and the web page). Make one here, or download the sample, change it in any text editor and upload it.</p>
        <h4>Each step</h4>
        <ul><li><b>Do</b>: widget actions, in order: go to a slide (<code>doc.page</code>), next slide, open a web page (<code>web.open</code>), play the radio, wait… Anything a voice command or a widget link can do.</li>
          <li><b>The assistant says</b>: its line, spoken with lip-sync and shown as a caption. <code>{notes}</code> is replaced with the current slide’s speaker notes, so a deck with notes presents itself.</li>
          <li><b>Expression</b> and <b>gesture</b> as it starts: Happy, Sad, Angry, Surprised, Relaxed; Wave, Yes (nod), No, ThumbsUp, Dance, Jump.</li>
          <li><b>Next step when</b>: you say one of the phrases, show a hand gesture (an open palm, a swipe…, with the people tracker), press the clicker or →, something happens in the app, or after some seconds. <b>Then go to</b> can jump instead of going to the following step.</li>
          <li><b>Branches</b>: other phrases or gestures that jump to another step (“show me the live data”).</li></ul>
        <h4>While it runs</h4>
        <ul><li>“next”, “go back”, “back two steps”, “start over”, “repeat that”, “stop the demo”; → ← Page Up/Down and Home on a clicker or keyboard; the step dots at the bottom of the Stage layout (tap them to jump to any step).</li>
          <li>Every other voice command still works.</li>
          <li><b>Going back</b> replays the actions of the steps before it quietly, so the deck and pages are where they were. Use actions that set a state (“go to slide 3”, “open this page”) rather than “next slide”, so going back always lands right.</li></ul>
        <h4>The file</h4>
        <pre class="sui-code">${esc(JSON.stringify({ name: 'My demo', setup: [{ do: 'mode.set', value: 'stage' }, { do: 'doc.open', value: 'https://example.com/deck.pptx' }],
          beats: [{ id: 'intro', title: 'Welcome', do: [{ do: 'doc.page', value: '1' }], say: '{notes}', mood: 'Happy', gesture: 'Wave', next: { on: ['next'], gesture: 'Swipe_Left', after: 0 } },
            { id: 'demo', title: 'Live demo', do: [{ do: 'web.open', value: 'https://example.com/app' }], say: 'Here it is, live.', branches: [{ on: ['go back to the slides'], goto: 'intro' }] }] }, null, 2))}</pre>
        <h4>Actions you can use</h4>
        <table class="sui-acts">${Object.entries(Actions.list).map(([id, a]) => `<tr><td><code>${esc(id)}</code></td><td>${esc(a.name)}${a.arg ? ` <small>(${esc(a.arg)})</small>` : ''}</td></tr>`).join('')}</table>
      </div>`;
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-sui]'); if (!b || !ScriptUI.shown) return; e.stopPropagation(); ScriptUI.cmd(b.dataset.sui); }, true);
document.addEventListener('change', e => {
  const f = e.target.closest?.('[data-sf]'); if (!f || !ScriptUI.draft) return;
  ScriptUI.setPath(f.dataset.sf, f.type === 'checkbox' ? f.checked : f.value);
  if (/\.do$/.test(f.dataset.sf)) ScriptUI.renderEditor(); // the value's hint depends on the action
});
// An app step's fields (what to do, how to find its target, the text, value, key, amount): edit its JSON in place.
document.addEventListener('change', e => {
  const f = e.target.closest?.('[data-asf]'); if (!f || !ScriptUI.draft) return;
  const path = f.dataset.asf, keys = path.split('.'), list = keys[0] === 'setup' ? ScriptUI.draft.setup : ScriptUI.draft.beats[+keys[1]].do, x = list[+keys.at(-1)];
  const st = appStepOf(x.value) || { t: 'click', loc: {} }, v = f.value, k = f.dataset.k; st.loc ||= {};
  if (k === 't') { st.t = v; if (v === 'scroll' && st.top == null) st.amount ||= 'down'; if ((v === 'type' || v === 'select') && st.value == null) st.value = ''; if (v === 'key') st.key ||= 'Enter'; }
  else if (k === 'find') { if (v === 'el') delete st.loc.match; else if (v === 'text') st.loc.match = { text: st.loc.match?.text || st.loc.text || st.loc.label || '' }; else if (v === 'ai') st.loc.match = { ai: st.loc.match?.ai || st.loc.match?.text || st.loc.label || st.loc.text || '' }; else if (v === 'det') st.loc.match = { det: (UiDetect.cfg()?.classes || ['button'])[0] }; else if (!st.loc.match?.img) { x.value = JSON.stringify(st); return ScriptUI.cmd(`pickarea:${path}`); } }
  else if (k === 'text') st.loc.match = { ...(st.loc.match || {}), text: v };
  else if (k === 'ai') st.loc.match = { ai: v };
  else if (k === 'det') st.loc.match = { det: v };
  else st[k] = v;
  x.value = JSON.stringify(st); ScriptUI.renderEditor();
});
ACTIONS.scripts = () => ScriptUI.open();

/* ---------- The presenter view (presenter.html, its own window) ----------
   On your laptop screen while DriveDeck shows full screen on the wall: the step you're on and what the assistant says,
   the slide's speaker notes, what comes next, a timer, the controls and a live preview. It talks to this window over a
   BroadcastChannel (same site, same browser or desktop app): it sends commands, this page sends its state. */
const Presenter = {
  ch: null, seen: 0, heard: '', reply: '', since: 0, t: 0,
  init() {
    if (typeof BroadcastChannel === 'undefined') return;
    this.ch = new BroadcastChannel('dd-present');
    this.ch.onmessage = e => this.msg(e.data || {});
    Bus.on('*', (d, name) => {
      if (name === 'voice.heard') this.heard = d.value || ''; else if (name === 'voice.reply') this.reply = d.value || '';
      else if (name === 'script.beat' && Script.i === 0) this.since = Date.now();
      if (/^(script\.|doc\.page|voice\.(heard|reply)|mode\.change|web\.step)/.test(name)) this.push();
    });
  },
  get open() { return Date.now() - this.seen < 6000; },
  /** Open the presenter view: on another screen in the desktop app, else a new window. */
  show() {
    if (window.DriveDeckDesktop?.presenter) return window.DriveDeckDesktop.presenter();
    const w = window.open('presenter.html', 'dd-presenter', 'popup,width=1100,height=740');
    if (!w) toast(`Allow pop-ups for ${APP_NAME} to open the presenter view`);
  },
  msg(m) {
    // Its ping every 2 s also catches what no event announces (a deck finishing loading): send if anything changed.
    if (m.t === 'hello' || m.t === 'ping') { this.seen = Date.now(); this.push(m.t === 'hello'); return; }
    if (m.t !== 'cmd') return;
    Log.i('stage', `Presenter view: ${m.op}`, { arg: m.arg });
    const doc = Media.first('doc');
    if (m.op === 'start') { const s = Scripts.get(m.arg); if (s) Script.start(s.json); }
    else if (m.op === 'jump') Script.jump(+m.arg);
    else if (m.op === 'slide') { if (doc) Media.go(doc, (Media.pdf[doc]?.page || 1) + (+m.arg || 1)); }
    else if (['next', 'back', 'restart', 'repeat'].includes(m.op)) { if (!Script[m.op]() && doc && (m.op === 'next' || m.op === 'back')) Media.go(doc, (Media.pdf[doc]?.page || 1) + (m.op === 'next' ? 1 : -1)); }
    else if (m.op === 'stop') Script.stop();
    else if (m.op === 'mic') Voice.start();
    setTimeout(() => this.push(), 50);
  },
  /** What the presenter view shows. */
  state() {
    const doc = Media.first('doc'), P = doc && Media.pdf[doc], s = Script.cur, beat = b => b && { title: b.title, say: Script.fill(b.say) };
    return { t: 'state', running: Script.running, name: s?.name || '', i: Script.i, since: this.since,
      beats: s ? s.beats.map(b => ({ title: b.title })) : [], now: Script.running ? beat(Script.beat) : null,
      next: Script.running ? beat(s.beats[Script.beat?.next.goto ? Script.index(Script.beat.next.goto) : Script.i + 1]) : null,
      slide: P ? { page: P.page || 1, pages: P.pages || 0, notes: Media.notes(doc) } : null,
      heard: this.heard, reply: this.reply, scripts: Scripts.all().map(x => ({ id: x.id, name: x.name })),
      mode: Stage.on ? 'stage' : 'drive', theme: document.documentElement.dataset.theme };
  },
  push(now) {
    if (!this.ch || (!now && !this.open)) return;
    clearTimeout(this.t); this.t = setTimeout(() => {
      try { const st = this.state(), k = JSON.stringify(st); if (now || k !== this.last) { this.last = k; this.ch.postMessage(st); } }
      catch (e) { Log.w('stage', 'Presenter view update failed', e); }
    }, now ? 0 : 80);
  },
};
Presenter.init();
Actions.define('stage.presenter', { group: 'Dashboard', name: 'Open the presenter view', arg: '', run: () => Presenter.show() });
