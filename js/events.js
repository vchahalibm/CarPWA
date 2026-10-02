'use strict';
/* ============================================================
   Events: one bus for things that happen anywhere in the app (a route
   starts, you arrive, a voice command runs, a station starts playing…).
   Widgets and the links in Settings › Widget links listen here.
   Loaded right after log.js so every later file can emit.
   ============================================================ */
const Bus = (() => {
  const subs = new Map(); // name → Set(fn); '*' gets everything
  /** What can happen, for the links editor: id → [label, what the event carries]. Files add their own with Bus.define. */
  const EVENTS = {};
  return {
    EVENTS,
    define(id, label, carries = '') { EVENTS[id] = [label, carries]; },
    on(name, fn) { if (!subs.has(name)) subs.set(name, new Set()); subs.get(name).add(fn); return () => subs.get(name)?.delete(fn); },
    /** Tell everyone. `data.value` is the main thing the event carries (a place, a station, the words heard…). */
    emit(name, data = {}) {
      if (typeof Log !== 'undefined') Log.d('event', name, data);
      for (const key of [name, '*']) for (const fn of subs.get(key) || []) {
        try { fn(data, name); } catch (e) { if (typeof Log !== 'undefined') Log.e('event', `A listener for ${name} failed`, e); }
      }
    },
  };
})();
// App-wide events. Widgets define their own (radio.play…) in their files.
Bus.define('nav.start', 'A route starts', 'the destination');
Bus.define('nav.arrive', 'You arrive', 'the destination');
Bus.define('nav.end', 'A route ends', 'the destination');
Bus.define('drive.moving', 'The car starts moving', 'the speed');
Bus.define('drive.stopped', 'The car stops', '');
Bus.define('view.open', 'A screen opens', 'the screen');
Bus.define('voice.heard', 'You say something', 'the words heard');
Bus.define('voice.listen', 'The assistant starts listening', '');
Bus.define('voice.idle', 'The assistant finishes', '');
Bus.define('voice.reply', 'The assistant replies', 'what it says');
Bus.define('cmd.run', 'A voice command runs', 'the words it captured');
