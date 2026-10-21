'use strict';
/* Apple's on-device language model for the page (window.DriveDeckDesktop.ai: js/brain.js › MacAI). The helper
   desktop/ai/bin/sg-ai (built by ai/build.sh, packaged as Resources/sg-ai) is started on first use and kept running;
   it speaks JSON lines (see ai/main.swift). */
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');

module.exports = ({ app }) => {
  const bin = app.isPackaged ? path.join(process.resourcesPath, 'sg-ai') : path.join(__dirname, 'ai', 'bin', 'sg-ai');
  let proc = null, buf = '', seq = 0, status = null;
  const waits = new Map(), statusWaits = [];
  function helper() {
    if (proc) return proc;
    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin.on('error', () => {});
    proc.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.ev === 'status') { status = m; statusWaits.splice(0).forEach(f => f(m)); continue; }
        const w = waits.get(m.id); if (!w) continue; waits.delete(m.id); clearTimeout(w.t);
        m.ev === 'done' ? w.res(m.json != null ? { json: m.json } : { text: m.text }) : w.rej(new Error(m.error || 'failed'));
      }
    });
    proc.stderr.on('data', d => console.warn('ai:', String(d).trim()));
    proc.on('exit', code => { proc = null; buf = ''; for (const w of waits.values()) { clearTimeout(w.t); w.rej(new Error(`The model helper stopped (${code})`)); } waits.clear(); });
    return proc;
  }
  const send = o => helper().stdin.write(JSON.stringify(o) + '\n');
  return {
    available: () => process.platform === 'darwin' && fs.existsSync(bin),
    status: () => status?.available ? Promise.resolve(status) : new Promise(res => { statusWaits.push(res); send({ cmd: 'status' }); setTimeout(() => res({ available: false, reason: 'no answer' }), 5000); }),
    ask(o) {
      const id = ++seq;
      return new Promise((res, rej) => {
        waits.set(id, { res, rej, t: setTimeout(() => { waits.delete(id); rej(new Error('The model took too long')); }, 60000) });
        send({ cmd: 'ask', id, instructions: String(o?.instructions || '').slice(0, 12000), prompt: String(o?.prompt || '').slice(0, 12000),
          ...(o?.schema && typeof o.schema === 'object' ? { schema: o.schema } : {}), temperature: +o?.temperature >= 0 ? +o.temperature : 0.2, max: Math.min(1500, +o?.max || 400) });
      });
    },
    quit: () => { try { proc?.kill(); } catch {} },
  };
};
