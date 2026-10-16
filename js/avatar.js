'use strict';
/* ============================================================
   VRM avatars in the 3D widget: an anime-style assistant that talks with
   lip-sync to the reply voice, blinks, breathes, looks at you and gestures
   (waves, nods, shakes its head, thumbs up, dances) and shows expressions,
   reacting to the same app events as the robot. Any .vrm file or link
   works too, so a realistic VRM avatar can be dropped in later.
   - three.js + pixiv's three-vrm, one vendored bundle loaded on first use.
   - Movements come from the motion library (js/motions.js): whole-body
     motions with splined keyframes, every bone on a spring; idle breathing
     and weight shift; hand and head movement while it talks.
   - Lip-sync: the on-device reply voice's own samples (loudness opens the
     mouth, brightness picks the vowel shape); with the phone's voice, which
     can't be read, the mouth moves while it speaks.
   - Drawn only while the dashboard is on screen, at up to 30 frames a second.
   Loaded after media.js.
   ============================================================ */
const AVATAR_LIB = 'vendor/three-vrm/avatar-lib.min.mjs';
Bus.quiet.add('voice.audio');

const VrmAvatar = {
  lib: null, all: new Map(), // widget id → instance
  load() { return (this.lib ||= import(new URL(AVATAR_LIB, document.baseURI).href).catch(e => { this.lib = null; throw e; })); },

  /** Show a VRM in a widget body. An instance survives dashboard redraws: its canvas is moved into the new widget.
      One mount per widget at a time: two at once (redraws at start-up) would each load a copy and leave one behind. */
  mount(id, body, src) {
    const run = (this.mounting.get(id) || Promise.resolve()).then(() => this.mountNow(id, body, src));
    this.mounting.set(id, run.catch(() => {}));
    return run;
  },
  mounting: new Map(),
  async mountNow(id, body, src) {
    const old = this.all.get(id);
    if (old && old.src === src && !old.disposed) { body.replaceChildren(old.canvas); old.resize(); this.run(); return; }
    old?.dispose();
    body.innerHTML = `<div class="mw-empty"><span>Loading the assistant…</span></div>`;
    const L = await this.load();
    if (!Budget.room('avatar', Budget.COST.avatar, true)) { body.innerHTML = `<div class="mw-empty"><span>Not enough memory on this device for the assistant next to the voice right now</span><button class="w-cta" data-media-remount="${esc(id)}">Try again</button></div>`; return; }
    const inst = await Budget.guard(`Avatar ${src.split('/').pop()}`, () => this.create(L, src));
    if (!body.isConnected) { inst.dispose(); return; }
    body.replaceChildren(inst.canvas); inst.id = id; this.all.set(id, inst); inst.resize();
    Budget.add('avatar', 'VRM', () => this.unloadAll(), Budget.COST.avatar);
    Log.mem('avatar', `VRM (${this.all.size})`);
    this.run();
  },
  async create(L, src) {
    const t0 = performance.now(), canvas = document.createElement('canvas');
    canvas.className = 'mw-vrm';
    const renderer = new L.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.outputColorSpace = L.SRGBColorSpace;
    const scene = new L.Scene(), camera = new L.PerspectiveCamera(26, 1, 0.1, 20);
    scene.add(new L.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new L.DirectionalLight(0xffffff, 1.4); sun.position.set(0.6, 1.6, 2.2); scene.add(sun);
    const loader = new L.GLTFLoader(); loader.register(p => new L.VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync(src), vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('Not a VRM model');
    L.VRMUtils.removeUnnecessaryVertices(gltf.scene);
    (L.VRMUtils.combineSkeletons || L.VRMUtils.removeUnnecessaryJoints)?.(gltf.scene);
    L.VRMUtils.rotateVRM0(vrm); // older VRMs face away: turn them to the camera
    vrm.scene.traverse(o => { o.frustumCulled = false; });
    scene.add(vrm.scene);
    const inst = new AvatarInstance({ L, src, canvas, renderer, scene, camera, vrm });
    inst.eye = new L.Object3D(); scene.add(inst.eye); vrm.lookAt && (vrm.lookAt.target = inst.eye); // its eyes follow inst.eye (the viewer, or the presenter)
    inst.rest(); vrm.update(0); inst.calibrate(); inst.frame();
    Log.i('avatar', `Avatar ready ${Math.round(performance.now() - t0)} ms`, { name: vrm.meta?.name || vrm.meta?.title, expressions: Object.keys(vrm.expressionManager?.expressionMap || {}) });
    return inst;
  },
  unloadAll() { for (const i of this.all.values()) i.dispose(true); this.all.clear(); Budget.drop('avatar'); Log.mem('avatar', null); },

  /* ---------- One loop for all avatars ---------- */
  run() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(t => this.tick(t)); } },
  tick(t) {
    this.raf = 0;
    for (const [id, i] of this.all) if (!i.canvas.isConnected && !i.disposed && (i.preview || !$(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`))) { i.dispose(); this.all.delete(id); }
    if (!this.all.size) { Budget.drop('avatar'); return; }
    const on = document.visibilityState === 'visible' && (current === 'dashboard' || [...this.all.values()].some(i => i.preview && i.canvas.isConnected));
    if (on && t - this.last >= 32) { // ~30 fps is plenty, and saves battery
      const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
      for (const i of this.all.values()) if (i.canvas.isConnected && i.canvas.clientWidth && (current === 'dashboard' || i.preview)) i.update(dt, t / 1000);
    } else if (!on) this.last = t;
    this.raf = requestAnimationFrame(x => this.tick(x));
  },
  gesture(name, times) { for (const i of this.all.values()) i.gesture(name, times); },
  /** Point at something on screen: a widget id ('doc~stage'), a widget type ('doc', 'web'), or left / right / up / down.
      Which arm and which way come from where it is relative to the avatar. */
  pointAt(what) {
    const inst = [...this.all.values()].find(i => i.canvas.isConnected); if (!inst) return false;
    const a = inst.canvas.getBoundingClientRect(), w = String(what || '').trim();
    let dx = 0, dy = 0;
    if (/^(left|right|up|down)$/i.test(w)) ({ left: () => dx = -1, right: () => dx = 1, up: () => dy = -1, down: () => dy = 1 })[w.toLowerCase()]();
    else {
      const id = typeof Media !== 'undefined' && !w.includes('~') && Media.first(w) || w, el = $(`#dashRoot [data-wid="${CSS.escape(id)}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect(); dx = (r.left + r.width / 2) - (a.left + a.width / 2); dy = (r.top + r.height / 2) - (a.top + a.height / 2);
    }
    const side = dx <= 0 ? 'Left' : 'Right', n = Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy < 0 ? `PointUp${side}` : `PointDown${side}`) : `Point${side}`;
    Log.i('avatar', `Pointing: ${n}`, { at: w }); this.gesture(n); return n;
  },
  /** Look at someone the camera sees: c = [x, y] in the camera picture (0..1, not mirrored), or null to look ahead. */
  look(c) { this.gaze = c ? { x: (0.5 - c[0]) * 2, y: (0.5 - c[1]) * 2 } : null; },
  face(name, ms) { for (const i of this.all.values()) i.face(name, ms); },
};

/* What the voice is saying right now, for lip-sync: frames of loudness and brightness, 50 a second. */
const Lips = {
  clip: null, phone: false,
  load({ f32, rate, now }) {
    const hop = Math.round(rate / 50), n = Math.ceil(f32.length / hop), rms = new Float32Array(n), zcr = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let s = 0, z = 0; const a = k * hop, b = Math.min(f32.length, a + hop);
      for (let i = a; i < b; i++) { s += f32[i] * f32[i]; if (i > a && (f32[i] >= 0) !== (f32[i - 1] >= 0)) z++; }
      rms[k] = Math.sqrt(s / Math.max(1, b - a)); zcr[k] = z / Math.max(1, b - a);
    }
    const sorted = [...rms].sort((x, y) => x - y), loud = sorted[Math.floor(sorted.length * 0.9)] || 0.1;
    this.clip = { rms, zcr, loud, now, n };
  },
  /** Mouth shapes now: { aa, ih, ou, ee, oh } between 0 and 1. */
  shapes(time) {
    const c = this.clip;
    if (c) {
      const k = Math.floor(c.now() * 50);
      if (k >= 0 && k < c.n) {
        const open = Math.min(1, Math.max(0, c.rms[k] / c.loud - 0.08) * 1.15), z = c.zcr[k];
        // Brighter sounds (more zero crossings) read as i/e, darker as o/u, the rest as a.
        return z > 0.16 ? { ih: open * 0.7, ee: open * 0.5, aa: open * 0.2 } : z < 0.06 ? { oh: open * 0.8, ou: open * 0.4 } : { aa: open * 0.9, oh: open * 0.2 };
      }
    }
    if (this.phone) { const o = Math.max(0, Math.sin(time * 13) * 0.5 + Math.sin(time * 7.3) * 0.3 + 0.25); return { aa: o * 0.7, oh: o * 0.25 }; }
    return {};
  },
};
/** Speaking now (the on-device voice playing, or the phone's voice)? And how loud, 0..1 (for nods and hand beats). */
Lips.speaking = () => !!Lips.clip || Lips.phone;
Lips.level = time => { const c = Lips.clip; if (c) { const k = Math.floor(c.now() * 50); return k >= 0 && k < c.n ? Math.min(1, c.rms[k] / c.loud) : 0; } return Lips.phone ? Math.max(0, Math.sin(time * 9) * 0.5) : 0; };
Bus.on('voice.audio', d => Lips.load(d));
Bus.on('voice.audio.end', () => { Lips.clip = null; });
Bus.on('voice.talk', d => { Lips.phone = !!d.on; });

/* The idle body: arms down and relaxed (VRMs are made in a T-pose), hands softly curled. */
const AVATAR_REST = { leftUpperArm: [0, 0, 1.3], rightUpperArm: [0, 0, -1.3], leftLowerArm: [0, 0.25, 0], rightLowerArm: [0, -0.25, 0], ...handPose('relaxed'), ...handPose('relaxed', 'left') };
/* While the assistant talks: forearms a little forward, the hands moving with the voice. */
const AVATAR_TALK = { ...bothSides({ rightUpperArm: [0, 0.35, -1.18], rightLowerArm: [0, 0.55, 0.45] }), ...handPose('soft'), ...handPose('soft', 'left') };
/* How quickly each part follows where it's meant to be (higher is quicker): hands trail the arms, the body is slowest. */
const springOf = n => /Proximal|Intermediate|Distal/.test(n) ? 18 : /Hand$/.test(n) ? 12 : /LowerArm$/.test(n) ? 10 : /UpperArm|Shoulder/.test(n) ? 8.5 : /head|neck/.test(n) ? 8 : 6.5;

class AvatarInstance {
  constructor(o) { Object.assign(this, o); this.exp = {}; this.target = {}; this.gest = null; this.blinkAt = 2; this.blinkT = -1; this.listening = 0; this.size = ''; this.sp = {}; this.zoom = 1; this.talkW = 0; }
  bone(n) { return this.vrm.humanoid?.getNormalizedBoneNode(n); }
  /** Arms down and relaxed, set at once (no spring): before the first frame. */
  rest() {
    for (const [n, v] of Object.entries(AVATAR_REST)) this.bone(n)?.rotation.set(v[0], v[1], v[2]);
    const hips = this.bone('hips'); if (hips) { this.hipsY ??= hips.position.y; this.hipsX ??= hips.position.x; }
  }
  /** Which way a head turn goes on screen differs between VRM 0 and 1 models: find out once, from the eyes. */
  calibrate() {
    const H = this.vrm.humanoid, head = this.bone('head'), le = H?.getRawBoneNode('leftEye'), re = H?.getRawBoneNode('rightEye'), rh = H?.getRawBoneNode('head');
    this.yaw = 1; if (!head || !le || !re || !rh) return;
    const V = this.L.Vector3, eyesX = () => { this.vrm.update(0); this.scene.updateMatrixWorld(true); const a = new V(), b = new V(), h = new V();
      le.getWorldPosition(a); re.getWorldPosition(b); rh.getWorldPosition(h); return (a.x + b.x) / 2 - h.x; };
    head.rotation.y = 0.4; const x1 = eyesX(); head.rotation.y = 0; const x0 = eyesX();
    this.yaw = x1 > x0 ? 1 : -1;
  }
  /** Frame the head and shoulders, whatever the widget's shape. */
  frame() {
    const head = this.bone('head'); if (!head) return;
    const p = new this.L.Vector3(); head.getWorldPosition(p); this.headY = p.y;
    // From just above the hair to the waist (about 0.9 m tall, 0.75 m wide), fitted to the widget's shape.
    const aspect = Math.max(0.3, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight) || 1), t = Math.tan(this.L.MathUtils.degToRad(this.camera.fov / 2));
    const top = p.y + 0.24, bottom = p.y - 0.66, cy = (top + bottom) / 2;
    const dist = Math.max((top - bottom) / 2 / t, 0.75 / 2 / (t * aspect)) * 1.05;
    this.cam = { y: cy + 0.05, dist, cy }; this.placeCamera();
  }
  /** The camera pulls back a little for wide movements (a motion's zoom), and comes back after. */
  placeCamera() { const c = this.cam; if (!c) return; this.camera.position.set(0, c.y + (this.zoom - 1) * 0.25, c.dist * this.zoom); this.camera.lookAt(0, c.cy + (this.zoom - 1) * 0.22, 0); }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, k = `${w}x${h}`;
    if (!w || !h || k === this.size) return;
    this.size = k; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.frame();
  }
  /** Play a motion from the library (js/motions.js) by name (older gesture names work too); `times` repeats it. */
  gesture(name, times = 1) {
    const n = motionName(name); if (!n) return false;
    const m = MOTIONS[n], body = typeof Stage === 'undefined' || Stage.on; // Drive mode: the face only, nothing moving to catch the driver's eye
    this.gest = { n, m, t: 0, len: m.len * Math.max(1, times), body };
    if (!body && m.face) this.face(Object.keys(m.face)[0] === 'happy' ? 'Happy' : Object.keys(m.face)[0] === 'sad' ? 'Sad' : 'Happy', m.len * 1000);
    return true;
  }
  face(name, ms = 1600) {
    const map = { Happy: ['happy'], Sad: ['sad'], Angry: ['angry'], Surprised: this.has('surprised') ? ['surprised'] : this.has('Surprised') ? ['Surprised'] : ['oh', 'happy'], Relaxed: ['relaxed'] }[name] || [];
    this.mood = { keys: map, until: performance.now() + ms, start: performance.now(), ms };
  }
  has(k) { return !!this.vrm.expressionManager?.getExpression(k); }
  update(dt, time) {
    this.resize();
    const v = this.vrm, em = v.expressionManager, T = {}, add = (n, d, w = 1) => { const c = T[n] ||= [0, 0, 0]; for (let i = 0; i < 3; i++) c[i] += (d[i] || 0) * w; };
    const blend = (n, to, w) => { const c = T[n] ||= [0, 0, 0]; for (let i = 0; i < 3; i++) c[i] += (to[i] - c[i]) * w; };
    // 1. The idle body: rest, breathing, a slow shift of weight, the head drifting a little.
    for (const [n, r] of Object.entries(AVATAR_REST)) T[n] = [...r];
    add('chest', [Math.sin(time * 1.6) * 0.022, 0, 0]);
    const shift = Math.sin(time * 0.42); add('hips', [0, 0, shift * 0.018]); add('spine', [0, 0, -shift * 0.014]);
    add('rightShoulder', [0, 0, Math.sin(time * 1.6) * 0.012]); add('leftShoulder', [0, 0, -Math.sin(time * 1.6) * 0.012]);
    add('head', [Math.sin(time * 0.53) * 0.03, Math.sin(time * 0.37) * 0.06, Math.sin(time * 0.29) * 0.02]);
    let hips = [shift * 0.008, 0], look = null, lookW = 0, zoom = 1, fW = 0;
    if (this.listening > 0) { this.listening -= dt; add('head', [0, 0, 0.12]); add('chest', [-0.05, 0, 0]); }
    // 2. Talking: hands come up and move with the voice; the head nods on the louder syllables.
    const g = this.gest, talking = Lips.speaking(), level = Lips.level(time);
    this.talkW += ((talking && !(g && g.body && g.m.keys?.length) ? 1 : 0) - this.talkW) * Math.min(1, dt * 2.5);
    if (this.talkW > 0.01) {
      const w = this.talkW;
      for (const [n, p] of Object.entries(AVATAR_TALK)) blend(n, p, w * 0.8);
      add('rightLowerArm', [0, Math.sin(time * 1.9) * 0.12, Math.sin(time * 2.3) * 0.14 + level * 0.25], w);
      add('leftLowerArm', [0, -Math.sin(time * 1.7 + 1) * 0.12, -(Math.sin(time * 2.1 + 2) * 0.14 + level * 0.2)], w);
      add('rightHand', [Math.sin(time * 2.6) * 0.18, 0, 0], w); add('leftHand', [Math.sin(time * 2.4 + 1.3) * 0.18, 0, 0], w);
      add('head', [-level * 0.07, Math.sin(time * 0.9) * 0.05, 0], w); add('chest', [0, Math.sin(time * 0.8) * 0.03, 0], w);
    }
    // 3. A motion from the library: its pose over the body (eased in and out), its oscillations, where it looks, its face.
    if (g) {
      g.t += dt; const t = g.m.len ? g.t % g.m.len : g.t, mirror = this.yaw === -1;
      const mp0 = motionAt(g.m, t), osc = motionOsc(g.m, t), rise = smoothstep(Math.min(t / 0.35, (g.m.len - t) / 0.45));
      for (let [n, { v: val, w }] of Object.entries(mp0)) {
        if (n === '$look') { look = mirror ? [-val[0], val[1]] : val; lookW = w; continue; }
        if (n === '$hips') { hips = [hips[0] + val[0] * w, hips[1] + val[1] * w]; continue; }
        if (!g.body && !/^(head|neck)$/.test(n)) continue;
        if (mirror) { const mp = mirrorPose({ [n]: val }); [n] = Object.keys(mp); val = mp[n]; }
        blend(n, val, w);
      }
      for (let [n, d] of Object.entries(osc)) {
        if (n === '$hips') { hips[1] += d[1]; continue; }
        if (!g.body && !/^(head|neck)$/.test(n)) continue;
        if (mirror) { const mp = mirrorPose({ [n]: d }); [n] = Object.keys(mp); d = mp[n]; }
        add(n, d);
      }
      if (g.body) zoom = 1 + ((g.m.zoom || 1) - 1) * rise;
      fW = rise;
      if (g.t >= g.len) this.gest = null;
    }
    // The live pose while capturing a motion (js/mocap.js): it copies you.
    const live = VrmAvatar.live; if (live) for (const [n, v] of Object.entries(live)) T[n] = [...v];
    // 4. Where it looks: a motion's target, else the presenter (Stage, people tracking), else ahead. The head turns part of
    //    the way, the eyes the rest.
    const G = VrmAvatar.gaze, gz = this.gz ||= { x: 0, y: 0 }, want = { x: G ? G.x : 0, y: G ? G.y : 0 };
    if (look) { want.x += (look[0] - want.x) * lookW; want.y += (look[1] - want.y) * lookW; }
    gz.x += (want.x - gz.x) * Math.min(1, dt * 4); gz.y += (want.y - gz.y) * Math.min(1, dt * 4);
    add('head', [gz.y * 0.16, gz.x * 0.42 * this.yaw, 0]); add('neck', [gz.y * 0.06, gz.x * 0.12 * this.yaw, 0]);
    // 5. Every bone follows its target on a critically damped spring: smooth, with the hands trailing the arms.
    for (const [n, tv] of Object.entries(T)) {
      const b = this.bone(n); if (!b) continue;
      const s = this.sp[n] ||= { p: [b.rotation.x, b.rotation.y, b.rotation.z], v: [0, 0, 0] }, w = springOf(n), e = Math.exp(-w * dt);
      for (let i = 0; i < 3; i++) { const y = s.p[i] - tv[i], ny = (y + (s.v[i] + w * y) * dt) * e; s.v[i] = (s.v[i] - w * (s.v[i] + w * y) * dt) * e; s.p[i] = tv[i] + ny; }
      b.rotation.set(s.p[0], s.p[1], s.p[2]);
    }
    for (const n of Object.keys(this.sp)) if (!T[n]) { const s = this.sp[n]; for (let i = 0; i < 3; i++) { s.p[i] *= Math.exp(-6 * dt); s.v[i] = 0; } this.bone(n)?.rotation.set(s.p[0], s.p[1], s.p[2]); }
    const hb = this.bone('hips'); if (hb) { const hs = this.hsp ||= [0, 0]; hs[0] += (hips[0] - hs[0]) * Math.min(1, dt * 6); hs[1] += (hips[1] - hs[1]) * Math.min(1, dt * 7); hb.position.x = this.hipsX + hs[0]; hb.position.y = this.hipsY + hs[1]; }
    this.zoom += (zoom - this.zoom) * Math.min(1, dt * 3); this.placeCamera();
    const cp = this.camera.position; this.eye?.position.set(cp.x + gz.x * 1.6, cp.y + gz.y * 0.6, cp.z);
    // 6. Expressions: the motion's face, a mood, blinking, the mouth.
    const wantE = {};
    if (g?.m.face) for (const [k, w] of Object.entries(g.m.face)) wantE[k] = Math.max(wantE[k] || 0, w * fW);
    if (g?.m.mouth) for (const [k, w] of Object.entries(g.m.mouth)) wantE[k] = Math.max(wantE[k] || 0, w * fW);
    const m = this.mood, now = performance.now();
    if (m && now < m.until) { const k = (now - m.start) / m.ms, w = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1; m.keys.forEach(x => wantE[x] = Math.max(wantE[x] || 0, w * (x === 'oh' ? 0.5 : 0.9))); }
    else if (this.listening > 0) wantE.relaxed = Math.max(wantE.relaxed || 0, 0.4);
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) { this.blinkT = 0; this.blinkAt = 2 + Math.random() * 4; this.blinks = (this.blinks || 0) + 1; }
    if (this.blinkT >= 0) { // a blink takes about 0.16 s, but always at least three frames so slow devices show it
      const len = Math.max(0.16, dt * 3); wantE.blink = Math.sin(Math.min(1, this.blinkT / len) * Math.PI) || 1; this.blinkT += dt; if (this.blinkT > len) this.blinkT = -1; }
    const lips = Lips.shapes(time);
    for (const k of ['aa', 'ih', 'ou', 'ee', 'oh']) wantE[k] = Math.max(wantE[k] || 0, lips[k] || 0);
    if (wantE.happy || wantE.sad) wantE.blink = Math.min(wantE.blink || 0, 0.3); // these close the eyes a little already
    if (em) for (const k of new Set([...Object.keys(this.exp), ...Object.keys(wantE)])) {
      const cur = this.exp[k] || 0, to = wantE[k] || 0, sp = /^(aa|ih|ou|ee|oh|blink)$/.test(k) ? 0.6 : 0.15; // mouth and eyes move fast
      const val = cur + (to - cur) * sp; this.exp[k] = val < 0.001 ? 0 : val;
      if (em.getExpression(k)) em.setValue(k, this.exp[k]);
    }
    v.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
  dispose(evicted) {
    if (this.disposed) return; this.disposed = true;
    try { this.renderer.dispose(); this.renderer.forceContextLoss?.(); } catch {}
    try { this.L.VRMUtils.deepDispose?.(this.vrm.scene); } catch {}
    if (evicted && this.canvas.parentElement) this.canvas.parentElement.innerHTML = `<div class="mw-empty"><span>The assistant was put away to free memory</span><button class="w-cta" data-media-remount="${esc(this.id || '')}">Show again</button></div>`;
  }
}
Budget.COST.avatar = 120;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-media-remount]'); if (b) { e.stopPropagation(); return Media.mountAll(); }
  if (e.target.closest?.('canvas.mw-vrm') && !Dash.editing) { VrmAvatar.gesture('Wave'); VrmAvatar.face('Surprised', 900); }
}, true);
Bus.on('voice.listen', () => { for (const i of VrmAvatar.all.values()) i.listening = 6; });
Bus.on('voice.heard', () => { for (const i of VrmAvatar.all.values()) i.listening = 0; });
Bus.on('voice.idle', () => { for (const i of VrmAvatar.all.values()) i.listening = 0; });
