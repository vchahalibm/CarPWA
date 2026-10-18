'use strict';
/* ============================================================
   Test the connection (Settings › Connections, both apps), and the hooks the
   network lab and the nightly runs use (docs/connection-tests.html):
   - This network: local addresses, the public address and port from each STUN
     server on its own, and the router type from them (the same public port
     from two servers: port-preserving, direct links likely; different ports:
     strict, direct links may fail; none: UDP blocked or STUN unreachable).
   - Every relay in the list: connects, echoes (trackers: answers), timed.
   - The paired app: online, the link in use, the direct link's candidate
     types (host / srflx / relay) and round trip, a small request and a
     200-row one timed (DriveGen asks; StudioGen reports its devices).
   - A verdict in plain words; the report as JSON to copy or share.
   window.LinkTest.run() gives the same report to the lab's runner.
   Loaded after relay.js.
   ============================================================ */
const LinkTest = {
  /** One STUN server: the public address and port it sees (srflx), within 4 s. */
  stun(url) {
    return new Promise(res => {
      const t0 = Date.now(), pc = new RTCPeerConnection({ iceServers: [{ urls: url }] }), out = { server: url, host: [] }; let done = false;
      const fin = () => { if (done) return; done = true; try { pc.close(); } catch {} res({ ...out, ms: out.addr ? out.ms : null }); };
      pc.onicecandidate = e => {
        if (!e.candidate) return fin();
        const c = e.candidate.candidate.split(' '), ip = c[4], port = +c[5], typ = c[c.indexOf('typ') + 1];
        if (typ === 'srflx' && !out.addr) { out.addr = ip; out.port = port; out.ms = Date.now() - t0; }
        if (typ === 'host') out.host.push(ip);
      };
      pc.createDataChannel('t'); pc.createOffer().then(o => pc.setLocalDescription(o)).catch(fin);
      setTimeout(fin, 4000);
    });
  },
  async network() {
    const servers = Relay.directCfg().stun.slice(0, 3), r = await Promise.all(servers.map(s => this.stun(s))), got = r.filter(x => x.addr);
    // Compare ports only for the same public address (one server may answer over IPv6, another over IPv4).
    const host = [...new Set(r.flatMap(x => x.host))], by = {}; for (const x of got) (by[x.addr] ||= []).push(x.port);
    const same = Object.values(by).filter(p => p.length > 1);
    const nat = !got.length ? 'none' : !same.length ? 'unknown' : same.some(p => new Set(p).size > 1) ? 'strict' : 'preserving';
    return { stun: r.map(({ host, ...x }) => x), host, ipv6: host.some(h => h.includes(':')), mdns: host.some(h => h.endsWith('.local')), nat, publicAddr: got[0]?.addr || null };
  },
  /** One relay: connect, publish to ourselves, wait for it back (trackers: the announce answer). */
  relay(url) {
    return new Promise(res => {
      const K = relayKind(url), t0 = Date.now(), topic = 'sgtest/' + Math.random().toString(36).slice(2); let done = false, mq;
      const fin = r => { if (done) return; done = true; try { mq.close(); } catch {} res({ url, kind: K === NostrT ? 'nostr' : K === TrackerT ? 'tracker' : 'mqtt', ...r }); };
      mq = new K(url, () => fin({ ok: true, ms: Date.now() - t0 }), s => { if (s === 'up') { if (!K.echo) return fin({ ok: true, ms: Date.now() - t0, note: 'answers (introductions only)' }); mq.subscribe(topic); setTimeout(() => mq.publish(topic, Uint8Array.from([1])), 600); } else fin({ ok: false, err: s }); });
      setTimeout(() => fin({ ok: false, err: 'no answer in 8 s' }), 8000);
    });
  },
  /** The direct link now: which candidate types won, and its round trip. */
  async directStats() {
    if (!Direct.pc) return { connected: false };
    try {
      const st = await Direct.pc.getStats(); let pair = null; const by = {};
      st.forEach(x => { by[x.id] = x; if (x.type === 'transport' && x.selectedCandidatePairId) pair = x.selectedCandidatePairId; });
      if (!pair) st.forEach(x => { if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded') pair = x.id; });
      const p = by[pair], l = p && by[p.localCandidateId], r = p && by[p.remoteCandidateId];
      return { connected: Direct.connected, local: l?.candidateType || null, remote: r?.candidateType || null, protocol: l?.protocol || null, rtt: p?.currentRoundTripTime != null ? Math.round(p.currentRoundTripTime * 1000) : null };
    } catch { return { connected: Direct.connected }; }
  },
  /** DriveGen: time requests to the Mac over whatever link is up. */
  async peer() {
    if (LINK_HOST) return { role: 'studiogen', devices: Relay.peers().map(p => ({ name: p.name, online: !!Relay.online[p.room], direct: Direct.connected && Direct.peer === p.name, oldList: Relay.outdated(p) })) };
    const rm = Relay.mac(), out = { role: 'drivegen', paired: !!rm, tailscale: !!Link.mac()?.token, online: !!Relay.online.mac, via: Link.via() || 'none' };
    if (!Link.ready()) return out;
    const call = (kind, p) => Link.direct() ? Direct.call(kind, p, 30000) : Link.relay() ? Relay.call(kind, p, 30000) : Promise.reject(new Error('Over Tailscale: not measured'));
    try { let t = Date.now(); await call('echo', { n: 0 }); out.pingMs = Date.now() - t; t = Date.now(); const r = await call('echo', { n: 200 }); out.rows200Ms = Date.now() - t; out.rows200Ok = r?.rows?.length === 200; }
    catch (e) { out.error = e.message; }
    return out;
  },
  /** Plain words from the measurements. */
  verdict(r) {
    const v = [], n = r.network, okR = r.relays.filter(x => x.ok), data = okR.filter(x => x.kind !== 'tracker');
    v.push(n.nat === 'preserving' ? 'This network keeps the same public port for everyone: direct links should work across networks.'
      : n.nat === 'strict' ? 'This network gives a different public port to each server it talks to (a strict router): direct links across networks may fail, so the relays (or a TURN server) will carry the data.'
      : n.nat === 'none' ? 'No STUN server answered: UDP looks blocked here. Direct links can only work on the same network; the relays carry the data.'
      : 'Only one STUN server answered: the router type is unknown.');
    v.push(!okR.length ? 'No relay can be reached from here: only a direct link on the same network, or Tailscale, can connect.'
      : `${okR.length} of ${r.relays.length} relays work here (${data.length} carry data${okR.length > data.length ? `, ${okR.length - data.length} introduce only` : ''}).`);
    const p = r.peer;
    if (p.role === 'drivegen') v.push(!p.paired && !p.tailscale ? 'Not paired with a Mac yet: Settings › Connections › Pair once.'
      : !p.online && p.via === 'none' ? 'Your Mac isn’t reachable right now: is StudioGen open, with the internet?'
      : p.error ? `Your Mac is reachable ${p.via}, but a request failed: ${p.error}`
      : `Your Mac answers ${p.via}: ${p.pingMs} ms for a small request, ${p.rows200Ms} ms for 200 rows${p.rows200Ok ? '' : ' (incomplete!)'}.`);
    else v.push(p.devices.length ? `${p.devices.filter(d => d.online).length} of ${p.devices.length} paired devices are online${p.devices.some(d => d.direct) ? ', one directly' : ''}.` : 'No devices paired yet.');
    if (r.direct.connected) v.push(`A direct link is up (${r.direct.local || '?'} ↔ ${r.direct.remote || '?'}${r.direct.rtt != null ? `, ${r.direct.rtt} ms` : ''}${r.direct.local === 'relay' || r.direct.remote === 'relay' ? ', through your TURN server' : ''}).`);
    return v;
  },
  async run(onStep = () => {}) {
    const r = { app: APP_NAME, version: typeof webVer !== 'undefined' ? webVer : null, when: new Date().toISOString(), ua: navigator.userAgent, settings: { direct: Relay.directCfg().mode, relayData: Relay.dataOk(), turn: !!Relay.directCfg().turn?.url } };
    onStep('This network…'); r.network = await this.network();
    onStep('The relays…'); const list = LINK_HOST ? Relay.list().brokers.map(b => b.url) : (Relay.mac() ? Relay.brokersOf(Relay.mac()) : RELAY_DEFAULTS.map(b => b.url)); r.relays = await Promise.all(list.map(u => this.relay(u)));
    onStep('The other app…'); r.peer = await this.peer(); r.direct = await this.directStats();
    r.verdict = this.verdict(r); Log.i('linktest', 'Connection test', r); this.last = r; return r;
  },
  async show() {
    closeSheet(); sheet('Test the connection', '<p id="ltStep" class="se-note">Starting…</p>', [['Close']]);
    const r = await this.run(s => { const el = $('#ltStep'); if (el) el.textContent = s; });
    const relay = x => `<li class="${x.ok ? '' : 'warn'}">${x.ok ? '✓' : '✗'} ${esc(Relay.label(x.url))} <span class="se-note">${x.kind}${x.ok ? `, ${x.ms} ms${x.note ? `, ${x.note}` : ''}` : `, ${esc(x.err)}`}</span></li>`;
    sheet('Connection test', `<div class="lt"><ul class="av-report">${r.verdict.map(v => `<li>${esc(v)}</li>`).join('')}</ul>
      <p class="se-note"><b>This network</b>: router ${({ preserving: 'keeps ports (good for direct links)', strict: 'strict (a new port per server)', none: 'no UDP / no STUN answer', unknown: 'unknown' })[r.network.nat]}${r.network.publicAddr ? ` · public ${esc(r.network.publicAddr)}` : ''}${r.network.ipv6 ? ' · IPv6' : ''} · ${r.network.stun.map(s => `${esc(s.server.replace(/^stun:/, ''))}: ${s.addr ? `${s.port}, ${s.ms} ms` : '✗'}`).join(' · ')}</p>
      <p class="se-note"><b>Relays</b></p><ul class="av-report">${r.relays.map(relay).join('')}</ul>
      <p class="se-note"><b>Settings</b>: direct link ${esc(r.settings.direct)} · data over relays ${r.settings.relayData ? 'on' : 'off'} · TURN ${r.settings.turn ? 'set' : 'none'}</p></div>`,
      [['Copy the report', () => { navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => toast('Report copied'), () => toast('Couldn’t copy')); }], ['Run again', () => this.show()], ['Close']]);
  },
};
ACTIONS.linkTest = () => LinkTest.show();
