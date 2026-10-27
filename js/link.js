'use strict';
/* ============================================================
   DriveGen ↔ StudioGen over Tailscale.
   - StudioGen (desktop/link.js) serves a small API on the Mac and shares
     it on the user's tailnet (`tailscale serve`): https://<mac>.<tailnet>.ts.net,
     reachable only from their own devices, from anywhere.
   - Here, in StudioGen (LinkHost): answers what paired devices ask: the
     scripts you made available to them (Settings › Connections), running
     one (its spoken lines, {result} and any data rows go back), or what
     was said, for the interactive script that is running. Connections
     screen: Tailscale, sharing, pairing (a 6-digit code), devices, scripts.
   - In DriveGen (Link): pairing with the Mac's address and the code; the
     actions mac.run (a script by name, values as “name=value” inputs) and
     mac.say (words for the Mac's interactive script, or its voice
     commands); the voice command “run … on my Mac”.
   Loaded after dataviz.js.
   ============================================================ */
const Link = {
  mac: () => store.get('linkMac', null),
  ready() { return (typeof Direct !== 'undefined' && Direct.connected) || this.relay() || !!this.mac()?.token; },
  /** The relay (js/relay.js) when the Mac is online on it and there's no direct link. */
  relay: () => typeof Relay !== 'undefined' && Relay.ready(),
  via() { return this.direct() ? 'directly' : this.relay() ? 'through the relay' : this.mac()?.token ? 'over Tailscale' : ''; },
  /** Direct (js/direct.js) when it's connected, else over Tailscale. */
  direct: () => typeof Direct !== 'undefined' && Direct.connected,
  macName() { return this.direct() ? Direct.peer : this.relay() ? Relay.mac()?.name || 'your Mac' : this.mac()?.name || 'your Mac'; },
  viaDirect(p) { return p.then(r => ({ state: 'done', ...r }), e => ({ state: 'failed', error: e.message })); },
  async offers() { return this.direct() ? Direct.call('offers', {}, 15000) : this.relay() ? Relay.call('offers', {}, 20000) : this.call('/api/offers'); },
  async call(p, body, ms = 30000, m = this.mac()) {
    if (!m?.url) throw new Error('Pair with your Mac first (Settings › Connections)');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(`${m.url.replace(/\/$/, '')}${p}`, { method: body ? 'POST' : 'GET', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(m.token ? { authorization: `Bearer ${m.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${r.status}`); return j;
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'Your Mac didn’t answer' : e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'Can’t reach your Mac: is it awake, with StudioGen open and Tailscale on (here too)?' : e.message); }
    finally { clearTimeout(t); }
  },
  /** Pair: the Mac's address and the 6-digit code it shows. */
  async pair(url, code) {
    url = url.trim().replace(/\/$/, ''); if (!/^https?:\/\//.test(url)) url = `https://${url}`;
    const at = { url }; // saved only once it worked: a wrong code keeps the pairing there is
    const hello = await this.call('/api/hello', null, 15000, at), r = await this.call('/api/pair', { code, device: `${APP_NAME} on ${isIOS ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent) ? 'iPad' : 'iPhone') : /Android/.test(navigator.userAgent) ? 'Android' : 'a computer'}` }, 15000, at);
    store.set('linkMac', { url, token: r.token, name: r.name || hello.name });
    Log.i('link', 'Paired', { name: r.name }); return r.name;
  },
  /** Wait for a job on the Mac (long polls of 25 s), up to 10 minutes. */
  async job(id) { const t0 = Date.now(); for (;;) { const j = await this.call(`/api/jobs/${id}?wait=25`, null, 40000); if (j.state !== 'running' || Date.now() - t0 > 600000) return j; } },
  async run(script, vars = {}) { if (this.direct()) return this.viaDirect(Direct.call('run', { script, vars })); if (this.relay()) return this.viaDirect(Relay.call('run', { script, vars })); const { job } = await this.call('/api/run', { script, vars }); return this.job(job); },
  /** Apple's on-device model on the Mac (js/brain.js › MacAI), for this phone. */
  async ai(o) { if (this.direct()) return Direct.call('ai', o, 30000); if (this.relay()) return Relay.call('ai', o, 30000); return this.call('/api/ai', o, 30000); },
  /** A task of the Mac's agent library (js/agent.js), and the list of the ones made there. Direct link or relay. */
  async task(o) { if (this.direct()) return Direct.call('task', o, 300000); if (this.relay()) return Relay.call('task', o, 300000); throw new Error('Tasks need a direct or relay link to your Mac (pair once in Settings › Connections)'); },
  async tasks() { if (this.direct()) return Direct.call('tasks', {}, 15000); if (this.relay()) return Relay.call('tasks', {}, 20000); return { tasks: [] }; },
  async say(text) { if (this.direct()) return this.viaDirect(Direct.call('say', { text })); if (this.relay()) return this.viaDirect(Relay.call('say', { text })); const { job } = await this.call('/api/say', { text }); return this.job(job); },
  /** What came back, as something to say. */
  spoken(j) { if (j.state === 'failed') return `It didn’t work on your Mac: ${j.error || 'no reason given'}.`; const r = j.result; return (j.said || []).join(' ') || (r != null && typeof r !== 'object' ? String(r) : '') || 'Done on your Mac.'; },
  /** The voice command “run … on my Mac”: a script it offers by name, else the words go to the Mac as said. */
  async command(q, say) {
    if (!this.ready()) return say(typeof Relay !== 'undefined' && Relay.online.mac && !Relay.dataOk() ? 'Your Mac only takes requests over a direct link, and there isn’t one on this network right now.' : typeof Relay !== 'undefined' && Relay.mac() ? 'I can’t reach your Mac right now. Is StudioGen open, with the internet?' : 'Pair with your Mac first: Settings, Connections.');
    if (typeof Working !== 'undefined') { Voice.show?.(q, 'Asking your Mac…'); Working.begin(); } else say('Asking your Mac…');
    try {
      const offers = (await this.offers()).scripts || [], p = plain(q), s = offers.find(o => plain(o.name) === p) || offers.find(o => plain(o.name).includes(p) || p.includes(plain(o.name)));
      const j = s ? await this.run(s.id) : await this.say(q);
      if (j.rows?.length && typeof DataViz !== 'undefined') DataViz.set(DataViz.target(), DataViz.from(j.rows), { kind: 'script', label: `from ${this.macName()}` });
      if (typeof Working !== 'undefined') await Working.end(j.state !== 'failed');
      Voice.respond(this.spoken(j));
    } catch (e) { if (typeof Working !== 'undefined') await Working.end(false); Voice.respond(e.message); }
  },

  /* ---------- Settings › Connections ---------- */
  async settings() {
    if (window.DriveDeckDesktop?.link) return LinkHost.settings();
    const m = this.mac(); let offers = null, err = '';
    if (this.ready()) { try { offers = (await (this.direct() || this.relay() ? this.offers() : this.call('/api/offers', null, 8000))).scripts || []; } catch (e) { err = e.message; } }
    const rm = typeof Relay !== 'undefined' ? Relay.mac() : null;
    const relay = rm ? `<div class="lk-direct ${Relay.online.mac ? 'on' : ''}"><p>${Relay.online.mac ? `✓ <b>${esc(rm.name || 'Your Mac')}</b> is reachable, ${esc(this.via())}` : `Paired with <b>${esc(rm.name || 'your Mac')}</b>: not reachable now (is StudioGen open, with the internet?)`}</p>
      ${Relay.outdated(rm) ? '<p class="se-empty warn">Your Mac has a new list of relays: pair again (StudioGen › Settings › Connections › Pair a phone or iPad) to use it.</p>' : ''}
      <p class="se-note">The secret that locks your messages: from ${esc(new Date(rm.keyAt || rm.paired).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} (your Mac changes it; ask there, in Settings › Connections). Your own secret phrase on top: <b>${rm.passKey ? 'on' : 'none'}</b> <button class="link-btn" data-rl="devphrase">${rm.nextCheck ? 'Type the new phrase' : 'Secret phrase…'}</button></p>
      ${rm.needPass || rm.nextCheck ? `<p class="se-empty warn">${rm.needPass ? 'Type the secret phrase you set on your Mac to finish pairing.' : 'Your Mac has a new secret phrase: type it to keep in touch.'}</p>` : !Relay.online.mac && Relay.unreadable && Date.now() - Relay.unreadable < 120000 ? '<p class="se-empty warn">Messages from your Mac can’t be opened here: the secret phrase may not match (or the pairing is old). Check the phrase, or pair again.</p>' : ''}
      <p class="se-note">Relays from your Mac’s list (revision ${rm.rev || 1}), in the order both use them:</p><ul class="av-report">${Relay.status(rm)}</ul>
      <div class="chip-row"><button class="chip" data-rl="allow">${store.get('directAllow', true) ? '✓ Direct link when your Mac offers one' : 'Relays only (no direct link)'}</button><button class="chip" data-rl="guestpair">Pair again</button><button class="chip" data-rl="forget">Forget this Mac</button></div></div>`
      : `<div class="lk-direct"><p><b>Pair once</b> and reach your Mac from anywhere (also on mobile data), with no account: scan StudioGen’s code one time. Messages go through public relays, end-to-end encrypted.</p><button class="chip accent" data-rl="guestpair">Pair once</button></div>`;
    const direct = typeof Direct === 'undefined' ? '' : Direct.connected ? `<div class="lk-direct on"><p>✓ Connected directly to <b>${esc(Direct.peer)}</b> (same network)</p><button class="chip" data-dl="end">Disconnect</button></div>`
      : `<div class="lk-direct"><p><b>Directly</b>, no account: on the same Wi-Fi, or with the Mac on this phone’s hotspot. Scan StudioGen’s code, then show yours to the Mac.</p><button class="chip accent" data-dl="guest">Connect directly</button></div>`;
    const meshCard = typeof MeshView !== 'undefined' ? `<div class="lk-direct">${MeshView.card()}</div>` : '';
    sheet('Your Mac (StudioGen)', meshCard + (typeof Bee !== 'undefined' ? Bee.html() : '') + relay + (rm ? '' : direct) + (m?.token || this.direct() || rm ? `${m?.token ? `<p class="se-note">Over Tailscale: paired with <b>${esc(m.name || m.url)}</b> (${esc(m.url)}).</p>` : ''}${err ? `<p class="se-empty warn">${esc(err)}</p>` : ''}
      ${offers ? (offers.length ? `<p class="se-note">Scripts your Mac offers (say “run … on my Mac”):</p><div class="pick-list">${offers.map(o => `<button class="big-btn" data-macrun="${esc(o.id)}">${esc(o.name)}</button>`).join('')}</div>` : '<p class="se-note">Your Mac offers no scripts yet: in StudioGen, Settings › Connections, tick the ones paired devices may run.</p>') : ''}`
      : `<p class="se-note"><b>Or</b> connect directly each time (same Wi-Fi, no internet needed): the button above. <b>Or over Tailscale</b> (needs a Tailscale account on both): on the Mac, StudioGen › Settings › Connections › Pair a device.</p>
      <label class="se-field"><span>Your Mac’s address (shown in StudioGen)</span><input id="lkUrl" class="se-wz-in" value="${esc(m?.url || '')}" placeholder="https://my-mac.tail1234.ts.net" autocapitalize="off" autocorrect="off"></label>
      <label class="se-field"><span>The 6-digit code StudioGen shows</span><input id="lkCode" class="se-wz-in" inputmode="numeric" maxlength="7" placeholder="123456"></label>`),
      m?.token ? [['Forget the Tailscale pairing', () => { store.set('linkMac', null); toast('Forgotten'); }], ['Close']]
        : this.direct() || rm ? [['Close']]
        : [['Pair', async () => { const u = $('#lkUrl').value, c = $('#lkCode').value; if (!u || !c) return toast('The address and the code, please'); try { toast(`Paired with ${await this.pair(u, c)}`); } catch (e) { sheet('Didn’t pair', `<p>${esc(e.message)}</p>`, [['Try again', () => this.settings()], ['Close']]); } }], ['Cancel']]);
  },
};

/* ---------- StudioGen: answering paired devices ---------- */
const LinkHost = {
  offered: () => store.get('linkOffers', []),
  scripts() { return Scripts.all().filter(s => s.json?.mode !== 'interactive' && this.offered().includes(s.id)); },
  /** A script run for a paired device: what it says (it still shows and speaks here), {result} and the data rows. */
  async run({ script, vars = {}, from, own = true }) {
    const s = this.scripts().find(x => x.id === script || plain(x.name) === plain(script)); if (!s) throw new Error('That script isn’t offered to paired devices');
    if (!own && typeof Agent !== 'undefined' && Agent.privateSteps(s.json)) throw new Error('That script uses this Mac’s sign-ins or files: only its owner’s devices may run it');
    if (Script.running) throw new Error(`StudioGen is busy with “${Script.cur?.name}”`);
    toast(`${from} runs “${s.name}”`); Log.i('link', `Remote run: ${s.name}`, { from });
    const rows0 = typeof DataViz !== 'undefined' ? JSON.stringify(Object.values(DataViz.sets).map(d => d.at)) : '';
    const said = []; Script.remote = said;
    const done = new Promise(r => { const off = Bus.on('script.end', () => { off?.(); r(); }); setTimeout(r, 590000); });
    await Script.start({ ...s.json, vars: { ...(s.json.vars || {}), ...vars }, listen: false });
    if (Script.running) await done;
    Script.remote = null;
    const changed = typeof DataViz !== 'undefined' && JSON.stringify(Object.values(DataViz.sets).map(d => d.at)) !== rows0, d = changed ? Object.values(DataViz.sets).sort((a, b) => (b.at > a.at ? 1 : -1))[0] : null;
    const result = Script.vars.result; return { said, result: result === undefined ? null : result, rows: d ? d.rows.slice(0, 200) : null };
  },
  /** Words from a paired device: to the interactive script that's running here, else to the voice commands. */
  async say({ text, from }) {
    const said = [], orig = Voice.respond; Script.remote = said;
    Voice.respond = (m, ...a) => { if (m && !said.includes(m)) said.push(m); return orig.call(Voice, m, ...a); };
    try {
      Log.i('link', `Remote words from ${from}: ${text}`); Commands.run(text, true);
      for (let i = 0; i < 240 && (Script.busy || Script.ask == null && i < 12); i++) await new Promise(r => setTimeout(r, 250)); // until the script is done (or 3 s for a command)
      return { said, result: Script.running ? Script.vars.result ?? null : null };
    } finally { Voice.respond = orig; Script.remote = null; }
  },
  async settings() {
    const L = DriveDeckDesktop.link, s = await L.status(), off = this.offered(), list = Scripts.all().filter(x => x.json?.mode !== 'interactive');
    const ts = !s.tailscale ? `<p class="se-empty warn">Tailscale isn’t on this Mac. Install it (free for personal use) from tailscale.com/download, sign in, and install it on your iPhone or iPad with the same account. Then come back here.</p>`
      : !s.signedIn ? '<p class="se-empty warn">Tailscale is installed but not signed in: open it from the menu bar and sign in.</p>'
      : `<p>This Mac on your tailnet: <b>${esc(s.url || '')}</b> · ${s.sharing ? '✓ shared with your devices' : 'not shared yet'}</p>`;
    const direct = typeof Direct === 'undefined' ? '' : Direct.connected ? `<div class="lk-direct on"><p>✓ Connected directly to <b>${esc(Direct.peer)}</b></p><button class="chip" data-dl="end">Disconnect</button></div>`
      : `<div class="lk-direct"><p><b>Directly</b>, no account: a phone or iPad on the same Wi-Fi (or this Mac on the phone’s hotspot) scans a code here and shows one back to this Mac’s camera.</p><button class="chip accent" data-dl="host">Connect a phone or iPad</button></div>`;
    const rp = typeof Relay !== 'undefined' ? Relay.peers() : [];
    const relay = typeof Relay === 'undefined' ? '' : `<div class="lk-direct"><p><b>Pair once, reach from anywhere</b> (no account): a phone or iPad scans a code here one time; then it finds this Mac by itself, also on mobile data, through public relays that only see end-to-end encrypted messages, and talks directly when the networks allow.</p>
      ${rp.length ? `<ul class="av-report">${rp.map(p => `<li>${Relay.online[p.room] ? '🟢' : '⚪️'} ${esc(p.name)} <span class="se-note">since ${esc(new Date(p.paired).toLocaleDateString())}${Relay.online[p.room] ? `, online${Direct.connected && Direct.peer === p.name ? ', direct' : ', relay'}` : ''}${Relay.outdated(p) ? ' · older relay list: pair again' : ''} · secret ${p.nextKey ? 'being changed (when it’s online)' : `from ${esc(new Date(p.keyAt || p.paired).toLocaleDateString())}`} · your phrase: ${p.nextPass ? 'changing (type it on the device)' : p.passKey ? 'on' : 'none'}</span> <button class="link-btn" data-rl="rekey:${esc(p.id)}">Change secret</button> <button class="link-btn" data-rl="macphrase:${esc(p.id)}">${p.passKey || p.nextPass ? 'Change phrase' : 'Add a phrase'}</button> <button class="link-btn" data-rl="revoke:${esc(p.id)}">Revoke</button></li>`).join('')}</ul>
      <div class="se-row"><label>Change every secret automatically <select data-rlsched>${[[0, 'Only when I ask'], [1, 'Every day'], [7, 'Every week'], [30, 'Every month']].map(([d, l]) => `<option value="${d}" ${Relay.rekeyEvery() === d ? 'selected' : ''}>${l}</option>`).join('')}</select></label><button class="chip" data-rl="rekeyall">Change all secrets now</button></div>` : ''}
      <p class="se-note">Relays (revision ${Relay.list().rev}, ${Relay.list().brokers.length} in the list) · direct link: ${({ auto: 'whenever possible', local: 'same network only', off: 'never' })[Relay.directCfg().mode]}</p>
      ${rp.length ? `<ul class="av-report">${Relay.status({ room: rp[0].room, brokers: rp[0].brokers || Relay.brokersOf(rp[0]) })}</ul>` : ''}
      <div class="chip-row"><button class="chip accent" data-rl="hostpair">Pair a phone or iPad (once)</button><button class="chip" data-rl="relays">Relays…</button><button class="chip" data-rl="direct">Direct link…</button></div></div>`;
    sheet('Connections', `<div class="lk">${relay}${typeof Bee !== 'undefined' ? Bee.html() : ''}<p class="se-note"><b>Directly, each time</b> (same Wi-Fi, no internet)</p>${direct}<p class="se-note"><b>Over Tailscale</b> (needs a Tailscale account on both)</p>${ts}
      <p class="se-note">${s.listening ? '✓' : '✗'} StudioGen answers on this Mac (port ${s.port}). Only your own Tailscale devices can reach it, and each must be paired.</p>
      ${s.pairing ? `<div class="lk-pair"><div class="lk-code">${s.pairing.code.replace(/(\d{3})/, '$1 ')}</div>${s.url ? '<div id="lkQr" title="The address, for a phone camera"></div>' : ''}<p class="se-note">In DriveGen: Settings › Connections › your Mac’s address (${esc(s.url || 'shown above')}) and this code. It works for 10 minutes.</p></div>` : ''}
      <p class="se-note"><b>Paired devices</b></p>${s.devices.length ? `<ul class="av-report">${s.devices.map(d => `<li>${esc(d.name)} <span class="se-note">since ${esc(new Date(d.paired).toLocaleDateString())}${d.seen ? `, last seen ${esc(new Date(d.seen).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}` : ''}</span> <button class="link-btn" data-lkrevoke="${esc(d.id)}">Revoke</button></li>`).join('')}</ul>` : '<p class="se-note">None yet.</p>'}
      <p class="se-note"><b>Scripts paired devices may run</b> (they show and speak here too; their lines, {result} and data go back)</p>
      ${list.map(x => `<label class="se-check"><input type="checkbox" data-lkoffer="${esc(x.id)}" ${off.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('') || '<p class="se-note">No scripts yet.</p>'}
      <p class="se-note">Interactive scripts aren’t run from a device: start one here and what’s said on the device (“ask my Mac …”) goes to it.</p></div>`,
      [...(s.tailscale && s.signedIn ? [[s.sharing ? 'Stop sharing' : 'Share on my tailnet', async () => { const r = await L.share(!s.sharing); if (!r.ok) toast(`Tailscale: ${r.err || 'didn’t work'}`); this.settings(); }]] : []),
        ['Pair a device', async () => { await L.pair(); this.settings(); }], ['Close']]);
    if (s.pairing && s.url) this.qr($('#lkQr'), s.url);
  },
  async qr(el, text, ecc = 'M') {
    if (!el) return;
    if (!window.qrcode) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/qrcode/qrcode.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }).catch(() => {});
    if (!window.qrcode) return; const q = qrcode(0, ecc); q.addData(text); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  },
};
if (window.DriveDeckDesktop?.link) DriveDeckDesktop.link.onAsk(async (kind, p) => {
  if (kind === 'offers') return { name: APP_NAME, scripts: LinkHost.scripts().map(s => ({ id: s.id, name: s.name, about: s.json.about || '' })) };
  if (kind === 'run') return LinkHost.run(p);
  if (kind === 'say') return LinkHost.say(p);
  if (kind === 'ai') return MacAI.answer(p);
  if (kind === 'paired') { toast(`${p.name} is paired`); if (!$('#sheet').hidden && $('#sheet .lk')) LinkHost.settings(); return true; }
  throw new Error(`Unknown request ${kind}`);
});
ACTIONS.connections = () => Link.settings();
document.addEventListener('click', async e => {
  const r = e.target.closest('[data-lkrevoke]'); if (r) { e.stopPropagation(); await DriveDeckDesktop.link.revoke(r.dataset.lkrevoke); toast('Revoked: that device can’t reach StudioGen any more'); return LinkHost.settings(); }
  const m = e.target.closest('[data-macrun]'); if (m) { e.stopPropagation(); closeSheet(); toast('Running on your Mac…'); try { const j = await Link.run(m.dataset.macrun); if (j.rows?.length) DataViz.set(DataViz.target(), DataViz.from(j.rows), { kind: 'script', label: 'from your Mac' }); Voice.respond(Link.spoken(j)); } catch (err) { toast(err.message); } }
}, true);
document.addEventListener('change', e => { const c = e.target.closest?.('[data-lkoffer]'); if (!c) return; const s = new Set(LinkHost.offered()); c.checked ? s.add(c.dataset.lkoffer) : s.delete(c.dataset.lkoffer); store.set('linkOffers', [...s]); });

/* ---------- Script actions (DriveGen, or any app paired with a Mac) ---------- */
const kv = args => Object.fromEntries((args || []).map(a => String(a).split('=')).filter(p => p[0]?.trim() && p.length > 1).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
Actions.define('mac.run', { group: 'Your Mac', name: 'Run a script on your Mac (StudioGen)', arg: 'The script’s name; inputs: name=value for its {variables}', async run(v, say, ev = {}) {
  const j = await Link.run(v, kv(ev.args)); if (j.state === 'failed') throw new Error(j.error || 'It didn’t work on your Mac');
  if (j.rows?.length) DataViz.set(DataViz.target(), DataViz.from(j.rows), { kind: 'script', label: 'from your Mac' });
  if (!ev.keep) Voice.respond(Link.spoken(j)); return j.result ?? (j.rows || (j.said || []).join(' ')); } });
Actions.define('mac.say', { group: 'Your Mac', name: 'Say something to your Mac', arg: 'The words (for its interactive script or voice commands)', async run(v, say, ev = {}) {
  const j = await Link.say(v); if (!ev.keep) Voice.respond(Link.spoken(j)); return (j.said || []).join(' '); } });
