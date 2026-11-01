// Every desktop file the app loads (require('./x') in desktop/*.js) is in the packaged app (package.json build.files):
// a missing one stops StudioGen before its window opens (0.18.0 left out watchio.js). Run: node tests/desktop/packaged.cjs (CI too).
const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '../../desktop');
const files = new Set(require(path.join(dir, 'package.json')).build.files), missing = [];
const seen = new Set(), walk = f => { if (seen.has(f)) return; seen.add(f);
  for (const [, m] of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/require\(\s*['"]\.\/([\w./-]+?)(?:\.js)?['"]\s*\)/g)) {
    const name = `${m}.js`; if (!fs.existsSync(path.join(dir, name))) continue;
    if (!files.has(name)) missing.push(`${name} (loaded by ${f})`); walk(name);
  } };
for (const f of ['main.js', 'preload.js', 'webview-preload.js']) walk(f);
if (missing.length) { console.error(`Not packaged: ${missing.join(', ')}; add to desktop/package.json build.files`); process.exit(1); }
console.log(`desktop files packaged: ok (${seen.size} checked)`);
