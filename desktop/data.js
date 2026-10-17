'use strict';
/* Data for the page's data widget and scripts (js/dataviz.js): SQLite databases (read-only, Node's built-in node:sqlite in a
   worker thread, values bound as parameters so nothing heard can change the query's meaning), and text files (CSV, JSON) on
   this computer.
   - Scripts can name any path, so each file needs the user's yes once (a native dialog), remembered in data-approvals.json;
     a file the user picks in the open dialog counts as yes.
   - At most 50,000 rows and 30 s per query; 50 MB per text file. */
const { Worker } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKER = `const { parentPort, workerData: w } = require('worker_threads');
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(w.file, { readOnly: true }), st = db.prepare(w.sql), rows = st.all(...w.params);
  let columns = rows.length ? Object.keys(rows[0]) : []; try { if (!columns.length) columns = st.columns().map(c => c.name); } catch {}
  db.close();
  const clean = v => v instanceof Uint8Array ? '[' + v.length + ' bytes]' : typeof v === 'bigint' ? Number(v) : v;
  parentPort.postMessage({ ok: true, columns, total: rows.length, rows: rows.slice(0, w.limit).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clean(v)]))) });
} catch (e) { parentPort.postMessage({ ok: false, err: e.message }); }`;

module.exports = ({ app, dialog, getWindow }) => {
  const file = () => path.join(app.getPath('userData'), 'data-approvals.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
  const grant = p => { const A = load(); A[p] = new Date().toISOString(); fs.writeFileSync(file(), JSON.stringify(A, null, 2)); };
  const resolve = p => path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));
  async function approve(p, what) {
    if (load()[p]) return true;
    const { response } = await dialog.showMessageBox(getWindow() || undefined, {
      type: 'question', buttons: ['Allow', 'Don’t allow'], defaultId: 1, cancelId: 1, noLink: true,
      message: `Let scripts read ${what}?`, detail: `${p}\n\nScripts and the data widget can then read it (never change it). Only allow files you mean to share with your scripts.`,
    });
    if (response !== 0) return false;
    grant(p); return true;
  }
  return {
    async query({ file: f, sql, params = [], limit = 50000 } = {}) {
      const p = resolve(f);
      if (!fs.existsSync(p)) return { ok: false, err: `No database at ${p}` };
      if (!sql?.trim()) return { ok: false, err: 'No query' };
      if (!await approve(p, 'this database')) return { ok: false, err: 'Not allowed', denied: true };
      const t0 = Date.now();
      return new Promise(res => {
        const w = new Worker(WORKER, { eval: true, workerData: { file: p, sql, params: params.map(v => v == null ? null : typeof v === 'number' ? v : String(v)), limit } });
        const kill = setTimeout(() => { w.terminate(); res({ ok: false, err: 'The query took longer than 30 s' }); }, 30000);
        w.once('message', m => { clearTimeout(kill); w.terminate(); res({ ...m, ms: Date.now() - t0 }); });
        w.once('error', e => { clearTimeout(kill); res({ ok: false, err: e.message }); });
      });
    },
    async read({ file: f } = {}) {
      const p = resolve(f);
      if (!fs.existsSync(p)) return { ok: false, err: `No file at ${p}` };
      if (fs.statSync(p).size > 50e6) return { ok: false, err: 'The file is over 50 MB' };
      if (!await approve(p, 'this file')) return { ok: false, err: 'Not allowed', denied: true };
      return { ok: true, text: fs.readFileSync(p, 'utf8'), name: path.basename(p) };
    },
    /** The open dialog: a database or a data file; choosing it is the user's yes. */
    async pick({ kind = 'any' } = {}) {
      const filters = kind === 'db' ? [{ name: 'SQLite database', extensions: ['sqlite', 'sqlite3', 'db', 'db3'] }] : kind === 'text' ? [{ name: 'CSV or JSON', extensions: ['csv', 'tsv', 'json', 'txt'] }] : [];
      const r = await dialog.showOpenDialog(getWindow() || undefined, { properties: ['openFile'], filters: [...filters, { name: 'All files', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      grant(r.filePaths[0]); return r.filePaths[0];
    },
  };
};
