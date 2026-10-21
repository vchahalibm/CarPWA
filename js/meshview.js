'use strict';
/* ============================================================
   The Mesh screen (StudioGen; js/mesh.js has the mesh itself):
   Live (a graph of devices and links, what each does, requests moving),
   Devices (a table, with permissions, details, removal), Activity (a live
   feed), Shows (synchronised multi-screen shows as lanes, with the
   conductor's controls), Shared (the mesh's artifacts, fetch, private),
   History (online time, links, requests, failures over days; export;
   replay of the graph at a moment). DriveGen gets a “who's around” card
   (Settings › Connections, and the dashboard widget “Who's around”).
   Loaded after mesh.js.
   ============================================================ */
const MeshView = {
  tab: 'live', pos: {}, filter: '', dots: [],
  open() { openView('mesh'); },
  /* ---------- Model: nodes and links from the roster, presence and reports ---------- */
  model(at = null) {
    const me = Mesh._me?.id, nodes = [], edges = new Map();
    for (const x of Mesh.members()) { const p = x.id === me ? { name: Mesh.myName(), app: APP_NAME, now: Script.running ? { script: Script.cur?.name, step: Script.i + 1, of: Script.cur?.beats?.length } : null, at: Date.now() } : Mesh.presence[x.id];
      nodes.push({ id: x.id, name: x.name, app: x.app, role: x.role, me: x.id === me, online: x.id === me || (p && Date.now() - p.at < 60000), p: p || {}, perms: x.perms || {} }); }
    const byName = n => nodes.find(x => x.name === n)?.id;
    const add = (a, b, kind, rtt) => { if (!a || !b || a === b) return; const k = [a, b].sort().join('|'), old = edges.get(k); if (!old || (old.kind !== 'direct' && kind === 'direct')) edges.set(k, { a, b, kind, rtt: rtt ?? old?.rtt ?? null }); };
    for (const n of nodes) for (const l of (n.me ? (Mesh.myLinks || []) : n.p.links || [])) add(n.id, l.to || byName(l.name), l.kind, l.rtt);
    // Recent requests through pairwise rooms count as relay links.
    for (const e of Mesh.events.slice(-200)) if (e.kind === 'request' && Date.now() - e.ts < 600000) add(e.dev, e.data.to || e.data.from, 'relay');
    return { nodes, edges: [...edges.values()] };
  },
  layout(nodes, edges, W, H) {
    for (const n of nodes) this.pos[n.id] ||= { x: W / 2 + Math.cos(Object.keys(this.pos).length * 2.4) * W * 0.3, y: H / 2 + Math.sin(Object.keys(this.pos).length * 2.4) * H * 0.3 };
    for (let it = 0; it < 120; it++) {
      for (const a of nodes) { const pa = this.pos[a.id]; if (pa.fixed) continue; let fx = (W / 2 - pa.x) * 0.01, fy = (H / 2 - pa.y) * 0.01;
        for (const b of nodes) if (a !== b) { const pb = this.pos[b.id], dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = Math.max(400, dx * dx + dy * dy); fx += dx / d2 * 9000; fy += dy / d2 * 9000; }
        for (const e of edges) if (e.a === a.id || e.b === a.id) { const pb = this.pos[e.a === a.id ? e.b : e.a], dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1; fx += dx / d * (d - 170) * 0.02; fy += dy / d * (d - 170) * 0.02; }
        pa.x = Math.max(60, Math.min(W - 60, pa.x + Math.max(-12, Math.min(12, fx)))); pa.y = Math.max(50, Math.min(H - 100, pa.y + Math.max(-12, Math.min(12, fy)))); }
    }
  },
  icon: n => n.app === 'StudioGen' ? '💻' : /iPad/.test(n.p.device || n.name) ? '📲' : '📱',
  now(n) { const w = n.p.now; return n.p.show ? `▶ show step ${n.p.show.step + 1}${n.p.show.drift != null ? ` · ${n.p.show.drift >= 0 ? '+' : ''}${n.p.show.drift} ms` : ''}` : w?.script ? `▶ ${w.script} ${w.step}/${w.of || '?'}${w.jobs?.length ? ` · ⏳ ${w.jobs.join(', ')}` : ''}` : n.p.stage ? 'Stage, idle' : n.online ? 'idle' : 'offline'; },
  graph(m, W = 760, H = 460) {
    this.layout(m.nodes, m.edges, W, H); const P = this.pos, col = { direct: '#34c47c', relay: '#e0a84a', tailscale: '#6ea0ff' };
    const lines = m.edges.map(e => { const a = P[e.a], b = P[e.b]; return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col[e.kind] || '#6b7280'}" stroke-width="${e.kind === 'direct' ? 4 : 2.5}" ${e.kind === 'relay' ? 'stroke-dasharray="8 6"' : e.kind === 'tailscale' ? 'stroke-dasharray="2 5"' : ''}/><text x="${(a.x + b.x) / 2 + 6}" y="${(a.y + b.y) / 2 - 6}" class="mv-el">${e.kind}${e.rtt != null ? ` · ${e.rtt} ms` : ''}</text>`; }).join('');
    const nodes = m.nodes.map(n => { const p = P[n.id], ring = !n.online ? '#6b7280' : n.p.now?.jobs?.length ? '#e0a84a' : n.p.now || n.p.show ? '#6ea0ff' : '#34c47c';
      return `<g class="mv-node" data-mvnode="${esc(n.id)}" transform="translate(${p.x},${p.y})"><circle r="${n.me ? 38 : 30}" fill="#151a24" stroke="${ring}" stroke-width="3"/><text y="9" text-anchor="middle" font-size="${n.me ? 26 : 22}">${this.icon(n)}</text>
        <text y="${n.me ? 56 : 48}" text-anchor="middle" class="mv-nl">${esc(n.name)}${n.me ? ' (you)' : ''}</text><text y="${n.me ? 72 : 64}" text-anchor="middle" class="mv-ns">${esc(n.app)} · ${esc(n.role)}</text><text y="${n.me ? 88 : 80}" text-anchor="middle" class="mv-nw" fill="${ring}">${esc(this.now(n))}</text></g>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="mv-svg" id="mvSvg">${lines}<g id="mvDots"></g>${nodes}</svg>`;
  },
  /** A request between two devices: a dot travels along their link. */
  dot(a, b) { const P = this.pos, g = $('#mvDots'); if (!g || !P[a] || !P[b]) return; const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('r', 6); c.setAttribute('fill', '#6ea0ff');
    c.innerHTML = `<animate attributeName="cx" from="${P[a].x}" to="${P[b].x}" dur="1.2s" fill="freeze"/><animate attributeName="cy" from="${P[a].y}" to="${P[b].y}" dur="1.2s" fill="freeze"/>`; g.appendChild(c); setTimeout(() => c.remove(), 1400); },
  /* ---------- The screen ---------- */
  render() {
    const el = $('#meshBody'); if (!el) return; const m = Mesh.m;
    if (!LINK_HOST) { el.innerHTML = `<div class="mv-pad">${this.card()}</div>`; return; }
    if (!m) { el.innerHTML = `<div class="mv-pad"><h2>Make a mesh</h2><p>A mesh joins your team's StudioGens and DriveGens into one network: this screen shows who is connected to whom, what each is doing, requests and shows as they happen, what's shared, and the history.</p>
      <div class="chip-row"><button class="chip accent" data-mv="create">Create a mesh</button><button class="chip" data-mv="joincode">Join with an invite</button></div>
      <p class="se-note">Devices already paired with this Mac join automatically once the mesh exists.</p></div>`; return; }
    const md = this.model(), on = md.nodes.filter(n => n.online).length, shows = Object.values(Mesh.shows).filter(s => !s.ended).length;
    const tabs = [['live', 'Live'], ['devices', 'Devices'], ['activity', 'Activity'], ['shows', 'Shows'], ['shared', 'Shared'], ['history', 'History']];
    el.innerHTML = `<div class="mv-top"><b>${svg('mesh')} ${esc(m.name)}</b>${tabs.map(([k, l]) => `<button class="mv-tab ${this.tab === k ? 'on' : ''}" data-mv="tab:${k}">${l}</button>`).join('')}
      <span class="mv-sum">${md.nodes.length} devices · ${on} online${shows ? ` · ${shows} show${shows > 1 ? 's' : ''}` : ''}</span><button class="chip" data-mv="invite">Invite</button><button class="chip" data-mv="settings">⚙</button></div>
      <div class="mv-main" id="mvMain">${this[this.tab](md)}</div>`;
  },
  live(md) {
    const feed = Mesh.events.slice(-12).reverse().map(e => `<div class="mv-ev">${this.line(e)}</div>`).join('') || '<p class="se-note">Nothing yet.</p>';
    const sel = this.sel && md.nodes.find(n => n.id === this.sel);
    return `<div class="mv-live"><div class="mv-graph">${this.graph(md)}</div><div class="mv-side">
      <h4>Now</h4>${md.nodes.filter(n => n.online && (n.p.now || n.p.show)).map(n => `<div class="mv-ev"><b>${esc(n.name)}</b>: ${esc(this.now(n))}</div>`).join('') || '<p class="se-note">Nobody is running anything.</p>'}
      <h4>Activity</h4>${feed}
      ${sel ? `<h4>Selected: ${esc(sel.name)}</h4><div class="mv-ev">${this.detail(sel)}</div>` : '<p class="se-note">Click a device for its details; drag to arrange.</p>'}</div></div>`;
  },
  detail(n) { const p = n.p; return `${esc(n.app)} ${p.ver ? `files ${p.ver}` : ''}${p.shell ? ` · app ${esc(p.shell)}` : ''} · ${esc(p.device || '')} · ${n.online ? 'online' : 'offline'} · role ${esc(n.role)}<br>Links: ${(p.links || []).map(l => `${esc(l.name || '?')} (${l.kind}${l.rtt != null ? `, ${l.rtt} ms` : ''})`).join(', ') || 'none reported'}<br>Relays: ${(p.relays || []).map(u => esc(Relay.label(u))).join(', ') || '–'}<br>Can run: ${esc((p.caps?.scripts || []).join(', ') || '–')}${p.caps?.tasks ? ' · tasks on its computer' : ''}${p.caps?.data ? ' · databases' : ''}<br>Permissions here: ${n.perms.run !== false ? 'may run scripts' : 'may not run scripts'}`; },
  line(e) {
    const who = id => esc(Mesh.member(id)?.name || (id === Mesh._me?.id ? 'This Mac' : 'a device')), t = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), d = e.data || {};
    const what = e.kind === 'request' ? (d.from ? `${who(d.from)} → ${who(e.dev)}: <b>${esc(d.kind)} “${esc(d.script || d.text || '')}”</b> ✓ ${d.ms ?? ''} ms${d.rows ? `, ${d.rows} rows` : ''}${d.result ? ` · <i>${esc(Mesh.cut(d.result, 90))}</i>` : ''}` : `${who(e.dev)} → ${who(d.to)}: <b>${esc(d.kind)} “${esc(d.script || '')}”</b>`)
      : e.kind === 'script' ? `${who(e.dev)}: script <b>${esc(d.script || '')}</b> ${d.what === 'step' ? `step ${d.step}${d.title ? ` (${esc(d.title)})` : ''}` : esc(d.what)}`
      : e.kind === 'show' ? `${who(e.dev)}: show ${esc(d.what)}${d.step ? ` step ${d.step}` : ''}${d.script ? ` “${esc(d.script)}”` : ''}`
      : e.kind === 'job' ? `${who(e.dev)}: background step ${esc(d.name)} ${esc(d.what)}` : e.kind === 'link' ? `${who(e.dev)}: ${esc(d.what)}${d.with ? ` with ${esc(d.with)}` : ''}`
      : e.kind === 'share' ? `${who(e.dev)} fetched ${esc(d.kind)} <b>${esc(d.name)}</b> from ${who(d.from)}` : e.kind === 'presence' ? `${esc(d.name || who(d.who))} ${esc(d.what)}`
      : e.kind === 'more' ? `${who(e.dev)}: ${d.n} more events (details on request)` : `${who(e.dev)}: ${esc(e.kind)} ${esc(Mesh.cut(d, 80))}`;
    return `${what} <span class="mv-t">${t}${e.via && e.via !== 'self' ? ` · ${e.via}` : ''}</span>`;
  },
  devices(md) {
    const amO = Mesh.amOwner();
    return `<table class="mv-tbl"><tr><th>Device</th><th>App</th><th>Role</th><th>Status</th><th>Doing</th><th>Links</th><th>May run</th><th></th></tr>${md.nodes.map(n => `<tr><td>${this.icon(n)} <b>${esc(n.name)}</b>${n.me ? ' (you)' : ''}<br><span class="mv-t">${esc(n.p.device || '')}</span></td><td>${esc(n.app)}${n.p.ver ? `<br><span class="mv-t">files ${n.p.ver}${n.p.shell ? ` · app ${esc(n.p.shell)}` : ''}</span>` : ''}</td><td>${esc(n.role)}</td>
      <td>${n.online ? '🟢 online' : `⚪️ ${n.p.at ? `seen ${new Date(n.p.at).toLocaleTimeString()}` : 'offline'}`}</td><td>${esc(this.now(n))}</td><td>${(n.p.links || []).map(l => `${esc(l.name || '?')}: ${l.kind}`).join('<br>') || '–'}</td>
      <td>${n.me ? '–' : `<label><input type="checkbox" data-mvperm="${esc(n.id)}" ${n.perms.run !== false ? 'checked' : ''} ${amO ? '' : 'disabled'}> scripts</label>`}</td>
      <td>${n.me ? `<button class="link-btn" data-mv="rename">Rename</button>` : `<button class="link-btn" data-mv="details:${esc(n.id)}">Fetch details</button>${amO ? ` <button class="link-btn" data-mv="remove:${esc(n.id)}">Remove</button>` : ''}`}</td></tr>`).join('')}</table>
      <p class="se-note">Owners change permissions and remove devices (the mesh's key then changes). Pairing secrets and phrases: Settings › Connections.</p>`;
  },
  activity() {
    const q = plain(this.filter), list = Mesh.events.filter(e => !q || plain(this.line(e).replace(/<[^>]+>/g, '')).includes(q)).slice(-300).reverse();
    return `<div class="mv-pad"><input class="se-wz-in" id="mvFilter" placeholder="Search: a device, a script, “failed”…" value="${esc(this.filter)}"><div class="mv-feed">${list.map(e => `<div class="mv-ev">${this.line(e)}</div>`).join('') || '<p class="se-note">Nothing yet.</p>'}</div></div>`;
  },
  shows() {
    const screens = Object.entries(Mesh.presence).filter(([, p]) => Date.now() - p.at < 60000 && p.stage).map(([id, p]) => [id, p.name]);
    const lane = (sh, id) => { const l = sh.lanes[id] || {}, name = Mesh.member(id)?.name || id, pct = Math.round(((l.step ?? -1) + 1) / Math.max(1, Scripts.all().find(s => s.name === sh.script)?.json?.beats?.length || 10) * 100);
      return `<div class="mv-lane"><span>${esc(name)}</span><div class="mv-bar"><span style="width:${pct}%;background:${l.state === 'on' ? '#34c47c' : l.state === 'ready' ? '#6ea0ff' : '#e0a84a'}"></span></div><span>${l.state || 'waiting'}${l.drift != null ? ` · ${l.drift >= 0 ? '+' : ''}${l.drift} ms` : ''}</span></div>`; };
    const list = Object.values(Mesh.shows).sort((a, b) => b.started - a.started).slice(0, 6);
    return `<div class="mv-pad"><h3>Start a show</h3><p class="se-note">A script runs on this Mac (the conductor) and on the screens you choose, in <b>steps</b> (every screen moves to each step at the same moment) or in <b>tandem</b> (each runs its own script; steps with “move on when: mesh cue” wait for your cues).</p>
      <div class="se-row"><select id="mvScript">${Scripts.all().filter(s => s.json?.mode !== 'interactive').map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><select id="mvMode"><option value="steps">Steps</option><option value="tandem">Tandem</option></select></div>
      <div class="chip-row">${screens.map(([id, n]) => `<label class="se-check"><input type="checkbox" data-mvscreen="${esc(id)}" checked> ${esc(n)}</label>`).join('') || '<span class="se-note">No screens online (a StudioGen or an iPad in Stage mode).</span>'}</div>
      <div class="chip-row"><button class="chip accent" data-mv="showstart">Start the show</button></div>
      ${list.map(sh => `<div class="mv-show"><b>${esc(sh.script)}</b> · ${esc(sh.mode)} · step ${sh.step + 1}${sh.ended ? ' · ended' : ''} <span class="mv-t">conductor ${esc(Mesh.member(sh.conductor)?.name || '')}</span>
        ${sh.screens.map(id => lane(sh, id)).join('')}
        ${!sh.ended && sh.conductor === Mesh._me?.id ? `<div class="chip-row"><button class="chip" data-mv="shownext">Next</button><button class="chip" data-mv="showback">Back</button><button class="chip" data-mv="showcue:${esc(sh.id)}">Send a cue</button><button class="chip" data-mv="showstop:${esc(sh.id)}">Stop</button></div>` : ''}</div>`).join('')}</div>`;
  },
  shared() {
    const rows = [], mine = Mesh.catalog(), meId = Mesh._me?.id;
    for (const [owner, cat] of Object.entries(Mesh.catalogs)) for (const a of cat || []) rows.push({ owner, ...a });
    const have = (k, n) => k === 'script' ? Scripts.all().some(s => s.name === n) : k === 'motion' ? !!MOTIONS[n] : false;
    const own = [...Scripts.mine().map(s => ['script', s.name]), ...Object.keys(Mocap.saved()).map(k => ['motion', k]), ...WebDrive.recs().map(r => ['webrec', r.name]), ...AppSteps.recs().map(r => ['apprec', r.name])];
    return `<div class="mv-pad"><h3>From the mesh</h3><table class="mv-tbl"><tr><th>Kind</th><th>Name</th><th>From</th><th>Size</th><th></th></tr>${rows.map(r => `<tr><td>${esc(r.k)}</td><td>${esc(r.n)}</td><td>${esc(Mesh.member(r.owner)?.name || '?')}</td><td>${Math.round(r.s / 1024 * 10) / 10} KB</td><td>${have(r.k, r.n) ? '✓ here' : `<button class="link-btn" data-mvget="${esc(r.owner)}|${esc(r.k)}|${esc(r.n)}">Get it</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="se-note">Nothing shared by others yet.</td></tr>'}</table>
      <h3>Yours</h3><p class="se-note">Shared with the mesh unless private (private ones stay on this Mac).</p><table class="mv-tbl"><tr><th>Kind</th><th>Name</th><th>Shared</th></tr>${own.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${esc(n)}</td><td><label><input type="checkbox" data-mvpriv="${esc(k)}|${esc(n)}" ${Mesh.isPrivate(k, n) ? '' : 'checked'}> shared</label></td></tr>`).join('') || '<tr><td colspan="3" class="se-note">Nothing of yours yet.</td></tr>'}</table></div>`;
  },
  history() {
    setTimeout(() => this.historyCharts(), 50);
    return `<div class="mv-pad"><div class="se-row"><label>Keep the history <select data-mvkeep>${MESH_KEEP.map(d => `<option value="${d}" ${MeshStore.keepDays() === d ? 'selected' : ''}>${d === 1 ? 'a day' : d === 7 ? 'a week' : d === 30 ? 'a month' : `${d} days`}</option>`).join('')}</select></label>
      <label>Show <select id="mvSpan"><option value="3600000">the last hour</option><option value="86400000" selected>the last day</option><option value="604800000">the last week</option></select></label>
      <button class="chip" data-mv="export">Export (JSON)</button><button class="chip" data-mv="exportcsv">Export (CSV)</button><button class="chip" data-mv="clearhist">Clear</button></div>
      <div class="mv-charts"><div><h4>Requests over time</h4><canvas id="mvC1"></canvas></div><div><h4>Events by kind</h4><canvas id="mvC2"></canvas></div><div><h4>Requests by device</h4><canvas id="mvC3"></canvas></div><div><h4>Response time (ms)</h4><canvas id="mvC4"></canvas></div></div>
      <h4>Replay</h4><input type="range" id="mvReplay" min="0" max="100" value="100" style="width:100%"><div id="mvReplayOut" class="se-note">Drag to see the activity at a moment.</div></div>`;
  },
  async historyCharts() {
    const span = +($('#mvSpan')?.value || 86400000), ev = await MeshStore.range(Date.now() - span); this.hist = ev; if (!$('#mvC1')) return;
    try { await DataViz.lib(); } catch { return; }
    const buckets = 24, w = span / buckets, t0 = Date.now() - span, reqs = ev.filter(e => e.kind === 'request');
    const lab = Array.from({ length: buckets }, (_, i) => new Date(t0 + i * w).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const count = f => Array.from({ length: buckets }, (_, i) => ev.filter(e => f(e) && e.ts >= t0 + i * w && e.ts < t0 + (i + 1) * w).length);
    const kinds = {}; ev.forEach(e => kinds[e.kind] = (kinds[e.kind] || 0) + 1);
    const byDev = {}; reqs.forEach(e => { const n = Mesh.member(e.data?.from || e.dev)?.name || 'this Mac'; byDev[n] = (byDev[n] || 0) + 1; });
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#ddd', opt = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: fg } } }, scales: { x: { ticks: { color: fg } }, y: { ticks: { color: fg }, beginAtZero: true } } };
    (this.charts || []).forEach(c => c.destroy());
    this.charts = [new Chart($('#mvC1'), { type: 'line', data: { labels: lab, datasets: [{ label: 'requests', data: count(e => e.kind === 'request'), borderColor: '#6ea0ff', tension: .3 }, { label: 'script steps', data: count(e => e.kind === 'script'), borderColor: '#34c47c', tension: .3 }] }, options: opt }),
      new Chart($('#mvC2'), { type: 'doughnut', data: { labels: Object.keys(kinds), datasets: [{ data: Object.values(kinds), backgroundColor: ['#6ea0ff', '#34c47c', '#e0a84a', '#a78bfa', '#f2646b', '#4bc0c0', '#c9cbcf'] }] }, options: { ...opt, scales: {} } }),
      new Chart($('#mvC3'), { type: 'bar', data: { labels: Object.keys(byDev), datasets: [{ label: 'requests', data: Object.values(byDev), backgroundColor: '#6ea0ff' }] }, options: opt }),
      new Chart($('#mvC4'), { type: 'line', data: { labels: reqs.map(e => new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), datasets: [{ label: 'ms', data: reqs.map(e => e.data?.ms || 0), borderColor: '#e0a84a', tension: .2 }] }, options: opt })];
  },
  replay(v) { const ev = this.hist || [], t = Date.now() - (+($('#mvSpan')?.value || 86400000)) * (1 - v / 100), near = ev.filter(e => Math.abs(e.ts - t) < 300000);
    $('#mvReplayOut').innerHTML = `<b>${new Date(t).toLocaleString()}</b>: ${near.length} events within 5 minutes${near.slice(-8).map(e => `<div class="mv-ev">${this.line(e)}</div>`).join('')}`; },
  /** DriveGen: who's around (the StudioGens online and what they're doing). */
  card() {
    const m = Mesh.m; if (!m) return '<p class="se-note">Not in a mesh yet: pair with a StudioGen that has one, or join with an invite.</p><div class="chip-row"><button class="chip" data-mv="joincode">Join with an invite</button></div>';
    const list = Mesh.around(); if (!Mesh.member(Mesh._me?.id)) return `<p class="se-note">Joining the mesh “${esc(m.name)}”: waiting for an owner's StudioGen to sign you in.</p>`;
    return `<h3>Who's around · ${esc(m.name)}</h3>${list.map(x => `<div class="mv-ev">${x.app === 'StudioGen' ? '💻' : '📱'} <b>${esc(x.name)}</b> · ${x.now?.script ? `▶ ${esc(x.now.script)} ${x.now.step}/${x.now.of || '?'}` : x.show ? `▶ show step ${x.show.step + 1}` : 'idle'}${(x.caps?.scripts || []).length ? `<br>${x.caps.scripts.slice(0, 6).map(sc => `<button class="link-btn" data-mvrun="${esc(x.id)}|${esc(sc)}">▶ ${esc(sc)}</button>`).join(' ')}` : ''}</div>`).join('') || '<p class="se-note">Nobody else online right now.</p>'}`;
  },
  settings() {
    const m = Mesh.m;
    sheet('Mesh settings', `<label class="se-field"><span>This device's name in the mesh</span><input id="mvName" class="se-wz-in" value="${esc(Mesh.myName())}"></label>
      ${m ? `<p class="se-note">Mesh “${esc(m.name)}” · ${Mesh.members().length} members · roster revision ${m.roster?.rev || 0}${Mesh.amOwner() ? ' · you are an owner' : ''}</p>` : ''}
      <label class="se-check"><input type="checkbox" id="mvAuto" ${store.get('meshAutoJoin', true) ? 'checked' : ''}> Devices paired with this Mac join its mesh automatically</label>
      <label class="se-check"><input type="checkbox" id="mvPill" ${store.get('meshPill', true) ? 'checked' : ''}> Show a badge on this screen while a show is running (step, drift)</label>`,
      [['Save', () => { store.set('meshName', $('#mvName').value.trim()); store.set('meshAutoJoin', $('#mvAuto').checked); store.set('meshPill', $('#mvPill').checked); Mesh.rebuild(); this.render(); MeshView.pill(); }], ...(m ? [['Share the relay list with the mesh', () => Mesh.updateBrokers().then(() => toast('Relay list sent to the mesh'))], ['Leave the mesh', () => Mesh.leave().then(() => this.render())]] : []), ['Close']]);
  },
  async invite() {
    const code = await Mesh.invite();
    Direct.screen('Invite to the mesh', `<div class="dl-step"><div class="dl-qr" id="dlQr"></div><div><p>On the other device (StudioGen › Mesh › Join with an invite, or DriveGen › Settings › Connections › Join with an invite): scan this, or paste the text below. Good for a day, once.</p><textarea class="se-wide" rows="3" readonly onclick="this.select()">${esc(code)}</textarea><p class="se-note">An owner's StudioGen signs the new device in when it's online.</p></div></div>`);
    LinkHost.qr($('#dlQr'), code, 'L');
  },
  joinSheet() { sheet('Join a mesh', '<label class="se-field"><span>Paste the invite (SGM…), or scan it</span><textarea id="mvCode" class="se-wide" rows="3"></textarea></label>', [['Join', () => Mesh.join($('#mvCode').value.trim()).then(() => { toast('Asked to join: an owner signs you in'); this.render(); Link.settings?.(); }, e => toast(e.message))], ['Scan', async () => { closeSheet(); Direct.screen('Scan the invite', '<div class="dl-step"><div class="dl-cam" id="dlCam"></div></div>'); try { const c = await Direct.scan($('#dlCam'), 'SGM'); Direct.done(); await Mesh.join(c); toast('Asked to join: an owner signs you in'); this.render(); } catch (e) { toast(e.message); } }], ['Cancel']]); },
  export(csv) {
    MeshStore.range(Date.now() - MeshStore.keepDays() * 86400000).then(ev => {
      const body = csv ? ['time,device,kind,data', ...ev.map(e => [new Date(e.ts).toISOString(), Mesh.member(e.dev)?.name || e.dev, e.kind, JSON.stringify(e.data).replace(/"/g, '""')].map(x => `"${x}"`).join(','))].join('\n') : JSON.stringify(ev, null, 1);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: csv ? 'text/csv' : 'application/json' })); a.download = `mesh-history.${csv ? 'csv' : 'json'}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  },
  async cmd(v) {
    const [a, ...rest] = v.split(':'), arg = rest.join(':');
    if (a === 'tab') { this.tab = arg; return this.render(); }
    if (a === 'create') return sheet('Create a mesh', '<label class="se-field"><span>Its name</span><input id="mvMesh" class="se-wz-in" placeholder="Acme demo team"></label>', [['Create', () => Mesh.create($('#mvMesh').value.trim()).then(() => { toast('Mesh created; paired devices are invited'); this.render(); })], ['Cancel']]);
    if (a === 'joincode') return this.joinSheet();
    if (a === 'invite') return this.invite();
    if (a === 'settings') return this.settings();
    if (a === 'rename') return this.settings();
    if (a === 'details') { toast('Fetching…'); try { toast(`${await Mesh.details(arg)} events fetched`); } catch (e) { toast(e.message); } return this.render(); }
    if (a === 'remove') return sheet('Remove from the mesh?', `<p>${esc(Mesh.member(arg)?.name)} can no longer read or send anything in the mesh; the mesh's key changes for everyone else.</p>`, [['Remove', () => Mesh.remove(arg).then(() => this.render(), e => toast(e.message))], ['Cancel']]);
    if (a === 'showstart') { const ids = $$('[data-mvscreen]').filter(c => c.checked).map(c => c.dataset.mvscreen); try { await Mesh.showStart($('#mvScript').value, ids, $('#mvMode').value); toast('Show starting'); } catch (e) { toast(e.message); } return setTimeout(() => this.render(), 1600); }
    if (a === 'shownext') return Script.next();
    if (a === 'showback') return Script.back();
    if (a === 'showcue') return sheet('Send a cue', '<label class="se-field"><span>Cue name</span><input id="mvCue" class="se-wz-in" value="go"></label>', [['Send', () => Mesh.showCue(arg, $('#mvCue').value.trim() || 'go')], ['Cancel']]);
    if (a === 'showstop') { Mesh.showStop(arg); return this.render(); }
    if (a === 'export') return this.export(false);
    if (a === 'exportcsv') return this.export(true);
    if (a === 'clearhist') return sheet('Clear the history?', '<p>Every stored mesh event on this Mac is deleted.</p>', [['Clear', () => MeshStore.clear().then(() => this.render())], ['Cancel']]);
  },
};
/* ---------- Wiring ---------- */
/* The show badge: on every device while a show runs in the mesh, a small pill at the top: conducting it, a screen in it
   (step and drift from the conductor), or watching (a phone that started it). Full for a few seconds after each change,
   then small; a tap opens Mesh › Shows. Mesh settings can turn it off (an audience screen). */
MeshView.pill = function () {
  let el = document.getElementById('meshPill');
  const sh = Object.values(Mesh.shows || {}).filter(x => !x.ended && Date.now() - x.started < 4 * 3600000).sort((a, b) => b.started - a.started)[0];
  if (!sh || !store.get('meshPill', true) || !Mesh.m) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('button'); el.id = 'meshPill'; el.className = 'mesh-pill'; el.setAttribute('aria-label', 'The show running in the mesh');
    el.onclick = () => { openView('mesh'); MeshView.tab = LINK_HOST ? 'shows' : 'live'; MeshView.render(); };
    document.body.appendChild(el);
  }
  const me = Mesh._me?.id, name = id => Mesh.member(id)?.name || 'a Mac', mine = Mesh.myShow?.id === sh.id ? Mesh.myShow : null;
  const step = (mine ? mine.step : sh.step) + 1, of = sh.of ? `/${sh.of}` : '', on = Object.values(sh.lanes || {}).filter(l => l.state === 'on' || l.state === 'ready').length;
  const full = Mesh.conducting === sh.id ? `<b>Conducting</b> ${esc(sh.script)} · step ${step}${of} · ${on} of ${sh.screens?.length || 0} screen${sh.screens?.length === 1 ? '' : 's'} on`
    : mine ? `<b>In the show</b> ${esc(sh.script)} · step ${step}${of}${mine.drift != null ? ` · ${mine.drift >= 0 ? '+' : ''}${mine.drift} ms` : ''} · ${esc(name(sh.conductor))}`
    : `<b>${esc(sh.script)}</b> on ${(sh.screens?.length || 0) + 1} screens · step ${step}${of}${sh.mode === 'tandem' ? ' · tandem' : ''}`;
  const key = `${sh.id}:${step}:${mine?.state || ''}`;
  if (el.dataset.key !== key) { el.dataset.key = key; el.classList.remove('small'); clearTimeout(MeshView.pillT); MeshView.pillT = setTimeout(() => el.classList.add('small'), 6000); }
  el.innerHTML = `<span class="mp-dot"></span><span class="mp-full">${full}</span><span class="mp-small">▶ ${step}${of}</span>`; el.hidden = false;
};
setInterval(() => MeshView.pill(), 1000);
Mesh.onchange = () => { clearTimeout(MeshView.rt); MeshView.rt = setTimeout(() => { if (current === 'mesh' && !['activity', 'history'].includes(MeshView.tab)) MeshView.render(); }, 400); };
Mesh.onevent = list => { for (const e of list) if (e.kind === 'request' && e.data?.from) MeshView.dot(e.data.from, e.dev); if (current === 'mesh' && MeshView.tab === 'activity') { const f = $('.mv-feed'); if (f) f.insertAdjacentHTML('afterbegin', list.map(e => `<div class="mv-ev">${MeshView.line(e)}</div>`).join('')); } else Mesh.onchange(); };
Bus.on('view.open', d => { if (d.value === 'mesh') MeshView.render(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mv]'); if (b) { e.stopPropagation(); return MeshView.cmd(b.dataset.mv); }
  const n = e.target.closest('[data-mvnode]'); if (n && !MeshView.dragged) { MeshView.sel = n.dataset.mvnode; return MeshView.render(); }
  const g = e.target.closest('[data-mvget]'); if (g) { e.stopPropagation(); const [o, k, nm] = g.dataset.mvget.split('|'); toast('Fetching…'); Mesh.fetch(o, k, nm).then(() => { toast(`Got “${nm}”`); MeshView.render(); }, err => toast(err.message)); return; }
  const r = e.target.closest('[data-mvrun]'); if (r) { e.stopPropagation(); const [id, sc] = r.dataset.mvrun.split('|'); toast(`Running “${sc}”…`); Mesh.runOn(id, sc).then(j => Voice.respond((j.said || []).join(' ') || 'Done.'), err => toast(err.message)); }
}, true);
document.addEventListener('change', e => {
  const p = e.target.closest?.('[data-mvperm]'); if (p) return Mesh.updateMember(p.dataset.mvperm, { perms: { ...(Mesh.member(p.dataset.mvperm)?.perms || {}), run: p.checked } }).catch(err => toast(err.message));
  const pr = e.target.closest?.('[data-mvpriv]'); if (pr) { const [k, n] = pr.dataset.mvpriv.split('|'); return Mesh.setPrivate(k, n, !pr.checked); }
  const k = e.target.closest?.('[data-mvkeep]'); if (k) { store.set('meshKeepDays', +k.value); MeshStore.prune(); return toast('Saved'); }
  if (e.target.id === 'mvSpan') MeshView.historyCharts();
});
document.addEventListener('input', e => { if (e.target.id === 'mvFilter') { MeshView.filter = e.target.value; const f = $('.mv-feed'); if (f) { const q = plain(MeshView.filter); f.innerHTML = Mesh.events.filter(ev => !q || plain(MeshView.line(ev).replace(/<[^>]+>/g, '')).includes(q)).slice(-300).reverse().map(ev => `<div class="mv-ev">${MeshView.line(ev)}</div>`).join(''); } } if (e.target.id === 'mvReplay') MeshView.replay(+e.target.value); });
// Drag nodes to arrange the graph.
document.addEventListener('pointerdown', e => { const n = e.target.closest?.('[data-mvnode]'); if (!n) return; const svg = $('#mvSvg'), id = n.dataset.mvnode; MeshView.dragged = false;
  const mv = ev => { const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; MeshView.pos[id] = { x: (ev.clientX - r.left) / r.width * vb.width, y: (ev.clientY - r.top) / r.height * vb.height, fixed: true }; MeshView.dragged = true; n.setAttribute('transform', `translate(${MeshView.pos[id].x},${MeshView.pos[id].y})`); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (MeshView.dragged) { MeshView.render(); setTimeout(() => { MeshView.dragged = false; }, 50); } };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); });
// Who's around, on the dashboard (DriveGen; also StudioGen).
W.mesh = { name: 'Who’s around (mesh)', html: () => `<div class="mv-widget">${MeshView.card()}</div>` };
ACTIONS.mesh = () => MeshView.open();
window.DriveDeckDesktop?.onMenu?.(w => { if (w === 'mesh') MeshView.open(); }); // the menu bar's “Mesh…”
