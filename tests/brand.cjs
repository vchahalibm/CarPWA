// The names (CI): js/brand.js, desktop/package.json and manifest.webmanifest agree; code shows names only through BRAND /
// APP_NAME, and the old internal name 'StudioGen' appears in code only as the internal id (APP_ID, `app: 'StudioGen'`).
const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..');
const BRAND = require('../js/brand.js'), pkg = require('../desktop/package.json'), man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const bad = [];
for (const k of ['mac', 'phone', 'hive', 'worker']) if (!BRAND[k]) bad.push(`js/brand.js: BRAND.${k} is missing`);
if (pkg.build.productName !== BRAND.mac) bad.push(`desktop/package.json build.productName is “${pkg.build.productName}”, BRAND.mac is “${BRAND.mac}”`);
if (pkg.productName !== 'StudioGen') bad.push('desktop/package.json productName must stay “StudioGen” (the internal app name: Keychain, data folder)');
if (man.name !== BRAND.phone || man.short_name !== BRAND.phone) bad.push(`manifest.webmanifest names the app “${man.name}”, BRAND.phone is “${BRAND.phone}”`);
/** The code without its comments, line by line (enough for this code's style: comments start a line, follow " // ", or sit in a block comment). */
function code(src) {
  let block = false;
  return src.split('\n').map(l => {
    if (block) { const e = l.indexOf('*/'); if (e < 0) return ''; block = false; l = l.slice(e + 2); }
    l = l.replace(/\/\*.*?\*\//g, '');
    const t = l.trim(); if (t.startsWith('//')) return '';
    const s = l.indexOf('/*'), before = l.slice(0, s), even = q => (before.split(q).length - 1) % 2 === 0;
    if (s >= 0 && even("'") && even('"') && even('`')) { block = true; l = before; } // not inside a string
    const c = l.search(/(^|\s)\/\/\s/); return c >= 0 ? l.slice(0, c) : l;
  }).join('\n');
}
const names = [BRAND.mac, BRAND.hive, BRAND.worker].filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => b.length - a.length);
const files = [...fs.readdirSync(path.join(ROOT, 'js')).map(f => `js/${f}`), ...fs.readdirSync(path.join(ROOT, 'desktop')).filter(f => f.endsWith('.js')).map(f => `desktop/${f}`)]
  .filter(f => f.endsWith('.js') && f !== 'js/brand.js');
for (const f of files) {
  const lines = code(fs.readFileSync(path.join(ROOT, f), 'utf8')).split('\n');
  lines.forEach((l, i) => {
    for (const n of names) if (l.includes(n)) { bad.push(`${f}:${i + 1}: writes “${n}” itself: use BRAND (js/brand.js)`); break; }
    const rest = l.replace(/['"]StudioGen['"]/g, '').replace(/StudioGen Safe Storage|Logs\/StudioGen|was StudioGen|was StudioGBee|\(StudioGen\|Electron\|DriveDeck\)/g, '');
    if (/StudioGen|StudioGBee/.test(rest)) bad.push(`${f}:${i + 1}: an old name in shown text: use BRAND (only the id 'StudioGen' stays)`);
  });
}
if (bad.length) { console.error(`${bad.length} naming problem${bad.length === 1 ? '' : 's'}:\n  ${bad.slice(0, 40).join('\n  ')}`); process.exit(1); }
console.log(`names ok: ${BRAND.mac}, ${BRAND.phone}, ${BRAND.hive} (${files.length} files checked)`);
