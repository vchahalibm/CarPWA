'use strict';
/* What watchers (js/watch.js) need from the Mac itself:
   - folders and files: only ones the user picked in the open dialog (remembered in watch-paths.json); listed (names, sizes,
     times; up to 3 levels, 3,000 entries) and text files read (512 KB), never written;
   - app windows: their names, and a picture of one (desktopCapturer; needs Screen Recording for StudioGen), read on the page
     by the screen model; nothing is kept;
   - the change history: one CSV per watcher in <userData>/watch-history, appended when a watcher tells something, shown in
     the data widget. */
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = ({ app, dialog, desktopCapturer, systemPreferences, getWindow }) => {
  const approvals = () => path.join(app.getPath('userData'), 'watch-paths.json');
  const allowed = () => { try { return JSON.parse(fs.readFileSync(approvals(), 'utf8')); } catch { return []; } };
  const ok = p => { const r = path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir())); return allowed().some(a => r === a || r.startsWith(a + path.sep)) ? r : null; };
  const histDir = () => path.join(app.getPath('userData'), 'watch-history');
  const histFile = id => { if (!/^[\w-]{1,40}$/.test(String(id))) throw new Error('Bad watcher id'); return path.join(histDir(), `${id}.csv`); };
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  async function files(op, a = {}) {
    if (op === 'pick') {
      const r = await dialog.showOpenDialog(getWindow() || undefined, { title: 'What should the watcher look at?', properties: [a.file ? 'openFile' : 'openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      const p = path.resolve(r.filePaths[0]), l = allowed(); if (!l.includes(p)) { l.push(p); fs.writeFileSync(approvals(), JSON.stringify(l, null, 2)); }
      return p;
    }
    const p = ok(a.path); if (!p) return { error: 'Pick that folder or file in StudioGen first (the watcher asks you once)' };
    if (op === 'list') {
      const out = [], depth = Math.min(3, +a.depth || 1);
      const st = fs.statSync(p); if (!st.isDirectory()) return { entries: [{ p: path.basename(p), size: st.size, mtime: st.mtimeMs, dir: false }] };
      const walk = (dir, d, rel) => { for (const n of fs.readdirSync(dir)) { if (out.length >= 3000 || n.startsWith('.')) continue; const f = path.join(dir, n); let s; try { s = fs.statSync(f); } catch { continue; }
        out.push({ p: rel + n, size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() }); if (s.isDirectory() && d < depth) walk(f, d + 1, rel + n + '/'); } };
      walk(p, 1, ''); return { entries: out };
    }
    if (op === 'read') { const s = fs.statSync(p); if (s.isDirectory()) return { error: 'That is a folder' }; const fd = fs.openSync(p, 'r'), b = Buffer.alloc(Math.min(s.size, 524288)); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); return { text: b.toString('utf8'), size: s.size, mtime: s.mtimeMs }; }
    return null;
  }

  async function windows(op, a = {}) {
    const access = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
    if (op === 'status') return access;
    if (op === 'list') { const l = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }); return { access, list: l.map(s => s.name).filter(n => n && !/^StudioGen$/.test(n)) }; }
    if (op === 'shot') {
      const l = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1200 }, fetchWindowIcons: false });
      const q = String(a.name || '').toLowerCase(), s = l.find(x => x.name.toLowerCase() === q) || l.find(x => x.name.toLowerCase().includes(q));
      if (!s) return { access, error: `No window called “${a.name}” is open` };
      if (s.thumbnail.isEmpty()) return { access, error: 'StudioGen may not see other windows yet: allow it in System Settings › Privacy & Security › Screen Recording' };
      const z = s.thumbnail.getSize(); return { access, name: s.name, w: z.width, h: z.height, png: s.thumbnail.toDataURL() };
    }
    return null;
  }

  function history(op, a = {}) {
    const f = histFile(a.id);
    if (op === 'add') {
      fs.mkdirSync(histDir(), { recursive: true });
      const cols = ['time', 'watcher', 'headline', 'value', 'items'], r = a.row || {};
      const line = cols.map(c => cell(r[c])).join(',') + '\n';
      if (!fs.existsSync(f)) fs.writeFileSync(f, cols.join(',') + '\n');
      fs.appendFileSync(f, line);
      const s = fs.statSync(f); if (s.size > 5e6) { const t = fs.readFileSync(f, 'utf8').split('\n'); fs.writeFileSync(f, [t[0], ...t.slice(-20000)].join('\n')); } /* the newest 20,000 rows */
      return true;
    }
    if (op === 'read') { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
    if (op === 'clear') { try { fs.unlinkSync(f); } catch {} return true; }
    if (op === 'path') return f;
    return null;
  }
  return { files, windows, history };
};
