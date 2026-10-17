'use strict';
/* ============================================================
   Bundles: a script together with what it uses, as one file to share
   (another computer, a colleague, the library):
   - the script(s), the captured motions they use (js/mocap.js), the site
     helpers they run (desktop app), the recorded web and app sequences
     they play;
   - export: Settings › Scripts › a script's ⬇, or Export all; the file is
     <name>.studiogen.json (plain JSON: { format: 'drivegen-bundle', … });
   - import: Import (a bundle or a plain script file), or from a link, or
     the Library: an index of bundles at a web address (default: this
     project's library/ folder on GitHub Pages). Names that already exist
     get “(2)” and the scripts' references follow;
   - files on this device (a deck you chose as a file) aren't included:
     use links in scripts you share.
   Loaded after js/scriptedit.js.
   ============================================================ */
const BUNDLE_FORMAT = 'drivegen-bundle';
const LIBRARY_URL = 'https://vchahalibm.github.io/CarPWA/library/index.json'; // this project's library (library/ in the repository, on GitHub Pages)

const Bundles = {
  /** What a script uses: captured motions, site helpers, web and app recordings (by name). */
  uses(json) {
    const out = { motions: new Set(), helpers: new Set(), webRecs: new Set(), appRecs: new Set() }, steps = [...(json.setup || []), ...(json.beats || []).flatMap(b => [b, ...(b.do || [])])];
    for (const x of steps) {
      if (x.gesture) out.motions.add(motionName(x.gesture) || x.gesture);
      if (x.do === 'avatar.gesture' && x.value) out.motions.add(motionName(x.value) || x.value);
      if (x.do === 'web.helper' && x.value) out.helpers.add(x.value);
      if (x.do === 'web.play' && x.value) out.webRecs.add(x.value);
      if (x.do === 'app.play' && x.value) out.appRecs.add(x.value);
    }
    return out;
  },
  /** A bundle of these scripts ({ name, json }) and everything they use that lives on this device. */
  make(scripts, { all = false } = {}) {
    const U = { motions: new Set(), helpers: new Set(), webRecs: new Set(), appRecs: new Set() };
    for (const s of scripts) { const u = this.uses(s.json); for (const k in U) u[k].forEach(v => U[k].add(v)); }
    const saved = typeof Mocap !== 'undefined' ? Mocap.saved() : {}, helpers = typeof WebDrive !== 'undefined' ? WebDrive.helperList() : [];
    const pick = (list, names, key = 'name') => list.filter(x => all || names.has(x[key]));
    return {
      format: BUNDLE_FORMAT, version: 1, app: APP_NAME, created: new Date().toISOString(),
      name: scripts.length === 1 ? scripts[0].name || scripts[0].json.name : `${APP_NAME} scripts`,
      scripts: scripts.map(s => ({ name: s.name || s.json.name, json: s.json })),
      motions: Object.fromEntries(Object.entries(saved).filter(([k]) => all || U.motions.has(k))),
      helpers: pick(helpers, U.helpers),
      webRecs: typeof WebDrive !== 'undefined' ? pick(WebDrive.recs(), U.webRecs) : [],
      appRecs: typeof AppSteps !== 'undefined' ? pick(AppSteps.recs(), U.appRecs) : [],
    };
  },
  export(scripts, opts) {
    const b = this.make(scripts.filter(Boolean), opts), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
    a.download = `${plain(b.name).replace(/\s+/g, '-') || 'scripts'}.studiogen.json`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    Log.i('bundle', 'Exported', { name: b.name, scripts: b.scripts.length, motions: Object.keys(b.motions).length, helpers: b.helpers.length, recs: b.webRecs.length + b.appRecs.length });
    toast(`Exported “${b.name}” (${b.scripts.length} script${b.scripts.length === 1 ? '' : 's'}${Object.keys(b.motions).length ? `, ${Object.keys(b.motions).length} motions` : ''}${b.helpers.length ? `, ${b.helpers.length} helpers` : ''})`);
  },
  /** A bundle or a plain script (any accepted shape) → a bundle. */
  read(data) {
    if (data?.format === BUNDLE_FORMAT) return data;
    if (data?.beats) return { format: BUNDLE_FORMAT, version: 1, name: data.name || 'Script', scripts: [{ name: data.name, json: data }], motions: {}, helpers: [], webRecs: [], appRecs: [] };
    throw new Error('Not a script or a bundle');
  },
  /** Show what a bundle holds and import it (names that exist get “(2)”, and the scripts follow the new names). */
  offer(data, from = '') {
    let b; try { b = this.read(data); } catch (e) { return sheet('Can’t import this', `<p>${esc(e.message)}</p>`, [['OK']]); }
    const bad = b.scripts.flatMap(s => scriptCheck(s.json).errors.map(x => `${s.name}: ${x}`));
    const li = (t, l) => l.length ? `<li><b>${t}</b>: ${l.map(esc).join(', ')}</li>` : '';
    sheet(`Import “${b.name}”`, `<ul class="se-note">${li('Scripts', b.scripts.map(s => s.name))}${li('Motions', Object.keys(b.motions || {}))}${li('Site helpers', (b.helpers || []).map(h => h.name))}${li('Recordings', [...(b.webRecs || []), ...(b.appRecs || [])].map(r => r.name))}</ul>
      ${from ? `<p class="se-note">From ${esc(from)}</p>` : ''}${bad.length ? `<p class="se-empty warn">${bad.length} problem${bad.length === 1 ? '' : 's'}: ${esc(bad[0])}</p>` : ''}
      ${(b.helpers || []).length ? '<p class="se-note">Site helpers run code inside web pages: only import them from people you trust.</p>' : ''}`,
      [['Import', () => this.import(b)], ['Cancel']]);
  },
  import(b) {
    const rename = (name, taken) => { if (!taken(name)) return name; for (let i = 2; ; i++) { const n = `${name} (${i})`; if (!taken(n)) return n; } };
    const motionMap = {}, helperMap = {}, webMap = {}, appMap = {};
    for (const [k, m] of Object.entries(b.motions || {})) {
      const n = MOTIONS[k] && JSON.stringify(Mocap.saved()[k]) === JSON.stringify(m) ? k : rename(k, x => !!MOTIONS[x]).replace(/\s/g, '');
      if (n !== k || !Mocap.saved()[k]) Mocap.save(n, m); motionMap[k] = n;
    }
    if (typeof WebDrive !== 'undefined') {
      const H = WebDrive.helperList(); for (const h of b.helpers || []) { const n = rename(h.name, x => H.some(y => y.name === x)); H.push({ ...h, name: n }); helperMap[h.name] = n; } store.set('siteHelpers', H);
      for (const r of b.webRecs || []) { const n = rename(r.name, x => WebDrive.recs().some(y => y.name === x)); WebDrive.saveRec({ ...r, name: n }); webMap[r.name] = n; }
    }
    if (typeof AppSteps !== 'undefined') for (const r of b.appRecs || []) { const n = rename(r.name, x => AppSteps.recs().some(y => y.name === x)); AppSteps.saveRec({ ...r, name: n }); appMap[r.name] = n; }
    const fix = x => {
      if (x.gesture && motionMap[x.gesture]) x.gesture = motionMap[x.gesture];
      if (x.do === 'avatar.gesture' && motionMap[x.value]) x.value = motionMap[x.value];
      if (x.do === 'web.helper' && helperMap[x.value]) x.value = helperMap[x.value];
      if (x.do === 'web.play' && webMap[x.value]) x.value = webMap[x.value];
      if (x.do === 'app.play' && appMap[x.value]) x.value = appMap[x.value];
    };
    for (const s of b.scripts) {
      const j = JSON.parse(JSON.stringify(s.json)); (j.setup || []).forEach(fix); (j.beats || []).forEach(be => { fix(be); (be.do || []).forEach(fix); });
      j.name = rename(j.name || s.name || 'Script', x => Scripts.all().some(y => y.name === x)); Scripts.add(j);
    }
    Log.i('bundle', 'Imported', { name: b.name, scripts: b.scripts.length });
    toast(`Imported “${b.name}”`); if (ScriptUI.shown) ScriptUI.render();
  },
  async fromUrl(url) {
    try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status}`); this.offer(await r.json(), url); }
    catch (e) { toast(`Couldn’t load it: ${e.message}`); }
  },
  /** The library: bundles listed in an index ({ bundles: [{ name, about, url, author }] }) at a web address. */
  async library() {
    const at = store.get('libraryUrl', null) || LIBRARY_URL;
    let idx; try { idx = await (await fetch(at, { cache: 'no-store' })).json(); } catch (e) { idx = { bundles: [], error: e.message }; }
    const base = new URL(at, location.href);
    sheet('Library', `<div class="se-pick"><div class="se-tiles">${(idx.bundles || []).map((x, i) => `<button class="se-tile" data-lib="${esc(new URL(x.url, base).href)}"><i>📦</i><b>${esc(x.name)}</b><span>${esc(x.about || '')}${x.author ? ` · ${esc(x.author)}` : ''}</span></button>`).join('') || `<p class="se-note">Nothing listed${idx.error ? ` (${esc(idx.error)})` : ''}.</p>`}</div>
      <label class="se-field"><span>Library address (an index.json)</span><input id="libUrl" class="se-wz-in" value="${esc(at)}"></label>
      <label class="se-field"><span>Or import a bundle from a link</span><input id="libLink" class="se-wz-in" placeholder="https://…/my-demo.studiogen.json"></label>
      <p class="se-note">To share in the library, export a bundle and add it to the library folder (for this project: library/ in the repository, listed in library/index.json).</p></div>`,
      [['Use these', () => { const u = $('#libUrl').value.trim(), l = $('#libLink').value.trim(); if (u && u !== at) { store.set('libraryUrl', u); setTimeout(() => this.library(), 50); } else if (l) this.fromUrl(l); }], ['Close']]);
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-lib]'); if (!b) return; e.stopPropagation(); closeSheet(); Bundles.fromUrl(b.dataset.lib); }, true);
