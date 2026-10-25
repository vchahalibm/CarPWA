/* DriveDeck bridge: lets DriveDeck record and replay clicks on YOUR web page when it is shown in a DriveDeck web widget.
   Add it to your own page with one line, naming the DriveDeck address(es) allowed to drive it:

     <script src="drivedeck-bridge.js" data-allow="https://vchahalibm.github.io app://drivedeck"></script>

   Only the page's own origin and the origins in data-allow are listened to; any other page that embeds yours is ignored.
   Pages served from the same address as DriveDeck (like samples/demo-page.html) don't need it: DriveDeck uses the same
   code directly. Nothing is sent anywhere: messages go only to the DriveDeck window showing the page.
   Licence: same as DriveDeck. */
(function () {
  'use strict';
  const INTERACTIVE = 'a,button,input,select,textarea,summary,label,[role=button],[role=tab],[role=link],[role=menuitem],[role=checkbox],[role=switch],[role=option],[data-testid],[onclick]';
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  /** The recorder/player for one document. `send(msg)` reports recorded steps. */
  function create(doc, win, send) {
    const css = (el) => {
      if (el.id && doc.querySelectorAll('#' + win.CSS.escape(el.id)).length === 1) return '#' + win.CSS.escape(el.id);
      const parts = [];
      for (let e = el; e && e.nodeType === 1 && e !== doc.body && parts.length < 7; e = e.parentElement) {
        let p = e.tagName.toLowerCase();
        if (e.id && doc.querySelectorAll('#' + win.CSS.escape(e.id)).length === 1) { parts.unshift('#' + win.CSS.escape(e.id)); break; }
        const sib = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
        if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
        parts.unshift(p);
      }
      return parts.join(' > ');
    };
    /** Several ways to find an element again, best first, so a replay survives the page changing a little. */
    const locate = el => {
      const r = el.getBoundingClientRect();
      return { testid: el.getAttribute('data-testid') || '', id: el.id || '', css: css(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
        text: clean(/^(input|textarea|select)$/i.test(el.tagName) ? label(el) : el.innerText || el.getAttribute('aria-label') || el.title || el.value || ''), name: el.getAttribute('name') || '',
        x: +((r.left + r.width / 2) / win.innerWidth).toFixed(3), y: +((r.top + r.height / 2) / win.innerHeight).toFixed(3),
        w: +(r.width / win.innerWidth).toFixed(3), h: +(r.height / win.innerHeight).toFixed(3), type: el.type || '' };
    };
    // A field is known by its label, not by what's typed in it.
    const label = el => el.getAttribute('aria-label') || el.placeholder || (el.id && doc.querySelector(`label[for="${win.CSS.escape(el.id)}"]`)?.innerText) || el.closest('label')?.innerText || el.title || '';
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const find = L => {
      const q = s => { try { return doc.querySelector(s); } catch { return null; } };
      if (L.testid) { const e = q(`[data-testid="${win.CSS.escape(L.testid)}"]`); if (e) return { el: e, how: 'testid' }; }
      if (L.id) { const e = doc.getElementById(L.id); if (e) return { el: e, how: 'id' }; }
      if (L.css) { const e = q(L.css); if (e && (!L.text || /^(input|textarea|select)$/.test(L.tag) || clean(e.innerText || e.value || '') === L.text)) return { el: e, how: 'css' }; }
      if (L.text) {
        const e = [...doc.querySelectorAll(L.tag || INTERACTIVE)].find(x => visible(x) && clean(/^(input|textarea|select)$/i.test(x.tagName) ? label(x) : x.innerText || x.getAttribute('aria-label') || x.value || '') === L.text);
        if (e) return { el: e, how: 'text' };
      }
      if (L.name) { const e = q(`[name="${win.CSS.escape(L.name)}"]`); if (e) return { el: e, how: 'name' }; }
      // Last: the same kind of control at the same place (never the page itself: better to stop than click the wrong thing).
      if (L.x != null) { const e = doc.elementFromPoint(L.x * win.innerWidth, L.y * win.innerHeight)?.closest(INTERACTIVE); if (e && (!L.tag || e.tagName.toLowerCase() === L.tag)) return { el: e, how: 'position' }; }
      return null;
    };
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vw: win.innerWidth, vh: win.innerHeight }; };
    const here = () => win.location.pathname.split('/').pop() + win.location.search + win.location.hash;

    // Passwords, payment details and one-time codes: never recorded, never typed by a replay (it waits for you).
    const secret = el => el.type === 'password' || /^(cc-|current-password|new-password|one-time-code)/.test(el.autocomplete || '')
      || /pass|pin|otp|card|cvv|cvc|secret|token|iban|ssn|security.?code/i.test(el.name + ' ' + el.id + ' ' + (el.autocomplete || '') + ' ' + (el.getAttribute('aria-label') || ''));
    let rec = false, pending = null;
    const step = (s, el) => {
      const from = here(); s.at = from;
      // What changed after it (a new address or #tab), so a replay can check it worked.
      clearTimeout(pending); pending = setTimeout(() => { const to = here(); if (to !== from) send({ type: 'expect', expect: to }); }, 700);
      send({ type: 'step', step: s, rect: el && rect(el) });
    };
    const onClick = e => {
      if (!rec || !e.isTrusted) return;
      const el = e.target.closest?.(INTERACTIVE) || e.target;
      if (/^(input|textarea|select)$/i.test(el.tagName) && !/^(checkbox|radio|button|submit|reset)$/i.test(el.type || '')) return; // typed, below
      step({ t: 'click', loc: locate(el) }, el);
    };
    const onChange = e => {
      if (!rec || !e.isTrusted) return;
      const el = e.target; if (!/^(input|textarea|select)$/i.test(el.tagName) || /^(checkbox|radio|button|submit|reset)$/i.test(el.type || '')) return;
      step({ t: 'type', loc: locate(el), value: secret(el) ? '' : el.value, secret: secret(el) }, el); // passwords, card numbers and codes are never recorded
    };
    // Did real input arrive (desktop replays check before and after clicking)
    let clickedAt = 0, movedAt = 0; const onAny = e => { if (e.isTrusted) clickedAt = Date.now(); }, onMove = e => { if (e.isTrusted) movedAt = Date.now(); };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('click', onAny, true);
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('change', onChange, true);

    const wait = ms => new Promise(r => setTimeout(r, ms));
    return {
      version: 1,
      ping: () => ({ ok: true, url: here(), title: doc.title }),
      record(on) { rec = !!on; return { ok: true, url: here() }; },
      find(L) { const f = find(L); return f ? { ok: true, how: f.how, rect: rect(f.el) } : { ok: false, error: 'not found' }; },
      /** Visible text on the page that reads `t` (whole text first, then part of a longer one, nearest the top): the middle of
          those words, scrolled into view. For script steps that act on "text on screen". */
      findText(t) {
        const q = clean(t).toLowerCase(); if (!q) return { ok: false };
        const hits = [], w = doc.createTreeWalker(doc.body, 4);
        for (let n; (n = w.nextNode());) {
          const v = n.nodeValue || '', lv = v.replace(/\s+/g, ' ').toLowerCase(), i = lv.indexOf(q); if (i < 0) continue;
          const el = n.parentElement; if (!el || !visible(el) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
          const st = win.getComputedStyle(el); if (st.visibility === 'hidden' || +st.opacity === 0) continue;
          hits.push({ el, exact: clean(el.innerText || '').toLowerCase() === q, len: lv.trim().length });
        }
        for (const el of doc.querySelectorAll('[aria-label],[title],[placeholder],input[type=button],input[type=submit]'))
          if (visible(el) && clean(el.getAttribute('aria-label') || el.title || el.placeholder || el.value).toLowerCase().includes(q)) hits.push({ el, exact: true, len: q.length });
        if (!hits.length) return { ok: false, error: 'not found' };
        hits.sort((a, b) => (b.exact - a.exact) || (a.len - b.len));
        const el = hits[0].el.closest(INTERACTIVE) || hits[0].el;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return { ok: true, how: 'text', rect: rect(el), text: clean(el.innerText || el.value || '') };
      },
      /** For agent tasks: the text of the first selector (comma list, tried in order) that has some; each matching element
          is one line (its aria-label when it has one, as list rows often do). The whole page as a last resort. */
      read(sels, max = 6000) {
        for (const s of [].concat(sels || []).flatMap(x => String(x).split('||'))) {
          let els = []; try { els = [...doc.querySelectorAll(s.trim())].filter(visible); } catch {}
          // the longer of the visible text and the label: list rows often carry a full summary in their label, while a message
          // area's label is just its name (“Message body”) and the text is what matters
          // (WhatsApp keeps a message's time and sender in data-pre-plain-text, outside the text: put it in front)
          const lines = els.map(e => { const t = (e.innerText || '').replace(/\s+/g, ' ').trim(), l = (e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), pre = e.getAttribute('data-pre-plain-text') || e.querySelector?.('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || ''; return pre + (l.length > t.length ? l : t); }).filter(Boolean);
          if (lines.length) return { ok: true, sel: s.trim(), text: lines.join('\n').slice(0, max), url: win.location.href, title: doc.title };
        }
        return { ok: true, sel: 'body', text: (doc.body?.innerText || '').replace(/\n\s*\n+/g, '\n').slice(0, max), url: win.location.href, title: doc.title };
      },
      /** Teaching an agent task: the next element you click is picked, not clicked (outlined while you hover), and returned
          with a selector to read it by. Times out after `ms`. */
      pick(ms = 120000) {
        return new Promise(res => {
          let hov = null; const prev = [];
          const mark = e => { const el = e.target; if (hov === el) return; if (hov) hov.style.outline = prev.pop() || ''; hov = el; prev.push(el.style.outline); el.style.outline = '3px solid #ff375f'; };
          const done = r => { doc.removeEventListener('mouseover', mark, true); doc.removeEventListener('click', take, true); if (hov) hov.style.outline = prev.pop() || ''; clearTimeout(t); res(r); };
          const take = e => { e.preventDefault(); e.stopPropagation(); const el = e.target.closest('[role=main],[role=listbox],[role=list],[role=document],article,section,main,table,ul,ol') || e.target;
            done({ ok: true, css: css(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', text: clean(el.innerText || '') }); };
          doc.addEventListener('mouseover', mark, true); doc.addEventListener('click', take, true);
          const t = setTimeout(() => done({ ok: false, error: 'Nothing picked' }), ms);
        });
      },
      /** Wait until a selector (comma list) or a text shows, up to `ms`. */
      async waitFor(o = {}, ms = 15000) {
        const t0 = Date.now(), q = clean(o.text || '').toLowerCase();
        for (;;) {
          let hit = false;
          if (o.sel) { try { hit = [...doc.querySelectorAll(o.sel)].some(visible); } catch {} }
          if (!hit && q) hit = (doc.body?.innerText || '').toLowerCase().includes(q);
          if (hit) return { ok: true, url: win.location.href };
          if (Date.now() - t0 > ms) return { ok: false, error: 'not there', url: win.location.href };
          await wait(300);
        }
      },
      /** Focus a field found by its label, placeholder or a selector (never a secret field), for real typing. */
      focus(o = {}) {
        let el = null; const q = clean(o.label || '').toLowerCase();
        if (o.sel) { try { el = [...doc.querySelectorAll(o.sel)].find(visible); } catch {} }
        if (!el && q) el = [...doc.querySelectorAll('input,textarea,[contenteditable=true],[contenteditable=""],[role=textbox],[role=combobox],[role=searchbox]')].find(e => visible(e) && clean(label(e) || e.getAttribute('aria-label') || '').toLowerCase().includes(q));
        if (!el) return { ok: false, error: `No field “${o.label || o.sel}” on the page` };
        if (secret(el)) return { ok: false, error: 'That is a password, payment or code field: type it yourself' };
        el.scrollIntoView({ block: 'center' }); el.focus(); el.click?.();
        if (el.select && o.clear !== false) el.select();
        return { ok: true, rect: rect(el) };
      },
      /** Click the first visible element of a selector (comma list), or the control whose text, label or title reads `text`. */
      async clickOn(o = {}) {
        let el = null;
        // a selector and a text: the match of the selector whose text (or label) has those words, e.g. a channel by name
        const words = x => clean(x.innerText || x.getAttribute('aria-label') || x.title || x.value || '').toLowerCase();
        if (o.sel) { try { const m = [...doc.querySelectorAll(o.sel)].filter(visible), q = clean(o.text || '').toLowerCase(); el = q ? m.find(x => words(x) === q) || m.find(x => words(x).includes(q)) : m[0]; } catch {} }
        if (!el && o.text) { const f = this.findText(o.text); if (f.ok) { const q = clean(o.text).toLowerCase(); el = [...doc.querySelectorAll(INTERACTIVE)].filter(visible).sort((a, b) => clean(a.innerText || '').length - clean(b.innerText || '').length).find(e => clean(e.innerText || e.getAttribute('aria-label') || e.title || e.value || '').toLowerCase().includes(q)); } }
        if (!el) return { ok: false, error: `Nothing called “${o.text || o.sel}” on the page` };
        el.scrollIntoView({ block: 'center' }); await wait(150);
        const r = el.getBoundingClientRect(), pt = { bubbles: true, cancelable: true, view: win, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (t.startsWith('pointer') && win.PointerEvent ? win.PointerEvent : win.MouseEvent)(t, pt));
        el.click();
        return { ok: true, rect: rect(el), text: clean(el.innerText || el.getAttribute('aria-label') || '') };
      },
      /** Find a step's element and bring it into view (a field: focused, its text selected, ready to be typed over). */
      async prepare(s, opts = {}) {
        let f = null;
        for (let i = 0; i < 20 && !f; i++) { f = find(s.loc); if (!f) await wait(150); } // the page may still be drawing
        if (!f) return { ok: false, error: `Couldn’t find ${s.loc.text ? '“' + s.loc.text + '”' : 'the ' + (s.loc.tag || 'element')} on the page` };
        const el = f.el;
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: opts.quiet ? 'auto' : 'smooth' });
        await wait(opts.quiet ? 0 : 350);
        if (s.t === 'type' && !s.secret && !secret(el) && el.tagName !== 'SELECT') { el.focus(); el.select?.(); }
        return { ok: true, how: f.how, rect: rect(el), tag: el.tagName.toLowerCase(), secret: s.t === 'type' && (s.secret || secret(el)) };
      },
      /** Whether a real click reached the page since `t` (Date.now() of the sender's clock, same machine). */
      clicked(t) { return { ok: clickedAt >= t, moved: movedAt >= t }; },
      /** After a step: wait for what should change (a new address or #tab). */
      async verify(s) {
        if (s.expect) for (let i = 0; i < 20 && here() !== s.expect; i++) await wait(150);
        return { ok: !s.expect || here() === s.expect, url: here(), error: s.expect && here() !== s.expect ? `Expected the page to show ${s.expect}` : '' };
      },
      /** Replay one step: find it, bring it into view, act like a person would, then check what should change. */
      async play(s, opts = {}) {
        const p = await this.prepare(s, opts); if (!p.ok) return p;
        const el = find(s.loc).el, f = { how: p.how }, r = p.rect;
        if (s.t === 'click') {
          const pt = { bubbles: true, cancelable: true, view: win, clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (t.startsWith('pointer') && win.PointerEvent ? win.PointerEvent : win.MouseEvent)(t, pt));
          el.click();
        } else if (s.t === 'type') {
          if (p.secret) return { ok: false, error: 'This step is a password, payment or code field: type it yourself', rect: r, secret: true };
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, s.value); // works with frameworks that track the value
          el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true }));
        }
        if (s.expect) for (let i = 0; i < 20 && here() !== s.expect; i++) await wait(150);
        return { ok: !s.expect || here() === s.expect, how: f.how, rect: r, url: here(), error: s.expect && here() !== s.expect ? `Expected the page to show ${s.expect}` : '' };
      },
      stop() { rec = false; doc.removeEventListener('click', onClick, true); doc.removeEventListener('click', onAny, true); doc.removeEventListener('mousemove', onMove, true); doc.removeEventListener('change', onChange, true); },
    };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.DriveDeckBridge = api;
  // Inside a page shown by DriveDeck on another origin: answer DriveDeck's messages (only from allowed origins).
  if (typeof window === 'undefined' || window.parent === window || window.DriveDeckBridgeNoAuto) return;
  const me = document.currentScript, allow = new Set([location.origin, ...String(me?.getAttribute('data-allow') || '').split(/\s+/).filter(Boolean)]);
  let b = null, parentOrigin = null;
  const send = m => parentOrigin && window.parent.postMessage({ dd: 'bridge', ...m }, parentOrigin);
  window.addEventListener('message', async e => {
    const m = e.data; if (!m || m.dd !== 'drive' || e.source !== window.parent) return;
    if (!allow.has(e.origin)) { e.source.postMessage({ dd: 'bridge', id: m.id, ok: false, error: `This page doesn’t allow ${e.origin} to drive it (add it to data-allow)` }, e.origin); return; }
    parentOrigin = e.origin; b ||= create(document, window, send);
    let r; try { r = await b[m.op](...(m.args || [])); } catch (err) { r = { ok: false, error: String(err && err.message || err) }; }
    send({ id: m.id, ...r });
  });
})();
