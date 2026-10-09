'use strict';
/* ============================================================
   Web steps: record clicks on your own web pages in a web widget, and
   replay them in scripts, one at a time between the avatar's lines or as
   one sequence.
   - Same-origin pages (like samples/demo-page.html) are driven directly;
     pages elsewhere need bridge/drivedeck-bridge.js, which only answers
     the DriveDeck origins it lists. The same file does the work either way.
   - Recording: Settings › Scripts › a step › Record web steps (or Record a
     sequence). Clicks and typed values are kept with several ways to find
     each element again (data-testid, id, CSS path, text, position) and what
     changed afterwards, to check a replay worked. Password-like fields are
     never recorded.
   - Replay: an on-screen pointer moves to the element and a ring marks the
     click, so the audience can follow. Going back in a script replays the
     steps quietly (no pointer, no waits).
   - Desktop app: web widgets are real browsers (<webview>); every page gets
     the same recorder/player injected in an isolated world
     (desktop/webview-preload.js), so this works on any site, and replays
     click and type with real input events. Site helpers: your own CSS/JS
     for chosen sites, run when their pages load or by a script step.
   - Pointer: click anything on Stage at a screen position (also inside
     browser widgets), and with Follow the presenter, point with a finger
     and pinch to click.
   Loaded after people.js.
   ============================================================ */
const BRIDGE = 'bridge/drivedeck-bridge.js';
Bus.define('web.step', 'A recorded web step plays', 'what it did');

const WebDrive = {
  conns: new WeakMap(), pending: new Map(), seq: 0, rec: null,
  recs: () => store.get('webRecs', []),
  saveRec(r) { const l = this.recs().filter(x => x.name !== r.name); l.push(r); store.set('webRecs', l); return r; },
  delRec(name) { store.set('webRecs', this.recs().filter(x => x.name !== name)); },
  /** The page in a web widget (the first one on the dashboard unless named). */
  frame(id = Media.first('web')) { return id ? $(`#dashRoot .mw[data-media="${CSS.escape(id)}"] :is(iframe, webview)`) : null; },
  guest: f => f?.tagName === 'WEBVIEW',
  lib() {
    if (window.DriveDeckBridge) return Promise.resolve();
    return (this.libLoad ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = BRIDGE; s.onload = res; s.onerror = () => { this.libLoad = null; rej(new Error('Couldn’t load the bridge')); }; document.head.appendChild(s); }));
  },
  /** Wait until the frame shows its page (not blank, not still loading). */
  async loaded(f) {
    const t0 = performance.now();
    if (this.guest(f)) { for (let i = 0; i < 60; i++) { try { if (!f.isLoading()) return; } catch {} await new Promise(r => setTimeout(r, 150)); } return; }
    for (let i = 0; i < 60; i++, i === 59 && Log.w('web', 'The page took over 9 s to load', { ms: Math.round(performance.now() - t0) })) {
      let doc = null, same = true; try { doc = f.contentDocument; } catch { same = false; }
      if (!same || !doc) return; // another origin: the bridge answers once it's ready
      if (doc.readyState === 'complete' && doc.location.href !== 'about:blank') return;
      await new Promise(r => setTimeout(r, 150));
    }
  },
  /** A connection to the page: direct for same-origin pages, else messages to its bridge. */
  async conn(f) {
    await this.loaded(f);
    if (this.guest(f)) { // a browser widget: its injected helper answers over IPC
      let c = this.conns.get(f);
      if (!c) {
        c = { kind: 'guest', call: (op, ...a) => this.post(f, op, a) };
        f.addEventListener('ipc-message', e => { if (e.channel !== 'dd-bridge') return; const m = e.args[0] || {};
          if (m.id && this.pending.has(m.id)) { const h = this.pending.get(m.id); this.pending.delete(m.id); return h(m); }
          if (m.type === 'ready') return this.newPage(f);
          this.event(f, m); });
        this.conns.set(f, c); Log.d('web', 'Connected to the page (browser widget)');
      }
      return c;
    }
    let doc = null; try { doc = f.contentDocument; } catch {}
    const c = this.conns.get(f);
    if (c && c.src === f.src && (c.kind === 'bridge' ? !doc : c.doc === doc)) return c; // a new page asks again
    c?.api?.stop?.();
    let n;
    if (doc) {
      await this.lib();
      const api = DriveDeckBridge.create(doc, f.contentWindow, m => this.event(f, m));
      n = { kind: 'direct', doc, api, call: async (op, ...a) => api[op](...a) };
    } else {
      n = { kind: 'bridge', call: (op, ...a) => this.post(f, op, a) };
      const p = await n.call('ping').catch(e => ({ ok: false, error: e.message }));
      if (!p.ok) throw new Error(p.error);
    }
    n.src = f.src; this.conns.set(f, n); Log.d('web', `Connected to the page (${n.kind === 'direct' ? 'same site' : 'bridge'})`);
    return n;
  },
  post(f, op, args) {
    return new Promise((res, rej) => {
      const id = ++this.seq, t = setTimeout(() => { this.pending.delete(id); rej(new Error('This page didn’t answer. To record or replay clicks on a page from another site, add the DriveDeck bridge to it (see bridge/README.md).')); }, ['play', 'prepare', 'verify'].includes(op) ? 12000 : 2500);
      this.pending.set(id, m => { clearTimeout(t); res(m); });
      if (this.guest(f)) return f.send('dd-drive', { id, op, args }).catch(e => { this.pending.delete(id); clearTimeout(t); rej(e); });
      let to = '*'; try { to = new URL(f.src, location.href).origin; } catch {}
      f.contentWindow.postMessage({ dd: 'drive', id, op, args }, to); // only to the page we opened; the bridge checks who's asking
    });
  },
  /** Something the page reported while recording. */
  event(f, m) {
    const R = this.rec; if (!R || R.f !== f) return;
    if (m.type === 'step') {
      R.steps.push(m.step); Log.i('web', `Recorded: ${this.describe(m.step)}`, { found: Object.keys(m.step.loc).filter(k => m.step.loc[k] !== '' && m.step.loc[k] != null) });
      if (m.rect) this.ring(f, m.rect, true); this.bar();
    } else if (m.type === 'expect' && R.steps.length) R.steps.at(-1).expect = m.expect;
  },
  describe(s) {
    const L = s?.loc || {}, what = L.text ? `“${L.text}”` : L.testid || L.name || L.tag || 'element';
    return s?.t === 'type' ? (s.secret ? `Type a password in ${what} (you)` : `Type “${s.value}” in ${what}`) : `Click ${what}${L.role || L.tag === 'a' ? ` (${L.role || 'link'})` : ''}`;
  },

  /* ---------- Replay ---------- */
  /** Play one step on the page. Shown: the pointer moves there first and a ring marks it. Quiet: just do it (going back). */
  async play(step, { quiet = false, id } = {}) {
    const f = this.frame(id); if (!f) throw new Error('Add a web page widget to show the page');
    const t0 = performance.now(), c = await this.conn(f), tc = performance.now() - t0;
    if (tc > 800) Log.d('web', `Waited ${Math.round(tc)} ms for the page`);
    let res;
    if (c.kind === 'guest') res = await this.real(f, c, step, quiet);
    else {
      if (!quiet) { const r = await c.call('find', step.loc); if (r.ok) await this.point(f, r.rect); }
      res = await c.call('play', step, { quiet });
    }
    if (!quiet && res.rect) this.ring(f, res.rect, res.ok);
    Log[res.ok ? 'i' : 'w']('web', `${res.ok ? 'Played' : 'Failed'}: ${this.describe(step)}`, { how: res.how, error: res.error || undefined, quiet });
    Bus.emit('web.step', { value: this.describe(step) });
    if (!res.ok && !quiet) toast(res.error || 'That web step didn’t work');
    return res;
  },
  /** A browser widget: find it, then click or type with real input events, as a person would (pages that ignore scripted
      clicks work too). Dropdowns are set directly; password, payment and code fields wait for you. */
  async real(f, c, step, quiet) {
    const p = await c.call('prepare', step, { quiet });
    if (!p.ok && step.t === 'click' && UiDetect.cfg()) return (await this.visual(f, c, step, quiet)) || p; // moved or renamed: look for it
    if (!p.ok) return p;
    if (p.secret) return { ok: false, secret: true, rect: p.rect, error: 'This step is a password, payment or code field: type it yourself' };
    if (!quiet) await this.point(f, p.rect);
    const x = p.rect.x + p.rect.w / 2, y = p.rect.y + p.rect.h / 2;
    if (step.t === 'click' && !(await this.tap(f, c, x, y))) { Log.w('web', 'Real click didn’t arrive: clicking from the page instead'); return c.call('play', step, { quiet: true }); }
    else if (step.t === 'type' && p.tag === 'select') return c.call('play', step, { quiet });
    else if (step.t === 'type') await f.insertText(step.value || '');
    const v = await c.call('verify', step);
    return { ...v, how: p.how + ' · real input', rect: p.rect };
  },
  /** A real mouse click at (x, y) in a browser widget's page. */
  async input(f, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (document.activeElement !== f) f.focus(); // else the first click can go to focusing the widget
    const pause = ms => new Promise(r => setTimeout(r, ms)); // a person's click takes a moment; sent all at once, some get lost
    f.sendInputEvent({ type: 'mouseMove', x, y }); await pause(30);
    f.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await pause(50);
    f.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  },
  /** Visual fallback: the recorded element isn't there by its id, text or path any more. Look at the page with your
      screen-element model (tools/trainer) for a control of the same kind (button, link, field…) near where it was, about
      the same size, and click that. */
  async visual(f, c, step, quiet) {
    const t0 = performance.now(), L = step.loc, want = uiKind(L);
    try {
      const img = await f.capturePage(), bmp = await createImageBitmap(await (await fetch(img.toDataURL())).blob());
      const { dets, ms } = await UiDetect.detect(bmp), names = UiDetect.cfg().classes || [];
      const all = dets.filter(d => d.score >= 0.3).map(d => ({ ...d, name: names[d.c] || '?' })), same = all.filter(d => d.name === want);
      const pick = (same.length ? same : all).map(d => {
        const cx = (d.box[0] + d.box[2]) / 2, cy = (d.box[1] + d.box[3]) / 2, w = d.box[2] - d.box[0], h = d.box[3] - d.box[1];
        return { ...d, cx, cy, cost: Math.hypot(cx - L.x, cy - L.y) + (L.w ? 0.5 * (Math.abs(w - L.w) + Math.abs(h - L.h)) : 0) };
      }).filter(d => Math.hypot(d.cx - L.x, d.cy - L.y) < 0.35).sort((a, b) => a.cost - b.cost)[0];
      Log[pick ? 'i' : 'w']('web', pick ? `Found by the screen-element model: a ${pick.name} (${Math.round(pick.score * 100)}%)` : 'The screen-element model found nothing like it nearby',
        { want, found: all.length, ms, total: Math.round(performance.now() - t0) });
      if (!pick) return null;
      const R = f.getBoundingClientRect(), r = { x: pick.box[0] * R.width, y: pick.box[1] * R.height, w: (pick.box[2] - pick.box[0]) * R.width, h: (pick.box[3] - pick.box[1]) * R.height, vw: R.width, vh: R.height };
      if (!quiet) await this.point(f, r);
      if (!(await this.tap(f, c, r.x + r.w / 2, r.y + r.h / 2))) return null;
      const v = await c.call('verify', step);
      return { ...v, how: `screen model (${pick.name})`, rect: r };
    } catch (e) { Log.w('web', 'Screen-element model failed', e); return null; }
  },
  /** A real click that is checked. Right after a page loads it can take the page a second to take input, and a click sent
      before then is lost: so first move the mouse there until the page feels it (harmless), then click once. */
  async tap(f, c, x, y) {
    const pause = ms => new Promise(r => setTimeout(r, ms)), seen = t => c.call('clicked', t).catch(() => ({}));
    for (let i = 0; i < 25; i++) {
      const t = Date.now(); if (document.activeElement !== f) f.focus();
      f.sendInputEvent({ type: 'mouseMove', x: Math.round(x) + (i % 2), y: Math.round(y) }); await pause(40);
      if ((await seen(t)).moved) break;
      if (i === 24) Log.d('web', 'The page didn’t feel the mouse in 2 s: clicking anyway');
      await pause(40);
    }
    for (let i = 0; i < 2; i++) {
      const t = Date.now(); await this.input(f, x, y);
      for (let k = 0; k < 6; k++) { await pause(60); if ((await seen(t)).ok) return true; }
      Log.d('web', 'A real click didn’t arrive', { try: i + 1 });
    }
    return false;
  },
  /** A new page loaded in a browser widget: carry on recording there; site helpers ran on dom-ready. */
  newPage(f) {
    const R = this.rec; if (!R || R.f !== f) return;
    R.c.call('record', true).catch(e => Log.w('web', 'Recording stopped: the new page can’t be recorded', e));
  },

  /* ---------- Site helpers (desktop app): your CSS / JavaScript for chosen sites ---------- */
  helperList: () => store.get('siteHelpers', []),
  matches(h, url) {
    return String(h.match || '').split(/[\s,]+/).filter(Boolean).some(p => { try { return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(url); } catch { return false; } });
  },
  /** When a page loads in a browser widget: the helpers for its address (CSS added, JavaScript run in the page). */
  helpers(wv) {
    let url = ''; try { url = wv.getURL(); } catch { return; }
    for (const h of this.helperList()) if (h.on !== false && this.matches(h, url)) this.runHelper(wv, h, 'page load');
  },
  runHelper(wv, h, why) {
    Log.i('web', `Site helper “${h.name}” (${why})`);
    if (h.css) wv.insertCSS(h.css).catch(e => Log.w('web', `Site helper “${h.name}”: CSS failed`, e));
    if (h.js) return wv.executeJavaScript(h.js).catch(e => { Log.w('web', `Site helper “${h.name}” failed`, e); toast(`Site helper “${h.name}”: ${e.message || e}`); });
  },
  helpersHtml() {
    return `<div class="group-title">Site helpers</div>
      <p class="cmd-help">Your own CSS and JavaScript for chosen sites, run in the page when it loads in a web widget (hide a cookie banner, open a panel, set the page up for the demo), or by a script step (“Run a site helper”). They stay on this computer.</p>
      <div class="group">${this.helperList().map((h, i) => `<div class="row-wrap"><button class="row" data-sh="${i}"><div class="main"><div class="t">${esc(h.name)}${h.on === false ? ' <small>off</small>' : ''}</div><div class="s">${esc(h.match || 'Only when a script step runs it')}</div></div></button></div>`).join('')}
        <button class="row btn" data-sh="new"><div class="main"><div class="t">＋ Add a site helper</div></div></button></div>`;
  },
  editHelper(i) {
    const l = this.helperList(), h = i === 'new' ? { name: `Helper ${l.length + 1}`, match: '', css: '', js: '', on: true } : l[+i];
    sheet(i === 'new' ? 'New site helper' : 'Site helper', `<label class="fld"><span>Name</span><input id="shName" value="${esc(h.name)}"></label>
      <label class="fld"><span>Runs on pages (addresses, * for any part; leave empty to run it only from a script step)</span><input id="shMatch" value="${esc(h.match)}" placeholder="https://example.com/*"></label>
      <label class="fld"><span>CSS</span><textarea id="shCss" rows="4" spellcheck="false" placeholder="#cookie-banner { display: none !important }">${esc(h.css)}</textarea></label>
      <label class="fld"><span>JavaScript (runs in the page)</span><textarea id="shJs" rows="6" spellcheck="false" placeholder="document.querySelector('#accept')?.click()">${esc(h.js)}</textarea></label>
      <label class="fld fld-row"><input type="checkbox" id="shOn" ${h.on !== false ? 'checked' : ''}> <span>On</span></label>
      <p class="hint">Only add code you wrote or trust: it runs inside the site with your login there.</p>`,
      [['Save', () => { const n = { name: $('#shName').value.trim() || 'Helper', match: $('#shMatch').value.trim(), css: $('#shCss').value, js: $('#shJs').value, on: $('#shOn').checked };
        const L = this.helperList(); if (i === 'new') L.push(n); else L[+i] = n; store.set('siteHelpers', L); Log.i('web', 'Site helper saved', { name: n.name, match: n.match }); ScriptUI.render(); }],
       ...(i === 'new' ? [] : [['Delete', () => { const L = this.helperList(); L.splice(+i, 1); store.set('siteHelpers', L); ScriptUI.render(); }]]), ['Cancel']]);
  },
  async playAll(steps, o = {}) {
    for (const s of steps) { const r = await this.play(s, o); if (!r.ok && r.secret) break; if (!o.quiet) await new Promise(x => setTimeout(x, 450)); }
  },
  /** Where something in the page is, in the widget's coordinates. */
  spot(f, r) {
    const body = f.closest('.mw-body') || f.parentElement, fb = f.getBoundingClientRect(), bb = body.getBoundingClientRect(), k = fb.width / (r.vw || fb.width);
    return { body, x: fb.left - bb.left + (r.x + r.w / 2) * k, y: fb.top - bb.top + (r.y + r.h / 2) * k, w: r.w * k, h: r.h * k };
  },
  /** The audience's pointer glides to the target before the click. */
  point(f, r) {
    const p = this.spot(f, r);
    let cur = $('.wd-cursor', p.body);
    if (!cur) { cur = document.createElement('div'); cur.className = 'wd-cursor'; cur.style.transform = `translate(${p.body.clientWidth / 2}px,${p.body.clientHeight / 2}px)`; p.body.appendChild(cur); cur.getBoundingClientRect(); }
    cur.style.transform = `translate(${p.x}px,${p.y}px)`; clearTimeout(cur._t); cur._t = setTimeout(() => cur.remove(), 4000);
    return new Promise(r2 => setTimeout(r2, 520));
  },
  ring(f, r, ok) {
    const p = this.spot(f, r), el = document.createElement('div');
    el.className = 'wd-ring' + (ok ? '' : ' bad');
    Object.assign(el.style, { left: `${p.x - p.w / 2 - 6}px`, top: `${p.y - p.h / 2 - 6}px`, width: `${p.w + 12}px`, height: `${p.h + 12}px` });
    p.body.appendChild(el); setTimeout(() => el.remove(), 1400);
  },

  /* ---------- Recording ---------- */
  /** Record clicks on the page in the (first) web widget until Done. `done(steps, startUrl)` gets them. */
  async record(done, title = 'Recording') {
    const id = Media.first('web'), f = this.frame(id);
    if (!f) return sheet('No web page to record', '<p>Add a <b>Web page</b> widget showing your page first (on Stage: Edit › Add, or a script step that opens the page), then record again.</p>', [['OK']]);
    let c; try { c = await this.conn(f); const r = await c.call('record', true); if (!r?.ok) throw new Error(r?.error || 'The page refused'); }
    catch (e) { return sheet('This page can’t be recorded', `<p>${esc(e.message)}</p>`, [['OK']]); }
    this.rec = { f, id, steps: [], startUrl: Wcfg.get(id).url, done, title, c };
    // A link that loads another page: carry on recording there (a browser widget says so itself: newPage).
    if (!this.guest(f)) f.addEventListener('load', this.rec.onLoad = async () => { if (this.rec?.f === f) { try { const n = await this.conn(f); this.rec.c = n; await n.call('record', true); } catch (e) { Log.w('web', 'Recording stopped: the new page can’t be recorded', e); } } });
    Log.i('web', 'Recording clicks', { page: this.rec.startUrl }); this.bar();
  },
  async finish(keep) {
    const R = this.rec; if (!R) return;
    this.rec = null; if (R.onLoad) R.f.removeEventListener('load', R.onLoad); $('#wdBar')?.remove();
    Log.i('web', keep ? `Recorded ${R.steps.length} steps` : 'Recording cancelled');
    if (keep) R.done(R.steps, R.startUrl);
    R.c.call('record', false).catch(() => {});
  },
  bar() {
    const R = this.rec; if (!R) return;
    let b = $('#wdBar'); if (!b) { b = document.createElement('div'); b.id = 'wdBar'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.innerHTML = `<span class="wd-dot"></span><div class="wd-txt"><b>${esc(R.title)} · ${R.steps.length} step${R.steps.length === 1 ? '' : 's'}</b>
      <span>${R.steps.length ? esc(this.describe(R.steps.at(-1))) : 'Use the page as you will in the demo: click, type'}</span></div>
      <button class="big-btn accent" data-wd="done">Done</button><button class="big-btn" data-wd="cancel">Cancel</button>`;
  },

  /* ---------- From the script editor ---------- */
  /** Record into step n of the script being edited, then come back to the editor. */
  async recordInto(ui, n) {
    const d = ui.draft, b = d.beats[n];
    // The page this step shows (its own, or the last one opened before it), in a web widget on screen.
    const opens = [...(d.setup || []), ...d.beats.slice(0, n + 1).flatMap(x => x.do || [])].filter(x => x.do === 'web.open');
    const url = opens.at(-1)?.value || 'samples/demo-page.html';
    openView('dashboard');
    if (!Media.first('web')) {
      const where = Dash.layout === 'stage' ? 'stage.main' : 'pg0';
      Dash.setList(where, [...Dash.list(where), 'web~stage']); Wcfg.set('web~stage', { url, file: null }); Dash.render();
    } else Media.webOpen(Media.first('web'), url);
    await new Promise(r => setTimeout(r, 600));
    this.record((steps, start) => {
      ui.shown = true; ui.page = 'edit'; openView('settings');
      if (!steps.length) return ui.render();
      sheet(`${steps.length} web step${steps.length === 1 ? '' : 's'} recorded`, `<ol class="wd-list">${steps.map(s => `<li>${esc(this.describe(s))}</li>`).join('')}</ol>
        <label class="fld"><span>Name (for one sequence)</span><input id="wdName" value="${esc(`${d.name} · ${b.title}`)}"></label>
        <p class="hint"><b>Separate steps</b> can sit between the assistant’s lines and actions. <b>One sequence</b> plays them all in one go.</p>`,
        [['Separate steps', () => this.addTo(ui, n, steps, start, null)], ['One sequence', () => this.addTo(ui, n, steps, start, $('#wdName')?.value.trim() || 'Recording')], ['Discard', () => ui.render()]]);
    }, `Recording step ${n + 1}`);
  },
  addTo(ui, n, steps, start, name) {
    const b = ui.draft.beats[n]; b.do ||= [];
    // Start from the page it was recorded on, so the step (and going back to it) always lands right.
    if (!b.do.some(x => x.do === 'web.open') && start) b.do.push({ do: 'web.open', value: start });
    if (name) { this.saveRec({ name, url: start, steps, at: Date.now() }); b.do.push({ do: 'web.play', value: name }); }
    else steps.forEach(s => b.do.push({ do: 'web.step', value: JSON.stringify(s) }));
    ui.render(); toast(name ? `Added “${name}”` : `Added ${steps.length} web steps`);
  },
  /** Record a named sequence on its own (Settings › Scripts). */
  recordAlone() {
    openView('dashboard');
    setTimeout(() => this.record((steps, start) => {
      openView('settings'); ScriptUI.open();
      if (!steps.length) return;
      sheet('Save the recording', `<ol class="wd-list">${steps.map(s => `<li>${esc(this.describe(s))}</li>`).join('')}</ol><label class="fld"><span>Name</span><input id="wdName" value="Recording ${this.recs().length + 1}"></label>`,
        [['Save', () => { this.saveRec({ name: $('#wdName').value.trim() || 'Recording', url: start, steps, at: Date.now() }); ScriptUI.render(); }], ['Discard']]);
    }, 'Recording a sequence'), 300);
  },
};
addEventListener('message', e => {
  const m = e.data; if (!m || m.dd !== 'bridge') return;
  const f = $$('#dashRoot iframe').find(x => x.contentWindow === e.source); if (!f) return; // only frames on our dashboard
  if (m.id && WebDrive.pending.has(m.id)) { const h = WebDrive.pending.get(m.id); WebDrive.pending.delete(m.id); return h(m); }
  WebDrive.event(f, m);
});
document.addEventListener('click', e => { const b = e.target.closest('[data-wd]'); if (!b) return; e.stopPropagation(); WebDrive.finish(b.dataset.wd === 'done'); }, true);
document.addEventListener('click', e => { const b = e.target.closest('[data-sh]'); if (b) WebDrive.editHelper(b.dataset.sh); });

/* ---------- Actions (scripts, voice commands, links) ---------- */
const stepOf = v => { try { const s = typeof v === 'string' ? JSON.parse(v) : v; return s?.loc ? s : null; } catch { return null; } };
Actions.define('web.step', { group: 'Web pages', name: 'Do a recorded web step', arg: 'Recorded step (from Record web steps)', async run(v, say, ev) {
  const s = stepOf(v); if (!s) return say('That web step isn’t valid: record it again.'); await WebDrive.play(s, { quiet: !!ev?.quiet }); } });
Actions.define('web.play', { group: 'Web pages', name: 'Play a recorded sequence', arg: 'Recording name', async run(v, say, ev) {
  const r = WebDrive.recs().find(x => x.name === v) || WebDrive.recs().find(x => plain(x.name) === plain(v));
  if (!r) return say(`I don’t have a recording called ${v}.`);
  await WebDrive.playAll(r.steps, { quiet: !!ev?.quiet }); } });
Actions.define('web.click', { group: 'Web pages', name: 'Click something on the page', arg: 'Its text or data-testid', async run(v, say, ev) {
  await WebDrive.play({ t: 'click', loc: { testid: /^[\w-]+$/.test(v) ? v : '', text: v } }, { quiet: !!ev?.quiet }); } });
/* ---------- The screen-element model: your detector from tools/trainer (ONNX: 'images' [3,H,W] 0..1 → boxes in pixels,
   scores, labels with 1 = classes[0]), in its own worker, used when a recorded element can't be found (WebDrive.visual). */
/** What kind of control a recorded element is, in the trainer's class names. */
function uiKind(L = {}) {
  const t = L.tag, r = L.role, ty = (L.type || '').toLowerCase();
  if (t === 'a' || r === 'link') return 'link';
  if (r === 'tab') return 'tab';
  if (t === 'select' || r === 'option' || r === 'listbox') return 'select';
  if (r === 'checkbox' || r === 'switch' || ['checkbox', 'radio'].includes(ty)) return 'checkbox';
  if (t === 'textarea' || (t === 'input' && !['button', 'submit', 'reset', 'image'].includes(ty))) return 'input';
  if (t === 'img') return 'image';
  if (t === 'svg') return 'icon';
  return 'button';
}
const UI_WORKER = `let ort, sess;
self.onmessage = async ({ data: m }) => {
  const send = x => self.postMessage({ ...x, id: m.id });
  try {
    if (m.type === 'load') {
      ort = await import(m.ort); ort.env.wasm.numThreads = 1;
      sess = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'] });
      send({ type: 'loaded', inputs: sess.inputNames, outputs: sess.outputNames });
    } else if (m.type === 'detect') {
      const b = m.frame, k = Math.min(1, 1024 / Math.max(b.width, b.height)), W = Math.round(b.width * k), H = Math.round(b.height * k);
      const c = new OffscreenCanvas(W, H), x = c.getContext('2d'); x.drawImage(b, 0, 0, W, H); b.close();
      const px = x.getImageData(0, 0, W, H).data, n = W * H, d = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) { d[i] = px[i * 4] / 255; d[n + i] = px[i * 4 + 1] / 255; d[2 * n + i] = px[i * 4 + 2] / 255; }
      const t = performance.now(), o = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', d, [3, H, W]) });
      const bx = o.boxes.data, sc = o.scores.data, lb = o.labels.data, dets = [];
      for (let i = 0; i < sc.length; i++) dets.push({ c: Number(lb[i]) - 1, score: sc[i], box: [bx[i * 4] / W, bx[i * 4 + 1] / H, bx[i * 4 + 2] / W, bx[i * 4 + 3] / H] });
      send({ type: 'dets', dets, ms: Math.round(performance.now() - t) });
    }
  } catch (e) { send({ type: 'error', message: String((e && e.message) || e) }); }
};`;
const UiDetect = {
  worker: null, loading: null, seq: 0,
  cfg: () => store.get('uiModel', null),
  async load() {
    if (this.worker) return this.worker;
    return this.loading ||= (async () => {
      const C = this.cfg(); if (!C) throw new Error('No screen-element model chosen');
      if (!Budget.room('uidet', 80, true)) throw new Error('Not enough memory for the screen-element model');
      const blob = C.file ? await Files.get(C.file.key) : await (await fetch(C.url)).blob(); if (!blob) throw new Error('The model file is gone: choose it again');
      const w = new Worker(URL.createObjectURL(new Blob([UI_WORKER], { type: 'text/javascript' })), { type: 'module' }), pending = new Map();
      w.onmessage = ({ data: m }) => { const h = pending.get(m.id); pending.delete(m.id); h?.(m); };
      w.call = (msg, transfer = []) => new Promise((ok, no) => { const id = ++this.seq; pending.set(id, m => m.type === 'error' ? no(new Error(m.message)) : ok(m)); w.postMessage({ ...msg, id }, transfer); });
      const t = performance.now(), buf = await blob.arrayBuffer();
      const r = await Budget.guard(`Screen-element model ${C.name}`, () => w.call({ type: 'load', ort: ORT_URL, model: buf }, [buf]));
      Budget.add('uidet', `Screen-element model ${C.name}`, () => this.unload(), 80);
      Log.i('web', `Screen-element model ready ${Math.round(performance.now() - t)} ms`, { name: C.name, classes: C.classes, inputs: r.inputs, outputs: r.outputs });
      return (this.worker = w);
    })().catch(e => { this.loading = null; throw e; });
  },
  async detect(bmp) { const w = await this.load(); const r = await w.call({ type: 'detect', frame: bmp }, [bmp]); return r; },
  unload() { this.worker?.terminate(); this.worker = null; this.loading = null; Budget.loaded.delete('uidet'); },
  html() {
    const C = this.cfg();
    return `<div class="group-title">Screen-element model</div>
      <p class="cmd-help">When a recorded step's element can't be found any more (renamed, moved), a detector you trained with the DriveDeck Trainer (tools/trainer › Models › Export) looks at the page for a control of the same kind near where it was, and clicks it. Choose its <b>model.onnx</b> (or model.int8.onnx) and <b>model.json</b>.</p>
      <div class="group"><div class="row"><div class="main"><div class="t">${C ? esc(C.name) : 'None'}</div><div class="s">${C ? esc((C.classes || []).join(', ')) : 'Without one, a step whose element is gone stops with a message'}</div></div></div>
        <label class="row btn"><div class="main"><div class="t">Choose the model files…</div></div><input type="file" id="uiModelFiles" multiple accept=".onnx,.json,application/json" hidden></label>
        ${C ? '<button class="row btn" data-uimodel="rm"><div class="main"><div class="t">Remove</div></div></button>' : ''}</div>`;
  },
  async choose(files) {
    const onnx = [...files].find(f => /\.onnx$/i.test(f.name)), json = [...files].find(f => /\.json$/i.test(f.name));
    if (!onnx) return toast('Choose the model’s .onnx file (and its model.json)');
    let meta = {}; try { meta = json ? JSON.parse(await json.text()) : {}; } catch { return toast('model.json isn’t valid'); }
    const classes = meta.classes || ['button', 'link', 'input', 'checkbox', 'select', 'tab', 'icon', 'image'];
    const old = this.cfg(); if (old?.file) Files.del(old.file.key).catch(() => {});
    const key = 'uimodel-' + Date.now().toString(36); await Files.put(key, onnx);
    store.set('uiModel', { name: meta.name || onnx.name, classes, file: { key, name: onnx.name } }); this.unload();
    Log.i('web', 'Screen-element model chosen', { name: meta.name || onnx.name, classes, mb: +(onnx.size / 1e6).toFixed(1) });
    toast('Screen-element model ready'); ScriptUI.render();
  },
};
document.addEventListener('change', e => { if (e.target.id === 'uiModelFiles') UiDetect.choose(e.target.files); });
document.addEventListener('click', e => { if (e.target.closest('[data-uimodel="rm"]')) { const C = UiDetect.cfg(); if (C?.file) Files.del(C.file.key).catch(() => {}); store.set('uiModel', null); UiDetect.unload(); ScriptUI.render(); } });

Actions.define('web.helper', { group: 'Web pages', name: 'Run a site helper', arg: 'Site helper name', run(v, say) {
  const h = WebDrive.helperList().find(x => plain(x.name) === plain(v)); if (!h) return say(`I don’t have a site helper called ${v}.`);
  const f = WebDrive.frame(); if (!WebDrive.guest(f)) return say('Site helpers run in the desktop app’s web widgets.');
  return WebDrive.runHelper(f, h, 'script step'); } });

/* ---------- Pointer: click anything on Stage at a screen position; point and pinch with Follow the presenter ---------- */
const Pointer = {
  /** Click what's at (x, y) in the window as a person would: real input in a browser widget, the element in a same-site
      page or in DriveDeck itself. True if something was there. */
  clickAt(x, y) {
    const el = document.elementFromPoint(x, y); if (!el) return false;
    Log.d('web', 'Pointer click', { x: Math.round(x), y: Math.round(y), on: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') });
    if (el.tagName === 'WEBVIEW') { const r = el.getBoundingClientRect(); WebDrive.conn(el).then(c => WebDrive.tap(el, c, x - r.left, y - r.top)).catch(() => WebDrive.input(el, x - r.left, y - r.top)); return true; }
    let t = el, win = window;
    if (el.tagName === 'IFRAME') { try { const r = el.getBoundingClientRect(); win = el.contentWindow; t = el.contentDocument.elementFromPoint(x - r.left, y - r.top); x -= r.left; y -= r.top; } catch { return false; } }
    if (!t) return false;
    const o = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
    for (const k of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) t.dispatchEvent(new (k.startsWith('pointer') ? win.PointerEvent : win.MouseEvent)(k, o));
    t.click?.(); return true;
  },
  /* The presenter's hand (People, Settings › Mode › Point to click): the index fingertip moves a dot; a pinch (thumb to
     fingertip) clicks where the dot was just before. */
  pos: null, hist: [], pinched: false, last: 0, seenAt: 0,
  hand(hands, now) {
    if (!settings.handPointer || !Stage.on) return this.hide();
    const h = hands.find(x => x.g === 'Pointing_Up') || (now - this.seenAt < 1500 ? hands[0] : null);
    if (!h?.lm?.[8]) { if (now - this.seenAt > 600) this.hide(); return; }
    this.seenAt = now;
    const lm = h.lm, mirror = settings.stageCam !== 'back', size = Math.hypot(lm[0][0] - lm[9][0], lm[0][1] - lm[9][1]) || 0.1;
    const nx = Math.min(1, Math.max(0, ((mirror ? 1 - lm[8][0] : lm[8][0]) - 0.15) / 0.7)), ny = Math.min(1, Math.max(0, (lm[8][1] - 0.1) / 0.65));
    const tx = nx * innerWidth, ty = ny * innerHeight;
    this.pos = this.pos ? [this.pos[0] + (tx - this.pos[0]) * 0.35, this.pos[1] + (ty - this.pos[1]) * 0.35] : [tx, ty];
    const pinch = Math.hypot(lm[4][0] - lm[8][0], lm[4][1] - lm[8][1]) / size < 0.3;
    this.hist.push([now, ...this.pos]); this.hist = this.hist.filter(p => now - p[0] < 400);
    if (!pinch) this.draw(false);
    if (pinch && !this.pinched && now - this.last > 700) { // where the finger was before the pinch moved it
      const at = this.hist.find(p => now - p[0] < 300) || this.hist[0]; this.last = now; this.draw(true, at);
      Log.i('people', 'Pinch: click', { x: Math.round(at[1]), y: Math.round(at[2]) }); this.clickAt(at[1], at[2]);
    }
    this.pinched = pinch;
  },
  draw(click, at = [0, ...this.pos]) {
    let d = $('#handPtr'); if (!d) { d = document.createElement('div'); d.id = 'handPtr'; document.body.appendChild(d); }
    d.hidden = false; d.style.transform = `translate(${at[1]}px,${at[2]}px)`; d.classList.toggle('click', click);
    if (click) setTimeout(() => d.classList.remove('click'), 250);
  },
  hide() { const d = $('#handPtr'); if (d) d.hidden = true; this.pos = null; },
};
Actions.define('web.clickAt', { group: 'Web pages', name: 'Click at a place on the screen', arg: 'x,y as fractions of the screen, e.g. 0.5,0.4', run(v, say) {
  const [x, y] = String(v).split(/[ ,]+/).map(Number); if (!(x >= 0 && y >= 0)) return say('Give the place as x,y fractions of the screen, like 0.5,0.4.');
  Pointer.clickAt(x <= 1 ? x * innerWidth : x, y <= 1 ? y * innerHeight : y); } });
