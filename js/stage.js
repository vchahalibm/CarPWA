'use strict';
/* ============================================================
   Stage mode: DriveDeck on a big screen (an iPad or computer mirrored to
   a TV, or a browser on the TV's PC), presenting with the avatar.
   - Settings › Mode: Drive (car rules: the avatar only changes its face,
     the back camera) or Stage (full gestures, the front camera or a
     webcam, the Stage layout with captions).
   - Safety: on Stage, if the GPS says the car is moving, it behaves as
     Drive until it stops (Stage.on is false meanwhile).
   - The Stage layout itself is drawn by Dash (js/dash.js, 'stage'), with
     two widget lists: 'stage.main' (the content) and 'stage.side' (the
     presenter column). Captions show what you said and the reply.
   Loaded after vision.js, before debug.js.
   ============================================================ */
Bus.define('mode.change', 'Drive or Stage mode starts', 'drive or stage');

const Stage = {
  moving: false,
  /** Chosen in Settings (or by voice). */
  get chosen() { return settings.appMode === 'stage'; },
  /** Stage behaviour in effect: chosen and not driving. */
  get on() { return this.chosen && !this.moving; },
  /** Called by applySettings: the mode, its layout, camera and the page's look. */
  apply() {
    const was = document.documentElement.dataset.mode, now = this.on ? 'stage' : 'drive';
    document.documentElement.dataset.mode = now;
    if (!was || was === now) return; // at start-up keep the layout you left
    if (now === 'stage' && this.chosen) { if (Dash.layout !== 'stage') { settings.driveLayout = Dash.layout; settings.dashLayout = 'stage'; } }
    else if (!this.chosen && Dash.layout === 'stage') settings.dashLayout = settings.driveLayout || 'cluster';
    store.set('settings', settings);
    Log.i('stage', `${now === 'stage' ? 'Stage' : 'Drive'} mode`, { chosen: settings.appMode, moving: this.moving });
    Camera.switch();
    Bus.emit('mode.change', { value: now });
    if (current === 'dashboard') Dash.render();
  },
  set(mode) { settings.appMode = mode; applySettings(); if (current === 'settings') renderSettings(); },
  /** The GPS (not the demo drive) says the car is moving: Drive rules until it stops. */
  setMoving(m) {
    if (this.moving === m) return;
    this.moving = m;
    if (this.chosen) { toast(m ? 'Moving: Drive mode until you stop' : 'Stopped: back to Stage mode'); applySettings(); }
  },

  /* ---------- Captions along the bottom of the Stage layout ---------- */
  caption(who, text) {
    const el = $(`#dashRoot .st-cap .cap-${who}`); if (!el || !settings.captions) return;
    el.textContent = text; el.hidden = !text;
    clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, who === 'ai' ? 12000 : 8000);
  },

  /* ---------- Settings › Mode and Cameras ---------- */
  settingsHtml(seg, tog, btn) {
    const cam = k => { const v = settings[k]; return v === 'front' ? 'Front' : v === 'back' ? 'Back' : esc(this.camNames?.[v] || 'Other camera'); };
    return `<div class="group-title">Mode</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">DriveDeck is used for</div><div class="s">${this.chosen
        ? `Stage: presenting on a big screen. The assistant gestures and moves; the Stage layout shows your content, the presenter and captions${this.moving ? '. Moving now, so Drive rules apply until you stop' : ''}`
        : 'Driving: the assistant only changes its expression, nothing moving to catch your eye'}</div></div>${seg('appMode', [['drive', 'Drive'], ['stage', 'Stage']])}</div>
      ${this.chosen ? tog('captions', 'Captions', 'Shows what you said and the reply along the bottom of the Stage layout') : ''}
    </div>
    <div class="group-title">Cameras</div>
    <div class="group">
      ${btn('camDrive', 'Camera while driving', cam('driveCam'))}
      ${btn('camStage', 'Camera on Stage', cam('stageCam'))}
    </div>`;
  },
  async pickCam(key) {
    const list = await Camera.list();
    this.camNames = Object.fromEntries(list.filter(d => d.deviceId).map((d, i) => [d.deviceId, d.label || `Camera ${i + 1}`]));
    const opts = [['front', 'Front camera'], ['back', 'Back camera'], ...Object.entries(this.camNames)];
    sheet(key === 'stageCam' ? 'Camera on Stage' : 'Camera while driving', `<div class="pick-list">${opts.map(([v, l]) =>
      `<button class="big-btn ${settings[key] === v ? 'accent' : ''}" data-campick="${esc(key)}|${esc(v)}">${esc(l)}</button>`).join('')}</div>
      ${list.some(d => d.label) ? '' : '<p class="hint">Attached cameras are listed by name once the camera has been allowed (open the Camera widget once).</p>'}`, [['Cancel']]);
  },
};
ACTIONS.camDrive = () => Stage.pickCam('driveCam');
ACTIONS.camStage = () => Stage.pickCam('stageCam');
document.addEventListener('click', e => {
  const b = e.target.closest('[data-campick]'); if (!b) return;
  const [k, v] = b.dataset.campick.split('|'); settings[k] = v; closeSheet(); store.set('settings', settings);
  Log.i('camera', 'Camera chosen', { [k]: v }); Camera.switch(); renderSettings();
});

// A presentation clicker or the keyboard turns the slides on Stage (arrow keys, Page Up/Down, space).
addEventListener('keydown', e => {
  if (!Stage.on || current !== 'dashboard' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const step = { ArrowRight: 1, PageDown: 1, ' ': 1, ArrowDown: 1, ArrowLeft: -1, PageUp: -1, ArrowUp: -1 }[e.key]; if (!step) return;
  if (typeof Script !== 'undefined' && Script.running) return; // a script decides what “next” means
  const id = Media.first('doc'); if (!id) return;
  e.preventDefault(); Media.go(id, (Media.pdf[id]?.page || 1) + step);
});
Bus.on('drive.moving', () => { if (loc.source === 'gps') Stage.setMoving(true); });
Bus.on('drive.stopped', () => Stage.setMoving(false));
Bus.on('voice.heard', d => Stage.caption('you', d.value ? `“${d.value}”` : ''));
Bus.on('voice.reply', d => Stage.caption('ai', d.value || ''));
// The Stage layout's default content: the sample deck and Vita, until you choose your own.
if (!Wcfg.all()['doc~stage']) Wcfg.set('doc~stage', { url: 'samples/drivedeck-demo.pptx', title: 'Demo deck' });
if (!Wcfg.all()['model~stage']) Wcfg.set('model~stage', { builtin: 'vita' });

Actions.define('mode.set', { group: 'Dashboard', name: 'Switch Drive / Stage mode', arg: 'drive or stage', run(v, say) {
  const m = /stage|present/i.test(v) ? 'stage' : 'drive'; Stage.set(m); say?.(m === 'stage' ? 'Stage mode.' : 'Drive mode.'); } });
Stage.apply();
