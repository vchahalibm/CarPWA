'use strict';
/* ============================================================
   RPA: the one automation engine for doing what a person does in the apps: used by scripts (the rpa.* actions, on Stage
   or anywhere) and by MuseTester (tools/musetester), which runs its tests' steps through it. Guide: docs/musetester-guide.html.
   - Finding: by the words on it (`text`), a field's label (`label`), a role (`role`: button, link, textbox…), a CSS
     selector (`sel`), the nth of several (`nth`), inside something (`within`: words or a selector). In StudioGen's own
     screens, or in a page of the agent browser (`web`: part of its address, e.g. "slack").
   - Doing: click (double, right), type (letter by letter; enter; clear), key (with modifiers: "Meta+K"), scroll (by an
     amount, to the top or bottom, or until something shows), hover, drag (onto something, or by dx/dy), choose (an option
     of a dropdown), tick (a checkbox), wait (until something shows or goes), and look (is it there, what it says).
   - Input: real (the desktop app: Electron's sendInputEvent through DriveDeckDesktop.input; agent-browser pages: the
     webview's own sendInputEvent), else page events (DriveGen, or `real: false`).
   - Showing: a pointer glides to each target and rings it; a caption names the step (`show`, `RPA.caption`).
   - Recording: RPA.record.start() notes your clicks, typing, choices and Enter as steps; stop() gives them back.
   Never typed or recorded: password, payment and one-time-code fields.
   Loaded after agent.js.
   ============================================================ */
const RPA = {
  opts: { show: false, real: true, speed: 1 },
  get pause() { return 650 / Math.max(0.2, this.opts.speed || 1); },
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  secret: el => !!el && (el.type === 'password' || /one-time-code|cc-|card/i.test(el.autocomplete || '') || /password|passcode|otp|cvv|card number/i.test(`${el.name || ''} ${el.id || ''} ${el.getAttribute?.('aria-label') || ''}`)),
  CLICKABLE: 'button,[role="button"],a,[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],.app-tile,.chip,.big-btn,.link-btn,[data-wt],[data-ag],summary,label,input,select,textarea,[contenteditable="true"],[tabindex]',

  /* ---------- Finding ---------- */
  words: el => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || el.placeholder || el.value || '').replace(/\s+/g, ' ').trim(),
  visible: el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  /** The element a target names, or null. t: { text, label, sel, role, nth, within } (a string: its words). */
  find(t) {
    t = typeof t === 'string' ? { text: t } : t || {};
    let root = document;
    if (t.within) { const bySel = typeof t.within === 'string' && /^[#.[]/.test(t.within); root = bySel ? [...document.querySelectorAll(t.within)].find(this.visible) : this.find(typeof t.within === 'string' ? { text: t.within } : t.within);
      if (root && !bySel) { const w = root; while (root.parentElement && ![...root.querySelectorAll(this.CLICKABLE)].some(e => !w.contains(e))) root = root.parentElement; }
      if (!root) return null; } /* a selector: inside it; words: the nearest part around them that has controls (a settings row, a card) */
    const role = t.role ? `[role="${t.role}"]${{ button: ',button', link: ',a', textbox: ',input:not([type]),input[type="text"],input[type="search"],textarea,[contenteditable="true"]', checkbox: ',input[type="checkbox"]', combobox: ',select' }[t.role] || ''}` : '';
    let l = [...root.querySelectorAll(t.sel || role || (t.label ? 'input,select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"]' : this.CLICKABLE))].filter(e => this.visible(e) && !e.closest('#museRpa'));
    if (t.label) { const q = t.label.toLowerCase(); const byLabel = e => { const id = e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`), wrap = e.closest('label,.se-field,.se-row,.row'); return [e.getAttribute('aria-label'), e.placeholder, e.name, id?.textContent, wrap?.querySelector('span,.t')?.textContent, wrap?.textContent].filter(Boolean).map(x => x.replace(/\s+/g, ' ').trim().toLowerCase()); };
      l = l.filter(e => byLabel(e).some(x => x === q || x.startsWith(q) || x.includes(q))); }
    if (t.text != null && t.text !== '') { const q = String(t.text).toLowerCase().trim(), w = e => this.words(e).toLowerCase();
      const exact = l.filter(e => w(e) === q), starts = l.filter(e => w(e).startsWith(q)), has = l.filter(e => w(e).includes(q) || (e.getAttribute('aria-label') || '').toLowerCase().includes(q));
      l = exact.length ? exact : starts.length ? starts : has;
      if (!l.length && !t.sel && !t.role && !t.label) l = [...root.querySelectorAll('body *')].filter(e => !/^(SCRIPT|STYLE|svg)$/i.test(e.tagName) && this.visible(e) && !e.closest('#museRpa') && w(e).includes(q)); /* words that aren't on a control: a message, a status */
      l.sort((a, b) => this.words(a).length - this.words(b).length); /* the tightest match: the button, not the card around it */ }
    return l[Math.max(0, (+t.nth || 1) - 1)] || null;
  },
  describe(t) { return typeof t === 'string' ? `“${t}”` : t.text ? `“${t.text}”` : t.label ? `the field “${t.label}”` : t.sel || t.role || 'it'; },
  async need(t, ms = 8000) { for (const t0 = Date.now(); ; await this.sleep(200)) { const el = this.find(t); if (el) return el; if (Date.now() - t0 > ms) throw new Error(`Nothing called ${this.describe(t)} on the screen`); } },

  /* ---------- The pointer, the ring, the caption ---------- */
  ui() {
    if (document.getElementById('museRpa') || document.getElementById('museCur')) return; /* MuseTester's own pointer, from an app without RPA */
    const css = document.createElement('style'); css.textContent = `#museRpa{position:fixed;inset:0;pointer-events:none;z-index:2147483647}#museCur{position:fixed;left:0;top:0;width:28px;height:28px;transition:transform .55s cubic-bezier(.3,.7,.2,1);transform:translate(-60px,-60px)}#museCur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))}
#museRing{position:fixed;border:3px solid #0a84ff;border-radius:10px;box-shadow:0 0 0 5px rgba(10,132,255,.25);transition:all .3s;opacity:0}#museCap{position:fixed;left:50%;top:10px;transform:translateX(-50%);max-width:86vw;background:rgba(10,132,255,.96);color:#fff;font:600 14px/1.35 -apple-system,system-ui,sans-serif;padding:9px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35)}#museCap[hidden]{display:none}
.museTap{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(10,132,255,.5);animation:museTap .55s ease-out forwards}@keyframes museTap{from{transform:scale(.3);opacity:1}to{transform:scale(1.7);opacity:0}}`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML('beforeend', '<div id="museRpa"><div id="museRing"></div><div id="museCur"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg></div><div id="museCap" hidden></div></div>');
  },
  caption(text) { this.ui(); const c = document.getElementById('museCap'); c.hidden = !text; c.textContent = text || ''; },
  async point(el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' }); await this.sleep(200);
    const b = el.getBoundingClientRect(), x = Math.round(b.left + b.width / 2), y = Math.round(b.top + b.height / 2), top = document.elementFromPoint(x, y);
    if (this.realNow && top && !el.contains(top) && !top.contains(el) && !top.closest('label')?.contains(el)) throw new Error(`${this.words(el).slice(0, 40) || 'It'} is covered by ${top.closest('[id]')?.id || top.tagName.toLowerCase()}`);
    if (this.opts.show) { this.ui(); Object.assign(document.getElementById('museRing').style, { left: `${b.left - 5}px`, top: `${b.top - 5}px`, width: `${b.width + 10}px`, height: `${b.height + 10}px`, opacity: 1 });
      document.getElementById('museCur').style.transform = `translate(${x - 4}px,${y - 3}px)`; await this.sleep(this.pause); }
    return { x, y, b };
  },
  tapped(x, y) { if (!this.opts.show) return; const t = document.createElement('div'); t.className = 'museTap'; t.style.left = `${x}px`; t.style.top = `${y}px`; (document.getElementById('museRpa') || document.body).appendChild(t); setTimeout(() => t.remove(), 650); setTimeout(() => { const r = document.getElementById('museRing'); if (r) r.style.opacity = 0; }, 450); },

  /* ---------- Input ---------- */
  get realNow() { return this.opts.real !== false && !!window.DriveDeckDesktop?.input; },
  async send(evs) { await DriveDeckDesktop.input(evs); },
  /** Page events, when real input isn't there (DriveGen) or not wanted. */
  fire(el, x, y, kinds, extra = {}) { const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, ...extra };
    for (const k of kinds) el.dispatchEvent(new (k.startsWith('pointer') ? PointerEvent : k === 'wheel' ? WheelEvent : MouseEvent)(k, o)); },

  /* ---------- Doing ---------- */
  async click(t, o = {}) {
    const el = await this.need(t), { x, y } = await this.point(el), n = o.double ? 2 : 1, button = o.right ? 'right' : 'left';
    if (typeof Peek !== 'undefined') Peek.tapAt = Date.now(); /* a person's tap: the screen opens (js/peek.js) */
    if (this.realNow) { await this.send({ type: 'mouseMove', x, y }); for (let c = 1; c <= n; c++) await this.send([{ type: 'mouseDown', x, y, button, clickCount: c }, { type: 'mouseUp', x, y, button, clickCount: c }]); }
    else { const tg = el; this.fire(tg, x, y, ['pointerdown', 'mousedown', 'pointerup', 'mouseup']); if (o.right) this.fire(tg, x, y, ['contextmenu'], { button: 2 }); else { if (tg.click) tg.click(); else this.fire(tg, x, y, ['click']); if (o.double) this.fire(tg, x, y, ['dblclick']); } }
    this.tapped(x, y); await this.sleep(this.pause / 2); return this.words(el).slice(0, 60) || 'clicked';
  },
  async type(t, text, o = {}) {
    const el = await this.need(t); if (this.secret(el)) throw new Error('That is a password, payment or one-time-code field: it isn’t typed into');
    await this.click(t); el.focus();
    if (o.clear !== false) { if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } else if (el.isContentEditable) el.textContent = ''; }
    for (const ch of String(text)) { if (this.realNow) await this.send({ type: 'char', keyCode: ch }); else { if ('value' in el) el.value += ch; else document.execCommand?.('insertText', false, ch); el.dispatchEvent(new Event('input', { bubbles: true })); } await this.sleep(this.opts.show ? 45 / (this.opts.speed || 1) : 0); }
    if (!this.realNow) el.dispatchEvent(new Event('change', { bubbles: true }));
    if (o.enter) await this.key('Enter', el);
    return `typed “${String(text).slice(0, 60)}”${o.enter ? ' and Enter' : ''}`;
  },
  async key(combo, el = document.activeElement) {
    const parts = String(combo).split('+'), key = parts.pop(), mods = parts.map(m => ({ ctrl: 'control', cmd: 'meta', meta: 'meta', alt: 'alt', shift: 'shift', option: 'alt' })[m.toLowerCase()] || m.toLowerCase());
    if (this.realNow) { await this.send({ type: 'keyDown', keyCode: key, modifiers: mods }); if (key === 'Enter' || (key.length === 1 && !mods.some(m => m === 'meta' || m === 'control'))) await this.send({ type: 'char', keyCode: key === 'Enter' ? '\r' : key, modifiers: mods }); await this.send({ type: 'keyUp', keyCode: key, modifiers: mods }); }
    else { const o = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, metaKey: mods.includes('meta'), ctrlKey: mods.includes('control'), altKey: mods.includes('alt'), shiftKey: mods.includes('shift') };
      (el || document.body).dispatchEvent(new KeyboardEvent('keydown', o)); (el || document.body).dispatchEvent(new KeyboardEvent('keyup', o)); if (key === 'Enter') el?.closest?.('form')?.requestSubmit?.(); }
    await this.sleep(this.pause / 3); return `pressed ${combo}`;
  },
  /** Scroll: t (what to scroll; default the page), dy/dx pixels, to: 'top' | 'bottom', until: a target to bring into view. */
  async scroll(t, o = {}) {
    if (o.until) { for (let i = 0; i < 40; i++) { if (this.find(o.until)) { await this.point(this.find(o.until)); return `scrolled to ${this.describe(o.until)}`; } await this.scroll(t, { dy: o.dy || 400 }); } throw new Error(`${this.describe(o.until)} didn't come into view`); }
    const el = t ? await this.need(t) : document.scrollingElement, box = t ? el : document.querySelector('.view.active .scroll, .view.active') || document.scrollingElement;
    const dy = o.to === 'bottom' ? box.scrollHeight : o.to === 'top' ? -box.scrollHeight : +o.dy || 400, dx = +o.dx || 0;
    if (this.realNow && t) { const { x, y } = await this.point(el); await this.send({ type: 'mouseWheel', x, y, deltaX: -dx, deltaY: -dy, canScroll: true }); }
    else box.scrollBy({ left: dx, top: dy, behavior: this.opts.show ? 'smooth' : 'auto' });
    await this.sleep(this.pause / 2); return `scrolled ${o.to || `${dy}px`}`;
  },
  async hover(t) { const el = await this.need(t), { x, y } = await this.point(el); if (this.realNow) await this.send({ type: 'mouseMove', x, y }); else this.fire(el, x, y, ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']); await this.sleep(this.pause / 2); return `over ${this.words(el).slice(0, 40)}`; },
  /** Drag t onto `to` (a target), or by { dx, dy }. */
  async drag(t, to, o = {}) {
    const el = await this.need(t), a = await this.point(el), dest = to ? await this.point(await this.need(to)) : { x: a.x + (+o.dx || 0), y: a.y + (+o.dy || 0) }, n = 12;
    if (this.realNow) { await this.send([{ type: 'mouseMove', x: a.x, y: a.y }, { type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 }]);
      for (let i = 1; i <= n; i++) { await this.send({ type: 'mouseMove', x: Math.round(a.x + (dest.x - a.x) * i / n), y: Math.round(a.y + (dest.y - a.y) * i / n), button: 'left' }); await this.sleep(25); }
      await this.send({ type: 'mouseUp', x: dest.x, y: dest.y, button: 'left', clickCount: 1 }); }
    else { const dt = new DataTransfer(); this.fire(el, a.x, a.y, ['pointerdown', 'mousedown']); el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const over = document.elementFromPoint(dest.x, dest.y) || document.body; for (const k of ['dragenter', 'dragover', 'drop']) over.dispatchEvent(new DragEvent(k, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dest.x, clientY: dest.y }));
      el.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); this.fire(over, dest.x, dest.y, ['pointermove', 'mousemove', 'pointerup', 'mouseup']); }
    if (this.opts.show) document.getElementById('museCur').style.transform = `translate(${dest.x - 4}px,${dest.y - 3}px)`;
    await this.sleep(this.pause / 2); return 'dragged';
  },
  /** A dropdown's option, by its words or value (the menu itself is the system's: the choice is set and announced). */
  async choose(t, option) {
    const el = await this.need(t); await this.point(el);
    if (el.tagName === 'SELECT') { const q = String(option).toLowerCase(), o = [...el.options].find(x => x.text.trim().toLowerCase() === q || x.value.toLowerCase() === q) || [...el.options].find(x => x.text.toLowerCase().includes(q));
      if (!o) throw new Error(`No “${option}” in ${this.describe(t)}`); el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return `chose “${o.text.trim()}”`; }
    await this.click(t); return this.click({ text: option, role: 'option' }).catch(() => this.click({ text: option })); /* a custom dropdown: open it, pick the option */
  },
  /** A checkbox or switch on or off. */
  async tick(t, on = true) { const el = await this.need(t), box = el.matches('input[type="checkbox"],[role="checkbox"],[role="switch"]') ? el : el.querySelector('input[type="checkbox"],[role="checkbox"],[role="switch"]') || el;
    const now = box.checked ?? box.getAttribute('aria-checked') === 'true'; if (now !== on) await this.click(box !== el && box.id ? { sel: `#${CSS.escape(box.id)}` } : t); return `${on ? 'ticked' : 'unticked'} ${this.describe(t)}`; },
  /** Wait until a target shows (gone: until it goes), up to ms. */
  async wait(t, o = {}) { const ms = +o.ms || 15000; for (const t0 = Date.now(); ; await this.sleep(250)) { const el = this.find(t); if (o.gone ? !el : el) return o.gone ? 'gone' : 'there'; if (Date.now() - t0 > ms) throw new Error(`${this.describe(t)} ${o.gone ? 'is still there' : 'didn’t show'} after ${Math.round(ms / 1000)} s`); } },
  /** What a target says (its words), or null if it isn't there. */
  look(t) { const el = this.find(t); return el ? this.words(el) : null; },

  /* ---------- In a page of the agent browser (the webview's own real input) ---------- */
  view(site) { const v = [...AgentWeb.views.values()].find(x => { try { return x.wv.getURL().includes(site); } catch { return false; } }); if (!v) throw new Error(`No page of “${site}” is open in the agent browser`); return v; },
  async webFind(site, t) { const v = this.view(site), r = await AgentWeb.call('exists', [{ sel: t.sel, text: t.text || t.label }], 6000, { view: v }); if (!r?.ok) throw new Error(`Nothing called ${this.describe(t)} on ${site}`);
    if (this.opts.show) { const was = AgentWeb.follow; AgentWeb.follow = true; AgentWeb.showing(v); AgentWeb.follow = was; await this.sleep(this.pause); } /* the page in the side panel while it's used */
    return { v, x: Math.round(r.rect.x + r.rect.w / 2), y: Math.round(r.rect.y + r.rect.h / 2) }; },
  async webClick(site, t, o = {}) { const { v, x, y } = await this.webFind(site, typeof t === 'string' ? { text: t } : t); const button = o.right ? 'right' : 'left';
    v.wv.sendInputEvent({ type: 'mouseMove', x, y }); for (let c = 1; c <= (o.double ? 2 : 1); c++) { v.wv.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: c }); v.wv.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: c }); }
    await this.sleep(this.pause / 2); return `clicked on ${site}`; },
  async webType(site, t, text, o = {}) { const tt = typeof t === 'string' ? { text: t } : t, v = this.view(site), f = await AgentWeb.call('focus', [{ sel: tt.sel, label: tt.label || tt.text }], 6000, { view: v }); if (!f?.ok) throw new Error(f?.error || `No field ${this.describe(tt)} on ${site}`);
    if (o.clear !== false) await AgentWeb.call('focus', [{ sel: tt.sel, label: tt.label || tt.text, clear: true }], 4000, { view: v }).catch(() => {});
    await AgentWeb.insert(String(text), { view: v }); if (o.enter) AgentWeb.key('Enter', { view: v }); await this.sleep(this.pause / 2); return `typed on ${site}`; },
  async webKey(site, combo) { AgentWeb.key(combo, { view: this.view(site) }); await this.sleep(this.pause / 3); return `pressed ${combo} on ${site}`; },
  async webScroll(site, o = {}) { const v = this.view(site); v.wv.sendInputEvent({ type: 'mouseWheel', x: 400, y: 300, deltaY: -(o.to === 'bottom' ? 20000 : o.to === 'top' ? -20000 : +o.dy || 400), canScroll: true }); await this.sleep(this.pause / 2); return `scrolled on ${site}`; },
  async webHover(site, t) { const { v, x, y } = await this.webFind(site, typeof t === 'string' ? { text: t } : t); v.wv.sendInputEvent({ type: 'mouseMove', x, y }); await this.sleep(this.pause / 2); return `over it on ${site}`; },
  async webLook(site, sel = 'body') { return (await AgentWeb.call('read', [sel, 20000], 15000, { view: this.view(site) }))?.text || ''; },

  /** One step as data (what scripts and MuseTester send): { do: 'click'|'type'|…, …target, web, text, enter… }. */
  async run(s, opts) {
    if (opts) Object.assign(this.opts, opts);
    const t = { text: s.target ?? (s.do === 'type' ? undefined : s.text), label: s.label, sel: s.sel, role: s.role, nth: s.nth, within: s.within }, web = s.web;
    if (web) return { click: () => this.webClick(web, t, s), type: () => this.webType(web, t, s.value ?? s.text, s), key: () => this.webKey(web, s.key), scroll: () => this.webScroll(web, s), hover: () => this.webHover(web, t), look: () => this.webLook(web, s.sel) }[s.do]?.() ?? Promise.reject(new Error(`No ${s.do} in a page`));
    switch (s.do) {
      case 'click': return this.click(t, s);
      case 'type': return this.type(t, s.value ?? '', s);
      case 'key': return this.key(s.key);
      case 'scroll': return this.scroll(t.text || t.sel || t.label ? t : null, { dy: s.dy, dx: s.dx, to: s.to, until: s.until });
      case 'hover': return this.hover(t);
      case 'drag': return this.drag(t, s.onto, s);
      case 'choose': return this.choose(t, s.option);
      case 'tick': return this.tick(t, s.on !== false);
      case 'wait': return this.wait(t, s);
      case 'look': return this.look(t);
      case 'caption': this.caption(s.value ?? s.text); return 'shown';
    }
    throw new Error(`RPA can't ${s.do}`);
  },

  /* ---------- Recording: what you do, as steps ---------- */
  record: {
    steps: [], on: false,
    /** The shortest way to find el again: its words if they're unique among clickables, its label, else a selector. */
    target(el) {
      const w = RPA.words(el).slice(0, 60), same = w && [...document.querySelectorAll(RPA.CLICKABLE)].filter(e => RPA.visible(e) && RPA.words(e) === w).length;
      if (w && same === 1 && w.length <= 50) return { target: w };
      const lab = el.getAttribute('aria-label') || el.placeholder; if (lab) return { label: lab };
      for (const a of ['data-wt', 'data-ag', 'data-qa', 'data-testid', 'data-id', 'name']) if (el.getAttribute(a)) return { sel: `[${a}="${CSS.escape(el.getAttribute(a))}"]` };
      if (el.id) return { sel: `#${CSS.escape(el.id)}` };
      return w ? { target: w, nth: [...document.querySelectorAll(RPA.CLICKABLE)].filter(e => RPA.visible(e) && RPA.words(e) === w).indexOf(el) + 1 } : { sel: el.tagName.toLowerCase() };
    },
    start() {
      if (this.on) return; this.on = true; this.steps = [];
      const H = this.h = {
        click: e => { const el = e.target.closest(RPA.CLICKABLE); if (!el || el.closest('#museRpa') || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/checkbox|radio|button|submit/.test(el.type)) return;
          this.steps.push(el.matches('input[type="checkbox"],[role="checkbox"],[role="switch"]') ? { do: 'tick', ...this.target(el), on: !!(el.checked ?? el.getAttribute('aria-checked') !== 'true') } : { do: 'click', ...this.target(el) }); },
        change: e => { const el = e.target; if (RPA.secret(el)) return; if (el.tagName === 'SELECT') return this.steps.push({ do: 'choose', ...this.target(el), option: el.options[el.selectedIndex]?.text.trim() });
          if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && !/checkbox|radio|button|submit/.test(el.type)) { const last = this.steps.at(-1), tg = this.target(el); if (last?.do === 'type' && JSON.stringify({ ...last, value: 0, enter: 0 }) === JSON.stringify({ ...tg, do: 'type', value: 0, enter: 0 })) last.value = el.value; else this.steps.push({ do: 'type', ...tg, value: el.value }); } },
        keydown: e => { if (e.key === 'Enter' && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !RPA.secret(e.target)) { H.change(e); const last = this.steps.at(-1); if (last?.do === 'type') last.enter = true; } },
      };
      for (const k of ['click', 'change', 'keydown']) document.addEventListener(k, H[k], true);
      RPA.caption('Recording: what you do becomes the test (MuseTester)');
    },
    stop() { if (!this.on) return this.steps; this.on = false; for (const k of ['click', 'change', 'keydown']) document.removeEventListener(k, this.h[k], true); RPA.caption(''); return this.steps; },
  },
};

/* The rpa.* actions: scripts (on Stage or anywhere) drive the app and its agent browser like a person, with the same engine as MuseTester.
   A step: { "do": "rpa.click", "value": "+ New watcher" } · { "do": "rpa.type", "value": "hello", "args": ["label=Message", "enter"] }
   args: sel=, label=, role=, nth=, within=, web=<site> (a page of the agent browser), and flags double, right, enter, show, slow. */
{
  const A = ev => { const o = {}, flags = []; for (const a of [].concat(ev?.args || [])) { const m = String(a).match(/^(\w+)=(.*)$/); if (m) o[m[1]] = m[2]; else flags.push(String(a)); } for (const f of flags) o[f] = true; return o; };
  const def = (id, name, arg, fn) => Actions.define(id, { group: 'Automation', name, arg, async run(v, say, ev) { const a = A(ev); RPA.opts.show = !!(a.show || (typeof Stage !== 'undefined' && Stage.on)); if (a.slow) RPA.opts.speed = 0.6; return fn(v, a); } });
  def('rpa.click', 'Click something (by its words; sel=, label=, web=site)', 'Its words', (v, a) => RPA.run({ do: 'click', target: v || undefined, ...a }));
  def('rpa.type', 'Type into a field (label= or sel=; enter)', 'The text', (v, a) => RPA.run({ do: 'type', value: v, ...a }));
  def('rpa.key', 'Press a key (Enter, Escape, Meta+K…)', 'The key', (v, a) => RPA.run({ do: 'key', key: v, ...a }));
  def('rpa.scroll', 'Scroll (to=top|bottom, dy=, until=words)', 'What to scroll (empty: the screen)', (v, a) => RPA.run({ do: 'scroll', target: v || undefined, ...a }));
  def('rpa.hover', 'Point at something', 'Its words', (v, a) => RPA.run({ do: 'hover', target: v, ...a }));
  def('rpa.drag', 'Drag something onto another (onto=words) or by dx=/dy=', 'Its words', (v, a) => RPA.run({ do: 'drag', target: v, ...a, onto: a.onto ? { text: a.onto } : null }));
  def('rpa.choose', 'Choose in a dropdown (option=)', 'The dropdown (its words or label=)', (v, a) => RPA.run({ do: 'choose', target: v || undefined, ...a }));
  def('rpa.tick', 'Tick a checkbox (off: untick)', 'Its words', (v, a) => RPA.run({ do: 'tick', target: v, on: !a.off, ...a }));
  def('rpa.wait', 'Wait until something shows (gone: until it goes)', 'Its words', (v, a) => RPA.run({ do: 'wait', target: v, ...a }));
  def('rpa.look', 'Read what something says (keep it with as)', 'Its words', (v, a) => RPA.run({ do: 'look', target: v, ...a }));
}
