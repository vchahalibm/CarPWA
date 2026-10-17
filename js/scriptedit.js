'use strict';
/* ============================================================
   The script editor (Settings › Scripts › Edit): a vertical timeline of
   storyboard cards, one per step, each in three lanes:
   - Say:  what the assistant says, with a face and a motion;
   - Show: what happens on screen, in order, as chips (a slide, a web page,
           a click on some text, a captured area, a wait…); tap a chip to
           change it; “+ Add” opens a picker that explains each kind;
   - Next: every way the step can move on (the clicker, a phrase, a hand
           gesture, after a pause, when something happens, a jump);
   and a three-question wizard for new steps (what's shown, what's said,
   how it moves on). Before the first step, the setup card.
   The script format is unchanged (docs/scripts.md); ScriptUI (js/script.js)
   keeps saving, running and the commands it already had.
   Loaded after js/screenmodel.js.
   ============================================================ */
const StepEditor = {
  open: null,     // the chip being changed: 'beats.2.do.1', 'setup.0', or 'next:2:say'
  /* ---------- Small builders (inputs edit the draft by path; see ScriptUI.setPath) ---------- */
  opt: (v, cur, label = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`,
  inp(path, v, ph = '', cls = '') { return `<input class="${cls}" data-sf="${path}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="off">`; },
  sel(path, v, opts, none = '—') { return `<select data-sf="${path}"><option value="">${none}</option>${opts.map(o => Array.isArray(o) ? this.opt(o[0], v, o[1]) : this.opt(o, v)).join('')}</select>`; },
  motionSel(path, v, none) {
    const g = {}; for (const [k, m] of Object.entries(MOTIONS)) if (!k.startsWith('__')) (g[m.group || 'Other'] ||= []).push([k, m.name]);
    return `<select data-sf="${path}">${none ? '<option value="">No motion</option>' : ''}${Object.entries(g).map(([n, l]) => `<optgroup label="${esc(n)}">${l.map(([k, nm]) => this.opt(k, motionName(v) || v, nm)).join('')}</optgroup>`).join('')}</select>`;
  },
  pointSel(path, v) {
    return `<select data-sf="${path}">${[...widgetIds().map(i => [i, `${Wcfg.get(i).title || W[wtype(i)].name}`]), ['doc', 'The document'], ['web', 'The web page'], ['left', 'Left of the screen'], ['right', 'Right of the screen'], ['up', 'Up'], ['down', 'Down']].map(([k, l]) => this.opt(k, v, l)).join('')}</select>`;
  },
  actSel(path, v) {
    const groups = {}; for (const [id, a] of Object.entries(Actions.list)) (groups[a.group || 'Other'] ||= []).push([id, a]);
    return `<select data-sf="${path}">${Object.entries(groups).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map(([id, a]) => this.opt(id, v, a.name)).join('')}</optgroup>`).join('')}${v && !Actions.list[v] ? this.opt(v, v, `${v} (not available here)`) : ''}</select>`;
  },

  /* ---------- What a chip says ---------- */
  ICON: { say: '💬', motion: '🧍', point: '👉', wait: '⏱', click: '👆', type: '⌨️', key: '⌨️', scroll: '↕️', drag: '✋', select: '☑️', web: '🌐', slide: '📄', helper: '🧩', video: '🎬', model: '🧊', script: '📜', other: '⚙️' },
  chip(x) {
    const I = this.ICON, short = (s, n = 46) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    if (typeof x === 'string') return [I.say, `“${short(x)}”`];
    if (x.set != null) return ['🏷', `Set {${x.set}} = ${short(x.value, 30)}`];
    if (x.if != null) return ['🔀', `If ${short(x.if, 34)} (${(x.then || []).length} / ${(x.else || []).length})`];
    if (x.repeat != null) return ['🔁', `Repeat ${x.repeat}× (${(x.steps || []).length} steps)`];
    if (x.until != null) return ['🔁', `Until ${short(x.until, 34)}`];
    if (x.each != null) return ['🔁', `For each ${x.as || 'item'} in ${short(x.each, 24)}`];
    if (x.await != null) return ['⏳', `Wait for ${x.await === 'all' || !x.await ? 'all background steps' : `“${short(x.await, 30)}”`}`];
    if (x.goto != null) return ['↪️', `Go to ${short(x.goto, 34)}`];
    if (x.intent != null) return ['🎯', `Do “${short(x.intent, 34)}”`];
    if (x.stop) return ['⏹', 'End the script'];
    if (x.background && x.do) { const [, t] = this.chip({ ...x, background: false }); return ['⏳', `${t} (in the background)`]; }
    if (/^os\./.test(x.do || '')) return ['💻', `${x.name || OS_KINDS[x.do.slice(3)] || x.do}${(x.args || []).length ? `: ${short(x.args.join(', '), 28)}` : ''}`];
    if (x.say != null && !x.do) return [I.say, x.say ? `“${short(x.say)}”` : 'Say something…'];
    if (x.do === 'avatar.gesture') return [I.motion, MOTIONS[motionName(x.value)]?.name || x.value || 'A motion'];
    if (x.do === 'avatar.pointAt') return [I.point, `Point at ${x.value || 'the document'}`];
    if (x.do === 'wait') return [I.wait, `Wait ${x.value || 1} s`];
    if (x.do === 'app.step') { const s = appStepOf(x.value) || {}; return [s.t === 'web' ? I.web : I[s.t] || I.click, short(typeof AppSteps !== 'undefined' ? AppSteps.describe(s) : s.t, 58)]; }
    if (x.do === 'web.open') { let h = x.value; try { h = new URL(x.value, location.href).host || x.value; } catch {} return [I.web, `Open ${short(h || 'a web page', 40)}`]; }
    if (x.do === 'web.step' || x.do === 'web.play') return [I.web, short(x.do === 'web.play' ? `Play “${x.value}”` : WebDrive.describe(stepOf(x.value)), 58)];
    if (x.do === 'web.helper') return [I.helper, `Site helper: ${short(x.value, 36)}`];
    if (x.do === 'doc.page') return [I.slide, `Slide ${x.value || 1}`];
    if (x.do === 'doc.next' || x.do === 'doc.prev') return [I.slide, x.do === 'doc.next' ? 'Next slide' : 'Previous slide'];
    if (x.do === 'doc.open') return [I.slide, `Show ${short(x.value, 40)}`];
    if (/^video\./.test(x.do)) return [I.video, Actions.list[x.do]?.name || x.do];
    if (x.do === 'screen.click') return [I.click, `Click ${short(x.value, 44)} (screen model)`];
    const a = Actions.list[x.do]; return [I.other, `${a?.name || x.do}${x.value ? `: ${short(x.value, 30)}` : ''}`];
  },

  /* ---------- The page ---------- */
  render(ui) {
    const d = ui.draft;
    if (d.mode === 'interactive') return this.renderAgent(ui);
    const card = (b, n) => this.card(b, n, d);
    $('#settingsBody').innerHTML = `<div class="se">
      <div class="se-top"><button class="se-back" data-sui="back">‹ Scripts</button>
        <div class="se-acts"><button class="mini-btn accent" data-sui="try:0">${svg('play')}Run</button><button class="mini-btn" data-sui="save">Save</button>
          <button class="mini-btn" data-se="more">More…</button></div></div>
      <div class="se-head">${this.inp('name', d.name, 'Script name', 'se-name')}${this.inp('about', d.about, 'What it presents (optional)', 'se-about')}</div>
      <details class="se-how"><summary>How a script runs</summary><p>The assistant goes through the steps from top to bottom. In each step it first does what's under <b>Show</b> (in order), then says its line under <b>Say</b> with the face and motion you chose, then <b>waits</b> until one of the ways under <b>Next</b> happens: you press the clicker or →, say a phrase, show a hand gesture, a few seconds pass, or something happens in the app. “Go back”, “start over” and the step dots at the bottom of the Stage always work.</p></details>
      <div class="se-tl">
        ${this.setupCard(d)}
        ${d.beats.map((b, n) => `${this.insert(n)}${card(b, n)}`).join('')}
        <div class="se-end"><button class="se-addstep" data-se="wizard:${d.beats.length}">${svg('plus')}Add a step</button>
          ${!d.beats.length ? '<p class="se-note">A step is one moment of the presentation: something on screen, a line from the assistant, and a cue to move on.</p>' : ''}</div>
      </div></div>`;
  },
  /** An interactive script: a greeting, the things it can do (intents), what it says when it doesn't understand, the end. */
  renderAgent(ui) {
    const d = ui.draft, lanes = (path, label, ic = '🖥') => `<div class="se-lane"><div class="se-lab"><i>${ic}</i>${label}</div><div class="se-body">${this.chips(this.at(path), path)}<button class="se-add" data-se="pick:${path}">${svg('plus')}Add</button></div></div>`;
    const evs = Object.entries(Bus.EVENTS).filter(([e]) => !e.startsWith('script.') || e === 'script.job');
    const intent = (it, n) => `<section class="se-card"><div class="se-node">🎯</div>
      <header>${this.inp(`intents.${n}.title`, it.title, 'What it does, e.g. Tell the time', 'se-title')}<div class="se-hacts"><button class="icon-btn" data-se="rmintent:${n}" title="Remove" aria-label="Remove">${svg('del')}</button></div></header>
      <div class="se-lane"><div class="se-lab"><i>🎤</i>When</div><div class="se-body"><label>I say (comma-separated; {name} catches words) ${this.inp(`intents.${n}.on`, asList(it.on).join(', '), 'what time is it, show sales for {month}', 'se-wide')}</label>
        <div class="se-row"><label>or a hand gesture ${this.sel(`intents.${n}.gesture`, it.gesture, SCRIPT_HAND.map(g => [g, GESTURE_WORDS?.[g] || g]), 'None')}</label><label>or when ${this.sel(`intents.${n}.event`, it.event, evs, 'Nothing')}</label></div>
        <label>Ask for what's missing (one per line: name: question)  <textarea class="se-wide" data-sfask="intents.${n}.ask" rows="2" placeholder="month: Which month?">${esc(Object.entries(it.ask || {}).map(([k, q]) => `${k}: ${q}`).join('\n'))}</textarea></label></div></div>
      <div class="se-lane"><div class="se-lab"><i>💬</i>Say</div><div class="se-body"><textarea data-sf="intents.${n}.say" rows="2" placeholder="What it says first ({variables} fill in)">${esc(it.say || '')}</textarea>
        <div class="se-row"><label>Face ${this.sel(`intents.${n}.mood`, it.mood, SCRIPT_MOODS, 'As it is')}</label><label>Motion ${this.motionSel(`intents.${n}.motion`, it.motion, true)}</label></div></div></div>
      ${lanes(`intents.${n}.steps`, 'Do')}</section>`;
    $('#settingsBody').innerHTML = `<div class="se">
      <div class="se-top"><button class="se-back" data-sui="back">‹ Scripts</button>
        <div class="se-acts"><button class="mini-btn accent" data-sui="try:0">${svg('play')}Run</button><button class="mini-btn" data-sui="save">Save</button><button class="mini-btn" data-se="more">More…</button></div></div>
      <div class="se-head">${this.inp('name', d.name, 'Script name', 'se-name')}${this.inp('about', d.about, 'What it is for (optional)', 'se-about')}</div>
      <details class="se-how"><summary>How an interactive script works</summary><p>There's no order: it greets you, then listens (conversation mode). When what you say matches one of the things it can do, it does that, then listens again, until you end it. Phrases can catch words: “show sales for {month}” keeps the month as {month}; anything missing is asked for. Steps can run <b>in the background</b> while it keeps talking, and tell you when they're done. With Understanding (Settings › Assistant) a language model picks the right one when no phrase matches.</p></details>
      <div class="se-tl">
        <section class="se-card se-setup"><div class="se-node">●</div><header><div class="se-title-fixed">When it starts</div><span class="se-sub">A greeting, and setting the stage</span></header>${lanes('setup', 'Do')}</section>
        ${(d.intents || []).map(intent).join('')}
        <div class="se-end"><button class="se-addstep" data-se="addintent">${svg('plus')}Add something it can do</button></div>
        <section class="se-card"><div class="se-node">?</div><header><div class="se-title-fixed">When it doesn't understand</div><span class="se-sub">Empty: it says what it can do</span></header>${lanes('fallback', 'Do')}</section>
        <section class="se-card"><div class="se-node">⏱</div><header><div class="se-title-fixed">When it's quiet</div></header><div class="se-lane"><div class="se-lab"><i>⏱</i>After</div><div class="se-body"><label>Seconds with nothing asked (0: never) ${this.inp('idle.after', d.idle?.after || 0, '0')}</label></div></div>${lanes('idle.steps', 'Do')}</section>
        <section class="se-card"><div class="se-node">⏹</div><header><div class="se-title-fixed">The end</div></header><div class="se-lane"><div class="se-lab"><i>🎤</i>When</div><div class="se-body"><label>I say ${this.inp('end.on', asList(d.end?.on).join(', '), 'thats all, goodbye', 'se-wide')}</label></div></div>${lanes('end.steps', 'Do')}</section>
      </div></div>`;
  },
  at(path) { let o = ScriptUI.draft; const k = path.split('.'); for (let i = 0; i < k.length; i++) o = o[k[i]] ??= (i === k.length - 1 || /^\d+$/.test(k[i + 1]) ? [] : {}); return o; },
  insert(n) { return `<button class="se-insert" data-se="wizard:${n}" aria-label="Add a step here" title="Add a step here">${svg('plus')}</button>`; },
  setupCard(d) {
    const L = d.setup || [];
    return `<section class="se-card se-setup"><div class="se-node">●</div>
      <header><div class="se-title-fixed">Before it starts</div><span class="se-sub">Sets the stage: mode, widgets, the deck, the web page</span></header>
      <div class="se-lane"><div class="se-lab"><i>🖥</i>Show</div><div class="se-body">${this.chips(L, 'setup')}<button class="se-add" data-se="pick:setup">${svg('plus')}Add</button></div></div></section>`;
  },
  card(b, n, d) {
    const N = b.next || {};
    return `<section class="se-card" data-beat="${n}"><div class="se-node">${n + 1}</div>
      <header>${this.inp(`beats.${n}.title`, b.title, 'Name this step', 'se-title')}
        <div class="se-hacts"><button class="icon-btn" data-sui="try:${n}" title="Run from this step" aria-label="Run from this step">${svg('play')}</button>
          <button class="icon-btn" data-sui="up:b.${n}" title="Move up" aria-label="Move up" ${n ? '' : 'disabled'}>↑</button><button class="icon-btn" data-sui="down:b.${n}" title="Move down" aria-label="Move down" ${n < d.beats.length - 1 ? '' : 'disabled'}>↓</button>
          <button class="icon-btn" data-se="stepmenu:${n}" title="More" aria-label="More">⋯</button></div></header>
      <div class="se-lane"><div class="se-lab"><i>🖥</i>Show</div><div class="se-body">${this.chips(b.do || [], `beats.${n}.do`)}
        <button class="se-add" data-se="pick:${n}">${svg('plus')}Add something to show or do</button></div></div>
      <div class="se-lane"><div class="se-lab"><i>💬</i>Say</div><div class="se-body">
        <textarea data-sf="beats.${n}.say" rows="2" placeholder="What the assistant says in this step… ({notes} reads the slide's speaker notes)">${esc(b.say || '')}</textarea>
        <div class="se-row"><label>Face ${this.sel(`beats.${n}.mood`, b.mood, SCRIPT_MOODS, 'As it is')}</label><label>Motion ${this.motionSel(`beats.${n}.gesture`, b.gesture, true)}</label></div></div></div>
      <div class="se-lane"><div class="se-lab"><i>⏭</i>Next</div><div class="se-body">${this.triggers(b, n, d)}
        <button class="se-add" data-se="trig:${n}">${svg('plus')}Add a way to move on</button></div></div></section>`;
  },
  /** A Show lane: chips in order; the open one shows its editor under the chips. */
  chips(L, base) {
    if (!L.length) return '<div class="se-empty">Nothing yet</div>';
    const rest = this.open?.startsWith(base + '.') ? this.open.slice(base.length + 1) : '', open = rest ? +rest.split('.')[0] : -1; // a step inside an open step keeps it open
    return `<div class="se-chips">${L.map((x, k) => { const [ic, t] = this.chip(x);
      return `<button class="se-chip ${k === open ? 'on' : ''}" data-se="chip:${base}.${k}" title="Change"><i>${ic}</i><span>${esc(t)}</span></button>`; }).join('<span class="se-then">›</span>')}</div>
      ${open >= 0 ? this.chipEditor(L[open], `${base}.${open}`, base, open, L.length) : ''}`;
  },
  /** The editor for one action (opened from its chip). */
  chipEditor(x, path, base, k, len) {
    let body;
    const lane = (k, label) => `<div class="se-nest"><div class="se-lab sm">${label}</div>${this.chips(x[k] || [], `${path}.${k}`)}<button class="se-add" data-se="pick:${path}.${k}">${svg('plus')}Add</button></div>`;
    const ids = (ScriptUI.draft.beats || []).map(b => [b.id, b.title]);
    if (typeof x === 'string') body = `<div class="se-note">${esc(x)}</div>`;
    else if (x.set != null) body = `<div class="se-row"><label>Name ${this.inp(`${path}.set`, x.set, 'answer')}</label><label>Value ${this.inp(`${path}.value`, x.value, 'text, a number, {another}…')}</label></div><div class="se-note">Use it anywhere as {${esc(x.set || 'name')}}.</div>`;
    else if (x.if != null) body = `<label>If ${this.inp(`${path}.if`, x.if, '{count} > 3 · {answer} is yes · {list} contains Paris · {x} is empty')}</label>${lane('then', 'Then')}${lane('else', 'Otherwise')}`;
    else if (x.repeat != null || x.until != null || x.each != null) body = `<div class="se-row">${x.repeat != null ? `<label>Times ${this.inp(`${path}.repeat`, x.repeat, '3')}</label>` : x.until != null ? `<label>Until ${this.inp(`${path}.until`, x.until, '{done} is yes')}</label>` : `<label>For each in ${this.inp(`${path}.each`, x.each, '{rows} or a, b, c')}</label><label>As ${this.inp(`${path}.as`, x.as, 'item')}</label>`}</div>${lane('steps', 'Steps')}<div class="se-note">{index} counts the rounds.</div>`;
    else if (x.await != null) body = `<label>Background step ${this.sel(`${path}.await`, x.await, [['all', 'All of them'], ...this.jobNames()], 'All of them')}</label>`;
    else if (x.goto != null) body = `<label>Go to ${this.sel(`${path}.goto`, x.goto, ids)}</label>`;
    else if (x.intent != null) body = `<label>Do ${this.sel(`${path}.intent`, x.intent, (ScriptUI.draft.intents || []).map(i => [i.id, i.title]))}</label>`;
    else if (x.stop) body = '<div class="se-note">Ends the script here (an interactive script says its goodbye first).</div>';
    else if (/^os\./.test(x.do || '')) body = `<div class="se-row"><label>Kind <select data-sf="${path}.do">${Object.entries(OS_KINDS).map(([k, n]) => this.opt(`os.${k}`, x.do, n)).join('')}</select></label><label>Name ${this.inp(`${path}.name`, x.name, 'What it does')}</label><label>Time limit (s) ${this.inp(`${path}.timeout`, x.timeout || 60, '60')}</label></div>
      <label>${x.do === 'os.shortcut' ? 'The Shortcut’s name' : 'Code (used as written)'} <textarea class="se-wide se-code" data-sf="${path}.value" rows="${x.do === 'os.shortcut' ? 1 : 6}" spellcheck="false">${esc(x.value || '')}</textarea></label>
      <label>Inputs, one per line ({variables} fill in; ${x.do === 'os.shell' ? '"$1", "$2"…' : x.do === 'os.shortcut' ? 'the first one is its input' : 'item 1 of argv… / argv[0]…'}) <textarea class="se-wide" data-sfargs="${path}.args" rows="2">${esc((x.args || []).join('\n'))}</textarea></label>
      <div class="se-note">${OsTasks.can() ? 'The first run asks you to allow this exact code.' : 'Runs in StudioGen on a Mac.'} The output is kept as {${esc(x.as || 'result')}} (JSON is read as data).</div>`;
    else if (x.say != null && !x.do) body = `<textarea data-sf="${path}.say" rows="2" placeholder="What the assistant says">${esc(x.say)}</textarea><div class="se-row"><label>Face ${this.sel(`${path}.mood`, x.mood, SCRIPT_MOODS, 'As it is')}</label><label>Motion ${this.motionSel(`${path}.gesture`, x.gesture, true)}</label></div>`;
    else if (x.do === 'avatar.gesture') body = `<label>Motion ${this.motionSel(`${path}.value`, x.value)}</label>`;
    else if (x.do === 'avatar.pointAt') body = `<label>Point at ${this.pointSel(`${path}.value`, x.value)}</label>`;
    else if (x.do === 'wait') body = `<label>Seconds ${this.inp(`${path}.value`, x.value, '1')}</label>`;
    else if (x.do === 'app.step') body = `<div class="se-app">${this.appFields(x, path)}</div>`;
    else body = `<div class="se-row"><label>Action ${this.actSel(`${path}.do`, x.do)}</label><label>${esc(Actions.list[x.do]?.arg || 'Value')} ${this.inp(`${path}.value`, x.value, Actions.list[x.do]?.arg || '')}</label></div>`;
    if (x.do) body += `<div class="se-row se-bg"><label class="se-check"><input type="checkbox" data-sfb="${path}.background" ${x.background ? 'checked' : ''}> In the background: the script carries on while it runs</label>
      <label>Keep the result as ${this.inp(`${path}.as`, x.as, 'result')}</label>${x.background ? `<label>Name ${this.inp(`${path}.name`, x.name, 'export')}</label>` : ''}</div>${x.background ? `${lane('then', 'When it’s done')}${lane('else', 'If it fails')}` : ''}`;
    return `<div class="se-edit"><div class="se-edit-body">${body}</div>
      <div class="se-edit-acts"><button class="mini-btn" data-sui="try1:${path}">${svg('play')}Try it</button>
        <button class="mini-btn" data-sui="mvup:${path}" ${k ? '' : 'disabled'}>‹ Earlier</button><button class="mini-btn" data-sui="mvdn:${path}" ${k < len - 1 ? '' : 'disabled'}>Later ›</button>
        <button class="mini-btn danger" data-se="rmp:${path}">Remove</button><button class="mini-btn" data-se="chip:${path}">Done</button></div></div>`;
  },
  jobNames() { const out = []; const walk = L => (L || []).forEach(x => { if (x?.background) out.push([x.name || x.do, x.name || Actions.list[x.do]?.name || x.do]); ['then', 'else', 'steps'].forEach(k => walk(x?.[k])); });
    const d = ScriptUI.draft; walk(d.setup); (d.beats || []).forEach(b => walk(b.do)); (d.intents || []).forEach(i => walk(i.steps)); return out; },
  /** An app step's fields: what to do, how to find its target (the recorded element, text, a captured area, a description, your detector). */
  appFields(x, path) {
    const st = appStepOf(x.value) || { t: 'click', loc: {} }, L = st.loc || {}, f = `data-asf="${path}"`, o = this.opt.bind(this);
    if (st.t === 'wait' || st.t === 'web') return `<div class="se-note">${esc(AppSteps.describe(st))}</div>`;
    const mode = L.match?.img ? 'area' : L.match?.ai != null ? 'ai' : L.match?.det ? 'det' : L.match ? 'text' : 'el', recorded = !!(L.tag || L.path || Object.keys(L.data || {}).length);
    return `<div class="se-row"><label>Do <select ${f} data-k="t">${[['click', 'Click'], ['type', 'Type'], ['select', 'Choose'], ['key', 'Press a key'], ['scroll', 'Scroll'], ...(st.t === 'drag' ? [['drag', 'Drag']] : [])].map(([k, l]) => o(k, st.t, l)).join('')}</select></label>
        <label>Find it by <select ${f} data-k="find">${[...(recorded ? [['el', 'Where it was recorded']] : []), ['text', 'Its text on screen'], ['area', 'A picture of it (screen area)'], ['ai', 'A description (screen model)'], ...(UiDetect.cfg() ? [['det', 'Its kind (your detector)']] : [])].map(([k, l]) => o(k, mode, l)).join('')}</select></label></div>
      ${mode === 'text' ? `<div class="se-row"><label>Text ${`<input ${f} data-k="text" value="${esc(L.match.text || '')}" placeholder="The words on screen">`}</label><button class="mini-btn" data-sui="picktext:${path}">Pick on screen</button></div>` : ''}
      ${mode === 'area' ? `<div class="se-row"><img class="sui-thumb" src="${esc(L.match.img || '')}" alt="The captured area"><button class="mini-btn" data-sui="pickarea:${path}">Capture again</button></div>` : ''}
      ${mode === 'ai' ? `<div class="se-row"><label>Description <input ${f} data-k="ai" value="${esc(L.match.ai || '')}" placeholder="e.g. the Search Flight button"></label></div>` : ''}
      ${mode === 'det' ? `<div class="se-row"><label>Kind <select ${f} data-k="det">${(UiDetect.cfg()?.classes || []).map(c => o(c, L.match.det)).join('')}</select></label><button class="mini-btn" data-sui="picktext:${path}">Pick where</button></div>` : ''}
      ${mode === 'el' ? `<div class="se-note">${esc(AppSteps.describe(st))}</div>` : ''}
      ${st.t === 'type' || st.t === 'select' ? `<div class="se-row"><label>${st.t === 'type' ? 'Text to type' : 'Option'} <input ${f} data-k="value" value="${esc(st.value ?? '')}"></label></div>` : ''}
      ${st.t === 'key' ? `<div class="se-row"><label>Key <select ${f} data-k="key">${['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Backspace'].map(k => o(k, st.key, k === ' ' ? 'Space' : k)).join('')}</select></label></div>` : ''}
      ${st.t === 'scroll' && (st.amount || st.top == null) ? `<div class="se-row"><label>How far <select ${f} data-k="amount">${[['down', 'Down a screenful'], ['up', 'Up a screenful'], ['top', 'To the top'], ['bottom', 'To the bottom']].map(([k, l]) => o(k, st.amount, l)).join('')}</select></label></div>` : ''}`;
  },
  /** The Next lane: one chip per way to move on; tapping one opens its setting. */
  triggers(b, n, d) {
    const N = b.next || {}, ids = d.beats.map(x => [x.id, x.title]), chips = [], open = this.open?.startsWith(`next:${n}:`) ? this.open.split(':')[2] : '';
    if (N.key !== false) chips.push(['key', '⌨️', 'Clicker or → key']);
    if (asList(N.on).length) chips.push(['say', '🎤', `I say “${asList(N.on).join('”, “')}”`]);
    if (N.gesture) chips.push(['gesture', '✋', `Hand: ${GESTURE_WORDS?.[N.gesture] || N.gesture}`]);
    if (N.after > 0) chips.push(['after', '⏱', `Automatically, ${N.after} s after it's done`]);
    if (N.event) chips.push(['event', '⚡', `When: ${Bus.EVENTS[N.event] || N.event}`]);
    if (N.goto) chips.push(['goto', '↪️', `Then go to: ${d.beats.find(x => x.id === N.goto)?.title || N.goto}`]);
    (b.branches || []).forEach((r, k) => chips.push([`br${k}`, '🔀', `If ${asList(r.on).length ? `I say “${asList(r.on).join('”, “')}”` : ''}${r.gesture ? `${asList(r.on).length ? ' or ' : ''}hand ${r.gesture}` : ''} → ${d.beats.find(x => x.id === r.goto)?.title || r.goto}`]));
    const ed = {
      key: `<div class="se-note">Moves on when you press the clicker, → or Page Down.</div><button class="mini-btn danger" data-se="nextoff:${n}:key">Don't use the clicker for this step</button>`,
      say: `<label>Phrases (comma-separated) ${this.inp(`beats.${n}.next.on`, asList(N.on).join(', '), 'next, continue')}</label>`,
      gesture: `<label>Hand gesture ${this.sel(`beats.${n}.next.gesture`, N.gesture, SCRIPT_HAND.map(g => [g, GESTURE_WORDS?.[g] || g]), 'None')}</label><div class="se-note">Needs Follow the presenter (Settings › Mode).</div>`,
      after: `<label>Seconds after its actions and line are done ${this.inp(`beats.${n}.next.after`, N.after || 0, '0')}</label>`,
      event: `<label>When this happens ${this.sel(`beats.${n}.next.event`, N.event, Object.entries(Bus.EVENTS).filter(([e]) => !e.startsWith('script.')).map(([e, t]) => [e, t]), 'Nothing')}</label>`,
      goto: `<label>Then go to ${this.sel(`beats.${n}.next.goto`, N.goto, ids, 'The next step')}</label>`,
    };
    const brEd = k => { const r = b.branches[k]; return `<div class="se-row"><label>If I say ${this.inp(`beats.${n}.branches.${k}.on`, asList(r.on).join(', '), 'show me the live data')}</label>
      <label>or hand ${this.sel(`beats.${n}.branches.${k}.gesture`, r.gesture, SCRIPT_HAND)}</label><label>go to ${this.sel(`beats.${n}.branches.${k}.goto`, r.goto, ids)}</label></div><button class="mini-btn danger" data-sui="rmbr:b.${n}.${k}">Remove this branch</button>`; };
    const body = open ? (open.startsWith('br') ? brEd(+open.slice(2)) : ed[open]) : '';
    return `${chips.length ? `<div class="se-note">Moves on at the first of these:</div><div class="se-chips">${chips.map(([k, ic, t]) => `<button class="se-chip trig ${k === open ? 'on' : ''}" data-se="chip:next:${n}:${k}"><i>${ic}</i><span>${esc(t)}</span></button>`).join('')}</div>`
      : '<div class="se-empty warn">No way to move on yet: it would wait here until you say “next” or press →</div>'}
      ${body ? `<div class="se-edit"><div class="se-edit-body">${body}</div><div class="se-edit-acts">${open !== 'key' && !open.startsWith('br') ? `<button class="mini-btn danger" data-se="nextoff:${n}:${open}">Remove</button>` : ''}<button class="mini-btn" data-se="chip:next:${n}:${open}">Done</button></div></div>` : ''}`;
  },

  /* ---------- Pickers ---------- */
  pickShow(where) {
    const desk = !!window.DriveDeckDesktop?.browser, T = (id, ic, t, s) => `<button class="se-tile" data-se="addx:${id}@${where}"><i>${ic}</i><b>${t}</b><span>${s}</span></button>`;
    const groups = [
      ['The assistant', [T('say', '💬', 'Say something', 'A line spoken with lip-sync and a caption'), T('motion', '🧍', 'A motion', 'Wave, point, present, bow… or one you captured'), T('point', '👉', 'Point at a widget', 'It works out which way to point')]],
      ['Slides and media', [T('slide', '📄', 'Go to a slide', 'A page of the deck or PDF'), T('nextslide', '📄', 'Next slide', 'One page on'), T('doc', '📑', 'Show a document', 'A deck, PDF or file by its link')]],
      ['Web pages', [T('web', '🌐', 'Open a web page', 'In the web page widget'), ...(desk ? [T('helper', '🧩', 'Run a site helper', 'Your CSS/JavaScript for the page')] : []), T('recweb', '⏺', 'Record clicks on the page', 'Do it once, it plays it back')]],
      ['Do on screen', [T('clicktext', '👆', 'Click some text', 'Pick the words on screen'), T('clickarea', '🖼', 'Click a screen area', 'Drag a box: found again by its picture'), T('clickai', '🔎', 'Click something described', '“the Search button” (screen model)'),
        T('type', '⌨️', 'Type text', 'Into a field found by its text'), T('key', '⌨️', 'Press a key', 'Enter, Escape, arrows…'), T('scroll', '↕️', 'Scroll', 'A screenful, or to the top or bottom'), T('recapp', '⏺', 'Record what I do', 'Clicks, typing and scrolling anywhere')]],
      ['Timing and more', [T('wait', '⏱', 'Wait', 'A pause, in seconds'), T('action', '⚙️', 'Any widget action', 'Radio, video, maps, voice commands…')]],
      ['This computer (StudioGen on a Mac)', [...OS_TASKS.map(t => T(`os:${t.id}`, '💻', t.name, t.about || t.hint || OS_KINDS[t.kind])), T('os:applescript', '🍎', 'Your own AppleScript', 'Control apps; values come in as argv'), T('os:jxa', '📜', 'JavaScript for Automation', 'The same, in JavaScript'), T('os:shell', '⌨️', 'Shell command', 'zsh; values come in as $1, $2…')]],
      ['Logic', [T('set', '🏷', 'Set a value', 'Remember something as {name}'), T('if', '🔀', 'If…', 'Do one thing or another'), T('repeat', '🔁', 'Repeat', 'Some times, or until something is true'),
        T('each', '🔁', 'For each', 'Every row, file or item in a list'), T('await', '⏳', 'Wait for a background step', 'Steps marked “in the background” run while it carries on'),
        ...(ScriptUI.draft?.mode === 'interactive' ? [T('intent', '🎯', 'Do another intent', 'Run one of the things it can do')] : [T('goto', '↪️', 'Go to a step', 'Jump, also backwards: a loop')]), T('ask', '🧠', 'Ask the model', 'A question to the language model (Understanding)'), T('stop', '⏹', 'End the script', 'Stop here')]],
    ];
    sheet('Add to this step', `<div class="se-pick">${groups.map(([g, tiles]) => `<div class="se-pick-g">${g}</div><div class="se-tiles">${tiles.join('')}</div>`).join('')}</div>`, [['Cancel']]);
  },
  pickTrigger(n) {
    const T = (id, ic, t, s) => `<button class="se-tile" data-se="addt:${id}@${n}"><i>${ic}</i><b>${t}</b><span>${s}</span></button>`;
    sheet('How does this step move on?', `<div class="se-pick"><div class="se-tiles">
      ${T('key', '⌨️', 'Clicker or → key', 'A presentation clicker, →, Page Down or space')}${T('say', '🎤', 'When I say…', 'A phrase like “next” or “show me”')}
      ${T('gesture', '✋', 'A hand gesture', 'Swipe left, thumbs up… (Follow the presenter)')}${T('after', '⏱', 'Automatically', 'Some seconds after its line and actions')}
      ${T('event', '⚡', 'When something happens', 'A web step played, a radio starts, you arrive…')}${T('goto', '↪️', 'Jump somewhere else', 'Go to another step instead of the next')}
      ${T('branch', '🔀', 'A choice', '“If I say … go to that step”')}</div><p class="se-note">A step can have several: it moves on at whichever happens first.</p></div>`, [['Cancel']]);
  },

  /* ---------- The wizard for a new step: what's shown, what's said, how it moves on ---------- */
  wizard(at) { this.wz = { at, page: 0, show: 'none', slide: '', url: '', say: '', notes: false, mood: '', motion: '', key: true, phrase: 'next', gesture: '', after: '' }; this.wzPage(); },
  wzPage() {
    const w = this.wz, steps = ['On screen', 'The assistant says', 'Moving on'], head = `<div class="se-wz-steps">${steps.map((s, i) => `<span class="${i === w.page ? 'on' : i < w.page ? 'done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
    const R = (k, v, label, sub) => `<label class="se-radio"><input type="radio" name="wzShow" value="${v}" ${w.show === v ? 'checked' : ''}><b>${label}</b><span>${sub}</span></label>`;
    let body;
    if (w.page === 0) body = `<p class="se-note">What should be on screen in this step?</p>
      ${R('show', 'slide', '📄 A slide', 'A page of the deck')}${w.show === 'slide' ? `<input id="wzSlide" class="se-wz-in" value="${esc(w.slide)}" placeholder="Slide number, e.g. 3">` : ''}
      ${R('show', 'web', '🌐 A web page', 'Opens in the web page widget')}${w.show === 'web' ? `<input id="wzUrl" class="se-wz-in" value="${esc(w.url)}" placeholder="https://…">` : ''}
      ${R('show', 'do', '👆 Something done on screen', 'Clicks, typing… (you add them on the card next)')}
      ${R('show', 'none', '— Nothing new', 'Stay on what’s showing')}`;
    else if (w.page === 1) body = `<p class="se-note">What does the assistant say? (You can leave it empty.)</p>
      <textarea id="wzSay" class="se-wz-in" rows="3" placeholder="e.g. Here's how many drivers used it this quarter.">${esc(w.say)}</textarea>
      <label class="se-check"><input type="checkbox" id="wzNotes" ${w.notes ? 'checked' : ''}> Read the slide's speaker notes instead</label>
      <div class="se-row"><label>Face <select id="wzMood"><option value="">As it is</option>${SCRIPT_MOODS.map(m => this.opt(m, w.mood)).join('')}</select></label>
        <label>Motion <select id="wzMotion"><option value="">No motion</option>${Object.entries(MOTIONS).filter(([k]) => !k.startsWith('__')).map(([k, m]) => this.opt(k, w.motion, m.name)).join('')}</select></label></div>`;
    else body = `<p class="se-note">When should it move on to the next step? (Whichever happens first.)</p>
      <label class="se-check"><input type="checkbox" id="wzKey" ${w.key ? 'checked' : ''}> ⌨️ When I press the clicker or →</label>
      <label class="se-check"><input type="checkbox" id="wzSayOn" ${w.phrase ? 'checked' : ''}> 🎤 When I say <input id="wzPhrase" class="se-wz-inline" value="${esc(w.phrase || 'next')}"></label>
      <label class="se-check"><input type="checkbox" id="wzGest" ${w.gesture ? 'checked' : ''}> ✋ With a hand gesture <select id="wzGesture">${SCRIPT_HAND.map(g => this.opt(g, w.gesture || 'Swipe_Left', GESTURE_WORDS?.[g] || g)).join('')}</select></label>
      <label class="se-check"><input type="checkbox" id="wzAuto" ${w.after ? 'checked' : ''}> ⏱ Automatically, <input id="wzAfter" class="se-wz-inline num" value="${esc(w.after || '2')}"> seconds after it's done</label>`;
    sheet('New step', `<div class="se-wz">${head}${body}</div>`, w.page < 2 ? [['Next ›', () => this.wzNext(1)], ...(w.page ? [['‹ Back', () => this.wzNext(-1)]] : []), ['Cancel']] : [['Add the step', () => this.wzDone()], ['‹ Back', () => this.wzNext(-1)], ['Cancel']]);
  },
  wzRead() {
    const w = this.wz, v = id => $(`#${id}`);
    if (w.page === 0) { w.show = $('input[name=wzShow]:checked')?.value || w.show; if (v('wzSlide')) w.slide = v('wzSlide').value; if (v('wzUrl')) w.url = v('wzUrl').value; }
    if (w.page === 1) { w.say = v('wzSay').value; w.notes = v('wzNotes').checked; w.mood = v('wzMood').value; w.motion = v('wzMotion').value; }
    if (w.page === 2) { w.key = v('wzKey').checked; w.phrase = v('wzSayOn').checked ? v('wzPhrase').value : ''; w.gesture = v('wzGest').checked ? v('wzGesture').value : ''; w.after = v('wzAuto').checked ? v('wzAfter').value : ''; }
  },
  wzNext(d) { this.wzRead(); this.wz.page += d; this.wzPage(); },
  wzDone() {
    this.wzRead(); const w = this.wz, D = ScriptUI.draft, n = w.at, doList = [];
    if (w.show === 'slide') doList.push({ do: 'doc.page', value: String(parseInt(w.slide, 10) || 1) });
    if (w.show === 'web' && w.url.trim()) doList.push({ do: 'web.open', value: w.url.trim() });
    const title = w.show === 'slide' ? `Slide ${parseInt(w.slide, 10) || 1}` : w.show === 'web' ? (() => { try { return new URL(w.url).host.replace(/^www\./, ''); } catch { return 'Web page'; } })() : (w.say || '').split(/[.!?]/)[0].slice(0, 40) || `Step ${n + 1}`;
    const ids = new Set(D.beats.map(b => b.id)); let id = `step${n + 1}`; for (let i = 2; ids.has(id); i++) id = `step${n + 1}-${i}`;
    D.beats.splice(n, 0, { id, title, say: w.notes ? '{notes}' : w.say, mood: w.mood, gesture: w.motion, do: doList,
      next: { key: w.key, on: w.phrase ? asList(w.phrase) : [], gesture: w.gesture, after: +w.after || 0 } });
    this.open = null; ScriptUI.renderEditor(); toast('Step added');
    if (w.show === 'do') setTimeout(() => this.pickShow(n), 300);
    setTimeout(() => $(`.se-card[data-beat="${n}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
  },

  /* ---------- Commands (data-se) ---------- */
  cmd(v) {
    const ui = ScriptUI, d = ui.draft; if (!d) return;
    const [a, ...rest] = v.split(':'), arg = rest.join(':');
    if (a === 'chip') { this.open = this.open === arg ? null : arg; return ui.renderEditor(); }
    if (a === 'pick') return this.pickShow(arg);
    if (a === 'trig') return this.pickTrigger(+arg);
    if (a === 'wizard') return this.wizard(+arg);
    if (a === 'rm') { this.open = null; return ui.cmd(`rmdo:${arg}`); }
    if (a === 'rmp') { this.open = null; return ui.cmd(`rmp:${arg}`); }
    if (a === 'addintent') { const n = (d.intents ||= []).length; d.intents.push({ id: `intent${n + 1}`, title: '', on: [], say: '', steps: [] }); ui.renderEditor(); return setTimeout(() => $$('.se-card .se-title').at(-1)?.focus(), 50); }
    if (a === 'rmintent') return sheet('Remove this?', `<p>${esc(d.intents[+arg]?.title || 'This intent')}</p>`, [['Remove', () => { d.intents.splice(+arg, 1); ui.renderEditor(); }], ['Cancel']]);
    if (a === 'addx') {
      closeSheet(); const [kind, where] = arg.split('@'), base = where === 'setup' || where.includes('.') ? where : `beats.${where}.do`;
      const L = (() => { let o = d; const k = base.split('.'); for (let i = 0; i < k.length; i++) o = o[k[i]] ??= (i === k.length - 1 || /^\d+$/.test(k[i + 1]) ? [] : {}); return o; })();
      const push = x => { L.push(x); this.open = `${base}.${L.length - 1}`; ui.renderEditor(); };
      const app = st => ({ do: 'app.step', value: JSON.stringify(st) });
      const viaUi = { say: 'say', motion: 'motion', point: 'point', wait: 'wait', clicktext: 'clicktext', clickarea: 'clickarea', type: 'type', scroll: 'scroll', action: 'action' }[kind];
      if (viaUi) { const before = L.length; ui.cmd(`add:${viaUi}@${where}`); if (L.length > before) { this.open = `${base}.${L.length - 1}`; ui.renderEditor(); } return; }
      const logic = { set: { set: 'answer', value: '' }, if: { if: '{answer} is yes', then: [], else: [] }, repeat: { repeat: '3', steps: [] }, each: { each: '{rows}', as: 'item', steps: [] }, await: { await: 'all' },
        goto: { goto: d.beats?.[0]?.id || '' }, intent: { intent: d.intents?.[0]?.id || '' }, ask: { do: 'brain.ask', value: '', as: 'answer' }, stop: { stop: true } }[kind];
      if (logic) return push(logic);
      if (kind.startsWith('os:')) { const t = OS_TASKS.find(o => o.id === kind.slice(3)); return push(t ? { do: `os.${t.kind}`, value: t.code, args: [...t.args], name: t.name, as: 'result' } : { do: `os.${kind.slice(3)}`, value: '', args: [], name: '', as: 'result' }); }
      if (kind === 'slide') return push({ do: 'doc.page', value: '1' });
      if (kind === 'nextslide') return push({ do: 'doc.next', value: '' });
      if (kind === 'doc') return push({ do: 'doc.open', value: '' });
      if (kind === 'web') return push({ do: 'web.open', value: 'https://' });
      if (kind === 'helper') return push({ do: 'web.helper', value: WebDrive.helperList()[0]?.name || SITE_HELPER_EXAMPLES[0].name });
      if (kind === 'clickai') return push(app({ t: 'click', loc: { match: { ai: '', in: 'web' } } }));
      if (kind === 'key') return push(app({ t: 'key', key: 'Enter', loc: null }));
      if (kind === 'recweb') return ui.cmd(`rec:b.${where === 'setup' ? 0 : where}`);
      if (kind === 'recapp') return ui.cmd(`recapp:b.${where === 'setup' ? 0 : where}`);
      return;
    }
    if (a === 'addt') {
      closeSheet(); const [kind, ns] = arg.split('@'), n = +ns, N = (d.beats[n].next ||= {});
      if (kind === 'key') N.key = true;
      if (kind === 'say' && !asList(N.on).length) N.on = ['next'];
      if (kind === 'gesture') N.gesture ||= 'Swipe_Left';
      if (kind === 'after') N.after ||= 2;
      if (kind === 'event') N.event ||= 'web.step';
      if (kind === 'goto') N.goto ||= d.beats[(n + 1) % d.beats.length]?.id || '';
      if (kind === 'branch') { (d.beats[n].branches ||= []).push({ on: [''], gesture: '', goto: d.beats[0]?.id || '' }); this.open = `next:${n}:br${d.beats[n].branches.length - 1}`; return ui.renderEditor(); }
      this.open = `next:${n}:${kind}`; return ui.renderEditor();
    }
    if (a === 'nextoff') {
      const [ns, k] = arg.split(':'), N = d.beats[+ns].next ||= {};
      ({ key: () => N.key = false, say: () => N.on = [], gesture: () => N.gesture = '', after: () => N.after = 0, event: () => N.event = '', goto: () => N.goto = '' })[k]?.();
      this.open = null; return ui.renderEditor();
    }
    if (a === 'stepmenu') {
      const n = +arg, b = d.beats[n];
      return sheet(b.title || `Step ${n + 1}`, `<label class="fld"><span>Step id (for jumps and “go to”)</span><input id="seId" value="${esc(b.id)}"></label>`,
        [['Save the id', () => { b.id = $('#seId').value.trim() || b.id; ui.renderEditor(); }], ['Duplicate this step', () => { const c = JSON.parse(JSON.stringify(b)); c.id = `${b.id}-copy`; d.beats.splice(n + 1, 0, c); ui.renderEditor(); }],
          ['Delete this step', () => { d.beats.splice(n, 1); this.open = null; ui.renderEditor(); }], ['Cancel']]);
    }
    if (a === 'more') return sheet(d.name || 'Script', '<p class="se-note">Check it for problems, edit it as JSON, export it with what it uses, or read how scripts work.</p>',
      [['Check', () => ui.cmd('check')], ['Export as a bundle', () => typeof Bundles !== 'undefined' && Bundles.export([ui.editId ? Scripts.get(ui.editId) : { name: d.name, json: d }])], ['Edit as JSON', () => ui.cmd('json')], ['Help', () => ui.cmd('help')], ['Cancel']]);
  },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-se]'); if (!b || !ScriptUI.draft) return; e.stopPropagation(); StepEditor.cmd(b.dataset.se); }, true);
// Typing in the wizard's radio choices shows their input at once.
document.addEventListener('change', e => { if (e.target.name === 'wzShow' && StepEditor.wz) { StepEditor.wzRead(); StepEditor.wzPage(); } });
