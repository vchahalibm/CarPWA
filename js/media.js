'use strict';
/* ============================================================
   Media widgets, each can be added more than once with its own source:
   - Document: PDF (drawn here with pdf.js, page by page), PowerPoint, Word
     and Excel by link (Microsoft's online viewer), SharePoint and OneDrive
     links, Google Slides/Docs embed links.
   - Video: YouTube (privacy-enhanced player) or a video file or link.
   - Web page: any page that allows being shown inside another app.
   - 3D model: glTF/GLB, rotate and zoom (Google's model-viewer).
   A source is a link or a file from the device; files are kept in the
   app's own storage (IndexedDB). Loaded after radio.js.
   ============================================================ */
const PDFJS = 'vendor/pdfjs/', PPTX = 'vendor/pptx/', MODEL_VIEWER = 'vendor/model-viewer/model-viewer-umd.min.js';
// 3D models that come with the app (see vendor/models/LICENSE.md). A 3D widget with no link or file shows the first one.
const BUILTIN_MODELS = {
  vita: { name: 'Vita', note: 'anime-style assistant: talks with lip-sync, blinks, looks at you, gestures', src: 'vendor/models/vita.vrm', vrm: true },
  ren: { name: 'Ren', note: 'anime-style male assistant: talks with lip-sync, blinks, looks at you, gestures', src: 'vendor/models/ren.vrm', vrm: true },
  robot: { name: 'Assistant robot', note: 'waves, nods and reacts to what happens', src: 'vendor/models/robot-expressive.glb', avatar: true },
};
Bus.define('doc.page', 'A document changes page', 'the page number');
Bus.define('video.ended', 'A video ends', 'the video’s link');

/* Files from the device, in IndexedDB (localStorage is far too small for them). */
const Files = {
  db() {
    return this._db ||= new Promise((res, rej) => {
      const r = indexedDB.open('dd-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, f) {
    const d = await this.db();
    return new Promise((res, rej) => { const t = d.transaction('f', mode), q = f(t.objectStore('f')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  },
  put(key, blob) { navigator.storage?.persist?.().catch(() => {}); return this.tx('readwrite', s => s.put(blob, key)); },
  get(key) { return this.tx('readonly', s => s.get(key)); },
  del(key) { if (this.urls[key]) { URL.revokeObjectURL(this.urls[key]); delete this.urls[key]; } return this.tx('readwrite', s => s.delete(key)); },
  urls: {},
  async url(key) { if (this.urls[key]) return this.urls[key]; const b = await this.get(key); return b ? (this.urls[key] = URL.createObjectURL(b)) : null; },
};

const ext = s => (String(s || '').split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
/** YouTube link → { id } or { list }, with a start time. */
function youtube(u) {
  try {
    const x = new URL(u), h = x.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (h === 'youtu.be') id = x.pathname.slice(1);
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) id = x.searchParams.get('v') || (x.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/) || [])[1];
    else return null;
    const list = x.searchParams.get('list'), t = parseInt(x.searchParams.get('t') || x.searchParams.get('start') || '0', 10) || 0;
    return id || list ? { id, list, t } : null;
  } catch { return null; }
}
const isOffice = e => /^(pptx?|ppsx?|docx?|xlsx?|odp|odt|ods)$/.test(e);
const isMs = u => /(^|\.)sharepoint\.com$|(^|\.)onedrive\.live\.com$|^1drv\.ms$/.test((() => { try { return new URL(u).hostname; } catch { return ''; } })());

const MEDIA_KINDS = {
  doc: { name: 'Document', icon: 'doc', accept: '.pdf,application/pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', hint: 'A PDF or PowerPoint (.pptx) from this device or a link: both are drawn here, so voice commands, links and scripts can turn the pages, and the assistant can read a slide’s speaker notes. PowerPoint is drawn without animations, transitions or video (save as PDF for an exact copy). Word or Excel by link (SharePoint, OneDrive or any public link); Google Slides “publish to web” links.' },
  video: { name: 'Video', icon: 'play', accept: 'video/*', hint: 'A YouTube link (video, short, live or playlist), a video link (.mp4, .webm, .m3u8) or a video from this device.' },
  web: { name: 'Web page', icon: 'globe', accept: '', hint: 'Any web address. Many big sites (Google, banks, most news) refuse to be shown inside another app: use Open for those.' },
  model: { name: '3D model', icon: 'cube', accept: '.glb,.gltf,.vrm,model/gltf-binary,model/gltf+json', hint: 'A glTF model (.glb or .gltf) or a VRM avatar (.vrm: it talks with lip-sync and reacts like the built-in one), as a file from this device or a link. Leave both empty for a built-in model.' },
};

const Media = {
  pdf: {}, // id → { doc, page, pages, rendering }
  /** The first widget of a type on the dashboard, for voice and link actions. */
  first(kind) { return widgetIds().find(i => wtype(i) === kind) || null; },
  html(id) {
    const k = wtype(id), c = Wcfg.get(id), K = MEDIA_KINDS[k];
    return `<div class="mw mw-${k}" data-media="${esc(id)}"><div class="mw-body"><div class="mw-empty">${svg(K.icon)}<b>${esc(c.title || K.name)}</b>
        <span>${c.url || c.file || k === 'model' ? 'Loading…' : 'Nothing chosen yet'}</span>${c.url || c.file || k === 'model' ? '' : `<button class="w-cta" data-media-cfg="${esc(id)}">Choose</button>`}</div></div>
      ${k === 'doc' ? `<div class="mw-bar" data-pdfbar hidden><button class="ctl" data-mact="prev:${esc(id)}" aria-label="Previous page">${svg('back')}</button>
        <span class="mw-page" data-pdfpage></span><button class="ctl" data-mact="next:${esc(id)}" aria-label="Next page">${svg('back').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button></div>` : ''}
      ${c.url && k !== 'model' ? `<button class="mw-open" data-mact="open:${esc(id)}" aria-label="Open outside DriveDeck">${svg('expand')}</button>` : ''}</div>`;
  },
  /** Fill every media widget on the dashboard with its content. */
  mountAll() { $$('#dashRoot .mw[data-media]').forEach(el => this.mount(el.dataset.media, el)); },
  async mount(id, el = $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`)) {
    if (!el) return;
    const k = wtype(id), c = Wcfg.get(id), body = $('.mw-body', el);
    const builtin = k === 'model' && !c.url && !c.file ? BUILTIN_MODELS[c.builtin] || Object.values(BUILTIN_MODELS)[0] : null;
    if (!c.url && !c.file && !builtin) return;
    let src = builtin ? builtin.src : c.url;
    try { if (c.file) src = await Files.url(c.file.key); } catch (e) { Log.e('media', 'Stored file unreadable', e); }
    if (!src) return this.problem(body, 'The file isn’t on this device any more. Choose it again.', id);
    Log.i('media', `Showing ${k}`, { id, src: c.file ? `file: ${c.file.name}` : src });
    try {
      if (k === 'doc') return await this.doc(id, el, body, src, c);
      if (k === 'video') return await this.video(id, body, src, c);
      if (k === 'web') return this.frame(body, src, 'web');
      if (k === 'model') {
        const vrm = builtin ? builtin.vrm : ext(c.file?.name || c.url) === 'vrm';
        if (vrm && typeof VrmAvatar === 'undefined') return; // drawn before avatar.js has loaded (at start-up): the next redraw mounts it
        return await (vrm ? VrmAvatar.mount(id, body, src) : this.model(body, src, builtin));
      }
    } catch (e) { Log.e('media', `${k} failed`, e); this.problem(body, k === 'doc' ? 'This document couldn’t be opened here. The site may not allow it: try Open.' : 'This couldn’t be shown here.', id); }
  },
  problem(body, msg, id) { body.innerHTML = `<div class="mw-empty">${svg('alert')}<span>${esc(msg)}</span><button class="w-cta" data-media-cfg="${esc(id)}">Change</button></div>`; },
  frame(body, src, kind) {
    body.innerHTML = `<iframe class="mw-frame" src="${esc(src)}" title="${kind}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen
      ${kind === 'web' ? 'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-downloads"' : ''}></iframe>`;
    return $('iframe', body);
  },

  /* ---------- Documents ---------- */
  async doc(id, el, body, src, c) {
    const e = ext(c.file?.name || src), pdf = c.file ? /pdf/.test(c.file.type) || e === 'pdf' : e === 'pdf';
    if (pdf) return this.pdfShow(id, el, body, src);
    if (e === 'pptx' && !isMs(src)) {
      try { return await this.pptxShow(id, el, body, src); }
      catch (err) { if (c.file) throw err; Log.w('media', 'PowerPoint link couldn’t be read here: Microsoft’s viewer instead', err); } // e.g. the site doesn't allow it (CORS)
    }
    if (c.file) return this.problem(body, 'Word and Excel files from this device can’t be shown here: save the file as PDF, or use a SharePoint or OneDrive link.', id);
    this.frame(body, this.docUrl(src), 'doc');
  },
  /** PowerPoint, drawn here with PptxViewJS (vendor/pptx, loaded on first use). Pages work like a PDF's (Media.go). */
  pptxLib() {
    const add = f => new Promise((res, rej) => { const s = document.createElement('script'); s.src = PPTX + f; s.onload = res; s.onerror = () => rej(new Error('Couldn’t load ' + f)); document.head.appendChild(s); });
    return (this.pptxLoad ||= (async () => {
      if (!window.JSZip) await add('jszip.min.js');
      if (!window.Chart) await add('chart.umd.min.js');
      if (!window.PptxViewJS) await add('PptxViewJS.min.js');
      return window.PptxViewJS;
    })().catch(e => { this.pptxLoad = null; throw e; }));
  },
  async pptxShow(id, el, body, src) {
    const lib = await this.pptxLib(), P = this.pdf[id] ||= { page: store.get('docPages', {})[id] || 1 };
    if (P.src !== src) { // one load per file, even when the widget is drawn twice meanwhile
      if (P.loading?.src !== src) P.loading = Object.assign((async () => {
        const buf = await (await fetch(src)).arrayBuffer(), t = performance.now();
        const v = new lib.PPTXViewer({ backgroundColor: '#ffffff' }); await v.loadFile(buf);
        const notes = await this.pptxNotes(buf).catch(e => { Log.w('media', 'Speaker notes unreadable', e); return []; });
        P.viewer?.destroy?.(); Object.assign(P, { viewer: v, kind: 'pptx', src, pages: v.getSlideCount(), notes });
        Log.i('media', `PowerPoint ready ${Math.round(performance.now() - t)} ms`, { slides: P.pages, notes: notes.filter(Boolean).length });
      })().finally(() => { P.loading = null; }), { src });
      await P.loading;
    }
    body.innerHTML = '<canvas class="mw-pdf"></canvas>';
    $('[data-pdfbar]', el).hidden = P.pages < 2;
    await this.pdfDraw(id);
  },
  /** Speaker notes per slide, in slide order (ppt/presentation.xml → slides → their notes pages). */
  async pptxNotes(buf) {
    const z = await window.JSZip.loadAsync(buf), xml = async f => new DOMParser().parseFromString(await z.file(f)?.async('string') || '<x/>', 'application/xml');
    const rels = async f => Object.fromEntries([...(await xml(f)).getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const pres = await xml('ppt/presentation.xml'), pr = await rels('ppt/_rels/presentation.xml.rels');
    const ids = [...pres.getElementsByTagName('p:sldId')].map(s => s.getAttribute('r:id'));
    return Promise.all(ids.map(async rid => {
      const slide = (pr[rid] || '').replace(/^\/?(ppt\/)?/, ''), name = slide.split('/').pop();
      const target = Object.values(await rels(`ppt/slides/_rels/${name}.rels`)).find(t => /notesSlide/.test(t)); if (!target) return '';
      const notes = await xml('ppt/notesSlides/' + target.split('/').pop());
      // The notes body is the placeholder of type "body"; the slide image and number are other shapes.
      return [...notes.getElementsByTagName('p:sp')].filter(sp => [...sp.getElementsByTagName('p:ph')].some(ph => ph.getAttribute('type') === 'body'))
        .map(sp => [...sp.getElementsByTagName('a:p')].map(p => [...p.getElementsByTagName('a:t')].map(t => t.textContent).join('')).join('\n')).join('\n').trim();
    }));
  },
  /** Resolves true once a document widget has its PDF or PowerPoint loaded (false after 10 s, or for other documents). */
  async ready(id) {
    for (let t = 0; t < 100; t++) {
      const P = this.pdf[id]; if (P?.pages && (P.doc || P.viewer) && !P.loading) return true;
      const c = Wcfg.get(id); if (!c.url && !c.file) return false;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  },
  /** Show a page in a web widget. Same page: nothing. Already showing a page: navigate its frame (no dashboard redraw, the rest keeps playing). */
  webOpen(id, url) {
    const c = Wcfg.get(id), f = $(`#dashRoot .mw[data-media="${CSS.escape(id)}"] iframe`);
    if (c.url === url && !c.file) return;
    Wcfg.set(id, { url, file: null });
    if (f && !c.file) { f.src = url; Dash.lastKey = Dash.key(); Log.i('media', 'Web page', { id, url }); }
    else Dash.render();
  },
  /** The current slide's speaker notes (PowerPoint), for the assistant to present. */
  notes(id) { const P = this.pdf[id]; return P?.notes?.[(P.page || 1) - 1] || ''; },
  /** How to show a document link: SharePoint/OneDrive in their embed view, other Office files through Microsoft's viewer. */
  docUrl(src) {
    if (isMs(src)) { try { const u = new URL(src); if (!/1drv\.ms$/.test(u.hostname)) u.searchParams.set('action', 'embedview'); return u.href; } catch { return src; } }
    if (isOffice(ext(src))) return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(src)}`;
    return src;
  },
  async pdfLib() {
    if (this.lib) return this.lib;
    const base = new URL(PDFJS, document.baseURI).href;
    const lib = await import(base + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    return (this.lib = lib);
  },
  async pdfShow(id, el, body, src) {
    const lib = await this.pdfLib(), P = this.pdf[id] ||= { page: store.get('docPages', {})[id] || 1 };
    if (P.src !== src) { P.doc?.destroy(); P.doc = await lib.getDocument({ url: src, standardFontDataUrl: new URL(PDFJS + 'standard_fonts/', document.baseURI).href }).promise; P.src = src; P.pages = P.doc.numPages; }
    body.innerHTML = '<canvas class="mw-pdf"></canvas>';
    $('[data-pdfbar]', el).hidden = P.pages < 2;
    await this.pdfDraw(id);
  },
  async pdfDraw(id) {
    const P = this.pdf[id], el = $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`); if (!(P?.doc || P?.viewer) || !el) return;
    const cv = $('.mw-pdf', el), box = $('.mw-body', el); if (!cv) return;
    P.page = Math.max(1, Math.min(P.pages, P.page));
    $('[data-pdfpage]', el).textContent = `${P.page} / ${P.pages}`;
    const token = P.token = (P.token || 0) + 1;
    if (P.kind === 'pptx') {
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(box.clientWidth * dpr); cv.height = Math.round(box.clientHeight * dpr); cv.style.width = box.clientWidth + 'px'; cv.style.height = box.clientHeight + 'px';
      const page = P.page;
      return (P.drawing = (P.drawing || Promise.resolve()).then(() => token === P.token && cv.isConnected && cv.width && P.viewer.renderSlide(page - 1, cv))
        .catch(e => Log.w('media', 'Slide not drawn', { page, error: e.message })));
    }
    const page = await P.doc.getPage(P.page); if (token !== P.token) return;
    const v1 = page.getViewport({ scale: 1 }), fit = Math.min(box.clientWidth / v1.width, box.clientHeight / v1.height) || 1, dpr = Math.min(2, devicePixelRatio || 1);
    const vp = page.getViewport({ scale: fit * dpr });
    cv.width = vp.width; cv.height = vp.height; cv.style.width = `${vp.width / dpr}px`; cv.style.height = `${vp.height / dpr}px`;
    P.task?.cancel(); P.task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
    try { await P.task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') throw e; }
  },
  go(id, to) {
    const P = this.pdf[id]; if (!P?.doc && !P?.viewer) return false;
    const n = Math.max(1, Math.min(P.pages, to)); if (n === P.page) return true;
    // The page is kept outside Wcfg: a page turn mustn't make the dashboard redraw.
    P.page = n; store.set('docPages', { ...store.get('docPages', {}), [id]: n }); this.pdfDraw(id); Bus.emit('doc.page', { value: String(n), id });
    return true;
  },

  /* ---------- Video ---------- */
  async video(id, body, src, c) {
    const y = !c.file && youtube(src);
    if (y) {
      const q = new URLSearchParams({ playsinline: 1, rel: 0, enablejsapi: 1, ...(y.t ? { start: y.t } : {}), ...(y.list ? { list: y.list } : {}) });
      if (/^https?:$/.test(location.protocol)) q.set('origin', location.origin);
      const f = this.frame(body, `https://www.youtube-nocookie.com/embed/${y.id || 'videoseries'}?${q}`, 'video');
      f.addEventListener('load', () => f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id, channel: 'widget' }), '*'));
      f.dataset.yt = id;
      return;
    }
    body.innerHTML = `<video class="mw-video" controls playsinline preload="metadata"></video>`;
    const v = $('video', body);
    v.addEventListener('ended', () => Bus.emit('video.ended', { value: c.url || c.file?.name || '', id }));
    if (!c.file && ext(src) === 'm3u8' && !v.canPlayType('application/vnd.apple.mpegurl')) {
      const H = await Radio.hls(); if (H?.isSupported()) { const h = new H(); h.loadSource(src); h.attachMedia(v); return; }
    }
    v.src = src;
  },
  /** Play or pause the first video widget (YouTube through its player API). */
  videoCmd(id, play) {
    const el = $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`); if (!el) return false;
    const v = $('video', el); if (v) { play ? v.play().catch(() => {}) : v.pause(); return true; }
    const f = $('iframe', el); if (!f) return false;
    f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: play ? 'playVideo' : 'pauseVideo', args: [] }), '*');
    return true;
  },

  /* ---------- 3D ---------- */
  async model(body, src, builtin) {
    // One load for all 3D widgets: two loading it at once define the element twice and fail.
    if (!customElements.get('model-viewer')) await (this.mvLoad ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = MODEL_VIEWER; s.onload = res; s.onerror = e => { this.mvLoad = null; rej(e); }; document.head.appendChild(s); }));
    body.innerHTML = builtin?.avatar
      // An avatar faces you and stands still (no spinning), idling until something happens.
      ? `<model-viewer class="mw-model" data-avatar src="${esc(src)}" camera-controls camera-orbit="0deg 80deg 110%" animation-name="Idle" autoplay
          animation-crossfade-duration="350" touch-action="pan-y" interaction-prompt="none" shadow-intensity="0.9" exposure="1.05" alt="${esc(builtin.name)}"></model-viewer>`
      : `<model-viewer class="mw-model" src="${esc(src)}" camera-controls auto-rotate touch-action="pan-y" interaction-prompt="none" shadow-intensity="0.8" exposure="1" alt="3D model"></model-viewer>`;
  },

  /* ---------- Choosing what a widget shows ---------- */
  config(id, isNew) {
    const k = wtype(id), K = MEDIA_KINDS[k], c = Wcfg.get(id);
    sheet(`${K.name} widget`, `<div class="cmd-form">
      <label class="fld"><span>Link</span><input id="mwUrl" type="url" value="${esc(c.url || '')}" placeholder="https://…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      ${K.accept !== '' ? `<div class="mw-file"><button class="big-btn" id="mwPick">${svg('plus')}Choose a file</button><span id="mwFileName">${c.file ? esc(c.file.name) : 'or a file from this device'}</span>
        <input type="file" id="mwFile" accept="${K.accept}" hidden></div>` : ''}
      ${k === 'model' ? `<label class="fld"><span>Or a built-in model (used when there's no link or file)</span><select id="mwBuiltin">${Object.entries(BUILTIN_MODELS).map(([b, m]) => `<option value="${b}" ${(c.builtin || Object.keys(BUILTIN_MODELS)[0]) === b ? 'selected' : ''}>${esc(m.name)} · ${esc(m.note)}</option>`).join('')}</select></label>` : ''}
      <label class="fld"><span>Title (optional)</span><input id="mwTitle" value="${esc(c.title || '')}" placeholder="${K.name}" autocomplete="off"></label>
      <p class="hint">${esc(K.hint)}</p></div>`,
      [['Save', () => this.saveCfg(id)], ...(isNew ? [] : [['Clear', () => this.clearCfg(id)]]), ['Cancel']]);
    let picked = null;
    $('#mwPick')?.addEventListener('click', e => { e.preventDefault(); $('#mwFile').click(); });
    $('#mwFile')?.addEventListener('change', e => { picked = e.target.files[0]; if (picked) { $('#mwFileName').textContent = picked.name; $('#mwUrl').value = ''; } this.picked = picked; });
    this.picked = null;
  },
  async saveCfg(id) {
    const url = $('#mwUrl')?.value.trim() || '', title = $('#mwTitle')?.value.trim() || '', f = this.picked, old = Wcfg.get(id);
    if (url && !/^https:\/\//i.test(url)) { toast('Use a link starting with https://'); return this.config(id); }
    const v = { title, url: f ? '' : url || (old.file ? '' : old.url || '') }; this.resetPage(id);
    if ($('#mwBuiltin')) v.builtin = $('#mwBuiltin').value;
    if (f) {
      const key = `${id}:${Date.now()}`;
      try { await Files.put(key, f); } catch (e) { Log.e('media', 'Saving the file failed', e); return toast('Couldn’t keep that file on this device'); }
      if (old.file) Files.del(old.file.key).catch(() => {});
      v.file = { key, name: f.name, type: f.type, size: f.size };
    } else if (url) { if (old.file) Files.del(old.file.key).catch(() => {}); v.file = null; }
    else v.file = old.file || null;
    delete this.pdf[id];
    Wcfg.set(id, v); Log.i('media', 'Widget source set', { id, url: v.url, file: v.file?.name });
    Dash.render();
  },
  clearCfg(id) { const c = Wcfg.get(id); if (c.file) Files.del(c.file.key).catch(() => {}); delete this.pdf[id]; Wcfg.set(id, { url: '', file: null, title: '' }); this.resetPage(id); Dash.render(); },
  resetPage(id) { const p = store.get('docPages', {}); delete p[id]; store.set('docPages', p); },
  openOutside(id) { const c = Wcfg.get(id); if (c.url) openExternal(null, wtype(id) === 'doc' ? this.docUrl(c.url) : c.url); },
};

for (const [k, K] of Object.entries(MEDIA_KINDS)) W[k] = { name: K.name, multi: true, html: id => Media.html(id), config: (id, isNew) => Media.config(id, isNew) };
Bus.on('dash.rendered', () => Media.mountAll());
Bus.on('dash.resized', () => { clearTimeout(Media.rt); Media.rt = setTimeout(() => Object.keys(Media.pdf).forEach(id => Media.pdfDraw(id)), 150); });
// YouTube player events (with enablejsapi): a video ending.
addEventListener('message', e => {
  if (!/youtube(-nocookie)?\.com$/.test((() => { try { return new URL(e.origin).hostname; } catch { return ''; } })())) return;
  let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (d?.event === 'onStateChange' && d.info === 0) Bus.emit('video.ended', { value: Wcfg.get(d.id)?.url || '', id: d.id });
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mact],[data-media-cfg]'); if (!b) return;
  e.stopPropagation();
  if (b.dataset.mediaCfg) return Media.config(b.dataset.mediaCfg);
  const [a, ...rest] = b.dataset.mact.split(':'), id = rest.join(':');
  if (a === 'next' || a === 'prev') Media.go(id, (Media.pdf[id]?.page || 1) + (a === 'next' ? 1 : -1));
  else if (a === 'open') Media.openOutside(id);
}, true);

/* ---------- Actions (voice commands and links) ---------- */
const needs = (kind, say) => { const id = Media.first(kind); if (!id) say(`Add a ${MEDIA_KINDS[kind].name.toLowerCase()} widget first.`); return id; };
Actions.define('doc.next', { group: 'Documents & media', name: 'Next page or slide', arg: '', async run(v, say) { const id = needs('doc', say); if (id && !(await Media.ready(id) && Media.go(id, (Media.pdf[id]?.page || 1) + 1))) say('Page turning works for PDF and PowerPoint documents.'); } });
Actions.define('doc.prev', { group: 'Documents & media', name: 'Previous page or slide', arg: '', async run(v, say) { const id = needs('doc', say); if (id && !(await Media.ready(id) && Media.go(id, (Media.pdf[id]?.page || 1) - 1))) say('Page turning works for PDF and PowerPoint documents.'); } });
Actions.define('doc.page', { group: 'Documents & media', name: 'Go to a page or slide', arg: 'Page number', async run(v, say) { const id = needs('doc', say), n = parseInt(v, 10) || WORD_NUM[v.toLowerCase()];
  if (id && n && !(await Media.ready(id) && Media.go(id, n))) say('Page turning works for PDF and PowerPoint documents.'); } });
Actions.define('doc.notes', { group: 'Documents & media', name: 'Present the slide’s speaker notes', arg: '', async run(v, say) { const id = needs('doc', say); if (id) { await Media.ready(id); return Voice.respond(Media.notes(id) || 'This slide has no speaker notes.'); } } }); // spoken even from a link or script
Actions.define('doc.open', { group: 'Documents & media', name: 'Show a document', arg: 'Link to the document', async run(v, say) { const id = needs('doc', say); if (!id || !v) return;
  if (Wcfg.get(id).url === v && !Wcfg.get(id).file) return Media.ready(id); // already showing it: keep its page (a script going back replays this)
  delete Media.pdf[id]; Media.resetPage(id); Wcfg.set(id, { url: v, file: null }); Dash.render(); await Media.ready(id); } });
Actions.define('video.play', { group: 'Documents & media', name: 'Play the video', arg: '', run(v, say) { const id = needs('video', say); if (id) Media.videoCmd(id, true); } });
Actions.define('video.pause', { group: 'Documents & media', name: 'Pause the video', arg: '', run(v, say) { const id = needs('video', say); if (id) Media.videoCmd(id, false); } });
Actions.define('video.open', { group: 'Documents & media', name: 'Show a video', arg: 'YouTube or video link', run(v, say) { const id = needs('video', say); if (id && v) { Wcfg.set(id, { url: v, file: null }); Dash.render(); } } });
Actions.define('web.open', { group: 'Documents & media', name: 'Show a web page', arg: 'Web address', run(v, say) { const id = needs('web', say); if (id && v) Media.webOpen(id, /^(https?:|\.{0,2}\/|samples\/)/i.test(v) ? v : 'https://' + v); } });
Actions.define('model.open', { group: 'Documents & media', name: 'Show a 3D model', arg: 'Link to a .glb or .gltf', run(v, say) { const id = needs('model', say); if (id && v) { Wcfg.set(id, { url: v, file: null }); Dash.render(); } } });
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, last: 9999 };

/* ---------- The built-in avatar: gestures and expressions in response to what happens ----------
   Gestures are the model's own animations, played once and then back to idling; expressions are its face morph targets
   (Angry, Surprised, Sad), eased in and out. model-viewer has no API for morph targets, so they're set on its three.js scene. */
const Avatar = {
  els: () => $$('#dashRoot model-viewer[data-avatar]').filter(m => m.loaded),
  gesture(name, times = 1) {
    for (const mv of typeof Stage === 'undefined' || Stage.on ? this.els() : []) { // Drive mode: expressions only
      if (!mv.availableAnimations?.includes(name)) continue;
      mv.animationName = name; mv.play({ repetitions: times });
      // Back to idling when it's done: on 'finished', or by the clock if that event is missed (e.g. while hidden).
      const back = () => { clearTimeout(mv.idleT); if (mv.animationName === name) { mv.animationName = 'Idle'; mv.play(); } };
      mv.addEventListener('finished', back, { once: true });
      clearTimeout(mv.idleT); mv.idleT = setTimeout(back, ((mv.duration || 2) * times + 0.4) * 1000);
    }
    Log.d('avatar', `Gesture ${name}`);
    if (typeof VrmAvatar !== 'undefined') VrmAvatar.gesture(name, times);
  },
  face(name, ms = 1600) {
    for (const mv of this.els()) {
      const sym = Object.getOwnPropertySymbols(mv).find(x => x.description === 'scene'), scene = sym && mv[sym];
      const meshes = []; scene?.traverse?.(o => { if (o.morphTargetDictionary && name in o.morphTargetDictionary) meshes.push(o); });
      if (!meshes.length) continue;
      const t0 = performance.now(), step = t => {
        const k = (t - t0) / ms, w = k < 0.2 ? k / 0.2 : k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1; // ease in, hold, ease out
        meshes.forEach(o => { o.morphTargetInfluences[o.morphTargetDictionary[name]] = w; });
        scene.queueRender?.();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    Log.d('avatar', `Face ${name}`);
    if (typeof VrmAvatar !== 'undefined') VrmAvatar.face(name, ms);
  },
};
const SAD = /\b(sorry|couldn’t|couldn't|can’t|isn’t|didn’t|no active|not available|failed|off in settings)\b/i;
Bus.on('voice.listen', () => Avatar.gesture('Wave'));
Bus.on('voice.heard', () => Avatar.gesture('Yes'));
Bus.on('voice.reply', d => { if (SAD.test(d.value || '')) { Avatar.gesture('No'); Avatar.face('Sad', 2200); } else Avatar.gesture('ThumbsUp'); });
Bus.on('camera.alert', () => { Avatar.face('Surprised', 1800); Avatar.gesture('Jump'); });
Bus.on('radio.play', () => Avatar.gesture('Dance', 2));
Bus.on('nav.start', () => Avatar.gesture('ThumbsUp'));
Bus.on('nav.arrive', () => { Avatar.gesture('Wave'); Avatar.face('Surprised', 1200); });
document.addEventListener('click', e => { if (e.target.closest?.('model-viewer[data-avatar]') && !Dash.editing) { Avatar.gesture('Wave'); Avatar.face('Surprised', 900); } });
Actions.define('avatar.gesture', { group: 'Documents & media', name: '3D assistant: gesture', arg: 'Wave, Yes, No, ThumbsUp, Dance or Jump', run: v => Avatar.gesture(cap(v.trim()).replace(/^Thumbsup$/i, 'ThumbsUp') || 'Wave') });
Actions.define('avatar.face', { group: 'Documents & media', name: '3D assistant: expression', arg: 'Surprised, Sad or Angry', run: v => Avatar.face(cap(v.trim()) || 'Surprised') });
if (current === 'dashboard') Dash.render(); // the widget types now exist
