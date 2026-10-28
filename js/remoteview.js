'use strict';
/* ============================================================
   Seeing and using a StudioGen from another device (design: docs/studiogbee.html § 4 and § 8).
   - Signing in from your phone: when a task stops at a sign-in page, the phone shows StudioGen's agent browser live and you
     sign in there (pictures one way, your taps and typing the other). Signing in at the Mac stays the first choice.
   - The whole app: a StudioGen without a screen (StudioGen Worker in Docker) is set up and used this way.
   Only the StudioGen's owner's own devices (Agent.ownDevice), only over a direct link (the relays are far too slow for
   pictures). StudioGen shows who is looking, with Stop. What you type goes straight into the page: never logged, recorded
   or kept; this is the only thing that may type into a password field, and only what you type live.
   Host side: `RemoteView.answer` (Direct.handle 'view-*'). Viewer side: `RemoteView.open(to, target)`.
   Loaded after appsteps.js and agent.js.
   ============================================================ */
const RemoteView = {
  sessions: new Map(),
  /* ---------- On the StudioGen being looked at ---------- */
  async answer(kind, p, who) {
    if (!LINK_HOST) throw new Error('Only StudioGen can be looked at');
    if (typeof Agent === 'undefined' || !Agent.ownDevice(who)) throw new Error('Only this StudioGen’s owner’s own devices can see and use it');
    if (!who?.direct) throw new Error('Seeing StudioGen needs a direct link (the same network, or one the networks allow): the relays are too slow for pictures');
    if (kind === 'view-open') {
      const id = Math.random().toString(36).slice(2), target = p.target === 'app' ? 'app' : 'web';
      if (target === 'web') { if (!AgentWeb.can()) throw new Error('This StudioGen has no agent browser'); AgentWeb.watch(false); AgentWeb.use(p.container || AgentWeb.cur); AgentWeb.show(true); if (p.url && /^https?:\/\//.test(p.url)) AgentWeb.go(p.url, p.container); }
      this.sessions.set(id, { id, target, who: who.name || 'A device', at: Date.now(), seen: Date.now() }); this.banner();
      Log.i('remote', `${who.name || 'A device'} opened the ${target === 'web' ? 'agent browser' : 'app'} from afar`);
      return { id, target, containers: typeof Containers !== 'undefined' ? Containers.all().map(c => ({ id: c.id, name: c.name })) : [], cur: AgentWeb.cur?.split('|')[0] };
    }
    const s = this.sessions.get(p.id); if (!s) throw new Error('That view was closed on StudioGen');
    s.seen = Date.now();
    if (kind === 'view-frame') return this.frame(s, Math.min(1400, Math.max(320, +p.w || 900)));
    if (kind === 'view-input') { await this.input(s, p.ev || {}); return { ok: true }; }
    if (kind === 'view-container') { if (s.target !== 'web') return { ok: false }; AgentWeb.use(p.container); AgentWeb.show(true); return { ok: true }; }
    if (kind === 'view-close') { this.stop(s.id); return { ok: true }; }
    throw new Error(`Unknown request ${kind}`);
  },
  /** A picture of what's looked at, as a JPEG the width the viewer asked for. */
  async frame(s, w) {
    let src;
    if (s.target === 'web') { const v = AgentWeb.view(); src = await loadImage((await v.wv.capturePage()).toDataURL()); }
    else src = (await AppSteps.screen()).canvas;
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, k = Math.min(1, w / sw);
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(sw * k), height: Math.round(sh * k) });
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return { img: c.toDataURL('image/jpeg', 0.62), w: c.width, h: c.height, url: s.target === 'web' ? AgentWeb.url() : '', title: s.target === 'web' ? (AgentWeb.view()?.wv.getTitle?.() || '') : APP_NAME };
  },
  /** A tap, typing, a key or a scroll from the viewer: x, y are fractions of the picture. Never logged with its text. */
  async input(s, ev) {
    if (s.target === 'web') {
      const wv = AgentWeb.view().wv, r = wv.getBoundingClientRect(), x = Math.round((+ev.x || 0) * r.width), y = Math.round((+ev.y || 0) * r.height);
      if (ev.kind === 'tap') { wv.sendInputEvent({ type: 'mouseMove', x, y }); wv.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wv.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); }
      else if (ev.kind === 'text') await wv.insertText(String(ev.text || '').slice(0, 2000));
      else if (ev.kind === 'key') this.key(e => wv.sendInputEvent(e), ev.key);
      else if (ev.kind === 'scroll') wv.sendInputEvent({ type: 'mouseWheel', x: x || 400, y: y || 300, deltaX: 0, deltaY: -(+ev.dy || 0), canScroll: true });
      return;
    }
    const D = window.DriveDeckDesktop, x = Math.round((+ev.x || 0) * innerWidth), y = Math.round((+ev.y || 0) * innerHeight);
    if (ev.kind === 'tap') await D.input([{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }]);
    else if (ev.kind === 'text') await D.insertText(String(ev.text || '').slice(0, 2000));
    else if (ev.kind === 'key') { const evs = []; this.key(e => evs.push(e), ev.key); await D.input(evs); }
    else if (ev.kind === 'scroll') await D.input([{ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -(+ev.dy || 0), canScroll: true }]);
  },
  key(send, k) { k = ['Enter', 'Backspace', 'Tab', 'Escape', 'Up', 'Down', 'Left', 'Right'].includes(k) ? k : 'Enter'; send({ type: 'keyDown', keyCode: k }); if (k === 'Enter') send({ type: 'char', keyCode: '\r' }); send({ type: 'keyUp', keyCode: k }); },
  stop(id) {
    const s = this.sessions.get(id); if (!s) return; this.sessions.delete(id);
    if (s.target === 'web' && ![...this.sessions.values()].some(x => x.target === 'web')) AgentWeb.show(false);
    Log.i('remote', `${s.who} closed the view`); this.banner();
  },
  /** Who is looking, always visible on StudioGen while they are, with Stop. */
  banner() {
    let b = $('#rvBanner'); const l = [...this.sessions.values()];
    if (!l.length) { b?.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'rvBanner'; b.className = 'rv-banner'; document.body.appendChild(b); }
    b.innerHTML = `<span>📱 ${l.map(s => `<b>${esc(s.who)}</b> is using ${s.target === 'web' ? 'the agent browser' : APP_NAME}`).join(' · ')} from afar</span><button class="chip" data-rv="stopall">Stop</button>`;
  },

  /* ---------- On the device looking ---------- */
  /** to: { meshId, name } (a StudioGen in the mesh), or null for the paired Mac. target: 'web' (the agent browser) or 'app'. */
  async open(to, target = 'web', o = {}) {
    const call = (kind, p, ms = 20000) => {
      if (to?.meshId && typeof MeshDirect !== 'undefined' && MeshDirect.open(to.meshId)) return Mesh.call(to.meshId, kind, p, ms);
      if ((!to?.meshId || to.meshId === Relay.mac?.()?.meshId) && typeof Direct !== 'undefined' && Direct.connected) return Direct.call(kind, p, ms);
      return Promise.reject(new Error(`Seeing ${to?.name || 'your Mac'} needs a direct link: be on the same network (or let the networks allow one: Settings › Connections › Direct link)`));
    };
    const name = to?.name || (typeof Link !== 'undefined' ? Link.macName() : 'StudioGen');
    let s; try { s = await call('view-open', { target, container: o.container, url: o.url }); } catch (e) { return sheet('Can’t see it from here', `<p>${esc(e.message)}</p><p class="se-note">Or sign in at ${esc(name)} itself: the agent browser is open there.</p>`, [['OK']]); }
    this.v = { s, call, name, target, on: true };
    let f = $('#rvView'); f?.remove(); f = document.createElement('div'); f.id = 'rvView'; f.className = 'rv-view';
    f.innerHTML = `<div class="rv-top"><b>${esc(name)}</b><span class="rv-url"></span>${target === 'web' && s.containers.length > 1 ? `<select class="rv-ct">${s.containers.map(c => `<option value="${esc(c.id)}" ${c.id === s.cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}<button class="chip accent" data-rv="close">Done</button></div>
      <div class="rv-pic"><img alt="${esc(name)}, live"><p class="rv-wait">Connecting…</p></div>
      <div class="rv-keys"><input class="rv-text" placeholder="Type here, then Send" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="chip accent" data-rv="send">Send</button><button class="chip" data-rv="key:Enter">⏎</button><button class="chip" data-rv="key:Backspace">⌫</button><button class="chip" data-rv="key:Tab">Tab</button><button class="chip" data-rv="scroll:-400">▲</button><button class="chip" data-rv="scroll:400">▼</button></div>
      <p class="se-note rv-note">Tap the picture where you would click. What you type goes straight into the page on ${esc(name)}: nothing is recorded or kept.${target === 'web' ? ' When you’re signed in, tap Done and ask again.' : ''}</p>`;
    document.body.appendChild(f);
    this.loop();
  },
  async loop() {
    const v = this.v, img = $('#rvView img');
    while (v.on && this.v === v) {
      try {
        const fr = await v.call('view-frame', { id: v.s.id, w: Math.round(Math.min(1400, innerWidth * (devicePixelRatio || 1))) }, 15000);
        if (!v.on) break; img.src = fr.img; v.fw = fr.w; v.fh = fr.h; $('#rvView .rv-wait')?.remove(); const u = $('#rvView .rv-url'); if (u) u.textContent = fr.url ? fr.url.replace(/^https?:\/\//, '').slice(0, 60) : '';
      } catch (e) { if (!v.on) break; const w = $('#rvView .rv-pic'); if (w && !$('#rvView .rv-err')) w.insertAdjacentHTML('beforeend', `<p class="rv-err">${esc(e.message)}</p>`); if (/closed|isn’t|only/i.test(e.message)) { v.on = false; break; } await new Promise(r => setTimeout(r, 2000)); continue; }
      $('#rvView .rv-err')?.remove(); await new Promise(r => setTimeout(r, v.quick ? 60 : 250)); v.quick = false;
    }
  },
  send(ev) { const v = this.v; if (!v?.on) return; v.quick = true; v.call('view-input', { id: v.s.id, ev }).catch(e => toast(e.message)); },
  close() { const v = this.v; if (!v) return; v.on = false; v.call('view-close', { id: v.s.id }, 5000).catch(() => {}); this.v = null; $('#rvView')?.remove(); },
};
// StudioGen: a view nobody asks pictures of for 30 s is closed
setInterval(() => { for (const s of RemoteView.sessions.values()) if (Date.now() - s.seen > 30000) RemoteView.stop(s.id); }, 10000);
document.addEventListener('click', e => {
  const o = e.target.closest('[data-rvopen]'); if (o) { e.stopPropagation(); const [target, id] = o.dataset.rvopen.split('|'); closeSheet(); return RemoteView.open(id ? { meshId: id, name: Mesh.member(id)?.name || 'StudioGen' } : null, target); }
  const b = e.target.closest('[data-rv]'); if (b) {
    const [k, arg] = b.dataset.rv.split(':');
    if (k === 'stopall') { for (const id of [...RemoteView.sessions.keys()]) RemoteView.stop(id); return; }
    if (k === 'close') return RemoteView.close();
    if (k === 'send') { const t = $('#rvView .rv-text'); if (t.value) { RemoteView.send({ kind: 'text', text: t.value }); t.value = ''; } return; }
    if (k === 'key') return RemoteView.send({ kind: 'key', key: arg });
    if (k === 'scroll') return RemoteView.send({ kind: 'scroll', dy: -(+arg), x: 0.5, y: 0.5 });
    return;
  }
  const img = e.target.closest('#rvView .rv-pic img'); if (img) { const r = img.getBoundingClientRect(); RemoteView.send({ kind: 'tap', x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4) }); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('#rvView .rv-text')) { e.preventDefault(); const t = e.target; RemoteView.send({ kind: 'text', text: t.value }); t.value = ''; setTimeout(() => RemoteView.send({ kind: 'key', key: 'Enter' }), 150); } });
document.addEventListener('change', e => { if (e.target.matches?.('#rvView .rv-ct') && RemoteView.v) RemoteView.v.call('view-container', { id: RemoteView.v.s.id, container: e.target.value }).catch(err => toast(err.message)); });
