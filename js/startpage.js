'use strict';
/* ============================================================
   The start page (StudioGen's first screen; DriveGen can choose it too): flowing waves in the background, the
   assistant standing in the middle (the Stage avatar, moved here: one instance, nothing loaded twice), a short
   description top-left, and cards to get going: start presenting, recent scripts, the mesh, connections.
   - The waves are one canvas at ~30 fps, paused when the page isn't showing or the app is hidden, still when the
     system asks for reduced motion.
   - Settings › General › Start screen (start page or the dashboard); the assistant's hello can be turned off.
   Loaded after meshview.js.
   ============================================================ */
const StartPage = {
  on: false, raf: 0, t0: 0, greeted: false,
  /** How the assistant appears here (Customize): character ('' = the one on Stage, or a built-in), size and position (%). */
  look: () => ({ model: '', size: 100, x: 52, y: 0, ...store.get('startAvatar', {}) }),
  /** The assistant shown here: its own widget for another character, else the first 3D-model widget on Stage. */
  avatarId() { const m = this.look().model; if (m && typeof BUILTIN_MODELS !== 'undefined' && BUILTIN_MODELS[m]) { if (Wcfg.get('model~start').builtin !== m) Wcfg.set('model~start', { builtin: m }); return 'model~start'; } return this.stageId(); },
  stageId() { return (typeof Dash !== 'undefined' && [...Dash.list('stage.side'), ...Dash.list('stage.main')].find(id => wtype(id) === 'model')) || 'model~stage'; },
  show() {
    const root = $('#startRoot'); if (!root) return;
    const recent = (typeof Scripts !== 'undefined' ? Scripts.mine() : []).slice(-3).reverse();
    const net = typeof netState === 'function' ? netState() : ['on', 'Online', ''];
    const around = typeof Mesh !== 'undefined' && Mesh.m ? Object.values(Mesh.presence || {}).filter(x => Date.now() - x.at < 60000).length : null;
    root.innerHTML = `<canvas class="sp-waves" aria-hidden="true"></canvas>
      <div class="sp-head">
        <h1 class="sp-title"><span class="sp-grad">Present together: voice, scripts, shows and screens</span> <span class="sp-plain">from one place</span></h1>
        <p class="sp-sub">${APP_NAME} gives your presentations a voice and a face: an assistant that presents your scripts, answers what you ask, runs them on your other Macs and phones, and keeps every screen in step.</p>
      </div>
      <div class="sp-avatar mw" data-media="${esc(this.avatarId())}" style="--sp-av:${this.look().size / 100};--sp-x:${this.look().x}%;--sp-y:${this.look().y}%" title="Drag to move her"><div class="mw-body"></div></div>
      <button class="sp-handle" data-sp="dock" aria-label="Show the apps"><i></i></button>
      <button class="sp-custom" data-sp="custom" aria-label="Customize the assistant here">${svg('sliders')}</button>
      <div class="sp-cards">
        <button class="sp-card sp-primary" data-sp="stage"><b>${svg('stage')} Start presenting</b><span>Stage: your slides, the assistant and your scripts</span></button>
        <div class="sp-card"><b>${svg('play')} Scripts</b>${recent.length ? recent.map(s => `<button class="sp-row" data-sp-run="${esc(s.id)}">▶ ${esc(s.name)}</button>`).join('') : '<span>None yet: make one in Settings › Scripts</span>'}<button class="sp-link" data-sp="scripts">All scripts</button></div>
        <button class="sp-card" data-sp="mesh"><b>${svg('mesh')} Mesh</b><span>${around == null ? 'Not in a mesh yet: create one' : `${around} other device${around === 1 ? '' : 's'} online`}</span></button>
        <button class="sp-card" data-sp="net"><b>${svg('signal')} Connections</b><span class="sp-net ${net[0]}"><i></i>${esc(net[1])}${net[2] ? ` · ${esc(net[2])}` : ''}</span></button>
      </div>`;
    this.on = true; this.waves(root.querySelector('.sp-waves'));
    $('#app').classList.add('sp-dock'); // the whole page; the dock slides in from the left edge
    const el = root.querySelector('.sp-avatar');
    if (typeof Media !== 'undefined') Media.mount(this.avatarId(), el).then(() => { this.wide(true); this.greet(); }).catch(() => {});
  },
  /** Leaving: the waves stop; the assistant goes back to its Stage widget. */
  hide() {
    if (!this.on) return; this.on = false; cancelAnimationFrame(this.raf); this.wide(false);
    $('#app').classList.remove('sp-dock', 'sp-dock-open');
    const id = this.avatarId();
    if (id === 'model~start') $('#startRoot .sp-avatar')?.remove(); // its own character: let it go (avatar.js disposes it)
    else if (typeof Media !== 'undefined' && $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`)) Media.mount(id).catch(() => {});
  },
  /** Head to toe with room for the arms here; the Stage framing back when leaving. */
  wide(on) { const i = typeof VrmAvatar !== 'undefined' && VrmAvatar.all.get(this.avatarId()); if (!i || i.wide === on) return; i.wide = on; i.frame(); },
  customize() {
    const L = this.look(), opts = typeof BUILTIN_MODELS !== 'undefined' ? Object.entries(BUILTIN_MODELS).filter(([, m]) => m.vrm) : [];
    sheet('The assistant on the start page', `<label class="se-field"><span>Character</span><select id="spModel"><option value="">The one on Stage</option>${opts.map(([k, m]) => `<option value="${esc(k)}" ${L.model === k ? 'selected' : ''}>${esc(m.name || k)}</option>`).join('')}</select></label>
      <label class="se-field"><span>Size: <b id="spSizeV">${L.size}%</b></span><input type="range" id="spSize" min="50" max="140" step="5" value="${L.size}"></label>
      <p class="se-note">To place her, drag her anywhere on the start page.</p>`,
      [['Save', () => { store.set('startAvatar', { ...this.look(), model: $('#spModel').value, size: +$('#spSize').value }); if (current === 'start') { this.hide(); this.show(); } }], ['Reset', () => { store.set('startAvatar', {}); if (current === 'start') { this.hide(); this.show(); } }], ['Cancel', () => this.preview(this.look())]]);
    const live = () => { $('#spSizeV').textContent = `${$('#spSize').value}%`; this.preview({ ...this.look(), size: +$('#spSize').value }); };
    $('#spSize').addEventListener('input', live);
  },
  /** Size and position while the sliders move. */
  preview(L) { const el = $('#startRoot .sp-avatar'); if (!el) return; el.style.setProperty('--sp-av', L.size / 100); el.style.setProperty('--sp-x', `${L.x}%`); el.style.setProperty('--sp-y', `${L.y || 0}%`); requestAnimationFrame(() => VrmAvatar?.all.get(this.avatarId())?.resize()); },
  greet() {
    if (this.greeted) return; this.greeted = true;
    setTimeout(() => {
      if (!this.on) return;
      if (typeof VrmAvatar !== 'undefined') VrmAvatar.gesture('Wave');
      if (settings.startGreet !== false && typeof Voice !== 'undefined') Voice.speak(`Hello! Ready when you are.`);
    }, 900);
  },
  /** Flowing ribbons, red → magenta → violet → blue, like light through silk. */
  waves(cv) {
    if (!cv) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, ctx = cv.getContext('2d');
    const N = 14, ribbons = Array.from({ length: N }, (_, i) => ({ a: 0.08 + 0.1 * Math.sin(i * 1.7) ** 2, f: 1.3 + (i % 5) * 0.22, s: 0.18 + (i % 4) * 0.06, p: i * 0.55, w: 0.6 + (i % 3) * 0.5, o: 0.06 + (i % 4) * 0.035 }));
    let last = 0;
    const draw = now => {
      if (!this.on) return;
      this.raf = requestAnimationFrame(draw);
      if (document.hidden || now - last < 33) return; last = now; // ~30 fps, nothing while hidden
      const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#ff4a3d'); g.addColorStop(0.35, '#e244e8'); g.addColorStop(0.65, '#7b4dff'); g.addColorStop(1, '#3f6bff');
      const t = still ? 2 : now / 1000;
      // each ribbon: a band between two curves that breathe apart and together (silk), plus a thin bright edge
      const curve = (r, u, k) => H * 0.6 + H * r.a * Math.sin(u * Math.PI * r.f + t * r.s + r.p + k * 0.35) + H * 0.05 * Math.sin(u * Math.PI * 3.1 - t * r.s * 0.7 + r.p * 2 + k * 0.5);
      for (const r of ribbons) {
        const top = [], bot = [];
        for (let x = 0; x <= W + 6; x += 6) { const u = x / W, th = H * (0.012 + 0.03 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 + t * 0.3 + r.p))) * Math.sin(Math.PI * Math.min(1, Math.max(0, u)) ) ; top.push([x, curve(r, u, 0)]); bot.push([x, curve(r, u, 0) + th]); }
        ctx.beginPath(); top.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k][0], bot[k][1]); ctx.closePath();
        ctx.fillStyle = g; ctx.globalAlpha = r.o * 1.6; ctx.fill();
        ctx.beginPath(); top.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = g; ctx.globalAlpha = r.o * 3; ctx.lineWidth = r.w; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (still) cancelAnimationFrame(this.raf);
    };
    this.raf = requestAnimationFrame(draw);
  },
};
Bus.on('view.open', d => { if (d.value !== 'start') StartPage.hide(); });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sp],[data-sp-run]'); if (!b || !b.closest('#startRoot')) return;
  if (b.dataset.spRun) { const s = Scripts.get(b.dataset.spRun); if (s) { openView('dashboard'); setTimeout(() => Script.start(s.json), 400); } return; }
  const k = b.dataset.sp;
  if (k === 'stage') { if (settings.appMode !== 'stage') { settings.appMode = 'stage'; applySettings(); } openView('dashboard'); }
  else if (k === 'scripts') { openView('settings'); setTimeout(() => typeof ScriptUI !== 'undefined' && ScriptUI.open?.(), 300); }
  else if (k === 'dock') $('#app').classList.toggle('sp-dock-open');
  else if (k === 'custom') StartPage.customize();
  else if (k === 'mesh') openView('mesh');
  else if (k === 'net') (APP_NAME === 'StudioGen' && typeof LinkHost !== 'undefined' ? LinkHost.settings() : Link.settings());
});
// The dock on the start page: in from the left edge (pointer at the edge, or the handle), out again when the pointer leaves it or the page is tapped.
document.addEventListener('pointermove', e => {
  const app = $('#app'); if (!app?.classList.contains('sp-dock') || e.pointerType === 'touch') return;
  if (e.clientX <= 8) { clearTimeout(StartPage.dockT); app.classList.add('sp-dock-open'); }
  else if (app.classList.contains('sp-dock-open') && !e.target.closest('.dock, .sp-handle')) { clearTimeout(StartPage.dockT); StartPage.dockT = setTimeout(() => app.classList.remove('sp-dock-open'), 700); }
  else if (e.target.closest('.dock')) clearTimeout(StartPage.dockT);
});
document.addEventListener('click', e => { const app = $('#app'); if (app?.classList.contains('sp-dock-open') && !e.target.closest('.dock, .sp-handle')) app.classList.remove('sp-dock-open'); }, true);
// Drag her anywhere on the start page (a tap still makes her wave): left/bottom in % of the page, kept.
document.addEventListener('pointerdown', e => {
  const el = e.target.closest?.('#startRoot .sp-avatar'); if (!el || e.button > 0) return;
  const root = $('#startRoot'), R = root.getBoundingClientRect(), L = StartPage.look(), x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return; moved = true; el.classList.add('dragging');
    const x = Math.min(92, Math.max(8, L.x + (ev.clientX - x0) / R.width * 100)), y = Math.min(70, Math.max(-20, L.y - (ev.clientY - y0) / R.height * 100));
    el.style.setProperty('--sp-x', `${x}%`); el.style.setProperty('--sp-y', `${y}%`); StartPage.drag = { x: Math.round(x), y: Math.round(y) };
  };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); el.classList.remove('dragging');
    if (moved) { el.classList.add('dragged'); setTimeout(() => el.classList.remove('dragged'), 60); }
    if (moved && StartPage.drag) { store.set('startAvatar', { ...StartPage.look(), ...StartPage.drag }); StartPage.drag = null; } };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
// a drag isn't a tap: no wave after moving her
addEventListener('click', e => { if (e.target.closest?.('#startRoot .sp-avatar.dragged')) e.stopImmediatePropagation(); }, true);
