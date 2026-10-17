'use strict';
/* Tasks on this computer, for scripts (the page's `os.*` actions, js/ostasks.js): AppleScript, JavaScript for Automation,
   a macOS Shortcut by name, or a shell command. Run here in the main process, never in a web page.
   - The code never has script values pasted into it: inputs arrive as arguments (AppleScript `on run argv`, JXA
     `function run(argv)`, shell "$1"…; a Shortcut gets the first input), so words someone said can't become code.
   - Every piece of code needs the user's yes the first time, in a native dialog that shows it ("Run once" or
     "Always allow this code"); always-allowed code is remembered by its SHA-256 in task-approvals.json, so changed or
     imported code asks again.
   - A time limit (default 60 s, at most 10 min) and stop(id). Output: { ok, out, err, code, ms }. */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = ({ app, dialog, getWindow }) => {
  const file = () => path.join(app.getPath('userData'), 'task-approvals.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
  const running = new Map();
  const KINDS = {
    applescript: { name: 'AppleScript', cmd: (code, args) => ['/usr/bin/osascript', ['-e', code, ...args]] },
    jxa: { name: 'JavaScript for Automation', cmd: (code, args) => ['/usr/bin/osascript', ['-l', 'JavaScript', '-e', code, ...args]] },
    shortcut: { name: 'Shortcut', cmd: (code, args) => ['/usr/bin/shortcuts', ['run', code, ...(args[0] != null ? ['-i', args[0]] : [])]] },
    shell: { name: 'Shell command', cmd: (code, args) => ['/bin/zsh', ['-c', code, 'studiogen-task', ...args]] },
  };
  const hash = (kind, code) => crypto.createHash('sha256').update(`${kind}\n${code}`).digest('hex');

  /** The user's yes for this code: remembered ("always"), or asked now in a native dialog. */
  async function approve(kind, code, label) {
    const h = hash(kind, code), A = load();
    if (A[h]) return true;
    const win = getWindow(), shown = code.length > 1800 ? `${code.slice(0, 1800)}\n…` : code;
    const { response } = await dialog.showMessageBox(win || undefined, {
      type: 'warning', buttons: ['Run once', 'Always allow this code', 'Don’t run'], defaultId: 2, cancelId: 2, noLink: true,
      message: `A script wants to run ${KINDS[kind].name} on this Mac${label ? `: “${label}”` : ''}`,
      detail: `${shown}\n\nIt can do anything you can do on this computer. Only allow code you wrote or trust.`,
    });
    if (response === 2) return false;
    if (response === 1) { A[h] = { kind, label: label || '', at: new Date().toISOString() }; fs.writeFileSync(file(), JSON.stringify(A, null, 2)); }
    return true;
  }

  async function run({ id, kind, code, args = [], label = '', timeout = 60 } = {}) {
    if (process.platform !== 'darwin' && kind !== 'shell') return { ok: false, err: `${KINDS[kind]?.name || kind} needs a Mac` };
    if (!KINDS[kind] || typeof code !== 'string' || !code.trim()) return { ok: false, err: 'Nothing to run' };
    if (!await approve(kind, code, label)) return { ok: false, err: 'Not allowed', denied: true };
    const [bin, argv] = KINDS[kind].cmd(code, args.map(a => String(a ?? '')));
    const t0 = Date.now();
    return new Promise(res => {
      const p = spawn(bin, argv, { env: { ...process.env, LANG: 'en_US.UTF-8' } });
      let out = '', err = ''; const cap = 2e6;
      p.stdout.on('data', d => { if (out.length < cap) out += d; });
      p.stderr.on('data', d => { if (err.length < cap) err += d; });
      const kill = setTimeout(() => { err += `\nStopped after ${timeout} s`; p.kill('SIGTERM'); }, Math.min(600, Math.max(1, +timeout || 60)) * 1000);
      if (id) running.set(id, p);
      const done = (code, e) => { clearTimeout(kill); running.delete(id); res({ ok: code === 0 && !e, out: out.replace(/\n$/, ''), err: (e?.message || err).trim(), code, ms: Date.now() - t0 }); };
      p.on('error', e => done(-1, e)); p.on('close', c => done(c));
    });
  }
  return {
    run,
    stop: id => { const p = running.get(id); if (p) { p.kill('SIGTERM'); return true; } return false; },
    approvals: () => Object.entries(load()).map(([h, a]) => ({ hash: h, ...a })),
    forget: h => { const A = load(); if (h === 'all') { fs.writeFileSync(file(), '{}'); return true; } delete A[h]; fs.writeFileSync(file(), JSON.stringify(A, null, 2)); return true; },
  };
};
