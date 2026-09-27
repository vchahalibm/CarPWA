'use strict';
/* ============================================================
   Driving modes: Map (flat), 3D (tilted to the horizon), AR (route on
   the camera view) and HUD (minimal, can mirror for the windshield).
   Loaded after app.js and uses its globals (loc, nav, settings, …).
   ============================================================ */
const MODES = [
  { id: 'map', name: 'Map', icon: 'maps', hint: 'Flat, north-up map' },
  { id: '3d', name: '3D', icon: 'cube', hint: 'Map tilted toward the horizon' },
  { id: 'ar', name: 'AR', icon: 'camera', hint: 'Route drawn on the camera view' },
  { id: 'hud', name: 'HUD', icon: 'hud', hint: 'Big, glanceable; mirrors for the windshield' },
];
let activeMode = mapMode;
const modeOverlayOpen = () => activeMode === 'ar' || activeMode === 'hud';

function setMode(id) {
  if (!MODES.some(m => m.id === id)) return;
  closeModeMenu();
  if (activeMode === 'ar' && id !== 'ar') AR.stop();
  if (activeMode === 'hud' && id !== 'hud') HUD.close();
  activeMode = id;
  if (id === 'map' || id === '3d') {
    settings.navMode = id; store.set('settings', settings);
    if (current !== 'maps') openView('maps');
    setMapMode(id);
  }
  if (id === 'hud') HUD.open();
  if (id === 'ar') AR.start();
  renderModeButton();
}
const exitOverlay = () => setMode(mapMode);
function renderModeButton() {
  const m = MODES.find(x => x.id === (modeOverlayOpen() ? mapMode : activeMode));
  $('#modeBtn').innerHTML = `${svg('layers')}<small>${m.name}</small>`;
}
function toggleModeMenu() {
  const menu = $('#modeMenu');
  if (!menu.hidden) return closeModeMenu();
  menu.innerHTML = MODES.map(m => `<button class="mode-tile ${m.id === activeMode ? 'on' : ''}" data-mode="${m.id}">
    ${svg(m.icon)}<b>${m.name}</b><span>${m.hint}</span></button>`).join('');
  menu.hidden = false;
}
function closeModeMenu() { $('#modeMenu').hidden = true; }

/** Everything the HUD and AR screens show about the route, as display strings. */
function navSummary() {
  const v = nav?.view;
  if (!v) return null;
  const d = fmtDist(v.toNext), rd = fmtDist(v.remain);
  return { icon: v.step.icon, dist: `${d.v} ${d.u}`, text: v.step.text, street: v.step.street || v.step.text,
    eta: fmtClock(v.eta), left: v.remainT >= 3600 ? `${fmtMins(v.remainT)} h` : `${fmtMins(v.remainT)} min`,
    remain: `${rd.v} ${rd.u}`, progress: v.progress };
}
/** Overlay controls fade out after a few seconds; any tap brings them back. */
function autoHide(el) {
  el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 4000);
}

/* ============================================================
   HUD
   ============================================================ */
const HUD = {
  open() { $('#hud').hidden = false; autoHide($('#hudCtl')); this.render(); },
  close() { $('#hud').hidden = true; },
  render() {
    if ($('#hud').hidden) return;
    $('#hudStage').classList.toggle('mirror', !!settings.hudMirror);
    $('#hudMirrorBtn').classList.toggle('on', !!settings.hudMirror);
    const s = navSummary();
    $('#hudStage').classList.toggle('idle', !s);
    if (s) {
      $('#hudArrow').innerHTML = svg(s.icon);
      $('#hudDist').textContent = s.dist;
      $('#hudStreet').textContent = s.street;
      $('#hudEta').textContent = s.eta; $('#hudLeft').textContent = s.left; $('#hudRemain').textContent = s.remain;
      $('#hudProg').style.width = (s.progress * 100).toFixed(1) + '%';
    } else {
      const h = loc.heading || 0;
      $('#hudArrow').innerHTML = svg('locate').replace('<svg', `<svg style="transform:rotate(${h - 45}deg)"`);
      $('#hudDist').textContent = loc.source === 'none' ? 'No location' : `${cardinal(h)} ${Math.round(h)}°`;
      $('#hudStreet').textContent = fmtClock(new Date());
    }
  },
};
listeners.push(() => HUD.render());

/* ============================================================
   AR: camera + route ribbon projected with the phone's tilt sensors.
   Direction comes from the GPS course while moving (a car's metal throws
   compasses off), the compass when parked. Pitch and roll come from gravity.
   ============================================================ */
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = a => { const l = Math.hypot(...a); return l > 1e-6 ? vscale(a, 1 / l) : null; };
const CAM_HEIGHT = 1.3;     // metres above the road
const RIBBON_HALF = 1.8;    // half the ribbon width, metres

const AR = {
  running: false, stream: null, raf: 0, up: null, compass: null,
  async start() {
    $('#ar').hidden = false; this.running = true; autoHide($('#arCtl'));
    this.note('');
    if (!store.get('arWarned')) { store.set('arWarned', true); toast('AR is for a fixed mount or passengers. Keep your eyes on the road.'); }
    await this.enableOrientation(); // must be first: iOS only asks for motion access straight after a tap
    await this.enableCamera();
    this.renderCalibration();
    cancelAnimationFrame(this.raf); this.loop();
  },
  stop() {
    this.running = false; cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    $('#arVideo').srcObject = null; $('#ar').hidden = true; $('#arCal').hidden = true;
  },
  note(text) { $('#arNote').textContent = text; $('#arNote').hidden = !text; },
  async enableOrientation() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
        && await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('denied');
    } catch { this.note('Motion access is off, so the horizon is fixed. Use Calibrate to line it up.'); return; }
    if (this.onOrient) return;
    this.onOrient = e => {
      if (e.beta == null || e.gamma == null) return;
      const b = rad(e.beta), g = rad(e.gamma);
      // World "up" in device coordinates (i.e. gravity): continuous even when the phone is held sideways.
      const up = [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
      this.up = this.up ? vnorm(vsub(this.up, vscale(vsub(this.up, up), 0.2))) || up : up;
      this.compass = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null);
    };
    addEventListener('deviceorientation', this.onOrient);
  },
  async enableCamera() {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const v = $('#arVideo'); v.srcObject = this.stream; await v.play();
    } catch (e) {
      console.warn('Camera unavailable', e);
      this.note(window.isSecureContext ? 'Camera unavailable, showing a simulated road' : 'The camera needs HTTPS, showing a simulated road');
    }
  },
  loop() {
    if (!this.running) return;
    try { this.draw(); } catch (e) { console.warn('AR draw failed', e); }
    this.raf = requestAnimationFrame(() => this.loop());
  },
  /** Camera pose: device-space basis for world forward/right/up plus focal length and screen rotation. */
  pose(W, H) {
    let u = this.up || [0, Math.cos(rad(4)), Math.sin(rad(4))]; // no sensors: upright phone looking slightly down
    const p = rad(settings.arPitch);                             // horizon calibration: tilt about the device x-axis
    u = [u[0], u[1] * Math.cos(p) - u[2] * Math.sin(p), u[1] * Math.sin(p) + u[2] * Math.cos(p)];
    const moving = loc.source !== 'none' && loc.speed > 2.5;
    const head = (moving || this.compass == null ? loc.heading || 0 : this.compass) + settings.arYaw;
    const fwd = vnorm(vsub([0, 0, -1], vscale(u, -u[2]))) || [0, 1, 0]; // camera axis flattened onto the ground plane
    const right = vcross(fwd, u);
    const angle = rad(screen.orientation?.angle ?? window.orientation ?? 0);
    const v = $('#arVideo'), vw = v.videoWidth, vh = v.videoHeight, half = Math.tan(rad(settings.arFov) / 2);
    const f = vw && vh && this.stream ? Math.max(W / vw, H / vh) * Math.max(vw, vh) / 2 / half : Math.max(W, H) / 2 / half;
    const yaw = rad(head);
    return { u, fwd, right, f, W, H, sinY: Math.sin(yaw), cosY: Math.cos(yaw), ca: Math.cos(angle), sa: Math.sin(angle) };
  },
  /** World offset (east, north, up in metres from the camera) → screen point, or null if behind the camera. */
  project(c, E, N, U) {
    const a = E * c.sinY + N * c.cosY, b = E * c.cosY - N * c.sinY; // forward, right
    const p = [c.fwd[0] * a + c.right[0] * b + c.u[0] * U, c.fwd[1] * a + c.right[1] * b + c.u[1] * U, c.fwd[2] * a + c.right[2] * b + c.u[2] * U];
    const depth = -p[2];
    if (depth < 1) return null;
    const x = c.f * p[0] / depth, y = c.f * p[1] / depth;
    return { x: c.W / 2 + x * c.ca - y * c.sa, y: c.H / 2 - (x * c.sa + y * c.ca), depth };
  },
  draw() {
    const cv = $('#arCanvas'), dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const cam = this.pose(W, H);
    if (!this.stream) this.drawGround(ctx, cam);
    // Dead-reckon between GPS fixes so the ribbon glides instead of jumping once a second.
    const dt = loc.source === 'none' ? 0 : Math.min(1.5, Math.max(0, (Date.now() - loc.ts) / 1000)), adv = loc.speed * dt;
    const h = rad(loc.heading || 0);
    const here = { lat: loc.lat + adv * Math.cos(h) / 110540, lon: loc.lon + adv * Math.sin(h) / (111320 * Math.cos(rad(loc.lat))) };
    const s = navSummary();
    $('#arTop').classList.toggle('idle', !s);
    if (s) {
      $('#arIcon').innerHTML = svg(s.icon); $('#arDist').textContent = s.dist; $('#arText').textContent = s.text;
      $('#arEta').textContent = s.eta; $('#arLeft').textContent = s.left; $('#arRemain').textContent = s.remain;
      $('#arDone').style.width = (s.progress * 100).toFixed(1) + '%';
      this.drawRoute(ctx, cam, here, nav.view.along + adv);
    } else {
      $('#arText').textContent = 'No route yet. Tap Exit, then “Where to?”';
      $('#arSign').hidden = true; $('#arDest').hidden = true;
    }
  },
  drawGround(ctx, cam) {
    // Simulated scene when there's no camera: sky, ground and a horizon that follows the phone's tilt.
    const L = this.project(cam, -cam.cosY * 4000 + cam.sinY * 20000, cam.sinY * 4000 + cam.cosY * 20000, 0);
    const R = this.project(cam, cam.cosY * 4000 + cam.sinY * 20000, -cam.sinY * 4000 + cam.cosY * 20000, 0);
    ctx.fillStyle = '#1d2229'; ctx.fillRect(0, 0, cam.W, cam.H);
    if (!L || !R) return;
    const dx = R.x - L.x, dy = R.y - L.y, k = 4000 / Math.hypot(dx, dy);
    const a = { x: L.x - dx * k, y: L.y - dy * k }, b = { x: R.x + dx * k, y: R.y + dy * k }, nx = dy * k, ny = -dx * k; // normal toward the sky
    const un = Math.hypot(nx, ny), sky = ctx.createLinearGradient(L.x, L.y, L.x + nx / un * cam.H * 0.7, L.y + ny / un * cam.H * 0.7);
    sky.addColorStop(0, '#38506f'); sky.addColorStop(1, '#0c1526');
    ctx.fillStyle = sky;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x + nx, b.y + ny); ctx.lineTo(a.x + nx, a.y + ny); ctx.fill();
  },
  drawRoute(ctx, cam, here, along) {
    const r = nav.route, xy = localXY(here.lat, here.lon), total = r.cum.at(-1);
    const len = Math.max(250, loc.speed * 25), stepM = 4, pts = [];
    for (let d = Math.max(0, along - 20); d <= Math.min(total, along + len); d += stepM) {
      const i = segAt(r.cum, d), j = Math.min(i + 1, r.coords.length - 1), seg = r.cum[j] - r.cum[i], t = seg ? (d - r.cum[i]) / seg : 0;
      const [e0, n0] = xy(r.coords[i][0], r.coords[i][1]), [e1, n1] = xy(r.coords[j][0], r.coords[j][1]);
      const dir = seg ? [(e1 - e0) / seg, (n1 - n0) / seg] : pts.at(-1)?.dir || [0, 1];
      pts.push({ d, e: e0 + (e1 - e0) * t, n: n0 + (n1 - n0) * t, dir });
    }
    // Ribbon: grey where already driven, blue ahead, fading into the distance.
    for (let k = 0; k < pts.length - 1; k++) {
      const q = [pts[k], pts[k + 1]].map(p => {
        const lx = -p.dir[1] * RIBBON_HALF, ly = p.dir[0] * RIBBON_HALF; // left of travel
        return [this.project(cam, p.e + lx, p.n + ly, -CAM_HEIGHT), this.project(cam, p.e - lx, p.n - ly, -CAM_HEIGHT)];
      });
      if (q.some(([l, rr]) => !l || !rr)) continue;
      const ahead = pts[k].d - along, fade = Math.max(0, 1 - Math.max(0, ahead) / len);
      ctx.fillStyle = ahead < 0 ? 'rgba(160,166,176,.35)' : `rgba(26,140,255,${(0.15 + 0.6 * fade).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(q[0][0].x, q[0][0].y); ctx.lineTo(q[1][0].x, q[1][0].y); ctx.lineTo(q[1][1].x, q[1][1].y); ctx.lineTo(q[0][1].x, q[0][1].y); ctx.fill();
      if (ahead > 0 && Math.round(pts[k].d / stepM) % 3 === 0) { // chevrons pointing along the route
        const p = pts[k], w = RIBBON_HALF * 0.55, back = [-p.dir[0] * 1.2, -p.dir[1] * 1.2], lx = -p.dir[1] * w, ly = p.dir[0] * w;
        const tip = this.project(cam, p.e, p.n, -CAM_HEIGHT), l = this.project(cam, p.e + back[0] + lx, p.n + back[1] + ly, -CAM_HEIGHT),
          rr = this.project(cam, p.e + back[0] - lx, p.n + back[1] - ly, -CAM_HEIGHT);
        if (tip && l && rr) {
          ctx.strokeStyle = `rgba(255,255,255,${(0.25 + 0.6 * fade).toFixed(3)})`; ctx.lineWidth = Math.max(1.5, 60 / tip.depth);
          ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(rr.x, rr.y); ctx.stroke();
        }
      }
    }
    // Floating signs above the next turn and the destination.
    const place = (el, d, lift, html) => {
      if (d - along > 900 || d < along - 5) { el.hidden = true; return; }
      const i = segAt(r.cum, d), j = Math.min(i + 1, r.coords.length - 1), seg = r.cum[j] - r.cum[i], t = seg ? (d - r.cum[i]) / seg : 0;
      const lat = r.coords[i][0] + (r.coords[j][0] - r.coords[i][0]) * t, lon = r.coords[i][1] + (r.coords[j][1] - r.coords[i][1]) * t;
      const [e, n] = xy(lat, lon), p = this.project(cam, e, n, -CAM_HEIGHT + lift);
      if (!p || p.x < -100 || p.x > cam.W + 100 || p.y < -100 || p.y > cam.H + 100) { el.hidden = true; return; }
      el.hidden = false;
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-100%) scale(${Math.max(0.45, Math.min(1.4, 40 / p.depth)).toFixed(3)})`;
    };
    const v = nav.view, s = navSummary();
    if (v.step.icon === 'flag') $('#arSign').hidden = true;
    else place($('#arSign'), v.step.at, 3.2, `${svg(v.step.icon)}<b>${s.dist}</b>`);
    place($('#arDest'), total, 4, `${svg('flag')}<b>${esc(nav.dest.name)}</b>`);
  },
  renderCalibration() {
    const row = (k, label, min, max) => `<label class="cal-row"><span>${label}</span>
      <input type="range" min="${min}" max="${max}" step="1" value="${settings[k]}" data-cal="${k}"><b id="cal-${k}">${settings[k]}°</b></label>`;
    $('#arCal').innerHTML = `<h3>Calibrate</h3>
      ${row('arYaw', 'Direction', -45, 45)}${row('arPitch', 'Horizon', -25, 25)}${row('arFov', 'Field of view', 40, 100)}
      <p>Line the blue path up with the road. Direction and horizon fix a crooked mount; field of view matches your camera.</p>
      <button class="big-btn accent" data-ar="calDone">Done</button>`;
  },
};
$('#arCal').addEventListener('input', e => {
  const k = e.target.dataset.cal; if (!k) return;
  settings[k] = +e.target.value; $('#cal-' + k).textContent = e.target.value + '°'; store.set('settings', settings);
});

/* ============================================================
   Overlay input
   ============================================================ */
const OVERLAY = {
  exit: exitOverlay,
  end: () => { endNav(); toast('Route ended'); },
  mirror: () => { settings.hudMirror = !settings.hudMirror; store.set('settings', settings); HUD.render(); },
  cal: () => { $('#arCal').hidden = !$('#arCal').hidden; },
  calDone: () => { $('#arCal').hidden = true; },
};
for (const id of ['hud', 'ar']) {
  $('#' + id).addEventListener('click', e => {
    const b = e.target.closest('[data-ar]');
    if (b) { OVERLAY[b.dataset.ar]?.(); e.stopPropagation(); }
    autoHide($(`#${id}Ctl`));
  });
}
document.addEventListener('click', e => {
  if (!$('#modeMenu').hidden && !e.target.closest('#modeMenu,#modeBtn')) closeModeMenu();
});
renderModeButton();

// Start-up mode from the URL (e.g. ?demo=1&nav=1&mode=ar) or the last map mode.
if (qs.get('mode')) setMode(qs.get('mode'));
else if (mapMode === '3d') setMapMode('3d');
