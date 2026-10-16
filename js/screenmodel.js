'use strict';
/* ============================================================
   The screen model: Microsoft's Florence-2 (base, MIT licence), on the
   device in its own worker (transformers.js, the GPU where there is one),
   so script steps can act on what the screen shows, whatever its code:
   - find(description): "the Search Flight button", "the From field" →
     where it is (phrase grounding on a picture of the window);
   - read(): every piece of text on screen with its place (OCR), which
     also finds text drawn in pictures and canvases (slides, PDFs) where
     the page's own text can't be searched.
   Downloaded on request (Settings › Scripts › Screen understanding, about
   270 MB, kept on the device). Your own detector from tools/trainer
   (UiDetect in js/webdrive.js) is the other, faster model: fixed kinds of
   controls, trained on your screens.
   Loaded after appsteps.js.
   ============================================================ */
const FLORENCE_MODEL = 'onnx-community/Florence-2-base-ft';
Budget.COST.florence = 700;
const FLORENCE_WORKER = `
let T, model, processor, tokenizer;
self.onmessage = async ({ data: m }) => {
  const send = x => self.postMessage({ ...x, id: m.id });
  try {
    if (m.type === 'load') {
      T = await import(m.url);
      const progress_callback = p => p.status === 'progress' && send({ type: 'progress', p: { file: p.file, loaded: p.loaded, total: p.total } });
      const dtype = m.device === 'webgpu' ? { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' } : 'q8';
      model = await T.Florence2ForConditionalGeneration.from_pretrained(m.model, { dtype, device: m.device, progress_callback });
      processor = await T.AutoProcessor.from_pretrained(m.model);
      tokenizer = await T.AutoTokenizer.from_pretrained(m.model);
      send({ type: 'loaded' });
    } else if (m.type === 'run') {
      const image = new T.RawImage(m.pixels, m.w, m.h, 4).rgb();
      const prompts = processor.construct_prompts(m.task + (m.text || ''));
      const t0 = performance.now(), text_inputs = tokenizer(prompts), vision_inputs = await processor(image);
      const ids = await model.generate({ ...text_inputs, ...vision_inputs, max_new_tokens: m.max || 256 });
      const out = tokenizer.batch_decode(ids, { skip_special_tokens: false })[0];
      send({ type: 'result', result: processor.post_process_generation(out, m.task, image.size), ms: Math.round(performance.now() - t0) });
    }
  } catch (e) { send({ type: 'error', message: String((e && e.message) || e) }); }
};`;

/** How much of `want` (words) a read text covers, 0..1: words match when equal or nearly (one letter off, or the same start),
    since reading makes small mistakes ("Dellh" for "Delhi"). */
function wordsMatch(want, got) {
  const W = want.split(' ').filter(Boolean), G = got.split(' ').filter(Boolean); if (!W.length || !G.length) return 0;
  const near = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) || (Math.abs(a.length - b.length) <= 1 && a.length > 4 && [...a].filter((c, i) => c !== b[i]).length <= 1);
  const hit = W.filter(w => G.some(g => near(w, g))).length / W.length, extra = Math.max(0, G.length - W.length) / (G.length + W.length);
  return hit - extra * 0.3;
}
const ScreenAI = {
  worker: null, loading: null, seq: 0,
  get downloaded() { return !!store.get('florenceOK'); },
  async load(show) {
    if (this.worker) { Budget.use('florence'); return this.worker; }
    if (!this.loading && !Budget.room('florence', Budget.COST.florence, show ? 'any' : true)) throw new Error('Not enough memory for the screen model on this device right now');
    return this.loading ||= Heavy.run('screen model (Florence-2)', () => Budget.guard('Screen model Florence-2', async () => {
      const w = new Worker(URL.createObjectURL(new Blob([FLORENCE_WORKER], { type: 'text/javascript' })), { type: 'module' }), pending = new Map();
      w.onmessage = ({ data: m }) => { const h = pending.get(m.id); if (!h) return; if (m.type === 'progress') return h.progress?.(m.p); pending.delete(m.id); m.type === 'error' ? h.no(new Error(m.message)) : h.ok(m); };
      w.onerror = e => { e.preventDefault?.(); for (const h of pending.values()) h.no(new Error(e.message || 'The screen model stopped')); pending.clear(); };
      w.call = (msg, progress, transfer = []) => new Promise((ok, no) => { const id = ++this.seq; pending.set(id, { ok, no, progress }); w.postMessage({ ...msg, id }, transfer); });
      const t0 = performance.now(), device = navigator.gpu ? 'webgpu' : 'wasm', files = {};
      await w.call({ type: 'load', url: TRANSFORMERS_URL, model: FLORENCE_MODEL, device }, p => { files[p.file] = p; this.progress?.(files); });
      store.set('florenceOK', true); Log.i('screen', `Screen model ready ${Math.round(performance.now() - t0)} ms`, { device }); Log.mem('florence', `Florence-2 ${device}`);
      Budget.add('florence', `Florence-2 ${device}`, () => this.unload(), Budget.COST.florence);
      return (this.worker = w);
    })).catch(e => { this.loading = null; Log.e('screen', 'Screen model failed to load', e); throw e; });
  },
  unload() { try { this.worker?.terminate(); } catch {} this.worker = null; this.loading = null; Budget.drop('florence'); Log.mem('florence', null); },
  /** The part of the window to look at: a widget (id or type, e.g. 'web') or all of it. { x, y, w, h } in CSS pixels. */
  area(scope) {
    const id = scope && (scope.includes('~') || W[scope] && !W[scope].multi ? scope : typeof Media !== 'undefined' && Media.first(scope));
    const el = id && $(`#dashRoot [data-wid="${CSS.escape(id)}"]`), r = el?.getBoundingClientRect();
    return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight };
  },
  /** Run a Florence-2 task on a picture of (part of) the window: its result with boxes mapped back to CSS pixels by map(). */
  async run(task, text, scope, shotIn, Ain) {
    const w = await this.load(), shot = shotIn || await AppSteps.screen(), A = Ain || this.area(scope), k = shot.k, s = Math.min(1, 1024 / Math.max(A.w * k, A.h * k));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(A.w * k * s), height: Math.round(A.h * k * s) });
    const x = c.getContext('2d'); x.drawImage(shot.canvas, A.x * k, A.y * k, A.w * k, A.h * k, 0, 0, c.width, c.height);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    const r = await w.call({ type: 'run', task, text, pixels: px, w: c.width, h: c.height }, null, [px.buffer]);
    Log.i('screen', `${task} ${text ? `“${text}” ` : ''}${r.ms} ms`, { scope: scope || 'window' });
    return { result: r.result[task] || r.result, map: (v, i) => (i % 2 ? A.y : A.x) + v / (k * s), A };
  },
  /** Where something described in words is: { pt: [x, y], box } in CSS pixels, or null. */
  async find(description, scope) {
    const d = String(description || '').trim(); if (!d) return null;
    // 1. The words that name it ("the Book menu" → Book), read on screen: most controls are labelled.
    const words = d.replace(/\b(the|a|an|on|in|of|at|to|button|link|menu|tab|field|box|icon|item|option|text|label|area|section|page|logo)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const f = words && await this.readFind(words, scope);
    if (f) return { ...f, how: 'reading' };
    // 2. Grounding: the model boxes what's described (unlabelled things: a logo, a picture). A box over most of the area means it didn't find it.
    const { result, map, A } = await this.run('<CAPTION_TO_PHRASE_GROUNDING>', d, scope);
    const box = result?.bboxes?.[0]?.map(map);
    if (box && (box[2] - box[0]) * (box[3] - box[1]) < A.w * A.h * 0.3) return { pt: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], box, label: result.labels?.[0] || '', how: 'grounding' };
    return null;
  },
  /** Every piece of text on screen: [{ text, box: [x0, y0, x1, y1] }] in CSS pixels. */
  async read(scope) {
    // The model sees 768×768, so small text in a big area is read in four overlapping tiles.
    const shot = await AppSteps.screen(), A = this.area(scope), big = A.w > 700 || A.h > 700, out = [];
    const tiles = big ? [[0, 0], [0.45, 0], [0, 0.45], [0.45, 0.45]].map(([fx, fy]) => ({ x: A.x + A.w * fx, y: A.y + A.h * fy, w: A.w * 0.55, h: A.h * 0.55 })) : [A];
    for (const T of tiles) {
      const { result, map } = await this.run('<OCR_WITH_REGION>', '', scope, shot, T);
      (result?.labels || []).forEach((t, i) => { const q = result.quad_boxes[i].map(map), xs = q.filter((_, j) => j % 2 === 0), ys = q.filter((_, j) => j % 2);
        const text = String(t).replace(/<\/?s>/g, '').trim(), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        if (text && !out.some(o => o.text === text && Math.abs(o.box[0] - box[0]) < 12 && Math.abs(o.box[1] - box[1]) < 12)) out.push({ text, box }); });
    }
    return out;
  },
  /** Text on screen found by reading it (OCR): the best match for `text`, or null. */
  async readFind(text, scope) {
    const q = AppSteps.norm(text); if (!q) return null;
    const hits = (await this.read(scope)).map(r => ({ ...r, score: wordsMatch(q, AppSteps.norm(r.text)) })).filter(r => r.score >= 0.6);
    hits.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    const h = hits[0]; return h ? { pt: [(h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2], box: h.box, text: h.text } : null;
  },
  /** Show what it found (a box for a moment): the test in Settings. */
  mark(box) {
    const d = document.createElement('div'); d.className = 'as-found';
    Object.assign(d.style, { left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2] - box[0]}px`, height: `${box[3] - box[1]}px` });
    document.body.appendChild(d); setTimeout(() => d.remove(), 2500);
  },
  html() {
    const st = this.worker ? 'Loaded' : this.downloaded ? 'Downloaded · loads when a step needs it' : 'Not downloaded';
    return `<div class="sui-models">
      <div class="sui-model"><div class="main"><div class="t">Florence-2 (Microsoft, MIT licence)</div>
        <div class="s">Finds what you describe (“the Search Flight button”) and reads text anywhere on screen, also in slides and pictures. About 270 MB, on this device. ${esc(st)}</div></div>
        <div class="sui-btns">${this.downloaded ? `<button class="mini-btn" data-sm="test">Test</button>` : `<button class="mini-btn accent" data-sm="get">Download</button>`}</div></div>
      ${typeof UiDetect !== 'undefined' ? UiDetect.html() : ''}</div>`;
  },
  async get() {
    toast('Downloading the screen model…');
    this.progress = files => { const v = Object.values(files), l = v.reduce((a, f) => a + (f.loaded || 0), 0), t = v.reduce((a, f) => a + (f.total || 0), 0); const el = $('#smProg'); if (el && t) el.textContent = `${Math.round(l / 1e6)} / ${Math.round(t / 1e6)} MB`; };
    try { await this.load(true); toast('Screen model ready'); } catch (e) { toast(`Couldn’t load the screen model: ${e.message}`); }
    if (typeof ScriptUI !== 'undefined' && ScriptUI.shown) ScriptUI.render();
  },
  test() {
    sheet('Find on screen', `<label class="fld"><span>Describe something on the dashboard</span><input id="smQ" value="the next slide button" autocomplete="off"></label><p class="hint">It looks at the dashboard and marks what it finds.</p>`,
      [['Find', async () => { const q = $('#smQ').value; ScriptUI.shown = false; openView('dashboard'); await pause(500);
        try { const f = await this.find(q); if (f) { this.mark(f.box); ClickDot.show(f.pt[0], f.pt[1]); toast(`Found “${q}”`); } else toast('Not found'); } catch (e) { toast(e.message); }
        setTimeout(() => ScriptUI.open(), 2800); }], ['Cancel']]);
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-sm]'); if (!b) return; e.stopPropagation(); ScreenAI[b.dataset.sm](); }, true);
Actions.define('screen.click', { group: 'Scripts', name: 'Click something described (screen model)', arg: 'What it is, e.g. the Search Flight button', async run(v, say, ev) {
  await AppSteps.play({ t: 'click', loc: { match: { ai: v } } }, { quiet: !!ev?.quiet }); } });
