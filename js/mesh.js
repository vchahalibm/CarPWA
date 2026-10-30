'use strict';
/* ============================================================
   The mesh: StudioGens and DriveGens of a team working as one network
   (docs/mesh.html). StudioGen shows and analyses it (js/meshview.js).
   - Identity: every app makes a device key pair once (ECDSA P-256 to sign,
     ECDH P-256 for pairwise keys); its id is a hash of the signing key.
   - The mesh: an id, a name, a group key, the relay list, and a roster of
     members (id, keys, name, app, role, who invited them, permissions)
     signed by an owner. Any member with an invite can add a device (an
     owner signs it in); owners remove members (the group key changes).
   - Transport: the relays of js/relay.js. The mesh's group channel is a
     relay "room" everyone shares (encrypted with the group key, every
     message signed by its sender): presence, telemetry, roster, shows,
     the shared catalogue. Requests between two members go in a quiet
     pairwise room (key from ECDH of their device keys), with the same
     requests as the one-to-one link (offers, run, say) plus mesh ones.
   - Telemetry adapts to the link: over a direct link everything, live;
     over relays light (presence rides on one message every 15 s, activity
     batched every 30 s within about 2 KB a minute, contents cut to 80
     characters, show progress only on step changes). Every device keeps a
     journal; StudioGen fetches the details when it wants them.
   - Shows (mesh mode): a conductor runs a script and the screens follow,
     in steps (each step at an agreed moment) or in tandem (cues).
   - Shared artifacts: scripts, motions, recordings are announced unless
     marked private on the StudioGen that made them; members fetch them.
   - History: StudioGen keeps the events (IndexedDB), a week by default.
   Loaded after linktest.js.
   ============================================================ */
const MESH_KEEP = [1, 7, 30, 90]; // days to keep the history (Settings, the Mesh screen)
const MESH_RELAY_BUDGET = 2048;   // bytes a minute of activity over relays, per device
const meshEnc = s => new TextEncoder().encode(s);
const meshB64 = buf => b64u.enc(buf);
const meshHash = async s => meshB64(await crypto.subtle.digest('SHA-256', meshEnc(s))).slice(0, 22);
const meshApp = () => LINK_HOST ? 'StudioGen' : APP_NAME; // the role (the network lab runs StudioGen's side in a plain browser)

Bus.define('mesh.cue', 'The show’s conductor sends a cue (mesh tandem shows)', 'the cue name');
const Mesh = {
  presence: {}, events: [], journal: store.get('meshJournal', []), outbox: [], sent: [], pairKeys: {}, shows: {}, catalogs: {},
  /* ---------- Identity ---------- */
  async me() {
    if (this._me) return this._me;
    let s = store.get('meshIdentity', null);
    if (!s) {
      const sig = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const ex = k => crypto.subtle.exportKey('jwk', k);
      s = { sigPub: await ex(sig.publicKey), sigPriv: await ex(sig.privateKey), dhPub: await ex(dh.publicKey), dhPriv: await ex(dh.privateKey) };
      s.id = await meshHash(JSON.stringify([s.sigPub.x, s.sigPub.y])); store.set('meshIdentity', s);
    }
    const imp = (j, alg, use) => crypto.subtle.importKey('jwk', j, alg, false, use);
    this._me = { ...s, sign: await imp(s.sigPriv, { name: 'ECDSA', namedCurve: 'P-256' }, ['sign']), dh: await imp(s.dhPriv, { name: 'ECDH', namedCurve: 'P-256' }, ['deriveBits']) };
    return this._me;
  },
  async signStr(str) { const me = await this.me(); return meshB64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, me.sign, meshEnc(str))); },
  async verifyStr(pub, str, sig) {
    try { const k = await crypto.subtle.importKey('jwk', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64u.dec(sig), meshEnc(str)); } catch { return false; }
  },
  /* ---------- The mesh and its roster ---------- */
  get m() { return store.get('mesh', null); },
  save(m) { store.set('mesh', m); return this.rebuild(); },
  members() { return this.m?.roster?.members || []; },
  member(id) { return this.members().find(x => x.id === id); },
  isOwner(id) { return this.member(id)?.role === 'owner'; },
  amOwner() { return !!this._me && this.isOwner(this._me.id); },
  rosterStr: r => JSON.stringify([r.rev, r.members.map(x => [x.id, x.sigPub.x, x.sigPub.y, x.dhPub.x, x.dhPub.y, x.name, x.app, x.role, !!x.mayInvite, x.perms || {}, x.invitedBy || ''])]),
  async signRoster(r) { const me = await this.me(); return { ...r, by: me.id, sig: await this.signStr(this.rosterStr(r)) }; },
  async rosterOk(r, trusted) { const signer = (trusted || r.members).find(x => x.id === r.by && x.role === 'owner'); return !!signer && this.verifyStr(signer.sigPub, this.rosterStr(r), r.sig); },
  selfEntry(me, role) { return { id: me.id, sigPub: me.sigPub, dhPub: me.dhPub, name: this.myName(), app: meshApp(), role, mayInvite: true, perms: { run: true, tasks: role === 'owner' }, joined: new Date().toISOString() }; },
  myName() { return store.get('meshName', '') || (LINK_HOST ? 'StudioGen' : Direct.myName()); },
  /** StudioGen: a new mesh, owned by this device; paired devices are invited over their pairing. */
  async create(name) {
    const me = await this.me();
    const roster = await this.signRoster({ rev: 1, members: [this.selfEntry(me, 'owner')] });
    this.save({ id: b64u.enc(crypto.getRandomValues(new Uint8Array(12))), name: name || 'My mesh', key: b64u.enc(crypto.getRandomValues(new Uint8Array(32))), brokers: Relay.list().brokers.map(b => b.url), brokersRev: 1, roster, created: new Date().toISOString(), used: [] });
    this.event('mesh', { what: 'created', name }); this.invitePaired(); return this.m;
  },
  /** An invite (any member who may invite): a code for a QR or a link, good for a day, once. */
  /** mine: an invite for one of your own devices (a StudioGen Worker, your other Mac): this StudioGen treats whoever joins
      with it as yours, and the invite says so, so the joiner may treat this one as its owner's (docs/studiogbee.html § 8). */
  async invite(role = 'member', mine = false) {
    const me = await this.me(), m = this.m; if (!m) throw new Error('No mesh');
    const t = b64u.enc(crypto.getRandomValues(new Uint8Array(9))), x = Date.now() + 86400000;
    if (mine) store.set('mineInvites', [...store.get('mineInvites', []), t].slice(-20));
    const owners = await Promise.all(this.members().filter(o => o.role === 'owner').map(o => meshHash(JSON.stringify([o.sigPub.x, o.sigPub.y]))));
    const s = await this.signStr(`${m.id}|${t}|${x}|${role}`);
    return 'SGM' + b64u.enc(meshEnc(JSON.stringify({ m: m.id, n: m.name, k: m.key, b: m.brokers, i: me.id, t, x, r: role, s, o: owners, ...(mine ? { y: 1 } : {}) })));
  },
  /** Join with an invite: keep the mesh's key and relays, and ask to be signed in (an owner does it when online). */
  /** trust: the invite is from one of your own devices (y), and you said so (a Worker's SG_MESH_INVITE, or a yes): the inviter is yours. */
  async join(code, trust = false) {
    if (!/^SGM[\w-]+$/.test(code)) throw new Error('That isn’t a mesh invite');
    const j = JSON.parse(new TextDecoder().decode(b64u.dec(code.slice(3)))); if (j.x < Date.now()) throw new Error('This invite has expired');
    const me = await this.me();
    if (this.m?.id === j.m && this.member(me.id)) return this.m; // already in
    await this.save({ id: j.m, name: j.n, key: j.k, brokers: j.b, brokersRev: 1, roster: { rev: 0, members: [] }, ownerHashes: j.o, pendingInvite: { i: j.i, t: j.t, x: j.x, r: j.r, s: j.s }, joined: new Date().toISOString() });
    if (j.y && trust) this.setOwn(j.i, true);
    setTimeout(() => this.sendJoin(), 2500); // once the relays are connected
    this.event('mesh', { what: 'joining', name: j.n }); return this.m;
  },
  async sendJoin() { const m = this.m, me = await this.me(); if (!m?.pendingInvite) return; this.group('join', { entry: this.selfEntry(me, m.pendingInvite.r === 'owner' ? 'owner' : 'member'), invite: m.pendingInvite }); },
  async leave() { this.group('bye', {}); store.set('mesh', null); this.rebuild(); },
  /** Owner: take someone out; the group key changes (sent to each remaining member over its own pairwise room). */
  async remove(id) {
    if (!this.amOwner()) throw new Error('Only an owner can remove members');
    const m = this.m, key = b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
    const roster = await this.signRoster({ rev: m.roster.rev + 1, members: this.members().filter(x => x.id !== id) });
    // In this order: everyone (the removed device too) hears the new roster under the current key; the others then get the new key
    // over their own pairwise rooms; only then does this Mac switch (the old key stays readable 10 minutes for messages on their way).
    await this.save({ ...m, roster }); await this.group('roster', { roster });
    for (const x of roster.members) if (x.id !== this._me.id) { const room = this.pairRoom(x.id); if (room) await Relay.post(room, 'mesh-key', { key, rev: roster.rev }); }
    await new Promise(r => setTimeout(r, 1500));
    await this.save({ ...this.m, oldKey: m.key, key, oldUntil: Date.now() + 600000 }); this.event('mesh', { what: 'removed', who: id });
  },
  /** Owner: change names, roles, permissions (signed, sent to all). */
  async updateMember(id, patch) {
    if (!this.amOwner()) throw new Error('Only an owner can change members');
    const roster = await this.signRoster({ rev: this.m.roster.rev + 1, members: this.members().map(x => x.id === id ? { ...x, ...patch } : x) });
    await this.save({ ...this.m, roster }); this.group('roster', { roster }); // after the rooms are rebuilt, or the message is lost
  },
  /** Owner: a new relay list for everyone, signed (no pairing again inside a mesh). */
  async updateBrokers() {
    if (!this.amOwner()) return; const brokers = Relay.list().brokers.map(b => b.url), rev = (this.m.brokersRev || 1) + 1, s = await this.signStr(`brokers|${rev}|${brokers.join(',')}`);
    await this.save({ ...this.m, brokers, brokersRev: rev }); this.group('brokers', { brokers, rev, s });
  },
  /** StudioGen: invite the devices already paired with it (over their encrypted pairing; they join by themselves). */
  async invitePaired() { if (!LINK_HOST || !this.m) return; for (const p of Relay.peers()) Relay.post(p, 'mesh-invite', { code: await this.invite('member') }); },
  /** StudioGen: a paired device said hello and isn't in the mesh yet: invite it (at most every 10 minutes). */
  async maybeInvite(room) {
    if (!LINK_HOST || !this.m || !store.get('meshAutoJoin', true) || (room.meshId && this.member(room.meshId))) return;
    (this.invited ||= {}); if (Date.now() - (this.invited[room.room] || 0) < 600000) return; this.invited[room.room] = Date.now();
    Relay.post(room, 'mesh-invite', { code: await this.invite('member') });
  },

  /* ---------- Rooms for the relays: the group channel, and a quiet pairwise room per member ---------- */
  async rebuild() {
    const m = this.m; this.groupRoom = null; this.pairRooms = [];
    if (m?.key) {
      this.groupRoom = { room: `mesh:${m.id}`, group: true, quiet: true, key: m.key, oldKey: m.oldKey, oldUntil: m.oldUntil, brokers: m.brokers, topic: `sg1/m${(await meshHash(`mesh-topic:${m.id}`)).slice(0, 24)}`, name: m.name };
      const me = await this.me();
      for (const x of this.members()) if (x.id !== me.id && (LINK_HOST || x.app === 'StudioGen')) {
        if (!this.pairKeys[x.id]) {
          const pub = await crypto.subtle.importKey('jwk', x.dhPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
          const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, me.dh, 256);
          const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
          this.pairKeys[x.id] = meshB64(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: meshEnc(m.id), info: meshEnc('studiogen-mesh-pair-v1') }, base, 256));
        }
        this.pairRooms.push({ room: `mp:${await meshHash([me.id, x.id].sort().join('|') + m.id)}`, mesh: true, quiet: true, peerId: x.id, key: this.pairKeys[x.id], brokers: m.brokers, name: x.name });
      }
    }
    if (typeof Relay !== 'undefined') { if (Relay.started) await Relay.plan(); else Relay.start(); } // new rooms join the running connections (a restart would drop what's being sent)
    this.onchange?.();
  },
  rooms() { return [...(this.groupRoom ? [this.groupRoom] : []), ...(this.pairRooms || [])]; },
  pairRoom(id) { return (this.pairRooms || []).find(r => r.peerId === id); },
  dirOut(room) { return (this._me?.id || '') < room.peerId ? 'm-a' : 'm-b'; },
  heard() { const t = Object.values(this.presence).map(p => p.at); return t.length ? Math.max(...t) : 0; },

  /* ---------- The group channel: signed messages ---------- */
  async group(type, data) {
    if (!this.groupRoom) return false; const me = await this.me(), ts = Date.now();
    // what changes the mesh or a show is sent again in case a relay drops it; presence and activity aren't (the next one comes soon)
    return Relay.post(this.groupRoom, type, { from: me.id, ts, data, sig: await this.signStr(`${type}|${ts}|${me.id}|${JSON.stringify(data)}`) }, /^(roster|brokers|join|bye|show-)/.test(type));
  },
  async onGroup(room, type, b) {
    const me = await this.me(); if (!b?.from || b.from === me.id) return;
    // Members' keys come from the roster; a joiner (no roster yet) checks a roster message with the key inside it (onRoster then
    // checks the roster's own signature against the owner its invite named), and a join with the joiner's own key.
    const pub = this.member(b.from)?.sigPub || (type === 'join' ? b.data?.entry?.sigPub : type === 'roster' ? b.data?.roster?.members?.find(x => x.id === b.from)?.sigPub : null);
    if (!pub || !await this.verifyStr(pub, `${type}|${b.ts}|${b.from}|${JSON.stringify(b.data)}`, b.sig)) return; // only members (or a joiner with its own key) speak here
    const d = b.data || {}, from = b.from;
    if (type === 'join') return this.onJoin(d);
    if (type === 'roster') return this.onRoster(d.roster);
    if (type === 'brokers') { if (this.isOwner(from) && d.rev > (this.m.brokersRev || 1) && await this.verifyStr(this.member(from).sigPub, `brokers|${d.rev}|${d.brokers.join(',')}`, d.s)) { this.save({ ...this.m, brokers: d.brokers, brokersRev: d.rev }); this.event('mesh', { what: 'new relay list', rev: d.rev }); } return; }
    if (type === 'bye') { delete this.presence[from]; this.event('mesh', { what: 'left', who: from }, from); return; }
    if (type === 'pres') { if (!this.presence[from]) { this.lastCat = null; clearTimeout(this.catT); this.catT = setTimeout(() => this.pres(), 500 + Math.random() * 1500); if (typeof MeshDirect !== 'undefined') setTimeout(() => MeshDirect.tick(), 3000); } /* someone new or back: they need our catalog */ this.presence[from] = { ...d, at: Date.now(), clock: b.ts - Date.now() }; if (d.bees && this.isOwner(from) && (d.beesAt || 0) > (this.m.beesAt || 0)) { this.save({ ...this.m, bees: d.bees, beesAt: d.beesAt }); if (typeof Bee !== 'undefined') setTimeout(() => Bee.start(), 500); } /* an owner's list of StudioGBees (js/bee.js) */ if (d.cat) this.catalogs[from] = d.cat; this.onchange?.(); if (this.m.pendingInvite && !this.member(me.id) && this.isOwner(from)) this.sendJoin(); return; }
    if (type === 'ev') { this.ingest(d.e || [], from, 'relay'); return; }
    if (type === 'cat') { this.catalogs[from] = d.cat; this.onchange?.(); return; }
    if (type.startsWith('show-')) return this.onShow(type, d, from, b.ts);
  },
  async onJoin(d) {
    // One of your own devices joining with your “mine” invite: yours here (whoever signs it in)
    if (d.invite?.i === this._me?.id && d.entry?.id && store.get('mineInvites', []).includes(d.invite.t)) this.setOwn(d.entry.id, true);
    // An owner signs in a joiner whose invite was made by a member who may invite, unexpired, unused.
    if (!this.amOwner() || !d.entry || !d.invite) return;
    const inv = d.invite, inviter = this.member(inv.i);
    if (this.member(d.entry.id)) return this.group('roster', { roster: this.m.roster }); // already in (it missed the roster): resend it
    if (!inviter?.mayInvite || inv.x < Date.now() || (this.m.used || []).includes(inv.t) || !await this.verifyStr(inviter.sigPub, `${this.m.id}|${inv.t}|${inv.x}|${inv.r}`, inv.s)) return;
    if (d.entry.id !== await meshHash(JSON.stringify([d.entry.sigPub.x, d.entry.sigPub.y]))) return;
    const entry = { ...d.entry, role: inv.r === 'owner' && this.isOwner(inv.i) ? 'owner' : 'member', invitedBy: inv.i, perms: { run: true, tasks: false }, joined: new Date().toISOString() };
    const roster = await this.signRoster({ rev: this.m.roster.rev + 1, members: [...this.members(), entry] });
    await this.save({ ...this.m, roster, used: [...(this.m.used || []), inv.t].slice(-200) }); this.group('roster', { roster });
    this.event('mesh', { what: 'joined', who: entry.id, name: entry.name, by: inv.i }); toast(`${entry.name} joined the mesh`);
  },
  async onRoster(r) {
    const m = this.m; if (!r || r.rev <= (m.roster?.rev || 0)) return;
    const trusted = m.roster?.members?.length ? m.roster.members : null;
    if (trusted) { if (!await this.rosterOk(r, trusted)) return; }
    else { // joining: trust an owner the invite named
      const signer = r.members.find(x => x.id === r.by && x.role === 'owner'); if (!signer) return;
      if (!(m.ownerHashes || []).includes(await meshHash(JSON.stringify([signer.sigPub.x, signer.sigPub.y]))) || !await this.rosterOk(r)) return;
    }
    const me = await this.me(), wasIn = !!this.member(me.id), nowIn = r.members.some(x => x.id === me.id);
    if (wasIn && !nowIn) { toast('You were removed from the mesh'); store.set('mesh', null); return this.rebuild(); }
    this.save({ ...m, roster: r, pendingInvite: nowIn ? null : m.pendingInvite });
    if (!wasIn && nowIn) { toast(`You’re in the mesh “${m.name}”`); this.event('mesh', { what: 'joined', name: m.name }); }
  },

  /* ---------- Presence and telemetry ---------- */
  /** What this device is doing now, its links, what it offers: one small signed message every 15 s. */
  async pres() {
    if (!this.groupRoom) return;
    const links = [];
    if (Direct.connected) links.push({ to: Direct.peerMeshId || null, name: Direct.peer, kind: 'direct', rtt: (await LinkTest.directStats().catch(() => ({}))).rtt ?? null });
    for (const r of Relay.rooms().filter(x => !x.group && !x.mesh)) { const on = LINK_HOST ? Relay.online[r.room] : Relay.online.mac; if (on && Date.now() - on < 60000) links.push({ to: r.meshId || null, name: r.name, kind: Direct.connected && Direct.peer === r.name ? 'direct' : 'relay' }); }
    if (Link.mac()?.token) links.push({ to: null, name: Link.mac().name, kind: 'tailscale' });
    if (typeof MeshDirect !== 'undefined') for (const l of MeshDirect.list()) if (!links.some(x => x.to === l.to && x.kind === 'direct')) links.push(l);
    this.myLinks = links;
    const now = Script.running ? { script: Script.cur?.name, step: Script.i + 1, of: Script.cur?.beats?.length || 0, mode: Script.cur?.mode, jobs: (Script.jobs || []).filter(j => j.state === 'running').map(j => j.name) } : null;
    const d = { name: this.myName(), app: meshApp(), ver: typeof webVer !== 'undefined' ? webVer : null, shell: window.DriveDeckDesktop?.updates ? DesktopUpdates?.s?.shell || null : null,
      ...(this.amOwner() && this.m.bees ? { bees: this.m.bees, beesAt: this.m.beesAt || 0 } : {}), device: Direct.myName().replace(/^.* on /, ''), stage: typeof Stage !== 'undefined' && Stage.on, now, links, relays: this.groupRoom ? Relay.active(this.groupRoom) : [], show: this.myShow || null,
      caps: LINK_HOST ? { scripts: LinkHost.scripts().map(s => s.name), agent: typeof Agent !== 'undefined' ? Agent.offered(false).map(t => t.name) : [], llm: typeof LLM !== 'undefined' && LLM.cfg().share && LLM.health?.ok ? LLM.cfg().model : null, tasks: typeof OsTasks !== 'undefined' && OsTasks.can(), data: !!window.DriveDeckDesktop?.data } : {} };
    const catHash = await meshHash(JSON.stringify(this.catalog())); if (catHash !== this.lastCat || this.catRev !== this.m.roster?.rev || Date.now() - (this.catAt || 0) > 300000) { d.cat = this.catalog(); this.lastCat = catHash; this.catRev = this.m.roster?.rev; this.catAt = Date.now(); } // again when it changes, when members change, and every 5 min
    this.group('pres', d);
  },
  /** Something happened here: kept in the journal; sent full over a direct link to a StudioGen, light over the relays. */
  event(kind, data, dev) {
    const e = { id: Math.random().toString(36).slice(2, 10), ts: Date.now(), dev: dev || this._me?.id || 'me', kind, data };
    this.journal.push(e); if (this.journal.length > 2000) this.journal.splice(0, this.journal.length - 2000);
    clearTimeout(this.jt); this.jt = setTimeout(() => store.set('meshJournal', this.journal), 2000);
    if (!dev) { this.ingest([e], e.dev, 'self'); this.outbox.push(e); this.flushSoon(); }
  },
  flushSoon() { if (this.ft) return; this.ft = setTimeout(() => { this.ft = 0; this.flush(); }, Direct.connected || (typeof MeshDirect !== 'undefined' && MeshDirect.list().length) ? 1000 : 30000); },
  cut: (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; },
  /** Send the outbox: everything over a direct link (contents up to 300 characters); over relays within the budget (contents 80). */
  async flush() {
    if (!this.outbox.length || !this.groupRoom) return;
    const box = this.outbox.splice(0), slim = (e, n) => ({ ...e, data: Object.fromEntries(Object.entries(e.data || {}).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'object' ? this.cut(v, n) : v])) });
    if (Direct.connected && Direct.peerIsStudio) { Direct.send({ mev: box.map(e => slim(e, 300)) }); }
    if (typeof MeshDirect !== 'undefined') for (const [id, x] of Object.entries(this.presence)) if (x.app === 'StudioGen' && !MeshDirect.viaDirect(id)) MeshDirect.send(id, { mev: box.map(e => slim(e, 300)) });
    const now = Date.now(); this.sent = this.sent.filter(s => now - s.at < 60000);
    let used = this.sent.reduce((a, s) => a + s.n, 0); const out = [];
    for (const e of box) { const s = slim(e, 80), n = JSON.stringify(s).length; if (used + n > MESH_RELAY_BUDGET) { out.push({ id: e.id, ts: e.ts, dev: e.dev, kind: 'more', data: { n: box.length - out.length } }); break; } out.push(s); used += n; }
    if (out.length) { const n = JSON.stringify(out).length; this.sent.push({ at: now, n }); this.group('ev', { e: out }); }
  },
  /** Events arriving (from the group channel, a direct link, the journal of a device): StudioGen keeps them. */
  ingest(list, from, via) {
    for (const e of list) { if (!e?.id || this.events.some(x => x.id === e.id && x.dev === e.dev)) continue; e.via = via; this.events.push(e); if (LINK_HOST) MeshStore.add(e); }
    if (this.events.length > 3000) this.events.splice(0, this.events.length - 3000);
    this.onevent?.(list);
  },
  /** StudioGen: the full journal of a device since a time (over its pairwise room or the pairing). */
  async details(id, since = Date.now() - 3600000) {
    const room = this.pairRoom(id); if (!room) throw new Error('No room to that device');
    const r = await this.call(id, 'mesh-journal', { since }, 30000); this.ingest(r.events || [], id, 'journal'); return (r.events || []).length;
  },
  /** A request over the pairing (relay or direct link, not a mesh room): in the activity too. */
  pairedRequest(kind, p, r, ms, fromId, fromName) {
    if (!this.m || (kind !== 'run' && kind !== 'say')) return;
    this.event('request', { from: fromId || '', fromName: fromName || '', kind, via: 'pairing', script: p.script || (p.id && Scripts.get(p.id)?.name) || '', text: p.text || '', ms, rows: r?.rows?.length || 0, result: [].concat(r?.said || []).join(' ') });
  },
  /** One of this StudioGen's owner's own devices (docs/studiogbee.html): a device paired with this Mac (pairing is only for
      your own devices), or one ticked “Yours” in Mesh › Devices. Kept on this Mac, not in the roster, so no mesh owner can
      make their device “yours”. Own devices may run what needs this Mac's sign-ins; the mesh's permissions don't limit them. */
  own(id) { return this.ownHere(id) || Object.entries(store.get('myDevicesVia', {})).some(([by, l]) => this.ownHere(by) && l.includes(id)); },
  /** Yours by this StudioGen's own knowledge (not by what another said): this one, paired, or ticked. */
  ownHere(id) { return !!id && (id === this._me?.id || store.get('myDevices', []).includes(id) || (typeof Relay !== 'undefined' && Relay.isMac() && Relay.peers().some(p => p.meshId === id))); },
  /** What this StudioGen tells its owner's other StudioGens (own-sync): the devices it knows are yours. */
  ownList() { return this.members().map(x => x.id).filter(id => this.ownHere(id)); },
  setOwn(id, on) { const s = new Set(store.get('myDevices', [])); on ? s.add(id) : s.delete(id); store.set('myDevices', [...s]); },
  /** Requests a member may send here (mesh-* ones, and the link's run/say/offers when its permissions allow). */
  async answer(room, kind, p, via) { // via 'direct': it came over a direct link between the two (js/meshdirect.js)
    const who = this.member(room.peerId); if (!who) throw new Error('Not a member of the mesh');
    const own = this.own(who.id);
    if (kind === 'mesh-journal') return { events: this.journal.filter(e => e.ts >= (p.since || 0) && !e.private).slice(-400) };
    if (kind === 'mesh-art') return this.artifact(p.k, p.n);
    if (kind === 'mesh-show') { if (!own && who.perms?.run === false) throw new Error('This device may not run shows on this Mac (the mesh owner can allow it)'); const r = await MeshCmd.showOp(p); this.event('request', { from: who.id, fromName: who.name, kind: 'show', script: `${p.op}${p.script ? ' ' + p.script : ''}` }); return r; }
    if ((kind === 'run' || kind === 'say') && !own && who.perms?.run === false) throw new Error('This device may not run scripts on this Mac (the mesh owner can allow it)');
    if (kind === 'task' && !own && who.perms?.agent === false) throw new Error('This device may not run tasks on this Mac (the mesh owner can allow it)');
    if (kind === 'tasks' && !own && who.perms?.agent === false) return { tasks: [] };
    if (kind === 'own-sync') { // one of your own StudioGens says which devices are yours (a Worker learns your phone this way)
      if (!this.ownHere(who.id)) throw new Error('Not one of this owner’s devices');
      const l = (p.devs || []).filter(id => this.member(id)).slice(0, 100); store.set('myDevicesVia', { ...store.get('myDevicesVia', {}), [who.id]: l }); return { ok: true, n: l.length };
    }
    const t0 = Date.now(), r = await Direct.handle(kind, { ...p, from: who.name }, { via: 'mesh', meshId: who.id, name: who.name, direct: via === 'direct' });
    if (kind === 'run' || kind === 'say') this.event('request', { from: who.id, fromName: who.name, kind, script: p.script || '', text: p.text || '', ms: Date.now() - t0, rows: r?.rows?.length || 0, result: (r?.said || []).join(' ') });
    return r;
  },

  /** A request to a member: over a direct link between the two when there is one, else through their pair room. */
  async call(id, kind, payload, ms) {
    if (typeof MeshDirect !== 'undefined' && MeshDirect.open(id)) { try { return await MeshDirect.call(id, kind, payload, ms); } catch (e) { if (!/no direct link|closed/.test(e.message)) throw e; } }
    const room = this.pairRoom(id); if (!room) throw new Error('That device isn’t reachable in the mesh');
    return Relay.call(kind, payload, ms, room);
  },
  /* ---------- Shows (mesh mode) ---------- */
  /** Conductor: start a show on chosen screens; steps mode (all together) or tandem (cues). */
  async showStart(scriptId, screens, mode = 'steps') {
    const s = Scripts.get(scriptId); if (!s) throw new Error('No such script');
    const id = Math.random().toString(36).slice(2, 8), me = await this.me();
    this.shows[id] = { id, script: s.name, conductor: me.id, screens, mode, step: 0, of: s.json?.beats?.length || 0, lanes: {}, started: Date.now() };
    this.group('show-prepare', { id, mode, screens, json: s.json, name: s.name });
    this.event('show', { what: 'started', show: id, script: s.name, screens: screens.length, mode });
    setTimeout(async () => { this.conducting = id; await Script.start({ ...s.json, listen: false }); this.showStep(id, 0); this.presSoon(); }, 1500);
    return id;
  },
  /** A show changed here: presence goes out now (not in up to 15 s), so every Who's around and badge follows. */
  presSoon() { clearTimeout(this.pst); this.pst = setTimeout(() => this.pres(), 800); },
  showStep(id, n) {
    const sh = this.shows[id]; if (!sh) return; sh.step = n; this.presSoon();
    const lead = 900; this.group('show-step', { id, n, at: Date.now() + lead }); // screens move at the same moment
    this.event('show', { what: 'step', show: id, step: n + 1 });
  },
  showCue(id, name) { this.group('show-cue', { id, name }); this.event('show', { what: 'cue', show: id, cue: name }); },
  showStop(id) { this.group('show-stop', { id }); if (this.conducting === id) { this.conducting = null; Script.stop(); } const sh = this.shows[id]; if (sh) sh.ended = Date.now(); this.event('show', { what: 'stopped', show: id }); this.presSoon(); },
  async onShow(type, d, from, ts) {
    const me = await this.me(), offset = this.presence[from]?.clock || 0;
    if (type === 'show-sync') { const sh = this.shows[d.id]; if (sh) { sh.lanes[from] = { ...d, at: Date.now() }; this.onchange?.(); } return; }
    if (type === 'show-prepare') { this.shows[d.id] = { id: d.id, script: d.name, conductor: from, screens: d.screens, mode: d.mode, step: 0, of: d.json?.beats?.length || 0, lanes: {}, started: Date.now() };
      if (!d.screens.includes(me.id)) return; this.myShow = { id: d.id, step: 0, state: 'loading' };
      await Script.start({ ...d.json, listen: false }); this.myShow.state = 'ready'; this.group('show-sync', { id: d.id, step: 0, state: 'ready' }); return; }
    const sh = this.shows[d.id]; if (!sh) return;
    if (type === 'show-step') { sh.step = d.n; if (!this.myShow || this.myShow.id !== d.id) return;
      const wait = Math.max(0, d.at - (Date.now() + offset)); // the conductor's moment, on our clock
      setTimeout(() => { const late = Math.round(Date.now() + offset - d.at); if (sh.mode === 'steps') Script.jump(d.n); this.myShow = { id: d.id, step: d.n, state: 'on', drift: late }; this.group('show-sync', { id: d.id, step: d.n, state: 'on', drift: late }); this.presSoon(); }, wait); return; }
    if (type === 'show-cue') { if (this.myShow?.id === d.id) Bus.emit('mesh.cue', { value: d.name }); return; }
    if (type === 'show-stop') { sh.ended = Date.now(); if (this.myShow?.id === d.id) { this.myShow = null; Script.stop(true); this.presSoon(); } this.onchange?.(); }
  },

  /* ---------- Shared artifacts ---------- */
  privateSet: () => new Set(store.get('meshPrivate', [])),
  isPrivate(k, n) { return this.privateSet().has(`${k}:${n}`); },
  setPrivate(k, n, on) { const s = this.privateSet(); on ? s.add(`${k}:${n}`) : s.delete(`${k}:${n}`); store.set('meshPrivate', [...s]); this.pres(); },
  /** What this StudioGen shares (not private): kind, name, a version (size and a short hash of the content). */
  catalog() {
    if (!LINK_HOST) return [];
    const items = [...Scripts.mine().map(s => ['script', s.name, s.json]), ...Object.entries(typeof Mocap !== 'undefined' ? Mocap.saved() : {}).map(([k, m]) => ['motion', k, m]),
      ...(typeof WebDrive !== 'undefined' ? WebDrive.recs().map(r => ['webrec', r.name, r]) : []), ...(typeof AppSteps !== 'undefined' ? AppSteps.recs().map(r => ['apprec', r.name, r]) : []), ...(typeof Agent !== 'undefined' ? Agent.mine().filter(t => t.share).map(t => ['task', t.name, t]) : [])];
    return items.filter(([k, n]) => !this.isPrivate(k, n)).map(([k, n, v]) => { const j = JSON.stringify(v); let h = 0; for (let i = 0; i < j.length; i++) h = (h * 31 + j.charCodeAt(i)) | 0; return { k, n, s: j.length, v: (h >>> 0).toString(36) }; });
  },
  artifact(k, n) {
    if (this.isPrivate(k, n)) throw new Error('That one is private');
    const v = k === 'script' ? Scripts.mine().find(s => s.name === n)?.json : k === 'motion' ? Mocap.saved()[n] : k === 'webrec' ? WebDrive.recs().find(r => r.name === n) : k === 'apprec' ? AppSteps.recs().find(r => r.name === n) : k === 'task' ? Agent.mine().find(t => t.share && t.name === n) : null;
    if (!v) throw new Error('Not found'); if (JSON.stringify(v).length > 200000) throw new Error('Too big to send over the mesh (200 KB)'); return { k, n, v };
  },
  /** Fetch a shared artifact from its owner and keep it here (names that exist get “(2)”, like an imported bundle). */
  async fetch(owner, k, n) {
    const room = this.pairRoom(owner); if (!room) throw new Error('No room to that device');
    const a = await this.call(owner, 'mesh-art', { k, n }, 60000);
    if (k === 'script') Scripts.add({ ...a.v, name: Scripts.all().some(s => s.name === a.v.name) ? `${a.v.name} (from ${this.member(owner)?.name || 'the mesh'})` : a.v.name });
    if (k === 'motion') Mocap.save(MOTIONS[n] ? `${n}2` : n, a.v);
    if (k === 'webrec') WebDrive.saveRec({ ...a.v, name: `${a.v.name} (mesh)` });
    if (k === 'apprec') AppSteps.saveRec({ ...a.v, name: `${a.v.name} (mesh)` });
    if (k === 'task') Agent.put({ ...a.v, id: `my.${Date.now().toString(36)}`, share: false, name: Agent.all().some(t => t.name === a.v.name) ? `${a.v.name} (from ${this.member(owner)?.name || 'the mesh'})` : a.v.name });
    this.event('share', { what: 'fetched', kind: k, name: n, from: owner }); return true;
  },
  /** Request mode: which StudioGen offers a script (by name), online now. */
  whoOffers(script) { const p = plain(script); return Object.entries(this.presence).filter(([id, x]) => Date.now() - x.at < 60000 && x.app === 'StudioGen' && (x.caps?.scripts || []).some(n => plain(n) === p || plain(n).includes(p))).map(([id]) => id); },
  async runOn(id, script, vars = {}) { const room = this.pairRoom(id); if (!room) throw new Error('That device isn’t reachable in the mesh'); this.event('request', { to: id, kind: 'run', script }); return this.call(id, 'run', { script, vars }, 600000); },
  /** DriveGen's “who's around”: the StudioGens online and what they do. */
  around() { return Object.entries(this.presence).filter(([, x]) => Date.now() - x.at < 60000).map(([id, x]) => ({ id, ...x })); },

  /* ---------- Running ---------- */
  start() {
    this.me().then(() => this.rebuild());
    clearInterval(this.pt); this.pt = setInterval(() => { if (this.m?.pendingInvite && !this.member(this._me?.id)) this.sendJoin(); /* waiting to be signed in: ask again */ else if (this.m) this.pres(); for (const [id, p] of Object.entries(this.presence)) if (Date.now() - p.at > 90000) { delete this.presence[id]; this.event('presence', { what: 'offline', who: id, name: p.name }, id); this.onchange?.(); } }, 15000);
    setTimeout(() => this.m && this.pres(), 4000);
    // Activity worth knowing about, from the rest of the app.
    Bus.on('script.beat', d => { if (this.conducting) this.showStep(this.conducting, d.index ?? Script.i); this.event('script', { what: 'step', script: Script.cur?.name, step: (d.index ?? 0) + 1, title: d.value }); });
    Bus.on('script.end', d => { this.event('script', { what: 'ended', script: d.value }); if (this.conducting) this.showStop(this.conducting); });
    Bus.on('script.job', d => this.event('job', { what: d.ok ? 'done' : 'failed', name: d.value }));
    Bus.on('link.direct', d => this.event('link', { what: 'direct up', with: d.value }));
  },
};
/* ---------- StudioGen's history of events (IndexedDB), kept a week by default ---------- */
const MeshStore = {
  db() { return this._db ||= new Promise((res, rej) => { const r = indexedDB.open('dd-mesh', 1); r.onupgradeneeded = () => { const s = r.result.createObjectStore('ev', { keyPath: ['ts', 'id'] }); s.createIndex('ts', 'ts'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  keepDays: () => +(store.get('meshKeepDays', 7)) || 7,
  async add(e) { try { const d = await this.db(); d.transaction('ev', 'readwrite').objectStore('ev').put(e); } catch {} },
  async range(from, to = Date.now()) { const d = await this.db(); return new Promise(res => { const out = [], q = d.transaction('ev').objectStore('ev').index('ts').openCursor(IDBKeyRange.bound(from, to)); q.onsuccess = () => { const c = q.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; q.onerror = () => res(out); }); },
  async prune() { try { const d = await this.db(), cut = Date.now() - this.keepDays() * 86400000, t = d.transaction('ev', 'readwrite'), q = t.objectStore('ev').index('ts').openCursor(IDBKeyRange.upperBound(cut)); q.onsuccess = () => { const c = q.result; if (c) { c.delete(); c.continue(); } }; } catch {} },
  async clear() { const d = await this.db(); d.transaction('ev', 'readwrite').objectStore('ev').clear(); },
};
if (LINK_HOST) { MeshStore.prune(); setInterval(() => MeshStore.prune(), 3600000); }
Mesh.start();

/* ---------- Mesh commands: what voice and typed commands (js/commands.js, group “Mesh” and “Your Mac”)
   and the tandem tests ask for. Every reply goes through say(). ---------- */
const MeshCmd = {
  ALL: /^(all|every|each)( the)? (screens?|macs?|studiogens?|devices?)$|^everywhere$/,
  me: () => Mesh._me?.id,
  /** A member by what was said: a name or part of it; “my Mac” is the paired StudioGen. */
  dev(q) {
    const p = plain(q).replace(/^(the|my) /, ''); if (!p) return null;
    if (/^(mac|computer|laptop|studiogen)$/.test(p) && !LINK_HOST) return Relay.mac()?.meshId || null;
    if (/^(this|here|this mac|me)$/.test(p)) return this.me();
    const ms = Mesh.members(); return (ms.find(x => plain(x.name) === p) || ms.find(x => plain(x.name).includes(p) || p.includes(plain(x.name))))?.id || null;
  },
  script(q) { const p = plain(q).replace(/^the /, ''); const l = Scripts.all(); return l.find(s => plain(s.name) === p) || l.find(s => plain(s.name).includes(p)); },
  name: id => Mesh.member(id)?.name || 'that device',
  online: () => Object.entries(Mesh.presence).filter(([, x]) => Date.now() - x.at < 60000),
  studios() { return this.online().filter(([, x]) => x.app === 'StudioGen').map(([id]) => id); },
  /** The StudioGen running the show now (any member knows it from show-prepare). */
  conductor() { if (Mesh.conducting) return this.me(); return Object.values(Mesh.shows).filter(s => !s.ended).sort((a, b) => b.started - a.started)[0]?.conductor || null; },
  async go(op, v, say) {
    try {
      if (!['create', 'join', 'pair', 'test', 'direct', 'rekey'].includes(op) && !Mesh.m) return say('You’re not in a mesh yet. On StudioGen: Mesh, Create a mesh; then invite the others.');
      return await this[op](v, say);
    } catch (e) { say(`That didn’t work: ${e.message}`); }
  },
  async who(v, say) {
    closeSheet(); openView('mesh');
    const l = this.online().filter(([id]) => id !== this.me()).map(([id, x]) => `${x.name || this.name(id)}${x.now?.script ? `, running ${x.now.script}` : x.show ? ', in a show' : ''}`);
    say(l.length ? `${l.length} online: ${l.join('; ')}.` : 'Nobody else in the mesh is online right now.');
  },
  async create(v, say) { if (!LINK_HOST) return say('Create the mesh on StudioGen; this device joins it.'); if (Mesh.m) return say(`You’re already in ${Mesh.m.name}.`);
    await Mesh.create(v.name || 'My mesh'); closeSheet(); openView('mesh'); say(`Mesh ${Mesh.m.name} created. Say “invite to the mesh” to add a device.`); },
  async invite(v, say) { await MeshView.invite(); say('Here’s the invite: scan it or paste it on the other device.'); },
  async join(v, say) { MeshView.joinSheet(); say('Paste or scan the invite.'); },
  async leave(v, say) { await Mesh.leave(); say('You left the mesh.'); },
  async remove(v, say) { const id = this.dev(v.who); if (!id) return say(`I can’t find ${v.who} in the mesh.`); await Mesh.remove(id); say(`${this.name(id)} is out of the mesh; the others have a new key.`); },
  async allow(v, say) { const id = this.dev(v.who); if (!id) return say(`I can’t find ${v.who} in the mesh.`); await Mesh.updateMember(id, { perms: { ...(Mesh.member(id).perms || {}), run: true } }); say(`${this.name(id)} may run scripts now.`); },
  async deny(v, say) { const id = this.dev(v.who); if (!id) return say(`I can’t find ${v.who} in the mesh.`); await Mesh.updateMember(id, { perms: { ...(Mesh.member(id).perms || {}), run: false } }); say(`${this.name(id)} may no longer run scripts.`); },
  /** Run a script on a device by name (or on whichever offers it); “on all screens” starts a show. */
  async run(v, say) {
    const where = plain(v.device || '');
    if (this.ALL.test(where)) return this.show({ q: v.q, screens: 'all' }, say);
    let id = where ? this.dev(where) : null;
    if (where && !id) return say(`I can’t find ${v.device} in the mesh.`);
    id ||= Mesh.whoOffers(v.q)[0]; if (!id) return say(`Nobody online offers ${v.q}.`);
    if (id === this.me()) { const s = this.script(v.q); if (!s) return say(`There’s no script called ${v.q} here.`); Script.start(s.json); return; }
    const offered = Mesh.presence[id]?.caps?.scripts || [], name = offered.find(n => plain(n) === plain(v.q).replace(/^the /, '')) || offered.find(n => plain(n).includes(plain(v.q).replace(/^the /, ''))) || v.q;
    say(`Running ${name} on ${this.name(id)}…`, null, { leaves: false });
    const j = await Mesh.runOn(id, name); say(`${this.name(id)}: ${[].concat(j?.said || j?.result || 'done').join(' ')}`);
  },
  async fetch(v, say) {
    const p = plain(v.q).replace(/^the /, ''), from = v.device && !/^(the )?mesh$/.test(plain(v.device)) ? this.dev(v.device) : null;
    for (const [owner, cat] of Object.entries(Mesh.catalogs)) { if (from && owner !== from) continue; const a = (cat || []).find(x => plain(x.n) === p) || (cat || []).find(x => plain(x.n).includes(p));
      if (a) { await Mesh.fetch(owner, a.k, a.n); return say(`Got ${a.n} from ${this.name(owner)}.`); } }
    say(`Nobody in the mesh shares ${v.q}.`);
  },
  mine(q) { const p = plain(q).replace(/^the /, ''), l = [...Scripts.mine().map(s => ['script', s.name]), ...Object.keys(typeof Mocap !== 'undefined' ? Mocap.saved() : {}).map(n => ['motion', n])]; return l.find(([, n]) => plain(n) === p) || l.find(([, n]) => plain(n).includes(p)); },
  async share(v, say) { const a = this.mine(v.q); if (!a) return say(`There’s nothing called ${v.q} here.`); Mesh.setPrivate(a[0], a[1], false); say(`${a[1]} is shared with the mesh.`); },
  async private(v, say) { const a = this.mine(v.q); if (!a) return say(`There’s nothing called ${v.q} here.`); Mesh.setPrivate(a[0], a[1], true); say(`${a[1]} is private: it stays on this device.`); },
  async shared(v, say) { closeSheet(); openView('mesh'); MeshView.tab = 'shared'; MeshView.render(); const n = Object.values(Mesh.catalogs).reduce((s, c) => s + (c?.length || 0), 0); say(`${n} things are shared in the mesh.`); },
  async relays(v, say) { if (!Mesh.amOwner()) return say('Only the mesh owner can share the relay list.'); await Mesh.updateBrokers(); say(`Relay list shared with the mesh: ${Relay.list().brokers.length} relays.`); },
  async export(v, say) { closeSheet(); openView('mesh'); await MeshView.export(true); say('The mesh history is downloading.'); },
  /** Shows: started here (StudioGen) or on the StudioGen that has the script (asked through the mesh). */
  async show(v, say, mode = 'steps') {
    let to = v.device ? this.dev(v.device) : null;
    if (!to) to = LINK_HOST && this.script(v.q) ? this.me() : (Relay.mac()?.meshId && Mesh.member(Relay.mac().meshId) ? Relay.mac().meshId : Mesh.whoOffers(v.q)[0]);
    if (!to) return say('No StudioGen online can run that show.');
    return this.ask(to, { op: 'start', script: v.q, screens: v.screens || 'all', mode }, say);
  },
  tandem(v, say) { return this.show(v, say, 'tandem'); },
  async step(op, v, say) { const to = this.conductor() || (LINK_HOST ? this.me() : Relay.mac()?.meshId); if (!to) return say('No show is running.'); return this.ask(to, { op, name: v?.name }, say); },
  next(v, say) { return this.step('next', v, say); },
  back(v, say) { return this.step('back', v, say); },
  cue(v, say) { return this.step('cue', v, say); },
  stop(v, say) { return this.step('stop', v, say); },
  async ask(to, p, say) {
    const r = to === this.me() ? await this.showOp(p) : await Mesh.call(to, 'mesh-show', p, 30000);
    say([].concat(r?.said || 'Done.').join(' '));
  },
  /** On the conductor: what a show request does. */
  async showOp(p) {
    if (p.op === 'start') {
      const s = this.script(p.script); if (!s) throw new Error(`there’s no script called ${p.script} on ${Mesh.myName?.() || 'this Mac'}`);
      const screens = p.screens === 'all' ? this.studios().filter(id => id !== this.me()) : [].concat(p.screens).map(n => this.dev(n)).filter(Boolean);
      await Mesh.showStart(s.id, screens, p.mode || 'steps'); return { said: `Starting ${s.name} on ${screens.length + 1} screen${screens.length ? 's' : ''}${p.mode === 'tandem' ? ', in tandem' : ''}.` };
    }
    const id = Mesh.conducting; if (!id) throw new Error('no show is running here');
    if (p.op === 'next') { Script.next(); return { said: 'Next.' }; }
    if (p.op === 'back') { Script.back(); return { said: 'Back one step.' }; }
    if (p.op === 'cue') { Mesh.showCue(id, p.name || 'go'); return { said: 'Cue sent.' }; }
    if (p.op === 'stop') { Mesh.showStop(id); return { said: 'Show stopped on every screen.' }; }
    throw new Error('unknown show request');
  },
  /* ---------- the link (both apps) ---------- */
  async pair(v, say) { if (LINK_HOST) { Relay.hostPair(); say('Add a secret phrase if you like, then show the code to DriveGen.'); } else { Relay.guestPair(); say('Point the camera at the code on your Mac, or paste it.'); } },
  async test(v, say) { LinkTest.show(); say('Testing the connection…'); },
  async direct(v, say) { const on = v.on !== false; store.set('directCfg', { ...store.get('directCfg', {}), mode: on ? 'auto' : 'off' }); if (!on) { Direct.close(); if (typeof MeshDirect !== 'undefined') for (const id of [...MeshDirect.links.keys()]) MeshDirect.close(id); } say(on ? 'The direct link is on: used whenever the networks allow.' : 'The direct link is off: everything goes through the relays.'); },
  async rekey(v, say) {
    if (!LINK_HOST) return say('Change the secret on your Mac: StudioGen, Settings, Connections.');
    const w = plain(v.who || '').replace(/^(the|my) /, ''), ps = Relay.peers(), nm = x => plain(Mesh.member(x.meshId)?.name || x.name || ''), p = w ? ps.find(x => nm(x) === w) || ps.find(x => nm(x).includes(w) || plain(x.name || '').includes(w)) : null;
    if (v.who && !p) return say(`I can’t find ${v.who} among the paired devices.`);
    (p ? [p] : ps).forEach(x => Relay.rekey(x.id)); say(p ? `New secret sent to ${Mesh.member(p.meshId)?.name || p.name}.` : `New secrets sent to ${ps.length} device${ps.length === 1 ? '' : 's'}.`);
  },
};
// StudioGens tell their owner's other StudioGens (online ones they know are yours) which devices are yours, every minute
setInterval(() => {
  if (!LINK_HOST || !Mesh.m || !Mesh._me) return; const devs = Mesh.ownList();
  for (const x of Mesh.members()) if (x.app === 'StudioGen' && x.id !== Mesh._me.id && Mesh.ownHere(x.id) && Date.now() - (Mesh.presence[x.id]?.at || 0) < 60000) Mesh.call(x.id, 'own-sync', { devs }, 15000).catch(() => {});
}, 60000);
