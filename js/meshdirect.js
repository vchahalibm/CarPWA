'use strict';
/* ============================================================
   Direct links between mesh members (WebRTC data channels), one per pair, so devices that aren't the one paired
   phone-and-Mac also talk without the relays: full activity to every StudioGen, requests and shows straight across.
   - Set up through the pair's own encrypted room on the relays (Mesh.pairRoom): the member with the smaller id offers,
     the other answers; ICE gathered in full first (no trickle), the SDP deflated like Direct's codes.
   - Settings › Connections › Direct link applies: off (none), same network (no STUN), whenever possible (STUN/TURN).
   - The paired phone-and-Mac link (Direct) counts as the direct link for that pair: never a second one.
   - Tried again after a failure with growing pauses (1, 2, 5, 10 minutes); dropped links come back the same way.
   Loaded after mesh.js.
   ============================================================ */
const MeshDirect = {
  links: new Map(), // member id → { pc, ch, state: 'connecting' | 'open', since, tries, next, rtt, waits }
  me: () => Mesh._me?.id,
  /** The link to `id` if it's open: one of ours, or Direct when that member is the paired device. */
  open(id) { const l = this.links.get(id); return l?.ch?.readyState === 'open' ? l : null; },
  viaDirect: id => Direct.connected && Direct.peerMeshId === id,
  cfg() { const c = Relay.directCfg(); return { mode: c.mode, ice: c.mode === 'lan' ? [] : [...(c.stun || []).map(u => ({ urls: u })), ...(c.turn?.url ? [{ urls: c.turn.url, username: c.turn.user, credential: c.turn.pass }] : [])] }; },
  /** Every 15 s (and when someone shows up): offer to members online that have no link, when it's our turn. */
  tick() {
    if (!Mesh.m || this.cfg().mode === 'off' || typeof RTCPeerConnection === 'undefined') return;
    const me = this.me(); if (!me) return;
    for (const [id, p] of Object.entries(Mesh.presence)) {
      if (id === me || Date.now() - p.at > 45000 || !Mesh.member(id) || this.viaDirect(id)) continue;
      const l = this.links.get(id);
      if (l && (l.state === 'open' || l.state === 'connecting')) continue;
      if (me < id && (!l || Date.now() >= (l.next || 0))) this.offer(id).catch(e => this.failed(id, e));
    }
    for (const [id, l] of this.links) if (!Mesh.member(id)) this.close(id); // removed from the mesh
  },
  fresh(id) {
    this.close(id, true);
    const old = this.links.get(id) || {}, pc = new RTCPeerConnection({ iceServers: this.cfg().ice });
    const l = { pc, ch: null, state: 'connecting', since: Date.now(), tries: old.tries || 0, next: old.next || 0, waits: new Map() };
    this.links.set(id, l);
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && this.links.get(id)?.pc === pc) this.dropped(id, pc.connectionState); });
    setTimeout(() => { if (this.links.get(id) === l && l.state === 'connecting') this.failed(id, new Error('no connection in 25 s')); }, 25000);
    return l;
  },
  async offer(id) {
    const room = Mesh.pairRoom(id); if (!room) return;
    const l = this.fresh(id); this.wire(id, l, l.pc.createDataChannel('mesh', { ordered: true }));
    await l.pc.setLocalDescription(await l.pc.createOffer()); await Direct.gathered(l.pc);
    Log.d('mesh', `Direct link: offering to ${Mesh.member(id)?.name || id}`);
    Relay.post(room, 'mrtc', { kind: 'offer', sdp: await Direct.pack(l.pc.localDescription) });
  },
  /** The other side's offer or answer, through the pair room (js/relay.js). */
  async signal(room, b) {
    const id = room.peerId; if (!Mesh.member(id) || this.cfg().mode === 'off') return;
    try {
      const d = await Direct.unpack(b.sdp);
      if (b.kind === 'offer') {
        const l = this.fresh(id); l.pc.addEventListener('datachannel', e => this.wire(id, l, e.channel));
        await l.pc.setRemoteDescription(d); await l.pc.setLocalDescription(await l.pc.createAnswer()); await Direct.gathered(l.pc);
        Relay.post(room, 'mrtc', { kind: 'answer', sdp: await Direct.pack(l.pc.localDescription) });
      } else if (b.kind === 'answer') { const l = this.links.get(id); if (l?.pc && l.pc.signalingState === 'have-local-offer') await l.pc.setRemoteDescription(d); }
    } catch (e) { this.failed(id, e); }
  },
  wire(id, l, ch) {
    l.ch = ch;
    ch.onopen = () => {
      l.state = 'open'; l.tries = 0; l.since = Date.now();
      Log.i('mesh', `Direct link open with ${Mesh.member(id)?.name || id}`); Mesh.event('link', { what: 'direct up', with: id, name: Mesh.member(id)?.name || '' });
      clearInterval(l.ping); l.ping = setInterval(() => { if (ch.readyState === 'open') { l.pingAt = performance.now(); this.send(id, { ping: 1 }); } }, 10000);
      Mesh.onchange?.();
    };
    ch.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.got(id, l, m); };
    ch.onclose = () => { if (this.links.get(id) === l) this.dropped(id, 'closed'); };
  },
  send(id, m) { const l = this.open(id); if (!l) return false; try { l.ch.send(JSON.stringify(m)); return true; } catch { return false; } },
  async got(id, l, m) {
    if (m.ping) return this.send(id, { pong: 1 });
    if (m.pong) { if (l.pingAt) l.rtt = Math.round(performance.now() - l.pingAt); return; }
    if (m.mev) return Mesh.ingest(m.mev, id, 'direct');
    if (m.re) { const w = l.waits.get(m.re); if (w) { l.waits.delete(m.re); clearTimeout(w.t); m.error ? w.rej(new Error(m.error)) : w.res(m.result); } return; }
    if (m.ask) { // the same requests as over the pair room, with the same permission checks (Mesh.answer)
      let a; try { a = { re: m.id, result: await Mesh.answer(Mesh.pairRoom(id) || { peerId: id }, m.ask, m.payload || {}) }; } catch (e) { a = { re: m.id, error: e.message }; }
      this.send(id, a);
    }
  },
  /** A request straight across; rejects (so the caller can use the relays) if there's no open link. */
  call(id, kind, payload = {}, ms = 600000) {
    const l = this.open(id); if (!l) return Promise.reject(new Error('no direct link'));
    const rid = Math.random().toString(36).slice(2);
    return new Promise((res, rej) => { l.waits.set(rid, { res, rej, t: setTimeout(() => { l.waits.delete(rid); rej(new Error('no answer over the direct link')); }, ms) }); this.send(id, { ask: kind, id: rid, payload }); });
  },
  failed(id, e) {
    const l = this.links.get(id); if (!l) return;
    l.tries = (l.tries || 0) + 1; l.next = Date.now() + [60, 120, 300, 600][Math.min(3, l.tries - 1)] * 1000;
    Log.d('mesh', `Direct link with ${Mesh.member(id)?.name || id} failed (try ${l.tries}): next in ${Math.round((l.next - Date.now()) / 60000)} min`, { error: e?.message });
    this.close(id, true); l.state = 'failed'; Mesh.onchange?.();
  },
  dropped(id, why) {
    const l = this.links.get(id); if (!l) return;
    const was = l.state; this.close(id, true); l.state = 'failed'; l.next = Date.now() + 60000;
    if (was === 'open') { Log.i('mesh', `Direct link with ${Mesh.member(id)?.name || id} ended (${why}): the relays carry on`); Mesh.event('link', { what: 'direct down', with: id }); }
    Mesh.onchange?.();
  },
  close(id, keep) {
    const l = this.links.get(id); if (!l) return;
    clearInterval(l.ping); for (const w of l.waits.values()) { clearTimeout(w.t); w.rej(new Error('direct link closed')); } l.waits.clear();
    try { l.ch?.close(); } catch {} try { l.pc?.close(); } catch {}
    l.ch = null; l.pc = null; if (!keep) this.links.delete(id);
  },
  /** For presence: the open links, as Mesh.pres lists them. */
  list() { return [...this.links].filter(([, l]) => l.state === 'open').map(([id, l]) => ({ to: id, name: Mesh.member(id)?.name || '', kind: 'direct', rtt: l.rtt ?? null })); },
};
setInterval(() => MeshDirect.tick(), 15000);
