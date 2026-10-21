'use strict';
/* The link to DriveGen (the web app on an iPhone or iPad): a small API on this Mac, shared on the user's tailnet.
   - Listens on 127.0.0.1 only (port 47800); `tailscale serve` puts it at https://<this Mac>.<tailnet>.ts.net with a
     trusted certificate, reachable only from the user's own Tailscale devices (from anywhere, also the car on mobile data).
   - Pairing: StudioGen shows a one-time 6-digit code (10 minutes, 5 tries); DriveGen sends it with its name and gets a
     token of its own (kept here as a SHA-256 in link-devices.json; Revoke deletes it).
   - With a token: GET /api/offers (scripts the user made available to paired devices), POST /api/run { script, vars }
     and POST /api/say { text } (what was said, for StudioGen's running interactive script), GET /api/jobs/<id>?wait=25
     for the outcome { state, said, result, rows }. The page does the work (ask() → the renderer, js/link.js).
   - CORS: any origin may ask (DriveGen's address can change); nothing works without a token but /api/hello and /api/pair. */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 47800;
const TS = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'];

module.exports = ({ app, ask }) => {
  const file = () => path.join(app.getPath('userData'), 'link-devices.json');
  const devices = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; } };
  const save = l => fs.writeFileSync(file(), JSON.stringify(l, null, 2));
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  let pairing = null, server = null, listening = false;
  const jobs = new Map();

  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const body = req => new Promise(r => { let b = ''; req.on('data', d => { if (b.length < 1e6) b += d; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
  const who = req => { const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!t) return null; const h = sha(t), l = devices(), d = l.find(x => x.hash === h); if (d) { d.seen = new Date().toISOString(); save(l); } return d || null; };

  async function handle(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/api/hello') return send(res, 200, { app: 'StudioGen', name: os.hostname().replace(/\.local$/, ''), version: app.getVersion() });
    if (p === '/api/pair' && req.method === 'POST') {
      const b = await body(req);
      if (!pairing || Date.now() > pairing.until) return send(res, 403, { error: 'No pairing code is shown: open StudioGen › Settings › Connections › Pair a device' });
      if (String(b.code || '').replace(/\D/g, '') !== pairing.code) { if (++pairing.tries >= 5) pairing = null; return send(res, 403, { error: 'That code isn’t right' }); }
      const token = crypto.randomBytes(24).toString('base64url'), d = { id: crypto.randomBytes(4).toString('hex'), name: String(b.device || 'A device').slice(0, 60), hash: sha(token), paired: new Date().toISOString() };
      save([...devices(), d]); pairing = null; ask('paired', { name: d.name }).catch(() => {});
      return send(res, 200, { token, name: os.hostname().replace(/\.local$/, '') });
    }
    const d = who(req); if (!d) return send(res, 401, { error: 'Not paired (or revoked): pair again from Settings › Connections' });
    if (p === '/api/offers') return send(res, 200, await ask('offers', {}).catch(e => ({ error: e.message })));
    if (p === '/api/ai' && req.method === 'POST') return send(res, 200, await ask('ai', await body(req)).catch(e => ({ error: e.message }))); // the on-device model, for this phone
    if ((p === '/api/run' || p === '/api/say') && req.method === 'POST') {
      const b = await body(req), id = crypto.randomBytes(5).toString('hex'), j = { id, state: 'running', from: d.name, started: Date.now() };
      jobs.set(id, j);
      ask(p === '/api/run' ? 'run' : 'say', { ...b, from: d.name }).then(r => Object.assign(j, { state: r?.error ? 'failed' : 'done', ...r }), e => Object.assign(j, { state: 'failed', error: e.message })).finally(() => { j.ended = Date.now(); setTimeout(() => jobs.delete(id), 600000); });
      return send(res, 200, { job: id });
    }
    const m = p.match(/^\/api\/jobs\/(\w+)$/);
    if (m) {
      const j = jobs.get(m[1]); if (!j) return send(res, 404, { error: 'No such job' });
      const wait = Math.min(25, +u.searchParams.get('wait') || 0) * 1000, t0 = Date.now();
      while (j.state === 'running' && Date.now() - t0 < wait) await new Promise(r => setTimeout(r, 250));
      return send(res, 200, j);
    }
    send(res, 404, { error: 'Not found' });
  }

  const tsBin = () => TS.find(b => fs.existsSync(b));
  const ts = args => new Promise(r => { const b = tsBin(); if (!b) return r({ ok: false, err: 'Tailscale isn’t installed' }); execFile(b, args, { timeout: 15000 }, (e, out, err) => r({ ok: !e, out: String(out), err: String(err || e?.message || '') })); });

  return {
    start() {
      if (server) return;
      server = http.createServer((q, s) => handle(q, s).catch(e => send(s, 500, { error: e.message })));
      server.on('error', e => { console.warn('link', e.message); listening = false; });
      server.listen(PORT, '127.0.0.1', () => { listening = true; });
    },
    /** What the Connections screen shows: the API, Tailscale (installed, signed in, this Mac's address, sharing). */
    async status() {
      const s = { listening, port: PORT, tailscale: !!tsBin(), devices: devices().map(({ hash, ...d }) => d), pairing: pairing && Date.now() < pairing.until ? { code: pairing.code, until: pairing.until } : null };
      if (s.tailscale) {
        const st = await ts(['status', '--json']); try { const j = JSON.parse(st.out); s.signedIn = j.BackendState === 'Running'; s.dns = (j.Self?.DNSName || '').replace(/\.$/, ''); } catch { s.signedIn = false; }
        const sv = await ts(['serve', 'status', '--json']); try { const j = JSON.parse(sv.out || '{}'); s.sharing = JSON.stringify(j).includes(`127.0.0.1:${PORT}`); } catch { s.sharing = false; }
        if (s.dns) s.url = `https://${s.dns}`;
      }
      return s;
    },
    /** Share the API on the tailnet (https on this Mac's tailnet name), or stop sharing. */
    async share(on) { const r = await ts(on ? ['serve', '--bg', `http://127.0.0.1:${PORT}`] : ['serve', 'reset']); return { ok: r.ok, err: r.err.trim().split('\n').slice(-3).join(' ') }; },
    pair() { pairing = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: Date.now() + 600000, tries: 0 }; return pairing; },
    revoke(id) { save(devices().filter(d => d.id !== id)); return true; },
  };
};
