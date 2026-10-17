'use strict';
/* ============================================================
   Avatars: which assistants are on this device, and adding your own.
   - One core avatar (AVATAR_CORE) comes with the app: the desktop app
     fetches it in the background on first start, the web app on first use.
   - The others in BUILTIN_MODELS marked `gallery` are downloaded when you
     ask (Settings › Assistant › Avatars, or the Download button in a
     3D widget that shows one), kept in IndexedDB (`Files`, key
     avatar:<id>), and can be removed again. Same in both apps.
   - Your own .vrm files (or links): checked first (`check`: humanoid bones,
     expressions, VRM version, size, licence), kept in IndexedDB too and
     listed in `dd.myAvatars`; they appear in every avatar list as
     BUILTIN_MODELS entries with `mine`.
   Loaded after avatar.js.
   ============================================================ */
const AVATAR_CORE = 'elle';
// VRM humanoid bones (VRM 1.0 names; three-vrm maps VRM 0 files to them).
const VRM_REQUIRED = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
const VRM_NICE = { chest: 'chest', neck: 'neck', leftShoulder: 'left shoulder', rightShoulder: 'right shoulder', leftEye: 'left eye', rightEye: 'right eye', leftIndexProximal: 'left fingers', rightIndexProximal: 'right fingers', leftThumbProximal: 'left thumb', rightThumbProximal: 'right thumb', leftToes: 'left toes', rightToes: 'right toes' };
const VRM_FACES = { aa: 'mouth a', ih: 'mouth i', ou: 'mouth u', ee: 'mouth e', oh: 'mouth o', blink: 'blink', happy: 'happy', sad: 'sad', angry: 'angry', relaxed: 'relaxed', surprised: 'surprised' };

const Avatars = {
  have: new Set(store.get('avatarsHave', [])),
  mine: () => store.get('myAvatars', []),
  /** Your avatars join BUILTIN_MODELS, so every avatar list shows them. */
  register() {
    for (const k of Object.keys(BUILTIN_MODELS)) if (BUILTIN_MODELS[k].mine) delete BUILTIN_MODELS[k];
    for (const a of this.mine()) BUILTIN_MODELS[a.id] = { name: a.name, note: 'your avatar', vrm: true, mine: true, key: a.key, size: a.size };
  },
  /** On this device (ready to show without a download)? */
  local(id) { const m = BUILTIN_MODELS[id]; return !!m && (m.mine || !m.gallery || this.have.has(id)); },
  /** What to load for an avatar: its file (core, robot), its downloaded copy, or null when it has to be downloaded first. */
  async src(id) {
    const m = BUILTIN_MODELS[id]; if (!m) return null;
    if (m.mine) return Files.url(m.key);
    if (!m.gallery) return m.src;
    if (!this.have.has(id)) return null;
    const u = await Files.url(`avatar:${id}`); if (u) return u;
    this.have.delete(id); this.save(); return null; // the browser cleared it
  },
  save() { store.set('avatarsHave', [...this.have]); },
  mb: n => n ? `${Math.round(n / 1e5) / 10} MB` : '',
  busy: {},
  /** Download a gallery avatar into this device's storage. */
  async download(id) {
    const m = BUILTIN_MODELS[id]; if (!m?.gallery) return;
    if (this.busy[id]) return this.busy[id];
    return (this.busy[id] = (async () => {
      Log.i('avatar', 'Downloading', { id, src: m.src });
      toast(`Downloading ${m.name}${m.size ? ` (${this.mb(m.size)})` : ''}…`);
      try {
        const r = await fetch(m.src); if (!r.ok) throw new Error(`${r.status}`);
        const b = await r.blob(); if (m.size && Math.abs(b.size - m.size) > 1024) throw new Error('incomplete download');
        await Files.put(`avatar:${id}`, b); this.have.add(id); this.save();
        toast(`${m.name} is on this device`); this.refresh(); return true;
      } catch (e) { Log.w('avatar', 'Download failed', { id, e: e.message }); toast(`Couldn’t download ${m.name}: ${e.message === 'Failed to fetch' ? 'offline?' : e.message}`); return false; }
      finally { delete this.busy[id]; }
    })());
  },
  async remove(id) {
    const m = BUILTIN_MODELS[id]; if (!m) return;
    if (m.mine) { await Files.del(m.key); store.set('myAvatars', this.mine().filter(a => a.id !== id)); this.register(); }
    else { await Files.del(`avatar:${id}`); this.have.delete(id); this.save(); }
    // Widgets that showed it go back to the core avatar.
    for (const w of ['model~stage', ...Object.keys(store.get('wcfg', {}))]) { const c = Wcfg.get(w); if (c?.builtin === id) Wcfg.set(w, { ...c, builtin: AVATAR_CORE }); }
    toast(`${m.name} removed`); this.refresh();
  },
  /** In a 3D widget whose avatar isn't downloaded yet. */
  offer(body, id, wid) {
    const m = BUILTIN_MODELS[id];
    body.innerHTML = `<div class="mw-empty"><span>${esc(m.name)} isn’t on this device yet</span><button class="w-cta" data-avdl="${esc(id)}" data-wid="${esc(wid)}">Download${m.size ? ` (${this.mb(m.size)})` : ''}</button></div>`;
  },
  refresh() {
    if ($('#avGallery')) this.gallery();
    if (current === 'dashboard') Media.mountAll();
    if (typeof MotionUI !== 'undefined' && !MotionUI.inst && $('#moAvatar')) MotionUI.toggled(true); // the capture preview waited for a download
  },

  /** Check a VRM before it's used: what it has, what's missing, what moves and what won't. */
  async check(src, bytes = 0) {
    const L = await VrmAvatar.load(), loader = new L.GLTFLoader(); loader.register(p => new L.VRMLoaderPlugin(p));
    let gltf; try { gltf = await loader.loadAsync(src); } catch (e) { return { ok: false, error: `It couldn’t be read as a 3D model (${e.message}).` }; }
    const vrm = gltf.userData.vrm;
    if (!vrm) { L.VRMUtils?.deepDispose?.(gltf.scene); return { ok: false, error: 'It’s a 3D model but not a VRM avatar (no humanoid or expressions). Convert it to VRM first: VRoid Studio exports VRM; for VRChat/Unity avatars use UniVRM in Unity, or the VRM Add-on for Blender.' }; }
    const H = vrm.humanoid, has = b => { try { return !!H?.getRawBoneNode(b); } catch { return false; } };
    const E = vrm.expressionManager, face = n => !!E?.getExpression?.(n);
    const names = Object.keys(E?.expressionMap || {}), low = new Set(names.map(n => n.toLowerCase()));
    let tris = 0; gltf.scene.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const meta = vrm.meta || {}, v1 = String(meta.metaVersion) === '1';
    const r = {
      vrm: v1 ? '1.0' : '0.x', name: meta.name || meta.title || '', author: (meta.authors || []).join(', ') || meta.author || '',
      licence: v1 ? meta.licenseUrl || '' : meta.licenseName === 'Other' ? meta.otherLicenseUrl || 'Other' : meta.licenseName || '',
      commercial: v1 ? meta.commercialUsage || '' : meta.commercialUssageName || '', credit: v1 ? meta.creditNotation === 'required' : null,
      missing: VRM_REQUIRED.filter(b => !has(b)), lacks: Object.entries(VRM_NICE).filter(([b]) => !has(b)).map(([, n]) => n),
      faces: Object.entries(VRM_FACES).filter(([n]) => !face(n)).map(([, n]) => n),
      arkit: ARKIT_SHAPES.filter(k => low.has(k.toLowerCase())).length, tris: Math.round(tris), bytes, warn: [],
    };
    L.VRMUtils?.deepDispose?.(gltf.scene);
    r.ok = !r.missing.length;
    if (r.tris > 100000) r.warn.push(`${Math.round(r.tris / 1000)}k triangles: may run slowly on an iPad or phone`);
    if (bytes > 60e6) r.warn.push(`${this.mb(bytes)}: large for a phone`);
    if (r.faces.includes('blink')) r.warn.push('no blink: the eyes won’t close');
    if (['mouth a', 'mouth i', 'mouth u', 'mouth e', 'mouth o'].every(f => r.faces.includes(f))) r.warn.push('no mouth shapes: no lip-sync');
    return r;
  },
  report(r) {
    if (r.error) return `<p class="se-empty warn">${esc(r.error)}</p>`;
    const li = (ok, t) => `<li class="${ok ? '' : 'warn'}">${ok ? '✓' : '✗'} ${t}</li>`;
    return `<ul class="av-report">
      ${li(!r.missing.length, r.missing.length ? `Missing body bones: ${esc(r.missing.join(', '))}. It can’t move without them: map them in VRoid Studio, UniVRM (Unity) or the VRM Add-on for Blender, and export again.` : 'All the body bones are there')}
      ${li(!r.lacks.length, r.lacks.length ? `Not there (those parts stay still): ${esc(r.lacks.join(', '))}` : 'Shoulders, neck, eyes, fingers and toes too')}
      ${li(!r.faces.length, r.faces.length ? `Expressions missing: ${esc(r.faces.join(', '))}` : 'Mouth shapes for lip-sync, blink and the five moods')}
      ${r.arkit >= 30 ? li(true, `${r.arkit} ARKit face shapes: face capture moves brows, eyes and lips`) : ''}
      ${r.warn.map(w => li(false, esc(w))).join('')}
    </ul>
    <p class="se-note">VRM ${esc(r.vrm)}${r.name ? ` · “${esc(r.name)}”` : ''}${r.author ? ` by ${esc(r.author)}` : ''} · ${Math.round(r.tris / 1000)}k triangles${r.bytes ? ` · ${this.mb(r.bytes)}` : ''}${r.licence ? ` · licence: ${esc(r.licence)}` : ''}${r.commercial ? ` · commercial use: ${esc(r.commercial)}` : ''}${r.credit ? ' · credit the author when you show it' : ''}</p>`;
  },
  /** Add your own avatar from a file or a link: check it, then keep it. */
  async add(blob, label) {
    const url = URL.createObjectURL(blob);
    sheet('Checking the avatar…', '<p class="se-note">Reading its skeleton and expressions.</p>', [['Cancel']]);
    const r = await this.check(url, blob.size).catch(e => ({ ok: false, error: e.message })); URL.revokeObjectURL(url);
    Log.i('avatar', 'Checked', { label, ...r });
    const name = (r.name || label || 'My avatar').replace(/\.vrm$/i, '').slice(0, 40);
    sheet(r.ok ? `“${name}” can be used` : 'This avatar can’t be used', this.report(r) + (r.ok ? `<label class="se-field"><span>Name</span><input id="avName" class="se-wz-in" value="${esc(name)}"></label>` : ''),
      r.ok ? [['Add it', async () => {
        const id = `my~${Math.random().toString(36).slice(2, 7)}`, n = $('#avName')?.value.trim() || name;
        await Files.put(`avatar:${id}`, blob); store.set('myAvatars', [...this.mine(), { id, name: n, key: `avatar:${id}`, size: blob.size, report: { ...r, warn: r.warn } }]);
        this.register(); toast(`${n} added`); this.gallery();
      }], ['Cancel']] : [['OK', () => this.gallery()]]);
  },
  async addLink(u) {
    if (/hub\.vroid\.com/.test(u)) return sheet('From VRoid Hub', '<p>VRoid Hub needs you to sign in to download. Open the model’s page, press <b>Download</b> (when the author allows it), then add the downloaded .vrm file here. Check the author’s conditions of use.</p>', [['Open VRoid Hub', () => openExternal(u, u)], ['OK']]);
    try { toast('Downloading…'); const r = await fetch(u); if (!r.ok) throw new Error(`${r.status}`); this.add(await r.blob(), decodeURIComponent(u.split(/[?#]/)[0].split('/').pop())); }
    catch (e) { toast(`Couldn’t download it: ${e.message}`); }
  },
  use(id) {
    if (!this.local(id)) return this.download(id).then(ok => ok && this.use(id));
    const c = Wcfg.get('model~stage'); Wcfg.set('model~stage', { ...c, url: '', file: null, builtin: id });
    if (typeof MotionUI !== 'undefined' && MotionUI.inst) { VrmAvatar.all.get('preview')?.dispose(); VrmAvatar.all.delete('preview'); MotionUI.inst = null; MotionUI.toggled(true); }
    toast(`${BUILTIN_MODELS[id].name} is the assistant`); this.refresh();
  },
  /** Settings › Assistant › Avatars: what's here, what can be downloaded, and adding your own. */
  gallery() {
    this.register();
    const cur = Wcfg.get('model~stage').builtin || AVATAR_CORE;
    const tile = ([id, m]) => {
      const here = this.local(id), thumb = m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : `<i>${esc(m.name[0] || '?')}</i>`;
      return `<div class="av-tile ${id === cur ? 'on' : ''}">${thumb}<div class="av-t"><b>${esc(m.name)}${id === AVATAR_CORE ? ' <span class="av-tag">core</span>' : ''}${m.mine ? ' <span class="av-tag">yours</span>' : ''}</b>
        <span>${esc(m.style || m.note)}</span><span class="av-lic">${esc([m.size ? this.mb(m.size) : '', m.lic || ''].filter(Boolean).join(' · '))}</span></div>
        <div class="av-b">${id === cur ? '<span class="av-cur">In use</span>' : `<button class="chip ${here ? 'accent' : ''}" data-av="use:${esc(id)}">${here ? 'Use' : this.busy[id] ? 'Downloading…' : 'Download'}</button>`}
        ${(m.gallery && here) || m.mine ? `<button class="icon-btn" data-av="del:${esc(id)}" aria-label="Remove ${esc(m.name)}" title="Remove from this device">${svg('del')}</button>` : ''}</div></div>`;
    };
    const list = Object.entries(BUILTIN_MODELS).filter(([, m]) => m.vrm);
    sheet('Avatars', `<div id="avGallery"><p class="se-note">${esc(BUILTIN_MODELS[AVATAR_CORE].name)} comes with the app; the others download when you choose them and can be removed again.</p>
      <div class="av-grid">${list.map(tile).join('')}</div>
      <div class="chip-row"><button class="chip accent" data-av="file">Add an avatar file (.vrm)</button><button class="chip" data-av="link">Add from a link</button><input type="file" id="avFile" accept=".vrm,.glb,model/gltf-binary" hidden></div>
      <p class="se-note">Anime and VTuber avatars: VRM files from VRoid Studio, VRoid Hub (download from the model’s page when its author allows it), BOOTH… VRChat avatars are Unity projects: convert them to VRM with UniVRM in Unity or the VRM Add-on for Blender. Each file is checked for the bones and expressions the assistant needs. Respect each author’s conditions of use.</p></div>`, [['Close']]);
  },
  cmd(v) {
    const [a, id] = [v.split(':')[0], v.split(':').slice(1).join(':')];
    if (a === 'use') return this.use(id);
    if (a === 'del') return sheet(`Remove ${BUILTIN_MODELS[id]?.name}?`, `<p>${BUILTIN_MODELS[id]?.mine ? 'Your file is deleted from this device.' : 'It can be downloaded again later.'}</p>`, [['Remove', () => this.remove(id)], ['Cancel', () => this.gallery()]]);
    if (a === 'file') return $('#avFile')?.click();
    if (a === 'link') return sheet('Add from a link', '<label class="se-field"><span>A link to a .vrm file</span><input id="avLink" class="se-wz-in" placeholder="https://…/avatar.vrm"></label>', [['Add', () => { const u = $('#avLink').value.trim(); if (u) this.addLink(u); }], ['Cancel', () => this.gallery()]]);
  },
  /** First start: fetch the core avatar in the background so it's there offline (the desktop app downloads it then). */
  prefetch() { const m = BUILTIN_MODELS[AVATAR_CORE]; setTimeout(() => fetch(m.src).then(r => r.ok && r.arrayBuffer()).catch(() => {}), 8000); },
};
Avatars.register();
Avatars.prefetch();
// Elle became the core avatar (Oct 2026): installs that showed Vita, the old core, switch to her once.
if (!store.get('coreElle')) { store.set('coreElle', true); const c = Wcfg.get('model~stage'); if (!c.url && !c.file && (!c.builtin || c.builtin === 'vita') && !Avatars.have.has('vita')) Wcfg.set('model~stage', { builtin: AVATAR_CORE }); }
ACTIONS.avatars = () => Avatars.gallery();
document.addEventListener('click', e => {
  const b = e.target.closest('[data-av]'); if (b) { e.stopPropagation(); return Avatars.cmd(b.dataset.av); }
  const d = e.target.closest('[data-avdl]'); if (d) { e.stopPropagation(); d.disabled = true; d.textContent = 'Downloading…'; Avatars.download(d.dataset.avdl); }
}, true);
document.addEventListener('change', e => { if (e.target.id === 'avFile' && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ''; Avatars.add(f, f.name); } });
