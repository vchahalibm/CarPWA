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
  frame(id = Media.first('web')) { return id ? $(`#dashRoot .mw[data-media="${CSS.escape(id)}"] iframe`) : null; },
  lib() {
    if (window.DriveDeckBridge) return Promise.resolve();
    return (this.libLoad ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = BRIDGE; s.onload = res; s.onerror = () => { this.libLoad = null; rej(new Error('Couldn’t load the bridge')); }; document.head.appendChild(s); }));
  },
  /** Wait until the frame shows its page (not blank, not still loading). */
  async loaded(f) {
    const t0 = performance.now();
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
      const id = ++this.seq, t = setTimeout(() => { this.pending.delete(id); rej(new Error('This page didn’t answer. To record or replay clicks on a page from another site, add the DriveDeck bridge to it (see bridge/README.md).')); }, op === 'play' ? 12000 : 2500);
      this.pending.set(id, m => { clearTimeout(t); res(m); });
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
    if (!quiet) { const r = await c.call('find', step.loc); if (r.ok) await this.point(f, r.rect); }
    const res = await c.call('play', step, { quiet });
    if (!quiet && res.rect) this.ring(f, res.rect, res.ok);
    Log[res.ok ? 'i' : 'w']('web', `${res.ok ? 'Played' : 'Failed'}: ${this.describe(step)}`, { how: res.how, error: res.error || undefined, quiet });
    Bus.emit('web.step', { value: this.describe(step) });
    if (!res.ok && !quiet) toast(res.error || 'That web step didn’t work');
    return res;
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
    // A link that loads another page: carry on recording there.
    f.addEventListener('load', this.rec.onLoad = async () => { if (this.rec?.f === f) { try { const n = await this.conn(f); this.rec.c = n; await n.call('record', true); } catch (e) { Log.w('web', 'Recording stopped: the new page can’t be recorded', e); } } });
    Log.i('web', 'Recording clicks', { page: this.rec.startUrl }); this.bar();
  },
  async finish(keep) {
    const R = this.rec; if (!R) return;
    this.rec = null; R.f.removeEventListener('load', R.onLoad); $('#wdBar')?.remove();
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
