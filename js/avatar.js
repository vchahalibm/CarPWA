'use strict';
/* ============================================================
   VRM avatars in the 3D widget: an anime-style assistant that talks with
   lip-sync to the reply voice, blinks, breathes, looks at you and gestures
   (waves, nods, shakes its head, thumbs up, dances) and shows expressions,
   reacting to the same app events as the robot. Any .vrm file or link
   works too, so a realistic VRM avatar can be dropped in later.
   - three.js + pixiv's three-vrm, one vendored bundle loaded on first use.
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
    for (const [id, i] of this.all) if (!i.canvas.isConnected && !i.disposed && !$(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`)) { i.dispose(); this.all.delete(id); }
    if (!this.all.size) { Budget.drop('avatar'); return; }
    const on = document.visibilityState === 'visible' && current === 'dashboard';
    if (on && t - this.last >= 32) { // ~30 fps is plenty, and saves battery
      const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;
      for (const i of this.all.values()) if (i.canvas.isConnected && i.canvas.clientWidth) i.update(dt, t / 1000);
    } else if (!on) this.last = t;
    this.raf = requestAnimationFrame(x => this.tick(x));
  },
  gesture(name, times) { for (const i of this.all.values()) i.gesture(name, times); },
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
Bus.on('voice.audio', d => Lips.load(d));
Bus.on('voice.audio.end', () => { Lips.clip = null; });
Bus.on('voice.talk', d => { Lips.phone = !!d.on; });

class AvatarInstance {
  constructor(o) { Object.assign(this, o); this.exp = {}; this.target = {}; this.gest = null; this.blinkAt = 2; this.blinkT = -1; this.listening = 0; this.size = ''; }
  bone(n) { return this.vrm.humanoid?.getNormalizedBoneNode(n); }
  /** Arms down and relaxed (VRMs are made in a T-pose). */
  rest() {
    const set = (n, x, y, z) => { const b = this.bone(n); if (b) b.rotation.set(x, y, z); };
    set('leftUpperArm', 0, 0, 1.3); set('rightUpperArm', 0, 0, -1.3);
    set('leftLowerArm', 0, 0.25, 0); set('rightLowerArm', 0, -0.25, 0);
    ['head', 'neck', 'spine', 'chest', 'hips', 'leftHand', 'rightHand'].forEach(n => set(n, 0, 0, 0));
    const hips = this.bone('hips'); if (hips) hips.position.y = this.hipsY ??= hips.position.y;
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
    this.camera.position.set(0, cy + 0.05, dist); this.camera.lookAt(0, cy, 0);
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, k = `${w}x${h}`;
    if (!w || !h || k === this.size) return;
    this.size = k; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.frame();
  }
  /** A gesture played procedurally on the skeleton for its length, then back to rest. */
  gesture(name, times = 1) {
    const len = { Wave: 1.8, Yes: 1.2, No: 1.3, ThumbsUp: 1.6, Dance: 3.2, Jump: 0.9, Listen: 1.5 }[name];
    if (!len) return;
    const total = len * (name === 'Dance' ? times : 1);
    // Drive mode: expressions only, no moving arms or body to catch the driver's eye (Settings › Mode).
    if (typeof Stage === 'undefined' || Stage.on) this.gest = { name, t: 0, len: total };
    if (name === 'Wave' || name === 'ThumbsUp' || name === 'Dance') this.face('Happy', total * 1000);
    if (name === 'No') this.face('Sad', 1800);
  }
  face(name, ms = 1600) {
    const map = { Happy: ['happy'], Sad: ['sad'], Angry: ['angry'], Surprised: this.has('surprised') ? ['surprised'] : ['oh', 'happy'], Relaxed: ['relaxed'] }[name] || [];
    this.mood = { keys: map, until: performance.now() + ms, start: performance.now(), ms };
  }
  has(k) { return !!this.vrm.expressionManager?.getExpression(k); }
  update(dt, time) {
    this.resize();
    const v = this.vrm, em = v.expressionManager, B = n => this.bone(n);
    this.rest();
    // Breathing and a little sway.
    const chest = B('chest') || B('spine'); if (chest) chest.rotation.x = Math.sin(time * 1.6) * 0.025;
    const head = B('head'), neck = B('neck');
    if (head) { head.rotation.y = Math.sin(time * 0.37) * 0.06; head.rotation.x = Math.sin(time * 0.53) * 0.03; }
    if (this.listening > 0) { this.listening -= dt; if (head) head.rotation.z = 0.12; if (chest) chest.rotation.x += 0.05; }
    // Looking at the presenter (Stage, people tracking): the head turns part of the way, the eyes the rest.
    const G = VrmAvatar.gaze, gz = this.gz ||= { x: 0, y: 0 };
    gz.x += ((G ? G.x : 0) - gz.x) * Math.min(1, dt * 4); gz.y += ((G ? G.y : 0) - gz.y) * Math.min(1, dt * 4);
    if (head) { head.rotation.y += gz.x * 0.45 * this.yaw; head.rotation.x -= gz.y * 0.1; }
    const cp = this.camera.position; this.eye?.position.set(cp.x + gz.x * 1.6, cp.y + gz.y * 0.6, cp.z);
    // Gestures
    const g = this.gest;
    if (g) {
      g.t += dt; const k = g.t / g.len, env = Math.sin(Math.min(1, k) * Math.PI) ** 0.6; // in and out smoothly
      const ru = B('rightUpperArm'), rl = B('rightLowerArm'), lu = B('leftUpperArm'), ll = B('leftLowerArm'), hips = B('hips');
      if (g.name === 'Wave' && ru && rl) { ru.rotation.z = -1.3 + 2.7 * env; ru.rotation.x = -0.2 * env; rl.rotation.z = 0.5 * env + Math.sin(g.t * 11) * 0.45 * env; }
      if (g.name === 'Yes' && head) head.rotation.x += Math.sin(g.t * 11) * 0.22 * env;
      if (g.name === 'No' && head) head.rotation.y += Math.sin(g.t * 12) * 0.32 * env;
      if (g.name === 'ThumbsUp' && ru && rl) { ru.rotation.z = -1.3 + 0.7 * env; ru.rotation.x = -1.0 * env; rl.rotation.y = -0.25 - 1.6 * env; }
      if (g.name === 'Jump' && hips) hips.position.y = this.hipsY + Math.max(0, Math.sin(Math.min(1, k) * Math.PI)) * 0.08;
      if (g.name === 'Dance') {
        const s = Math.sin(g.t * 6.5) * env;
        if (hips) { hips.rotation.y = s * 0.25; hips.position.y = this.hipsY + Math.abs(Math.sin(g.t * 6.5)) * 0.03 * env; }
        if (ru && lu) { ru.rotation.z = -1.3 + (1.0 + s * 0.5) * env; lu.rotation.z = 1.3 - (1.0 - s * 0.5) * env; }
        if (rl && ll) { rl.rotation.y = -0.25 - 1.0 * env; ll.rotation.y = 0.25 + 1.0 * env; }
        if (head) head.rotation.z = s * 0.15;
      }
      if (k >= 1) this.gest = null;
    }
    // Expressions: mood, blink, mouth
    const want = {};
    const m = this.mood, now = performance.now();
    if (m && now < m.until) { const k = (now - m.start) / m.ms, w = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1; m.keys.forEach(x => want[x] = Math.max(want[x] || 0, w * (x === 'oh' ? 0.5 : 0.9))); }
    else if (this.listening > 0) want.relaxed = 0.4;
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) { this.blinkT = 0; this.blinkAt = 2 + Math.random() * 4; this.blinks = (this.blinks || 0) + 1; }
    if (this.blinkT >= 0) { // a blink takes about 0.16 s, but always at least three frames so slow devices show it
      const len = Math.max(0.16, dt * 3); want.blink = Math.sin(Math.min(1, this.blinkT / len) * Math.PI) || 1; this.blinkT += dt; if (this.blinkT > len) this.blinkT = -1; }
    const lips = Lips.shapes(time);
    for (const k of ['aa', 'ih', 'ou', 'ee', 'oh']) want[k] = Math.max(want[k] || 0, lips[k] || 0);
    if (want.happy || want.sad) want.blink = Math.min(want.blink || 0, 0.3); // these close the eyes a little already
    if (em) for (const k of new Set([...Object.keys(this.exp), ...Object.keys(want)])) {
      const cur = this.exp[k] || 0, to = want[k] || 0, sp = /^(aa|ih|ou|ee|oh|blink)$/.test(k) ? 0.6 : 0.15; // mouth and eyes move fast
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
