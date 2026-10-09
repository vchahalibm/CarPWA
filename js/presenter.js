'use strict';
/* The presenter view (presenter.html): follows and controls the DriveDeck window over a BroadcastChannel ('dd-present').
   Shows the step and what the assistant says, the slide's speaker notes, what's next, a timer and a live preview.
   The DriveDeck side is Presenter in js/script.js. Keys: → / space next, ← back, Home start over, M talk, Esc stop. */
(() => {
  const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ch = new BroadcastChannel('dd-present');
  let st = null, last = 0;
  const send = (op, arg) => ch.postMessage({ t: 'cmd', op, arg });
  ch.onmessage = e => { if (e.data?.t === 'state') { st = e.data; last = Date.now(); render(); } };
  ch.postMessage({ t: 'hello' });
  setInterval(() => { ch.postMessage({ t: Date.now() - last > 4000 ? 'hello' : 'ping' }); if (Date.now() - last > 6000 && st) { st = null; render(); } }, 2000);

  function render() {
    const on = !!st, run = on && st.running;
    document.documentElement.dataset.theme = st?.theme || 'dark';
    $('#pvWait').hidden = on;
    $('#pvName').textContent = run ? st.name : 'Presenter view';
    $('#pvStep').textContent = run && st.beats.length ? `Step ${st.i + 1} of ${st.beats.length}` : '';
    $('#pvNow').hidden = !run; $('#pvNext').hidden = !run;
    if (run) {
      $('#pvNowTitle').textContent = st.now?.title || ''; $('#pvNowSay').textContent = st.now?.say || '(no line)';
      $('#pvNextTitle').textContent = st.next ? st.next.title : 'The end'; $('#pvNextSay').textContent = st.next?.say || '';
    }
    $('#pvNotes').hidden = !(on && st.slide);
    if (on && st.slide) { $('#pvSlide').textContent = `Slide ${st.slide.page}${st.slide.pages ? ` of ${st.slide.pages}` : ''} · speaker notes`; $('#pvNotesText').textContent = st.slide.notes || 'No speaker notes on this slide.'; }
    $('#pvScripts').hidden = !on || run;
    if (on && !run) $('#pvScriptList').innerHTML = st.scripts.map(s => `<button class="pv-btn" data-start="${esc(s.id)}">${esc(s.name)}</button>`).join('') || '<p class="pv-dim">No scripts yet: make one in Settings › Scripts.</p>';
    $('#pvStepsBox').hidden = !run;
    if (run) $('#pvSteps').innerHTML = st.beats.map((b, k) => `<li><button class="${k === st.i ? 'on' : k < st.i ? 'done' : ''}" data-jump="${k}">${esc(b.title)}</button></li>`).join('');
    $('#pvHeard').textContent = st?.heard ? `“${st.heard}”` : '—'; $('#pvReply').textContent = st?.reply || '—';
    document.querySelectorAll('[data-op]').forEach(b => { b.disabled = !on || (!run && !['back', 'next', 'mic'].includes(b.dataset.op)); });
    $('[data-op="next"]').textContent = run || !st?.slide ? 'Next ▶' : 'Next slide ▶';
  }
  const tick = () => {
    const d = new Date(); $('#pvClock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const s = st?.running && st.since ? Math.max(0, Math.floor((Date.now() - st.since) / 1000)) : 0;
    $('#pvTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  setInterval(tick, 1000); tick(); render();

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.op) send(b.dataset.op);
    else if (b.dataset.start) send('start', b.dataset.start);
    else if (b.dataset.jump) send('jump', b.dataset.jump);
    else if (b.id === 'pvPreview') preview();
  });
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const op = { ArrowRight: 'next', PageDown: 'next', ' ': 'next', ArrowLeft: 'back', PageUp: 'back', Home: 'restart', Escape: 'stop', m: 'mic' }[e.key];
    if (op && st) { e.preventDefault(); send(op); }
  });
  /** A live picture of the DriveDeck window (the desktop app picks it; a browser asks which window). */
  async function preview() {
    const v = $('#pvVideo'), box = $('#pvPrevBox');
    if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; box.hidden = true; $('#pvPreview').textContent = 'Live preview'; return; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      v.srcObject = s; box.hidden = false; $('#pvPreview').textContent = 'Hide preview';
      s.getVideoTracks()[0].onended = () => { v.srcObject = null; box.hidden = true; $('#pvPreview').textContent = 'Live preview'; };
    } catch (e) { console.warn('No preview', e); }
  }
})();
