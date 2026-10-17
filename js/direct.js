'use strict';
/* ============================================================
   A direct link between DriveGen and StudioGen: WebRTC, no account, no server.
   - Handshake by QR codes: StudioGen shows its code (a WebRTC offer), the
     phone scans it with its camera, shows its own code (the answer), and
     the Mac's camera scans that. Codes are the session description,
     deflated and base64url'd ("SG1…"), so they are only good for that one
     connection; scanning the Mac's screen is what lets a phone in.
   - Then an encrypted data channel (DTLS) on the same Wi-Fi, or with the Mac
     on the phone's hotspot (in the car). No STUN or TURN: nothing leaves the
     local network. When the network changes it drops; connect again
     (Tailscale, js/link.js, is the way from anywhere).
   - The same requests as over Tailscale: offers, run, say (LinkHost in
     StudioGen answers them; Link in DriveGen sends them through Direct when
     it is connected).
   Loaded after link.js.
   ============================================================ */
const Direct = {
  pc: null, ch: null, peer: '', waits: new Map(), last: 0,
  get connected() { return this.ch?.readyState === 'open'; },
  /* ---------- Codes ---------- */
  async pack(desc) {
    // Only what's needed: UDP candidates, no end-of-candidates; deflated.
    const sdp = desc.sdp.split('\r\n').filter(l => l && !/^a=candidate:.* tcp /i.test(l) && !/^a=end-of-candidates/.test(l)).join('\r\n') + '\r\n';
    const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify({ t: desc.type, s: sdp })]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let b = ''; for (const x of bytes) b += String.fromCharCode(x);
    return 'SG1' + btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  async unpack(code) {
    if (!/^SG1[\w-]+$/.test(code)) throw new Error('That isn’t a StudioGen code');
    const b = atob(code.slice(3).replace(/-/g, '+').replace(/_/g, '/')), bytes = Uint8Array.from(b, c => c.charCodeAt(0));
    const j = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
    return { type: j.t, sdp: j.s };
  },
  gathered(pc) { return new Promise(r => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, 4000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }); }); },
  // STUN only when set up through the relay (js/relay.js); the QR way stays on the local network.
  fresh(ice = []) { this.close(true); const pc = this.pc = new RTCPeerConnection({ iceServers: ice }); pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState) && this.pc === pc) this.lost(); }); return pc; },
  /* ---------- StudioGen: offer, then the phone's answer ---------- */
  async offer(ice) { const pc = this.fresh(ice); this.wire(pc.createDataChannel('studiogen', { ordered: true })); await pc.setLocalDescription(await pc.createOffer()); await this.gathered(pc); return this.pack(pc.localDescription); },
  async accept(code) { const d = await this.unpack(code); if (d.type !== 'answer') throw new Error('Scan the code DriveGen shows after it scanned yours'); await this.pc.setRemoteDescription(d); },
  /* ---------- DriveGen: the Mac's offer → an answer to show ---------- */
  async answer(code, ice) {
    const d = await this.unpack(code); if (d.type !== 'offer') throw new Error('Scan the code StudioGen shows (Settings › Connections › Connect a phone)');
    const pc = this.fresh(ice); pc.addEventListener('datachannel', e => this.wire(e.channel));
    await pc.setRemoteDescription(d); await pc.setLocalDescription(await pc.createAnswer()); await this.gathered(pc); return this.pack(pc.localDescription);
  },
  /* ---------- The channel ---------- */
  wire(ch) {
    this.ch = ch;
    ch.onopen = () => { this.last = Date.now(); this.send({ hello: { app: APP_NAME, name: this.myName() } }); clearInterval(this.ping); this.ping = setInterval(() => { if (!this.connected) return; this.send({ ping: 1 }); if (Date.now() - this.last > 20000) this.lost(); }, 5000); };
    ch.onmessage = e => { this.last = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } this.got(m); };
    ch.onclose = () => { if (this.ch === ch) this.lost(); };
  },
  send(m) { try { this.ch?.send(JSON.stringify(m)); } catch {} },
  async got(m) {
    if (m.hello) { this.peer = m.hello.name || m.hello.app; Log.i('direct', `Connected: ${this.peer}`); if (!(typeof Relay !== 'undefined' && Relay.rooms().length)) toast(`Connected directly to ${this.peer}`); this.onchange?.(); Bus.emit('link.direct', { value: this.peer }); return; }
    if (m.ping) return;
    if (m.re) { const w = this.waits.get(m.re); if (w) { this.waits.delete(m.re); clearTimeout(w.t); m.error ? w.rej(new Error(m.error)) : w.res(m.result); } return; }
    if (m.ask) { // a request from the other side (StudioGen answers DriveGen's)
      try { const r = await Direct.handle(m.ask, m.payload || {}); this.send({ re: m.id, result: r }); }
      catch (e) { this.send({ re: m.id, error: e.message }); }
    }
  },
  /** StudioGen's answers, the same as over Tailscale (LinkHost, js/link.js). */
  async handle(kind, p) {
    if (typeof LinkHost === 'undefined' || !window.DriveDeckDesktop) throw new Error('Only StudioGen answers that');
    const from = this.peer || 'A phone';
    if (kind === 'offers') return { name: APP_NAME, scripts: LinkHost.scripts().map(s => ({ id: s.id, name: s.name, about: s.json.about || '' })) };
    if (kind === 'run') return LinkHost.run({ ...p, from });
    if (kind === 'say') return LinkHost.say({ ...p, from });
    throw new Error(`Unknown request ${kind}`);
  },
  call(kind, payload = {}, ms = 600000) {
    if (!this.connected) return Promise.reject(new Error('Not connected to your Mac'));
    const id = Math.random().toString(36).slice(2);
    return new Promise((res, rej) => { const t = setTimeout(() => { this.waits.delete(id); rej(new Error('Your Mac didn’t answer')); }, ms); this.waits.set(id, { res, rej, t }); this.send({ ask: kind, id, payload }); });
  },
  lost() {
    if (!this.pc && !this.ch) return;
    const was = this.peer; this.close(true);
    if (was) { const relay = typeof Relay !== 'undefined' && Relay.rooms().length; if (!relay) toast(`Direct link to ${was} ended: connect again in Settings`); Log.i('direct', `Link ended${relay ? ': the relay carries on' : ''}`); }
    this.onchange?.();
  },
  close(quiet) {
    clearInterval(this.ping); for (const w of this.waits.values()) { clearTimeout(w.t); w.rej(new Error('The link ended')); } this.waits.clear();
    try { this.ch?.close(); } catch {} try { this.pc?.close(); } catch {}
    this.ch = this.pc = null; if (!quiet) this.peer = ''; else this.peer = '';
  },
  myName() { return window.DriveDeckDesktop ? 'StudioGen' : `${APP_NAME} on ${/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent) ? 'iPad' : isIOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'a computer'}`; },

  /* ---------- Full-screen steps: a big code to show, the camera to scan one ---------- */
  screen(title, html, onCancel) {
    let f = $('#dlFull'); if (!f) { f = document.createElement('div'); f.id = 'dlFull'; f.className = 'dl-full'; document.body.appendChild(f); }
    f.innerHTML = `<div class="dl-top"><b>${esc(title)}</b><button class="chip" data-dl="cancel">Close</button></div><div class="dl-main">${html}</div>`;
    this.cancel = () => { this.stopScan(); f.remove(); onCancel?.(); };
    return f;
  },
  done() { this.stopScan(); $('#dlFull')?.remove(); },
  async showCode(el, code) { await LinkHost.qr(el, code, 'L'); },
  /** Scan a StudioGen code with the camera (jsQR, vendor/jsqr): resolves with the text. */
  async scan(el, prefix = 'SG1') {
    if (!window.jsQR) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jsqr/jsQR.js'; s.onload = res; s.onerror = () => rej(new Error('The code reader didn’t load')); document.head.appendChild(s); });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; el.replaceChildren(v);
    v.srcObject = await Camera.get('qr'); await v.play().catch(() => {});
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    return new Promise((res, rej) => {
      this.scanning = { rej };
      const look = () => {
        if (!this.scanning) return;
        if (v.videoWidth) {
          const k = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight)); cv.width = v.videoWidth * k; cv.height = v.videoHeight * k;
          cx.drawImage(v, 0, 0, cv.width, cv.height); const q = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
          if (q?.data?.startsWith(prefix)) { this.stopScan(); return res(q.data); }
        }
        this.scanTimer = setTimeout(look, 180);
      };
      look();
    });
  },
  stopScan() { if (this.scanning) { clearTimeout(this.scanTimer); this.scanning = null; Camera.release('qr'); } },
  /** StudioGen: show the offer, then scan the phone's answer with the Mac's camera. */
  async hostFlow() {
    const f = this.screen('Connect a phone or iPad directly', '<div class="dl-step"><p>Making the code…</p></div>', () => this.close());
    const code = await this.offer().catch(e => { toast(e.message); return null; }); if (!code || !$('#dlFull')) return;
    f.querySelector('.dl-main').innerHTML = `<div class="dl-step"><div class="dl-qr" id="dlQr"></div><div><p class="dl-n">1</p><p>On the phone or iPad (same Wi-Fi, or this Mac on the phone’s hotspot): <b>DriveGen › Settings › Your Mac › Connect directly</b>, and point its camera at this code.</p>
      <p class="dl-n">2</p><p>The phone then shows its own code: hold it up to this Mac’s camera.</p><button class="chip accent" data-dl="scanback">The phone shows its code: scan it</button></div></div>`;
    this.showCode($('#dlQr'), code);
  },
  async hostScan() {
    const m = $('#dlFull .dl-main'); if (!m) return;
    m.innerHTML = `<div class="dl-step"><div class="dl-cam" id="dlCam"></div><div><p>Hold the phone’s code up to this Mac’s camera.</p><p class="se-note" id="dlState">Looking for the code…</p></div></div>`;
    try { const code = await this.scan($('#dlCam')); $('#dlState').textContent = 'Got it: connecting…'; await this.accept(code); await this.opened(); this.done(); }
    catch (e) { if ($('#dlState')) $('#dlState').textContent = e.message; }
  },
  /** DriveGen: scan the Mac's code, show the answer until the link opens. */
  async guestFlow() {
    closeSheet(); const f = this.screen('Connect to your Mac directly', `<div class="dl-step"><div class="dl-cam" id="dlCam"></div><div><p>On the Mac: <b>StudioGen › Settings › Connections › Connect a phone</b>. Point this camera at the code it shows.</p><p class="se-note" id="dlState">Looking for the code…</p></div></div>`, () => this.close());
    try {
      const offer = await this.scan($('#dlCam')); $('#dlState').textContent = 'Got it…';
      const code = await this.answer(offer); if (!$('#dlFull')) return;
      f.querySelector('.dl-main').innerHTML = `<div class="dl-step"><div class="dl-qr" id="dlQr"></div><div><p>Now hold this code up to the <b>Mac’s camera</b> (StudioGen is scanning for it).</p><p class="se-note" id="dlState">Waiting for the Mac…</p></div></div>`;
      this.showCode($('#dlQr'), code); await this.opened(120000); this.done();
    } catch (e) { if ($('#dlState')) $('#dlState').textContent = e.message; }
  },
  opened(ms = 20000) { return new Promise((res, rej) => { const t0 = Date.now(), k = setInterval(() => { if (this.connected && this.peer) { clearInterval(k); res(); } else if (Date.now() - t0 > ms || !this.pc) { clearInterval(k); rej(new Error('It didn’t connect: are both on the same Wi-Fi (or the Mac on the phone’s hotspot)? Try again.')); } }, 200); }); },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-dl]'); if (!b) return; e.stopPropagation();
  const a = b.dataset.dl;
  if (a === 'cancel') return Direct.cancel?.();
  if (a === 'scanback') return Direct.hostScan();
  if (a === 'host') { closeSheet(); return Direct.hostFlow(); }
  if (a === 'guest') return Direct.guestFlow();
  if (a === 'end') { Direct.close(); toast('Disconnected'); closeSheet(); }
}, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && $('#dlFull')) Direct.cancel?.(); });
