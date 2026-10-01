'use strict';
/* ============================================================
   Widgets working together: actions, links and app-wide events.
   - Actions: things DriveDeck can do, by id ('radio.play', 'say', 'nav.go'…),
     each taking one value. Voice commands can run them (Then › Do a widget
     action), and so can links.
   - Links (Settings › Widget links): "When <event> [containing …] → do <action>
     with <value>". The value can use {value}, what the event carries.
   - Widgets can react to any event themselves: W[type].on = { 'nav.start'(data, id) {…} }.
   Loaded after commands.js; uses Bus (events.js), W/Dash (dash.js), Voice, BUILTINS.
   ============================================================ */
const Actions = {
  list: {}, // id → { group, name, arg (what the value is; '' for none), run(value, say, event) }
  define(id, a) { this.list[id] = a; },
  /** Run an action. `say(msg, then, opts)` gives spoken feedback (a voice command); links pass a quiet one. */
  run(id, value = '', say = quietSay, event = {}) {
    const a = this.list[id];
    if (!a) { Log.w('link', `No action ${id}`); return false; }
    Log.i('link', `Action ${id}`, { value });
    try { a.run(String(value ?? '').trim(), say, event); return true; }
    catch (e) { Log.e('link', `Action ${id} failed`, e); return false; }
  },
};
/** Feedback for actions run by a link: shown as a toast, not spoken (a link that wants speech uses the Say action). */
function quietSay(msg, then) { if (msg) Log.d('link', 'Action says', { msg }); then?.(); }
const viaBuiltin = (fn, vars) => (v, say) => BUILTINS[fn].run({ ...vars(v), text: v, q: v }, say);

Actions.define('say', { group: 'Assistant', name: 'Say something', arg: 'What to say', run: v => v && Voice.speak(v) });
Actions.define('cmd', { group: 'Assistant', name: 'Run a voice command', arg: 'The command, as you’d say it', run: v => v && handleCommand(v) });
Actions.define('nav.go', { group: 'Navigation', name: 'Navigate to a place', arg: 'Place', run: viaBuiltin('navigate', v => ({ place: v })) });
Actions.define('nav.end', { group: 'Navigation', name: 'End the route', arg: '', run: (v, say) => BUILTINS.endRoute.run({}, say) });
Actions.define('open', { group: 'Dashboard', name: 'Open a screen', arg: 'Screen (maps, music, phone, dashboard…)', run(v) {
  const id = v === 'dashboard' ? 'dashboard' : lookup(SCREEN_NAMES, v) || (appById(v) ? v : null);
  if (id) id === 'dashboard' ? openView('dashboard') : openApp(id);
} });
Actions.define('dash.page', { group: 'Dashboard', name: 'Show a widget page', arg: 'Page number', run(v) {
  const p = Math.max(0, Math.min(Dash.pages().length - 1, (parseInt(v, 10) || 1) - 1));
  store.set('wpage', p); settings.dashLayout = 'widgets'; store.set('settings', settings); openView('dashboard');
} });
Actions.define('music.pause', { group: 'Music', name: 'Pause the music player', arg: '', run: () => { player.playing = false; updatePlayerUI(); } });
Actions.define('music.play', { group: 'Music', name: 'Play music', arg: 'Artist or song (blank = resume)', run: (v, say) => BUILTINS.play.run({ q: v, text: v }, say) });

/* ---------- The car starts moving / stops (from GPS or the demo drive) ---------- */
const Motion = { moving: false, since: 0 };
setInterval(() => {
  const v = loc.source === 'none' ? 0 : loc.speed || 0, now = Date.now(); // m/s
  const want = Motion.moving ? v > 0.6 : v > 3; // hysteresis: start above ~11 km/h, stop below ~2 km/h
  if (want === Motion.moving) { Motion.since = now; return; }
  if (now - Motion.since < (Motion.moving ? 5000 : 3000)) return;
  Motion.moving = want; Motion.since = now;
  Bus.emit(want ? 'drive.moving' : 'drive.stopped', { value: want ? `${speedVal(v)} ${imperial() ? 'mph' : 'km/h'}` : '' });
}, 1000);

/* ---------- Links ---------- */
const DEFAULT_LINKS = [
  { id: 'ex.arrive', on: false, when: { event: 'nav.arrive' }, then: { action: 'say', value: 'You have arrived at {value}.' } },
  { id: 'ex.station', on: false, when: { event: 'radio.play' }, then: { action: 'say', value: 'Now playing {value}.' } },
  { id: 'ex.navradio', on: false, when: { event: 'nav.arrive' }, then: { action: 'radio.stop', value: '' } },
];
const Links = {
  all() { const l = store.get('links'); return Array.isArray(l) ? l : DEFAULT_LINKS.map(x => ({ ...x })); },
  save(l) { store.set('links', l); },
  depth: 0, runs: {},
  /** An event happened: run every link that's on and matches. Links can trigger events that trigger links: three deep at
      most, and no link runs more than 3 times in 10 s (an action can cause its own event again later, e.g. next station). */
  fire(data, name) {
    if (this.depth > 2) return Log.w('link', `Stopped a chain of links at ${name}`);
    const value = String(data?.value ?? '');
    for (const k of this.all()) {
      if (k.on === false || k.when?.event !== name) continue;
      if (k.when.has && !value.toLowerCase().includes(k.when.has.toLowerCase())) continue;
      const now = Date.now(), recent = (this.runs[k.id] || []).filter(t => now - t < 10000);
      if (recent.length >= 3) { Log.w('link', 'Stopped a chain of links: this link keeps repeating', { link: k.id, event: name }); continue; }
      this.runs[k.id] = [...recent, now];
      Log.i('link', `Link: ${Bus.EVENTS[name]?.[0] || name} → ${Actions.list[k.then?.action]?.name || k.then?.action}`, { value });
      this.depth++;
      try { Actions.run(k.then.action, fillIn(k.then.value || '', { value, ...data }), quietSay, data); } finally { this.depth--; }
    }
  },
};
Bus.on('*', (data, name) => {
  Links.fire(data, name);
  // Widgets on the dashboard that react to this event themselves.
  if (typeof widgetIds === 'function') for (const id of widgetIds()) { const h = W[wtype(id)]?.on?.[name]; if (h) try { h(data, id); } catch (e) { Log.e('link', `Widget ${id} failed on ${name}`, e); } }
});

/* ---------- Settings › Widget links ---------- */
const LinkUI = {
  shown: false,
  open() { this.shown = true; if (current !== 'settings') openView('settings'); else this.render(); },
  close() { this.shown = false; renderSettings(); },
  label(k) {
    const ev = Bus.EVENTS[k.when?.event]?.[0] || k.when?.event || '?', a = Actions.list[k.then?.action];
    return [`When ${lowerFirst(ev)}${k.when?.has ? ` (with “${k.when.has}”)` : ''}`, `${a?.name || 'Missing action'}${a?.arg && k.then?.value ? `: ${k.then.value}` : ''}`];
  },
  render() {
    const l = Links.all();
    const row = (k, i) => { const [w, t] = this.label(k);
      return `<div class="row-wrap cmd-row"><button class="row" data-linkedit="${i}"><div class="main"><div class="t">${esc(w)}</div><div class="s">→ ${esc(t)}</div></div></button>
        <span class="cmd-sw"><button class="switch ${k.on === false ? '' : 'on'}" data-linkon="${i}" role="switch" aria-checked="${k.on !== false}" aria-label="Link on"></button></span></div>`; };
    $('#settingsBody').innerHTML = `
      <button class="row btn back-row" data-linkui="back"><div class="main"><div class="t">‹ Settings</div></div></button>
      <div class="group-title">Widget links</div>
      <p class="cmd-help">Make one thing drive another: <b>when</b> something happens in DriveDeck (a route starts, you arrive, a station starts playing, a voice command runs, the car starts moving…), <b>do</b> an action (play a station, say something, open a screen…). Use <b>{value}</b> for what the event carries, like the place or the station. Voice commands can run the same actions: <b>Settings › Voice commands › Then › Do a widget action</b>.</p>
      <div class="group"><button class="row btn" data-linkui="add"><div class="main"><div class="t">＋ Add a link</div></div></button></div>
      ${l.length ? `<div class="group">${l.map(row).join('')}</div>` : ''}`;
  },
  edit(i) {
    const l = Links.all(), k = i == null ? { on: true, when: { event: 'nav.start' }, then: { action: 'say', value: '' } } : l[i];
    const opt = (list, val) => list.map(([v, t]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const groups = {}; Object.entries(Actions.list).forEach(([id, a]) => (groups[a.group] ||= []).push([id, a.name]));
    sheet(i == null ? 'New link' : 'Edit link', `<div class="cmd-form">
      <label class="fld"><span>When</span><select id="lkEvent">${opt(Object.entries(Bus.EVENTS).map(([id, [t]]) => [id, t]), k.when.event)}</select></label>
      <label class="fld"><span>Only when it carries these words (optional)</span><input id="lkHas" value="${esc(k.when.has || '')}" placeholder="e.g. Home" autocomplete="off"></label>
      <p class="hint" id="lkCarries"></p>
      <label class="fld"><span>Do</span><select id="lkAction">${Object.entries(groups).map(([g, a]) => `<optgroup label="${esc(g)}">${opt(a, k.then.action)}</optgroup>`).join('')}</select></label>
      <label class="fld" id="lkValWrap"><span id="lkValL">With</span><input id="lkValue" value="${esc(k.then.value || '')}" placeholder="{value}" autocomplete="off"></label></div>`,
      [['Save', () => this.save(i)], ...(i != null ? [['Delete', () => { const a = Links.all(); a.splice(i, 1); Links.save(a); this.render(); }]] : []), ['Cancel']]);
    const sync = () => {
      const c = Bus.EVENTS[$('#lkEvent').value]?.[1], a = Actions.list[$('#lkAction').value];
      $('#lkCarries').textContent = c ? `{value} will be ${c}.` : 'This event carries no value.';
      $('#lkValWrap').hidden = !a?.arg; $('#lkValL').textContent = a?.arg || 'With';
    };
    ['lkEvent', 'lkAction'].forEach(id => $('#' + id).addEventListener('input', sync)); sync();
  },
  save(i) {
    const l = Links.all(), k = { id: l[i]?.id || 'lk.' + Date.now().toString(36), on: l[i]?.on ?? true,
      when: { event: $('#lkEvent').value, ...($('#lkHas').value.trim() ? { has: $('#lkHas').value.trim() } : {}) },
      then: { action: $('#lkAction').value, value: $('#lkValue').value.trim() } };
    i == null ? l.push(k) : l[i] = k; Links.save(l); toast('Link saved'); this.render();
  },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-linkui],[data-linkedit],[data-linkon]'); if (!t) return;
  if ('linkedit' in t.dataset) return LinkUI.edit(+t.dataset.linkedit);
  if ('linkon' in t.dataset) { const l = Links.all(), k = l[+t.dataset.linkon]; k.on = k.on === false; Links.save(l); return LinkUI.render(); }
  if (t.dataset.linkui === 'back') LinkUI.close(); else if (t.dataset.linkui === 'add') LinkUI.edit(null);
});
