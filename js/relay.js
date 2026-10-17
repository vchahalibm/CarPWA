'use strict';
/* ============================================================
   The relay link: DriveGen ↔ StudioGen from anywhere, no account, no server
   of ours. Messages go through public MQTT brokers (secure WebSockets) and
   are end-to-end encrypted, so a broker only sees a random topic and noise.
   - Pair once: StudioGen shows a QR code ("SG2…": a random room and a
     256-bit key); the phone scans it. Each device has its own room and key;
     Revoke in StudioGen deletes it.
   - Every message: AES-GCM with that key (the topic, i.e. the direction, as
     additional data), a timestamp (older than 2 minutes: dropped) and an id
     (seen before: dropped). Published to two brokers at once; whichever
     arrives first counts.
   - Over it: presence (hello), the same requests as the other links (offers,
     run, say; answers are kept 10 minutes, so a resent request gets the same
     answer), and the WebRTC handshake: once both are online they try a
     direct connection (js/direct.js, with STUN to cross networks), used when
     it connects; otherwise the requests stay on the relay.
   - Relay: a minimal MQTT 3.1.1 client over WebSocket (QoS 0), below.
   Loaded after direct.js.
   ============================================================ */
const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const RELAY_STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const b64u = { enc: b => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) };

/* ---------- MQTT 3.1.1 over WebSocket, QoS 0: connect, subscribe, publish, ping ---------- */
class Mqtt {
  constructor(url, onMsg, onState) { this.url = url; this.onMsg = onMsg; this.onState = onState; this.subs = new Set(); this.buf = new Uint8Array(0); this.open(); }
  open() {
    if (this.closed) return;
    const ws = this.ws = new WebSocket(this.url, 'mqtt'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => { const id = 'sg' + Math.random().toString(36).slice(2, 12); this.send(0x10, [...this.str('MQTT'), 4, 0x02, 0, 60, ...this.str(id)]); };
    ws.onmessage = e => this.read(new Uint8Array(e.data));
    ws.onclose = () => { this.up = false; this.onState?.(); clearInterval(this.pinger); if (!this.closed) setTimeout(() => this.open(), 3000 + Math.random() * 4000); };
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
      if (type === 2) { this.up = body[1] === 0; this.onState?.(); for (const t of this.subs) this.subscribe(t, true); clearInterval(this.pinger); this.pinger = setInterval(() => this.send(0xC0, []), 30000); }
      else if (type === 3) { const tl = (body[0] << 8) | body[1], topic = new TextDecoder().decode(body.slice(2, 2 + tl)), q = (head >> 1) & 3; this.onMsg(topic, body.slice(2 + tl + (q ? 2 : 0))); }
    }
  }
  subscribe(topic, again) { this.subs.add(topic); if (!this.up && !again) return; this.send(0x82, [0, 1, ...this.str(topic), 0]); }
  publish(topic, payload) { return this.send(0x30, [...this.str(topic), ...payload]); }
  close() { this.closed = true; clearInterval(this.pinger); try { this.ws?.close(); } catch {} }
}

const Relay = {
  conns: [], seen: new Map(), waits: new Map(), answers: new Map(), online: {},
  isMac: () => !!window.DriveDeckDesktop,
  /** StudioGen: one room per paired device. DriveGen: the Mac it paired with. */
  peers: () => store.get('relayPeers', []),
  mac: () => store.get('relayMac', null),
  rooms() { return this.isMac() ? this.peers() : this.mac() ? [this.mac()] : []; },
  ready() { return !this.isMac() && !!this.mac() && !!this.online.mac && this.conns.some(c => c.up); },
  /* ---------- Keys and topics ---------- */
  keys: new Map(),
  async key(room) { if (!this.keys.has(room.room)) this.keys.set(room.room, await crypto.subtle.importKey('raw', b64u.dec(room.key), 'AES-GCM', false, ['encrypt', 'decrypt'])); return this.keys.get(room.room); },
  async topic(room, dir) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`studiogen-relay:${room.room}:${dir}`))); return `sg1/${[...h.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('')}`; },
  /* ---------- Connecting ---------- */
  async start() {
    if (this.started || !this.rooms().length) return; this.started = true;
    this.conns = RELAY_BROKERS.slice(0, 2).map(u => new Mqtt(u, (t, p) => this.got(t, p), () => this.state()));
    await this.listen();
    clearInterval(this.beat); this.beat = setInterval(() => this.hello(), 25000); setTimeout(() => this.hello(), 1500);
    Log.i('relay', 'Relay started', { rooms: this.rooms().length });
  },
  stop() { this.conns.forEach(c => c.close()); this.conns = []; this.started = false; clearInterval(this.beat); this.online = {}; },
  async listen() { this.topics = {}; for (const r of this.rooms()) { const t = await this.topic(r, this.isMac() ? 'to-mac' : 'to-dev'); this.topics[t] = r; this.conns.forEach(c => c.subscribe(t)); } },
  state() { this.onchange?.(); },
  /* ---------- Sending and receiving ---------- */
  async post(room, type, body) {
    const t = await this.topic(room, this.isMac() ? 'to-dev' : 'to-mac'), iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ id: Math.random().toString(36).slice(2), ts: Date.now(), type, body }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(t) }, await this.key(room), plain));
    const p = new Uint8Array(12 + ct.length); p.set(iv); p.set(ct, 12);
    let sent = false; for (const c of this.conns) sent = c.publish(t, p) || sent; return sent;
  },
  async got(topic, payload) {
    const room = this.topics?.[topic]; if (!room || payload.length < 29) return;
    let m; try { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.slice(0, 12), additionalData: new TextEncoder().encode(topic) }, await this.key(room), payload.slice(12)); m = JSON.parse(new TextDecoder().decode(pt)); } catch { return; } // not ours, or tampered
    if (Math.abs(Date.now() - m.ts) > 120000 || this.seen.has(m.id)) return; // old, or the other broker's copy
    this.seen.set(m.id, Date.now()); if (this.seen.size > 500) for (const [k, t] of this.seen) if (Date.now() - t > 150000) this.seen.delete(k);
    this.handle(room, m.type, m.body || {});
  },
  async handle(room, type, b) {
    if (type === 'hello') {
      const was = this.isMac() ? this.online[room.room] : this.online.mac;
      if (this.isMac()) { this.online[room.room] = Date.now(); if (b.name && b.name !== room.name) this.rename(room, b.name); if (!b.re) this.post(room, 'hello', { name: 'StudioGen', re: 1 }); }
      else { this.online.mac = Date.now(); if (b.name) store.set('relayMac', { ...this.mac(), name: b.name }); }
      if (!was) { Log.i('relay', `${this.isMac() ? room.name || 'A device' : 'Your Mac'} is online (relay)`); this.state(); if (this.isMac()) setTimeout(() => this.tryDirect(room), 800); }
      return;
    }
    if (type === 'ask' && this.isMac()) { // DriveGen's request; the answer is kept so a resent request gets it again
      if (this.answers.has(b.id)) { const a = this.answers.get(b.id); if (a !== 'busy') this.post(room, 're', a); return; }
      this.answers.set(b.id, 'busy'); setTimeout(() => this.answers.delete(b.id), 600000);
      let a; try { Direct.peer ||= room.name; a = { id: b.id, result: await Direct.handle(b.kind, { ...(b.payload || {}) }) }; } catch (e) { a = { id: b.id, error: e.message }; }
      this.answers.set(b.id, a); this.post(room, 're', a); return;
    }
    if (type === 're') { const w = this.waits.get(b.id); if (w) { this.waits.delete(b.id); clearTimeout(w.t); clearInterval(w.again); b.error ? w.rej(new Error(b.error)) : w.res(b.result); } return; }
    // The WebRTC handshake, so the two talk directly when the networks let them.
    if (type === 'rtc-offer' && !this.isMac()) { try { const code = await Direct.answer(b.code, RELAY_STUN); this.post(room, 'rtc-answer', { code }); } catch (e) { Log.w('relay', 'Direct answer failed', e); } return; }
    if (type === 'rtc-answer' && this.isMac()) { try { await Direct.accept(b.code); } catch (e) { Log.w('relay', 'Direct accept failed', e); } }
  },
  hello() { for (const r of this.rooms()) this.post(r, 'hello', { name: this.isMac() ? 'StudioGen' : Direct.myName() }); const now = Date.now();
    for (const k of Object.keys(this.online)) if (now - this.online[k] > 70000) { delete this.online[k]; this.state(); } },
  async tryDirect(room) {
    if (Direct.connected || Date.now() - (this.lastTry || 0) < 60000) return; this.lastTry = Date.now();
    try { const code = await Direct.offer(RELAY_STUN); Direct.peer = ''; this.post(room, 'rtc-offer', { code }); } catch (e) { Log.w('relay', 'Direct offer failed', e); }
  },
  rename(room, name) { store.set('relayPeers', this.peers().map(p => p.room === room.room ? { ...p, name, seen: new Date().toISOString() } : p)); },
  /** DriveGen → the Mac: a request, resent every 15 s until answered (the Mac answers a resend from its kept answer). */
  call(kind, payload = {}, ms = 600000) {
    const room = this.mac(); if (!room) return Promise.reject(new Error('Not paired with a Mac'));
    const id = Math.random().toString(36).slice(2);
    return new Promise((res, rej) => {
      const send = () => this.post(room, 'ask', { id, kind, payload });
      const w = { res, rej, t: setTimeout(() => { this.waits.delete(id); clearInterval(w.again); rej(new Error('Your Mac didn’t answer: is StudioGen open?')); }, ms), again: setInterval(send, 15000) };
      this.waits.set(id, w); send();
    });
  },
  /* ---------- Pairing (once) ---------- */
  /** StudioGen: a new room and key for one device, as a code to scan. */
  newPairing() {
    const p = { id: Math.random().toString(36).slice(2, 8), room: b64u.enc(crypto.getRandomValues(new Uint8Array(16))), key: b64u.enc(crypto.getRandomValues(new Uint8Array(32))), name: 'A device (pairing…)', paired: new Date().toISOString() };
    store.set('relayPeers', [...this.peers(), p]); this.restart();
    return 'SG2' + b64u.enc(new TextEncoder().encode(JSON.stringify({ r: p.room, k: p.key })));
  },
  /** DriveGen: the scanned code. */
  pairWith(code) {
    if (!/^SG2[\w-]+$/.test(code)) throw new Error('That isn’t a StudioGen pairing code');
    const j = JSON.parse(new TextDecoder().decode(b64u.dec(code.slice(3))));
    store.set('relayMac', { room: j.r, key: j.k, name: 'Your Mac', paired: new Date().toISOString() }); this.restart();
  },
  restart() { this.stop(); this.keys.clear(); this.start(); },
  revoke(id) { store.set('relayPeers', this.peers().filter(p => p.id !== id)); this.restart(); },
  forget() { store.set('relayMac', null); this.stop(); },
  /** Pairing screens. */
  async hostPair() {
    closeSheet(); const code = this.newPairing();
    Direct.screen('Pair a phone or iPad (once)', `<div class="dl-step"><div class="dl-qr" id="dlQr"></div><div><p>On the phone or iPad: <b>DriveGen › Settings › Your Mac › Pair once</b>, and point its camera at this code.</p>
      <p>That’s all: from then on they find each other by themselves, from anywhere (mobile data too), through public relays that only ever see encrypted messages.</p><p class="se-note">Anyone who can scan this code can pair, so show it only to your own devices.</p></div></div>`);
    Direct.showCode($('#dlQr'), code);
  },
  async guestPair() {
    closeSheet(); Direct.screen('Pair with your Mac (once)', `<div class="dl-step"><div class="dl-cam" id="dlCam"></div><div><p>On the Mac: <b>StudioGen › Settings › Connections › Pair a phone (once)</b>. Point this camera at the code.</p><p class="se-note" id="dlState">Looking for the code…</p></div></div>`);
    try { const code = await Direct.scan($('#dlCam'), 'SG2'); this.pairWith(code); $('#dlState').textContent = 'Paired: finding your Mac…'; setTimeout(() => { Direct.done(); toast('Paired with your Mac'); }, 1500); }
    catch (e) { if ($('#dlState')) $('#dlState').textContent = e.message; }
  },
};
Relay.onchange = () => { if ($('.lk')) LinkHost.settings(); if (typeof current !== 'undefined' && current === 'settings' && $('#settingsBody')) renderSettings?.(); };
// Paired: always on while the app runs (the Mac answers; the phone can ask any time).
setTimeout(() => Relay.start(), 2000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Relay.rooms().length && !Relay.conns.some(c => c.up)) Relay.restart(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rl]'); if (!b) return; e.stopPropagation();
  const a = b.dataset.rl, [k, id] = a.split(':');
  if (k === 'hostpair') return Relay.hostPair();
  if (k === 'guestpair') return Relay.guestPair();
  if (k === 'revoke') { Relay.revoke(id); toast('Revoked: that device can’t reach StudioGen any more'); return LinkHost.settings(); }
  if (k === 'forget') { Relay.forget(); toast('Forgotten'); closeSheet(); }
}, true);
