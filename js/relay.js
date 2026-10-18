'use strict';
/* ============================================================
   The relay link: DriveGen ↔ StudioGen from anywhere, no account, no server
   of ours. Messages go through public relays and are end-to-end encrypted,
   so a relay only sees a random topic and noise. Three kinds, in one list:
     wss://…           an MQTT broker (QoS 0)                  carries everything
     nostr+wss://…     a Nostr relay (signed ephemeral events)   carries everything
     tracker+wss://…   a WebTorrent tracker (WebSocket)          introductions only: hellos and the
                                                                direct-link handshake, never data
   docs/connections.html has the design.
   - StudioGen keeps THE relay list (ordered, with a revision; Settings ›
     Connections › Relays). Pairing (once per device) puts the list in the
     code ("SG3…": room, 256-bit key, the brokers, the revision). A changed
     list reaches a device only by pairing it again; until then it keeps
     using the list it paired with.
   - Failover, the same rule on both sides: use the first two relays of the
     shared list that work for you and carry data (trackers only when none
     does) (a broker works when your own messages
     come back through it; two misses: down, retried later with backoff and
     taken back when it works again). Every hello says which brokers you use,
     and each side also joins the brokers the other uses, so when one side
     can't reach a broker the two still meet on the next one.
   - Every message: AES-GCM with the pairing key (the topic, i.e. the
     direction, as additional data), a timestamp (older than 2 minutes:
     dropped), an id (seen before: dropped).
   - Polite to the brokers: QoS 0, nothing retained, at most 3 connections,
     a hello every 15 s, keep-alive 60 s, reconnects with growing pauses; more relays (up to 6)
     only while searching for the other side.
   - Over it: presence, the link requests (offers, run, say; answers kept 10
     minutes for resends), and the WebRTC handshake for a direct link when the
     direct settings (StudioGen's) allow it (js/direct.js).
   Loaded after direct.js.
   ============================================================ */
// Public relays, checked by echo tests (Oct 2026); operators and kinds mixed, so no single company or protocol is the only way.
const RELAY_DEFAULTS = [
  { url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX public broker (EMQ Technologies)' },
  { url: 'wss://broker.hivemq.com:8884/mqtt', name: 'HiveMQ public broker' },
  { url: 'nostr+wss://relay.damus.io', name: 'Damus Nostr relay' },
  { url: 'wss://test.mosquitto.org:8081/mqtt', name: 'Eclipse Mosquitto test server' },
  { url: 'nostr+wss://relay.primal.net', name: 'Primal Nostr relay' },
  { url: 'nostr+wss://relay.snort.social', name: 'Snort Nostr relay' },
  { url: 'wss://broker.itdata.nu:443/mqtt', name: 'itdata.nu public broker' },
  { url: 'nostr+wss://nostr-pub.wellorder.net', name: 'Wellorder Nostr relay' },
  { url: 'tracker+wss://tracker.openwebtorrent.com', name: 'OpenWebTorrent tracker (introductions only)' },
  { url: 'tracker+wss://tracker.webtorrent.dev', name: 'WebTorrent.dev tracker (introductions only)' },
  { url: 'wss://broker-cn.emqx.io:8084/mqtt', name: 'EMQX public broker, Asia (backup)' },
  { url: 'wss://mqtt-dashboard.com:8884/mqtt', name: 'HiveMQ dashboard broker (backup)' },
];
const DIRECT_DEFAULTS = { mode: 'auto', relayData: true, stun: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'stun:global.stun.twilio.com:3478'], turn: { url: '', user: '', pass: '' } };
// StudioGen in a plain browser for the network lab (?linktest=host): the link side only (docs/connection-tests.html).
const LINK_HOST = !!window.DriveDeckDesktop || new URLSearchParams(location.search).get('linktest') === 'host';
const b64u = { enc: b => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) };

/* ---------- MQTT 3.1.1 over WebSocket, QoS 0: connect (optionally with a user and password), subscribe, publish, ping ---------- */
class Mqtt {
  constructor(url, onMsg, onState) {
    const u = new URL(url); this.user = decodeURIComponent(u.username); this.pass = decodeURIComponent(u.password); u.username = u.password = '';
    this.url = u.href; this.onMsg = onMsg; this.onState = onState; this.subs = new Set(); this.buf = new Uint8Array(0); this.open();
  }
  open() {
    let ws; try { ws = this.ws = new WebSocket(this.url, 'mqtt'); } catch { setTimeout(() => this.onState?.('closed'), 0); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const id = 'sg-' + Math.random().toString(36).slice(2, 12), flags = 0x02 | (this.user ? 0x80 : 0) | (this.pass ? 0x40 : 0);
      this.send(0x10, [...this.str('MQTT'), 4, flags, 0, 60, ...this.str(id), ...(this.user ? this.str(this.user) : []), ...(this.pass ? this.str(this.pass) : [])]);
    };
    ws.onmessage = e => this.read(new Uint8Array(e.data));
    ws.onclose = () => { this.up = false; clearInterval(this.pinger); if (!this.closed) this.onState?.('closed'); };
    ws.onerror = () => {};
  }
  str(s) { const b = new TextEncoder().encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  len(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return o; }
  send(head, body) { if (this.ws?.readyState !== 1) return false; const b = body instanceof Uint8Array ? body : Uint8Array.from(body); const h = Uint8Array.from([head, ...this.len(b.length)]), p = new Uint8Array(h.length + b.length); p.set(h); p.set(b, h.length); this.ws.send(p); return true; }
  read(chunk) {
    const a = new Uint8Array(this.buf.length + chunk.length); a.set(this.buf); a.set(chunk, this.buf.length); this.buf = a;
    for (;;) {
      if (this.buf.length < 2) return;
      let n = 0, m = 1, i = 1, d; do { if (i >= this.buf.length) return; d = this.buf[i++]; n += (d & 127) * m; m *= 128; } while (d & 128);
      if (this.buf.length < i + n) return;
      const head = this.buf[0], type = head >> 4, body = this.buf.slice(i, i + n); this.buf = this.buf.slice(i + n);
      if (type === 2) { this.up = body[1] === 0; if (!this.up) { this.close(); this.onState?.('refused'); return; } for (const t of this.subs) this.send(0x82, [0, 1, ...this.str(t), 0]); clearInterval(this.pinger); this.pinger = setInterval(() => this.send(0xC0, []), 30000); this.onState?.('up'); }
      else if (type === 3) { const tl = (body[0] << 8) | body[1], topic = new TextDecoder().decode(body.slice(2, 2 + tl)), q = (head >> 1) & 3; this.onMsg(topic, body.slice(2 + tl + (q ? 2 : 0))); }
    }
  }
  subscribe(topic) { if (this.subs.has(topic)) return; this.subs.add(topic); if (this.up) this.send(0x82, [0, 1, ...this.str(topic), 0]); }
  publish(topic, payload) { return this.send(0x30, [...this.str(topic), ...payload]); }
  close() { this.closed = true; clearInterval(this.pinger); try { this.ws?.close(); } catch {} }
}
Mqtt.echo = true; Mqtt.data = true;

/* ---------- Nostr: signed ephemeral events (kind 21059, not stored by relays), the topic as a "t" tag; nostr-tools signs (vendor/nostr) ---------- */
const NOSTR_KIND = 21059;
const nostrLib = () => window.NostrTools ? Promise.resolve() : (nostrLib.p ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/nostr/nostr.bundle.js'; s.onload = res; s.onerror = () => { nostrLib.p = null; rej(new Error('Nostr didn’t load')); }; document.head.appendChild(s); }));
const nostrKey = () => { let k = store.get('nostrKey', ''); if (!k) { k = [...NostrTools.generateSecretKey()].map(x => x.toString(16).padStart(2, '0')).join(''); store.set('nostrKey', k); } return Uint8Array.from(k.match(/../g), h => parseInt(h, 16)); };
class NostrT {
  constructor(url, onMsg, onState) { this.url = url.replace(/^nostr\+/, ''); this.onMsg = onMsg; this.onState = onState; this.subs = new Set(); nostrLib().then(() => this.open(), () => onState?.('closed')); }
  open() {
    if (this.closed) return; this.sk = nostrKey();
    let ws; try { ws = this.ws = new WebSocket(this.url); } catch { return this.onState?.('closed'); }
    ws.onopen = () => { this.up = true; for (const t of this.subs) this.req(t); this.onState?.('up'); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m[0] === 'EVENT' && m[2]?.kind === NOSTR_KIND) { const t = (m[2].tags || []).find(x => x[0] === 't')?.[1]; if (t && this.subs.has(t)) { try { this.onMsg(t, b64u.dec(m[2].content)); } catch {} } }
      if (m[0] === 'OK' && m[2] === false) Log.w('relay', `Nostr refused: ${this.url}`, { why: m[3] }); };
    ws.onclose = () => { this.up = false; if (!this.closed) this.onState?.('closed'); };
    ws.onerror = () => {};
  }
  req(t) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(['REQ', 's' + t.slice(-12), { kinds: [NOSTR_KIND], '#t': [t], since: Math.floor(Date.now() / 1000) - 10 }])); }
  subscribe(t) { if (this.subs.has(t)) return; this.subs.add(t); if (this.up) this.req(t); }
  publish(t, payload) {
    if (this.ws?.readyState !== 1) return false;
    const ev = NostrTools.finalizeEvent({ kind: NOSTR_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', t]], content: b64u.enc(payload) }, this.sk);
    this.ws.send(JSON.stringify(['EVENT', ev])); return true;
  }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}
NostrT.echo = true; NostrT.data = true;

/* ---------- WebTorrent tracker: introductions only. A topic is a swarm; a message is an "offer" the tracker hands to the
   other peers in it (here: the other app). Trackers don't send our own back, so "works" means it answered our announce. ---------- */
const binStr = b => String.fromCharCode(...b);
class TrackerT {
  constructor(url, onMsg, onState) { this.url = url.replace(/^tracker\+/, ''); this.onMsg = onMsg; this.onState = onState; this.subs = new Map(); this.peer = binStr(crypto.getRandomValues(new Uint8Array(20))); this.open(); }
  async hash(t) { return binStr(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(t)))); }
  open() {
    if (this.closed) return;
    let ws; try { ws = this.ws = new WebSocket(this.url); } catch { return this.onState?.('closed'); }
    ws.onopen = () => { if (!this.subs.size) this.announce('sg1/hello'); for (const t of this.subs.keys()) this.announce(t); clearInterval(this.re); this.re = setInterval(() => { for (const t of this.subs.keys()) this.announce(t); }, 60000); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.interval && !this.up) { this.up = true; this.onState?.('up'); }
      if (m.offer?.sdp && m.info_hash) { const t = [...this.subs].find(([, h]) => h === m.info_hash)?.[0]; if (t) { try { this.onMsg(t, b64u.dec(m.offer.sdp)); } catch {} } }
      if (m['failure reason']) Log.w('relay', `Tracker refused: ${this.url}`, { why: m['failure reason'] }); };
    ws.onclose = () => { this.up = false; clearInterval(this.re); if (!this.closed) this.onState?.('closed'); };
    ws.onerror = () => {};
  }
  async announce(t, offers = []) { const h = this.subs.get(t) || await this.hash(t); if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ action: 'announce', info_hash: h, peer_id: this.peer, numwant: offers.length ? 5 : 0, uploaded: 0, downloaded: 0, left: 1, offers })); }
  async subscribe(t) { if (this.subs.has(t)) return; this.subs.set(t, await this.hash(t)); this.announce(t); }
  publish(t, payload) { if (this.ws?.readyState !== 1 || !this.subs.has(t)) return false; this.announce(t, [{ offer: { type: 'offer', sdp: b64u.enc(payload) }, offer_id: binStr(crypto.getRandomValues(new Uint8Array(20))) }]); return true; }
  close() { this.closed = true; clearInterval(this.re); try { this.ws?.close(); } catch {} }
}
TrackerT.echo = false; TrackerT.data = false;
const relayKind = u => /^nostr\+/.test(u) ? NostrT : /^tracker\+/.test(u) ? TrackerT : Mqtt;

const Relay = {
  pool: new Map(), seen: new Map(), mine: new Map(), waits: new Map(), answers: new Map(), online: {}, peerUse: {}, keys: new Map(), topics: {},
  isMac: () => LINK_HOST,
  /* ---------- The list (StudioGen's), the pairings, the direct settings ---------- */
  list: () => store.get('relayList', null) || { rev: 1, brokers: RELAY_DEFAULTS },
  directCfg: () => ({ ...DIRECT_DEFAULTS, ...store.get('directCfg', {}) }),
  peers: () => store.get('relayPeers', []),
  mac: () => store.get('relayMac', null),
  rooms() { return this.isMac() ? this.peers() : this.mac() ? [this.mac()] : []; },
  brokersOf: room => room.brokers?.length ? room.brokers : RELAY_DEFAULTS.slice(0, 2).map(b => b.url), // pairings before the list (SG2): the first two defaults
  ready() { return !this.isMac() && !!this.mac() && !!this.online.mac && this.dataUp(this.mac()) && this.dataOk(); },
  /** Data (requests and answers) may go over the relays: StudioGen's setting, told to the device in every hello. */
  dataOk() { return this.isMac() ? this.directCfg().relayData !== false : this.mac()?.relayData !== false; },
  /** Up and able to carry data for this room (trackers only introduce). */
  dataUp(room) { return this.active(room).some(u => relayKind(u).data && this.pool.get(u)?.mq?.up); },
  anyUp() { return [...this.pool.values()].some(b => b.mq?.up); },
  /* ---------- Keys and topics ---------- */
  /** A pairing's key (or, while it is being changed, its next or previous one), ready for AES-GCM. */
  async key(room, which = 'key') { const k = room[which]; if (!k) return null; if (!this.keys.has(k)) this.keys.set(k, await crypto.subtle.importKey('raw', b64u.dec(k), 'AES-GCM', false, ['encrypt', 'decrypt'])); return this.keys.get(k); },
  /** The pairing as stored now (it changes when the secret does). */
  fresh(room) { return this.rooms().find(r => r.room === room.room) || room; },
  /* ---------- Changing the secret (StudioGen starts it: "Change the secret", or on a schedule) ----------
     1. StudioGen makes a new random 256-bit key and sends it, locked with the current key ("rekey"); it keeps sending with the
        current key until the device confirms. 2. The device switches to the new key, keeps the old one 10 minutes for messages
        still on their way, and confirms with the new key ("rekey-ok"). 3. StudioGen, seeing the new key used, switches too and
        keeps the old one 10 minutes. A device that's offline gets the new key when it next says hello. */
  rekey(id) {
    const p = this.peers().find(x => x.id === id); if (!p) return;
    const next = p.nextKey || b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
    store.set('relayPeers', this.peers().map(x => x.id === id ? { ...x, nextKey: next, rekeySent: Date.now() } : x));
    this.post(this.fresh(p), 'rekey', { key: next }); Log.i('relay', `New secret for ${p.name}: sent`);
  },
  commit(room) { // StudioGen: the device uses the new key now
    store.set('relayPeers', this.peers().map(x => x.room === room.room && x.nextKey ? { ...x, oldKey: x.key, key: x.nextKey, nextKey: null, keyAt: new Date().toISOString(), oldUntil: Date.now() + 600000 } : x));
    Log.i('relay', `New secret in use: ${room.name}`); this.onchange?.();
  },
  rekeyEvery: () => +(store.get('rekeyEvery', 0)) || 0, // days; 0: only when asked
  async topic(room, dir) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`studiogen-relay:${room.room}:${dir}`))); return `sg1/${[...h.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('')}`; },
  inDir() { return this.isMac() ? 'to-mac' : 'to-dev'; }, outDir() { return this.isMac() ? 'to-dev' : 'to-mac'; },
  /* ---------- Which brokers: the same rule on both sides ---------- */
  health(url) { return this.pool.get(url)?.health || 'unknown'; },
  /** Mine: the first two of the room's list that aren't down for me. */
  window(room) { const L = this.brokersOf(room).filter(u => this.health(u) !== 'down'), d = L.filter(u => relayKind(u).data); return (d.length ? d : L).slice(0, this.width(room)); }, // trackers (introductions) only when nothing that carries data works
  /** How many to use: two, or, while the other side hasn't been heard for a while, more and more (2, 4, 6) so that two sides
      that ended up on different relays (one can't reach the first ones) still find a relay they share; back to two once heard. */
  width(room) {
    const heard = this.isMac() ? this.online[room.room] : this.online.mac, since = Math.max(heard || 0, this.since || 0), quiet = Date.now() - since;
    return heard && Date.now() - heard < 40000 ? 2 : Math.min(6, 2 + 2 * Math.floor(Math.max(0, quiet - 10000) / 15000));
  },
  /** Where this room's messages go: my two, plus what the other side says it uses (if not down for me); at most 3. */
  active(room) { const w = this.window(room), extra = (this.peerUse[room.room] || []).filter(u => this.brokersOf(room).includes(u) && !w.includes(u) && this.health(u) !== 'down'); return [...w, ...extra].slice(0, Math.max(3, w.length)); },
  /** Open what's needed, close what isn't (after a grace period), subscribe both directions (our own messages coming back tell us the broker works). */
  async plan() {
    const need = new Map();
    for (const r of this.rooms()) for (const u of this.active(r)) { if (!need.has(u)) need.set(u, []); need.get(u).push(r); }
    for (const [u, rs] of need) {
      let b = this.pool.get(u); if (!b) { b = { url: u, health: 'unknown', fails: 0, misses: 0, wait: 0 }; this.pool.set(u, b); }
      b.idleSince = 0;
      if (!b.mq && Date.now() >= (b.nextTry || 0)) this.connect(b);
      for (const r of rs) for (const d of ['to-mac', 'to-dev']) { const t = await this.topic(r, d); this.topics[t] = r; b.mq?.subscribe(t); }
    }
    for (const [u, b] of this.pool) if (!need.has(u) && b.mq) { b.idleSince ||= Date.now(); if (Date.now() - b.idleSince > 60000) { b.mq.close(); b.mq = null; } }
    this.onchange?.();
  },
  connect(b) {
    // A firewall that silently drops the connection would leave it hanging for a minute or more: 8 s to answer, then the next relay.
    clearTimeout(b.timer); b.timer = setTimeout(() => { if (b.mq && !b.mq.up) { const m = b.mq; b.mq = null; m.close(); this.fail(b, 'no answer in 8 s'); } }, 8000);
    b.tried = Date.now(); b.mq = new (relayKind(b.url))(b.url, (t, p) => this.got(t, p, b), s => {
      if (s === 'up') { b.wait = 0; b.connected = Date.now(); if (!relayKind(b.url).echo) this.ok(b, Date.now() - b.tried); this.plan().then(() => this.hello()); return; }
      b.mq = null; this.fail(b, s === 'refused' ? 'refused the connection' : 'connection closed');
    });
  },
  /** A broker didn't connect, or didn't bring our own message back: twice in a row and it's down for a while (growing pauses). */
  fail(b, why) {
    b.fails++; if (b.fails < 2 && b.health !== 'down') { b.nextTry = Date.now() + 3000; setTimeout(() => this.plan(), 3100); return; } // one more try in 3 s
    if (b.health !== 'down') Log.w('relay', `Broker down: ${b.url} (${why})`);
    b.health = 'down'; b.wait = Math.min(300000, (b.wait || 15000) * 2); b.nextTry = Date.now() + b.wait * (0.8 + Math.random() * 0.4);
    try { b.mq?.close(); } catch {} b.mq = null;
    this.plan().then(() => this.hello()); // the window moves to the next broker: say so at once
  },
  ok(b, rtt) { const was = b.health; b.health = 'up'; b.fails = 0; b.rtt = rtt; if (was !== 'up') { Log.i('relay', `Broker works: ${b.url} (${rtt} ms)`); this.plan(); } },
  /* ---------- Starting and stopping ---------- */
  start() {
    if (this.started || !this.rooms().length) return; this.started = true; this.since = Date.now();
    this.plan(); clearInterval(this.beat); this.beat = setInterval(() => this.tick(), 15000); setTimeout(() => this.hello(), 1500);
    Log.i('relay', 'Relay started', { rooms: this.rooms().length });
  },
  stop() { for (const b of this.pool.values()) try { b.mq?.close(); } catch {} this.pool.clear(); this.started = false; clearInterval(this.beat); this.online = {}; this.peerUse = {}; this.topics = {}; },
  restart() { this.stop(); this.keys.clear(); this.start(); },
  tick() {
    // Our own messages that never came back: a miss for that broker.
    const now = Date.now(); for (const [id, s] of this.mine) if (now - s.at > 10000) { this.mine.delete(id); for (const u of s.urls) { const b = this.pool.get(u); if (b && !s.back.has(u)) this.fail(b, 'our message didn’t come back'); } }
    for (const [u, b] of this.pool) if (b.health === 'down' && now >= b.nextTry && !b.mq) { b.health = 'unknown'; b.fails = 1; } // try it again: it is taken back when it works
    for (const k of Object.keys(this.online)) if (now - this.online[k] > 70000) { delete this.online[k]; this.onchange?.(); }
    this.plan().then(() => this.hello());
  },
  /* ---------- Sending and receiving ---------- */
  async post(room, type, body) {
    room = this.fresh(room);
    const t = await this.topic(room, this.outDir()), iv = crypto.getRandomValues(new Uint8Array(12)), id = Math.random().toString(36).slice(2);
    const plain = new TextEncoder().encode(JSON.stringify({ id, ts: Date.now(), type, body }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(t) }, await this.key(room), plain));
    const p = new Uint8Array(12 + ct.length); p.set(iv); p.set(ct, 12);
    const data = type === 'ask' || type === 're';
    if (data && !this.dataOk()) return false; // the relays only introduce (StudioGen's setting)
    const urls = this.active(room).filter(u => this.pool.get(u)?.mq?.up && (!data || relayKind(u).data)), sent = urls.filter(u => this.pool.get(u).mq.publish(t, p));
    this.mine.set(id, { at: Date.now(), urls: sent.filter(u => relayKind(u).echo), back: new Set() }); // trackers don't echo: no misses counted for them
    return sent.length > 0;
  },
  async got(topic, payload, b) {
    const room = this.topics[topic] && this.fresh(this.topics[topic]); if (!room || payload.length < 29) return;
    // The current key, else (while the secret is being changed) the next one (StudioGen) or the previous one (both, 10 minutes).
    let m, used = null;
    for (const which of ['key', 'nextKey', 'oldKey']) {
      if (which === 'oldKey' && room.oldUntil && Date.now() > room.oldUntil) continue;
      const k = await this.key(room, which); if (!k) continue;
      try { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, 12), additionalData: new TextEncoder().encode(topic) }, k, payload.slice(12)); m = JSON.parse(new TextDecoder().decode(pt)); used = which; break; } catch {}
    }
    if (!m) return; // not ours, or tampered
    if (used === 'nextKey' && this.isMac()) this.commit(room); // the device has switched: so do we
    const own = this.mine.get(m.id); if (own) { own.back.add(b.url); this.ok(b, Date.now() - own.at); return; } // our own message, back: this broker works
    if (Math.abs(Date.now() - m.ts) > 120000 || this.seen.has(m.id)) return; // old, or another broker's copy
    this.seen.set(m.id, Date.now()); if (this.seen.size > 500) for (const [k, t] of this.seen) if (Date.now() - t > 150000) this.seen.delete(k);
    this.ok(b, b.rtt || 0); this.handle(room, m.type, m.body || {});
  },
  async handle(room, type, b) {
    if (type === 'hello') {
      const was = this.isMac() ? this.online[room.room] : this.online.mac;
      const use = (b.use || []).filter(u => typeof u === 'string'), changed = JSON.stringify(use) !== JSON.stringify(this.peerUse[room.room] || []);
      this.peerUse[room.room] = use; if (changed) this.plan();
      if (this.isMac()) { this.online[room.room] = Date.now(); this.rename(room, b.name, b.rev); if (!b.re) this.post(room, 'hello', this.helloBody(room, true)); this.maybeDirect(room);
        const p = this.fresh(room), days = this.rekeyEvery();
        if (p.nextKey && Date.now() - (p.rekeySent || 0) > 10000) this.rekey(p.id); // a device that was away gets its new secret now
        else if (!p.nextKey && days && Date.now() - Date.parse(p.keyAt || p.paired) > days * 86400000) this.rekey(p.id); // on schedule
      }
      else { this.online.mac = Date.now(); store.set('relayMac', { ...this.mac(), name: b.name || this.mac().name, masterRev: b.master || 0, relayData: b.relayData !== false }); }
      if (!was) { Log.i('relay', `${this.isMac() ? room.name || 'A device' : 'Your Mac'} is online (relay)`); this.onchange?.(); }
      return;
    }
    if (type === 'ask' && this.isMac() && !this.dataOk()) return this.post(room, 're', { id: b.id, error: 'Data over the relays is off on your Mac: it needs a direct link (or a TURN server)' });
    if (type === 'ask' && this.isMac()) { // DriveGen's request; the answer is kept so a resent request gets it again
      if (this.answers.has(b.id)) { const a = this.answers.get(b.id); if (a !== 'busy') this.post(room, 're', a); return; }
      this.answers.set(b.id, 'busy'); setTimeout(() => this.answers.delete(b.id), 600000);
      let a; try { Direct.peer ||= room.name; a = { id: b.id, result: await Direct.handle(b.kind, { ...(b.payload || {}) }) }; } catch (e) { a = { id: b.id, error: e.message }; }
      this.answers.set(b.id, a); this.post(room, 're', a); return;
    }
    if (type === 're') { const w = this.waits.get(b.id); if (w) { this.waits.delete(b.id); clearTimeout(w.t); clearInterval(w.again); b.error ? w.rej(new Error(b.error)) : w.res(b.result); } return; }
    // The WebRTC handshake (StudioGen's direct settings: how, and which STUN/TURN servers).
    if (type === 'rekey' && !this.isMac() && b.key) { // a new secret from StudioGen (locked with the current one)
      const mac = this.mac(); if (b.key !== mac.key) store.set('relayMac', { ...mac, oldKey: mac.key, key: b.key, keyAt: new Date().toISOString(), oldUntil: Date.now() + 600000 });
      Log.i('relay', 'New secret from your Mac'); this.post(this.mac(), 'rekey-ok', {}); this.onchange?.(); return;
    }
    if (type === 'rekey-ok' && this.isMac()) return; // handled when the new key was first used (commit)
    if (type === 'rtc-offer' && !this.isMac()) { if (store.get('directAllow', true) === false) return; try { const code = await Direct.answer(b.code, b.ice || []); this.post(room, 'rtc-answer', { code }); } catch (e) { Log.w('relay', 'Direct answer failed', e); } return; }
    if (type === 'rtc-answer' && this.isMac()) { try { await Direct.accept(b.code); this.directTries = 0; } catch (e) { Log.w('relay', 'Direct accept failed', e); } }
  },
  helloBody(room, re) { return { name: this.isMac() ? 'StudioGen' : Direct.myName(), use: this.window(room), rev: room.rev || 0, master: this.isMac() ? this.list().rev : undefined, relayData: this.isMac() ? this.dataOk() : undefined, re: re ? 1 : undefined }; },
  hello() { for (const r of this.rooms()) this.post(r, 'hello', this.helloBody(r)); },
  /** Direct when possible: StudioGen starts the handshake (auto: across networks with STUN; local: same network only; off: never),
      again after a link ends or fails, with growing pauses (1, 2, 5, 10 minutes). */
  maybeDirect(room) {
    const c = this.directCfg(); if (c.mode === 'off' || Direct.connected) return;
    const gap = [0, 60, 120, 300, 600][Math.min(4, this.directTries || 0)] * 1000; if (Date.now() - (this.lastTry || 0) < Math.max(gap, 30000)) return;
    this.lastTry = Date.now(); this.directTries = (this.directTries || 0) + 1;
    const ice = c.mode === 'local' ? [] : [{ urls: c.stun.filter(Boolean) }, ...(c.turn?.url ? [{ urls: c.turn.url, username: c.turn.user, credential: c.turn.pass }] : [])];
    Direct.offer(ice).then(code => { Direct.peer = ''; this.post(room, 'rtc-offer', { code, ice }); }).catch(e => Log.w('relay', 'Direct offer failed', e));
  },
  rename(room, name, rev) { const p = this.fresh(room); if (p.name === (name || p.name) && p.rev === (rev || p.rev) && Date.now() - Date.parse(p.seen || 0) < 60000) return; store.set('relayPeers', this.peers().map(x => x.room === room.room ? { ...x, name: name || x.name, seen: new Date().toISOString(), rev: rev || x.rev } : x)); },
  /** DriveGen → the Mac: a request, resent after 3 and 7 s, then every 15 s, until answered (the Mac answers a resend from its kept answer). */
  call(kind, payload = {}, ms = 600000) {
    const room = this.mac(); if (!room) return Promise.reject(new Error('Not paired with a Mac'));
    if (!this.dataOk()) return Promise.reject(new Error('Your Mac only takes requests over a direct link (data over the relays is off)'));
    const id = Math.random().toString(36).slice(2);
    return new Promise((res, rej) => {
      const send = () => this.post(room, 'ask', { id, kind, payload });
      const w = { res, rej, t: setTimeout(() => { this.waits.delete(id); clearInterval(w.again); rej(new Error('Your Mac didn’t answer: is StudioGen open?')); }, ms), again: setInterval(send, 15000) };
      this.waits.set(id, w); send();
      for (const d of [3000, 7000]) setTimeout(() => { if (this.waits.has(id)) send(); }, d); // early resends: a request lost while the two settle on a shared relay
    });
  },
  /* ---------- Pairing (once per device; again when StudioGen's list changes) ---------- */
  newPairing() {
    const L = this.list(), p = { id: Math.random().toString(36).slice(2, 8), room: b64u.enc(crypto.getRandomValues(new Uint8Array(16))), key: b64u.enc(crypto.getRandomValues(new Uint8Array(32))), name: 'A device (pairing…)', paired: new Date().toISOString(), keyAt: new Date().toISOString(), brokers: L.brokers.map(b => b.url), rev: L.rev };
    store.set('relayPeers', [...this.peers(), p]); this.restart();
    return 'SG3' + b64u.enc(new TextEncoder().encode(JSON.stringify({ r: p.room, k: p.key, b: p.brokers, v: p.rev })));
  },
  pairWith(code) {
    if (!/^SG[23][\w-]+$/.test(code)) throw new Error('That isn’t a StudioGen pairing code');
    const j = JSON.parse(new TextDecoder().decode(b64u.dec(code.slice(3))));
    store.set('relayMac', { room: j.r, key: j.k, brokers: j.b || null, rev: j.v || 0, name: 'Your Mac', paired: new Date().toISOString() }); this.restart();
  },
  revoke(id) { store.set('relayPeers', this.peers().filter(p => p.id !== id)); this.restart(); },
  forget() { store.set('relayMac', null); this.stop(); },
  outdated(room) { return this.isMac() ? (room.rev || 0) < this.list().rev : (this.mac()?.masterRev || 0) > (this.mac()?.rev || 0); },
  /* ---------- Screens ---------- */
  status(room) {
    return this.brokersOf(room).map((u, i) => { const b = this.pool.get(u), inUse = this.active(room).includes(u) && b?.mq?.up;
      return `<li>${b?.health === 'down' ? '🔴' : inUse ? '🟢' : b?.health === 'up' ? '🟡' : '⚪️'} ${i + 1}. ${esc(this.label(u))} <span class="se-note">${b?.health === 'down' ? `down, retry in ${Math.max(0, Math.round((b.nextTry - Date.now()) / 1000))} s` : inUse ? `in use${b.rtt ? `, ${b.rtt} ms` : ''}` : 'spare'}${(this.peerUse[room.room] || []).includes(u) ? ' · the other side uses it' : ''}</span></li>`; }).join('');
  },
  label(u) { return (this.list().brokers.find(b => b.url === u) || RELAY_DEFAULTS.find(b => b.url === u))?.name || new URL(u).host; },
  async hostPair() {
    closeSheet(); const code = this.newPairing();
    Direct.screen('Pair a phone or iPad (once)', `<div class="dl-step"><div class="dl-qr" id="dlQr"></div><div><p>On the phone or iPad: <b>DriveGen › Settings › Connections › Pair once</b>, and point its camera at this code.</p>
      <p>From then on they find each other by themselves, from anywhere (mobile data too), through the relays in this Mac’s list (${this.list().brokers.length}, revision ${this.list().rev}), which only ever see encrypted messages.</p><p class="se-note">Anyone who can scan this code can pair, so show it only to your own devices.</p></div></div>`);
    Direct.showCode($('#dlQr'), code);
  },
  async guestPair() {
    closeSheet(); Direct.screen('Pair with your Mac (once)', `<div class="dl-step"><div class="dl-cam" id="dlCam"></div><div><p>On the Mac: <b>StudioGen › Settings › Connections › Pair a phone or iPad</b>. Point this camera at the code.</p><p class="se-note" id="dlState">Looking for the code…</p></div></div>`);
    try { const code = await Direct.scan($('#dlCam'), 'SG'); this.pairWith(code); $('#dlState').textContent = 'Paired: finding your Mac…'; setTimeout(() => { Direct.done(); toast('Paired with your Mac'); }, 1500); }
    catch (e) { if ($('#dlState')) $('#dlState').textContent = e.message; }
  },
  /** StudioGen › Connections › Relays: the list both sides use, in order. */
  editor(draft) {
    const L = draft || JSON.parse(JSON.stringify(this.list())); this.draft = L;
    sheet('Relays (StudioGen’s list)', `<p class="se-note">Public relays, tried in this order: both apps use the first two that work (MQTT brokers and Nostr relays carry everything; WebTorrent trackers only introduce the two apps, and are used when nothing else works), and move down the list together when one stops. Your own broker works too (wss://user:password@host:port/path). Devices get the list when they pair: after a change, pair them again.</p>
      <ol class="rl-list">${L.brokers.map((b, i) => `<li><div><b>${esc(b.name || new URL(b.url).host)}</b><span class="se-note">${esc(b.url.replace(/\/\/[^@/]*@/, '//•••@'))}</span><span class="se-note" id="rlT${i}"></span></div>
        <button class="icon-btn" data-rlx="up:${i}" ${i ? '' : 'disabled'} aria-label="Up">↑</button><button class="icon-btn" data-rlx="down:${i}" ${i < L.brokers.length - 1 ? '' : 'disabled'} aria-label="Down">↓</button><button class="icon-btn" data-rlx="del:${i}" aria-label="Remove">${svg('del')}</button></li>`).join('')}</ol>
      <div class="se-row"><select id="rlKind"><option value="">MQTT broker</option><option value="nostr+">Nostr relay</option><option value="tracker+">WebTorrent tracker (introductions only)</option></select><input id="rlUrl" class="se-wz-in" placeholder="wss://broker.example.com:8084/mqtt"><input id="rlName" class="se-wz-in" placeholder="Name (optional)"><button class="chip" data-rlx="add">Add</button></div>`,
      [['Save', () => this.saveList()], ['Test them', () => { this.editor(L); this.testAll(L); }], ['Defaults', () => this.editor({ rev: L.rev, brokers: RELAY_DEFAULTS })], ['Cancel']]);
  },
  async testAll(L) {
    await Promise.all(L.brokers.map((b, i) => new Promise(res => {
      const el = () => $(`#rlT${i}`), t0 = Date.now(), topic = 'sgtest/' + Math.random().toString(36).slice(2); let done = false, sentAt = 0;
      const fin = msg => { if (done) return; done = true; try { mq.close(); } catch {} if (el()) el().textContent = msg; res(); };
      const K = relayKind(b.url), mq = new K(b.url, () => fin(`✓ works, ${Date.now() - sentAt} ms`), s => { if (s === 'up') { if (!K.echo) return fin(`✓ answers, ${Date.now() - t0} ms (introductions only)`); mq.subscribe(topic); setTimeout(() => { sentAt = Date.now(); mq.publish(topic, Uint8Array.from([1])); }, 600); } else fin(`✗ ${s}`); });
      if (el()) el().textContent = 'testing…'; setTimeout(() => fin('✗ no answer in 8 s'), 8000);
    })));
  },
  saveList() {
    const L = this.draft, old = this.list(); if (!L.brokers.length) return toast('Keep at least one relay');
    if (JSON.stringify(L.brokers.map(b => b.url)) === JSON.stringify(old.brokers.map(b => b.url))) { store.set('relayList', { ...L, rev: old.rev }); return toast('Saved'); }
    store.set('relayList', { rev: old.rev + 1, brokers: L.brokers }); Log.i('relay', `Relay list revision ${old.rev + 1}`, { brokers: L.brokers.length });
    toast(this.peers().length ? 'Saved: paired devices keep the old list until you pair them again' : 'Saved'); this.onchange?.();
  },
  directSheet() {
    const c = this.directCfg(), o = (v, l) => `<option value="${v}" ${c.mode === v ? 'selected' : ''}>${l}</option>`;
    sheet('Direct link', `<p class="se-note">Once a device is online through the relays, StudioGen offers it a direct, encrypted WebRTC link (the relays carry the handshake). When it connects, requests go straight between the two; if it can’t, or drops, they stay on the relays, and StudioGen tries again later (after 1, 2, 5, then every 10 minutes).</p>
      <label class="se-field"><span>Try a direct link</span><select id="dcMode">${o('auto', 'Whenever possible, also across networks (STUN)')}${o('local', 'Only on the same network (no outside servers)')}${o('off', 'Never: relays only')}</select></label>
      <label class="se-check"><input type="checkbox" id="dcData" ${c.relayData !== false ? 'checked' : ''}> When there's no direct link, let requests and results go over the relays (encrypted). Off: the relays only introduce the two apps; without a direct link (or TURN) there's no connection.</label>
      <label class="se-field"><span>STUN servers (one per line): tell each side its public address, nothing passes through them</span><textarea id="dcStun" class="se-wide" rows="2">${esc(c.stun.join('\n'))}</textarea></label>
      <label class="se-field"><span>TURN server (optional; yours, for networks that block direct links: it relays the encrypted traffic)</span><input id="dcTurn" class="se-wz-in" value="${esc(c.turn.url)}" placeholder="turn:turn.example.com:3478"></label>
      <div class="se-row"><input id="dcUser" class="se-wz-in" value="${esc(c.turn.user)}" placeholder="TURN user"><input id="dcPass" class="se-wz-in" type="password" value="${esc(c.turn.pass)}" placeholder="TURN password"></div>`,
      [['Save', () => { store.set('directCfg', { mode: $('#dcMode').value, relayData: $('#dcData').checked, stun: $('#dcStun').value.split('\n').map(s => s.trim()).filter(Boolean), turn: { url: $('#dcTurn').value.trim(), user: $('#dcUser').value.trim(), pass: $('#dcPass').value } }); this.directTries = 0; this.lastTry = 0; if ($('#dcMode').value === 'off') Direct.close(); toast('Saved'); LinkHost.settings(); }], ['Cancel', () => LinkHost.settings()]]);
  },
};
ACTIONS.relays = () => Relay.editor();
ACTIONS.directLink = () => Relay.directSheet();
Relay.onchange = () => { clearTimeout(Relay.redraw); Relay.redraw = setTimeout(() => { if ($('.lk') && !$('.rl-list')) Link.settings(); }, 300); };
// Paired: always on while the app runs (the Mac answers; the phone can ask any time).
setTimeout(() => Relay.start(), 2000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Relay.rooms().length && !Relay.anyUp()) Relay.restart(); });
document.addEventListener('change', e => { const s = e.target.closest?.('[data-rlsched]'); if (s) { store.set('rekeyEvery', +s.value); toast(+s.value ? 'Secrets will change on schedule' : 'Secrets change only when you ask'); } });
addEventListener('online', () => { if (Relay.rooms().length) Relay.restart(); });
document.addEventListener('click', e => {
  const x = e.target.closest('[data-rlx]'); if (x) { e.stopPropagation(); const [k, i] = x.dataset.rlx.split(':'), L = Relay.draft;
    if (k === 'up') [L.brokers[i - 1], L.brokers[i]] = [L.brokers[i], L.brokers[i - 1]];
    if (k === 'down') [L.brokers[+i + 1], L.brokers[i]] = [L.brokers[i], L.brokers[+i + 1]];
    if (k === 'del') L.brokers.splice(+i, 1);
    if (k === 'add') { const u = $('#rlUrl').value.trim().replace(/^(nostr|tracker)\+/, ''); try { if (!/^wss:\/\//.test(u)) throw 0; new URL(u); } catch { return toast('A wss:// address, please'); } L.brokers.push({ url: $('#rlKind').value + u, name: $('#rlName').value.trim() }); }
    return Relay.editor(L); }
  const b = e.target.closest('[data-rl]'); if (!b) return; e.stopPropagation();
  const [k, id] = b.dataset.rl.split(':');
  if (k === 'hostpair') return Relay.hostPair();
  if (k === 'guestpair') return Relay.guestPair();
  if (k === 'relays') return Relay.editor();
  if (k === 'direct') return Relay.directSheet();
  if (k === 'rekey') { Relay.rekey(id); toast('New secret sent: it’s used once the device confirms'); return setTimeout(() => LinkHost.settings(), 300); }
  if (k === 'rekeyall') { Relay.peers().forEach(p => Relay.rekey(p.id)); toast('New secrets sent to every device'); return setTimeout(() => LinkHost.settings(), 300); }
  if (k === 'revoke') { Relay.revoke(id); toast('Revoked: that device can’t reach StudioGen any more'); return LinkHost.settings(); }
  if (k === 'forget') { Relay.forget(); toast('Forgotten'); closeSheet(); }
  if (k === 'allow') { store.set('directAllow', !store.get('directAllow', true)); if (!store.get('directAllow', true)) Direct.close(); Link.settings(); }
}, true);
