'use strict';
/* StudioGen updates, from the repository's GitHub release "updates" (published by .github/workflows/desktop.yml).
   Two layers:
   - Web: the app's own files (index.html, js/, css/…) as one small signed bundle, and the vendored libraries (vendor/) as
     another, downloaded only when they change. Unpacked under userData/updates and served instead of the copy inside the
     app; a reload switches to them. Most changes arrive this way.
   - Shell: the Electron app itself (main.js, preload.js, Electron), only when its version goes up. The zipped app is
     downloaded, unpacked with ditto and swapped into place when you quit or restart; the old copy is kept until the new one
     has started (it then removes it).
   Security: update.json (versions, file names, sizes, SHA-256s) is signed in CI with an Ed25519 key; the app checks the
   signature with the public key below before reading it, then every download's size and SHA-256. Only HTTPS from GitHub;
   never a lower version than what's running; archive paths can't leave their folder. Nothing runs before it's verified. */
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto'), zlib = require('zlib'), { spawn, execFile } = require('child_process');

// Electron's fs sees inside .asar archives, so it can't delete an app bundle: use the plain one for that.
let ofs = fs; try { ofs = require('original-fs'); } catch {}
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYsTkwP8nz3+8la2sE6MzAgyoptMIz3BSYpY0bah7drw=
-----END PUBLIC KEY-----`;
// STUDIOGEN_FEED (testing): another feed, e.g. http://localhost:8765/. It still has to be signed with the key below.
const FEED = process.env.STUDIOGEN_FEED || 'https://github.com/vchahalibm/CarPWA/releases/download/updates/';
const LOCAL = !!process.env.STUDIOGEN_FEED && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(process.env.STUDIOGEN_FEED);
const HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|github-releases\.githubusercontent\.com)$/;
const MAX = 400e6, EVERY = 4 * 3600e3;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const newer = (a, b) => { const p = v => String(v).split('.').map(n => parseInt(n, 10) || 0); const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* Big files that aren't shipped in the app or in updates: avatars and the MediaPipe models. They're downloaded the first time
   the page asks for one (from GitHub, at the commit the app's files were built from), checked against the SHA-256 listed in
   web-version.json (inside the signed web files) and kept in userData/assets. */
const LAZY = /^vendor\/(models\/[^/]+\.vrm|mediapipe\/models\/[^/]+\.task|mediapipe\/wasm\/[^/]+\.wasm)$/;
const REPO_RAW = 'https://raw.githubusercontent.com/vchahalibm/CarPWA/';
/** The hash CI gives the vendor folder: SHA-256 over "path\tsha256\n" for every file, sorted (also in tools/release/make-update.mjs).
    The lazy files don't count: they aren't in the app or the updates. */
async function folderHash(dir) {
  const out = [];
  const walk = async (d, rel) => { for (const e of await fsp.readdir(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(p, r); else if (e.isFile() && !LAZY.test(`vendor/${r}`)) out.push(`${r}\t${sha256(await fsp.readFile(p))}\n`);
  } };
  await walk(dir, '');
  return sha256(out.sort().join(''));
}

/** Unpack a .tar.gz (ustar/pax, as bsdtar or GNU tar write it) into dir; refuses paths that would leave it. */
function untar(gz, dir) {
  const buf = zlib.gunzipSync(gz); let off = 0, pax = null;
  const str = (b, s, n) => b.toString('utf8', s, s + n).replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512); if (h.every(x => x === 0)) break;
    let name = str(h, 0, 100); const prefix = str(h, 345, 155); if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(str(h, 124, 12).trim() || '0', 8), type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(off + 512, off + 512 + size); off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { pax = {}; for (const line of body.toString('utf8').split('\n')) { const m = line.match(/^\d+ ([^=]+)=(.*)$/); if (m) pax[m[1]] = m[2]; } continue; }
    if (type === 'g' || type === 'L' || type === 'K') { pax = null; continue; }
    if (pax?.path) name = pax.path; pax = null;
    name = name.replace(/^\.\//, ''); if (!name || name.split('/').includes('..') || path.isAbsolute(name) || name.startsWith('._') || name.includes('/._')) continue;
    const dest = path.join(dir, name); if (!dest.startsWith(dir + path.sep)) continue;
    if (type === '5') fs.mkdirSync(dest, { recursive: true });
    else if (type === '0' || type === '\0' || type === '7') { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, body); }
  }
}

module.exports = function updater({ app, net, bundled, log = console.log }) {
  const root = path.join(app.getPath('userData'), 'updates'), stateFile = path.join(root, 'state.json');
  const shellVersion = app.getVersion();
  const bundledInfo = readJson(path.join(bundled, 'web-version.json')) || { version: 0 };
  let state = readJson(stateFile) || {}, latest = null, checking = null, listeners = new Set(), status = { phase: 'idle' };
  const save = () => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); };
  const emit = s => { status = { ...status, ...s }; for (const f of listeners) try { f(status); } catch {} };
  const ok = d => d && fs.existsSync(path.join(d, '.verified'));

  /* ---------- Which web files to serve ---------- */
  /** { app, vendor, version }: the newest verified web files this shell can run, else the ones inside the app. */
  function active() {
    const W = state.web, V = state.vendor;
    if (W && ok(W.dir) && W.version > (bundledInfo.version || 0) && !newer(W.minShell || '0', shellVersion)) {
      const need = W.vendorHash, vendor = V && V.hash === need && ok(V.dir) ? path.join(V.dir, 'vendor') : need === bundledInfo.vendorHash || !need ? path.join(bundled, 'vendor') : null;
      if (vendor) return { app: W.dir, vendor, version: W.version };
      log('update: downloaded web files need vendor files that are missing: using the built-in ones');
    }
    return { app: bundled, vendor: path.join(bundled, 'vendor'), version: bundledInfo.version || 0 };
  }

  /* ---------- Downloads, verified ---------- */
  async function get(url, { max = MAX, json = false } = {}) {
    const res = await net.fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store', redirect: 'follow' });
    const host = new URL(res.url || url).hostname;
    if (!res.ok) throw new Error(`${res.status} for ${url.split('/').pop()}`);
    if (!(LOCAL && /^(localhost|127\.0\.0\.1)$/.test(host)) && (!HOSTS.test(host) || !String(res.url || url).startsWith('https:'))) throw new Error(`refused: ${host}`);
    const len = +res.headers.get('content-length') || 0; if (len > max) throw new Error('too big');
    const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > max) throw new Error('too big');
    return json ? buf.toString('utf8') : buf;
  }
  async function asset(entry, label) {
    if (!entry?.file || !/^[\w.-]+$/.test(entry.file)) throw new Error(`bad ${label} entry`);
    emit({ phase: 'downloading', what: label });
    const buf = await get(FEED + entry.file, { max: Math.min(MAX, (entry.size || MAX) + 1) });
    if (entry.size && buf.length !== entry.size) throw new Error(`${label}: size differs`);
    if (sha256(buf) !== entry.sha256) throw new Error(`${label}: checksum differs`);
    return buf;
  }
  /** update.json, only if its signature is good. */
  async function manifest() {
    const [body, sig] = await Promise.all([get(FEED + 'update.json', { max: 1e6, json: true }), get(FEED + 'update.json.sig', { max: 4096, json: true })]);
    const good = crypto.verify(null, Buffer.from(body, 'utf8'), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(sig.trim(), 'base64'));
    if (!good) throw new Error('update.json: signature does not verify');
    const m = JSON.parse(body); if (m.app !== 'StudioGen') throw new Error('update.json is for another app');
    return m;
  }

  /* ---------- Web layer ---------- */
  async function webUpdate(m) {
    const W = m.web, cur = active();
    if (!W || !(W.version > cur.version)) return false;
    if (newer(W.minShell || '0', shellVersion)) { log(`update: web ${W.version} needs StudioGen ${W.minShell}`); return false; }
    // Vendor files: only when they changed.
    const haveVendor = (state.vendor?.hash === W.vendor?.hash && ok(state.vendor.dir)) || W.vendor?.hash === (bundledInfo.vendorHash ||= await folderHash(path.join(bundled, 'vendor')));
    if (W.vendor?.hash && !haveVendor) {
      const buf = await asset(W.vendor, 'libraries'), dir = path.join(root, `vendor-${W.vendor.hash.slice(0, 16)}`), tmp = dir + '.part';
      await fsp.rm(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); untar(buf, tmp);
      if (await folderHash(path.join(tmp, 'vendor')) !== W.vendor.hash) throw new Error('libraries: contents differ');
      fs.writeFileSync(path.join(tmp, '.verified'), W.vendor.hash); await fsp.rm(dir, { recursive: true, force: true }); await fsp.rename(tmp, dir);
      state.vendor = { hash: W.vendor.hash, dir }; save();
    }
    const buf = await asset(W.app, 'app files'), dir = path.join(root, `web-${W.version}`), tmp = dir + '.part';
    await fsp.rm(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); untar(buf, tmp);
    if (!fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('app files: no index.html');
    fs.writeFileSync(path.join(tmp, '.verified'), String(W.version)); await fsp.rm(dir, { recursive: true, force: true }); await fsp.rename(tmp, dir);
    state.web = { version: W.version, dir, minShell: W.minShell, vendorHash: W.vendor?.hash || '', commit: W.commit || '' }; save();
    log(`update: web files ${W.version} ready`);
    return true;
  }

  /* ---------- Shell layer ---------- */
  /* ---------- Lazy files ---------- */
  const fetching = new Map();
  /** The path of a lazy file on this computer, downloading and checking it first if needed (null if it isn't one). */
  function lazyFile(rel) {
    rel = rel.replace(/^\//, ''); if (!LAZY.test(rel)) return null;
    const info = (readJson(path.join(active().app, 'web-version.json')) || bundledInfo), want = info.lazy?.[rel];
    const file = path.join(app.getPath('userData'), 'assets', rel);
    if (fs.existsSync(file) && (!want || fs.statSync(file).size === want.size)) return Promise.resolve(file);
    if (!want || !info.commit) return Promise.reject(new Error(`${rel}: not listed`));
    if (fetching.has(rel)) return fetching.get(rel);
    const p = (async () => {
      emit({ phase: 'downloading', what: rel.split('/').pop() }); log(`asset: downloading ${rel}`);
      const res = await net.fetch(`${REPO_RAW}${info.commit}/${rel}`); if (!res.ok) throw new Error(`${res.status} for ${rel}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== want.size || sha256(buf) !== want.sha256) throw new Error(`${rel}: checksum differs`);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.part', buf); fs.renameSync(file + '.part', file);
      emit({ phase: 'idle', what: '' }); log(`asset: ${rel} ready (${Math.round(buf.length / 1e6)} MB)`); return file;
    })().finally(() => fetching.delete(rel));
    fetching.set(rel, p); return p;
  }

  const appBundle = () => { const p = path.resolve(process.execPath, '../../..'); return app.isPackaged && p.endsWith('.app') ? p : null; };
  async function shellUpdate(m) {
    const S = m.shell, entry = S?.[process.arch];
    if (!S || !newer(S.version, shellVersion) || !entry) return false;
    if (state.shell?.version === S.version && ok(state.shell.dir)) return true; // already downloaded
    const buf = await asset(entry, `StudioGen ${S.version}`), dir = path.join(root, `shell-${S.version}`), zip = path.join(root, `shell-${S.version}.zip`);
    await ofs.promises.rm(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); await fsp.writeFile(zip, buf);
    await new Promise((res, rej) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], e => e ? rej(e) : res()));
    await fsp.rm(zip, { force: true });
    const name = fs.readdirSync(dir).find(f => f.endsWith('.app')); if (!name) throw new Error('the download has no app in it');
    const info = path.join(dir, name, 'Contents', 'Info.plist');
    if (!fs.readFileSync(info, 'utf8').includes(`<string>${S.version}</string>`)) throw new Error('the downloaded app has another version');
    fs.writeFileSync(path.join(dir, '.verified'), S.version);
    state.shell = { version: S.version, dir, app: path.join(dir, name) }; save();
    log(`update: StudioGen ${S.version} ready to install`);
    return true;
  }
  /** Can this copy of the app replace itself (in a folder you can write to)? */
  function canSwap() { const a = appBundle(); if (!a) return false; try { fs.accessSync(path.dirname(a), fs.constants.W_OK); fs.accessSync(a, fs.constants.W_OK); return true; } catch { return false; } }
  /** After quitting: move the new app into place, keep the old one beside it (the new one removes it once it runs), open it. */
  function installShell(relaunch) {
    const S = state.shell, a = appBundle(); if (!S || !ok(S.dir) || !a || !canSwap()) return false;
    const old = `${a}.old`, script = `
      while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
      rm -rf "$OLD"; mv "$APP" "$OLD" || exit 1
      if mv "$NEW" "$APP"; then /usr/bin/xattr -cr "$APP"; else mv "$OLD" "$APP"; fi
      ${relaunch ? 'open "$APP"' : ''}`;
    spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore', env: { ...process.env, APP: a, OLD: old, NEW: S.app } }).unref();
    state.installing = S.version; delete state.shell; save();
    log(`update: installing StudioGen ${S.version}${relaunch ? ' and restarting' : ' after quitting'}`);
    return true;
  }
  /** Started fine: remove what the last update left behind. */
  function cleanup() {
    const a = appBundle(); if (a && ofs.existsSync(`${a}.old`)) ofs.rm(`${a}.old`, { recursive: true, force: true }, e => e && log('update: old copy not removed', e.message));
    if (state.installing) { log(`update: now running StudioGen ${shellVersion}`); delete state.installing; save(); }
    try { const keep = new Set([state.web?.dir, state.vendor?.dir, state.shell?.dir].filter(Boolean).map(d => path.basename(d)));
      for (const f of fs.readdirSync(root)) if (/^(web|vendor|shell)-/.test(f) && !keep.has(f)) ofs.rm(path.join(root, f), { recursive: true, force: true }, () => {}); } catch {}
  }

  /* ---------- Checking ---------- */
  async function check(manual) {
    if (!app.isPackaged) { emit({ phase: 'dev', error: '' }); return status; }
    return checking ||= (async () => {
      emit({ phase: 'checking', error: '' });
      try {
        latest = await manifest();
        const shell = await shellUpdate(latest).catch(e => { log('update: shell', e.message); emit({ shellError: e.message }); return false; });
        const before = active().version, web = await webUpdate(latest), after = active().version;
        emit({ phase: 'idle', checkedAt: Date.now(), latest: { web: latest.web?.version, shell: latest.shell?.version, notes: latest.notes || '' },
          webReady: web || (after > status.serving), shellReady: shell ? state.shell?.version : null, canSwap: canSwap(), manual: !!manual });
        if (web && after > before) log(`update: web ${before} → ${after} on the next reload`);
      } catch (e) { log('update: check failed', e.message); emit({ phase: 'idle', error: e.message, checkedAt: Date.now() }); }
      finally { checking = null; }
      return status;
    })();
  }
  const start = () => { cleanup(); setTimeout(() => check(), 20e3); setInterval(() => check(), EVERY); };
  status = { phase: 'idle', shell: shellVersion, serving: active().version, bundled: bundledInfo.version || 0 };
  return {
    active, check, start, installShell, canSwap, asset: lazyFile, isLazy: rel => LAZY.test(String(rel).replace(/^\//, '')),
    // "Ready" is worked out now, not remembered: after the restart the new files are the ones being served.
    status: () => ({ ...status, webReady: active().version > (status.serving || 0), shellReady: state.shell?.version && ok(state.shell.dir) ? state.shell.version : null, shell: shellVersion, pendingShell: state.shell?.version || null }),
    applied() { status.webReady = false; },
    served(v) { status.serving = v; },
    on(f) { listeners.add(f); return () => listeners.delete(f); },
  };
};
module.exports.folderHash = folderHash;
module.exports.LAZY = LAZY;
