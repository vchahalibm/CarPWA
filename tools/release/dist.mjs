#!/usr/bin/env node
/* What goes public (run by .github/workflows/publish.yml, from the repository root of a throwaway CI checkout):
     node tools/release/dist.mjs minify          the app's own JavaScript minified IN PLACE (js/, bridge/, sw.js): never on your Mac
     node tools/release/dist.mjs minify desktop  …and the desktop app's main-process code (desktop/*.js), for the Mac build and the Worker image
     node tools/release/dist.mjs public <dir>    copies only what the web app, DriveGen and the guides need into <dir> (the
                                                 public repo vchahalibm/CarPWA, served by GitHub Pages)
   The source repo is private. Minifying makes what ships harder to read; it isn't secret (whatever runs can be read). Function
   and class names are kept (js/debug.js wraps app functions by name), top-level names too (the scripts share globals). */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const TERSER = 'terser@5.36.0';
const MINIFY = () => [...fs.readdirSync('js').filter(f => f.endsWith('.js')).map(f => `js/${f}`), ...fs.readdirSync('bridge').filter(f => f.endsWith('.js')).map(f => `bridge/${f}`), 'sw.js'];
// The public site: the app (as the PWA serves it), the practice sites, the script library, the guides and their pictures.
const PUBLIC = ['index.html', 'manifest.webmanifest', 'sw.js', 'presenter.html', 'css', 'js', 'icons', 'samples', 'bridge', 'labs', 'library', 'vendor', 'docs', 'web-version.json', '.nojekyll'];
const NOT = [/^docs\/prototype\.html$/, /^docs\/TasksNeedingComeBack\.md$/, /\.DS_Store$/];

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'minify') {
  const files = [...MINIFY(), ...(arg === 'desktop' ? fs.readdirSync('desktop').filter(f => f.endsWith('.js')).map(f => `desktop/${f}`) : [])]; let before = 0, after = 0;
  for (const f of files) {
    before += fs.statSync(f).size;
    execFileSync('npx', ['-y', TERSER, f, '--compress', 'passes=2', '--mangle', '--keep-fnames', '--keep-classnames', '--ecma', '2022', '--comments', 'false', '-o', f], { stdio: 'inherit' });
    after += fs.statSync(f).size;
  }
  console.log(`minified ${files.length} files: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
} else if (cmd === 'public') {
  const out = path.resolve(arg || 'public-out'); let n = 0;
  const copy = rel => {
    if (!fs.existsSync(rel) || NOT.some(r => r.test(rel))) return;
    const st = fs.statSync(rel);
    if (st.isDirectory()) { for (const e of fs.readdirSync(rel)) copy(path.posix.join(rel, e)); return; }
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.copyFileSync(rel, path.join(out, rel)); n++;
  };
  for (const r of PUBLIC) copy(r);
  fs.writeFileSync(path.join(out, 'README.md'), `# DriveGen and NaoMuse\n\nThe published web app (DriveGen) and guides: https://vchahalibm.github.io/CarPWA/ · Get started: https://vchahalibm.github.io/CarPWA/docs/get-started.html\n\nThis repository holds the built app only (minified), published automatically. The source is private. © ${new Date().getFullYear()} vchahalibm. All rights reserved: no licence is granted to copy, modify or redistribute.\n`);
  console.log(`public: ${n} files in ${out}`);
} else { console.error('usage: dist.mjs minify | public <dir>'); process.exit(2); }
