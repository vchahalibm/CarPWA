'use strict';
/* ============================================================
   App steps: record what you do anywhere in DriveDeck (clicks, typing,
   keys, scrolling and drags, on widgets, the layout bar, Settings, sheets,
   and on web pages in web widgets) and replay it from a script.
   - Record: Settings › Scripts › Record a new script (a script made of
     what you do), or a script step's "Record app steps". A bar at the top
     shows what was recorded; Done keeps it.
   - Each step keeps several ways to find its element again (the widget it
     is in, data-* attributes, id, label, text, a path from the widget, and
     the spot as a fraction of the element and of the window), so a replay
     still lands after the layout changed.
   - Replay: a pointer glides to the spot and a pulsating dot marks every
     click. In the desktop app clicks, drags, keys and typing are real input
     (Electron's sendInputEvent, via preload.js), so anything reacts as to a
     person; in the PWA they are dispatched events. Clicks on web pages go
     through Web steps (js/webdrive.js).
   - Never recorded: password, payment and one-time-code fields.
   Loaded after webdrive.js.
   ============================================================ */
Bus.define('app.step', 'A recorded app step plays', 'what it did');

const AppSteps = {
  rec: null,
  recs: () => store.get('appRecs', []),
  saveRec(r) { const l = this.recs().filter(x => x.name !== r.name); l.push(r); store.set('appRecs', l); return r; },
  delRec(name) { store.set('appRecs', this.recs().filter(x => x.name !== name)); },
  get real() { return !!window.DriveDeckDesktop?.input; },

  /* ---------- Finding an element again ---------- */
  CLICKABLE: 'button,a,input,select,textarea,label,summary,[role=button],[role=tab],[role=link],[data-dash],[data-action],[data-go],[data-open],[data-script],[data-sui],[data-cam],[data-media-remount],[tabindex]',
  /** Where (x, y) on el is, as a recorded locator. */
  loc(el, x, y) {
    const t = el.closest?.(this.CLICKABLE) || el, card = t.closest('.wg[data-wid]'), scope = card || t.closest('[id]:not(body):not(html)');
    const data = {}; for (const a of t.attributes || []) if (a.name.startsWith('data-') && !/^data-(cw|ch|rs-|fmove|frs)/.test(a.name) && a.value.length <= 120) data[a.name] = a.value;
    const r = t.getBoundingClientRect(), txt = (t.innerText || t.value || '').trim().replace(/\s+/g, ' ');
    return {
      wid: card?.dataset.wid || '', scope: card ? '' : scope?.id || '', tag: t.tagName.toLowerCase(), data,
      id: t.id && !/\d{4,}/.test(t.id) ? t.id : '', label: t.getAttribute('aria-label') || t.getAttribute('title') || '', text: txt.length <= 60 ? txt : '',
      name: t.getAttribute('name') || '', ph: t.getAttribute('placeholder') || '', path: this.path(t, scope),
      fx: r.width ? +((x - r.left) / r.width).toFixed(3) : 0.5, fy: r.height ? +((y - r.top) / r.height).toFixed(3) : 0.5,
      wx: +(x / innerWidth).toFixed(4), wy: +(y / innerHeight).toFixed(4), view: current,
    };
  },
  path(el, scope) {
    const out = []; let e = el;
    while (e && e !== scope && e !== document.body && out.length < 12) {
      const p = e.parentElement; if (!p) break;
      const same = [...p.children].filter(c => c.tagName === e.tagName);
      out.unshift(`${e.tagName.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''}`); e = p;
    }
    return out.join('>');
  },
  shown: el => { if (!el?.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]'); },
  /** The element a locator points at, and how it was found. */
  find(L) {
    const root = L.wid ? $(`[data-wid="${CSS.escape(L.wid)}"]`) : L.scope ? document.getElementById(L.scope) : document;
    if (!root) return L.wid ? null : this.atPoint(L);
    const pick = (list, how) => { const l = [...list].filter(e => this.shown(e)); if (!l.length) return null;
      const best = l.length > 1 && L.text ? l.find(e => (e.innerText || '').trim().replace(/\s+/g, ' ') === L.text) || l[0] : l[0]; return { el: best, how }; };
    const q = s => { try { return root.querySelectorAll(s); } catch { return []; } };
    const keys = Object.entries(L.data || {});
    let r = null;
    if (keys.length) r = pick(q(L.tag + keys.map(([k, v]) => `[${k}="${CSS.escape(v)}"]`).join('')), 'data');
    if (!r && L.id) r = pick([document.getElementById(L.id)].filter(Boolean), 'id');
    if (!r && L.label) r = pick(q(`${L.tag}[aria-label="${CSS.escape(L.label)}"],${L.tag}[title="${CSS.escape(L.label)}"]`), 'label');
    if (!r && (L.name || L.ph)) r = pick(q(L.name ? `${L.tag}[name="${CSS.escape(L.name)}"]` : `${L.tag}[placeholder="${CSS.escape(L.ph)}"]`), 'field');
    if (!r && L.path) r = pick(root === document ? q(`body>${L.path}`) : q(`:scope>${L.path}`), 'path');
    if (!r && L.text) r = pick([...q(L.tag)].filter(e => (e.innerText || '').trim().replace(/\s+/g, ' ') === L.text), 'text');
    return r || this.atPoint(L);
  },
  atPoint(L) { const el = document.elementFromPoint(L.wx * innerWidth, L.wy * innerHeight); return el ? { el, how: 'position', pt: [L.wx * innerWidth, L.wy * innerHeight] } : null; },
  /** The spot to click on a found element: the same place on it as when recorded. */
  spot(f, L) {
    if (f.pt) return f.pt;
    const r = f.el.getBoundingClientRect(), k = v => Math.min(0.95, Math.max(0.05, v));
    return [r.left + k(L.fx ?? 0.5) * r.width, r.top + k(L.fy ?? 0.5) * r.height];
  },
  /** Is el what a click at (x, y) would reach? If something covers that spot (the script's own controls, a floating widget),
      another visible spot on it, or null when it's covered all over. */
  reach(el, x, y) {
    const hits = (px, py) => { const e = document.elementFromPoint(px, py); return !!e && (e === el || el.contains(e)); };
    if (hits(x, y)) return [x, y];
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.15], [0.85, 0.85], [0.15, 0.85], [0.85, 0.15]]) {
      const px = r.left + fx * r.width, py = r.top + fy * r.height; if (hits(px, py)) return [px, py];
    }
    return null;
  },
  secret(el) {
    const t = (el?.type || '').toLowerCase(), ac = (el?.autocomplete || '').toLowerCase();
    return t === 'password' || /cc-|one-time-code|current-password|new-password/.test(ac) || /passw|card.?num|cvv|cvc|otp/i.test(`${el?.name} ${el?.id}`);
  },

  /* ---------- Recording ---------- */
  /** Record until Done; `done(steps)` gets them (with waits where you paused). */
  record(done, title = 'Recording app steps') {
    if (this.rec) return;
    const R = this.rec = { steps: [], done, title, last: performance.now(), down: null, typing: null, scrolls: new Map(), userAt: 0, frames: [] };
    const skip = e => !e.isTrusted || e.target?.closest?.('#wdBar');
    const on = (type, f, opt = true) => { document.addEventListener(type, f, opt); (R.off ||= []).push(() => document.removeEventListener(type, f, opt)); };
    on('pointerdown', e => { R.userAt = performance.now(); if (skip(e) || e.button > 0) return; this.flushTyping(); R.down = { x: e.clientX, y: e.clientY, el: e.target, loc: this.loc(e.target, e.clientX, e.clientY), t: performance.now() }; });
    on('pointerup', e => {
      const D = R.down; R.down = null; if (!D || skip(e)) return;
      const dist = Math.hypot(e.clientX - D.x, e.clientY - D.y);
      if (dist < 12) this.push({ t: 'click', loc: D.loc });
      else this.push({ t: 'drag', loc: D.loc, to: [+(e.clientX / innerWidth).toFixed(4), +(e.clientY / innerHeight).toFixed(4)], ms: Math.round(Math.min(3000, performance.now() - D.t)) });
    });
    on('input', e => {
      const el = e.target; if (skip(e) || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || /^(checkbox|radio|range|file|color)$/.test(el.type)) return;
      if (this.secret(el)) { if (!R.warned) { R.warned = true; toast('Passwords and card numbers aren’t recorded: type them yourself'); } return; }
      R.typing = { el, step: { t: 'type', loc: this.loc(el, el.getBoundingClientRect().left + 8, el.getBoundingClientRect().top + 8), value: el.value } };
    });
    on('change', e => { const el = e.target; if (skip(e)) return;
      if (el.tagName === 'SELECT') this.push({ t: 'select', loc: this.loc(el, el.getBoundingClientRect().left + 8, el.getBoundingClientRect().top + 8), value: el.value });
      else if (el.type === 'range') this.push({ t: 'type', loc: this.loc(el, el.getBoundingClientRect().left + 8, el.getBoundingClientRect().top + 8), value: el.value }); });
    on('keydown', e => {
      R.userAt = performance.now(); if (skip(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      const keys = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ...(inField ? [] : [' ', 'Backspace', 'Delete'])];
      if (!keys.includes(e.key)) return;
      this.flushTyping();
      const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : null, r = el?.getBoundingClientRect();
      this.push({ t: 'key', key: e.key, shift: e.shiftKey, loc: el ? this.loc(el, r.left + r.width / 2, r.top + r.height / 2) : null });
    });
    for (const k of ['wheel', 'touchmove']) on(k, () => { R.userAt = performance.now(); }, { capture: true, passive: true });
    on('scroll', e => {
      const el = e.target === document ? document.scrollingElement : e.target;
      if (!el || el.closest?.('#wdBar') || performance.now() - R.userAt > 900) return; // only scrolling you did, not the app's own
      clearTimeout(R.scrolls.get(el)); R.scrolls.set(el, setTimeout(() => {
        const r = el.getBoundingClientRect();
        this.push({ t: 'scroll', loc: this.loc(el, r.left + r.width / 2, r.top + r.height / 2), top: Math.round(el.scrollTop), left: Math.round(el.scrollLeft), frac: [+(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)).toFixed(3), +(el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth)).toFixed(3)] });
      }, 300));
    });
    // Web pages in web widgets record themselves (Web steps): their steps come here while this records.
    this.webFrames();
    R.offRender = Bus.on('dash.rendered', () => this.webFrames());
    Log.i('app', 'Recording app steps', { real: this.real }); this.bar();
  },
  async webFrames() {
    const R = this.rec; if (!R || typeof WebDrive === 'undefined') return;
    for (const f of $$('#dashRoot .mw :is(iframe, webview)')) {
      if (R.frames.includes(f)) continue; R.frames.push(f);
      try { const c = await WebDrive.conn(f); await c.call('record', true); }
      catch (e) { Log.d('app', 'This web page can’t be recorded (clicks on it are kept as screen positions)', e); }
    }
  },
  /** A step the web page in a web widget reported (WebDrive.event hands it over while this records). */
  webEvent(f, m) {
    const R = this.rec; if (!R) return;
    if (m.type === 'step') { this.flushTyping(); this.push({ t: 'web', wid: f.closest('.mw')?.dataset.media || '', step: m.step }); if (m.rect) WebDrive.ring(f, m.rect, true); }
    else if (m.type === 'expect') { const s = R.steps.filter(x => x.t === 'web').at(-1); if (s) s.step.expect = m.expect; }
  },
  flushTyping() { const T = this.rec?.typing; if (!T) return; this.rec.typing = null; T.step.value = T.el.value; this.push(T.step); },
  push(step) {
    const R = this.rec; if (!R) return;
    if (step.t !== 'type') this.flushTyping();
    const now = performance.now(), gap = now - R.last; R.last = now;
    if (R.steps.length && gap > 1200) R.steps.push({ t: 'wait', s: +(Math.min(4000, gap) / 1000).toFixed(1) }); // keep the pace of a pause, not its length
    const prev = R.steps.at(-1);
    if (step.t === 'scroll' && prev?.t === 'scroll' && prev.loc.path === step.loc.path && prev.loc.wid === step.loc.wid) R.steps.pop(); // one scroll, where it ended
    R.steps.push(step); Log.i('app', `Recorded: ${this.describe(step)}`); this.bar();
  },
  finish(keep) {
    const R = this.rec; if (!R) return;
    this.flushTyping(); this.rec = null; R.off.forEach(f => f()); R.offRender?.(); $('#wdBar')?.remove();
    for (const f of R.frames) WebDrive.conn(f).then(c => c.call('record', false)).catch(() => {});
    while (R.steps.at(-1)?.t === 'wait') R.steps.pop();
    Log.i('app', keep ? `Recorded ${R.steps.length} app steps` : 'App step recording cancelled');
    if (keep) R.done(R.steps);
  },
  bar() {
    const R = this.rec; if (!R) return;
    let b = $('#wdBar'); if (!b) { b = document.createElement('div'); b.id = 'wdBar'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    const n = R.steps.filter(s => s.t !== 'wait').length, last = R.steps.filter(s => s.t !== 'wait').at(-1);
    b.innerHTML = `<span class="wd-dot"></span><div class="wd-txt"><b>${esc(R.title)} · ${n} step${n === 1 ? '' : 's'}</b>
      <span>${last ? esc(this.describe(last)) : 'Use DriveDeck as you will in the demo: click, type, scroll, drag'}</span></div>
      <button class="big-btn accent" data-as="done">Done</button><button class="big-btn" data-as="cancel">Cancel</button>`;
  },
  describe(s) {
    if (!s) return '';
    if (s.t === 'wait') return `Wait ${s.s} s`;
    if (s.t === 'web') return typeof WebDrive !== 'undefined' ? `Web page: ${WebDrive.describe(s.step)}` : 'Web page step';
    const L = s.loc || {}, what = L.label || L.text || L.ph || L.name || (L.wid ? `${W[wtype(L.wid)]?.name || L.wid} widget` : L.tag || 'the screen');
    const where = L.wid && (L.label || L.text) ? ` (${W[wtype(L.wid)]?.name || L.wid})` : '';
    return { click: `Click ${what}${where}`, drag: `Drag ${what}${where}`, type: `Type “${s.value}” in ${what}`, select: `Choose “${s.value}” in ${what}`,
      key: `Press ${s.key === ' ' ? 'Space' : s.key}${L.tag ? ` in ${what}` : ''}`, scroll: `Scroll ${what}${where}` }[s.t] || s.t;
  },

  /* ---------- Replay ---------- */
  /** Play one step. Shown: the pointer glides there and a dot pulses where it clicks. Quiet (going back): just do it. */
  async play(s, { quiet = false } = {}) {
    if (s.t === 'wait') { if (!quiet) await pause(s.s * 1000); return { ok: true }; }
    if (s.t === 'web') return WebDrive.play(s.step, { quiet, id: s.wid || undefined });
    if (s.t === 'key' && !s.loc) { await this.key(s.key, s.shift); return this.done(s, true, 'keyboard'); }
    let f = null;
    for (let i = 0; i < 12 && !(f = this.find(s.loc)); i++) { // a sheet or widget may still be opening; or it's on another screen
      if (i === 4 && s.loc.view && s.loc.view !== current && typeof openView === 'function') { Log.d('app', `Opening ${s.loc.view} for the next step`); openView(s.loc.view); }
      await pause(250);
    }
    if (f && f.el.closest?.('#dashBar') && $('#view-dashboard').classList.contains('bar-hidden')) { Bar.show(); await pause(380); } // the layout bar slides back first
    if (!f) { Log.w('app', `Not found: ${this.describe(s)}`, { loc: s.loc }); if (!quiet) toast(`Couldn’t find ${this.describe(s).replace(/^\w+ /, '')}`); return { ok: false }; }
    let [x, y] = this.spot(f, s.loc);
    const free = f.how === 'position' ? [x, y] : this.reach(f.el, x, y); // covered all over: click the element itself
    if (free) [x, y] = free;
    if (s.t === 'click') { if (!quiet) await Cursor.to(x, y); ClickDot.show(x, y, quiet); if (free) await this.click(f.el, x, y); else this.direct(f.el, x, y); }
    else if (s.t === 'drag') {
      const [tx, ty] = [s.to[0] * innerWidth, s.to[1] * innerHeight];
      if (!quiet) await Cursor.to(x, y); ClickDot.show(x, y, quiet);
      await this.drag(f.el, x, y, tx, ty, quiet ? 120 : Math.max(250, s.ms || 400)); ClickDot.show(tx, ty, quiet);
    }
    else if (s.t === 'type' || s.t === 'select') { if (!quiet) await Cursor.to(x, y); ClickDot.show(x, y, quiet); await this.type(f.el, s.value, x, y); }
    else if (s.t === 'key') { f.el.focus?.(); await this.key(s.key, s.shift, f.el); }
    else if (s.t === 'scroll') {
      const el = f.el, top = s.frac && el.scrollHeight > el.clientHeight ? s.frac[0] * (el.scrollHeight - el.clientHeight) : s.top;
      el.scrollTo({ top, left: s.left || 0, behavior: quiet ? 'auto' : 'smooth' }); if (!quiet) await pause(450);
    }
    return this.done(s, true, f.how);
  },
  done(s, ok, how) { Log.i('app', `Played: ${this.describe(s)}`, { how }); Bus.emit('app.step', { value: this.describe(s) }); return { ok, how }; },
  async playAll(steps, o = {}) { for (const s of steps) { await this.play(s, o); if (!o.quiet && s.t !== 'wait') await pause(350); } },
  /** A click as a person makes it: real input in the desktop app, else the events a click fires. */
  async click(el, x, y) {
    if (this.real) {
      x = Math.round(x); y = Math.round(y);
      await DriveDeckDesktop.input({ type: 'mouseMove', x, y }); await pause(30);
      await DriveDeckDesktop.input({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(60);
      await DriveDeckDesktop.input({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await pause(60);
      return;
    }
    Pointer.clickAt(x, y);
  },
  /** Covered: the click's events straight to the element (in either app). */
  direct(el, x, y) {
    Log.d('app', 'Covered on screen: clicking the element directly');
    const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 };
    for (const k of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (k.startsWith('pointer') ? PointerEvent : MouseEvent)(k, o));
  },
  async drag(el, x0, y0, x1, y1, ms) {
    const n = Math.max(8, Math.round(ms / 25));
    if (this.real) {
      await DriveDeckDesktop.input({ type: 'mouseMove', x: Math.round(x0), y: Math.round(y0) });
      await DriveDeckDesktop.input({ type: 'mouseDown', x: Math.round(x0), y: Math.round(y0), button: 'left', clickCount: 1 });
      for (let i = 1; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); await DriveDeckDesktop.input({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); Cursor.at(x, y); await pause(ms / n); }
      await DriveDeckDesktop.input({ type: 'mouseUp', x: Math.round(x1), y: Math.round(y1), button: 'left', clickCount: 1 });
      return;
    }
    const t = document.elementFromPoint(x0, y0) || el, o = (x, y, b) => ({ bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: b });
    t.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0, 1))); t.dispatchEvent(new MouseEvent('mousedown', o(x0, y0, 1)));
    for (let i = 1; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; t.dispatchEvent(new PointerEvent('pointermove', o(x, y, 1))); t.dispatchEvent(new MouseEvent('mousemove', o(x, y, 1))); Cursor.at(x, y); await pause(ms / n); }
    t.dispatchEvent(new PointerEvent('pointerup', o(x1, y1, 0))); t.dispatchEvent(new MouseEvent('mouseup', o(x1, y1, 0)));
  },
  async type(el, value, x, y) {
    value = String(value ?? '');
    if (el.tagName === 'SELECT' || el.type === 'range' || !this.real) { // set it as the page would see typing
      el.focus?.();
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    await this.click(el, x, y); el.focus?.(); el.select?.(); // replace what's there, like typing over a selection
    await DriveDeckDesktop.insertText(value); await pause(80);
  },
  async key(key, shift, el) {
    const code = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete' }[key] || key;
    if (this.real) {
      const k = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[key] || key, mods = shift ? ['shift'] : [];
      await DriveDeckDesktop.input({ type: 'keyDown', keyCode: k, modifiers: mods });
      if (key === 'Enter' || key === ' ') await DriveDeckDesktop.input({ type: 'char', keyCode: key === 'Enter' ? '\r' : ' ', modifiers: mods });
      await DriveDeckDesktop.input({ type: 'keyUp', keyCode: k, modifiers: mods }); await pause(60); return;
    }
    const t = el || document.activeElement || document.body, o = { key, code, bubbles: true, cancelable: true, shiftKey: !!shift };
    const go = t.dispatchEvent(new KeyboardEvent('keydown', o)); t.dispatchEvent(new KeyboardEvent('keyup', o));
    if (go && key === 'Enter' && t.form) t.form.requestSubmit?.();
    if (go && (key === 'Enter' || key === ' ') && t.matches?.('button,[role=button],a')) t.click();
  },

  /* ---------- From Settings › Scripts ---------- */
  /** Record a new script: everything you do becomes its one step's actions; then it can be saved, run or edited. */
  recordScript() {
    ScriptUI.shown = false; openView('dashboard');
    setTimeout(() => this.record(steps => {
      if (!steps.length) { ScriptUI.open(); return toast('Nothing was recorded'); }
      const real = steps.filter(s => s.t !== 'wait');
      sheet(`${real.length} step${real.length === 1 ? '' : 's'} recorded`, `<ol class="wd-list">${real.map(s => `<li>${esc(this.describe(s))}</li>`).join('')}</ol>
        <label class="fld"><span>Script name</span><input id="asName" value="Recorded ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}"></label>
        <p class="hint">The script plays these steps in order; a pulsating dot shows each click. Edit it later to add what the assistant says between them.</p>`,
        [['Save and run', () => { const s = this.toScript(steps, $('#asName')?.value); openView('dashboard'); setTimeout(() => Script.start(s.json), 300); }],
          ['Save', () => { this.toScript(steps, $('#asName')?.value); ScriptUI.open(); }], ['Discard', () => ScriptUI.open()]]);
    }, 'Recording a new script'), 350);
  },
  toScript(steps, name) {
    const json = { name: (name || '').trim() || 'Recorded script', about: 'Recorded app steps', setup: [],
      beats: [{ id: 'steps', title: 'Recorded steps', do: this.asDo(steps), next: { on: ['next'] } }] };
    const s = Scripts.add(json); Log.i('app', 'Recorded script saved', { name: s.name, steps: steps.length }); toast(`Saved “${s.name}”`); return s;
  },
  asDo: steps => steps.map(s => s.t === 'wait' ? { do: 'wait', value: String(s.s) } : { do: 'app.step', value: JSON.stringify(s) }),
  /** Record into step n of the script being edited, then come back to the editor. */
  recordInto(ui, n) {
    openView('dashboard');
    setTimeout(() => this.record(steps => {
      ui.shown = true; ui.page = 'edit'; openView('settings');
      if (steps.length) { const b = ui.draft.beats[n]; b.do = [...(b.do || []), ...this.asDo(steps)]; toast(`Added ${steps.filter(s => s.t !== 'wait').length} app steps`); }
      ui.render();
    }, `Recording step ${n + 1}`), 350);
  },
};
const pause = ms => new Promise(r => setTimeout(r, ms));
/* The audience's pointer for app steps: glides across the window to where the next click is. */
const Cursor = {
  el() { let c = $('#asCursor'); if (!c) { c = document.createElement('div'); c.id = 'asCursor'; c.className = 'wd-cursor'; c.style.transform = `translate(${innerWidth / 2}px,${innerHeight / 2}px)`; document.body.appendChild(c); c.getBoundingClientRect(); } return c; },
  at(x, y) { const c = this.el(); c.style.transition = 'none'; c.style.transform = `translate(${x}px,${y}px)`; this.later(); },
  to(x, y) { const c = this.el(); c.style.transition = ''; c.style.transform = `translate(${x}px,${y}px)`; this.later(); return pause(480); },
  later() { clearTimeout(this.t); this.t = setTimeout(() => $('#asCursor')?.remove(), 3500); },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-as]'); if (!b) return; e.stopPropagation(); AppSteps.finish(b.dataset.as === 'done'); }, true);

/* ---------- Actions (scripts, voice commands, links) ---------- */
const appStepOf = v => { try { const s = typeof v === 'string' ? JSON.parse(v) : v; return s?.t ? s : null; } catch { return null; } };
Actions.define('app.step', { group: 'Scripts', name: 'Do a recorded app step', arg: 'Recorded step (from Record app steps)', async run(v, say, ev) {
  const s = appStepOf(v); if (!s) return say('That app step isn’t valid: record it again.'); await AppSteps.play(s, { quiet: !!ev?.quiet }); } });
Actions.define('app.play', { group: 'Scripts', name: 'Play recorded app steps', arg: 'Recording name', async run(v, say, ev) {
  const r = AppSteps.recs().find(x => plain(x.name) === plain(v)); if (!r) return say(`I don’t have app steps called ${v}.`);
  await AppSteps.playAll(r.steps, { quiet: !!ev?.quiet }); } });
Actions.define('app.click', { group: 'Scripts', name: 'Click something in DriveDeck', arg: 'Its label or text (or x,y as fractions of the screen)', async run(v, say, ev) {
  const m = String(v).match(/^\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*$/);
  if (m) return AppSteps.play({ t: 'click', loc: { wx: +m[1], wy: +m[2], data: {}, tag: '' } }, { quiet: !!ev?.quiet });
  const q = plain(v), el = $$(AppSteps.CLICKABLE).filter(e => AppSteps.shown(e)).find(e => [e.getAttribute('aria-label'), e.innerText, e.title].some(t => plain(t) === q))
    || $$(AppSteps.CLICKABLE).filter(e => AppSteps.shown(e)).find(e => [e.getAttribute('aria-label'), e.innerText, e.title].some(t => q && plain(t).includes(q)));
  if (!el) return say(`I can’t see ${v} on the screen.`);
  const r = el.getBoundingClientRect(); await AppSteps.play({ t: 'click', loc: AppSteps.loc(el, r.left + r.width / 2, r.top + r.height / 2) }, { quiet: !!ev?.quiet }); } });
