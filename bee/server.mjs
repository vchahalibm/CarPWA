// StudioGBee: the optional always-on hive for a StudioGen mesh (design: docs/studiogbee.html § 5 and § 7).
//   - Devices (StudioGen, DriveGen) connect over a WebSocket (/ws) and prove who they are by signing a challenge with their
//     mesh device key; the bee checks it against the mesh's roster, which a mesh owner registered with the bee's admin code
//     and which only an owner's signature can change.
//   - It carries sealed messages between members (sealed end to end with their pairwise keys: the bee sees only who, to
//     whom, what kind, how big and when), keeps them while the receiver is offline until they expire, and sends a push
//     ("your answer is ready", no contents) to a DriveGen that is away.
//   - It keeps each StudioGen's library backup (sealed with the mesh's group key).
//   - Bees of different teams link with a code one owner gives the other; nothing is forwarded until the code's owner accepts.
//   - The dashboard (/dashboard) shows mesh owners the metadata: who is online, what waits, what flowed. Login: a code from a
//     mesh owner's StudioGen, or a passkey registered after that.
// Data in $BEE_DATA (default ./data): state.json, queue.json, events.json. Run: node server.mjs, or Docker (bee/README.md).
import http from 'http'; import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import webpush from 'web-push';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = +process.env.PORT || 8840, DATA = path.resolve(process.env.BEE_DATA || path.join(HERE, 'data')), NAME = process.env.BEE_NAME || 'StudioGBee';
const MAX_MSG = 512 * 1024, MAX_BACKUP = 4 * 1024 * 1024, MAX_TTL = 7 * 86400000;
fs.mkdirSync(DATA, { recursive: true });
const b64u = b => Buffer.from(b).toString('base64url'), J = o => JSON.stringify(o), now = () => Date.now();
const code = n => Array.from(crypto.randomBytes(n), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const write = (f, o) => { const p = path.join(DATA, f); fs.writeFileSync(p + '.tmp', J(o)); fs.renameSync(p + '.tmp', p); };

/* ---------- State ---------- */
const S = load('state.json', {});
S.id ||= b64u(crypto.randomBytes(12)); S.vapid ||= webpush.generateVAPIDKeys();
S.admin = process.env.BEE_ADMIN_CODE || S.admin || code(10);
S.meshes ||= {}; S.peers ||= {}; S.linkTokens ||= {}; S.passkeys ||= []; S.subs ||= {}; S.backups ||= {}; S.seen ||= {};
S.settings = { keepDays: 7, push: true, ...(S.settings || {}) };
let Q = load('queue.json', []), EV = load('events.json', []);
let dirty = false; const save = () => { dirty = true; };
setInterval(() => { if (!dirty) return; dirty = false; write('state.json', S); write('queue.json', Q); write('events.json', EV); }, 1000);
webpush.setVapidDetails(process.env.BEE_CONTACT || 'mailto:admin@studiogbee.invalid', S.vapid.publicKey, S.vapid.privateKey);
const started = now();

/** Metadata only: what happened, between whom, how big; never contents. */
function event(kind, d = {}) {
  EV.push({ at: now(), kind, ...d }); if (EV.length > 20000) EV.splice(0, EV.length - 20000); save();
  for (const s of dashSocks) if (!d.mesh || s.mesh === d.mesh) try { s.send(J({ t: 'event', e: EV[EV.length - 1] })); } catch {}
}
setInterval(() => { const cut = now() - S.settings.keepDays * 86400000; const i = EV.findIndex(e => e.at >= cut); if (i > 0) { EV.splice(0, i); save(); } }, 3600000);

/* ---------- The roster, as js/mesh.js signs it ---------- */
const rosterStr = r => J([r.rev, r.members.map(x => [x.id, x.sigPub.x, x.sigPub.y, x.dhPub.x, x.dhPub.y, x.name, x.app, x.role, !!x.mayInvite, x.perms || {}, x.invitedBy || ''])]);
async function verify(pub, str, sig) {
  try { const k = await crypto.subtle.importKey('jwk', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(sig, 'base64url'), new TextEncoder().encode(str)); } catch { return false; }
}
async function rosterOk(r, trusted) { const signer = (trusted || r?.members || []).find(x => x.id === r?.by && x.role === 'owner'); return !!signer && verify(signer.sigPub, rosterStr(r), r.sig); }
const member = (mesh, id) => S.meshes[mesh]?.roster.members.find(x => x.id === id);
const isOwner = (mesh, id) => member(mesh, id)?.role === 'owner';
const meshOf = dev => Object.values(S.meshes).find(m => m.roster.members.some(x => x.id === dev))?.id;

/* ---------- Devices ---------- */
const conns = new Map();     // device id → socket
const peerOnline = new Map(); // peer bee id → Set of device ids online there
const dashCodes = new Map(); // code → { mesh, until }
const sessions = new Map();  // cookie → { mesh, until }
const dashSocks = new Set();
const online = dev => conns.has(dev) || [...peerOnline.values()].some(s => s.has(dev));
const send = (ws, o) => { try { if (ws.readyState === WebSocket.OPEN) ws.send(J(o)); } catch {} };

/** A message to a device: straight to it, through a linked bee it's on, or kept until it comes (or the message expires). */
function deliver(m) {
  const ws = conns.get(m.to);
  if (ws) { send(ws, { t: 'msg', id: m.id, from: m.from, kind: m.kind, data: m.data, at: m.at, until: m.until }); event('delivered', meta(m)); return; }
  for (const [pid, devs] of peerOnline) if (devs.has(m.to) && peerSend(pid, { t: 'fwd', msg: m })) { event('forwarded', { ...meta(m), peer: S.peers[pid]?.name || pid }); return; }
  if (!Q.some(x => x.id === m.id)) { Q.push(m); event('queued', meta(m)); save(); }
  if (m.kind === 're') pushTo(m.to, m.from);
}
const meta = m => ({ mesh: m.mesh, id: m.id, from: m.from, to: m.to, k: m.kind, size: m.data?.length || 0, waited: m.at ? now() - m.at : 0 });
/** What was waiting for a device that has just come (here, or on a linked bee). */
function flush(dev) { const mine = Q.filter(m => m.to === dev); if (!mine.length) return; for (const m of mine) deliver(m); }
setInterval(() => { // expired: the sender is told, so its card can say so
  const t = now(), gone = Q.filter(m => m.until < t); if (!gone.length) return;
  Q = Q.filter(m => m.until >= t); save();
  for (const m of gone) { event('expired', meta(m)); const s = conns.get(m.from); if (s) send(s, { t: 'expired', id: m.id, to: m.to }); }
}, 5000);
async function pushTo(dev, from) {
  const sub = S.subs[dev]; if (!sub || !S.settings.push) return;
  const mesh = meshOf(dev), who = member(mesh, from)?.name || 'your Mac';
  try { await webpush.sendNotification(sub, J({ title: 'DriveGen', body: `Your answer from ${who} is ready`, tag: 'bee-answer' }), { TTL: 3600 }); event('push', { mesh, to: dev }); }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { delete S.subs[dev]; save(); } event('push-failed', { mesh, to: dev, note: String(e.statusCode || e.message).slice(0, 60) }); }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BACKUP + 65536 });
wss.on('connection', ws => {
  const nonce = b64u(crypto.randomBytes(24)); ws.alive = true;
  send(ws, { t: 'challenge', nonce, bee: { id: S.id, name: NAME, vapid: S.vapid.publicKey } });
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', async raw => { let m; try { m = JSON.parse(raw); } catch { return; } try { await onDevice(ws, m, nonce); } catch (e) { send(ws, { t: 'error', re: m.t, rid: m.rid, error: e.message }); } });
  ws.on('close', () => { if (ws.dev && conns.get(ws.dev) === ws) { conns.delete(ws.dev); S.seen[ws.dev] = now(); save(); event('offline', { mesh: ws.mesh, dev: ws.dev }); peersAll({ t: 'offline', devs: [ws.dev] }); } });
});
setInterval(() => { for (const ws of [...wss.clients]) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 30000);

async function onDevice(ws, m, nonce) {
  const ok = (o = {}) => send(ws, { t: 'ok', re: m.t, rid: m.rid, ...o });
  if (m.t === 'register') { // a mesh owner adds this bee to the mesh (the admin code is printed when the bee starts)
    if (m.code !== S.admin) throw new Error('Wrong admin code (it’s in the bee’s log: docker logs studiogbee)');
    const r = m.roster; if (!r?.members || !(await rosterOk(r))) throw new Error('The member list isn’t signed by an owner');
    if (typeof m.mesh !== 'string' || !m.mesh) throw new Error('Which mesh?');
    const old = S.meshes[m.mesh]; if (old && !(await rosterOk(r, old.roster.members))) throw new Error('That mesh is here already, with other owners');
    S.meshes[m.mesh] = { id: m.mesh, name: String(m.meshName || 'Mesh').slice(0, 60), roster: old && old.roster.rev > r.rev ? old.roster : r, at: old?.at || now() }; save();
    event('registered', { mesh: m.mesh, dev: m.dev });
    m.t = 'auth'; // and signs in as usual
  }
  if (m.t === 'auth') {
    const mesh = S.meshes[m.mesh], who = member(m.mesh, m.dev);
    if (!mesh) throw new Error('This bee doesn’t know that mesh: an owner adds it (StudioGen › Settings › Connections › StudioGBee)');
    if (!who) throw new Error('Not a member of the mesh');
    if (!(await verify(who.sigPub, `${nonce}|${m.mesh}|${S.id}`, m.sig))) throw new Error('The signature doesn’t match');
    const old = conns.get(m.dev); if (old && old !== ws) try { old.close(); } catch {}
    Object.assign(ws, { dev: m.dev, mesh: m.mesh, app: String(m.app || who.app || '').slice(0, 20), ver: String(m.ver || '').slice(0, 20) }); conns.set(m.dev, ws); S.seen[m.dev] = now(); save();
    event('online', { mesh: m.mesh, dev: m.dev, app: ws.app, ver: ws.ver });
    ok({ bee: { id: S.id, name: NAME, vapid: S.vapid.publicKey }, owner: who.role === 'owner', rosterRev: mesh.roster.rev, push: !!S.subs[m.dev] });
    peersAll({ t: 'online', devs: [m.dev] }); flush(m.dev); return;
  }
  if (!ws.dev) throw new Error('Sign in first');
  const mesh = S.meshes[ws.mesh], owner = isOwner(ws.mesh, ws.dev);
  if (!member(ws.mesh, ws.dev)) { ws.close(); return; } // removed from the mesh meanwhile
  switch (m.t) {
    case 'roster': { // a newer member list, signed by an owner of the one here
      const r = m.roster; if (!r || r.rev <= mesh.roster.rev) return ok({ rosterRev: mesh.roster.rev });
      if (!(await rosterOk(r, mesh.roster.members))) throw new Error('Not signed by an owner');
      mesh.roster = r; save(); event('roster', { mesh: ws.mesh, dev: ws.dev, rev: r.rev });
      for (const [d, s] of conns) if (s.mesh === ws.mesh && !member(ws.mesh, d)) s.close(); // removed members are let go
      return ok({ rosterRev: r.rev });
    }
    case 'send': {
      if (!member(ws.mesh, m.to)) throw new Error('Not a member of the mesh');
      if (typeof m.data !== 'string' || m.data.length > MAX_MSG) throw new Error('Too big');
      const msg = { id: String(m.id).slice(0, 40), mesh: ws.mesh, from: ws.dev, to: m.to, kind: String(m.kind).slice(0, 12), data: m.data, at: now(), until: now() + Math.min(Math.max(+m.ttl || 600000, 5000), MAX_TTL) };
      deliver(msg); return ok({ id: msg.id, queued: Q.some(x => x.id === msg.id) });
    }
    case 'ack': { const n = Q.length; Q = Q.filter(x => !(x.id === m.id && x.to === ws.dev)); if (Q.length !== n) save(); return; }
    case 'push-sub': { if (m.sub?.endpoint && /^https:\/\//.test(m.sub.endpoint)) { S.subs[ws.dev] = m.sub; save(); event('push-on', { mesh: ws.mesh, dev: ws.dev }); } else { delete S.subs[ws.dev]; save(); } return ok(); }
    case 'backup-put': {
      if (typeof m.data !== 'string' || m.data.length > MAX_BACKUP) throw new Error('Too big');
      (S.backups[ws.mesh] ||= {})[`${ws.dev}|${m.kind}`] = { dev: ws.dev, name: String(m.name || member(ws.mesh, ws.dev).name).slice(0, 60), kind: String(m.kind).slice(0, 20), at: now(), data: m.data };
      save(); event('backup', { mesh: ws.mesh, dev: ws.dev, size: m.data.length }); return ok();
    }
    case 'backup-list': return ok({ list: Object.values(S.backups[ws.mesh] || {}).map(({ dev, name, kind, at, data }) => ({ dev, name, kind, at, size: data.length })) });
    case 'backup-get': { const b = (S.backups[ws.mesh] || {})[`${m.dev}|${m.kind}`]; if (!b) throw new Error('No such backup'); return ok({ data: b.data, at: b.at, name: b.name }); }
    case 'dash-code': { if (!owner) throw new Error('Only a mesh owner'); const c = code(8); dashCodes.set(c, { mesh: ws.mesh, until: now() + 600000 }); return ok({ code: c }); }
    case 'link-code': { // to give the owner of another team's bee
      if (!owner) throw new Error('Only a mesh owner'); const token = b64u(crypto.randomBytes(18)); S.linkTokens[token] = { mesh: ws.mesh, until: now() + 86400000 }; save();
      return ok({ code: 'SGB1' + b64u(J({ u: String(m.url || ''), t: token, b: S.id, n: NAME })) });
    }
    case 'link-join': { // the code another team's owner gave you: this bee asks theirs to link (they accept on theirs)
      if (!owner) throw new Error('Only a mesh owner');
      let c; try { c = JSON.parse(Buffer.from(String(m.code).replace(/^SGB1/, ''), 'base64url')); } catch { throw new Error('That isn’t a bee link code'); }
      if (!c.u || !c.t || !c.b) throw new Error('That isn’t a bee link code'); if (c.b === S.id) throw new Error('That code is from this bee');
      S.peers[c.b] = { id: c.b, name: c.n || 'bee', url: c.u, token: c.t, state: 'asked', dir: 'out', by: ws.mesh, at: now() }; save();
      event('link-asked', { mesh: ws.mesh, peer: c.n }); peerConnect(c.b); return ok({ peer: c.b });
    }
    case 'link-accept': { if (!owner) throw new Error('Only a mesh owner'); return ok(linkAccept(m.peer, ws.mesh)); }
    case 'link-drop': { if (!owner) throw new Error('Only a mesh owner'); linkDrop(m.peer); return ok(); }
    case 'status': return ok(status(ws.mesh));
    default: throw new Error(`Unknown request ${m.t}`);
  }
}
function status(mesh) {
  return { bee: { id: S.id, name: NAME, since: started }, queued: Q.filter(m => m.mesh === mesh).length, backups: Object.keys(S.backups[mesh] || {}).length,
    peers: Object.values(S.peers).map(p => ({ id: p.id, name: p.name, state: p.state, dir: p.dir, up: !!peerSocks.get(p.id)?.ready, online: peerOnline.get(p.id)?.size || 0 })) };
}

/* ---------- Linked bees (another team's) ---------- */
const peerSocks = new Map(); // peer id → socket (ready once both sides said hello)
const peerSend = (pid, o) => { const s = peerSocks.get(pid); if (!s?.ready || S.peers[pid]?.state !== 'active') return false; send(s, o); return true; };
const peersAll = o => { for (const pid of peerSocks.keys()) peerSend(pid, o); };
const hosted = () => [...conns.keys()];
function peerReady(pid, ws) {
  ws.ready = true; peerSocks.set(pid, ws); peerOnline.set(pid, new Set());
  if (S.peers[pid]?.state === 'active') send(ws, { t: 'online', devs: hosted() });
}
function onPeer(pid, ws, m) {
  const p = S.peers[pid]; if (!p) return;
  if (m.t === 'accepted' && p.dir === 'out') { p.state = 'active'; save(); event('linked', { peer: p.name }); send(ws, { t: 'online', devs: hosted() }); return; }
  if (m.t === 'dropped') { linkDrop(pid, true); return; }
  if (p.state !== 'active') return;
  if (m.t === 'online') { const s = peerOnline.get(pid) || new Set(); for (const d of m.devs || []) { s.add(d); flush(d); } peerOnline.set(pid, s); }
  else if (m.t === 'offline') { const s = peerOnline.get(pid); for (const d of m.devs || []) s?.delete(d); }
  else if (m.t === 'fwd' && m.msg?.to) { const msg = { ...m.msg, hops: (m.msg.hops || 0) + 1 }; if (msg.hops > 2) return; if (conns.has(msg.to)) deliver(msg); else if (!Q.some(x => x.id === msg.id)) { Q.push(msg); event('queued', { ...meta(msg), via: p.name }); save(); } }
}
function linkAccept(pid, mesh) {
  const p = S.peers[pid]; if (!p) throw new Error('No such bee'); if (p.dir !== 'in') throw new Error('The other team accepts this one');
  p.state = 'active'; p.acceptedBy = mesh; save(); event('linked', { mesh, peer: p.name });
  const s = peerSocks.get(pid); if (s) { send(s, { t: 'accepted' }); send(s, { t: 'online', devs: hosted() }); }
  return { peer: pid };
}
function linkDrop(pid, quiet) { const s = peerSocks.get(pid); if (s && !quiet) send(s, { t: 'dropped' }); try { s?.close(); } catch {} peerSocks.delete(pid); peerOnline.delete(pid); const n = S.peers[pid]?.name; delete S.peers[pid]; save(); event('unlinked', { peer: n }); }
/** This bee calls another (the one whose code its owner pasted), and keeps calling while the link stands. */
function peerConnect(pid) {
  const p = S.peers[pid]; if (!p || p.dir !== 'out' || peerSocks.get(pid)) return;
  const url = p.url.replace(/^http/, 'ws').replace(/\/(ws|peer)?$/, '') + '/peer';
  let ws; try { ws = new WebSocket(url); } catch { return; }
  ws.on('open', () => send(ws, { t: 'peer-hello', bee: { id: S.id, name: NAME }, token: p.token }));
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch { return; } if (m.t === 'peer-ok') { if (m.state === 'active') { p.state = 'active'; save(); } peerReady(pid, ws); return; } if (ws.ready) onPeer(pid, ws, m); });
  ws.on('close', () => { if (peerSocks.get(pid) === ws) { peerSocks.delete(pid); peerOnline.delete(pid); } if (S.peers[pid]) setTimeout(() => peerConnect(pid), 10000); });
  ws.on('error', () => {});
}
const pwss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG + 65536 });
pwss.on('connection', ws => {
  let pid = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!pid) { // the first message: who it is, with the token from this bee's code
      if (m.t !== 'peer-hello' || !m.bee?.id) return ws.close();
      const known = S.peers[m.bee.id], tok = S.linkTokens[m.token];
      if (known?.dir === 'in' && known.token === m.token) pid = m.bee.id;
      else if (tok && tok.until > now()) { pid = m.bee.id; S.peers[pid] = { id: pid, name: String(m.bee.name || 'bee').slice(0, 60), token: m.token, state: 'pending', dir: 'in', for: tok.mesh, at: now() }; delete S.linkTokens[m.token]; save(); event('link-request', { mesh: tok.mesh, peer: S.peers[pid].name }); }
      else return ws.close();
      send(ws, { t: 'peer-ok', state: S.peers[pid].state }); peerReady(pid, ws); return;
    }
    onPeer(pid, ws, m);
  });
  ws.on('close', () => { if (pid && peerSocks.get(pid) === ws) { peerSocks.delete(pid); peerOnline.delete(pid); } });
});
for (const p of Object.values(S.peers)) if (p.dir === 'out') peerConnect(p.id);

/* ---------- The dashboard: metadata for mesh owners ---------- */
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(c => [c.split('=')[0], decodeURIComponent(c.split('=').slice(1).join('='))]));
const session = req => { const s = sessions.get(cookie(req).bee_s); return s && s.until > now() ? s : null; };
const origin = req => `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const challenges = new Map(); // challenge → { until, mesh? }
function login(res, req, mesh) {
  const tok = b64u(crypto.randomBytes(24)); sessions.set(tok, { mesh, until: now() + 12 * 3600000 });
  res.setHeader('set-cookie', `bee_s=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${origin(req).startsWith('https') ? '; Secure' : ''}`);
  event('dashboard-login', { mesh });
}
function dashState(mesh) {
  const m = S.meshes[mesh]; if (!m) return null;
  const peerOf = d => { for (const [pid, s] of peerOnline) if (s.has(d)) return S.peers[pid]?.name; return null; };
  return { ...status(mesh), now: now(), mesh: { id: m.id, name: m.name, rev: m.roster.rev },
    devices: m.roster.members.map(x => ({ id: x.id, name: x.name, app: x.app, role: x.role, online: online(x.id), here: conns.has(x.id), via: conns.has(x.id) ? NAME : peerOf(x.id), seen: S.seen[x.id] || null, ver: conns.get(x.id)?.ver || '', push: !!S.subs[x.id] })),
    queue: Q.filter(q => q.mesh === mesh).map(q => ({ id: q.id, from: q.from, to: q.to, k: q.kind, at: q.at, until: q.until, size: q.data.length })),
    events: EV.filter(e => !e.mesh || e.mesh === mesh).slice(-500), settings: S.settings, passkeys: S.passkeys.filter(p => p.mesh === mesh).map(p => ({ id: p.id.slice(0, 10), at: p.at, name: p.name })) };
}
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; if (s.length > 65536) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(J(o)); };
  try {
    if (u.pathname === '/healthz') return json({ ok: true, name: NAME, id: S.id, since: started, devices: conns.size, queued: Q.length });
    if (u.pathname === '/api/login' && req.method === 'POST') { const b = await body(req), c = dashCodes.get(String(b.code || '').toUpperCase().replace(/\s+/g, '')); if (!c || c.until < now()) return json({ error: 'That code isn’t valid (get a new one in StudioGen)' }, 401); dashCodes.delete(String(b.code).toUpperCase().replace(/\s+/g, '')); login(res, req, c.mesh); return json({ ok: true }); }
    if (u.pathname === '/api/passkey/options' && req.method === 'POST') { // a challenge, to register (signed in) or to sign in
      const ch = b64u(crypto.randomBytes(32)), s = session(req); challenges.set(ch, { until: now() + 300000, mesh: s?.mesh });
      return json({ challenge: ch, rpId: new URL(origin(req)).hostname, name: NAME, user: s ? { id: b64u(Buffer.from(s.mesh)), name: S.meshes[s.mesh]?.name || 'mesh' } : null, allow: s ? [] : S.passkeys.map(p => p.id) });
    }
    if (u.pathname === '/api/passkey/register' && req.method === 'POST') {
      const s = session(req); if (!s) return json({ error: 'Sign in with a code first' }, 401);
      const b = await body(req), cd = JSON.parse(Buffer.from(b.clientDataJSON || '', 'base64url'));
      const ch = challenges.get(cd.challenge); if (cd.type !== 'webauthn.create' || !ch || ch.until < now() || cd.origin !== origin(req)) return json({ error: 'The passkey couldn’t be checked' }, 400);
      challenges.delete(cd.challenge); crypto.createPublicKey({ key: Buffer.from(b.spki, 'base64url'), format: 'der', type: 'spki' }); // it must be a key
      S.passkeys.push({ id: String(b.id), spki: b.spki, mesh: s.mesh, at: now(), name: String(b.name || 'Passkey').slice(0, 40) }); save(); event('passkey-added', { mesh: s.mesh });
      return json({ ok: true });
    }
    if (u.pathname === '/api/passkey/login' && req.method === 'POST') {
      const b = await body(req), pk = S.passkeys.find(p => p.id === b.id); if (!pk) return json({ error: 'Unknown passkey: sign in with a code' }, 401);
      const cdRaw = Buffer.from(b.clientDataJSON || '', 'base64url'), cd = JSON.parse(cdRaw), ch = challenges.get(cd.challenge);
      if (cd.type !== 'webauthn.get' || !ch || ch.until < now() || cd.origin !== origin(req)) return json({ error: 'The passkey couldn’t be checked' }, 400);
      const ad = Buffer.from(b.authenticatorData, 'base64url'), rp = crypto.createHash('sha256').update(new URL(origin(req)).hostname).digest();
      if (!ad.subarray(0, 32).equals(rp) || !(ad[32] & 1)) return json({ error: 'The passkey is for another site' }, 400);
      const signed = Buffer.concat([ad, crypto.createHash('sha256').update(cdRaw).digest()]);
      const good = crypto.verify('sha256', signed, { key: Buffer.from(pk.spki, 'base64url'), format: 'der', type: 'spki', dsaEncoding: 'der' }, Buffer.from(b.signature, 'base64url'));
      if (!good) return json({ error: 'The passkey’s signature doesn’t match' }, 401);
      challenges.delete(cd.challenge); login(res, req, pk.mesh); return json({ ok: true });
    }
    if (u.pathname.startsWith('/api/')) {
      const s = session(req); if (!s) return json({ error: 'Sign in' }, 401);
      if (u.pathname === '/api/state') return json(dashState(s.mesh));
      if (u.pathname === '/api/logout' && req.method === 'POST') { sessions.delete(cookie(req).bee_s); return json({ ok: true }); }
      if (u.pathname === '/api/drop' && req.method === 'POST') { const b = await body(req), m = Q.find(q => q.id === b.id && q.mesh === s.mesh); if (m) { Q = Q.filter(q => q !== m); save(); event('dropped', meta(m)); } return json({ ok: !!m }); }
      if (u.pathname === '/api/settings' && req.method === 'POST') { const b = await body(req); if ([1, 7, 30, 90].includes(+b.keepDays)) S.settings.keepDays = +b.keepDays; if (typeof b.push === 'boolean') S.settings.push = b.push; save(); return json(S.settings); }
      if (u.pathname === '/api/link/accept' && req.method === 'POST') { const b = await body(req); return json(linkAccept(b.peer, s.mesh)); }
      if (u.pathname === '/api/link/drop' && req.method === 'POST') { const b = await body(req); linkDrop(b.peer); return json({ ok: true }); }
      if (u.pathname === '/api/passkey/delete' && req.method === 'POST') { const b = await body(req); S.passkeys = S.passkeys.filter(p => !(p.mesh === s.mesh && p.id.startsWith(String(b.id)))); save(); return json({ ok: true }); }
      return json({ error: 'Not found' }, 404);
    }
    const file = u.pathname === '/' || u.pathname === '/dashboard' ? 'dashboard.html' : u.pathname.slice(1);
    const f = path.join(HERE, 'public', path.normalize(file)); if (!f.startsWith(path.join(HERE, 'public'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'" }); res.end(d); });
  } catch (e) { json({ error: e.message }, 500); }
});
const dwss = new WebSocketServer({ noServer: true }); // the dashboard's live events
dwss.on('connection', (ws, s) => { ws.mesh = s.mesh; dashSocks.add(ws); ws.on('close', () => dashSocks.delete(ws)); });
server.on('upgrade', (req, sock, head) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/ws') return wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req));
  if (p === '/peer') return pwss.handleUpgrade(req, sock, head, ws => pwss.emit('connection', ws, req));
  if (p === '/api/live') { const s = session(req); if (!s) return sock.destroy(); return dwss.handleUpgrade(req, sock, head, ws => dwss.emit('connection', ws, s)); }
  sock.destroy();
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`${NAME} (${S.id}) on port ${PORT}; data in ${DATA}`);
  console.log(`Admin code (a mesh owner types it to add this bee to their mesh): ${S.admin}`);
});
const bye = () => { write('state.json', S); write('queue.json', Q); write('events.json', EV); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
