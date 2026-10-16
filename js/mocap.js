'use strict';
/* ============================================================
   Capture a motion: the camera watches you (MediaPipe pose and hands, the
   people tracker's worker in js/people.js) and the assistant copies you
   live; record a few seconds and it becomes a motion in the library
   (js/motions.js, group "Captured"), for scripts and the motion lists.
   - Each limb's direction comes from MediaPipe's 3D landmarks (metres,
     around the hips); the avatar's bone rotations are solved from the rig
     itself (each bone's rest direction is where its child sits), so it
     works for any VRM model, without hand-tuned angles. The torso turns
     and leans with the shoulders, the head follows the nose and ears,
     fingers curl as yours do. Legs only when they are in the picture.
   - Mirror: the assistant faces you, so by default it copies you like a
     mirror (your right hand moves its left); turn it off to map right to
     right.
   - Captured motions are kept on this device (dd.userMotions), with the
     same keyframe format as the built-in ones.
   Loaded after people.js.
   ============================================================ */
const MP = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28 };
const HAND_FINGERS = [[1, 2, 4], [5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]; // base, middle joint, tip

const Mocap = {
  on: false, rec: null, inst: null, live: null, mirror: true,
  saved: () => store.get('userMotions', {}),
  /** Captured motions join the library at start-up. */
  install() { for (const [k, m] of Object.entries(this.saved())) MOTIONS[k] = { ...m, group: 'Captured' }; },
  save(name, m) { const all = this.saved(); all[name] = m; store.set('userMotions', all); MOTIONS[name] = { ...m, group: 'Captured' }; Log.i('mocap', `Motion saved: ${name}`, { keys: m.keys.length, len: m.len }); },
  remove(name) { const all = this.saved(); delete all[name]; store.set('userMotions', all); delete MOTIONS[name]; },
  rename(from, to) { const all = this.saved(); if (!all[from] || !to || all[to] || MOTIONS[to]) return false; all[to] = { ...all[from], name: to }; delete all[from]; store.set('userMotions', all); delete MOTIONS[from]; MOTIONS[to] = { ...all[to], group: 'Captured' }; return true; },

  /** Follow the camera with avatar `inst` (the preview in Settings): it copies you until stop(). */
  start(inst, { mirror = true } = {}) {
    this.inst = inst; this.mirror = mirror; this.on = true;
    People.hold = true; People.sync(); Log.i('mocap', 'Following the camera', { mirror });
  },
  stop() { this.on = false; this.rec = null; People.hold = false; People.sync(); VrmAvatar.live = null; this.live = null; },
  /** Record `seconds` of what the camera sees; `done(motion)` gets it (or null if nobody was seen). */
  record(seconds, done) { this.rec = { t0: performance.now(), frames: [], len: seconds, done }; },
  /** A frame from the people tracker: the person to copy (the presenter, or the biggest one). */
  frame(track, now) {
    if (!this.on || !this.inst || !track?.pose?.wl?.length) return;
    let pose = null; try { pose = this.solve(track); } catch (e) { Log.w('mocap', 'Pose not solved', e); }
    if (!pose) return;
    VrmAvatar.live = this.live = pose; MotionUI.seen?.(this.seen);
    const R = this.rec; if (!R) return;
    const t = (now - R.t0) / 1000;
    if (t <= R.len) R.frames.push([t, pose]);
    else { this.rec = null; R.done(this.toMotion(R.frames)); }
  },

  /* ---------- From landmarks to the assistant's bones ---------- */
  solve(track) {
    const I = this.inst, V = I.L.Vector3, Q = I.bone('hips').quaternion.constructor, wl = track.pose.wl, lm = track.pose.lm, m = this.mirror;
    const idx = k => MP[m ? k.replace(/^l/, '#').replace(/^r/, 'l').replace(/^#/, 'r') : k]; // mirror: your right is its left
    const P = k => { const q = wl[idx(k)]; return new V(m ? -q[0] : q[0], -q[1], -q[2]); }; // the avatar's space: facing you (+z), its left at +x
    const seen = (...ks) => ks.every(k => (lm[idx(k)]?.[2] ?? 0) > 0.5);
    const out = {};
    // Torso: turned and leaning with the shoulders (half in the spine, half in the chest).
    if (seen('lSh', 'rSh')) {
      const s = P('lSh').sub(P('rSh')), yaw = Math.atan2(-s.z, s.x) * I.yaw, roll = Math.atan2(s.y, Math.hypot(s.x, s.z));
      const mid = P('lSh').add(P('rSh')).multiplyScalar(0.5), hip = seen('lHip', 'rHip') ? P('lHip').add(P('rHip')).multiplyScalar(0.5) : new V(0, 0, 0);
      const up = mid.sub(hip).normalize(), lean = -Math.atan2(up.z, up.y); // forward is x - here
      out.spine = [lean * 0.35, yaw * 0.5, roll * 0.5]; out.chest = [lean * 0.35, yaw * 0.5, roll * 0.5];
    }
    for (const n of ['spine', 'chest']) { const b = I.bone(n); if (b && out[n]) { b.rotation.set(...I.nat(out[n])); b.updateMatrixWorld(true); } }
    // Limbs: point each bone along your segment.
    const aim = (bone, child, dir) => {
      const b = I.bone(bone), c = I.bone(child); if (!b || !c || !b.parent) return;
      b.parent.updateMatrixWorld(true);
      const pq = new Q(); b.parent.getWorldQuaternion(pq);
      const rest = c.position.clone().normalize(), want = dir.clone().normalize().applyQuaternion(pq.invert());
      b.quaternion.setFromUnitVectors(rest, want); b.updateMatrixWorld(true);
      out[bone] = I.nat([b.rotation.x, b.rotation.y, b.rotation.z]); // back to the motions' convention (nat() is its own inverse)
    };
    for (const [side, a, b2, c] of [['right', 'rSh', 'rEl', 'rWr'], ['left', 'lSh', 'lEl', 'lWr']]) {
      if (!seen(a, b2)) continue;
      aim(`${side}UpperArm`, `${side}LowerArm`, P(b2).sub(P(a)));
      if (seen(c)) aim(`${side}LowerArm`, `${side}Hand`, P(c).sub(P(b2)));
    }
    for (const [side, a, b2, c] of [['right', 'rHip', 'rKn', 'rAn'], ['left', 'lHip', 'lKn', 'lAn']]) {
      if (!seen(a, b2, c)) continue;
      aim(`${side}UpperLeg`, `${side}LowerLeg`, P(b2).sub(P(a)));
      aim(`${side}LowerLeg`, `${side}Foot`, P(c).sub(P(b2)));
    }
    // Head: where the nose points from between the ears.
    if (seen('nose', 'lEar', 'rEar')) {
      const f = P('nose').sub(P('lEar').add(P('rEar')).multiplyScalar(0.5)).normalize(), e = P('lEar').sub(P('rEar'));
      out.head = [(Math.asin(Math.max(-1, Math.min(1, f.y))) + 0.3) * 0.8, Math.atan2(f.x, f.z) * I.yaw * 0.8, Math.atan2(e.y, Math.hypot(e.x, e.z)) * 0.6];
    }
    // Hands: the wrist from the hand's direction, the fingers from how much each one bends.
    for (const h of track.hands || []) {
      if (!h.wl?.length || !track.pose.lm) continue;
      const w2 = h.lm[0], dR = Math.hypot(w2[0] - lm[MP.rWr][0], w2[1] - lm[MP.rWr][1]), dL = Math.hypot(w2[0] - lm[MP.lWr][0], w2[1] - lm[MP.lWr][1]);
      let side = dR < dL ? 'right' : 'left'; if (m) side = side === 'right' ? 'left' : 'right';
      const H = i => { const q = h.wl[i]; return new V(m ? -q[0] : q[0], -q[1], -q[2]); };
      if (out[`${side}LowerArm`]) aim(`${side}Hand`, `${side}MiddleProximal`, H(9).sub(H(0)));
      const curls = HAND_FINGERS.map(([a, b2, c], i) => {
        const v1 = (i ? H(a).sub(H(0)) : H(b2).sub(H(a))).normalize(), v2 = H(c).sub(H(i ? a : b2)).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
        return Math.max(0, Math.min(1, (ang - (i ? 0.15 : 0.1)) / (i ? 1.9 : 1.0)));
      });
      Object.assign(out, handCurls(curls, side));
    }
    // Face: MediaPipe's 52 face shapes (ARKit names), as $a: channels; the avatar plays them on its own face (js/avatar.js).
    const bs = track.face?.bs;
    if (bs) for (const [k, v] of Object.entries(bs)) if (v >= 0.05) out[`$a:${m ? k.replace(/Left$/, '#').replace(/Right$/, 'Left').replace(/#$/, 'Right') : k}`] = [v];
    // What it can see, for the panel: body, arms, legs, hands, face.
    this.seen = { body: seen('lSh', 'rSh'), arms: seen('lEl', 'rEl') || seen('lSh', 'lEl') || seen('rSh', 'rEl'), legs: seen('lKn', 'rKn') || seen('lHip', 'lKn'),
      hands: (track.hands || []).filter(h => h.wl?.length).length, face: !!bs };
    return Object.keys(out).length ? out : null;
  },
  /** Recorded frames → a motion: keys every 0.2 s (the spline smooths between them), easing in and out like the built-in ones. */
  toMotion(frames) {
    if (frames.length < 3) return null;
    const keys = [], lead = 0.35; let next = 0;
    for (const [t, p] of frames) if (t >= next) { keys.push([+(t + lead).toFixed(2), Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.map(x => +x.toFixed(3))]))]); next = t + 0.2; }
    const len = +(keys.at(-1)[0] + 0.45).toFixed(2);
    return { name: '', len, keys, captured: new Date().toISOString() };
  },
};
Mocap.install();

/* ---------- Settings › Scripts › Assistant motions: preview the library, capture your own ---------- */
const MotionUI = {
  inst: null, state: 'idle', pending: null, len: 4,
  html() {
    const groups = {}; for (const [k, m] of Object.entries(MOTIONS)) if (!k.startsWith('__')) (groups[m.group || 'Other'] ||= []).push([k, m]);
    const order = ['Captured', 'Greet', 'Present', 'React', 'Body', 'Other'].filter(g => groups[g]);
    return `<div class="mo-stage"><div class="mo-avatar" id="moAvatar"><div class="mw-empty"><span>Loading the assistant…</span></div></div>
      <div class="mo-camw camw on ${Camera.mirrored ? "mirror" : ""}" data-fit="contain" id="moCamWrap" hidden><video id="moCam" muted autoplay playsinline></video><canvas class="ppl"></canvas><div class="mo-parts" id="moParts"></div></div>
      <div class="mo-side" id="moSide">${this.side()}</div></div>
      ${order.map(g => `<details class="mo-group" ${g === 'Captured' || g === 'Greet' ? 'open' : ''}><summary>${esc(g)} <span class="tag">${groups[g].length}</span></summary>
        <div class="mo-list">${groups[g].map(([k, m]) => `<div class="mo-item"><button class="mo-play" data-mo="play:${esc(k)}" aria-label="Preview ${esc(m.name || k)}">${svg('play')}</button>
          <div class="main"><div class="t">${esc(m.name || k)}</div><div class="s">${esc(k)} · ${m.len}s</div></div>
          ${g === 'Captured' ? `<button class="icon-btn" data-mo="ren:${esc(k)}" aria-label="Rename" title="Rename">${svg('sliders')}</button><button class="icon-btn" data-mo="del:${esc(k)}" aria-label="Delete" title="Delete">${svg('del')}</button>` : ''}</div>`).join('')}</div></details>`).join('')}`;
  },
  side() {
    if (this.state === 'live' || this.state === 'count' || this.state === 'rec') return `<div class="mo-status">${this.state === 'live' ? 'Move: the assistant copies you. Ready?' : this.state === 'count' ? `<b class="mo-count">${this.count}</b>` : `<span class="rec-dot"></span> Recording… ${this.left || this.len}s`}</div>
      <div class="chip-row">${this.state === 'live' ? `<button class="chip accent" data-mo="rec"><i class="rec-dot"></i>Record ${this.len}s</button>` : ''}<button class="chip" data-mo="stop">Stop</button></div>`;
    if (this.state === 'done') return `<div class="mo-status">Captured ${this.pending.keys.length} keyframes, ${this.pending.len}s.</div>
      <label class="fld"><span>Name</span><input id="moName" value="My motion ${Object.keys(Mocap.saved()).length + 1}" autocomplete="off"></label>
      <div class="chip-row"><button class="chip" data-mo="replay">${svg('play')}Play</button><button class="chip accent" data-mo="save">Save to the library</button><button class="chip" data-mo="discard">Discard</button></div>`;
    return `<p class="sui-note">Press ▶ on any motion to see it here. Or capture your own: stand in front of the camera (head to waist at least), and the assistant copies you; record a few seconds and save it.</p>
      <p class="sui-note">It captures your body, arms, hands and fingers, legs (when they're in the picture) and your face (brows, eyes, mouth).</p>
      <div class="sui-row"><label class="fld chk"><input type="checkbox" id="moMirror" ${Mocap.mirror ? 'checked' : ''}><span>Like a mirror (your right hand moves its left)</span></label>
        <label class="fld"><span>Length</span><select id="moLen">${[3, 4, 6, 8].map(n => `<option ${n === this.len ? 'selected' : ''} value="${n}">${n} seconds</option>`).join('')}</select></label></div>
      <label class="fld"><span>The assistant</span><select id="moModel">${Object.entries(BUILTIN_MODELS).filter(([, m]) => m.vrm).map(([k, m]) => `<option value="${k}" ${(Wcfg.get('model~stage').builtin || 'vita') === k ? 'selected' : ''}>${esc(m.name)} · ${esc(m.note.split(':')[0])}</option>`).join('')}</select></label>
      <div class="chip-row"><button class="chip accent" data-mo="live"><i class="rec-dot"></i>Capture a motion</button></div>`;
  },
  paint() {
    const el = $('#moSide'); if (el) el.innerHTML = this.side();
    const on = this.state !== 'idle' && this.state !== 'done', w = $('#moCamWrap'); if (w) { w.hidden = !on; w.classList.toggle('mirror', !!Camera.mirrored); }
    if (on) this.cam();
  },
  /** What the camera can follow right now: chips over the picture (body, arms, legs, hands, face). */
  seen(s) {
    const el = $('#moParts'); if (!el || !s) return;
    $('#moCamWrap')?.classList.toggle('mirror', !!Camera.mirrored); // known once the camera runs
    const chip = (ok, label) => `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '·'} ${label}</span>`;
    el.innerHTML = chip(s.body, 'Body') + chip(s.arms, 'Arms') + chip(s.legs, 'Legs') + chip(s.hands, `Hands${s.hands ? ` ${s.hands}` : ''}`) + chip(s.face, 'Face')
      + (s.body && !s.legs ? '<em>Step back to show your legs</em>' : '');
  },
  /** The section opened: show the assistant there. */
  async toggled(open) {
    if (!open) return this.state !== 'idle' ? this.stop() : null;
    const box = $('#moAvatar'); if (!box || typeof VrmAvatar === 'undefined') return;
    const c = Wcfg.get('model~stage'), b = BUILTIN_MODELS[c.builtin]?.vrm ? BUILTIN_MODELS[c.builtin] : Object.values(BUILTIN_MODELS).find(m => m.vrm);
    box.innerHTML = '<div class="mw-empty"><span>Loading the assistant…</span></div>';
    try { await VrmAvatar.mount('preview', box, b.src); this.inst = VrmAvatar.all.get('preview'); if (this.inst) this.inst.preview = true; }
    catch (e) { box.innerHTML = `<div class="mw-empty"><span>The assistant couldn’t load: ${esc(e.message)}</span></div>`; }
  },
  async cam() { for (let i = 0; i < 40; i++) { const v = $('#moCam'), s = People.video?.srcObject; if (v && s) { if (v.srcObject !== s) v.srcObject = s; return; } await pause(150); } },
  cmd(v) {
    const [a, k] = [v.split(':')[0], v.split(':').slice(1).join(':')];
    if (a === 'play') { if (!this.inst) return toast('The assistant is still loading'); this.inst.gesture(k); return; }
    if (a === 'live') {
      if (!this.inst) return toast('The assistant is still loading');
      Mocap.mirror = !!$('#moMirror')?.checked; this.len = +($('#moLen')?.value || 4);
      Mocap.start(this.inst, { mirror: Mocap.mirror }); this.state = 'live'; return this.paint();
    }
    if (a === 'rec') {
      this.state = 'count'; this.count = 3; this.paint();
      const tick = () => { if (this.state !== 'count') return; if (--this.count > 0) { this.paint(); return setTimeout(tick, 1000); }
        this.state = 'rec'; this.left = this.len; this.paint();
        const t = setInterval(() => { if (this.state !== 'rec') return clearInterval(t); this.left = Math.max(0, this.left - 1); const s = $('.mo-status'); if (s) s.innerHTML = `<span class="rec-dot"></span> Recording… ${this.left}s`; }, 1000);
        Mocap.record(this.len, m => { clearInterval(t); Mocap.stop(); if (!m) { toast('Nobody was seen: stand in front of the camera'); this.state = 'idle'; return this.paint(); }
          this.pending = m; this.state = 'done'; this.paint(); this.replay(); });
      };
      return setTimeout(tick, 1000);
    }
    if (a === 'stop') return this.stop();
    if (a === 'replay') return this.replay();
    if (a === 'discard') { this.pending = null; this.state = 'idle'; return this.paint(); }
    if (a === 'save') {
      const name = ($('#moName')?.value || '').trim().replace(/[^\w\s-]/g, '').replace(/\s+(\w)/g, (_, c) => c.toUpperCase()).replace(/\s/g, '') || `Captured${Date.now() % 10000}`;
      if (MOTIONS[name] && !Mocap.saved()[name]) return toast('That name is taken by a built-in motion');
      Mocap.save(name, { ...this.pending, name: ($('#moName')?.value || name).trim() }); this.pending = null; this.state = 'idle';
      toast(`Saved “${name}”: it’s in the motion lists now`); return ScriptUI.render();
    }
    if (a === 'del') return sheet('Delete this motion?', `<p>${esc(k)}</p>`, [['Delete', () => { Mocap.remove(k); ScriptUI.render(); }], ['Cancel']]);
    if (a === 'ren') return sheet('Rename', `<label class="fld"><span>New name</span><input id="moRen" value="${esc(k)}"></label>`, [['Rename', () => { if (!Mocap.rename(k, $('#moRen').value.trim().replace(/\s/g, ''))) toast('Choose another name'); ScriptUI.render(); }], ['Cancel']]);
  },
  replay() { if (!this.pending || !this.inst) return; MOTIONS.__captured = { ...this.pending, group: 'Captured' }; this.inst.gesture('__captured'); },
  stop() { Mocap.stop(); this.state = this.pending ? 'done' : 'idle'; this.paint(); },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-mo]'); if (!b) return; e.stopPropagation(); MotionUI.cmd(b.dataset.mo); }, true);
// Choosing the assistant here changes the Stage's 3D model widget and this preview.
document.addEventListener('change', e => {
  if (e.target.id !== 'moModel') return;
  Wcfg.set('model~stage', { builtin: e.target.value, url: '', file: null }); Log.i('mocap', `Assistant: ${e.target.value}`);
  VrmAvatar.all.get('preview')?.dispose(); VrmAvatar.all.delete('preview'); MotionUI.inst = null; MotionUI.toggled(true);
});
