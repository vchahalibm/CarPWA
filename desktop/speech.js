'use strict';
/* Apple's speech recognizer for the page (window.DriveDeckDesktop.speech; js/voice.js makes it a Web Speech API
   recognizer). The helper desktop/speech/bin/sg-speech (built by speech/build.sh, packaged as Resources/sg-speech) is
   started on the first use and kept running; it speaks JSON lines (see speech/main.swift). Only the main window gets
   its events. */
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');

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
  const cmd = o => { try { helper().stdin.write(JSON.stringify(o) + '\n'); return true; } catch (e) { return false; } };
  return {
    available: () => process.platform === 'darwin' && fs.existsSync(bin),
    start: o => cmd({ cmd: 'start', id: +o?.id || 0, lang: String(o?.lang || 'en-IN'), continuous: !!o?.continuous, onDevice: o?.onDevice !== false,
      context: Array.isArray(o?.context) ? o.context.map(String).slice(0, 100) : [], pause: Math.min(3, Math.max(0.4, +o?.pause || 0.9)) }),
    stop: () => proc ? cmd({ cmd: 'stop' }) : false,
    abort: () => proc ? cmd({ cmd: 'abort' }) : false,
    quit: () => { try { proc?.kill(); } catch {} },
  };
};
