'use strict';
/* ============================================================
   Vision: offline object detection on the rear camera.
   - A detector model runs in its own worker (like Whisper and the reply
     voice), within the memory budget, on 2–5 frames a second, each frame
     shrunk before it's sent (transferred, not copied).
   - The Camera widget shows the camera with boxes; AR mode draws the boxes
     over its camera view too.
   - Spoken alerts for the objects you choose (Settings › Camera & objects),
     and “what do you see?” answered from the latest frames.
   - Models (Settings): YOLOv10 nano (AGPL-3.0, fastest) or D-FINE nano
     (Apache-2.0, more accurate, a little slower). Both know the 80 COCO
     objects: people, vehicles, bikes, animals, traffic lights, stop signs…
     Neither reads speed-limit or other signs.
   Loaded after media.js.
   ============================================================ */
const VISION_MODELS = {
  yolo: { name: 'YOLOv10 nano', license: 'AGPL-3.0', note: 'fastest', repo: 'onnx-community/yolov10n', kind: 'yolo', mb: 9 },
  dfine: { name: 'D-FINE nano', license: 'Apache-2.0', note: 'more accurate, a little slower', repo: 'onnx-community/dfine_n_coco-ONNX', kind: 'pipeline', mb: 15 },
};
// Things worth a spoken alert, offered in Settings (COCO names).
const ALERTABLE = ['person', 'bicycle', 'motorcycle', 'car', 'truck', 'bus', 'dog', 'cow', 'horse', 'traffic light', 'stop sign'];
const DEFAULT_ALERTS = ['person', 'bicycle', 'motorcycle', 'dog', 'cow', 'stop sign'];
Bus.define('camera.detect', 'The camera sees something new', 'what it sees, e.g. “2 cars, a person”');
Bus.define('camera.alert', 'The camera spots an alert object', 'the object, e.g. person');

const VISION_WORKER = `let run;
self.onmessage = async ({ data: m }) => {
  const send = (x, t) => self.postMessage({ ...x, id: m.id }, t || []);
  try {
    if (m.type === 'load') {
      const T = await import(m.url); T.env.allowLocalModels = false;
      if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.numThreads = 1;
      const opts = { device: m.device, dtype: 'fp32', session_options: { enableCpuMemArena: false, enableMemPattern: false }, progress_callback: p => send({ type: 'progress', p }) };
      const toImage = bmp => { const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); bmp.close();
        return new T.RawImage(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 4).rgb(); };
      if (m.kind === 'yolo') {
        const model = await T.AutoModel.from_pretrained(m.repo, opts), proc = await T.AutoProcessor.from_pretrained(m.repo);
        run = async (bmp, thr) => {
          const img = toImage(bmp), { pixel_values, reshaped_input_sizes } = await proc(img), { output0 } = await model({ images: pixel_values });
          const [h, w] = reshaped_input_sizes[0];
          return output0.tolist()[0].filter(p => p[4] >= thr).map(([x0, y0, x1, y1, score, cls]) => ({ label: model.config.id2label[cls], score, box: [x0 / w, y0 / h, x1 / w, y1 / h] }));
        };
      } else {
        const det = await T.pipeline('object-detection', m.repo, opts);
        run = async (bmp, thr) => {
          const img = toImage(bmp);
          return (await det(img, { threshold: thr })).map(d => ({ label: d.label, score: d.score, box: [d.box.xmin / img.width, d.box.ymin / img.height, d.box.xmax / img.width, d.box.ymax / img.height] }));
        };
      }
      send({ type: 'loaded' });
    } else if (m.type === 'detect') {
      const t = performance.now(), dets = await run(m.frame, m.threshold);
      send({ type: 'dets', dets, ms: Math.round(performance.now() - t) });
    }
  } catch (e) { send({ type: 'error', message: String((e && e.message) || e) }); }
};`;

const Vision = {
  worker: null, loading: null, busy: false, last: null, timer: 0, users: new Set(), cooldown: {},
  model() { return VISION_MODELS[settings.detModel] || VISION_MODELS.yolo; },
  /** Load the detector into its own worker (one big load at a time, within the memory budget). */
  load() {
    if (this.worker && this.worker.model !== this.model()) { Log.i('vision', 'Detector model changed: reloading'); this.unload(); }
    if (this.worker) return Promise.resolve(this.worker);
    if (this.loading) return this.loading;
    const M = this.model(), device = gpuOK() ? 'webgpu' : 'wasm';
    if (!Budget.room('detector', Budget.COST.detector, true)) { this.status('Not enough memory for object detection right now'); return Promise.reject(new Error('No memory for the detector')); }
    this.loading = Heavy.run(`detector (${M.name})`, () => Budget.guard(`Detector ${M.name} ${device}`, () => new Promise((res, rej) => {
      const w = new Worker(URL.createObjectURL(new Blob([VISION_WORKER], { type: 'text/javascript' })), { type: 'module' }), s = performance.now();
      const pending = new Map(); let seq = 0;
      w.onmessage = ({ data: m }) => pending.get(m.id)?.(m);
      w.fail = msg => { for (const h of [...pending.values()]) h({ type: 'error', message: msg }); pending.clear(); };
      w.onerror = e => { Log.e('vision', 'Detector worker error', { message: e.message }); e.preventDefault?.(); w.fail(e.message || 'Detector stopped'); };
      w.call = (msg, onProgress, transfer) => new Promise((ok, no) => {
        const id = ++seq; pending.set(id, m => { if (m.type === 'progress') return onProgress?.(m.p); pending.delete(id); m.type === 'error' ? no(new Error(m.message)) : ok(m); });
        w.postMessage({ ...msg, id }, transfer || []);
      });
      w.call({ type: 'load', url: TRANSFORMERS_URL, repo: M.repo, kind: M.kind, device }, p => p.status === 'progress' && p.total && this.status(`Downloading ${M.name} · ${Math.round(p.loaded / 1e6)} of ${Math.round(p.total / 1e6)} MB`))
        .then(() => { Log.i('vision', `Detector ready ${Math.round(performance.now() - s)} ms (${M.name}, ${device})`); Log.mem('detector', `${M.name} ${device}`);
          Budget.add('detector', `${M.name} ${device}`, () => this.unload(), Budget.COST.detector); w.model = M; res(w); },
          e => { w.terminate(); rej(e); });
    })));
    return this.loading.then(w => (this.worker = w), e => { this.loading = null; Log.e('vision', 'Detector failed to load', e); this.status('The object detector couldn’t load'); throw e; });
  },
  unload() {
    this.stopLoop(); try { this.worker?.terminate(); this.worker?.fail('Detector unloaded'); } catch {}
    this.worker = null; this.loading = null; this.busy = false; // a frame in flight would otherwise block the next one for ever
    Budget.drop('detector'); Log.mem('detector', null);
  },

  /* ---------- Who's watching: the Camera widget and/or AR mode ---------- */
  async start(user) {
    this.users.add(user);
    if (user === 'widget') { try { this.stream = await Camera.get('vision'); } catch (e) { Log.w('vision', 'Camera refused', e); this.users.delete(user); this.status(e.name === 'NotAllowedError' ? 'Camera permission is off' : 'Camera unavailable'); return false; } this.attach(); }
    if (!settings.detOn) { this.status('Object detection is off'); return true; }
    try { await this.load(); } catch { return false; }
    this.loop(); return true;
  },
  stop(user) {
    this.users.delete(user);
    if (user === 'widget') { Camera.release('vision'); this.stream = null; this.attach(); }
    if (!this.users.size) { this.stopLoop(); this.last = null; this.paint(); }
  },
  /** The video to read frames from: the widget's own, else AR's. */
  video() { const v = $('#dashRoot .camw video'); return v?.readyState >= 2 ? v : $('#arVideo')?.readyState >= 2 && AR.running ? $('#arVideo') : null; },
  attach() { $$('#dashRoot .camw').forEach(w => w.classList.toggle('mirror', Camera.mirrored)); const s = this.stream || (typeof People !== 'undefined' && People.running ? People.video?.srcObject : null) || null; // people tracking shares the camera
    $$('#dashRoot .camw video').forEach(v => { if (v.srcObject !== s) { v.srcObject = s; s && v.play().catch(() => {}); } }); this.paintWidget(); },
  stopLoop() { clearTimeout(this.timer); this.timer = 0; },
  loop() {
    this.stopLoop();
    const tick = async () => {
      if (!this.users.size || !this.worker) return;
      if (!settings.detOn) { this.last = null; this.paint(); this.status('Object detection is off'); return; }
      const v = this.video();
      if (v && !this.busy && document.visibilityState === 'visible') {
        this.busy = true;
        try {
          const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          const frame = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * scale), resizeHeight: Math.round(v.videoHeight * scale) });
          const r = await this.worker.call({ type: 'detect', frame, threshold: 0.45 }, null, [frame]);
          this.seen(r.dets, r.ms, v);
        } catch (e) { Log.w('vision', 'Detection failed', e); }
        finally { this.busy = false; }
      }
      this.timer = setTimeout(tick, 1000 / (+settings.detFps || 3));
    };
    tick();
  },
  /** A frame's detections: draw them, alert, and tell the app when what's in view changes. */
  seen(dets, ms, v) {
    this.last = { at: Date.now(), dets, ms, w: v.videoWidth, h: v.videoHeight };
    this.paint();
    const sum = this.summary(dets);
    if (sum !== this.lastSum) { this.lastSum = sum; if (sum) Bus.emit('camera.detect', { value: sum, labels: [...new Set(dets.map(d => d.label))] }); }
    if (!settings.detAlerts) return;
    const want = settings.detAlertList || DEFAULT_ALERTS, now = Date.now();
    for (const d of dets) {
      const [x0, y0, x1, y1] = d.box, area = (x1 - x0) * (y1 - y0);
      // Close enough to matter: big in the frame, or anything a traffic light/stop sign.
      if (!want.includes(d.label) || d.score < 0.55 || (area < 0.02 && !/traffic light|stop sign/.test(d.label))) continue;
      if (now - (this.cooldown[d.label] || 0) < 10000) continue;
      this.cooldown[d.label] = now;
      const where = this.side(d.box), msg = `${cap(this.name(d.label))} ${where === 'ahead' ? 'ahead' : `on the ${where}`}.`;
      Log.i('vision', `Alert: ${msg}`, { score: +d.score.toFixed(2), area: +area.toFixed(3) });
      Bus.emit('camera.alert', { value: d.label, where });
      $$('.camw').forEach(el => { el.classList.remove('alert'); void el.offsetWidth; el.classList.add('alert'); });
      if ($('#assistant').hidden && settings.tts !== 'off') Voice.speak(msg); // never talk over the assistant
      break;
    }
  },
  side: ([x0, , x1]) => { const c = (x0 + x1) / 2; return c < 0.36 ? 'left' : c > 0.64 ? 'right' : 'ahead'; },
  name: l => ({ 'traffic light': 'traffic light', 'stop sign': 'stop sign', person: 'person' }[l] || l),
  /** “2 cars, a person and a traffic light” */
  summary(dets, where = false) {
    const g = {};
    for (const d of dets) { const k = where ? `${d.label}|${this.side(d.box)}` : d.label; g[k] = (g[k] || 0) + 1; }
    const parts = Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
      const [l, side] = k.split('|'), word = n === 1 ? (/^[aeiou]/.test(l) ? 'an' : 'a') : n, noun = n === 1 ? l : plural(l);
      return `${word} ${noun}${side ? side === 'ahead' ? ' ahead' : ` on the ${side}` : ''}`;
    });
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
  },
  /** Answer “what do you see?”: from the live view, or a quick look if the camera isn't on. */
  async describe() {
    if (!settings.detAnswer) return 'Answering about the camera is off in Settings.';
    if (!settings.detOn) return 'Object detection is off in Settings.';
    let temp = false;
    if (!this.last || Date.now() - this.last.at > 3000) {
      temp = !this.users.size;
      try {
        this.stream = await Camera.get('look'); const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = this.stream; await v.play();
        await this.load();
        await new Promise(r => setTimeout(r, 400));
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)), frame = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * scale), resizeHeight: Math.round(v.videoHeight * scale) });
        const r = await this.worker.call({ type: 'detect', frame, threshold: 0.45 }, null, [frame]);
        this.last = { at: Date.now(), dets: r.dets, ms: r.ms, w: v.videoWidth, h: v.videoHeight };
        v.srcObject = null;
      } catch (e) { Log.w('vision', 'Quick look failed', e); return 'I can’t see through the camera right now.'; }
      finally { Camera.release('look'); if (!this.users.has('widget')) this.stream = null; if (temp && this.users.size === 0) this.stopLoop(); }
    }
    const s = this.summary(this.last.dets.filter(d => d.score >= 0.5), true);
    return s ? `I can see ${s}.` : 'I don’t see anything I recognise right now.';
  },

  /* ---------- Drawing ---------- */
  status(t) { this.statusText = t; $$('.camw .cam-status').forEach(el => el.textContent = t || ''); },
  paint() {
    $$('#dashRoot .camw').forEach(el => this.drawBoxes($('canvas', el), $('video', el)));
    if (AR.running && settings.detAR) this.drawBoxes($('#arDet'), $('#arVideo'));
    else { const c = $('#arDet'); c?.getContext('2d').clearRect(0, 0, c.width, c.height); }
    const n = this.last?.dets.length || 0;
    if (this.users.size && settings.detOn && this.worker) this.status(n ? `${this.summary(this.last.dets)} · ${this.last.ms} ms` : `Watching · ${this.model().name}`);
  },
  /** Boxes over a video shown with object-fit: cover. */
  drawBoxes(cv, v) {
    if (!cv || !v) return;
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height);
    const L = this.last; if (!L || !L.w || Date.now() - L.at > 2500) return;
    const s = Math.max(cv.width / L.w, cv.height / L.h), ox = (cv.width - L.w * s) / 2, oy = (cv.height - L.h * s) / 2, want = settings.detAlertList || DEFAULT_ALERTS;
    x.lineWidth = 3 * dpr; x.font = `600 ${14 * dpr}px system-ui,sans-serif`; x.textBaseline = 'top';
    for (const d of L.dets) {
      const flip = Camera.mirrored && cv.closest('.camw'); // the video is shown mirrored: boxes follow, labels stay readable
      const [x0, y0, x1, y1] = flip ? [1 - d.box[2], d.box[1], 1 - d.box[0], d.box[3]] : d.box, bx = ox + x0 * L.w * s, by = oy + y0 * L.h * s, bw = (x1 - x0) * L.w * s, bh = (y1 - y0) * L.h * s;
      const col = want.includes(d.label) ? '#ff9f0a' : '#35c8ff';
      x.strokeStyle = col; x.strokeRect(bx, by, bw, bh);
      const t = `${d.label} ${Math.round(d.score * 100)}%`, tw = x.measureText(t).width + 10 * dpr;
      x.fillStyle = col; x.fillRect(bx, Math.max(0, by - 20 * dpr), tw, 20 * dpr); x.fillStyle = '#000'; x.fillText(t, bx + 5 * dpr, Math.max(0, by - 20 * dpr) + 3 * dpr);
    }
  },
  paintWidget() {
    const on = this.users.has('widget') || (typeof People !== 'undefined' && People.running); // people tracking on Stage shows the camera too
    $$('#dashRoot .camw').forEach(el => { el.classList.toggle('on', on); $('.cam-go', el).hidden = on; $('[data-cam="stop"]', el).hidden = !on; });
    this.status(this.users.has('widget') ? (settings.detOn ? (this.worker ? `Watching · ${this.model().name}` : `Loading ${this.model().name}…`) : 'Camera on · object detection is off') : on ? 'Following the presenter' : '');
  },
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = l => ({ person: 'people', bus: 'buses', 'traffic light': 'traffic lights', 'stop sign': 'stop signs' }[l] || l + 's');

/* ---------- The Camera widget ---------- */
W.camera = { name: 'Camera', html: () => `<div class="camw"><video muted playsinline autoplay></video><canvas></canvas><div class="ppl-blur"></div><canvas class="ppl"></canvas>
    <div class="cam-go"><span>${svg('camera')}</span><b>Camera &amp; objects</b><small>${esc(Vision.model().name)} · works offline</small><button class="w-cta" data-cam="start">Start camera</button></div>
    <div class="cam-bar"><span class="cam-status"></span><button class="cam-stop" data-cam="stop" aria-label="Stop the camera" hidden>${svg('close')}</button></div></div>`,
  config: () => openView('settings') };
Bus.on('dash.rendered', () => {
  const has = !!$('#dashRoot .camw');
  if (!has && Vision.users.has('widget')) Vision.stop('widget');
  else if (has) { Vision.attach(); if (store.get('camOn') && !Vision.users.has('widget')) Vision.start('widget'); }
});
Bus.on('ar.start', () => { if (settings.detAR && settings.detOn) Vision.start('ar'); });
Bus.on('ar.stop', () => Vision.stop('ar'));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cam]'); if (!b) return;
  e.stopPropagation();
  if (b.dataset.cam === 'start') { store.set('camOn', true); Vision.start('widget'); }
  else if (b.dataset.cam === 'stop') { store.set('camOn', false); Vision.stop('widget'); }
}, true);
Bus.on('dash.resized', () => Vision.paint());

/* ---------- Actions ---------- */
Actions.define('camera.start', { group: 'Camera', name: 'Start the camera widget', arg: '', run: () => { store.set('camOn', true); Vision.start('widget'); } });
Actions.define('camera.stop', { group: 'Camera', name: 'Stop the camera widget', arg: '', run: () => { store.set('camOn', false); Vision.stop('widget'); } });
Actions.define('camera.describe', { group: 'Camera', name: 'Say what the camera sees', arg: '', async run(v, say) { say(await Vision.describe()); } });
if (current === 'dashboard') Dash.render(); // the widget type now exists
// Settings › Cameras or the mode changed while the widget shows the camera: pick up the new stream.
Bus.on('camera.switch', async () => { if (!Vision.users.has('widget')) return; try { Vision.stream = await Camera.get('vision'); } catch (e) { Log.w('vision', 'Camera refused', e); Vision.stream = null; } Vision.attach(); });
