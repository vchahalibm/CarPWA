'use strict';
/* ============================================================
   The data widget: a table and a chart of rows from a CSV or JSON file
   or link, a SQLite database (desktop app: read-only, js → desktop/data.js),
   or a script's result (a task's JSON, the model's answer).
   - Chart.js (vendor/pptx/chart.umd.min.js, MIT; loaded on first use):
     bar, line, pie, doughnut, scatter; or the table alone. A chart is
     chosen from the data (a text or date column across, numbers up) and
     can be changed: columns, adding up (sum, average, count, min, max),
     sorting, top N, chart and/or table.
   - Settings per widget in Wcfg (source and chart); the rows themselves in
     IndexedDB (Files, key data:<id>), so they survive a redraw or restart.
   - Script actions: data.csv, data.sql, data.show, data.chart,
     data.summary (a few sentences the assistant can say).
   Loaded after ostasks.js.
   ============================================================ */
const DATA_CHARTS = { bar: 'Bars', line: 'Line', pie: 'Pie', doughnut: 'Doughnut', scatter: 'Scatter', none: 'Table only' };
const DATA_AGG = { none: 'As they are', sum: 'Add up', avg: 'Average', count: 'Count', min: 'Smallest', max: 'Largest' };

const DataViz = {
  sets: {}, charts: {},
  lib() {
    if (window.Chart) return Promise.resolve();
    return (this.libLoad ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pptx/chart.umd.min.js'; s.onload = res; s.onerror = () => { this.libLoad = null; rej(new Error('Charts didn’t load')); }; document.head.appendChild(s); }));
  },
  /* ---------- Reading data ---------- */
  /** CSV (or TSV) text → { columns, rows }; quotes, commas and line breaks inside quotes handled. */
  csv(text) {
    const t = String(text || '').replace(/^﻿/, ''), sep = (t.split('\n')[0].match(/\t/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? '\t' : (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) out.push(row); row = []; } else cell += c;
    }
    row.push(cell); if (row.some(x => x !== '')) out.push(row);
    const head = (out.shift() || []).map((h, i) => h.trim() || `Column ${i + 1}`);
    return this.typed({ columns: head, rows: out.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) });
  },
  /** Anything a script may hand over (rows as objects, arrays with a header, JSON text) → { columns, rows }. */
  from(v) {
    if (typeof v === 'string') { const t = v.trim(); if (/^[[{]/.test(t)) { try { v = JSON.parse(t); } catch { return this.csv(t); } } else return this.csv(t); }
    if (v && !Array.isArray(v)) v = v.rows || v.data || v.items || (Object.values(v).every(x => typeof x !== 'object') ? Object.entries(v).map(([k, x]) => ({ name: k, value: x })) : [v]);
    if (!Array.isArray(v)) return { columns: [], rows: [] };
    if (Array.isArray(v[0])) { const [h, ...r] = v; return this.typed({ columns: h.map(String), rows: r.map(a => Object.fromEntries(h.map((k, i) => [k, a[i]]))) }); }
    if (v.length && typeof v[0] !== 'object') return this.typed({ columns: ['value'], rows: v.map(x => ({ value: x })) });
    const cols = [...new Set(v.flatMap(r => Object.keys(r || {})))];
    return this.typed({ columns: cols, rows: v });
  },
  /** Numbers that came as text become numbers. */
  typed(d) {
    for (const c of d.columns) {
      const vals = d.rows.map(r => r[c]).filter(x => x !== '' && x != null), num = vals.length && vals.every(x => typeof x === 'number' || /^-?[\d,]*\.?\d+(e-?\d+)?%?$/i.test(String(x).trim()));
      if (num) for (const r of d.rows) if (r[c] !== '' && r[c] != null && typeof r[c] !== 'number') r[c] = parseFloat(String(r[c]).replace(/[,%]/g, ''));
    }
    return d;
  },
  numeric(d, c) { const v = d.rows.map(r => r[c]).filter(x => x !== '' && x != null); return v.length > 0 && v.every(x => typeof x === 'number'); },
  isDate: s => typeof s === 'string' && /^\d{4}-\d{2}(-\d{2})?|^\d{1,2}\/\d{1,2}\/\d{2,4}|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s.trim()),
  /** A sensible chart for these rows: a text or date column across, up to three numeric columns up. */
  guess(d) {
    const nums = d.columns.filter(c => this.numeric(d, c)), texts = d.columns.filter(c => !nums.includes(c));
    const x = texts[0] || d.columns[0], ys = nums.filter(c => c !== x).slice(0, 3), dates = d.rows.slice(0, 20).every(r => this.isDate(String(r[x] ?? '')));
    const groups = new Set(d.rows.map(r => r[x])).size;
    return { type: !ys.length ? 'none' : dates || groups > 30 ? 'line' : ys.length === 1 && groups <= 6 ? 'doughnut' : 'bar', x, y: ys, agg: groups < d.rows.length ? 'sum' : 'none', sort: 'none', top: 0, view: 'both' };
  },
  /* ---------- Loading into a widget ---------- */
  async set(id, d, source = {}) {
    d.at = new Date().toISOString(); this.sets[id] = d;
    const c = Wcfg.get(id), keep = c.chart && c.chart.x && d.columns.includes(c.chart.x) && (c.chart.y || []).every(y => d.columns.includes(y));
    Wcfg.set(id, { source: { ...c.source, ...source }, chart: keep ? c.chart : this.guess(d) });
    try { await Files.put(`data:${id}`, new Blob([JSON.stringify(d)], { type: 'application/json' })); } catch (e) { Log.w('data', 'Not kept', e); }
    Log.i('data', `Data in ${id}`, { rows: d.rows.length, columns: d.columns.length, source: source.kind });
    this.draw(id); return d;
  },
  async get(id) { if (this.sets[id]) return this.sets[id]; try { const b = await Files.get(`data:${id}`); if (b) return (this.sets[id] = JSON.parse(await b.text())); } catch {} return null; },
  async csvFrom(src) {
    if (!/^(\/|~)/.test(src)) { // a link (or a file served with the app, e.g. samples/sales.csv)
      const r = await fetch(src); if (!r.ok) throw new Error(`${r.status}`); return /\.json(\?|$)/i.test(src) ? this.from(await r.text()) : this.csv(await r.text()); }
    if (!window.DriveDeckDesktop?.data) throw new Error('Files on this computer can be read in StudioGen; here use a link or choose the file');
    const r = await DriveDeckDesktop.data.read({ file: src }); if (!r.ok) throw new Error(r.denied ? 'You didn’t allow it' : r.err);
    return /\.json$/i.test(src) ? this.from(r.text) : this.csv(r.text);
  },
  async sql(file, sql, params = []) {
    if (!window.DriveDeckDesktop?.data) throw new Error('Databases can be read in StudioGen on a computer');
    const r = await DriveDeckDesktop.data.query({ file, sql, params }); if (!r.ok) throw new Error(r.denied ? 'You didn’t allow it' : r.err);
    if (r.total > r.rows.length) toast(`Showing ${r.rows.length.toLocaleString()} of ${r.total.toLocaleString()} rows`);
    return { columns: r.columns, rows: r.rows };
  },
  /** The data widget to fill: the first on the dashboard, else a new one (on Stage beside the content, else on the first page). */
  target() {
    const ids = widgetIds().filter(i => wtype(i) === 'data'); if (ids.length) return ids[0];
    const id = `data~${Math.random().toString(36).slice(2, 6)}`, where = typeof Stage !== 'undefined' && Stage.on ? 'stage.main' : 'pg0';
    Dash.setList(where, [...Dash.list(where), id]); Wcfg.set(id, { title: 'Data' }); Dash.render(); return id;
  },
  /* ---------- Drawing ---------- */
  html(id) { const c = Wcfg.get(id); return `<div class="dw" data-dw="${esc(id)}"><div class="dw-head"><b>${esc(c.title || 'Data')}</b><span class="dw-meta"></span></div><div class="dw-chart"><canvas></canvas></div><div class="dw-table"></div><div class="dw-empty mw-empty"><span>No data yet</span><button class="w-cta" data-dwcfg="${esc(id)}">Choose data</button></div></div>`; },
  mountAll() { $$('#dashRoot .dw[data-dw]').forEach(el => this.draw(el.dataset.dw)); },
  /** Rows → chart labels and series, with the widget's grouping, adding up, sorting and top N. */
  series(d, ch) {
    const x = ch.x, ys = (ch.y || []).filter(y => d.columns.includes(y)), agg = ch.agg || 'none';
    let pts;
    if (agg === 'none') pts = d.rows.map(r => ({ k: r[x], v: ys.map(y => +r[y] || 0) }));
    else {
      const g = new Map(); for (const r of d.rows) { const k = r[x]; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
      pts = [...g].map(([k, rs]) => ({ k, v: ys.length ? ys.map(y => { const a = rs.map(r => +r[y]).filter(n => !isNaN(n)); return agg === 'sum' ? a.reduce((s, n) => s + n, 0) : agg === 'avg' ? (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0) : agg === 'count' ? rs.length : agg === 'min' ? Math.min(...a) : Math.max(...a); }) : [rs.length] }));
    }
    if (ch.sort === 'desc') pts.sort((a, b) => b.v[0] - a.v[0]); else if (ch.sort === 'asc') pts.sort((a, b) => a.v[0] - b.v[0]); else if (ch.sort === 'x') pts.sort((a, b) => String(a.k).localeCompare(String(b.k), undefined, { numeric: true }));
    if (ch.top > 0) pts = pts.slice(0, ch.top);
    return { labels: pts.map(p => String(p.k ?? '')), names: ys.length ? ys.map(y => agg === 'count' ? `count` : agg !== 'none' ? `${DATA_AGG[agg].toLowerCase()} of ${y}` : y) : ['count'], data: (ys.length || 1) > 0 ? (ys.length ? ys : ['count']).map((_, i) => pts.map(p => p.v[i])) : [] };
  },
  async draw(id) {
    const el = $(`#dashRoot .dw[data-dw="${CSS.escape(id)}"]`); if (!el) return;
    const d = await this.get(id), c = Wcfg.get(id), ch = c.chart || {};
    $('.dw-empty', el).hidden = !!d; $('.dw-chart', el).hidden = !d || ch.type === 'none' || ch.view === 'table'; $('.dw-table', el).hidden = !d || ch.view === 'chart';
    if (!d) return;
    $('.dw-meta', el).textContent = `${d.rows.length.toLocaleString()} rows${c.source?.label ? ` · ${c.source.label}` : ''}`;
    if (ch.view !== 'chart') this.table(el, d, id);
    if (ch.type !== 'none' && ch.view !== 'table') {
      try { await this.lib(); } catch (e) { $('.dw-chart', el).innerHTML = `<div class="mw-empty"><span>${esc(e.message)}</span></div>`; return; }
      const cv = $('.dw-chart canvas', el), s = this.series(d, ch), css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue('--accent').trim() || '#35c8ff', fg = css.getPropertyValue('--text').trim() || css.color || '#ddd';
      const palette = [accent, '#ff9f40', '#4bc0c0', '#9966ff', '#ff6384', '#c9cbcf', '#ffcd56', '#36a2eb'];
      this.charts[id]?.destroy();
      const pie = ch.type === 'pie' || ch.type === 'doughnut';
      this.charts[id] = new Chart(cv, {
        type: ch.type === 'scatter' ? 'scatter' : ch.type,
        data: ch.type === 'scatter' ? { datasets: [{ label: `${s.names[0]} by ${ch.x}`, data: d.rows.map(r => ({ x: +r[ch.x], y: +r[(ch.y || [])[0]] })).filter(p => !isNaN(p.x) && !isNaN(p.y)), backgroundColor: accent }] }
          : { labels: s.labels, datasets: s.data.map((v, i) => ({ label: s.names[i], data: v, backgroundColor: pie ? s.labels.map((_, k) => palette[k % palette.length]) : palette[i % palette.length], borderColor: pie ? 'transparent' : palette[i % palette.length], tension: 0.25, pointRadius: s.labels.length > 60 ? 0 : 3 })) },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, color: fg,
          plugins: { legend: { display: pie || s.data.length > 1, labels: { color: fg } } },
          scales: pie ? {} : { x: { ticks: { color: fg, maxRotation: 45, autoSkip: true }, grid: { color: 'rgba(127,127,127,.15)' } }, y: { ticks: { color: fg }, grid: { color: 'rgba(127,127,127,.15)' }, beginAtZero: ch.type === 'bar' } } },
      });
    }
  },
  table(el, d, id) {
    const sort = this.sorted?.[id], rows = sort ? [...d.rows].sort((a, b) => { const x = a[sort.c], y = b[sort.c]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * sort.dir; }) : d.rows;
    const fmt = v => typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : esc(String(v ?? ''));
    $('.dw-table', el).innerHTML = `<table><thead><tr>${d.columns.map(c => `<th data-dwsort="${esc(id)}|${esc(c)}" class="${this.numeric(d, c) ? 'num' : ''}">${esc(c)}${sort?.c === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 300).map(r => `<tr>${d.columns.map(c => `<td class="${typeof r[c] === 'number' ? 'num' : ''}">${fmt(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length > 300 ? `<div class="se-note">First 300 of ${rows.length.toLocaleString()} rows</div>` : ''}`;
  },
  /** A few sentences about the data, for the assistant to say. */
  async summary(id) {
    const d = await this.get(id); if (!d) return 'There’s no data yet.';
    const ch = Wcfg.get(id).chart || this.guess(d), nums = d.columns.filter(c => this.numeric(d, c)).slice(0, 3), f = n => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    const parts = [`${d.rows.length.toLocaleString()} rows.`];
    for (const c of nums) { const a = d.rows.map(r => r[c]).filter(n => typeof n === 'number'); if (!a.length) continue; const s = a.reduce((x, y) => x + y, 0); parts.push(`${c}: total ${f(s)}, average ${f(s / a.length)}, from ${f(Math.min(...a))} to ${f(Math.max(...a))}.`); }
    if (ch.x && ch.y?.[0]) { const s = this.series(d, { ...ch, sort: 'desc', top: 1, agg: ch.agg === 'none' ? 'sum' : ch.agg }); if (s.labels[0]) parts.push(`The highest ${ch.x} is ${s.labels[0]}, with ${f(s.data[0][0])}.`); }
    return parts.join(' ');
  },
  /* ---------- Settings for a widget ---------- */
  async config(id, isNew) {
    const c = Wcfg.get(id), s = c.source || {}, d = await this.get(id), ch = c.chart || (d ? this.guess(d) : {}), cols = d?.columns || [], desk = !!window.DriveDeckDesktop?.data;
    const o = (v, cur, l = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
    sheet(isNew ? 'New data widget' : (c.title || 'Data'), `<div class="dw-cfg">
      <label class="se-field"><span>Title</span><input id="dwTitle" class="se-wz-in" value="${esc(c.title || 'Data')}"></label>
      <label class="se-field"><span>Data from</span><select id="dwKind">${o('csv', s.kind || 'csv', 'A CSV or JSON file or link')}${desk ? o('sqlite', s.kind, 'A SQLite database (read-only)') : ''}${o('keep', s.kind === 'script' ? 'keep' : '', 'Keep what a script put here')}</select></label>
      <div id="dwCsv"><label class="se-field"><span>Link or path (CSV, TSV or JSON)</span><input id="dwSrc" class="se-wz-in" value="${esc(s.src || '')}" placeholder="https://…/sales.csv${desk ? ' or ~/Documents/sales.csv' : ''}"></label>
        <div class="chip-row"><button class="chip" data-dwfile="text">Choose a file…</button><input type="file" id="dwFile" accept=".csv,.tsv,.json,.txt,text/csv,application/json" hidden></div></div>
      ${desk ? `<div id="dwDb"><label class="se-field"><span>Database file</span><input id="dwDbFile" class="se-wz-in" value="${esc(s.db || '')}" placeholder="~/data/sales.sqlite"></label><div class="chip-row"><button class="chip" data-dwfile="db">Choose a database…</button></div>
        <label class="se-field"><span>Query (SQL, read-only)</span><textarea id="dwSql" class="se-wide se-code" rows="3" placeholder="SELECT month, SUM(total) AS total FROM sales GROUP BY month">${esc(s.sql || '')}</textarea></label></div>` : ''}
      ${cols.length ? `<div class="sui-row"><label class="fld"><span>Chart</span><select id="dwType">${Object.entries(DATA_CHARTS).map(([k, l]) => o(k, ch.type, l)).join('')}</select></label>
        <label class="fld"><span>Show</span><select id="dwView">${o('both', ch.view || 'both', 'Chart and table')}${o('chart', ch.view, 'Chart only')}${o('table', ch.view, 'Table only')}</select></label></div>
      <div class="sui-row"><label class="fld"><span>Across (labels)</span><select id="dwX">${cols.map(k => o(k, ch.x)).join('')}</select></label>
        <label class="fld"><span>Values</span><select id="dwY" multiple size="${Math.min(4, cols.length)}">${cols.map(k => `<option value="${esc(k)}" ${(ch.y || []).includes(k) ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label></div>
      <div class="sui-row"><label class="fld"><span>Rows with the same label</span><select id="dwAgg">${Object.entries(DATA_AGG).map(([k, l]) => o(k, ch.agg || 'none', l)).join('')}</select></label>
        <label class="fld"><span>Order</span><select id="dwSort">${o('none', ch.sort || 'none', 'As they come')}${o('x', ch.sort, 'By label')}${o('desc', ch.sort, 'Largest first')}${o('asc', ch.sort, 'Smallest first')}</select></label>
        <label class="fld"><span>Top</span><input id="dwTop" type="number" min="0" value="${+ch.top || 0}" style="width:70px"></label></div>` : '<p class="se-note">Load data first; then choose the chart.</p>'}</div>`,
      [['Load and show', () => this.apply(id)], ...(d ? [['Chart only', () => this.apply(id, true)]] : []), ['Cancel']]);
    const kind = () => { const k = $('#dwKind').value; $('#dwCsv').hidden = k !== 'csv'; if ($('#dwDb')) $('#dwDb').hidden = k !== 'sqlite'; };
    $('#dwKind').onchange = kind; kind();
  },
  async apply(id, chartOnly = false) {
    const v = k => $(`#${k}`)?.value, title = v('dwTitle');
    const chart = $('#dwType') ? { type: v('dwType'), view: v('dwView'), x: v('dwX'), y: [...$('#dwY').selectedOptions].map(o => o.value), agg: v('dwAgg'), sort: v('dwSort'), top: +v('dwTop') || 0 } : null;
    const kind = v('dwKind'), src = v('dwSrc')?.trim(), db = v('dwDbFile')?.trim(), sql = v('dwSql')?.trim(), file = this.pickedFile;
    Wcfg.set(id, { title, ...(chart ? { chart } : {}) });
    if (chartOnly || kind === 'keep') return this.draw(id);
    try {
      if (kind === 'sqlite') { if (!db || !sql) return toast('Choose a database and write a query'); await this.set(id, await this.sql(db, sql), { kind: 'sqlite', db, sql, label: db.split('/').pop() }); }
      else if (file) { this.pickedFile = null; await this.set(id, /\.json$/i.test(file.name) ? this.from(await file.text()) : this.csv(await file.text()), { kind: 'csv', src: '', label: file.name }); }
      else if (src) await this.set(id, await this.csvFrom(src), { kind: 'csv', src, label: src.split(/[/?#]/).filter(Boolean).pop() });
      else return this.draw(id);
      if (chart) { const d = this.sets[id]; if (chart.x && d.columns.includes(chart.x)) { Wcfg.set(id, { chart }); this.draw(id); } }
    } catch (e) { toast(`Couldn’t load it: ${e.message}`); }
  },
};
W.data = { name: 'Data (table and chart)', multi: true, html: id => DataViz.html(id), config: (id, isNew) => DataViz.config(id, isNew) };
Bus.on('dash.rendered', () => DataViz.mountAll());
document.addEventListener('click', async e => {
  const s = e.target.closest('[data-dwsort]'); if (s) { const [id, c] = s.dataset.dwsort.split('|'), cur = (DataViz.sorted ||= {})[id]; DataViz.sorted[id] = { c, dir: cur?.c === c ? -cur.dir : 1 }; const el = s.closest('.dw'); DataViz.table(el, await DataViz.get(id), id); return; }
  const g = e.target.closest('[data-dwcfg]'); if (g) { e.stopPropagation(); return DataViz.config(g.dataset.dwcfg, true); }
  const f = e.target.closest('[data-dwfile]'); if (!f) return; e.stopPropagation();
  if (window.DriveDeckDesktop?.data) { const p = await DriveDeckDesktop.data.pick({ kind: f.dataset.dwfile }); if (p) { if (f.dataset.dwfile === 'db') $('#dwDbFile').value = p; else $('#dwSrc').value = p; } }
  else $('#dwFile').click();
}, true);
document.addEventListener('change', e => { if (e.target.id === 'dwFile' && e.target.files[0]) { DataViz.pickedFile = e.target.files[0]; $('#dwSrc').value = e.target.files[0].name; } });

/* ---------- Script actions ---------- */
const dataTarget = ev => (ev?.args?.[0] && W[wtype(ev.args[0])] ? ev.args[0] : DataViz.target());
Actions.define('data.csv', { group: 'Data', name: 'Load a CSV or JSON file into the data widget', arg: 'A link, or a path on this computer (StudioGen)', async run(v, say, ev) {
  const d = await DataViz.csvFrom(v); await DataViz.set(dataTarget(ev), d, { kind: 'csv', src: v, label: v.split(/[/?#]/).filter(Boolean).pop() }); return d.rows; } });
Actions.define('data.sql', { group: 'Data', name: 'Query a SQLite database (read-only)', arg: 'SQL; inputs: the database file, then values for each ? in order', raw: true, async run(v, say, ev = {}) {
  const [db, ...params] = ev.args || []; if (!db) throw new Error('Which database? Put its file as the first input');
  const d = await DataViz.sql(db, v, params); await DataViz.set(DataViz.target(), d, { kind: 'sqlite', db, sql: v, label: String(db).split('/').pop() }); return d.rows; } });
Actions.define('data.show', { group: 'Data', name: 'Show data in the data widget', arg: 'Rows as JSON, a {variable} from an earlier step, or CSV text', async run(v, say, ev) {
  const d = DataViz.from(v); if (!d.rows.length) throw new Error('No rows to show'); await DataViz.set(dataTarget(ev), d, { kind: 'script', label: 'from the script' }); return d.rows; } });
Actions.define('data.chart', { group: 'Data', name: 'Change the chart', arg: 'e.g. “bar of total by month”, or type=line x=month y=total,count agg=sum top=10 view=chart', run(v, say, ev) {
  const id = dataTarget(ev), ch = { ...(Wcfg.get(id).chart || {}) }, t = v.trim(), m = t.match(/^(\w+)\s+of\s+([\w ,]+?)\s+by\s+([\w ]+)$/i);
  if (m) Object.assign(ch, { type: m[1].toLowerCase(), y: m[2].split(/\s*,\s*|\s+and\s+/), x: m[3].trim() });
  else for (const [, k, val] of t.matchAll(/(\w+)=([^\s]+)/g)) ch[k] = k === 'y' ? val.split(',') : k === 'top' ? +val : val;
  if (DATA_CHARTS[t.toLowerCase()]) ch.type = t.toLowerCase();
  Wcfg.set(id, { chart: ch }); DataViz.draw(id); } });
Actions.define('data.summary', { group: 'Data', name: 'Summarize the data (for the assistant to say)', arg: '', async run(v, say, ev = {}) {
  const t = await DataViz.summary(dataTarget(ev)); if (!ev.keep) say(t); return t; } }); // kept with “as”: not said
