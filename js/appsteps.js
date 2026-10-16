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
    if (m.type === 'step') {
      // A click on a label also "clicks" its field: keep the label's click only.
      const prev = R.steps.at(-1), L = m.step.loc || {};
      if (prev?.t === 'web' && prev.step.t === 'click' && m.step.t === 'click' && prev.step.loc?.tag === 'label' && L.tag === 'input' && L.text === prev.step.loc.text && performance.now() - R.last < 600) return;
      this.flushTyping(); this.push({ t: 'web', wid: f.closest('.mw')?.dataset.media || '', step: m.step }); if (m.rect) WebDrive.ring(f, m.rect, true);
    }
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
      <span>${last ? esc(this.describe(last)) : `Use ${APP_NAME} as you will in the demo: click, type, scroll, drag`}</span></div>
      <button class="big-btn accent" data-as="done">Done</button><button class="big-btn" data-as="cancel">Cancel</button>`;
  },
  describe(s) {
    if (!s) return '';
    if (s.t === 'wait') return `Wait ${s.s} s`;
    if (s.t === 'web') return typeof WebDrive !== 'undefined' ? `Web page: ${WebDrive.describe(s.step)}` : 'Web page step';
    const L = s.loc || {}, what = L.match?.det ? `the nearest ${L.match.det} (your detector)` : L.match?.ai ? `${L.match.ai} (screen model)` : L.match?.text ? `“${L.match.text}” on screen` : L.match?.img ? 'the captured area' : L.label || L.text || L.ph || L.name || (L.wid ? `${W[wtype(L.wid)]?.name || L.wid} widget` : L.tag || 'the screen');
    const where = L.wid && (L.label || L.text) ? ` (${W[wtype(L.wid)]?.name || L.wid})` : '';
    return { click: `Click ${what}${where}`, drag: `Drag ${what}${where}`, type: `Type “${s.value}” in ${what}`, select: `Choose “${s.value}” in ${what}`,
      key: `Press ${s.key === ' ' ? 'Space' : s.key}${L.tag || L.match ? ` in ${what}` : ''}`, scroll: s.amount ? `Scroll ${s.amount === 'top' || s.amount === 'bottom' ? `to the ${s.amount}` : s.amount} at ${what}` : `Scroll ${what}${where}` }[s.t] || s.t;
  },

  /* ---------- Finding by text on screen, or by a picture of an area of the screen ----------
     For steps made in the editor (or edited there): they keep working when ids, classes and layout change. */
  /** { el, pt, how } for a locator: { match: { text } }, { match: { img } }, or a recorded element. */
  async locate(L, quick) { // quick (optional steps): no reading the screen when the text isn't on the page
    if (L?.match?.ai) { // described in words: the screen model (js/screenmodel.js)
      try { const f = await ScreenAI.find(L.match.ai, L.match.in); return f ? { el: document.elementFromPoint(f.pt[0], f.pt[1]) || document.body, pt: f.pt, how: 'screen model' } : null; }
      catch (e) { Log.w('app', 'Screen model unavailable', e); toast(e.message); return null; }
    }
    if (L?.match?.det) { // an element of a kind, by your own detector (tools/trainer): the nearest one to where it was
      try {
        const shot = await this.screen(), { dets } = await UiDetect.detect(await createImageBitmap(shot.canvas)), names = UiDetect.cfg()?.classes || [];
        const near = d => Math.hypot((d.box[0] + d.box[2]) / 2 - (L.wx ?? 0.5), (d.box[1] + d.box[3]) / 2 - (L.wy ?? 0.5));
        const d = dets.filter(x => x.score >= 0.3 && names[x.c] === L.match.det).sort((a, b) => near(a) - near(b))[0]; if (!d) return null;
        const pt = [(d.box[0] + d.box[2]) / 2 * innerWidth, (d.box[1] + d.box[3]) / 2 * innerHeight];
        return { el: document.elementFromPoint(pt[0], pt[1]) || document.body, pt, how: 'detector' };
      } catch (e) { Log.w('app', 'Your detector couldn’t run', e); toast(e.message); return null; }
    }
    if (L?.match?.text) return (await this.byText(L.match.text, L, quick)) || null;
    if (L?.match?.img) return (await this.byPicture(L.match)) || null;
    return this.find(L);
  },
  norm: t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(),
  /** Visible text that reads `text` (whole words first, then part of a longer text), in DriveGen/StudioGen and its web widgets. */
  async byText(text, L = {}, quick) {
    const q = this.norm(text), hits = []; if (!q) return null;
    const near = h => Math.hypot(h.pt[0] / innerWidth - (L.wx ?? 0.5), h.pt[1] / innerHeight - (L.wy ?? 0.5));
    const scan = (doc, ox, oy) => {
      const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) {
        const raw = n.nodeValue, t = this.norm(raw); if (!t || !t.includes(q)) continue;
        const el = n.parentElement; if (!el || el.closest('#wdBar,#asPick,#toast,script,style,[hidden]') || !this.shown(el) || el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) continue;
        const r = doc.createRange(), i = raw.toLowerCase().indexOf(text.trim().toLowerCase());
        if (i >= 0) { r.setStart(n, i); r.setEnd(n, i + text.trim().length); } else r.selectNodeContents(n);
        const b = r.getBoundingClientRect(); if (!b.width || !b.height) continue;
        hits.push({ el, pt: [ox + b.left + b.width / 2, oy + b.top + b.height / 2], exact: this.norm(el.innerText) === q, len: t.length });
      }
      for (const el of doc.querySelectorAll('[aria-label],[title],[placeholder],input[type=button],input[type=submit]')) {
        const t = this.norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.value);
        if (!t || !t.includes(q) || !this.shown(el) || el.closest('#wdBar,#asPick,#toast') || el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) continue;
        const b = el.getBoundingClientRect(); hits.push({ el, pt: [ox + b.left + b.width / 2, oy + b.top + b.height / 2], exact: t === q, len: t.length });
      }
      for (const f of doc.querySelectorAll('iframe')) { try { const b = f.getBoundingClientRect(); if (f.contentDocument?.body) scan(f.contentDocument, ox + b.left, oy + b.top); } catch {} }
    };
    scan(document, 0, 0);
    if (!hits.length && typeof WebDrive !== 'undefined') for (const f of $$('#dashRoot webview')) { // a browser widget: its own page finds it
      try { const c = await WebDrive.conn(f), r = await c.call('findText', text.trim()); if (r?.ok) { const [x, y] = WebDrive.onScreen(f, r.rect); hits.push({ el: f, pt: [x, y], exact: true, len: q.length }); } } catch {}
    }
    if (!hits.length && !quick && typeof ScreenAI !== 'undefined' && ScreenAI.downloaded) { // not page text (a slide, a picture): read the screen
      try { const f = await ScreenAI.readFind(text); if (f) return { el: document.elementFromPoint(f.pt[0], f.pt[1]) || document.body, pt: f.pt, how: 'text (read)' }; } catch (e) { Log.w('app', 'Reading the screen failed', e); }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => (b.exact - a.exact) || (a.len - b.len) || (near(a) - near(b)));
    return { ...hits[0], how: 'text' };
  },
  /** A picture of the window: { canvas, k } with k = picture pixels per CSS pixel. Desktop: the app's own window; the PWA
      shares its tab once (the browser asks), and keeps the share for later steps. */
  async screen() {
    if (window.DriveDeckDesktop?.capture) {
      // The window, with each browser widget's page drawn in from its own capture (the window's picture can miss parts of it).
      const win = await loadImage(await DriveDeckDesktop.capture()), k = win.naturalWidth / innerWidth;
      const c = Object.assign(document.createElement('canvas'), { width: win.naturalWidth, height: win.naturalHeight }), x = c.getContext('2d');
      x.drawImage(win, 0, 0);
      for (const wv of $$('#dashRoot webview')) {
        try { const r = wv.getBoundingClientRect(); if (!r.width || !r.height) continue; const img = await loadImage((await wv.capturePage()).toDataURL()); x.drawImage(img, r.left * k, r.top * k, r.width * k, r.height * k); } catch {}
      }
      return { canvas: c, k };
    }
    if (!this.share?.active) {
      this.share = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
      this.shareVideo = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: this.share }); await this.shareVideo.play();
    }
    const src = this.shareVideo, w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }); c.getContext('2d').drawImage(src, 0, 0, w, h);
    return { canvas: c, k: w / innerWidth };
  },
  /** Where the captured picture is on screen now (template matching, coarse to fine); else where it was captured. */
  async byPicture(M) {
    let shot; try { shot = await this.screen(); } catch (e) { Log.w('app', 'No screen picture to match against: using where the area was', e); }
    const fallback = M.at ? { el: document.elementFromPoint(M.at[0] * innerWidth, M.at[1] * innerHeight) || document.body, pt: [M.at[0] * innerWidth, M.at[1] * innerHeight], how: 'position' } : null;
    if (!shot) return fallback;
    const tpl = await loadImage(M.img), t0 = performance.now();
    const best = matchPicture(shot.canvas, tpl, M.w * shot.k, M.h * shot.k, M.at ? [M.at[0] * shot.canvas.width, M.at[1] * shot.canvas.height] : null);
    Log[best && best.score >= 0.6 ? 'i' : 'w']('app', `Picture match ${best ? Math.round(best.score * 100) : 0}% in ${Math.round(performance.now() - t0)} ms`);
    if (!best || best.score < 0.6) return fallback;
    const x = best.x / shot.k, y = best.y / shot.k;
    return { el: document.elementFromPoint(x, y) || document.body, pt: [x, y], how: 'picture', score: best.score };
  },
  /** The scrollable box at or around el. */
  scroller(el) { for (let e = el; e && e !== document.body; e = e.parentElement) { const st = getComputedStyle(e); if (/(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 4) return e; } return document.scrollingElement; },

  /* ---------- Picking on screen (the script editor): an area, or a piece of text ---------- */
  /** Drag a box over the screen: its picture and place, as a match for a step. */
  pickArea() {
    return this.overlay('Drag a box around what to act on (Esc to cancel)', (ov, done) => {
      let x0, y0, box;
      ov.onpointerdown = e => { x0 = e.clientX; y0 = e.clientY; box = document.createElement('div'); box.className = 'as-box'; ov.appendChild(box); ov.setPointerCapture(e.pointerId); };
      ov.onpointermove = e => { if (!box) return; Object.assign(box.style, { left: `${Math.min(x0, e.clientX)}px`, top: `${Math.min(y0, e.clientY)}px`, width: `${Math.abs(e.clientX - x0)}px`, height: `${Math.abs(e.clientY - y0)}px` }); };
      ov.onpointerup = async e => {
        const r = { x: Math.min(x0, e.clientX), y: Math.min(y0, e.clientY), w: Math.abs(e.clientX - x0), h: Math.abs(e.clientY - y0) };
        if (r.w < 8 || r.h < 8) { box?.remove(); box = null; return; }
        ov.remove(); await pause(120); // out of the picture
        try {
          const shot = await this.screen(), k = shot.k, s = Math.min(1, 160 / Math.max(r.w * k, r.h * k));
          const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(r.w * k * s)), height: Math.max(1, Math.round(r.h * k * s)) });
          c.getContext('2d').drawImage(shot.canvas, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
          done({ img: c.toDataURL('image/png'), w: Math.round(r.w), h: Math.round(r.h), at: [+((r.x + r.w / 2) / innerWidth).toFixed(4), +((r.y + r.h / 2) / innerHeight).toFixed(4)] });
        } catch (err) { toast('Couldn’t take a picture of the screen here'); Log.w('app', 'Screen picture failed', err); done({ at: [+((r.x + r.w / 2) / innerWidth).toFixed(4), +((r.y + r.h / 2) / innerHeight).toFixed(4)] }); }
      };
    });
  },
  /** Click on some text on screen: that text (the element's short text, or the word under the pointer). */
  pickText() {
    return this.overlay('Click the text to act on (Esc to cancel)', (ov, done) => {
      ov.onclick = e => {
        ov.style.pointerEvents = 'none'; const el = document.elementFromPoint(e.clientX, e.clientY); ov.style.pointerEvents = '';
        let text = (el?.innerText || el?.getAttribute?.('aria-label') || el?.value || '').trim().replace(/\s+/g, ' ');
        if (!text || text.length > 60) { const r = document.caretRangeFromPoint?.(e.clientX, e.clientY); if (r?.startContainer?.nodeType === 3) { const v = r.startContainer.nodeValue, i = r.startOffset; const a = v.slice(0, i).search(/\S+$/), b = v.slice(i).search(/\s|$/); text = v.slice(a < 0 ? i : a, i + b).trim(); } }
        if (el?.tagName === 'WEBVIEW' || el?.tagName === 'IFRAME') { try { const f = el, b = f.getBoundingClientRect(), d = f.contentDocument, t = d?.elementFromPoint(e.clientX - b.left, e.clientY - b.top); if (t) text = (t.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60); } catch {} }
        ov.remove(); done(text ? { text, at: [+(e.clientX / innerWidth).toFixed(4), +(e.clientY / innerHeight).toFixed(4)] } : null);
        if (!text) toast('No text there: capture it as an area instead');
      };
    });
  },
  overlay(msg, setup) {
    return new Promise(res => {
      const ov = document.createElement('div'); ov.id = 'asPick'; ov.innerHTML = `<div class="as-msg">${esc(msg)}</div>`; document.body.appendChild(ov);
      const done = v => { removeEventListener('keydown', esc_, true); ov.remove(); res(v); };
      const esc_ = e => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      addEventListener('keydown', esc_, true); setup(ov, done);
    });
  },

  /* ---------- Replay ---------- */
  /** Play one step. Shown: the pointer glides there and a dot pulses where it clicks. Quiet (going back): just do it. */
  async play(s, { quiet = false } = {}) {
    if (s.t === 'wait') { if (!quiet) await pause(s.s * 1000); return { ok: true }; }
    if (s.t === 'web') return WebDrive.play(s.step, { quiet, id: s.wid || undefined });
    if (s.t === 'key' && !s.loc) { await this.key(s.key, s.shift); return this.done(s, true, 'keyboard'); }
    let f = null;
    for (let i = 0; i < (s.optional ? 3 : 12) && !(f = await this.locate(s.loc, s.optional)); i++) { // a sheet or widget may still be opening; or it's on another screen
      if (i === 4 && s.loc.view && s.loc.view !== current && typeof openView === 'function') { Log.d('app', `Opening ${s.loc.view} for the next step`); openView(s.loc.view); }
      await pause(250);
    }
    if (f && f.el.closest?.('#dashBar') && $('#view-dashboard').classList.contains('bar-hidden')) { Bar.show(); await pause(380); } // the layout bar slides back first
    if (!f) { Log.w('app', `Not found: ${this.describe(s)}`, { loc: s.loc, optional: !!s.optional }); if (!quiet && !s.optional) toast(`Couldn’t find ${this.describe(s).replace(/^\w+ /, '')}`); return { ok: false }; }
    let [x, y] = this.spot(f, s.loc);
    const free = /^(position|text|picture|screen model|detector|text \(read\))$/.test(f.how) ? [x, y] : this.reach(f.el, x, y); // covered all over: click the element itself
    if (free) [x, y] = free;
    if (s.t === 'click') { if (!quiet) await Cursor.to(x, y); ClickDot.show(x, y, quiet); if (free) await this.click(f.el, x, y); else this.direct(f.el, x, y); }
    else if (s.t === 'drag') {
      const [tx, ty] = [s.to[0] * innerWidth, s.to[1] * innerHeight];
      if (!quiet) await Cursor.to(x, y); ClickDot.show(x, y, quiet);
      await this.drag(f.el, x, y, tx, ty, quiet ? 120 : Math.max(250, s.ms || 400)); ClickDot.show(tx, ty, quiet);
    }
    else if (s.t === 'type' || s.t === 'select') { if (!quiet) await Cursor.to(x, y); ClickDot.show(x, y, quiet); await this.type(f.el, s.value, x, y); }
    else if (s.t === 'key') { f.el.focus?.(); await this.key(s.key, s.shift, f.el); }
    else if (s.t === 'scroll' && s.amount) { // made in the editor: down / up a screenful, or to the top / bottom
      const el = this.scroller(f.el), a = s.amount, h = el.clientHeight * 0.8;
      el.scrollTo({ top: a === 'top' ? 0 : a === 'bottom' ? el.scrollHeight : el.scrollTop + (a === 'up' ? -h : a === 'down' ? h : +a || 0), behavior: quiet ? 'auto' : 'smooth' });
      if (!quiet) { ClickDot.show(x, y); await pause(500); }
    }
    else if (s.t === 'scroll') {
      const el = f.el, top = s.frac && el.scrollHeight > el.clientHeight ? s.frac[0] * (el.scrollHeight - el.clientHeight) : s.top;
      el.scrollTo({ top, left: s.left || 0, behavior: quiet ? 'auto' : 'smooth' }); if (!quiet) await pause(450);
    }
    return this.done(s, true, f.how);
  },
  done(s, ok, how) { Log.i('app', `Played: ${this.describe(s)}`, { how }); Bus.emit('app.step', { value: this.describe(s) }); return { ok, how }; },
  async playAll(steps, o = {}) { for (const s of steps) { await this.play(s, o); if (!o.quiet && s.t !== 'wait') await pause(350); } },
  /** A browser widget under (x, y): its own input (the window's input doesn't reach the page inside it). */
  guestAt(x, y) { const e = document.elementFromPoint(x, y); if (e?.tagName !== 'WEBVIEW') return null; const r = e.getBoundingClientRect(); return { wv: e, x: x - r.left, y: y - r.top }; },
  /** A click as a person makes it: real input in the desktop app, else the events a click fires. */
  async click(el, x, y) {
    const g = this.real && this.guestAt(x, y);
    if (g) { this.focusGuest = g.wv; const c = await WebDrive.conn(g.wv).catch(() => null); if (!(c && await WebDrive.tap(g.wv, c, g.x, g.y))) await WebDrive.input(g.wv, g.x, g.y); return; }
    this.focusGuest = null;
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
    const n = Math.max(8, Math.round(ms / 25)), g = this.real && this.guestAt(x0, y0);
    if (g) { // a drag inside a browser widget's page
      const r = g.wv.getBoundingClientRect(), L = (x, y) => ({ x: Math.round(x - r.left), y: Math.round(y - r.top) });
      g.wv.sendInputEvent({ type: 'mouseDown', ...L(x0, y0), button: 'left', clickCount: 1 });
      for (let i = 1; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; g.wv.sendInputEvent({ type: 'mouseMove', ...L(x, y), button: 'left', modifiers: ['leftButtonDown'] }); Cursor.at(x, y); await pause(ms / n); }
      g.wv.sendInputEvent({ type: 'mouseUp', ...L(x1, y1), button: 'left', clickCount: 1 }); return;
    }
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
    await this.click(el, x, y);
    if (this.focusGuest) { await this.focusGuest.executeJavaScript('document.activeElement?.select?.()').catch(() => {}); await this.focusGuest.insertText(value); await pause(80); return; } // a field in a browser widget's page
    el.focus?.(); el.select?.(); // replace what's there, like typing over a selection
    await DriveDeckDesktop.insertText(value); await pause(80);
  },
  async key(key, shift, el) {
    const code = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete' }[key] || key;
    const guest = this.real && (document.activeElement?.tagName === 'WEBVIEW' ? document.activeElement : this.focusGuest);
    if (this.real) {
      const send = guest ? e => guest.sendInputEvent(e) : e => DriveDeckDesktop.input(e);
      const k = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[key] || key, mods = shift ? ['shift'] : [];
      await send({ type: 'keyDown', keyCode: k, modifiers: mods });
      if (key === 'Enter' || key === ' ') await send({ type: 'char', keyCode: key === 'Enter' ? '\r' : ' ', modifiers: mods });
      await send({ type: 'keyUp', keyCode: k, modifiers: mods }); await pause(60); return;
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
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed')); i.src = src; });
/** Grey levels of an image region scaled to w×h. */
function greyOf(src, sx, sy, sw, sh, w, h) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; // shrinking text without aliasing, the same way for the screen and the picture
  x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  return g;
}
/** Normalised cross-correlation of t (tw×th) over s (sw×sh) at the positions given: [{ x, y, score }] best first. */
function ncc(s, sw, t, tw, th, positions) {
  const n = tw * th; let tm = 0; for (let i = 0; i < n; i++) tm += t[i]; tm /= n;
  let tv = 0; const tc = new Float32Array(n); for (let i = 0; i < n; i++) { tc[i] = t[i] - tm; tv += tc[i] * tc[i]; }
  const out = [];
  for (const [x, y] of positions) {
    let sm = 0, ss = 0, st = 0;
    for (let j = 0; j < th; j++) { const row = (y + j) * sw + x, tr = j * tw; for (let i = 0; i < tw; i++) { const v = s[row + i]; sm += v; ss += v * v; st += v * tc[tr + i]; } }
    const var_ = ss - sm * sm / n, den = Math.sqrt(Math.max(1e-6, var_ * tv));
    out.push({ x, y, score: tv < 1 || var_ < 1 ? 0 : st / den });
  }
  return out.sort((a, b) => b.score - a.score);
}
/** Where `tpl` (shown at tw×th screen pixels) is in `screen`: { x, y (its middle, in screen pixels), score }. A coarse pass
    keeps the best spots, well apart; the fine pass compares at the picture's own resolution (only the screen is scaled, so
    small text keeps its shape). Near ties go to the place it was captured. */
function matchPicture(screen, tpl, tw, th, near) {
  const W = screen.width, H = screen.height;
  const k1 = Math.min(1, 36 / Math.max(tw, th), 520 / W);
  const sw = Math.max(8, Math.round(W * k1)), sh = Math.max(8, Math.round(H * k1)), tw1 = Math.max(4, Math.round(tw * k1)), th1 = Math.max(4, Math.round(th * k1));
  if (tw1 >= sw || th1 >= sh) return null;
  const s1 = greyOf(screen, 0, 0, W, H, sw, sh), t1 = greyOf(tpl, 0, 0, tpl.width, tpl.height, tw1, th1), pos = [];
  for (let y = 0; y <= sh - th1; y++) for (let x = 0; x <= sw - tw1; x++) pos.push([x, y]);
  const all = ncc(s1, sw, t1, tw1, th1, pos), picks = [];
  for (const c of all) { if (picks.length >= 20) break; if (picks.every(p => Math.abs(p.x - c.x) > tw1 * 0.6 || Math.abs(p.y - c.y) > th1 * 0.6)) picks.push(c); }
  // Fine: the screen at the picture's own scale around each pick; the picture as it is.
  const k2 = Math.min(1, tpl.width / tw), sw2 = Math.round(W * k2), sh2 = Math.round(H * k2), tw2 = tpl.width, th2 = tpl.height;
  const s2 = greyOf(screen, 0, 0, W, H, sw2, sh2), t2 = greyOf(tpl, 0, 0, tw2, th2, tw2, th2);
  let best = null;
  for (const c of picks) {
    const cx = Math.round(c.x * k2 / k1), cy = Math.round(c.y * k2 / k1), r = Math.ceil(k2 / k1) + 2, p = [];
    for (let y = Math.max(0, cy - r); y <= Math.min(sh2 - th2, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(sw2 - tw2, cx + r); x++) p.push([x, y]);
    const f = ncc(s2, sw2, t2, tw2, th2, p)[0]; if (!f) continue;
    const mx = (f.x + tw2 / 2) / k2, my = (f.y + th2 / 2) / k2, d = near ? Math.hypot(mx - near[0], my - near[1]) / Math.hypot(W, H) : 0;
    const v = { x: mx, y: my, score: f.score, rank: f.score - d * 0.05 };
    if (!best || v.rank > best.rank) best = v;
  }
  return best;
}
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
Actions.define('app.click', { group: 'Scripts', name: `Click something in ${APP_NAME}`, arg: 'Its label or text (or x,y as fractions of the screen)', async run(v, say, ev) {
  const m = String(v).match(/^\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*$/);
  if (m) return AppSteps.play({ t: 'click', loc: { wx: +m[1], wy: +m[2], data: {}, tag: '' } }, { quiet: !!ev?.quiet });
  const q = plain(v), el = $$(AppSteps.CLICKABLE).filter(e => AppSteps.shown(e)).find(e => [e.getAttribute('aria-label'), e.innerText, e.title].some(t => plain(t) === q))
    || $$(AppSteps.CLICKABLE).filter(e => AppSteps.shown(e)).find(e => [e.getAttribute('aria-label'), e.innerText, e.title].some(t => q && plain(t).includes(q)));
  if (!el) return say(`I can’t see ${v} on the screen.`);
  const r = el.getBoundingClientRect(); await AppSteps.play({ t: 'click', loc: AppSteps.loc(el, r.left + r.width / 2, r.top + r.height / 2) }, { quiet: !!ev?.quiet }); } });
