'use strict';
/* ============================================================
   Cards instead of leaving the screen. On any screen (a pop-up card; on Stage beside the assistant; on the Agent screen a
   result card in the feed where one is defined, COMMAND_CARDS), a screen that a command or a script opens (weather, messages, music, a map, “what can I say”…) shows as a card over the current screen instead,
   so the presentation, the 3D assistant, the camera and a running script carry on underneath. A screen you open with
   your own tap still opens normally.
   - The card is the real screen (its section), drawn in a floating panel; on Stage it covers the content side and leaves
     the presenter column (the assistant) visible; on a phone it's a sheet from the bottom.
   - It stays until you say “close card” (or tap ✕) or the script moves to its next step.
   - Private screens (messages, calls, calendar; agent results from mail, calendar and chats) show only when Settings ›
     Stage › Show private things on screen is on; otherwise the reply is spoken and nothing is shown.
   - In the car (Drive mode) screens switch as before, except on the Agent home screen. A route (maps) always opens the
     map while driving.
   Loaded after agent.js.
   ============================================================ */
const PEEK_VIEWS = ['weather', 'messages', 'phone', 'calendar', 'music', 'maps', 'drive', 'mesh', 'settings'];
const PEEK_PRIVATE = ['messages', 'phone', 'calendar'];
/** Answers with a result card of their own (for the Agent screen's feed and the timeline): { title, type, headline, items }. */
const COMMAND_CARDS = {
  weather() {
    if (typeof wx === 'undefined' || !wx) return null;
    const r = Math.round, place = typeof placeName === 'function' ? placeName().replace(/ \(default.*$/, '') : '', day = d => d.t.toLocaleDateString([], { weekday: 'long' });
    return { title: 'Weather', type: 'list', headline: `${r(wx.cur.temp)}° and ${wxInfo(wx.cur.code)[0].toLowerCase()}${place ? ` in ${place}` : ''}${wx.live ? '' : ' (sample)'}`,
      items: wx.daily.slice(0, 4).map((d, i) => ({ title: i ? day(d) : 'Today', detail: `${wxInfo(d.code)[0]} · ${r(d.hi)}° / ${r(d.lo)}°${d.pop ? ` · rain ${d.pop}%` : ''}` })) };
  },
};
const Peek = {
  open: null, tapAt: 0,
  /** Where the card goes: 'stage' (presenting), 'home' (the Agent screen), or 'pop' (a pop-up over any other screen). */
  mode() {
    if (typeof Stage !== 'undefined' && Stage.on && current === 'dashboard') return 'stage';
    if (current === 'agent') return 'home'; // the Agent screen: results in its feed, Stage or not
    return 'pop';
  },
  /** openView asks first: true when it showed (or deliberately didn't show) a card instead of switching screens. */
  take(id) {
    if (Date.now() - this.tapAt < 900) return false; // your own tap: open the screen
    const m = this.mode(); if (!m || !PEEK_VIEWS.includes(id) || id === current) return false;
    if (id === 'maps' && (m === 'home' || settings.appMode !== 'stage')) return false; // in the car a route needs the whole map
    if (id === 'settings') { if (m === 'pop') return false; this.say(); return true; } // on Stage or the Agent screen “what can I say” is a card; elsewhere Settings opens
    // an answer with a card of its own (weather): in the feed on the Agent screen, on the timeline everywhere
    const card = !PEEK_PRIVATE.includes(id) || settings.peekPrivate ? COMMAND_CARDS[id]?.() : null;
    if (card && typeof Agent !== 'undefined') { store.set('agentFeed', Agent.feed().filter(x => x.task !== `cmd.${id}`)); /* the newer answer replaces the older card (the timeline keeps both) */ const c = Agent.post({ task: `cmd.${id}`, title: card.title, ...card, status: 'done' }); Agent.log({ id: c.id, kind: 'command', title: card.title, status: 'done', headline: card.headline, items: card.items }); if (m === 'home') return true; }
    if (PEEK_PRIVATE.includes(id) && !settings.peekPrivate) { Log.i('peek', `Private screen kept off the screen: ${id} (the reply is spoken)`); return true; }
    this.show(id, m); return true;
  },
  show(id, m = this.mode()) {
    this.close();
    const sec = document.getElementById(`view-${id}`); if (!sec) return;
    sec.classList.add('peek', `peek-${m}`); this.open = { id, sec };
    if (!sec.querySelector('.peek-x')) sec.insertAdjacentHTML('afterbegin', `<button class="peek-x" data-peek="close" aria-label="Close card">${svg('close')}</button>`);
    try { VIEW_RENDER[id]?.(); } catch (e) { Log.w('peek', `Card ${id} didn't draw`, e); }
    if (id === 'maps') setTimeout(() => { try { maps.main.map?.resize(); } catch {} }, 350);
    if (id === 'mesh' && typeof MeshView !== 'undefined') MeshView.render();
    if (m === 'stage' && typeof Avatar !== 'undefined') Avatar.gesture('PresentLeft');
    Log.i('peek', `Card: ${id} (${m})`);
  },
  /** A card with your own content (an agent result, “what can I say”). */
  html(title, body, m = this.mode()) {
    if (!m) return false; this.close();
    let el = document.getElementById('peekCard');
    if (!el) { el = document.createElement('section'); el.id = 'peekCard'; el.className = 'peek-card'; document.body.appendChild(el); }
    el.className = `peek-card peek peek-${m}`;
    el.innerHTML = `<button class="peek-x" data-peek="close" aria-label="Close card">${svg('close')}</button><div class="peek-body"><h2>${esc(title)}</h2>${body}</div>`;
    this.open = { id: 'card', sec: el };
    if (m === 'stage' && typeof Avatar !== 'undefined') Avatar.gesture('PresentLeft');
    return true;
  },
  /** “What can I say” on Stage or the Agent home: what works right now. */
  say() {
    const running = typeof Script !== 'undefined' && Script.running, stage = this.mode() === 'stage';
    const groups = [
      ...(running ? [['This presentation', Script.cur.mode === 'interactive' ? Script.cur.intents.slice(0, 6).map(i => i.on[0] || i.title) : ['next', 'go back', 'back two steps', 'start over', 'repeat that', 'stop the demo']]] : []),
      ...(stage ? [['On Stage', ['next slide', 'go to slide 5', 'what’s on this slide', 'close card']]] : [['Your agent', ['summarise my unread mail', 'what’s my day', 'any WhatsApp messages', 'where did I park']]]),
      ['Anything', ['what’s the weather', 'what time is it', 'play the radio', 'who’s around']],
    ];
    this.html('What you can say now', `<div class="peek-say">${groups.map(([t, l]) => `<div><b>${esc(t)}</b><ul>${l.map(x => `<li>“${esc(x)}”</li>`).join('')}</ul></div>`).join('')}</div>
      <p class="se-note">Every command: Settings › Voice › Voice commands (on your own screen).</p>`);
  },
  close() {
    const o = this.open; if (!o) return; this.open = null;
    if (o.id === 'card') o.sec.remove(); else o.sec.classList.remove('peek', 'peek-stage', 'peek-home', 'peek-pop');
  },
};
addEventListener('pointerdown', () => { Peek.tapAt = Date.now(); }, { capture: true, passive: true });
document.addEventListener('click', e => { if (e.target.closest('[data-peek="close"]')) { e.stopPropagation(); Peek.close(); } }, true);
Bus.on('script.beat', () => Peek.close()); // the script moved on
Bus.on('script.end', () => Peek.close());
