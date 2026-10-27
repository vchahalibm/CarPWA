'use strict';
/* ============================================================
   StudioGBee, the apps' side (design: docs/studiogbee.html § 5; the server is bee/server.mjs).
   An optional always-on hive a team runs (Docker): requests for a Mac or StudioGen that is offline wait there, and the
   answer comes back when it's online again (with a push to a DriveGen that is away); StudioGens keep a backup of their
   library there; bees of different teams can be linked. Without one, nothing changes.
   - The mesh lists its bees (`Mesh.m.bees`): an owner adds one with its address and admin code, and owners' presence
     carries the list, so every member connects by itself.
   - Signing in: the bee sends a challenge, the device signs it with its mesh device key (js/mesh.js); the bee checks it
     against the owner-signed roster.
   - Everything carried is sealed end to end with the pairwise key of the two members (AES-GCM, the sender, receiver and
     message id bound in), backups with a key made from the mesh's group key: the bee sees who, to whom, kind, size, time.
   - Requests that arrive here go to `Mesh.answer`, with the same checks as over the relays (only my devices, permissions).
   Loaded after meshview.js.
   ============================================================ */
const Bee = {
  socks: new Map(), waits: new Map(), keys: new Map(), seen: new Set(store.get('beeSeen', [])),
  list() { return Mesh.m?.bees || []; },
  /** The bees this device uses: all of the mesh's (tests can pin one with dd.beeHome). */
  home() { const h = store.get('beeHome', ''); return h ? this.list().filter(b => b.url === h) : this.list(); },
  up() { return [...this.socks.values()].some(s => s.authed); },
  any() { return [...this.socks.values()].find(s => s.authed); },
  wsUrl: u => u.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws',
  /** Connect to the bees the mesh lists (and only those). */
  start() {
    if (!Mesh.m || !Mesh._me) return;
    const want = new Set(this.home().map(b => b.url));
    for (const [u, s] of this.socks) if (!want.has(u) && !s.reg) { s.stop = true; try { s.ws?.close(); } catch {} this.socks.delete(u); }
    for (const u of want) if (!this.socks.has(u)) this.connect(u);
  },
  connect(url, reg) {
    const s = this.socks.get(url) || { url, tries: 0, calls: new Map() }; this.socks.set(url, s); if (reg) s.reg = reg; s.stop = false;
    if (location.protocol === 'https:' && /^(ws|http):/.test(url)) { s.error = 'This app is on https, so the bee needs an https address (wss): put it behind Tailscale serve or a tunnel'; this.onchange?.(); }
    let ws; try { ws = new WebSocket(this.wsUrl(url)); } catch (e) { s.error = e.message; return this.retry(s); }
    s.ws = ws; s.authed = false;
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.got(s, m).catch(err => Log.w('bee', 'Message not handled', { error: err.message })); };
    ws.onclose = () => { const was = s.authed; s.authed = false; for (const c of s.calls.values()) { clearTimeout(c.t); c.rej(new Error('StudioGBee went away')); } s.calls.clear(); if (was) { Log.i('bee', `Disconnected from ${s.bee?.name || url}`); this.onchange?.(); } if (!s.stop) this.retry(s); };
    ws.onerror = () => { s.error ||= 'Can’t reach it'; };
  },
  retry(s) { clearTimeout(s.t); s.tries++; s.t = setTimeout(() => { if (this.socks.get(s.url) === s && !s.stop) this.connect(s.url); }, Math.min(60000, 1500 * 2 ** Math.min(s.tries, 6))); },
  req(s, o, ms = 20000) {
    if (!s?.ws || s.ws.readyState !== 1) return Promise.reject(new Error('StudioGBee isn’t connected'));
    const rid = Math.random().toString(36).slice(2);
    return new Promise((res, rej) => { const t = setTimeout(() => { s.calls.delete(rid); rej(new Error('StudioGBee didn’t answer')); }, ms); s.calls.set(rid, { res, rej, t }); s.ws.send(JSON.stringify({ ...o, rid })); });
  },
  async got(s, m) {
    if (m.t === 'challenge') {
      s.bee = m.bee; const me = await Mesh.me(), mm = Mesh.m; if (!mm) return s.ws.close();
      const sig = await Mesh.signStr(`${m.nonce}|${mm.id}|${m.bee.id}`), base = { dev: me.id, mesh: mm.id, sig, app: meshApp(), ver: typeof webVer !== 'undefined' ? String(webVer) : '' };
      s.ws.send(JSON.stringify(s.reg ? { t: 'register', ...base, code: s.reg.code, roster: mm.roster, meshName: mm.name } : { t: 'auth', ...base }));
      return;
    }
    if ((m.t === 'ok' || m.t === 'error') && (m.re === 'auth' || m.re === 'register') && !m.rid) {
      if (m.t === 'error') { s.error = m.error; Log.w('bee', `${s.bee?.name || s.url}: ${m.error}`); if (s.reg) { const r = s.reg; s.reg = null; s.stop = true; this.socks.delete(s.url); try { s.ws.close(); } catch {} r.rej(new Error(m.error)); } this.onchange?.(); return; }
      s.authed = true; s.tries = 0; s.error = ''; s.owner = m.owner; s.bee = m.bee || s.bee; s.rosterRev = m.rosterRev; s.push = m.push;
      Log.i('bee', `Connected to ${s.bee?.name} (${s.url})`);
      if (s.reg) { const r = s.reg; s.reg = null; r.res(s); }
      this.sync(s); this.onchange?.();
      if (!LINK_HOST && store.get('beePush') && !m.push) this.notify(true).catch(() => {});
      if (LINK_HOST) setTimeout(() => this.backup().catch(() => {}), 5000);
      return;
    }
    if (m.t === 'ok' || m.t === 'error') { const c = s.calls.get(m.rid); if (!c) return; s.calls.delete(m.rid); clearTimeout(c.t); m.t === 'ok' ? c.res(m) : c.rej(new Error(m.error)); return; }
    if (m.t === 'msg') return this.onMsg(s, m);
    if (m.t === 'expired') return this.finish(m.id, { error: `${Mesh.member(m.to)?.name || 'It'} stayed offline, so StudioGBee gave up on the request` });
  },
  /** The bee keeps the roster to check who signs in: give it a newer one when the mesh's changes. */
  sync(s) { const r = Mesh.m?.roster; if (s?.authed && r && r.rev > (s.rosterRev || 0)) this.req(s, { t: 'roster', roster: r }).then(x => { s.rosterRev = x.rosterRev; }, () => {}); },

  /* ---------- Sealed messages ---------- */
  async key(peer) {
    const k = Mesh.pairKeys[peer]; if (!k) throw new Error('No key for that member yet');
    if (!this.keys.has(k)) this.keys.set(k, crypto.subtle.importKey('raw', b64u.dec(k), 'AES-GCM', false, ['encrypt', 'decrypt']));
    return this.keys.get(k);
  },
  async seal(from, to, id, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: meshEnc(`${from}|${to}|${id}`) }, await this.key(from === Mesh._me.id ? to : from), meshEnc(JSON.stringify(obj))));
    const p = new Uint8Array(12 + ct.length); p.set(iv); p.set(ct, 12); return b64u.enc(p);
  },
  async open(from, to, id, data) {
    const p = b64u.dec(data), pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.slice(0, 12), additionalData: meshEnc(`${from}|${to}|${id}`) }, await this.key(from === Mesh._me.id ? to : from), p.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  },
  /** A request to a member through the bee: waits there while it's offline (ttl), the answer comes back the same way.
      o.card: the Agent card it's for, kept so a late answer (after a reload) still lands on it. */
  async call(to, kind, payload, ttl = 600000, o = {}) {
    const s = this.any(); if (!s) throw new Error('StudioGBee isn’t connected');
    const me = (await Mesh.me()).id, id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const data = await this.seal(me, to, id, { kind, payload });
    if (o.card) store.set('beePending', { ...store.get('beePending', {}), [id]: { ...o, to, until: Date.now() + ttl } });
    const p = new Promise((res, rej) => this.waits.set(id, { res, rej }));
    await this.req(s, { t: 'send', id, to, kind: 'ask', data, ttl });
    Mesh.event('request', { to, kind, via: 'bee' });
    return p;
  },
  async onMsg(s, m) {
    const me = (await Mesh.me()).id; let body;
    for (let i = 0; i < 40 && !Mesh.pairKeys[m.from]; i++) await new Promise(r => setTimeout(r, 250)); // just started: the mesh's keys are still being made
    try { body = await this.open(m.from, me, m.id, m.data); } catch { s.ws.send(JSON.stringify({ t: 'ack', id: m.id })); return Log.w('bee', 'A message that can’t be opened (not for this key)'); }
    if (m.kind === 're') { s.ws.send(JSON.stringify({ t: 'ack', id: m.id })); return this.finish(body.rid, body); }
    if (m.kind !== 'ask') return;
    // a request: taken once (a resend after a lost ack is answered from memory), acknowledged at once, answered when done
    s.ws.send(JSON.stringify({ t: 'ack', id: m.id }));
    if (this.seen.has(m.id)) return; this.seen.add(m.id); store.set('beeSeen', [...this.seen].slice(-300));
    let a; try { a = { rid: m.id, result: await Mesh.answer(Mesh.pairRoom(m.from) || { peerId: m.from }, body.kind, body.payload || {}) }; } catch (e) { a = { rid: m.id, error: e.message }; }
    Log.i('bee', `Answered a waiting request from ${Mesh.member(m.from)?.name || m.from} (${body.kind})`, { waited: Date.now() - (m.at || Date.now()) });
    const id = `r${m.id}`, t = this.any() || s; await this.req(t, { t: 'send', id, to: m.from, kind: 're', data: await this.seal(me, m.from, id, a), ttl: 86400000 });
  },
  /** An answer (or the bee giving up): to the screen still waiting for it, else onto its card. */
  finish(rid, a) {
    const pend = store.get('beePending', {}), p = pend[rid]; if (p) { delete pend[rid]; store.set('beePending', pend); }
    const w = this.waits.get(rid); if (w) { this.waits.delete(rid); return a.error ? w.rej(new Error(a.error)) : w.res(a.result); }
    if (p && typeof Agent !== 'undefined') Agent.late(p, a);
  },

  /* ---------- Push: “your answer is ready” on a DriveGen that is away ---------- */
  async notify(quiet) {
    const s = this.any(); if (!s?.bee?.vapid) throw new Error('StudioGBee isn’t connected');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(isIOS ? 'Add DriveGen to your Home Screen first (Share › Add to Home Screen), then open it from there' : 'This browser can’t show notifications');
    if (!quiet && await Notification.requestPermission() !== 'granted') throw new Error('Notifications are off for DriveGen (allow them in the system settings)');
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (sub && store.get('beeVapid') !== s.bee.vapid) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u.dec(s.bee.vapid) });
    store.set('beeVapid', s.bee.vapid); store.set('beePush', true);
    await this.req(s, { t: 'push-sub', sub: sub.toJSON() }); s.push = true;
  },

  /* ---------- Backups of a StudioGen's library (sealed with a key made from the group key) ---------- */
  async boxKey() {
    const m = Mesh.m, base = await crypto.subtle.importKey('raw', b64u.dec(m.key), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: meshEnc(m.id), info: meshEnc('studiogbee-backup-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  library() { return { tasks: typeof Agent !== 'undefined' ? Agent.mine() : [], scripts: Scripts.mine().map(s => ({ name: s.name, json: s.json })), motions: typeof Mocap !== 'undefined' ? Mocap.saved() : {} }; },
  /** Backed up when it changed (checked every 10 minutes, and after connecting). */
  async backup(force) {
    const s = this.any(); if (!s || !LINK_HOST) return false;
    const lib = this.library(), h = await meshHash(JSON.stringify(lib) + Mesh.m.key);
    if (!force && h === store.get('beeBackupHash', '')) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.boxKey(), meshEnc(JSON.stringify({ ...lib, at: Date.now() }))));
    const p = new Uint8Array(12 + ct.length); p.set(iv); p.set(ct, 12);
    await this.req(s, { t: 'backup-put', kind: 'library', name: Mesh.myName(), data: b64u.enc(p) }, 60000);
    store.set('beeBackupHash', h); store.set('beeBackupAt', Date.now()); Log.i('bee', 'Library backed up', { tasks: lib.tasks.length, scripts: lib.scripts.length }); return true;
  },
  async backups() { return (await this.req(this.any(), { t: 'backup-list' })).list || []; },
  /** Take tasks, scripts and motions from a backup into this StudioGen (nothing here is replaced: same names are kept twice). */
  async restore(dev) {
    const r = await this.req(this.any(), { t: 'backup-get', dev, kind: 'library' }, 60000), p = b64u.dec(r.data);
    let lib; try { lib = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.slice(0, 12) }, await this.boxKey(), p.slice(12)))); } catch { throw new Error('This backup was made with an older key of the mesh (before someone was removed): it can’t be opened'); }
    let n = 0; const names = new Set(Scripts.all().map(s => s.name)), ids = new Set(Agent.mine().map(t => t.id));
    for (const t of lib.tasks || []) { Agent.put(ids.has(t.id) ? { ...t, id: `my.${Date.now().toString(36)}${n}`, name: `${t.name} (restored)` } : t); n++; }
    for (const s of lib.scripts || []) { Scripts.add({ ...s.json, name: names.has(s.name) ? `${s.name} (restored)` : s.name }); n++; }
    if (typeof Mocap !== 'undefined' && lib.motions) { const have = Mocap.saved(); for (const [k, v] of Object.entries(lib.motions)) if (!have[k]) { store.set('userMotions', { ...store.get('userMotions', {}), [k]: v }); n++; } }
    return n;
  },

  /* ---------- Owners: add a bee, the dashboard code, linking another team's bee ---------- */
  /** Add a bee to the mesh: its address and the admin code it printed when it started. */
  add(url, code) {
    url = String(url).trim().replace(/\/+$/, ''); if (!/^(https?|wss?):\/\//i.test(url)) url = `https://${url}`;
    if (!Mesh.amOwner()) return Promise.reject(new Error('Only a mesh owner adds a bee'));
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Nothing answered at that address')), 15000); this.connect(url, { code: String(code).trim(), res: s => { clearTimeout(t); res(s); }, rej: e => { clearTimeout(t); rej(e); } }); })
      .then(async s => { const bees = [...this.list().filter(b => b.url !== url), { url, id: s.bee.id, name: s.bee.name }]; await Mesh.save({ ...Mesh.m, bees, beesAt: Date.now() }); Mesh.pres(); this.start(); return s.bee.name; });
  },
  async remove(url) { await Mesh.save({ ...Mesh.m, bees: this.list().filter(b => b.url !== url), beesAt: Date.now() }); Mesh.pres(); const s = this.socks.get(url); if (s) { s.stop = true; try { s.ws.close(); } catch {} this.socks.delete(url); } },
  /** One bee's connection (by address), or any connected one. */
  sock(url) { const s = url ? this.socks.get(url) : this.any(); if (!s?.authed) throw new Error('StudioGBee isn’t connected'); return s; },
  async dashCode(url) { return (await this.req(this.sock(url), { t: 'dash-code' })).code; },
  /** reach: the address the other bee uses to call this one (its address in the mesh unless given). */
  async linkCode(url, reach) { const s = this.sock(url); return (await this.req(s, { t: 'link-code', url: reach || s.url })).code; },
  async linkJoin(code, url) { return this.req(this.sock(url), { t: 'link-join', code: String(code).trim() }); },
  async status(url) { return this.req(this.sock(url), { t: 'status' }); },

  /* ---------- Settings › Connections ---------- */
  html() {
    if (!Mesh.m) return '';
    const l = this.home(), owner = Mesh.amOwner(), s0 = this.any();
    const row = b => { const s = this.socks.get(b.url); return `<li>${s?.authed ? '🟢' : '⚪️'} <b>${esc(b.name || 'StudioGBee')}</b> <span class="se-note">${esc(b.url)}${s?.authed ? ' · connected' : s?.error ? ` · ${esc(s.error)}` : ' · connecting…'}</span>${owner ? ` <button class="link-btn" data-bee="remove|${esc(b.url)}">Remove</button>` : ''}</li>`; };
    return `<div class="lk-direct ${this.up() ? 'on' : ''}"><p><b>StudioGBee</b> (optional): an always-on place your team runs, where a request waits while a Mac is offline and the answer comes back when it's on again${LINK_HOST ? '; it also keeps a backup of this StudioGen’s tasks and scripts' : ', with a notification'}. It only sees sealed messages.</p>
      ${l.length ? `<ul class="av-report">${l.map(row).join('')}</ul>` : `<p class="se-note">${owner ? 'None yet: run one (bee/README.md: one Docker command) and add it here.' : 'None in this mesh yet (an owner adds one).'}</p>`}
      <div class="chip-row">${owner ? '<button class="chip accent" data-bee="add">+ Add a StudioGBee</button>' : ''}
        ${s0 && owner ? '<button class="chip" data-bee="dash">Dashboard code</button><button class="chip" data-bee="linkcode">Link another team’s bee</button><button class="chip" data-bee="linkjoin">Paste a link code</button>' : ''}
        ${s0 && !LINK_HOST ? `<button class="chip" data-bee="notify">${s0.push ? '✓ Notifications on' : 'Notify me when an answer is ready'}</button>` : ''}
        ${s0 && LINK_HOST ? `<button class="chip" data-bee="backup">Back up now</button><button class="chip" data-bee="restore">Restore…</button>` : ''}</div>
      ${s0 && LINK_HOST && store.get('beeBackupAt') ? `<p class="se-note">Last backup: ${esc(new Date(store.get('beeBackupAt')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</p>` : ''}</div>`;
  },
  redraw() { if (!$('#sheet').hidden && $('#sheet .lk-direct')) (LINK_HOST ? LinkHost.settings() : Link.settings()); },
};
Bee.onchange = () => { clearTimeout(Bee.rt); Bee.rt = setTimeout(() => Bee.redraw(), 300); };
// keep connected to what the mesh lists, give the bee newer rosters, back up when the library changes
setInterval(() => { Bee.start(); for (const s of Bee.socks.values()) Bee.sync(s); }, 10000);
setInterval(() => { Bee.backup().catch(() => {}); }, 600000);
setTimeout(() => Bee.start(), 2500);

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-bee]'); if (!b) return; e.stopPropagation();
  const [k, arg] = b.dataset.bee.split('|'), back = () => Bee.redraw(), fail = err => toast(err.message);
  if (k === 'add') return sheet('Add a StudioGBee', `<p class="se-note">Its address (where it runs: <code>http://localhost:8840</code> on this Mac, or its https address) and the admin code it printed when it started (<code>docker logs studiogbee</code>).</p>
    <label class="se-field"><span>Address</span><input id="beeUrl" value="http://localhost:8840" autocapitalize="off" autocorrect="off"></label><label class="se-field"><span>Admin code</span><input id="beeCode" autocapitalize="characters"></label>`,
    [['Add', () => Bee.add($('#beeUrl').value, $('#beeCode').value).then(n => { toast(`${n} added: the mesh's devices connect to it by themselves`); back(); }, err => sheet('Not added', `<p>${esc(err.message)}</p>`, [['Back', () => back()]]))], ['Cancel', back]]);
  if (k === 'remove') { await Bee.remove(arg); toast('Removed from the mesh'); return back(); }
  if (k === 'dash') return Bee.dashCode().then(c => { const u = (Bee.any().url || '').replace(/^ws/, 'http'); sheet('Dashboard code', `<div class="lk-code">${esc(c.replace(/(.{4})/, '$1 '))}</div><p class="se-note">Open <b>${esc(u)}/dashboard</b> and type this code (it works once, for 10 minutes). There, Settings › Add a passkey lets you sign in with Face ID or Touch ID next time.</p>`, [['Close', back]]); }, fail);
  if (k === 'linkcode') return sheet('Link another team’s bee', `<label class="se-field"><span>The address their bee reaches yours at (https, from the internet or their tailnet)</span><input id="beeReach" value="${esc(Bee.any()?.url || '')}" autocapitalize="off" autocorrect="off"></label>`,
    [['Make the code', () => Bee.linkCode(Bee.any()?.url, $('#beeReach').value.trim()).then(c => sheet('Link another team’s bee', `<p class="se-note">Give this code to the other team's mesh owner; they paste it in their StudioGen (StudioGBee › Paste a link code). Then accept their bee here or in the dashboard (Bees). Nothing goes between the bees before that. It works for a day.</p><textarea rows="4" readonly style="width:100%">${esc(c)}</textarea>`, [['Copy', () => navigator.clipboard?.writeText(c).then(() => toast('Copied'))], ['Close', back]]), fail)], ['Cancel', back]]);
  if (k === 'linkjoin') return sheet('Paste a link code', '<p class="se-note">The code another team’s owner gave you. Your bee asks theirs to link; it starts once they accept.</p><textarea id="beeLink" rows="4" style="width:100%"></textarea>',
    [['Link', () => Bee.linkJoin($('#beeLink').value).then(() => { toast('Asked: it starts once they accept'); back(); }, fail)], ['Cancel', back]]);
  if (k === 'notify') return Bee.notify().then(() => { toast('Notifications on: you’ll hear when a waiting answer is ready'); back(); }, fail);
  if (k === 'backup') return Bee.backup(true).then(() => { toast('Backed up'); back(); }, fail);
  if (k === 'restore') return Bee.backups().then(l => sheet('Restore from a backup', l.length ? `<p class="se-note">Tasks, scripts and motions are added to this StudioGen (nothing here is replaced).</p><div class="pick-list">${l.map(x => `<button class="big-btn" data-bee="take|${esc(x.dev)}">${esc(x.name)} · ${esc(new Date(x.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</button>`).join('')}</div>` : '<p>No backups in this mesh yet.</p>', [['Close', back]]), fail);
  if (k === 'take') return Bee.restore(arg).then(n => { toast(`${n} restored`); back(); }, fail);
}, true);
