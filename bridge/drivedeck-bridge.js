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
        w: +(r.width / win.innerWidth).toFixed(3), h: +(r.height / win.innerHeight).toFixed(3), type: el.type || '', row: rowOf(el) };
    };
    /** An element's words: its rendered text, else (rendering skipped: a hidden window, WhatsApp's off-screen rows) its
        text pieces, one per line. innerText alone came back empty in a watcher's hidden window, so lists read as empty. */
    const textOf = e => { if (!e) return ''; const t = e.innerText; if (t && t.trim()) return t; const out = [], w = doc.createTreeWalker(e, 4);
      for (let n; (n = w.nextNode());) { const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement?.tagName || '') && !n.parentElement?.closest('svg')) out.push(v); } return out.join('\n'); }; /* not icons' names (an SVG's title) */
    /** Pieces that are an icon's name, not words (WhatsApp: ic-group-filled, wds-ic-disappearing-messages, default-user). */
    const ICON_WORD = /^(wds-)?ic-[a-z0-9-]+$|^default-(user|group|contact)s?$|^[a-z]+(-[a-z0-9]+){2,}$/;
    /** The repeated item a node is in, found by shape (sites drop their row roles): the nearest ancestor that has 3+
        look-alike siblings (same tag, mostly the same classes) and is row-sized (at least 24 px high, under half the
        window, 40%+ of its parent's width), and a selector for all of them (the parent's, then the tag). */
    const sameish = (a, b) => { const A = new Set(a.classList), B = [...b.classList]; if (!A.size && !B.length) return true; return B.filter(c => A.has(c)).length >= Math.max(1, Math.min(A.size, B.length) * 0.5); };
    const rowSized = (e, p) => { const r = e.getBoundingClientRect(), q = p.getBoundingClientRect(); return r.height >= 24 && r.height < Math.max(win.innerHeight * 0.5, 160) && r.width >= q.width * 0.4; };
    const groupOf = el => {
      for (let e = el; e && e !== doc.body && e.parentElement; e = e.parentElement) {
        const p = e.parentElement, like = [...p.children].filter(x => x.tagName === e.tagName && sameish(x, e) && visible(x));
        if (like.length >= 3 && rowSized(e, p)) { const role = e.getAttribute('role'); return { el: e, n: like.length, css: `${css(p)} > ${e.tagName.toLowerCase()}${role ? `[role="${role}"]` : ''}` }; }
      }
      return null;
    };
    /** The biggest list of look-alike rows inside an area (a template's fallback when a site renames its rows). */
    const rowsIn = scope => {
      const root = (() => { try { return doc.querySelector(scope); } catch { return null; } })(); if (!root) return null;
      let best = null;
      for (const p of [root, ...root.querySelectorAll('*')].slice(0, 9000)) {
        const kids = [...p.children].filter(visible); if (kids.length < 3) continue;
        const tag = kids[0].tagName, like = kids.filter(x => x.tagName === tag && sameish(x, kids[0]) && rowSized(x, p));
        if (like.filter(x => clean(textOf(x) || x.textContent || '')).length < like.length / 2) continue; /* rows, not empty boxes (some rows report no text while off-screen) */
        if (like.length >= 3 && (!best || like.length > best.n)) best = { n: like.length, css: `${css(p)} > ${tag.toLowerCase()}` };
      }
      return best;
    };
    /** Words as shapes, for diagnosing a page without its contents: “Varun Chahal 10:05” → “Aaaaa Aaaaaa 99:99”. */
    const shape = t => clean(t).slice(0, 60).replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9').replace(/[^\sAa9.,:;!?()\-–—/@#&%+*'"’“”|·•✓]/gu, 'x');
    const safeId = id => id && !/\d{4,}|[A-Za-z0-9+/=]{24,}/.test(id) ? id : id ? '(id)' : '';
    /** How a selector list fares on this page: per choice, matches and visible ones, and the first lines as shapes. */
    const trial = sels => String(sels || '').split('||').map(x => x.trim()).filter(Boolean).map(s0 => {
      const g = /^rows-in:/.test(s0) && rowsIn(s0.slice(8).trim()), sel = g ? g.css : /^rows-in:/.test(s0) ? null : s0;
      let all = []; try { all = sel ? [...doc.querySelectorAll(sel)] : []; } catch { return { sel: s0, error: 'not a valid selector' }; }
      const vis = all.filter(visible);
      return { sel: s0, ...(g ? { found: g.css, n: g.n } : {}), ...(/^rows-in:/.test(s0) && !g ? { found: null } : {}), matches: all.length, visible: vis.length, first: vis.slice(0, 3).map(e => shape(textOf(e) || e.getAttribute('aria-label') || '')) };
    });
    /** The page's skeleton for “Diagnose this page”: tags, ids, classes, roles, test ids, sizes, look-alike siblings, and
        words only as shapes (aria-labels too); long runs of look-alike rows keep 3 and say how many more. At most `max`
        nodes, deeper inside `focus` (selectors), shallower elsewhere. Nothing the page says leaves it. */
    const skeleton = (focus, max = 2500) => {
      let count = 0; const inFocus = new Set(); for (const f of String(focus || '').split('||').map(x => x.trim()).filter(Boolean)) { try { doc.querySelectorAll(f).forEach(e => inFocus.add(e)); } catch {} }
      const near = el => [...inFocus].some(f => f.contains(el) || el.contains(f));
      const node = (el, depth) => {
        if (count++ > max) return null;
        const r = el.getBoundingClientRect(), own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').trim();
        const kids = [...el.children].filter(k => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path|LINK|META)$/i.test(k.tagName));
        const o = { t: el.tagName.toLowerCase(), ...(safeId(el.id) ? { id: safeId(el.id) } : {}), ...(el.classList.length ? { c: [...el.classList].slice(0, 6).join(' ') } : {}), ...(el.getAttribute('role') ? { r: el.getAttribute('role') } : {}),
          ...(el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-tid') ? { tid: el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-tid') } : {}),
          ...(el.getAttribute('aria-label') ? { a: shape(el.getAttribute('aria-label')) } : {}), ...(own ? { tx: shape(own) } : {}), ...(el.isContentEditable && el.getAttribute('contenteditable') ? { edit: 1 } : {}),
          b: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], ...(r.width === 0 || r.height === 0 ? { hidden: 1 } : {}), n: kids.length };
        const limit = near(el) ? 40 : 7; if (depth >= limit || !kids.length) return o;
        const out = []; let i = 0;
        while (i < kids.length) { /* runs of look-alike siblings: 3 kept, the rest counted */
          let j = i + 1; while (j < kids.length && kids[j].tagName === kids[i].tagName && sameish(kids[j], kids[i])) j++;
          for (const k of kids.slice(i, Math.min(j, i + 3))) { const c = node(k, depth + 1); if (c) out.push(c); }
          if (j - i > 3) out.push({ more: j - i - 3, like: kids[i].tagName.toLowerCase() + (kids[i].classList.length ? '.' + [...kids[i].classList].slice(0, 2).join('.') : '') });
          i = j;
        }
        o.k = out; return o;
      };
      return node(doc.body, 0);
    };
    /** The list row a click was in (a chat, a mail, a channel): its name (first line) and a selector for every row, so it
        can be found again by name (teaching a watcher: “Varun's chat”, wherever it is in the list). */
    const rowOf = el => { const g = !el.closest('[role=listitem],[role=row],[role=option],[role=treeitem],li,tr') && groupOf(el), rw = g ? g.el : el.closest('[role=listitem],[role=row],[role=option],[role=treeitem],li,tr'); if (!rw) return null;
      if (g) return { name: clean((textOf(rw) || '').split('\n').map(s => s.trim()).find(Boolean) || ''), css: g.css };
      return { name: clean((textOf(rw) || rw.getAttribute('aria-label') || '').split('\n').map(s => s.trim()).find(Boolean) || ''), css: css(rw).replace(/:nth-of-type\(\d+\)(?!.*:nth-of-type)/, '') }; };
    // A field is known by its label, not by what's typed in it.
    const label = el => el.getAttribute('aria-label') || el.placeholder || (el.id && doc.querySelector(`label[for="${win.CSS.escape(el.id)}"]`)?.innerText) || el.closest('label')?.innerText || el.title || '';
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const find = L => {
      const q = s => { try { return doc.querySelector(s); } catch { return null; } };
      if (L.testid) { const e = q(`[data-testid="${win.CSS.escape(L.testid)}"]`); if (e) return { el: e, how: 'testid' }; }
      if (L.id) { const e = doc.getElementById(L.id); if (e) return { el: e, how: 'id' }; }
      if (L.css) { const e = q(L.css); if (e && (!L.text || /^(input|textarea|select)$/.test(L.tag) || clean(textOf(e) || e.value || '') === L.text)) return { el: e, how: 'css' }; }
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
    let rec = false, pending = null, obs = null, obsT = 0, pickEnd = null;
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
      /** Diagnose this page: where it is (no query string), signs of a sign-in or “open in another window”, each selector
          list tried, and the skeleton (words as shapes). */
      diagnose(o = {}) {
        const body = (textOf(doc.body) || '').slice(0, 4000);
        return { ok: true, url: win.location.origin + win.location.pathname, title: shape(doc.title), size: [win.innerWidth, win.innerHeight], ready: doc.readyState, elements: doc.getElementsByTagName('*').length,
          signs: { anotherWindow: /open in another window/i.test(body), useHere: /use here/i.test(body), signIn: /scan the qr|link with phone|log into|sign in to|sign in with|enter your (email|password)/i.test(body), robot: /captcha|not a robot|unusual traffic/i.test(body), loading: /loading|connecting/i.test(body.slice(0, 300)) },
          trials: [].concat(o.selectors || []).map(x => ({ for: x.for || '', results: trial(x.sel) })), skeleton: skeleton(o.focus, o.max || 2500) };
      },
      /** The selector tester: outline what a selector list matches (the first choice that matches), with the count and the
          first lines (on your own screen, so as they are); off clears the outlines. */
      highlight(sel, on = true) {
        for (const e of doc.querySelectorAll('[data-dd-hl]')) { e.style.outline = e.dataset.ddHl === '-' ? '' : e.dataset.ddHl; e.removeAttribute('data-dd-hl'); }
        if (!on) return { ok: true };
        const t = trial(sel), hit = t.find(x => x.visible); if (!hit) return { ok: true, n: 0, trials: t };
        const css = hit.found || hit.sel, els = [...doc.querySelectorAll(css)].filter(visible);
        els.forEach(e => { e.dataset.ddHl = e.style.outline || '-'; e.style.outline = '2px solid #34c759'; }); els[0]?.scrollIntoView({ block: 'nearest' });
        return { ok: true, n: els.length, used: hit.sel, css, lines: els.slice(0, 4).map(e => clean(textOf(e) || e.getAttribute('aria-label') || '')), trials: t };
      },
      /** A watcher's part, for a picture of it (js/watch.js, visual changes): where the first visible match is. */
      rect(sel) { for (const s of String(sel || '').split('||')) { let el = null; try { el = [...doc.querySelectorAll(s.trim())].find(visible); } catch {} if (el) { el.scrollIntoView({ block: 'nearest' }); return { ok: true, rect: rect(el) }; } } return { ok: false, error: 'not found' }; },
      /** What is at a point (a watcher finding its part again by its words or the screen model): its selector and text;
          row: the list row it's in, with the row's position taken out so it matches every row. */
      cssAt(x, y, row) {
        let el = doc.elementFromPoint(x, y); if (!el) return { ok: false };
        if (row) el = el.closest('[role=listitem],[role=row],[role=option],[role=treeitem],[role=article],li,article,tr') || el;
        let c = css(el); if (row) c = c.replace(/:nth-of-type\(\d+\)(?!.*:nth-of-type)/, '');
        return { ok: true, css: c, text: clean(textOf(el) || el.getAttribute('aria-label') || '') };
      },
      /** A watcher keeping this page open (js/watch.js): tells when the part it reads changes (at most every 2 s), so it
          checks within seconds instead of on its schedule. Nothing leaves the page but “changed”. */
      observe(sel, on = true) {
        obs?.disconnect(); obs = null; clearTimeout(obsT); obsT = 0; if (!on) return { ok: true };
        const sels = String(sel || 'body').split('||').map(s => s.trim()).filter(Boolean);
        const hits = n => sels.some(s => { try { return !!(n.closest(s) || n.querySelector?.(s)); } catch { return false; } });
        obs = new win.MutationObserver(ms => { if (obsT || !ms.some(m => { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; return n && hits(n); })) return;
          obsT = setTimeout(() => { obsT = 0; send({ type: 'changed', sel, url: here() }); }, 2000); });
        obs.observe(doc.body, { childList: true, subtree: true, characterData: true });
        return { ok: true };
      },
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
          hits.push({ el, exact: clean(textOf(el) || '').toLowerCase() === q, len: lv.trim().length });
        }
        for (const el of doc.querySelectorAll('[aria-label],[title],[placeholder],input[type=button],input[type=submit]'))
          if (visible(el) && clean(el.getAttribute('aria-label') || el.title || el.placeholder || el.value).toLowerCase().includes(q)) hits.push({ el, exact: true, len: q.length });
        if (!hits.length) return { ok: false, error: 'not found' };
        hits.sort((a, b) => (b.exact - a.exact) || (a.len - b.len));
        const el = hits[0].el.closest(INTERACTIVE) || hits[0].el;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return { ok: true, how: 'text', rect: rect(el), text: clean(textOf(el) || el.value || '') };
      },
      /** For agent tasks: the text of the first selector (comma list, tried in order) that has some; each matching element
          is one line (its aria-label when it has one, as list rows often do). The whole page as a last resort. */
      /** All the words in the first match of sel, folded parts too (a route's turn-by-turn steps that Google Maps keeps
          collapsed): text pieces, a repeat of the one before left out. */
      words(sel, max = 20000) {
        let el = null; for (const s of String(sel || '').split('||')) { try { el = doc.querySelector(s.trim()); } catch {} if (el) break; }
        if (!el) return { ok: false, error: 'not found' };
        const out = [], w = doc.createTreeWalker(el, 4);
        for (let n; (n = w.nextNode());) { const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v && v !== out[out.length - 1] && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement?.tagName || '') && !n.parentElement?.closest('svg')) out.push(v); }
        return { ok: true, text: out.join('\n').slice(0, max) };
      },
      /** Map pages: click the i-th of sel (a route's turn in Google Maps' details) and give where the map moved to (the
          address's @lat,lon,zoom), or '' when it didn't move. */
      async mapAt(sel, i, ms = 1500) {
        const els = doc.querySelectorAll(sel), e = els[i]; if (!e) return { ok: false, n: els.length };
        const at = () => (win.location.href.match(/@(-?[\d.]+),(-?[\d.]+),([\d.]+)z/) || []).slice(1, 4).join(','), was = at();
        (e.querySelector('[jsaction]') || e).click();
        for (const t0 = Date.now(); Date.now() - t0 < ms && at() === was;) await new Promise(r => setTimeout(r, 100));
        const now = at(); return { ok: true, n: els.length, at: now !== was ? now : '' };
      },
      /** Links and the words of the card each sits in (a list of places: name, rating, hours), with their addresses (Google
          Maps keeps a place's position in it: !3d<lat>!4d<lon>). */
      links(sel, max = 20) {
        let l = []; try { l = [...doc.querySelectorAll(sel)].slice(0, max); } catch {}
        return { ok: true, links: l.map(a => ({ label: a.getAttribute('aria-label') || '', href: a.href || '', text: (textOf(a.parentElement) || '').split('\n').map(x => x.trim()).filter(Boolean).join(' ¦ ').slice(0, 400) })) };
      },
      read(sels, max = 6000) {
        const tried = [];
        for (const s0 of [].concat(sels || []).flatMap(x => String(x).split('||'))) {
          const g = /^\s*rows-in:/.test(s0) && rowsIn(s0.replace(/^\s*rows-in:/, '').trim()), s = g ? g.css : s0; // rows-in:#pane-side: the list there, by shape
          if (/^\s*rows-in:/.test(s0) && !g) { tried.push([s0.trim(), 0]); continue; }
          let els = []; try { els = [...doc.querySelectorAll(s.trim())].filter(visible); } catch {}
          // the longer of the visible text and the label: list rows often carry a full summary in their label, while a message
          // area's label is just its name (“Message body”) and the text is what matters
          // (WhatsApp keeps a message's time and sender in data-pre-plain-text, outside the text: put it in front)
          const lines = els.map(e => { /* a row's lines kept apart (¦): name, time, preview stay distinct; icon names out; a hidden “6 unread messages” becomes its count */
            const parts = (textOf(e) || '').split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x && !ICON_WORD.test(x)), hiddenUnread = parts.find(x => /^\d+ unread messages?$/i.test(x));
            const t = parts.filter(x => x !== hiddenUnread).join(' ¦ '), l = (e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), pre = e.getAttribute('data-pre-plain-text') || e.querySelector?.('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || ''; // a bare number badge (an unread count) is said in its label: “5 unread messages”
            const badges = [...(e.querySelectorAll?.('[aria-label]') || [])].filter(b => /^\d{1,4}$/.test((textOf(b) || '').trim())).map(b => b.getAttribute('aria-label').trim()).filter(x => /[a-z]/i.test(x));
            // a row's state words that only its label has (Outlook: “Unread …”): put them in front of the text
            const state = l.length <= t.length && (l.match(/^((?:unread|flagged|pinned|important|urgent|replied|forwarded|has attachments?)[,\s]+)+/i)?.[0] || '').replace(/[,\s]+$/, '');
            if (!badges.length && hiddenUnread) badges.push(hiddenUnread);
            return pre + (state && !t.toLowerCase().startsWith(state.toLowerCase()) ? `${state} ` : '') + (l.length > t.length ? l : t) + (badges.length ? ` (${badges.join(', ')})` : ''); }).filter(Boolean);
          tried.push([s0.trim(), lines.length]);
          if (lines.length) return { ok: true, sel: s.trim(), text: lines.join('\n').slice(0, max), url: win.location.href, title: doc.title, tried };
        }
        return { ok: true, sel: 'body', text: (textOf(doc.body) || '').replace(/\n\s*\n+/g, '\n').slice(0, max), url: win.location.href, title: doc.title, tried };
      },
      /** Teaching an agent task: the next element you click is picked, not clicked (outlined while you hover), and returned
          with a selector to read it by. Times out after `ms`. */
      /** Is it there (a selector, comma/|| list, or a text), without clicking: for checking a task that would send. */
      exists(o = {}) {
        const words = x => clean(textOf(x) || x.getAttribute('aria-label') || x.title || x.value || '').toLowerCase(), q = clean(o.text || '').toLowerCase();
        for (const sel of String(o.sel || '').split('||').filter(Boolean)) { try { const m = [...doc.querySelectorAll(sel.trim())].filter(visible); const el = q ? m.find(x => words(x).includes(q)) : m[0]; if (el) return { ok: true, rect: rect(el) }; } catch {} }
        if (!o.sel && q) { const f = this.findText(o.text); if (f.ok) return f; }
        return { ok: false, error: `Nothing called “${o.text || o.sel}” on the page` };
      },
      pick(ms = 120000, exact = false) {
        return new Promise(res => {
          let hov = null; const prev = [];
          const mark = e => { const el = e.target; if (hov === el) return; if (hov) hov.style.outline = prev.pop() || ''; hov = el; prev.push(el.style.outline); el.style.outline = '3px solid #ff375f'; };
          const done = r => { pickEnd = null; doc.removeEventListener('mouseover', mark, true); doc.removeEventListener('click', take, true); if (hov) hov.style.outline = prev.pop() || ''; clearTimeout(t); res(r); };
          const take = e => { e.preventDefault(); e.stopPropagation(); const el = exact ? (e.target.closest(INTERACTIVE + ',[contenteditable=true],[role=textbox],[role=listitem],[role=row],[role=treeitem]') || e.target) : e.target.closest('[role=main],[role=listbox],[role=list],[role=document],article,section,main,table,ul,ol') || e.target;
            const g = groupOf(e.target), first = x => clean((textOf(x) || '').split('\n').map(s => s.trim()).find(Boolean) || '');
            done({ ok: true, css: css(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', label: el.getAttribute('aria-label') || '', testid: el.getAttribute('data-testid') || el.getAttribute('data-qa') || '', text: clean(textOf(el) || ''),
              row: g && { css: g.css, n: g.n, name: first(g.el), text: clean(textOf(g.el) || '') } }); }; // the list it's in, by shape
          doc.addEventListener('mouseover', mark, true); doc.addEventListener('click', take, true); pickEnd = done;
          const t = setTimeout(() => done({ ok: false, error: 'Nothing picked' }), ms);
        });
      },
      /** Stop waiting for a tap (Cancel in the agent browser's bar). */
      pickCancel() { pickEnd?.({ ok: false, error: 'cancelled' }); return { ok: true }; },
      /** Wait until a selector (choices between ||, or a comma list) or a text shows, up to `ms`. */
      async waitFor(o = {}, ms = 15000) {
        const t0 = Date.now(), q = clean(o.text || '').toLowerCase(), sels = o.sel ? String(o.sel).split('||').map(s => s.trim()).filter(Boolean) : [];
        for (;;) {
          let hit = false;
          for (const s of sels) { if (/^rows-in:/.test(s)) { if (rowsIn(s.slice(8).trim())) { hit = true; break; } continue; } try { if ([...doc.querySelectorAll(s)].some(visible)) { hit = true; break; } } catch {} }
          if (!hit && q) hit = (textOf(doc.body) || '').toLowerCase().includes(q);
          if (hit) return { ok: true, url: win.location.href };
          if (Date.now() - t0 > ms) return { ok: false, error: 'not there', url: win.location.href };
          await wait(300);
        }
      },
      /** Focus a field found by its label, placeholder or a selector (never a secret field), for real typing. */
      focus(o = {}) {
        let el = null; const q = clean(o.label || '').toLowerCase();
        if (o.sel) for (const s of String(o.sel).split('||')) { try { el = [...doc.querySelectorAll(s.trim())].find(visible); } catch {} if (el) break; }
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
        const words = x => clean(textOf(x) || x.getAttribute('aria-label') || x.title || x.value || '').toLowerCase();
        if (o.sel) for (const s of String(o.sel).split('||')) { try { const m = [...doc.querySelectorAll(s.trim())].filter(visible), q = clean(o.text || '').toLowerCase(); el = q ? m.find(x => words(x) === q) || m.find(x => words(x).startsWith(q)) || m.find(x => words(x).includes(q)) : m[0]; } catch {} if (el) break; }
        if (!el && o.text) { const f = this.findText(o.text); if (f.ok) { const q = clean(o.text).toLowerCase(); el = [...doc.querySelectorAll(INTERACTIVE)].filter(visible).sort((a, b) => clean(textOf(a) || '').length - clean(textOf(b) || '').length).find(e => clean(textOf(e) || e.getAttribute('aria-label') || e.title || e.value || '').toLowerCase().includes(q)); } }
        if (!el) return { ok: false, error: `Nothing called “${o.text || o.sel}” on the page` };
        el.scrollIntoView({ block: 'center' }); await wait(150);
        const r = el.getBoundingClientRect(), pt = { bubbles: true, cancelable: true, view: win, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (t.startsWith('pointer') && win.PointerEvent ? win.PointerEvent : win.MouseEvent)(t, pt));
        el.click();
        return { ok: true, rect: rect(el), text: clean(textOf(el) || el.getAttribute('aria-label') || '') };
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
