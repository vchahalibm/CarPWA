'use strict';
/* DriveDeck Trainer: the page. Talks to server.py (same address) over a small JSON API, and follows long jobs
   (captures, training) with Server-Sent Events. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#35c8ff', '#ff9f0a', '#30d158', '#ff453a', '#bf5af2', '#ffd60a', '#64d2ff', '#ff375f', '#ac8e68', '#5e5ce6'];
const api = async (path, opt = {}) => {
  const r = await fetch('/api/' + path, { ...opt, headers: opt.body && !(opt.body instanceof Blob) && typeof opt.body === 'string' ? { 'Content-Type': 'application/json' } : {} });
  const ct = r.headers.get('Content-Type') || '', body = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
};
const post = (p, b, m = 'POST') => api(p, { method: m, body: JSON.stringify(b || {}) });
const toast = (msg, err) => { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3500); };
const fail = e => { console.error(e); toast(e.message || String(e), true); };
const S = { status: null, datasets: [], runs: [] };
/** Show a picture's canvas as large as fits (small pictures scaled up, so boxes are easy to draw). */
const fit = c => { const wrap = c.parentElement, maxW = wrap.clientWidth - 16, maxH = innerHeight * 0.72, k = Math.min(maxW / c.width, maxH / c.height);
  c.style.width = `${Math.round(c.width * k)}px`; c.style.height = `${Math.round(c.height * k)}px`; };
addEventListener('resize', () => $$('.canvas-wrap canvas').forEach(c => c.width > 10 && fit(c)));

/* ---------- Tabs ---------- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) tab(b.dataset.tab); });
function tab(id) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); $$('main > section').forEach(s => s.classList.toggle('on', s.id === id));
  location.hash = id; ({ datasets: loadDatasets, label: Label.open, capture: fillDs, train: Train.open, models: loadRuns })[id]?.();
}

async function boot() {
  try {
    S.status = await api('status');
    $('#status').textContent = `Python ${S.status.python} · ${S.status.machine} · ${S.status.engines.map(e => `${e.name.split(' (')[0]}: ${e.ok ? 'ready' : 'not installed'}`).join(' · ')}`;
    $('#dsNew [name=classes]').value = S.status.uiClasses.join('\n');
    $('#capVp').innerHTML = Object.entries(S.status.viewports).map(([k, [w, h]], i) => `<label><input type="checkbox" name="vp" value="${k}" ${i < 2 ? 'checked' : ''}> ${k} ${w}×${h}</label>`).join('');
  } catch (e) { fail(e); }
  await loadDatasets();
  tab((location.hash || '#datasets').slice(1));
}

/* ---------- Datasets ---------- */
async function loadDatasets() {
  S.datasets = await api('datasets').catch(e => (fail(e), []));
  $('#dsList').innerHTML = S.datasets.map(d => `<div class="card"><h3>${esc(d.name)}</h3>
    <div class="stat"><span><b>${d.images}</b> pictures</span><span><b>${d.labeled}</b> labeled</span><span><b>${d.boxes}</b> boxes</span></div>
    <div class="perclass">${d.classes.map((c, i) => `<span style="border-left:4px solid ${COLORS[i % 10]}">${esc(c)} ${d.perClass[c] || 0}</span>`).join('')}</div>
    <div class="acts"><button data-ds-label="${esc(d.name)}" class="primary">Label</button><button data-ds-train="${esc(d.name)}">Train</button>
      <a class="btn" href="/api/datasets/${encodeURIComponent(d.name)}/zip">Download zip</a><button data-ds-classes="${esc(d.name)}">Classes</button><button class="danger" data-ds-del="${esc(d.name)}">Delete</button></div></div>`).join('')
    || '<div class="muted">No datasets yet: make one below.</div>';
  fillDs();
}
function fillDs() {
  for (const id of ['#lbDs', '#capDs', '#trDs']) { const s = $(id), v = s.value; s.innerHTML = S.datasets.map(d => `<option>${esc(d.name)}</option>`).join(''); if (v && S.datasets.some(d => d.name === v)) s.value = v; }
}
$('#dsNew').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  try { await post('datasets', { name: f.name.value.trim(), classes: f.classes.value.split('\n').map(s => s.trim()).filter(Boolean) }); f.name.value = ''; toast('Dataset made'); loadDatasets(); } catch (err) { fail(err); }
});
$('#dsList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.dsLabel) { $('#lbDs').value = d.dsLabel; tab('label'); }
  if (d.dsTrain) { $('#trDs').value = d.dsTrain; tab('train'); }
  if (d.dsDel && confirm(`Delete the dataset “${d.dsDel}” and all its pictures?`)) { await api(`datasets/${encodeURIComponent(d.dsDel)}`, { method: 'DELETE' }).catch(fail); loadDatasets(); }
  if (d.dsClasses) {
    const cur = S.datasets.find(x => x.name === d.dsClasses).classes, v = prompt('Classes, separated by commas (their order is their number: change names, add at the end)', cur.join(', '));
    if (v != null) { await post(`datasets/${encodeURIComponent(d.dsClasses)}/classes`, { classes: v.split(',').map(s => s.trim()).filter(Boolean) }, 'PUT').catch(fail); loadDatasets(); }
  }
});

/* ---------- Label: draw boxes on pictures ---------- */
const Label = {
  ds: '', files: [], i: 0, img: null, boxes: [], sel: -1, cls: 0, dirty: false, drag: null,
  async open() {
    fillDs(); Label.ds = $('#lbDs').value; if (!Label.ds) return;
    const d = await api(`datasets/${encodeURIComponent(Label.ds)}`).catch(fail); if (!d) return;
    Label.classes = d.classes; Label.files = d.files;
    $('#lbClasses').innerHTML = d.classes.map((c, k) => `<button class="chip ${k === Label.cls ? 'on' : ''}" style="--c:${COLORS[k % 10]}" data-cls="${k}">${k < 9 ? k + 1 + ' ' : ''}${esc(c)}</button>`).join('');
    Label.list(); if (Label.files.length) Label.show(Math.min(Label.i, Label.files.length - 1)); else Label.clear();
    const runs = await api('runs').catch(() => []);
    $('#lbAssist').innerHTML = '<option value="">Pre-label with a model…</option>' + runs.filter(r => r.hasModel).map(r => `<option value="${esc(r.id)}">${esc(r.id)} · mAP50 ${(r.best_map50 * 100).toFixed(0)}%</option>`).join('');
  },
  list() { $('#lbFiles').innerHTML = Label.files.map((f, k) => `<button data-i="${k}" class="${k === Label.i ? 'on' : ''}"><span>${esc(f.file)}</span><small>${f.boxes || '—'}</small></button>`).join('') || '<div class="muted" style="padding:12px">No pictures: add some above.</div>'; },
  clear() { const c = $('#lbCanvas'); c.width = 10; c.height = 10; },
  async show(i) {
    if (Label.dirty) await Label.save();
    Label.i = i; const f = Label.files[i]; if (!f) return;
    Label.list(); $(`#lbFiles [data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    const tok = Label.tok = (Label.tok || 0) + 1; // a quicker click on another picture wins
    const img = new Image(); img.src = `/api/datasets/${encodeURIComponent(Label.ds)}/image/${encodeURIComponent(f.file)}`;
    try { await img.decode(); } catch { if (tok === Label.tok) toast(`${f.file} couldn’t be shown`, true); return; }
    const boxes = await api(`datasets/${encodeURIComponent(Label.ds)}/labels/${encodeURIComponent(f.file)}`).catch(() => []);
    if (tok !== Label.tok) return;
    Label.img = img; Label.boxes = boxes; Label.sel = -1; Label.dirty = false;
    const c = $('#lbCanvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; fit(c); Label.draw();
  },
  draw() {
    const c = $('#lbCanvas'), x = c.getContext('2d'), W = c.width, H = c.height; if (!Label.img) return;
    x.drawImage(Label.img, 0, 0); const lw = Math.max(2, W / 600);
    Label.boxes.forEach((b, k) => {
      const col = COLORS[b.c % 10], l = (b.x - b.w / 2) * W, t = (b.y - b.h / 2) * H;
      x.lineWidth = k === Label.sel ? lw * 2.2 : lw; x.strokeStyle = col; x.strokeRect(l, t, b.w * W, b.h * H);
      if (k === Label.sel) { x.fillStyle = col + '33'; x.fillRect(l, t, b.w * W, b.h * H); }
      x.font = `600 ${Math.max(11, W / 90)}px system-ui`; const txt = Label.classes[b.c] || b.c, tw = x.measureText(txt).width + 8;
      x.fillStyle = col; x.fillRect(l, Math.max(0, t - W / 70), tw, W / 70); x.fillStyle = '#000'; x.fillText(txt, l + 4, Math.max(W / 90, t - 3));
    });
    if (Label.drag?.mode === 'new') { const d = Label.drag; x.setLineDash([6, 4]); x.strokeStyle = COLORS[Label.cls % 10]; x.lineWidth = lw; x.strokeRect(d.x0 * W, d.y0 * H, (d.x1 - d.x0) * W, (d.y1 - d.y0) * H); x.setLineDash([]); }
  },
  pt(e) { const c = $('#lbCanvas'), r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; },
  hit(px, py) { for (let k = Label.boxes.length - 1; k >= 0; k--) { const b = Label.boxes[k]; if (Math.abs(px - b.x) <= b.w / 2 && Math.abs(py - b.y) <= b.h / 2) return k; } return -1; },
  async save() {
    if (!Label.files[Label.i]) return;
    await post(`datasets/${encodeURIComponent(Label.ds)}/labels/${encodeURIComponent(Label.files[Label.i].file)}`, { boxes: Label.boxes }, 'PUT').catch(fail);
    Label.files[Label.i].boxes = Label.boxes.length; Label.dirty = false; Label.list();
  },
  change() { Label.dirty = true; Label.draw(); },
};
const cv = $('#lbCanvas');
cv.addEventListener('pointerdown', e => {
  const [px, py] = Label.pt(e), k = Label.hit(px, py); cv.setPointerCapture(e.pointerId);
  if (k >= 0) { Label.sel = k; const b = Label.boxes[k]; Label.drag = { mode: 'move', k, dx: px - b.x, dy: py - b.y }; }
  else { Label.sel = -1; Label.drag = { mode: 'new', x0: px, y0: py, x1: px, y1: py }; }
  Label.draw();
});
cv.addEventListener('pointermove', e => {
  const d = Label.drag; if (!d) return; const [px, py] = Label.pt(e).map(v => Math.min(1, Math.max(0, v)));
  if (d.mode === 'new') { d.x1 = px; d.y1 = py; Label.draw(); }
  else { const b = Label.boxes[d.k]; b.x = Math.min(1 - b.w / 2, Math.max(b.w / 2, px - d.dx)); b.y = Math.min(1 - b.h / 2, Math.max(b.h / 2, py - d.dy)); Label.change(); }
});
cv.addEventListener('pointerup', () => {
  const d = Label.drag; Label.drag = null; if (!d) return;
  if (d.mode === 'new') {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    if ((x1 - x0) * cv.width > 4 && (y1 - y0) * cv.height > 4) { Label.boxes.push({ c: Label.cls, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }); Label.sel = Label.boxes.length - 1; Label.change(); }
    else Label.draw();
  }
});
$('#lbClasses').addEventListener('click', e => {
  const b = e.target.closest('[data-cls]'); if (!b) return; Label.cls = +b.dataset.cls;
  if (Label.sel >= 0) { Label.boxes[Label.sel].c = Label.cls; Label.change(); } // re-class the selected box
  $$('#lbClasses .chip').forEach(c => c.classList.toggle('on', +c.dataset.cls === Label.cls));
});
$('#lbFiles').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) Label.show(+b.dataset.i); });
$('#lbDs').addEventListener('change', () => { Label.i = 0; Label.open(); });
$('#lbSave').addEventListener('click', () => Label.save().then(() => toast('Saved')));
$('#lbAssist').addEventListener('change', async e => {
  const run = e.target.value; e.target.value = ''; if (!run || !Label.files[Label.i]) return;
  try {
    const r = await post(`runs/${encodeURIComponent(run)}/predict?dataset=${encodeURIComponent(Label.ds)}&file=${encodeURIComponent(Label.files[Label.i].file)}`, {});
    const add = r.boxes.filter(b => b.name in Object.fromEntries(Label.classes.map(c => [c, 1]))).map(b => ({ c: Label.classes.indexOf(b.name), x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0 }));
    Label.boxes.push(...add); Label.change(); toast(`${add.length} boxes suggested: check them, then save`);
  } catch (err) { fail(err); }
});
$('#lbUpload').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = ''; let n = 0;
  for (const f of files) {
    try { const r = await api(`datasets/${encodeURIComponent(Label.ds)}/files?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }); n += r.added ?? 1; toast(`Added ${n} of ${files.length}…`); }
    catch (err) { fail(err); }
  }
  toast(`Added ${n} picture${n === 1 ? '' : 's'}`); Label.open();
});
addEventListener('keydown', e => {
  if (!$('#label').classList.contains('on') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight' && Label.i < Label.files.length - 1) Label.show(Label.i + 1);
  else if (e.key === 'ArrowLeft' && Label.i > 0) Label.show(Label.i - 1);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && Label.sel >= 0) { Label.boxes.splice(Label.sel, 1); Label.sel = -1; Label.change(); }
  else if (/^[1-9]$/.test(e.key) && +e.key <= (Label.classes || []).length) $(`#lbClasses [data-cls="${+e.key - 1}"]`)?.click();
  else if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); Label.save().then(() => toast('Saved')); }
  else return;
  e.preventDefault();
});

/* ---------- Following a job ---------- */
function follow(job, onEvent) {
  const es = new EventSource(`/api/jobs/${job.id}/events`);
  es.onmessage = m => { const ev = JSON.parse(m.data); onEvent(ev); if (ev.type === 'done' || ev.type === 'error') es.close(); };
  es.onerror = () => { if (es.readyState === 2) onEvent({ type: 'log', msg: 'Lost the connection to the trainer' }); };
  return es;
}
const logTo = (el, msg, err) => { el.insertAdjacentHTML('beforeend', `<div class="${err ? 'err' : ''}">${esc(msg)}</div>`); el.scrollTop = el.scrollHeight; };

/* ---------- Capture web pages ---------- */
$('#cap').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, log = $('#capLog'); log.innerHTML = ''; $('#capShots').innerHTML = '';
  const body = { urls: f.urls.value.split('\n'), viewports: $$('[name=vp]:checked', f).map(x => x.value), themes: $$('[name=theme]:checked', f).map(x => x.value), screens: +f.screens.value };
  try {
    const job = await post(`datasets/${encodeURIComponent(f.dataset.value)}/harvest`, body);
    follow(job, ev => {
      if (ev.type === 'shot') { $('#capShots').insertAdjacentHTML('beforeend', `<figure><img loading="lazy" src="/api/datasets/${encodeURIComponent(f.dataset.value)}/image/${encodeURIComponent(ev.file)}"><figcaption>${esc(ev.viewport)} · ${esc(ev.theme)} · ${ev.boxes} boxes</figcaption></figure>`); logTo(log, `${ev.url} · ${ev.viewport} · ${ev.theme}: ${ev.boxes} elements`); }
      else if (ev.type === 'log') logTo(log, ev.msg);
      else if (ev.type === 'error') logTo(log, ev.msg, true);
      else if (ev.type === 'done') { logTo(log, `Done: ${ev.result?.pictures} pictures, ${ev.result?.boxes} labeled elements`); loadDatasets(); }
    });
  } catch (err) { fail(err); }
});

/* ---------- Train ---------- */
const Train = {
  engine: 'torchvision', job: null, hist: [],
  open() {
    fillDs(); const E = S.status?.engines || [];
    $('#trEngines').innerHTML = E.map(e => `<div class="engine ${e.id === Train.engine ? 'on' : ''} ${e.ok ? '' : 'off'}" data-eng="${e.id}"><b>${esc(e.name)}</b><small>Licence: ${esc(e.license)} · ${esc(e.note)}</small><small>${esc(e.why)}</small></div>`).join('');
    Train.params();
    api('jobs').then(js => { const j = js.find(x => x.kind === 'train' && x.state === 'running'); if (j && !Train.job) Train.watch(j); }).catch(() => {});
  },
  params() {
    const e = (S.status?.engines || []).find(x => x.id === Train.engine); if (!e) return;
    const label = { arch: 'Model', model: 'Model', epochs: 'Epochs', imgsz: 'Picture size', batch: 'Batch size', lr: 'Learning rate', val: 'Validation share', pretrained: 'Start from ImageNet', conf: 'Confidence (for tests)' };
    $('#trParams').innerHTML = Object.entries(e.params).map(([k, v]) => `<label>${label[k] || k}${e.choices?.[k] ? `<select name="p_${k}">${Object.entries(e.choices[k]).map(([o, l]) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : typeof v === 'boolean' ? `<select name="p_${k}"><option value="true" ${v ? 'selected' : ''}>yes</option><option value="false" ${v ? '' : 'selected'}>no</option></select>` : `<input name="p_${k}" value="${esc(v)}">`}</label>`).join('');
  },
  watch(job) {
    Train.job = job; Train.hist = []; $('#trLog').innerHTML = ''; $('#trStop').hidden = false; $('#trGo').disabled = true; $('#trState').textContent = 'Training…';
    follow(job, ev => {
      if (ev.type === 'epoch') { Train.hist.push(ev); chart($('#trChart'), Train.hist); logTo($('#trLog'), `epoch ${ev.epoch}/${ev.of} · loss ${ev.loss.toFixed(3)}${ev.map50 != null ? ` · mAP50 ${(ev.map50 * 100).toFixed(1)}% · mAP ${(ev.map * 100).toFixed(1)}%` : ''}${ev.secs ? ` · ${ev.secs} s` : ''}`); $('#trState').textContent = `Epoch ${ev.epoch} of ${ev.of}`; }
      else if (ev.type === 'log') logTo($('#trLog'), ev.msg);
      else if (ev.type === 'error') { logTo($('#trLog'), ev.msg, true); Train.end('Failed'); }
      else if (ev.type === 'done') { logTo($('#trLog'), `Finished (${ev.state}) · best mAP50 ${((ev.result?.best_map50 || 0) * 100).toFixed(1)}% · run ${ev.result?.run}`); Train.end(ev.state === 'stopped' ? 'Stopped' : 'Done: see Models'); }
    });
  },
  end(msg) { Train.job = null; $('#trStop').hidden = true; $('#trGo').disabled = false; $('#trState').textContent = msg; },
};
$('#trEngines').addEventListener('click', e => { const b = e.target.closest('[data-eng]'); if (!b || b.classList.contains('off')) return; Train.engine = b.dataset.eng; Train.open(); });
$('#tr').addEventListener('submit', async e => {
  e.preventDefault();
  const params = Object.fromEntries($$('[name^=p_]').map(i => [i.name.slice(2), i.value === 'true' ? true : i.value === 'false' ? false : isNaN(+i.value) || i.value === '' ? i.value : +i.value]));
  try { Train.watch(await post('train', { dataset: $('#trDs').value, engine: Train.engine, params })); } catch (err) { fail(err); }
});
$('#trStop').addEventListener('click', () => Train.job && post(`jobs/${Train.job.id}/stop`).catch(fail));

/** Loss (left axis) and mAP50 (right, 0..100%) over epochs. */
function chart(c, hist) {
  const dpr = devicePixelRatio || 1, W = c.clientWidth * dpr, H = (c.getAttribute('height') | 0) * dpr; c.width = W; c.height = H;
  const x = c.getContext('2d'), pad = 36 * dpr, css = getComputedStyle(document.body); x.clearRect(0, 0, W, H);
  if (!hist.length) return;
  const n = Math.max(2, hist.at(-1).epoch), maxL = Math.max(...hist.map(h => h.loss)) || 1, X = ep => pad + (ep - 1) / (n - 1) * (W - 2 * pad);
  x.strokeStyle = css.getPropertyValue('--line'); x.lineWidth = dpr; x.strokeRect(pad, pad / 2, W - 2 * pad, H - pad * 1.5);
  const line = (pts, col) => { x.strokeStyle = col; x.lineWidth = 2 * dpr; x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.stroke(); };
  line(hist.map(h => [X(h.epoch), pad / 2 + (1 - h.loss / maxL) * (H - pad * 1.5)]), '#ff9f0a');
  const m = hist.filter(h => h.map50 != null); if (m.length) line(m.map(h => [X(h.epoch), pad / 2 + (1 - h.map50) * (H - pad * 1.5)]), '#30d158');
  x.fillStyle = css.getPropertyValue('--muted'); x.font = `${11 * dpr}px system-ui`;
  x.fillText(`loss (max ${maxL.toFixed(2)})`, pad, H - 8 * dpr); x.fillStyle = '#30d158'; x.fillText(`mAP50 ${m.length ? (m.at(-1).map50 * 100).toFixed(1) + '%' : '—'}`, W / 2, H - 8 * dpr);
  x.fillStyle = css.getPropertyValue('--muted'); x.fillText(`epoch ${hist.at(-1).epoch}`, W - pad - 60 * dpr, H - 8 * dpr);
}

/* ---------- Models ---------- */
const RV = { run: null, img: null, boxes: [] };
async function loadRuns() {
  S.runs = await api('runs').catch(e => (fail(e), []));
  $('#runList').innerHTML = S.runs.map(r => `<div class="card"><h3>${esc(r.id)}</h3>
    <div class="stat"><span>${esc(r.dataset)}</span><span>${esc(r.engine)} ${esc(r.arch || r.model || '')}</span><span><b>${r.epochs}</b> epochs</span><span>best mAP50 <b>${(r.best_map50 * 100).toFixed(1)}%</b></span></div>
    <div class="acts"><button class="primary" data-run="${esc(r.id)}" ${r.hasModel ? '' : 'disabled'}>Open</button><button class="danger" data-run-del="${esc(r.id)}">Delete</button></div></div>`).join('') || '<div class="muted">No trained models yet.</div>';
}
$('#runList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.runDel && confirm(`Delete ${b.dataset.runDel}?`)) { await api(`runs/${encodeURIComponent(b.dataset.runDel)}`, { method: 'DELETE' }).catch(fail); $('#runView').hidden = true; return loadRuns(); }
  if (!b.dataset.run) return;
  const r = await api(`runs/${encodeURIComponent(b.dataset.run)}`).catch(fail); if (!r) return;
  RV.run = r; $('#runView').hidden = false; $('#rvTitle').textContent = `${r.id} · ${r.dataset} · ${(r.best_map50 * 100).toFixed(1)}% mAP50`;
  chart($('#rvChart'), r.history);
  const last = [...r.history].reverse().find(h => h.perClass); $('#rvClasses').innerHTML = last ? Object.entries(last.perClass).map(([c, a]) => `<span>${esc(c)} ${(a * 100).toFixed(0)}%</span>`).join('') : '';
  $('#rvName').value = `${r.dataset} detector`; $('#rvFiles').innerHTML = files(r);
  const d = await api(`datasets/${encodeURIComponent(r.dataset)}`).catch(() => null);
  $('#rvDsImg').innerHTML = '<option value="">…or one from its dataset</option>' + (d?.files || []).map(f => `<option>${esc(f.file)}</option>`).join('');
  $('#runView').scrollIntoView({ behavior: 'smooth' });
});
const files = r => (r.exported || []).map(f => `<a class="btn" href="/api/runs/${encodeURIComponent(r.id)}/files/${encodeURIComponent(f)}">${esc(f)}</a>`).join(' ');
async function test(blobOrFile) {
  const conf = +$('#rvConf').value, r = RV.run; let res, src;
  try {
    if (typeof blobOrFile === 'string') { res = await post(`runs/${encodeURIComponent(r.id)}/predict?conf=${conf}&dataset=${encodeURIComponent(r.dataset)}&file=${encodeURIComponent(blobOrFile)}`, {}); src = `/api/datasets/${encodeURIComponent(r.dataset)}/image/${encodeURIComponent(blobOrFile)}`; }
    else { res = await api(`runs/${encodeURIComponent(r.id)}/predict?conf=${conf}&name=${encodeURIComponent(blobOrFile.name)}`, { method: 'POST', body: blobOrFile }); src = URL.createObjectURL(blobOrFile); }
  } catch (e) { return fail(e); }
  RV.last = blobOrFile; const img = new Image(); img.src = src; await img.decode(); RV.img = img; RV.boxes = res.boxes;
  $('#rvMs').textContent = `${res.boxes.length} found in ${res.ms} ms`; drawTest();
}
function drawTest() {
  const c = $('#rvCanvas'), img = RV.img; if (!img) return; c.width = img.naturalWidth; c.height = img.naturalHeight; fit(c);
  const x = c.getContext('2d'), W = c.width, H = c.height; x.drawImage(img, 0, 0); x.lineWidth = Math.max(2, W / 600); x.font = `600 ${Math.max(11, W / 90)}px system-ui`;
  RV.boxes.forEach(b => { const col = COLORS[b.c % 10]; x.strokeStyle = col; x.strokeRect(b.x0 * W, b.y0 * H, (b.x1 - b.x0) * W, (b.y1 - b.y0) * H);
    const t = `${b.name} ${(b.score * 100).toFixed(0)}%`; x.fillStyle = col; x.fillRect(b.x0 * W, Math.max(0, b.y0 * H - W / 70), x.measureText(t).width + 8, W / 70); x.fillStyle = '#000'; x.fillText(t, b.x0 * W + 4, Math.max(W / 90, b.y0 * H - 3)); });
}
$('#rvFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) test(f); });
$('#rvDsImg').addEventListener('change', e => e.target.value && test(e.target.value));
$('#rvConf').addEventListener('input', e => { $('#rvConfV').textContent = (+e.target.value).toFixed(2); });
$('#rvConf').addEventListener('change', () => RV.last && test(RV.last));
$('#rvExport').addEventListener('click', async () => {
  const b = $('#rvExport'); b.disabled = true; b.textContent = 'Exporting…';
  try { const r = await post(`runs/${encodeURIComponent(RV.run.id)}/export`, { name: $('#rvName').value, int8: $('#rvInt8').checked }); RV.run.exported = r.files; $('#rvFiles').innerHTML = files(RV.run); toast('Exported'); }
  catch (e) { fail(e); } finally { b.disabled = false; b.textContent = 'Export ONNX'; }
});

boot();
