#!/usr/bin/env node
/* StudioGen update feed (run by .github/workflows/desktop.yml, from the repository root).
     node tools/release/make-update.mjs version        writes web-version.json (WEB_VERSION, the vendor hash, COMMIT)
     node tools/release/make-update.mjs pack <outDir>  packs the web files, collects the zipped apps from desktop/dist,
                                                       writes update.json and signs it (UPDATE_SIGNING_KEY: Ed25519 PEM)
     node tools/release/make-update.mjs keep <update.json>  the asset names update.json refers to (to prune the rest)
   The app checks the signature with the public key in desktop/updater.js, then each file's size and SHA-256. */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { folderHash } = require('../../desktop/updater.js');

const APP_FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'presenter.html', 'css', 'js', 'icons', 'samples', 'bridge', 'web-version.json'];
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const entry = file => { const b = fs.readFileSync(file); return { file: path.basename(file), sha256: sha256(b), size: b.length }; };
const tar = (out, files) => execFileSync('tar', ['--format', 'ustar', '--no-xattrs', '-czf', out, ...files], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'inherit' });

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'version') {
  const info = { version: +process.env.WEB_VERSION || 0, vendorHash: await folderHash('vendor'), commit: process.env.COMMIT || '' };
  fs.writeFileSync('web-version.json', JSON.stringify(info, null, 2) + '\n');
  console.log('web-version.json', info);
} else if (cmd === 'pack') {
  const out = arg || 'update-out'; fs.mkdirSync(out, { recursive: true });
  const info = JSON.parse(fs.readFileSync('web-version.json', 'utf8')), shell = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8')).version;
  const appTar = path.join(out, `web-app-${info.version}.tar.gz`), vendorTar = path.join(out, `web-vendor-${info.vendorHash.slice(0, 16)}.tar.gz`);
  tar(appTar, APP_FILES.filter(f => fs.existsSync(f)));
  tar(vendorTar, ['vendor']);
  // The zipped apps electron-builder made (StudioGen-<v>-arm64-mac.zip, StudioGen-<v>-mac.zip for Intel).
  const zips = fs.readdirSync('desktop/dist').filter(f => f.endsWith('.zip') && f.includes(`-${shell}-`));
  const arm = zips.find(f => f.includes('arm64')), x64 = zips.find(f => !f.includes('arm64'));
  const sh = {}; for (const [k, f] of [['arm64', arm], ['x64', x64]]) if (f) { fs.copyFileSync(path.join('desktop/dist', f), path.join(out, f)); sh[k] = entry(path.join(out, f)); }
  const notes = (() => { try { return execFileSync('git', ['log', '-1', '--format=%s']).toString().trim(); } catch { return ''; } })();
  const manifest = { app: 'StudioGen', date: new Date().toISOString(), commit: info.commit, notes,
    web: { version: info.version, commit: info.commit, minShell: shell, app: entry(appTar), vendor: { hash: info.vendorHash, ...entry(vendorTar) } },
    shell: { version: shell, ...sh } };
  const body = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(out, 'update.json'), body);
  const key = process.env.UPDATE_SIGNING_KEY;
  if (!key) { console.log('No UPDATE_SIGNING_KEY: update.json is not signed (it will not be published)'); process.exit(0); }
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), crypto.createPrivateKey(key)).toString('base64');
  fs.writeFileSync(path.join(out, 'update.json.sig'), sig + '\n');
  console.log(`update.json signed: web ${info.version}, shell ${shell}`, Object.keys(sh));
} else if (cmd === 'keep') {
  const m = JSON.parse(fs.readFileSync(arg, 'utf8'));
  console.log(['update.json', 'update.json.sig', m.web?.app?.file, m.web?.vendor?.file, m.shell?.arm64?.file, m.shell?.x64?.file].filter(Boolean).join('\n'));
} else { console.error('usage: make-update.mjs version | pack <outDir> | keep <update.json>'); process.exit(2); }
