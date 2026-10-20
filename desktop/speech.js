'use strict';
/* Apple's speech recognizer for the page (window.DriveDeckDesktop.speech; js/voice.js makes it a Web Speech API
   recognizer). The helper desktop/speech/bin/sg-speech (built by speech/build.sh, packaged as Resources/sg-speech) is
   started on the first use and kept running; it speaks JSON lines (see speech/main.swift). Only the main window gets
   its events. */
const path = require('path'), fs = require('fs'), { spawn, execFileSync } = require('child_process');

module.exports = ({ app, getWindow }) => {
  const bin = app.isPackaged ? path.join(process.resourcesPath, 'sg-speech') : path.join(__dirname, 'speech', 'bin', 'sg-speech');
  let proc = null, buf = '';
  const send = m => getWindow()?.webContents.send('dd:speech', m);
  function helper() {
    if (proc) return proc;
    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { send(JSON.parse(line)); } catch {} }
    });
    proc.stderr.on('data', d => console.warn('speech:', String(d).trim()));
    proc.on('exit', code => { proc = null; buf = ''; send({ ev: 'error', error: 'audio-capture', message: `The speech helper stopped (${code})` }); send({ ev: 'end' }); });
    proc.on('error', e => { proc = null; send({ ev: 'error', error: 'service-not-allowed', message: e.message }); });
    return proc;
  }
  // Which languages this Mac recognises on the device (no permission needed to ask); only those are used.
  const LANGS = ['en-IN', 'en-US', 'en-GB', 'hi-IN', 'kn-IN', 'ta-IN', 'te-IN', 'mr-IN'];
  let local = null;
  const probe = () => { if (local) return local; try { const m = JSON.parse(execFileSync(bin, ['--probe', ...LANGS], { timeout: 5000 }).toString()); local = Object.keys(m).filter(k => m[k]); } catch { local = []; } return local; };
  const cmd = o => { try { helper().stdin.write(JSON.stringify(o) + '\n'); return true; } catch (e) { return false; } };
  return {
    available: () => process.platform === 'darwin' && fs.existsSync(bin),
    local: () => (process.platform === 'darwin' && fs.existsSync(bin) ? probe() : []),
    start: o => cmd({ cmd: 'start', id: +o?.id || 0, lang: String(o?.lang || 'en-IN'), continuous: !!o?.continuous,
      context: Array.isArray(o?.context) ? o.context.map(String).slice(0, 100) : [], pause: Math.min(3, Math.max(0.4, +o?.pause || 0.9)) }),
    stop: () => proc ? cmd({ cmd: 'stop' }) : false,
    abort: () => proc ? cmd({ cmd: 'abort' }) : false,
    quit: () => { try { proc?.kill(); } catch {} },
  };
};
