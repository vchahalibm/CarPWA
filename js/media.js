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
const PDFJS = 'vendor/pdfjs/', MODEL_VIEWER = 'vendor/model-viewer/model-viewer-umd.min.js';
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
  doc: { name: 'Document', icon: 'doc', accept: '.pdf,application/pdf', hint: 'A PDF from this device or a link; PowerPoint, Word or Excel by link (SharePoint, OneDrive or any public link); Google Slides “publish to web” links. To use a PowerPoint file from this device, save it as PDF first.' },
  video: { name: 'Video', icon: 'play', accept: 'video/*', hint: 'A YouTube link (video, short, live or playlist), a video link (.mp4, .webm, .m3u8) or a video from this device.' },
  web: { name: 'Web page', icon: 'globe', accept: '', hint: 'Any web address. Many big sites (Google, banks, most news) refuse to be shown inside another app: use Open for those.' },
  model: { name: '3D model', icon: 'cube', accept: '.glb,.gltf,model/gltf-binary,model/gltf+json', hint: 'A glTF model: a .glb file from this device, or a link to a .glb or .gltf.' },
};

const Media = {
  pdf: {}, // id → { doc, page, pages, rendering }
  /** The first widget of a type on the dashboard, for voice and link actions. */
  first(kind) { return widgetIds().find(i => wtype(i) === kind) || null; },
  html(id) {
    const k = wtype(id), c = Wcfg.get(id), K = MEDIA_KINDS[k];
    return `<div class="mw mw-${k}" data-media="${esc(id)}"><div class="mw-body"><div class="mw-empty">${svg(K.icon)}<b>${esc(c.title || K.name)}</b>
        <span>${c.url || c.file ? 'Loading…' : 'Nothing chosen yet'}</span>${c.url || c.file ? '' : `<button class="w-cta" data-media-cfg="${esc(id)}">Choose</button>`}</div></div>
      ${k === 'doc' ? `<div class="mw-bar" data-pdfbar hidden><button class="ctl" data-mact="prev:${esc(id)}" aria-label="Previous page">${svg('back')}</button>
        <span class="mw-page" data-pdfpage></span><button class="ctl" data-mact="next:${esc(id)}" aria-label="Next page">${svg('back').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button></div>` : ''}
      ${c.url && k !== 'model' ? `<button class="mw-open" data-mact="open:${esc(id)}" aria-label="Open outside DriveDeck">${svg('expand')}</button>` : ''}</div>`;
  },
  /** Fill every media widget on the dashboard with its content. */
  mountAll() { $$('#dashRoot .mw[data-media]').forEach(el => this.mount(el.dataset.media, el)); },
  async mount(id, el = $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`)) {
    if (!el) return;
    const k = wtype(id), c = Wcfg.get(id), body = $('.mw-body', el);
    if (!c.url && !c.file) return;
    let src = c.url;
    try { if (c.file) src = await Files.url(c.file.key); } catch (e) { Log.e('media', 'Stored file unreadable', e); }
    if (!src) return this.problem(body, 'The file isn’t on this device any more. Choose it again.', id);
    Log.i('media', `Showing ${k}`, { id, src: c.file ? `file: ${c.file.name}` : src });
    try {
      if (k === 'doc') return await this.doc(id, el, body, src, c);
      if (k === 'video') return await this.video(id, body, src, c);
      if (k === 'web') return this.frame(body, src, 'web');
      if (k === 'model') return await this.model(body, src);
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
    if (c.file) return this.problem(body, 'PowerPoint, Word and Excel files from this device can’t be shown here: save the file as PDF, or use a SharePoint or OneDrive link.', id);
    this.frame(body, this.docUrl(src), 'doc');
  },
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
    const P = this.pdf[id], el = $(`#dashRoot .mw[data-media="${CSS.escape(id)}"]`); if (!P?.doc || !el) return;
    const cv = $('.mw-pdf', el), box = $('.mw-body', el); if (!cv) return;
    P.page = Math.max(1, Math.min(P.pages, P.page));
    $('[data-pdfpage]', el).textContent = `${P.page} / ${P.pages}`;
    const token = P.token = (P.token || 0) + 1;
    const page = await P.doc.getPage(P.page); if (token !== P.token) return;
    const v1 = page.getViewport({ scale: 1 }), fit = Math.min(box.clientWidth / v1.width, box.clientHeight / v1.height) || 1, dpr = Math.min(2, devicePixelRatio || 1);
    const vp = page.getViewport({ scale: fit * dpr });
    cv.width = vp.width; cv.height = vp.height; cv.style.width = `${vp.width / dpr}px`; cv.style.height = `${vp.height / dpr}px`;
    P.task?.cancel(); P.task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
    try { await P.task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') throw e; }
  },
  go(id, to) {
    const P = this.pdf[id]; if (!P?.doc) return false;
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
  async model(body, src) {
    if (!customElements.get('model-viewer')) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = MODEL_VIEWER; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    body.innerHTML = `<model-viewer class="mw-model" src="${esc(src)}" camera-controls auto-rotate touch-action="pan-y" interaction-prompt="none" shadow-intensity="0.8" exposure="1" alt="3D model"></model-viewer>`;
  },

  /* ---------- Choosing what a widget shows ---------- */
  config(id, isNew) {
    const k = wtype(id), K = MEDIA_KINDS[k], c = Wcfg.get(id);
    sheet(`${K.name} widget`, `<div class="cmd-form">
      <label class="fld"><span>Link</span><input id="mwUrl" type="url" value="${esc(c.url || '')}" placeholder="https://…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      ${K.accept !== '' ? `<div class="mw-file"><button class="big-btn" id="mwPick">${svg('plus')}Choose a file</button><span id="mwFileName">${c.file ? esc(c.file.name) : 'or a file from this device'}</span>
        <input type="file" id="mwFile" accept="${K.accept}" hidden></div>` : ''}
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
addEventListener('resize', () => { clearTimeout(Media.rt); Media.rt = setTimeout(() => Object.keys(Media.pdf).forEach(id => Media.pdfDraw(id)), 300); });
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
Actions.define('doc.next', { group: 'Documents & media', name: 'Next page or slide', arg: '', run(v, say) { const id = needs('doc', say); if (id && !Media.go(id, (Media.pdf[id]?.page || 1) + 1)) say('Page turning works for PDF documents.'); } });
Actions.define('doc.prev', { group: 'Documents & media', name: 'Previous page or slide', arg: '', run(v, say) { const id = needs('doc', say); if (id && !Media.go(id, (Media.pdf[id]?.page || 1) - 1)) say('Page turning works for PDF documents.'); } });
Actions.define('doc.page', { group: 'Documents & media', name: 'Go to a page or slide', arg: 'Page number', run(v, say) { const id = needs('doc', say), n = parseInt(v, 10) || WORD_NUM[v.toLowerCase()];
  if (id && n && !Media.go(id, n)) say('Page turning works for PDF documents.'); } });
Actions.define('doc.open', { group: 'Documents & media', name: 'Show a document', arg: 'Link to the document', run(v, say) { const id = needs('doc', say); if (id && v) { delete Media.pdf[id]; Media.resetPage(id); Wcfg.set(id, { url: v, file: null }); Dash.render(); } } });
Actions.define('video.play', { group: 'Documents & media', name: 'Play the video', arg: '', run(v, say) { const id = needs('video', say); if (id) Media.videoCmd(id, true); } });
Actions.define('video.pause', { group: 'Documents & media', name: 'Pause the video', arg: '', run(v, say) { const id = needs('video', say); if (id) Media.videoCmd(id, false); } });
Actions.define('video.open', { group: 'Documents & media', name: 'Show a video', arg: 'YouTube or video link', run(v, say) { const id = needs('video', say); if (id && v) { Wcfg.set(id, { url: v, file: null }); Dash.render(); } } });
Actions.define('web.open', { group: 'Documents & media', name: 'Show a web page', arg: 'Web address', run(v, say) { const id = needs('web', say); if (id && v) { Wcfg.set(id, { url: /^https?:/i.test(v) ? v : 'https://' + v, file: null }); Dash.render(); } } });
Actions.define('model.open', { group: 'Documents & media', name: 'Show a 3D model', arg: 'Link to a .glb or .gltf', run(v, say) { const id = needs('model', say); if (id && v) { Wcfg.set(id, { url: v, file: null }); Dash.render(); } } });
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, last: 9999 };
if (current === 'dashboard') Dash.render(); // the widget types now exist
