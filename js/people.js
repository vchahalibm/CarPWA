'use strict';
/* ============================================================
   People on Stage: who is in front of the screen, which one is the
   presenter, and what their hands and face are doing. MediaPipe (hands +
   gestures, body pose, face landmarks with blendshapes) runs in its own
   worker on the Stage camera (front camera or webcam).
   - Claiming: anyone shows the claim sequence (Settings › Mode, e.g. an
     open palm, then a fist) and becomes the presenter. The assistant
     follows them (looks at them), acts on their hand gestures (scripts:
     Swipe_Left = next…) and, with "Only listen to the presenter", only
     takes speech while their mouth is moving. Someone else takes over by
     showing the sequence; the presenter is kept through short occlusions
     (re-found by position and clothing colour). Nothing is stored: it's
     all in memory and gone when tracking stops.
   - The Camera widget on Stage shows it all live: skeletons, hands, face
     boxes, the presenter's halo, claim progress, timings.
   Loaded after script.js.
   ============================================================ */
const MEDIAPIPE = 'vendor/mediapipe/';
Budget.COST.people = 80;
Bus.define('people.claim', 'Someone becomes the presenter (claim gesture)', 'who (a number)');
Bus.define('people.gesture', 'The presenter makes a hand gesture', 'the gesture, e.g. Open_Palm, Swipe_Left');
Bus.define('people.lost', 'The presenter leaves the camera', '');
// Claim sequences offered in Settings: value → [steps, label].
const CLAIM_SEQS = {
  'Open_Palm>Closed_Fist': [['Open_Palm', 'Closed_Fist'], 'Open palm, then fist'],
  'Victory>Open_Palm': [['Victory', 'Open_Palm'], 'Victory sign, then open palm'],
  'Thumb_Up>Open_Palm': [['Thumb_Up', 'Open_Palm'], 'Thumb up, then open palm'],
  'Victory>Closed_Fist': [['Victory', 'Closed_Fist'], 'Victory sign, then fist'],
  'Open_Palm>Closed_Fist>Open_Palm': [['Open_Palm', 'Closed_Fist', 'Open_Palm'], 'Palm, fist, palm'],
};
const GESTURE_WORDS = { Open_Palm: 'open palm', Closed_Fist: 'fist', Pointing_Up: 'pointing up', Thumb_Up: 'thumb up', Thumb_Down: 'thumb down', Victory: 'victory', ILoveYou: 'love you', Swipe_Left: 'swipe left', Swipe_Right: 'swipe right' };
// Skeleton lines for drawing (MediaPipe landmark indices).
const POSE_LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [0, 11], [0, 12]];
const HAND_LINES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

const PEOPLE_WORKER = `
let V, gr, pose, face, info = {}; const small = new OffscreenCanvas(64, 48), sx = small.getContext('2d', { willReadFrequently: true });
const send = (m, t) => self.postMessage(m, t || []);
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') {
      V = await import(m.url + 'vision_bundle.mjs');
      const fs = { wasmLoaderPath: m.url + 'wasm/vision_wasm_module_internal.js', wasmBinaryPath: m.url + 'wasm/vision_wasm_module_internal.wasm' };
      // Its loader expects a classic worker (importScripts) and clears the factory after each task: load the ES module build
      // once here and hand it over before each one.
      const MF = (await import(fs.wasmLoaderPath)).default;
      const make = async (Cls, file, opts, name) => {
        let last; for (const delegate of m.gpu ? ['GPU', 'CPU'] : ['CPU']) {
          try { self.ModuleFactory = MF; const t = await Cls.createFromOptions(fs, { baseOptions: { modelAssetPath: m.url + 'models/' + file, delegate }, runningMode: 'VIDEO', ...opts }); info[name] = delegate; return t; }
          catch (e) { last = e; }
        } throw last;
      };
      gr = await make(V.GestureRecognizer, 'gesture_recognizer.task', { numHands: 4, minHandDetectionConfidence: 0.5 }, 'hands');
      pose = await make(V.PoseLandmarker, 'pose_landmarker_lite.task', { numPoses: 4 }, 'body');
      face = await make(V.FaceLandmarker, 'face_landmarker.task', { numFaces: 4, outputFaceBlendshapes: true }, 'face');
      send({ type: 'loaded', id: m.id, info });
    } else if (m.type === 'frame') {
      const f = m.frame, t = m.t, ms = {}, out = { w: f.width, h: f.height };
      let s = performance.now(); const g = gr.recognizeForVideo(f, t); ms.hands = performance.now() - s;
      s = performance.now(); const p = pose.detectForVideo(f, t); ms.body = performance.now() - s;
      s = performance.now(); const fc = face.detectForVideo(f, t); ms.face = performance.now() - s;
      sx.drawImage(f, 0, 0, 64, 48); const px = sx.getImageData(0, 0, 64, 48).data; f.close();
      // Clothing colour under the shoulders: helps find the presenter again after someone walks past.
      const torso = lm => { const xs = [11, 12, 23, 24].map(i => lm[i]).filter(Boolean); if (xs.length < 2) return null;
        const x0 = Math.min(...xs.map(q => q.x)), x1 = Math.max(...xs.map(q => q.x)), y0 = Math.min(...xs.map(q => q.y)), y1 = Math.max(...xs.map(q => q.y)) ;
        let r = 0, gg = 0, b = 0, n = 0;
        for (let y = Math.max(0, Math.floor(y0 * 48)); y < Math.min(48, Math.ceil(Math.max(y1, y0 + 0.15) * 48)); y++)
          for (let x = Math.max(0, Math.floor(x0 * 64)); x < Math.min(64, Math.ceil(x1 * 64)); x++) { const k = (y * 64 + x) * 4; r += px[k]; gg += px[k + 1]; b += px[k + 2]; n++; }
        return n ? [r / n, gg / n, b / n].map(Math.round) : null; };
      out.hands = (g.landmarks || []).map((lm, i) => ({ lm: lm.map(q => [q.x, q.y]), side: g.handedness?.[i]?.[0]?.categoryName || '',
        g: g.gestures?.[i]?.[0]?.categoryName || 'None', gs: g.gestures?.[i]?.[0]?.score || 0 }));
      out.poses = (p.landmarks || []).map(lm => ({ lm: lm.map(q => [q.x, q.y, q.visibility ?? 1]), sig: torso(lm) }));
      out.faces = (fc.faceLandmarks || []).map((lm, i) => {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0; for (const q of lm) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
        const bs = Object.fromEntries((fc.faceBlendshapes?.[i]?.categories || []).map(c => [c.categoryName, c.score]));
        return { box: [x0, y0, x1, y1], jaw: bs.jawOpen || 0, smile: ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2, brows: bs.browInnerUp || 0 };
      });
      out.ms = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v)]));
      send({ type: 'result', id: m.id, out });
    }
  } catch (e) { try { m.frame && m.frame.close(); } catch {} send({ type: 'error', id: m.id, message: String((e && e.message) || e) }); }
};`;

const People = {
  worker: null, loading: null, running: false, busy: false, tracks: [], nextId: 1, owner: null, ownerSig: null, lostAt: 0,
  last: null, fps: 0, mouth: [], swipe: { at: 0 },
  /** Stage + "Follow the presenter" + the dashboard on screen: run; otherwise stop (camera off, worker ended). */
  sync() {
    const want = typeof Stage !== 'undefined' && Stage.on && settings.peopleOn && current === 'dashboard' && document.visibilityState === 'visible';
    if (want && !this.running) this.start(); else if (!want && this.running) this.stop();
  },
  load() {
    if (this.worker) return Promise.resolve(this.worker);
    if (this.loading) return this.loading;
    Budget.room('people', Budget.COST.people, true);
    const gpu = Diag.get().people !== 'cpu' && (!!navigator.gpu || !!self.WebGL2RenderingContext); // Settings › Logs can force the CPU
    this.loading = Heavy.run('people tracking (MediaPipe)', () => Budget.guard(`People tracking`, () => new Promise((res, rej) => {
      const w = new Worker(URL.createObjectURL(new Blob([PEOPLE_WORKER], { type: 'text/javascript' })), { type: 'module' }), s = performance.now(), pending = new Map(); let seq = 0;
      w.onmessage = ({ data: m }) => { const h = pending.get(m.id); if (h) { pending.delete(m.id); h(m); } };
      w.onerror = e => { Log.e('people', 'People worker error', { message: e.message }); e.preventDefault?.(); for (const h of pending.values()) h({ type: 'error', message: e.message || 'stopped' }); pending.clear(); };
      w.call = (msg, transfer) => new Promise((ok, no) => { const id = ++seq; pending.set(id, m => m.type === 'error' ? no(new Error(m.message)) : ok(m)); w.postMessage({ ...msg, id }, transfer || []); });
      w.call({ type: 'load', url: new URL(MEDIAPIPE, document.baseURI).href, gpu }).then(m => {
        Log.i('people', `People tracking ready ${Math.round(performance.now() - s)} ms`, m.info); Log.mem('people', 'MediaPipe');
        Budget.add('people', 'People tracking (MediaPipe)', () => this.stop(true), Budget.COST.people); w.info = m.info; res(w);
      }, e => { w.terminate(); rej(e); });
    })));
    return this.loading.then(w => (this.worker = w), e => { this.loading = null; Log.e('people', 'People tracking failed to load', e); toast('People tracking couldn’t start here'); throw e; });
  },
  async start() {
    this.running = true;
    try {
      const [stream] = await Promise.all([Camera.get('people'), this.load()]);
      if (!this.running) return Camera.release('people');
      const v = this.video ||= Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
      if (v.srcObject !== stream) { v.srcObject = stream; await v.play().catch(() => {}); }
      Log.i('people', 'Following the room', { camera: Camera.cur });
      this.loop();
    } catch (e) { Log.w('people', 'People tracking not started', e); this.running = false; Camera.release('people'); }
  },
  stop(unload) {
    this.running = false; clearTimeout(this.timer); Camera.release('people');
    if (this.video) this.video.srcObject = null;
    this.tracks = []; this.setOwner(null, 'tracking stopped'); this.ownerSig = null; this.last = null; this.paint();
    if (unload || this.worker) { try { this.worker?.terminate(); } catch {} this.worker = null; this.loading = null; Budget.drop('people'); Log.mem('people', null); }
    VrmAvatar.look?.(null);
  },
  loop() {
    clearTimeout(this.timer);
    if (!this.running) return;
    const v = this.video, tick = async () => {
      if (!this.running) return;
      if (v?.videoWidth && !this.busy && this.worker) {
        this.busy = true; const t0 = performance.now();
        try {
          const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          const frame = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * k), resizeHeight: Math.round(v.videoHeight * k) });
          const r = await this.worker.call({ type: 'frame', frame, t: Math.round(t0) }, [frame]);
          this.fps = this.fps * 0.8 + (1000 / Math.max(1, performance.now() - (this.lastAt || t0))) * 0.2; this.lastAt = performance.now();
          this.seen(r.out, performance.now());
        } catch (e) { Log.w('people', 'Frame failed', e); }
        finally { this.busy = false; }
      }
      this.timer = setTimeout(tick, 70); // ~12 frames a second
    };
    tick();
  },

  /* ---------- Who is who ---------- */
  /** One frame's results → people (a body, with its face and hands), matched to the people already followed. */
  seen(out, now) {
    this.last = out;
    // How long someone may go unseen and still be the same person: longer when frames come slowly (a weak device).
    if (this.prevNow) this.frameMs = (this.frameMs || 80) * 0.7 + Math.min(3000, now - this.prevNow) * 0.3; this.prevNow = now;
    const keep = Math.max(1500, 3 * (this.frameMs || 80));
    const people = out.poses.map(p => {
      const lm = p.lm, vis = lm.filter(q => q[2] > 0.4), xs = vis.map(q => q[0]), ys = vis.map(q => q[1]);
      const c = lm[0][2] > 0.4 ? [lm[0][0], lm[0][1]] : [(lm[11][0] + lm[12][0]) / 2, (lm[11][1] + lm[12][1]) / 2];
      return { c, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], pose: p, sig: p.sig, hands: [], face: null };
    });
    // A hand held up can be mistaken for a face: drop "faces" inside a hand.
    const hb = out.hands.map(h => { const xs = h.lm.map(q => q[0]), ys = h.lm.map(q => q[1]); return [Math.min(...xs) - 0.03, Math.min(...ys) - 0.03, Math.max(...xs) + 0.03, Math.max(...ys) + 0.03]; });
    out.faces = out.faces.filter(f => { const x = (f.box[0] + f.box[2]) / 2, y = (f.box[1] + f.box[3]) / 2; return !hb.some(b => x > b[0] && x < b[2] && y > b[1] && y < b[3]); });
    for (const f of out.faces) { // a face belongs to the body whose head it covers; otherwise it's someone seen from the shoulders up
      const fc = [(f.box[0] + f.box[2]) / 2, (f.box[1] + f.box[3]) / 2];
      let best = null, bd = 0.25; for (const p of people) { const d = Math.hypot(p.c[0] - fc[0], p.c[1] - fc[1]); if (!p.face && d < bd) { best = p; bd = d; } }
      if (best) best.face = f; else people.push({ c: fc, box: f.box, face: f, hands: [], sig: null });
    }
    for (const h of out.hands) { // a hand belongs to the nearest wrist (or the nearest person)
      const w = h.lm[0]; let best = null, bd = 0.35;
      for (const p of people) {
        const d = p.pose ? Math.min(...[15, 16].map(i => Math.hypot(p.pose.lm[i][0] - w[0], p.pose.lm[i][1] - w[1]))) : Math.hypot(p.c[0] - w[0], p.c[1] - w[1]) * 0.8;
        if (d < bd) { best = p; bd = d; }
      }
      (best || (people.push({ c: w, box: [w[0] - 0.1, w[1] - 0.1, w[0] + 0.1, w[1] + 0.1], hands: [], face: null, sig: null }), people.at(-1))).hands.push(h);
    }
    // Match to the people we follow, nearest first.
    const free = new Set(this.tracks.filter(t => now - t.seen < keep));
    for (const p of people) {
      let best = null, bd = 0.22; for (const t of free) { const d = Math.hypot(t.c[0] - p.c[0], t.c[1] - p.c[1]); if (d < bd) { best = t; bd = d; } }
      if (best) { free.delete(best); Object.assign(best, p, { seen: now }); if (p.sig) best.sig = p.sig; }
      else this.tracks.push({ ...p, id: this.nextId++, seen: now, born: now, claim: { step: 0, at: 0, held: 0, g: '' }, held: { g: '', since: 0, sent: '' }, path: [] });
    }
    this.tracks = this.tracks.filter(t => now - t.seen < keep + 2500);
    const here = this.tracks.filter(t => t.seen === now);
    // The presenter: kept while seen; if lost, someone new who looks the same (place and clothes) within 10 s is them again.
    const own = this.tracks.find(t => t.id === this.owner);
    if (this.owner && (!own || now - own.seen > keep)) {
      if (!this.lostAt) { this.lostAt = now; Log.i('people', 'Presenter out of sight'); Bus.emit('people.lost'); }
      const back = here.find(t => t.id !== this.owner && now - t.born < 2500 && this.same(t.sig, this.ownerSig));
      if (back) { Log.i('people', `Presenter found again (#${back.id})`); this.owner = back.id; this.lostAt = 0; }
      else if (now - this.lostAt > 10000) this.setOwner(null, 'left');
    } else if (own) { this.lostAt = 0; if (own.sig) this.ownerSig = own.sig; }
    for (const t of here) this.claimStep(t, now);
    const o = this.tracks.find(t => t.id === this.owner && t.seen === now);
    if (o) { this.gestures(o, now); this.mouth.push([now, o.face?.jaw ?? -1]); }
    this.mouth = this.mouth.filter(m => now - m[0] < 20000);
    // The avatar looks at the presenter, or the nearest face, or ahead.
    const look = o || here.filter(t => t.face).sort((a, b) => (b.face.box[2] - b.face.box[0]) - (a.face.box[2] - a.face.box[0]))[0];
    VrmAvatar.look?.(look ? look.c : null);
    this.paint();
  },
  same(a, b) { return !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 45; },
  /** The claim sequence, per person: each gesture held a quarter of a second, the whole within 3 s. */
  claimStep(t, now) {
    const seq = (CLAIM_SEQS[settings.claimSeq] || CLAIM_SEQS['Open_Palm>Closed_Fist'])[0], c = t.claim;
    const g = t.hands.filter(h => h.gs > 0.55).map(h => h.g).find(x => x === seq[c.step]) || t.hands.find(h => h.gs > 0.55)?.g || 'None';
    if (c.step && now - c.at > Math.max(3000, 4 * (this.frameMs || 80))) Object.assign(c, { step: 0, held: 0 });
    if (g === seq[c.step]) {
      if (c.g !== g) { c.g = g; c.held = now; }
      // Held a quarter of a second (on a slow device one frame already spans that).
      if (now - c.held >= 250 || (this.frameMs || 0) > 400) { c.step++; c.at = now; c.g = ''; if (c.step === seq.length) { c.step = 0; t.held = { g, since: now, sent: g }; if (t.id !== this.owner) this.setOwner(t.id, 'claimed'); } } // the last claim gesture isn't also a command
    } else c.g = g;
  },
  setOwner(id, why) {
    if (this.owner === id) return;
    const was = this.owner; this.owner = id; this.lostAt = 0; this.mouth = [];
    if (id == null) { if (was != null) Log.i('people', `No presenter (${why})`); return; }
    const t = this.tracks.find(x => x.id === id); this.ownerSig = t?.sig || null;
    Log.i('people', `Presenter: #${id} (${why})`, { was });
    Bus.emit('people.claim', { value: String(id) });
    Avatar.gesture('Wave'); Avatar.face('Happy', 1500);
    if (!Script.running && !Voice.rec && !(typeof Convo !== 'undefined' && Convo.active)) Voice.respond(was != null ? 'Hi, I’m with you now.' : 'Hi! I’m following you now.');
  },
  /** The presenter's hand gestures (held a third of a second, once until the hand changes) and swipes. */
  gestures(o, now) {
    const h = o.hands.filter(x => x.gs > 0.6).sort((a, b) => b.gs - a.gs)[0], g = h?.g || 'None', s = o.held;
    if (g !== s.g) { s.g = g; s.since = now; if (g === 'None') s.sent = ''; }
    else if (g !== 'None' && g !== s.sent && now - s.since >= 330) { s.sent = g; this.emit(g); }
    // Swipes: the wrist crossing a quarter of the picture sideways in under 0.6 s. The camera faces you, so moving
    // towards the picture's right is moving to your left.
    const w = o.hands[0]?.lm[0]; if (w) o.path.push([now, w[0], w[1]]);
    o.path = o.path.filter(p => now - p[0] < 600);
    if (o.path.length > 3 && now - this.swipe.at > 1200) {
      const a = o.path[0], b = o.path.at(-1), dx = b[1] - a[1], dy = b[2] - a[2];
      if (Math.abs(dx) > 0.25 && Math.abs(dy) < 0.15) { this.swipe.at = now; o.path = []; this.emit(dx > 0 ? 'Swipe_Left' : 'Swipe_Right'); }
    }
  },
  emit(g) { Log.i('people', `Presenter gesture: ${g}`); Bus.emit('people.gesture', { value: g }); },
  /** Was the presenter's mouth moving for at least a quarter of this time span (performance.now() times)? Unknown → yes. */
  spoke(from, to) {
    const s = this.mouth.filter(m => m[0] >= from - 300 && m[0] <= to && m[1] >= 0); if (s.length < 4) return true;
    let moving = 0; for (let i = 1; i < s.length; i++) if (s[i][1] > 0.12 || Math.abs(s[i][1] - s[i - 1][1]) > 0.04) moving++;
    return moving / (s.length - 1) >= 0.25;
  },

  /* ---------- The Camera widget on Stage: what the models see, live ---------- */
  paint() {
    $$('#dashRoot .camw').forEach(el => {
      const cv = $('canvas.ppl', el), blur = $('.ppl-blur', el), v = $('video', el); if (!cv) return;
      if (this.running && this.video?.srcObject && v && !v.srcObject) Vision.attach();
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); if (blur) blur.innerHTML = '';
      el.classList.toggle('people', this.running);
      const L = this.last; if (!this.running || !L) return;
      const s = Math.max(cv.width / L.w, cv.height / L.h), ox = (cv.width - L.w * s) / 2, oy = (cv.height - L.h * s) / 2, flip = Camera.mirrored;
      const X = v => ox + (flip ? 1 - v : v) * L.w * s, Y = v => oy + v * L.h * s;
      const now = performance.now(), seq = (CLAIM_SEQS[settings.claimSeq] || CLAIM_SEQS['Open_Palm>Closed_Fist'])[0];
      x.lineCap = 'round'; x.font = `700 ${15 * dpr}px system-ui,sans-serif`; x.textBaseline = 'bottom';
      for (const t of this.tracks.filter(t => now - t.seen < 300)) {
        const me = t.id === this.owner, col = me ? '#35c8ff' : 'rgba(255,255,255,.55)';
        x.strokeStyle = col; x.lineWidth = (me ? 4 : 2) * dpr;
        if (t.pose) for (const [a, b] of POSE_LINES) { const p = t.pose.lm[a], q = t.pose.lm[b]; if (p[2] > 0.4 && q[2] > 0.4) { x.beginPath(); x.moveTo(X(p[0]), Y(p[1])); x.lineTo(X(q[0]), Y(q[1])); x.stroke(); } }
        for (const h of t.hands) {
          x.strokeStyle = me ? '#ffd60a' : col; x.lineWidth = 2 * dpr;
          for (const [a, b] of HAND_LINES) { x.beginPath(); x.moveTo(X(h.lm[a][0]), Y(h.lm[a][1])); x.lineTo(X(h.lm[b][0]), Y(h.lm[b][1])); x.stroke(); }
          if (h.g !== 'None' && h.gs > 0.5) { x.fillStyle = me ? '#ffd60a' : '#fff'; x.fillText(`${GESTURE_WORDS[h.g] || h.g} ${Math.round(h.gs * 100)}%`, X(h.lm[0][0]), Y(h.lm[0][1]) + 22 * dpr); }
        }
        if (t.face) {
          const [a, b, c, d] = t.face.box, l = Math.min(X(a), X(c)), w = Math.abs(X(c) - X(a)), top = Y(b), hh = Y(d) - Y(b);
          x.strokeStyle = col; x.lineWidth = (me ? 3 : 1.5) * dpr; x.strokeRect(l, top, w, hh);
          if (me && t.face.jaw > 0.12) { x.fillStyle = '#30d158'; x.fillText('speaking', l, top + hh + 20 * dpr); }
          if (!me && settings.blurOthers && blur) blur.insertAdjacentHTML('beforeend', `<i style="left:${l / dpr}px;top:${top / dpr}px;width:${w / dpr}px;height:${hh / dpr}px"></i>`);
        }
        // Label: the presenter, or who's part-way through the claim sequence
        const lx = Math.min(X(t.box[0]), X(t.box[2])), ly = Y(t.box[1]) - 6 * dpr;
        if (me) { x.fillStyle = '#35c8ff'; x.fillRect(lx, ly - 24 * dpr, x.measureText('Presenter').width + 16 * dpr, 24 * dpr); x.fillStyle = '#000'; x.fillText('Presenter', lx + 8 * dpr, ly - 4 * dpr); }
        else if (t.claim.step) { x.fillStyle = '#ffd60a'; x.fillText(seq.map((g, i) => `${i < t.claim.step ? '✓' : '·'} ${GESTURE_WORDS[g]}`).join('  →  '), lx, ly); }
        else { x.fillStyle = col; x.fillText(`#${t.id}`, lx, ly); }
      }
      const ms = L.ms || {}, inf = this.worker?.info || {};
      x.fillStyle = 'rgba(0,0,0,.6)'; const hud = `Hands ${ms.hands} ms · Body ${ms.body} ms · Face ${ms.face} ms · ${inf.hands === 'GPU' ? 'GPU' : 'CPU'} · ${Math.round(this.fps)} fps`;
      x.font = `600 ${13 * dpr}px system-ui,sans-serif`; const tw = x.measureText(hud).width;
      x.fillRect(8 * dpr, 8 * dpr, tw + 16 * dpr, 24 * dpr); x.fillStyle = '#fff'; x.fillText(hud, 16 * dpr, 27 * dpr); // top left: the status bar is at the bottom
    });
  },
};
// Start and stop with Stage, the setting and the dashboard being on screen.
['mode.change', 'view.open', 'dash.rendered'].forEach(e => Bus.on(e, () => setTimeout(() => People.sync(), 0)));
document.addEventListener('visibilitychange', () => People.sync());
Bus.on('people.gesture', d => { if (typeof Script !== 'undefined') Script.gesture(d.value); });
Bus.on('camera.switch', () => { if (People.running) { People.stop(); People.sync(); } });
Actions.define('people.start', { group: 'Camera', name: 'Follow the presenter (people tracking)', arg: '', run() { settings.peopleOn = true; applySettings(); People.sync(); } });
Actions.define('people.stop', { group: 'Camera', name: 'Stop following people', arg: '', run() { settings.peopleOn = false; applySettings(); People.sync(); } });
Actions.define('people.release', { group: 'Camera', name: 'Let anyone take over (no presenter)', arg: '', run: () => People.setOwner(null, 'released') });
