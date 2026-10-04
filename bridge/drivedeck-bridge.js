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
        x: +((r.left + r.width / 2) / win.innerWidth).toFixed(3), y: +((r.top + r.height / 2) / win.innerHeight).toFixed(3) };
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
      if (L.x != null) { const e = doc.elementFromPoint(L.x * win.innerWidth, L.y * win.innerHeight); if (e) return { el: e.closest(INTERACTIVE) || e, how: 'position' }; }
      return null;
    };
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vw: win.innerWidth, vh: win.innerHeight }; };
    const here = () => win.location.pathname.split('/').pop() + win.location.search + win.location.hash;

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
      const secret = el.type === 'password' || /pass|pin|otp|card|cvv|secret|token/i.test(el.name + el.id + (el.autocomplete || ''));
      step({ t: 'type', loc: locate(el), value: secret ? '' : el.value, secret }, el); // passwords are never recorded
    };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('change', onChange, true);

    const wait = ms => new Promise(r => setTimeout(r, ms));
    return {
      version: 1,
      ping: () => ({ ok: true, url: here(), title: doc.title }),
      record(on) { rec = !!on; return { ok: true, url: here() }; },
      find(L) { const f = find(L); return f ? { ok: true, how: f.how, rect: rect(f.el) } : { ok: false, error: 'not found' }; },
      /** Replay one step: find it, bring it into view, act like a person would, then check what should change. */
      async play(s, opts = {}) {
        let f = null;
        for (let i = 0; i < 20 && !f; i++) { f = find(s.loc); if (!f) await wait(150); } // the page may still be drawing
        if (!f) return { ok: false, error: `Couldn’t find ${s.loc.text ? '“' + s.loc.text + '”' : 'the ' + (s.loc.tag || 'element')} on the page` };
        const el = f.el;
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: opts.quiet ? 'auto' : 'smooth' });
        await wait(opts.quiet ? 0 : 350);
        const r = rect(el);
        if (s.t === 'click') {
          const pt = { bubbles: true, cancelable: true, view: win, clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (t.startsWith('pointer') && win.PointerEvent ? win.PointerEvent : win.MouseEvent)(t, pt));
          el.click();
        } else if (s.t === 'type') {
          if (s.secret) return { ok: false, error: 'This step is a password field: type it yourself', rect: r, secret: true };
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, s.value); // works with frameworks that track the value
          el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true }));
        }
        if (s.expect) for (let i = 0; i < 20 && here() !== s.expect; i++) await wait(150);
        return { ok: !s.expect || here() === s.expect, how: f.how, rect: r, url: here(), error: s.expect && here() !== s.expect ? `Expected the page to show ${s.expect}` : '' };
      },
      stop() { rec = false; doc.removeEventListener('click', onClick, true); doc.removeEventListener('change', onChange, true); },
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
