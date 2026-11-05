// MuseTester's tests are sound (CI): each test file parses, has an id matching its name, uses only steps MuseTester
// knows (STEPS in tools/musetester/muse.mjs) and only rpa.* actions js/rpa.js defines; and every part of the apps
// (js/*.js) is in tools/musetester/coverage.json with tests that exist, so a new feature comes with its test.
const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..'), M = path.join(ROOT, 'tools/musetester');
const src = fs.readFileSync(path.join(M, 'muse.mjs'), 'utf8'), block = src.slice(src.indexOf('const STEPS = {'), src.indexOf('\n};', src.indexOf('const STEPS = {')));
const STEPS = new Set([...block.matchAll(/(?:^  |, )(?:'([\w.]+)'|(\w+)): /gm)].map(m => m[1] || m[2]));
const RPA = new Set([...fs.readFileSync(path.join(ROOT, 'js/rpa.js'), 'utf8').matchAll(/def\('(rpa\.\w+)'/g)].map(m => m[1]));
const bad = [], ids = new Set(), gaps = [];
const scriptSteps = x => !x || typeof x !== 'object' ? [] : Array.isArray(x) ? x.flatMap(scriptSteps) : [...(typeof x.do === 'string' && x.do.startsWith('rpa.') ? [x.do] : []), ...Object.values(x).flatMap(scriptSteps)];
for (const f of fs.readdirSync(path.join(M, 'tests')).filter(f => f.endsWith('.json'))) {
  let t; try { t = JSON.parse(fs.readFileSync(path.join(M, 'tests', f), 'utf8')); } catch (e) { bad.push(`${f}: not JSON (${e.message})`); continue; }
  if (t.id !== f.replace(/\.json$/, '')) bad.push(`${f}: its id is “${t.id}”`); if (!t.title) bad.push(`${f}: no title`); ids.add(t.id);
  if (!t.journey && !(t.steps || []).length) bad.push(`${f}: no steps`);
  for (const [i, s] of [...(t.steps || []), ...(t.cleanup || [])].entries()) { if (!STEPS.has(s.do)) bad.push(`${f} step ${i + 1}: no step “${s.do}” in MuseTester`); for (const a of scriptSteps(s)) if (!RPA.has(a)) bad.push(`${f} step ${i + 1}: no action “${a}” in js/rpa.js`); }
}
const cov = JSON.parse(fs.readFileSync(path.join(M, 'coverage.json'), 'utf8')).modules;
for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
  const k = f.replace(/\.js$/, ''), c = cov[k];
  if (!c) { bad.push(`js/${f} isn't in tools/musetester/coverage.json: add the MuseTester test that covers it`); continue; }
  if (Array.isArray(c)) { if (!c.length) bad.push(`coverage.json: ${k} lists no tests`); for (const id of c) if (!ids.has(id)) bad.push(`coverage.json: ${k} names a test “${id}” that isn't there`); }
  else if (c.todo) gaps.push(`${k}: ${c.todo}`); else if (!c.none) bad.push(`coverage.json: ${k} needs tests, a todo or a none`);
}
for (const k of Object.keys(cov)) if (!fs.existsSync(path.join(ROOT, 'js', `${k}.js`))) bad.push(`coverage.json: js/${k}.js isn't there any more`);
console.log(`MuseTester: ${ids.size} tests, ${STEPS.size} steps, ${RPA.size} rpa actions; ${gaps.length} parts without a test yet:\n  ${gaps.join('\n  ')}`);
if (bad.length) { console.error(`\n${bad.length} problem${bad.length === 1 ? '' : 's'}:\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log('ok');
