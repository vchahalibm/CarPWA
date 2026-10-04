'use strict';
/* ============================================================
   Commands: what you say (or type) → what DriveDeck does.
   A command is a set of phrases, a way to match them and an action:
   a DriveDeck built-in, a phone app opened by link, a phone shortcut,
   a widget, a screen, or just a reply. Defaults live here; your edits
   and your own commands are kept in `dd.commands`. Loaded after voice.js.
   ============================================================ */

/* ---------- Phone apps a command can open, with the recognised words passed along ---------- */
const enc = encodeURIComponent;
const APP_LINKS = {
  spotify: ['Spotify', q => q ? `spotify:search:${enc(q)}` : 'spotify:', q => `https://open.spotify.com/search/${enc(q)}`],
  ytmusic: ['YouTube Music', null, q => q ? `https://music.youtube.com/search?q=${enc(q)}` : 'https://music.youtube.com/'],
  youtube: ['YouTube', q => q ? `youtube://results?search_query=${enc(q)}` : 'youtube://', q => `https://www.youtube.com/results?search_query=${enc(q)}`],
  gmaps: ['Google Maps (search)', q => `comgooglemaps://?q=${enc(q)}`, q => `https://www.google.com/maps/search/?api=1&query=${enc(q)}`],
  gmapsNav: ['Google Maps (directions)', q => `comgooglemaps://?daddr=${enc(q)}&directionsmode=driving`, q => `https://www.google.com/maps/dir/?api=1&destination=${enc(q)}&travelmode=driving`],
  waze: ['Waze', q => q ? `waze://?q=${enc(q)}&navigate=yes` : 'waze://', q => `https://waze.com/ul?q=${enc(q)}&navigate=yes`],
  whatsapp: ['WhatsApp', q => `whatsapp://send?text=${enc(q)}`, q => `https://wa.me/?text=${enc(q)}`],
  dialer: ['Phone dialer', q => `tel:${telNum(q)}`, null],
  sms: ['Text message', q => `sms:${isIOS ? '&' : '?'}body=${enc(q)}`, null],
  email: ['Email', q => `mailto:?subject=${enc(q)}`, null],
  google: ['Google search', null, q => `https://www.google.com/search?q=${enc(q)}`],
  phoneMusic: ['Phone’s music app', () => isIOS ? 'music://' : null, q => `https://music.youtube.com/search?q=${enc(q)}`],
  custom: ['Another app (your link)', null, null],
};
/** Open a phone app with some text. A custom link uses {q} (or any {variable}) where the words go. */
function openLink(app, q, url, v = {}) {
  if (app === 'custom') {
    const link = fillIn(url || '', { ...v, q }, enc);
    if (!link || /^\s*(javascript|data|vbscript):/i.test(link)) return toast('That link can’t be opened');
    return /^https?:/i.test(link) ? openExternal(null, link) : openExternal(link);
  }
  const a = APP_LINKS[app]; if (!a) return;
  openExternal(a[1]?.(q) || null, a[2]?.(q) || null);
}
/** Run a shortcut from the phone's shortcuts app, handing it text as its input. */
function runShortcut(name, text) {
  if (!isIOS) toast('Shortcuts open on iPhone and iPad');
  location.href = `shortcuts://run-shortcut?name=${enc(name)}${text ? `&input=text&text=${enc(text)}` : ''}`;
}
/** '{q} on {app}' → the values, optionally escaped. Unknown names become empty. */
function fillIn(tpl, v, esc_ = s => s) {
  return (tpl || '').replace(/\{(\w+)\}/g, (_, k) => esc_(v[k] == null ? '' : String(v[k])));
}

/* ---------- Names people use for things ---------- */
const SCREEN_NAMES = { maps: 'maps', map: 'maps', navigation: 'maps', music: 'music', 'music player': 'music', songs: 'music', phone: 'phone', dialer: 'phone',
  calls: 'phone', messages: 'messages', texts: 'messages', sms: 'messages', inbox: 'messages', weather: 'weather', drive: 'drive', 'trip computer': 'drive',
  trip: 'drive', calendar: 'calendar', agenda: 'calendar', schedule: 'calendar', settings: 'settings', preferences: 'settings', podcasts: 'podcasts',
  radio: 'radio', parking: 'parking', charging: 'charging', 'ev charging': 'charging', chargers: 'charging', dashboard: 'dashboard', 'home screen': 'dashboard',
  apps: 'home', 'all apps': 'home', 'voice commands': 'commands', commands: 'commands' };
const APP_NAMES = { spotify: 'spotify', 'youtube music': 'ytmusic', youtube: 'youtube', 'google maps': 'gmaps', waze: 'waze', whatsapp: 'whatsapp',
  email: 'email', mail: 'email', gmail: 'email', dialer: 'dialer', 'my music app': 'phoneMusic', 'music app': 'phoneMusic', 'the music app': 'phoneMusic' };
const MODE_NAMES = { ar: 'ar', 'a r': 'ar', camera: 'ar', 'augmented reality': 'ar', hud: 'hud', 'h u d': 'hud', 'heads up': 'hud', 'heads-up': 'hud',
  '3d': '3d', '3 d': '3d', 'three d': '3d', 'three-d': '3d', map: 'map', '2d': 'map', 'flat': 'map', 'normal': 'map' };
const CATEGORY_NAMES = [[/gas|fuel|petrol|diesel|pump|bunk/, 'Gas'], [/park/, 'Parking'], [/charg|\bev\b/, 'EV Chargers'], [/coffee|caf[eé]|tea/, 'Coffee'],
  [/food|restaurant|eat|lunch|dinner|breakfast|meal/, 'Food']];
const STYLE_NAMES = { twin: 'twin', 'twin dials': 'twin', arc: 'arc', analog: 'analog', analogue: 'analog', bars: 'bars', bar: 'bars', band: 'band',
  telltale: 'telltale', chrono: 'chrono', chronograph: 'chrono', 'map first': 'mapfirst', mapfirst: 'mapfirst' };
const WIDGET_ALIASES = { assistant: 'chat', chat: 'chat', conversation: 'chat', music: 'nowPlaying', 'now playing': 'nowPlaying', song: 'nowPlaying',
  trip: 'trip', turn: 'turn', 'next turn': 'turn', 'g force': 'gforce', 'g-force': 'gforce', altitude: 'elevation' };
const lookup = (map, s) => { s = (s || '').toLowerCase().replace(/^(the|my|a)\s+/, '').replace(/\s+(app|screen|view|mode|widget)$/, '').trim(); return map[s]; };
const widgetId = s => {
  s = (s || '').toLowerCase().replace(/^(the|my|a)\s+/, '').trim();
  return WIDGET_ALIASES[s] || Object.keys(W).find(id => id.toLowerCase() === s || W[id].name.toLowerCase() === s);
};
const findContact = q => { q = q.trim().replace(/[.?!]$/, '').toLowerCase();
  return CONTACTS.find(c => c.n.toLowerCase() === q) || CONTACTS.find(c => c.n.toLowerCase().split(' ').some(w => q.split(' ').includes(w))); };
/** 'some music from maroon 5' → 'maroon 5' */
const musicQuery = q => (q || '').replace(/^(some|a few|the|my)\s+/i, '').replace(/^(music|songs?|tracks?|hits)\s+(from|by|of)\s+/i, '').replace(/\s+(music|songs?)$/i, '').trim();
const isResume = q => !q || /^(some |the |my )?(music|songs?|something|anything|audio|it|again|playback)$/i.test(q);

/* ---------- Built-in actions ----------
   run(v, say): v holds the words captured by the phrase ({place}, {who}, …) plus q (the "pass along" value) and text (all of it).
   ok(v): optional; false hands the phrase to the next best command. */
const BUILTINS = {
  // Navigation
  navigate: { group: 'Navigation', name: 'Navigate to a place', run(v, say) {
    const q = (v.place || v.q || '').trim();
    if (!q) return say('Where to? Say “navigate to” and a place.');
    const saved = destinations().find(d => d.id === q.toLowerCase() || d.name.toLowerCase() === q.toLowerCase().replace(/^(my|the)\s+/, ''));
    if (saved) return say(`Getting directions to ${saved.name}.`, () => startNav(saved));
    Voice.show(`Looking for ${q}…`, 'Searching places');
    Routing.search(q, loc).then(r => r[0] ? say(`Getting directions to ${r[0].name}.`, () => startNav(r[0])) : say(`I couldn’t find ${q}.`))
      .catch(() => say('Place search is offline right now.'));
  } },
  nearby: { group: 'Navigation', name: 'Find nearby (gas, parking, chargers…)', run(v, say) {
    const q = (v.what || v.q || v.text || '').toLowerCase(), cat = (CATEGORY_NAMES.find(([re]) => re.test(q)) || [])[1];
    if (cat) return say(`Here’s ${cat === 'EV Chargers' ? 'EV charging' : cat.toLowerCase()} nearby.`, () => { panel.mode = 'category'; panel.cat = cat; panel.collapsed = false; openView('maps'); renderMapPanel(); });
    say(`Searching for ${q} nearby.`, () => { panel.mode = 'home'; panel.q = q; panel.collapsed = false; openView('maps'); renderMapPanel(); });
  } },
  endRoute: { group: 'Navigation', name: 'End the route', run: (v, say) => nav ? say('Route ended.', endNav) : say('There’s no active route.') },
  eta: { group: 'Navigation', name: 'Arrival time', run(v, say) {
    const n = nav?.view; if (!n) return say('There’s no active route. Say “navigate to” and a place.');
    say(`You’ll arrive at ${fmtClock(n.eta)}, in ${fmtMins(n.remainT)} ${n.remainT >= 3600 ? 'hours' : 'minutes'}. ${spokenDist(n.remain)} to go.`);
  } },
  distance: { group: 'Navigation', name: 'Distance left', run: (v, say) => nav?.view ? say(`${spokenDist(nav.view.remain)} to go.`) : say('There’s no active route.') },
  nextTurn: { group: 'Navigation', name: 'Next turn', run: (v, say) => nav?.view ? say(`In ${spokenDist(nav.view.toNext)}, ${lowerFirst(nav.view.step.text)}.`) : say('There’s no active route.') },
  shareEta: { group: 'Navigation', name: 'Text my arrival time to someone', run(v, say) {
    const n = nav?.view; if (!n) return say('There’s no active route to share.');
    const c = findContact(v.who || v.q || ''); if (!c) return say(`I couldn’t find ${v.who || v.q || 'that contact'} in your contacts.`);
    const body = `On my way to ${nav.dest.name}. I’ll be there around ${fmtClock(n.eta)} (${fmtMins(n.remainT)} min).`;
    if (c.sample) return say(`${c.n} is a sample contact. Add real contacts in Settings.`);
    say(`Sending your arrival time to ${c.n}.`, () => textContact(c, body), { leaves: true });
  } },
  speed: { group: 'Navigation', name: 'My speed and the limit', run(v, say) {
    if (loc.source === 'none') return say('Location is off.');
    const lim = limitVal();
    say(`You’re doing ${speedVal(loc.speed)} ${imperial() ? 'miles' : 'kilometers'} per hour.${lim ? ` The limit is ${lim}.` : ''}`);
  } },
  whereAmI: { group: 'Navigation', name: 'Where am I', run(v, say) {
    if (loc.source === 'none') return say('Location is off.');
    const st = typeof currentStreet === 'function' ? currentStreet() : '';
    say(`${st ? `You’re on ${st}, ` : ''}heading ${CARD_FULL[cardinal(loc.heading || 0)]}.`);
  } },
  recenter: { group: 'Navigation', name: 'Recenter the map', run: (v, say) => say('Recentering.', recenterAll) },
  zoomIn: { group: 'Navigation', name: 'Zoom in', run: (v, say) => { maps.main.map?.zoomIn(); say('Zooming in.'); } },
  zoomOut: { group: 'Navigation', name: 'Zoom out', run: (v, say) => { maps.main.map?.zoomOut(); say('Zooming out.'); } },
  mode: { group: 'Navigation', name: 'Map, 3D, AR or HUD mode', ok: v => !!lookup(MODE_NAMES, v.mode || v.q), run(v, say) {
    const id = lookup(MODE_NAMES, v.mode || v.q); say(`${MODES.find(x => x.id === id).name} mode.`, () => setMode(id));
  } },
  mapsApp: { group: 'Navigation', name: 'Hand the route to Google Maps or Waze', ok: v => /google|waze|phone|maps/i.test(v.app || ''), run(v, say) {
    const app = /waze/i.test(v.app) ? 'waze' : /google/i.test(v.app) ? 'google' : 'phone', name = MAP_APPS[app][0], q = (v.place || '').trim();
    if (!q) return nav ? say(`Opening the route in ${name}.`, () => openInMaps(app), { leaves: true }) : say('Say where to, like “navigate to Indiranagar with Waze”.');
    Routing.search(q, loc).then(r => r[0] ? say(`Opening ${r[0].name} in ${name}.`, () => openInMaps(app, r[0]), { leaves: true }) : say(`I couldn’t find ${q}.`))
      .catch(() => say('Place search is offline right now.'));
  } },
  demoStart: { group: 'Navigation', name: 'Start the demo drive', run: (v, say) => say('Starting the demo drive.', () => ACTIONS.demo()) },
  demoStop: { group: 'Navigation', name: 'Stop the demo drive', run: (v, say) => say('Demo drive stopped.', () => stopDemo(true)) },
  gps: { group: 'Navigation', name: 'Use my GPS', run: (v, say) => say('Using your location.', () => startGPS()) },

  // Music
  play: { group: 'Music', name: 'Play music (in your music app)', run(v, say) {
    const q = musicQuery(v.q);
    if (isResume(q)) return BUILTINS.resume.run(v, say);
    if (settings.musicApp !== 'demo') return say(`Playing ${q} on ${MUSIC_APPS[settings.musicApp][0]}.`, () => playInMusicApp(q), { leaves: true });
    // Demo player: play a matching track if there is one.
    for (const [src, list] of Object.entries(LIB)) {
      const i = list.findIndex(t => (t.t + ' ' + t.a).toLowerCase().includes(q.toLowerCase()));
      if (i >= 0) { if (src !== player.source) setSource(src); playTrack(i); return say(`Playing ${curTrack().t} by ${curTrack().a}.`, () => openView('music')); }
    }
    player.playing = true; updatePlayerUI();
    say(`The demo player doesn’t have ${q}. Playing ${curTrack().t}. Choose a music app in Settings to play anything.`, () => openView('music'));
  } },
  playOn: { group: 'Music', name: 'Play music on a named app', ok: v => !!musicAppId(v.app || appTail(v.text)), run(v, say) {
    const app = musicAppId(v.app || appTail(v.text)), q = musicQuery(v.q);
    say(`Playing ${q || 'music'} on ${MUSIC_APPS[app][0]}.`, () => playInMusicApp(q, app), { leaves: true });
  } },
  resume: { group: 'Music', name: 'Resume playback', run(v, say) {
    if (settings.musicApp !== 'demo') return say(`Opening ${MUSIC_APPS[settings.musicApp][0]}.`, () => playInMusicApp(''), { leaves: true });
    player.playing = true; updatePlayerUI(); say(`Playing ${curTrack().t} by ${curTrack().a}.`, () => openView('music'));
  } },
  pause: { group: 'Music', name: 'Pause', run: (v, say) => { player.playing = false; updatePlayerUI(); say('Paused.'); } },
  next: { group: 'Music', name: 'Next track', run: (v, say) => { playerAction('next'); player.playing = true; updatePlayerUI(); say(`Playing ${curTrack().t}.`); } },
  prev: { group: 'Music', name: 'Previous track', run: (v, say) => { playerAction('prev'); player.playing = true; updatePlayerUI(); say(`Playing ${curTrack().t}.`); } },
  podcasts: { group: 'Music', name: 'Play podcasts', run: (v, say) => { setSource('podcasts'); player.playing = true; updatePlayerUI(); say(`Playing ${curTrack().t}.`, () => openView('music')); } },
  radio: { group: 'Radio', name: 'Play the radio', run(v, say) {
    if (Radio.cur) { Radio.play(); return say(`Playing ${Radio.cur.name}.`); }
    say('Choose a station.', () => Radio.browse());
  } },
  radioStation: { group: 'Radio', name: 'Play a radio station', run: (v, say) => Actions.run('radio.play', v.station || v.q || '', say) },
  radioNext: { group: 'Radio', name: 'Next radio station', run: (v, say) => Actions.run('radio.next', '', say) },
  radioStop: { group: 'Radio', name: 'Stop the radio', run: (v, say) => Actions.run('radio.stop', '', say) },
  radioStations: { group: 'Radio', name: 'Show the radio stations', run: (v, say) => say('Here are the stations.', () => Radio.browse()) },
  // Documents & media widgets (js/media.js)
  docNext: { group: 'Media', name: 'Next page or slide', run: (v, say) => act('doc.next', '', say, 'Next page.') },
  docPrev: { group: 'Media', name: 'Previous page or slide', run: (v, say) => act('doc.prev', '', say, 'Previous page.') },
  docPage: { group: 'Media', name: 'Go to a page or slide', run: (v, say) => act('doc.page', v.n || v.q || '', say, `Page ${v.n || v.q}.`) },
  videoPlay: { group: 'Media', name: 'Play the video', run: (v, say) => act('video.play', '', say, 'Playing the video.') },
  videoPause: { group: 'Media', name: 'Pause the video', run: (v, say) => act('video.pause', '', say, 'Video paused.') },
  // Camera & objects (js/vision.js)
  whatSee: { group: 'Camera', name: 'What does the camera see?', run(v, say) { if (settings.detAnswer && settings.detOn) Voice.show('Looking…', 'Camera · on this device'); Vision.describe().then(t => say(t)); } },
  alertsOn: { group: 'Camera', name: 'Turn object alerts on', run: (v, say) => { settings.detAlerts = true; applySettings(); say(`Object alerts on, for ${(settings.detAlertList || DEFAULT_ALERTS).join(', ')}.`); } },
  alertsOff: { group: 'Camera', name: 'Turn object alerts off', run: (v, say) => { settings.detAlerts = false; applySettings(); say('Object alerts off.'); } },
  musicApp: { group: 'Music', name: 'Open my music app', run: (v, say) => settings.musicApp === 'demo' ? say('Opening music.', () => openView('music'))
    : say(`Opening ${MUSIC_APPS[settings.musicApp][0]}.`, () => playInMusicApp(''), { leaves: true }) },

  // Phone & messages
  call: { group: 'Phone', name: 'Call a contact or number', run(v, say) {
    const q = (v.who || v.q || '').trim();
    if (/^[+\d][\d\s()-]{4,}$/.test(q)) return say(`Calling ${q}.`, () => openCall({ n: q, num: q }), { leaves: true });
    const c = findContact(q); c ? say(`Calling ${c.n}.`, () => openCall(c), { leaves: !c.sample }) : say(`I couldn’t find “${q}” in your contacts.`);
  } },
  text: { group: 'Phone', name: 'Text a contact', run: (v, say) => message(v, say, false) },
  whatsapp: { group: 'Phone', name: 'WhatsApp a contact', run: (v, say) => message(v, say, true) },
  readMessages: { group: 'Phone', name: 'Read my messages', run(v, say) {
    const th = THREADS.find(x => x.unread) || THREADS[0];
    say(`Reading your messages from ${contact(th.id)?.n || 'your inbox'}.`, () => { openView('messages'); openThread(th.id, true); });
  } },

  // Information
  weather: { group: 'Info', name: 'Weather now', run(v, say) {
    const w = wx || mockWeather();
    say(`It’s ${Math.round(w.cur.temp)} degrees and ${wxInfo(w.cur.code)[0].toLowerCase()}.`, () => openView('weather'));
  } },
  time: { group: 'Info', name: 'The time', run: (v, say) => say(`It’s ${fmtClock(new Date())}.`) },
  date: { group: 'Info', name: 'Today’s date', run: (v, say) => say(`It’s ${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}.`) },
  help: { group: 'Info', name: 'What can I say?', run: (v, say) => say('Try “take me home”, “play music from Maroon 5”, “call Mom” or “what’s my ETA”. Every command is in Settings, Voice commands.', () => CmdUI.open()) },

  // Dashboard & display
  layout: { group: 'Dashboard', name: 'Switch dashboard layout', ok: v => /cluster|map|widget/i.test(v.layout || v.q || ''), run(v, say) {
    const id = /widget/i.test(v.layout || v.q) ? 'widgets' : /map/i.test(v.layout || v.q) ? 'map' : 'cluster';
    say(`${id[0].toUpperCase() + id.slice(1)} layout.`, () => { openView('dashboard'); Dash.cmd('layout:' + id); });
  } },
  style: { group: 'Dashboard', name: 'Change the cluster style', ok: v => !(v.style || v.q) || !!lookup(STYLE_NAMES, v.style || v.q), run(v, say) {
    const ids = Object.keys(CLUSTERS), id = lookup(STYLE_NAMES, v.style || v.q) || ids[(ids.indexOf(settings.cluster) + 1) % ids.length];
    say(`${CLUSTERS[id].name} style.`, () => { openView('dashboard'); Dash.cmd('style:' + id); closeSheet(); });
  } },
  showWidget: { group: 'Dashboard', name: 'Show a widget', ok: v => !!widgetId(v.widget || v.q), run: (v, say) => showWidget(widgetId(v.widget || v.q), say) },
  dockHide: { group: 'Dashboard', name: 'Hide the dock (full screen)', run: (v, say) => { setDock(true); say('Dock hidden. Tap the left edge to bring it back.'); } },
  dockShow: { group: 'Dashboard', name: 'Show the dock', run: (v, say) => { setDock(false); say('Dock shown.'); } },
  appMode: { group: 'Dashboard', name: 'Drive or Stage mode', run(v, say) {
    const m = /stage|present/i.test(v.text || '') ? 'stage' : 'drive'; Stage.set(m);
    say(m === 'stage' ? 'Stage mode. I’ll present with gestures.' : 'Drive mode. Expressions only while you drive.'); } },
  theme: { group: 'Dashboard', name: 'Dark or light theme', ok: v => /dark|light|night|day|auto/i.test(v.theme || v.q || ''), run(v, say) {
    const t = /dark|night/i.test(v.theme || v.q) ? 'dark' : /auto/i.test(v.theme || v.q) ? 'auto' : 'light';
    settings.theme = t; applySettings(); say(t === 'auto' ? 'Automatic theme.' : `${t === 'dark' ? 'Dark' : 'Light'} theme.`);
  } },
  open: { group: 'Dashboard', name: 'Open a screen or app', ok: v => !!openTarget(v.screen || v.q), run(v, say) {
    const [kind, id] = openTarget(v.screen || v.q);
    if (kind === 'screen') return id === 'commands' ? say('Voice commands.', () => CmdUI.open()) : id === 'dashboard' ? say('Dashboard.', () => openView('dashboard'))
      : id === 'home' ? say('All apps.', () => openView('home')) : say(`Opening ${appById(id).name}.`, () => openApp(id));
    if (kind === 'widget') return showWidget(id, say);
    say(`Opening ${APP_LINKS[id][0]}.`, () => openLink(id, ''), { leaves: true });
  } },

  // Assistant
  cancel: { group: 'Assistant', name: 'Never mind', run: (v, say) => say('Okay.') },
  clearChat: { group: 'Assistant', name: 'Clear the conversation', run: (v, say) => say('Conversation cleared.', () => VoiceLog.clear()) },
};
const appTail = t => ((t || '').match(/\s(?:on|in|using|with|through)\s+((?:spotify|youtube music|my music app|the music app|my shortcut))$/i) || [])[1];
const musicAppId = s => { s = (s || '').toLowerCase(); return /spotify/.test(s) ? 'spotify' : /youtube/.test(s) ? 'ytmusic' : /shortcut/.test(s) ? 'shortcut' : /(phone|my music|music app)/.test(s) ? 'phone' : null; };
function openTarget(s) {
  const k = (s || '').toLowerCase().replace(/^(the|my)\s+/, '').replace(/\s+(app|screen|view)$/, '').trim();
  if (SCREEN_NAMES[k]) return ['screen', SCREEN_NAMES[k]];
  if (APP_NAMES[k]) return ['app', APP_NAMES[k]];
  const w = widgetId(k.replace(/\s+widget$/, '')); if (w && /widget$/.test(k)) return ['widget', w];
  return null;
}
function message(v, say, wa) {
  const c = findContact(v.who || v.q || ''); if (!c) return say(`I couldn’t find ${v.who || v.q || 'that contact'} in your contacts.`);
  if (c.sample) return say(`${c.n} is a sample contact. Add real contacts in Settings.`);
  const body = (v.msg || '').trim();
  say(`${wa ? 'WhatsApp' : 'Message'} to ${c.n}${body ? ': ' + body : ''}.`, () => (wa ? whatsappContact : textContact)(c, body), { leaves: true });
}
/** Run a widget action by voice, confirming with `ok` unless the action already said something (e.g. that the widget is missing). */
function act(id, value, say, ok) { let said = false; Actions.run(id, value, (m, then, o) => { said = true; say(m, then, o); }); if (!said) say(ok); }
function setDock(hide) { settings.dockHidden = hide; store.set('settings', settings); applyDock(); if (typeof Dash !== 'undefined') Dash.renderBar(); }
/** Bring a widget into view: switch to the widget layout, add it to the current page if it isn't on one, then scroll to its page. */
function showWidget(id, say) {
  const pages = Dash.pages(); let p = pages.findIndex(pg => pg.some(x => wtype(x) === id));
  if (p < 0) { p = Math.min(store.get('wpage', 0), pages.length - 1); Dash.setList('pg' + p, [...pages[p], W[id].multi ? `${id}~${Math.random().toString(36).slice(2, 6)}` : id]); }
  store.set('wpage', p);
  say(`${W[id].name}.`, () => { settings.dashLayout = 'widgets'; store.set('settings', settings); openView('dashboard'); });
}

/* ---------- Default commands: everything DriveDeck can do by voice ----------
   Phrases: {name} captures words, [word] is optional, (a|b) means either. Keywords: every comma group must appear. */
const DEFAULT_COMMANDS = [
  // Navigation
  { id: 'nav.home', name: 'Take me home', say: ['(take me|go|drive|head|get me|navigate) home', '(directions|route|navigate|drive|go) to home', '(take me|go|get me) back home'], do: { type: 'builtin', fn: 'navigate', input: 'home' } },
  { id: 'nav.work', name: 'Take me to work', say: ['(take me|go|drive|head|get me|navigate) to (work|the office|office)', '(directions|route) to (work|the office|office)'], do: { type: 'builtin', fn: 'navigate', input: 'work' } },
  { id: 'nav.to', name: 'Navigate to a place', say: ['(navigate|directions|drive|go|head|route) to {place}', '(take|get) me to {place}', '(find|show) [me] [the] (route|way|directions) to {place}', 'how do i get to {place}'], do: { type: 'builtin', fn: 'navigate' } },
  { id: 'nav.nearby', name: 'Find something nearby', say: ['{what} (near me|nearby|around here|close by)', '(find|show|search for) [me] [the|a] (nearest|closest|nearby) {what}', '(find|show) [me] {what} (near me|nearby|around here)', 'where can i (get|find|buy) {what}', 'i need (gas|fuel|petrol|parking|a charger|to charge|coffee|food)'], do: { type: 'builtin', fn: 'nearby' } },
  { id: 'nav.fuel', name: 'Gas, parking, chargers, coffee, food', match: 'keywords', say: ['gas station|petrol pump|petrol bunk|fuel station', 'ev charger|charging station|charge the car', 'find parking|parking spot|where to park'], do: { type: 'builtin', fn: 'nearby', input: '{text}' } },
  { id: 'nav.end', name: 'End the route', say: ['(end|stop|cancel|exit|quit|close) [the] (route|navigation|directions|trip|guidance)', 'stop navigating', 'cancel [the] trip'], do: { type: 'builtin', fn: 'endRoute' } },
  { id: 'nav.eta', name: 'What’s my ETA?', match: 'keywords', say: ['eta', 'arrive|arrival|arriving|reach there|get there', 'how long, left|more|remaining|take|to go', 'time left|time remaining'], do: { type: 'builtin', fn: 'eta' } },
  { id: 'nav.distance', name: 'How far is it?', match: 'keywords', say: ['how far', 'distance, left|remaining|to go', 'how much (further|farther)|how many (km|kilometers|miles)'], do: { type: 'builtin', fn: 'distance' } },
  { id: 'nav.next', name: 'What’s the next turn?', match: 'keywords', say: ['next, turn|direction|step|instruction|exit', 'what’s next|whats next|where do i turn|which way'], do: { type: 'builtin', fn: 'nextTurn' } },
  { id: 'nav.share', name: 'Send my ETA to someone', say: ['(send|share|text) [my] (eta|arrival time|arrival) to {who}', '(tell|let) {who} (when|what time) (i’ll|i will|we’ll|we will) (arrive|get there|be there)'], do: { type: 'builtin', fn: 'shareEta' } },
  { id: 'nav.speed', name: 'How fast am I going?', match: 'keywords', say: ['my speed|how fast|what speed|current speed', 'speed limit'], do: { type: 'builtin', fn: 'speed' } },
  { id: 'nav.where', name: 'Where am I?', match: 'keywords', say: ['where am i', 'what street|which street|what road|which road', 'my location|current location'], do: { type: 'builtin', fn: 'whereAmI' } },
  { id: 'nav.recenter', name: 'Recenter the map', say: ['(recenter|re-center|re center|center|centre|recentre) [the] [map|me|on me]', '(show|follow) me on the map'], do: { type: 'builtin', fn: 'recenter' } },
  { id: 'nav.zoomin', name: 'Zoom in', say: ['zoom in [more|closer]', 'closer'], do: { type: 'builtin', fn: 'zoomIn' } },
  { id: 'nav.zoomout', name: 'Zoom out', say: ['zoom out [more]', 'show more [of the] [map]'], do: { type: 'builtin', fn: 'zoomOut' } },
  { id: 'nav.mode', name: 'Map, 3D, AR or HUD mode', say: ['[switch to|change to|go to|show|open|turn on|use] [the] {mode} (mode|view)', '(switch|change) to {mode}'], do: { type: 'builtin', fn: 'mode' } },
  { id: 'nav.handoff', name: 'Navigate with Google Maps or Waze', say: ['(navigate|directions|drive|go|take me|route) to {place} (with|on|in|using|via) {app}', '(open|send|show) [the] (route|directions|navigation) (in|on|to) {app}', '(navigate|directions) (with|in|on|using) {app}'], do: { type: 'builtin', fn: 'mapsApp' } },
  { id: 'nav.demo', name: 'Start the demo drive', say: ['(start|begin|run) [a|the] demo [drive|mode]', 'demo drive'], do: { type: 'builtin', fn: 'demoStart' } },
  { id: 'nav.demostop', name: 'Stop the demo drive', say: ['(stop|end|exit) [the] demo [drive|mode]'], do: { type: 'builtin', fn: 'demoStop' } },
  { id: 'nav.gps', name: 'Use my GPS', say: ['use [my] (gps|location|real location)', '(turn on|enable) [the] (gps|location)'], do: { type: 'builtin', fn: 'gps' } },
  // Music
  { id: 'music.resume', name: 'Resume music', say: ['(play|resume|continue|unpause|start) [the] [music|song|playback|audio|something]', 'play [some] (music|songs|something)', 'turn [the] music (on|back on)'], do: { type: 'builtin', fn: 'resume' } },
  { id: 'music.on', name: 'Play on Spotify / YouTube Music', say: ['(play|listen to|put on) {q} (on|in|using|with|through) (spotify|youtube music|my music app|the music app|my shortcut)', '(play|listen to|put on) {q} (on|in|using|with) {app}'], do: { type: 'builtin', fn: 'playOn' } },
  { id: 'music.play', name: 'Play an artist, song or album', say: ['play [some] (music|songs|tracks|hits|album|albums) (from|by|of) {q}', 'play [the] (album|song|track|artist|playlist) {q}', 'play [some] {q} (music|songs)', 'play {q}', '(listen to|put on) {q}', 'i want to (hear|listen to) {q}'], do: { type: 'builtin', fn: 'play' } },
  { id: 'music.pause', name: 'Pause', say: ['(pause|stop) [the] [music|song|playback|audio|podcast]', '(mute|silence) [the] (music|audio)', 'turn [the] music off'], do: { type: 'builtin', fn: 'pause' } },
  { id: 'music.next', name: 'Next track', say: ['(next|skip) [this] [song|track|one|episode]', 'play [the] next [song|track|one]'], do: { type: 'builtin', fn: 'next' } },
  { id: 'music.prev', name: 'Previous track', say: ['(previous|last|go back) [song|track|one]', 'play [the] (previous|last) [song|track|one] [again]', '(back|replay) [that|this|the] (song|track)'], do: { type: 'builtin', fn: 'prev' } },
  { id: 'music.podcasts', name: 'Podcasts', say: ['(play|open|listen to|put on) [a|some|my] (podcast|podcasts)'], do: { type: 'builtin', fn: 'podcasts' } },
  { id: 'music.radio', name: 'Radio', say: ['(play|open|listen to|put on|turn on) [the] radio'], do: { type: 'builtin', fn: 'radio' } },
  { id: 'radio.station', name: 'Play a radio station', say: ['play {station} (radio|fm|radio station|station)', '(play|tune to|tune in to|switch to|put on|listen to) [the] (radio|station|radio station) {station}', 'tune [in] to {station}', 'play {station} on [the] radio'], do: { type: 'builtin', fn: 'radioStation' } },
  { id: 'radio.next', name: 'Next radio station', say: ['(next|another|different) (station|channel|radio station)', 'change [the] (station|channel|radio station|radio)'], do: { type: 'builtin', fn: 'radioNext' } },
  { id: 'radio.stop', name: 'Stop the radio', say: ['(pause|stop|turn off|switch off|mute) [the] radio', 'radio off'], do: { type: 'builtin', fn: 'radioStop' } },
  { id: 'radio.list', name: 'Show the radio stations', say: ['(show|open|list) [the|my] [radio] stations', 'which stations'], do: { type: 'builtin', fn: 'radioStations' } },
  { id: 'vision.what', name: 'What do you see?', say: ['what (do|can) you see', '(what’s|what is) (around|ahead|in front of) [me|us]', 'describe [the] (road|scene|view|surroundings)', '(what’s|what is) on [the] camera', 'what (is|are) in front of [me|us]'], do: { type: 'builtin', fn: 'whatSee' } },
  { id: 'vision.alertsOn', name: 'Turn object alerts on', say: ['(turn on|enable|start) [the] (object|camera) (alerts|warnings)', '(warn|alert) me about (objects|people|pedestrians)'], do: { type: 'builtin', fn: 'alertsOn' } },
  { id: 'vision.alertsOff', name: 'Turn object alerts off', say: ['(turn off|disable|stop) [the] (object|camera) (alerts|warnings)'], do: { type: 'builtin', fn: 'alertsOff' } },
  { id: 'media.next', name: 'Next page or slide', say: ['next (slide|page)', '(go|move|turn) [to] [the] next (slide|page)', 'turn [the] page'], do: { type: 'builtin', fn: 'docNext' } },
  { id: 'media.prev', name: 'Previous page or slide', say: ['(previous|last) (slide|page)', '(go|move) back [a|one] (slide|page)', '(go|move) [to] [the] previous (slide|page)'], do: { type: 'builtin', fn: 'docPrev' } },
  { id: 'media.page', name: 'Go to a page or slide', say: ['(go to|show|open|jump to) (slide|page) [number] {n}', '(slide|page) [number] {n}'], do: { type: 'builtin', fn: 'docPage' } },
  { id: 'media.play', name: 'Play the video', say: ['(play|resume|start|continue) [the] (video|youtube video|clip)'], do: { type: 'builtin', fn: 'videoPlay' } },
  { id: 'media.pause', name: 'Pause the video', say: ['(pause|stop) [the] (video|youtube video|clip)'], do: { type: 'builtin', fn: 'videoPause' } },
  { id: 'music.app', name: 'Open my music app', say: ['open [my|the] music app'], do: { type: 'builtin', fn: 'musicApp' } },
  // Phone & messages
  { id: 'phone.call', name: 'Call someone', say: ['(call|dial|ring|phone) {who}', '(make|place) a call to {who}', 'give {who} a (call|ring)'], do: { type: 'builtin', fn: 'call' } },
  { id: 'phone.text', name: 'Text someone', say: ['(text|message|sms) {who} (saying|that says|that|say|to say) {msg}', 'send [a] (text|message|sms) to {who} (saying|that says|that|say) {msg}', 'tell {who} that {msg}', '(text|message|sms) {who}', 'send [a] (text|message|sms) to {who}'], do: { type: 'builtin', fn: 'text' } },
  { id: 'phone.whatsapp', name: 'WhatsApp someone', say: ['whatsapp {who} (saying|that says|that|say|to say) {msg}', 'send [a] whatsapp [message] to {who} (saying|that says|that|say) {msg}', 'whatsapp {who}', 'send [a] whatsapp [message] to {who}'], do: { type: 'builtin', fn: 'whatsapp' } },
  { id: 'phone.read', name: 'Read my messages', match: 'keywords', say: ['read, message|messages|texts|text', 'new messages|any messages|unread', 'check, messages|texts'], do: { type: 'builtin', fn: 'readMessages' } },
  // Information
  { id: 'info.weather', name: 'Weather', match: 'keywords', say: ['weather', 'temperature', 'rain|raining|umbrella', 'forecast', 'how hot|how cold'], do: { type: 'builtin', fn: 'weather' } },
  { id: 'info.time', name: 'What time is it?', match: 'keywords', say: ['time is it', 'what’s the time|whats the time|what is the time|current time|the time now|tell me the time'], do: { type: 'builtin', fn: 'time' } },
  { id: 'info.date', name: 'What’s the date?', match: 'keywords', say: ['what’s the date|whats the date|what is the date|the date today|today’s date|todays date|what date', 'what day is|which day is'], do: { type: 'builtin', fn: 'date' } },
  { id: 'info.help', name: 'What can I say?', say: ['what can (i|you) (say|do|ask)', 'help [me]', '[show] [the] [voice] commands', 'what are [the|my] commands'], do: { type: 'builtin', fn: 'help' } },
  // Dashboard & display
  { id: 'dash.layout', name: 'Cluster, map or widget layout', say: ['[show|open|switch to|go to] [the] {layout} (layout|dashboard|screen|page)', 'show [me] [the] {layout}'], do: { type: 'builtin', fn: 'layout' } },
  { id: 'dash.style', name: 'Change the cluster style', say: ['[switch to|use|show] [the] {style} (style|cluster|dials|gauges)', '(change|switch|next) [the] (cluster|dials|gauges|cluster style|style)'], do: { type: 'builtin', fn: 'style' } },
  { id: 'dash.widget', name: 'Show a widget', say: ['(show|open|add|go to) [me] [the|my] {widget} widget'], do: { type: 'builtin', fn: 'showWidget' } },
  { id: 'dash.dockhide', name: 'Hide the dock', say: ['hide [the] (dock|sidebar|side bar)', '[go|enter|turn on] full screen', 'fullscreen'], do: { type: 'builtin', fn: 'dockHide' } },
  { id: 'dash.dockshow', name: 'Show the dock', say: ['show [the] (dock|sidebar|side bar)', '(exit|leave|turn off) full screen'], do: { type: 'builtin', fn: 'dockShow' } },
  { id: 'dash.stage', name: 'Stage mode (presenting)', say: ['[switch to|use|turn on|go to|enter|start] [the] (stage|presentation|presenter|presenting) mode', 'start presenting'], do: { type: 'builtin', fn: 'appMode' } },
  { id: 'dash.drive', name: 'Drive mode', say: ['[switch to|use|turn on|go to|enter|back to] [the] (drive|driving|car) mode', 'stop presenting'], do: { type: 'builtin', fn: 'appMode' } },
  { id: 'dash.theme', name: 'Dark or light theme', say: ['[switch to|use|turn on|go] [the] {theme} (mode|theme)', 'make it {theme}'], do: { type: 'builtin', fn: 'theme' } },
  { id: 'dash.home', name: 'Back to the dashboard', say: ['[go] [back] to [the] (dashboard|home screen)', '(show|open) [the] dashboard', 'dashboard'], do: { type: 'screen', screen: 'dashboard' } },
  { id: 'dash.open', name: 'Open a screen or app', say: ['(open|launch|start|show|go to|switch to) [the|my] {screen}'], do: { type: 'builtin', fn: 'open' } },
  // Assistant
  { id: 'va.cancel', name: 'Never mind', say: ['(never mind|nevermind|cancel|forget it|stop listening|nothing|that’s all|thats all|no thanks|go away)'], do: { type: 'builtin', fn: 'cancel' } },
  { id: 'va.clear', name: 'Clear the conversation', say: ['clear [the|my] (chat|conversation|history|assistant)'], do: { type: 'builtin', fn: 'clearChat' } },
  // Phone apps & shortcuts (examples of passing what you said to another app)
  { id: 'app.youtube', name: 'Search YouTube', say: ['(search|look up|find) {q} on youtube', '(search|look up) youtube for {q}', 'play {q} on youtube', 'youtube {q}'], do: { type: 'app', app: 'youtube' } },
  { id: 'app.gmaps', name: 'Search Google Maps', say: ['(search|find|show|look up) {q} on google maps', '(search|look up) google maps for {q}'], do: { type: 'app', app: 'gmaps' } },
  { id: 'app.google', name: 'Search the web', say: ['(google|search the web for|search google for|search online for) {q}', 'look up {q} [online]'], do: { type: 'app', app: 'google' } },
  { id: 'app.shortcut', name: 'Run a phone shortcut', say: ['run [the|my] shortcut {name} with {input}', 'run [the|my] shortcut {name}', 'run [my] {name} shortcut'], do: { type: 'shortcut', shortcut: '{name}', input: '{input}' } },
];

/* ---------- Matching ---------- */
const reWord = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, '[\'’]?').replace(/-/g, '[- ]?');
const reAlts = s => s.split('|').map(a => a.trim().split(/\s+/).filter(Boolean).map(reWord).join('\\s+')).filter(Boolean).join('|');
/** Normalise what was heard: punctuation off (but keep 2.5 and 1,200), spaces tidied, filler like “hey, could you please” dropped. */
function tidy(s) {
  return (s || '').normalize('NFKC').replace(/[“”"«»¿¡]/g, ' ').replace(/[.,](?!\d)/g, ' ').replace(/(^|\D)[.,]/g, '$1 ').replace(/[!?;:]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:hey|hi|ok|okay|so|um|uh|er)\s+)*(?:drive\s?deck\s+)?(?:(?:please|can you|could you|would you|will you|i want to|i'd like to|i’d like to|i wanna|let's|let’s|lets|just)\s+)*/i, '')
    .replace(/\s+(please|now|thanks|thank you)$/i, '').trim();
}
const lev = (a, b) => {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
  return d[b.length];
};
const Commands = {
  cache: new Map(),
  saved() { const s = store.get('commands', {}); return { custom: s.custom || [], edits: s.edits || {} }; },
  save(s) { store.set('commands', s); this.cache.clear(); this.vocab = null; },
  /** Your commands first (they win ties), then the defaults with your edits applied. */
  all() {
    const s = this.saved();
    return [...s.custom.map(c => ({ ...c, custom: true })), ...DEFAULT_COMMANDS.map(d => s.edits[d.id] ? { ...d, ...s.edits[d.id], edited: true } : d)];
  },
  byId(id) { return this.all().find(c => c.id === id); },

  /** Compile one command's lines. Throws with a readable message when a line is invalid. */
  compile(c) {
    const how = c.match || 'phrase', lines = (Array.isArray(c.say) ? c.say : String(c.say || '').split('\n')).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Add at least one phrase.');
    return lines.map(line => {
      if (how === 'regex') {
        let re; try { re = new RegExp(line, 'i'); } catch (e) { throw new Error(`“${line}” isn’t a valid regular expression.`); }
        return { how, line, lit: Math.min(40, line.replace(/\\.|[^a-z ]/gi, '').length), test: t => { const m = t.match(re); if (!m) return null;
          const v = { ...m.groups }; m.slice(1).forEach((x, i) => { if (x != null) v[i + 1] = x; }); return v; } };
      }
      if (how === 'keywords') {
        const groups = line.split(',').map(g => g.trim()).filter(Boolean).map(g => new RegExp(`(^|\\s)(?:${reAlts(g)})(?=\\s|$)`, 'i'));
        const lit = line.split(',').reduce((n, g) => n + Math.min(...g.split('|').map(a => a.trim().length)), 0);
        return { how, line, lit, test: t => { if (!groups.every(re => re.test(t))) return null;
          return { rest: groups.reduce((s, re) => s.replace(re, ' '), t).replace(/\s+/g, ' ').trim() }; } };
      }
      let src = '', lit = 0; const names = [], tok = /\{(\w*)\}|\[([^\]]*)\]|\(([^)]*)\)|([^\s{}[\]()]+)/g;
      for (let m; (m = tok.exec(line));) {
        if (m[1] != null) {
          if (!/^[a-z_]\w*$/i.test(m[1])) throw new Error(`Name the words you capture, like {place} or {q}.`);
          if (names.includes(m[1])) throw new Error(`{${m[1]}} is used twice in “${line}”.`);
          names.push(m[1]); src += `\\s+(?<${m[1]}>.+?)`;
        } else if (m[2] != null) src += `(?:\\s+(?:${reAlts(m[2])}))?`;
        else if (m[3] != null) { src += `\\s+(?:${reAlts(m[3])})`; lit += Math.min(...m[3].split('|').map(a => a.trim().length)); }
        else { src += '\\s+' + reWord(m[4]); lit += m[4].length; }
      }
      if (!src) throw new Error('Add some words to the phrase.');
      const re = new RegExp(`^${src}\\s*$`, 'i');
      return { how, line, lit, names, test: t => { const m = (' ' + t).match(re); return m ? { ...m.groups } : null; } };
    });
  },
  patterns(c) {
    const key = JSON.stringify([c.say, c.match]), hit = this.cache.get(c.id);
    if (hit?.key === key) return hit.p;
    let p; try { p = this.compile(c); } catch { p = []; }
    this.cache.set(c.id, { key, p }); return p;
  },
  /** Every command that matches, best first. Phrases beat keywords; longer literal wording beats shorter; your own commands win. */
  candidates(t) {
    const out = [];
    for (const c of this.all()) {
      if (c.on === false) continue;
      for (const p of this.patterns(c)) {
        const v = p.test(t); if (!v) continue;
        out.push({ cmd: c, vars: v, how: p.how, score: p.lit + (p.how === 'keywords' ? -100 : 0) + (c.custom ? 1000 : 0) });
      }
    }
    return out.sort((a, b) => b.score - a.score); // stable: earlier commands win ties
  },
  /** Fix near-miss words (“navigte”, “whatsap”) against the words the phrases use. */
  correct(t) {
    if (!this.vocab) {
      this.vocab = new Set();
      for (const c of this.all()) if ((c.match || 'phrase') !== 'regex') for (const l of [].concat(c.say || []))
        String(l).replace(/\{\w*\}/g, ' ').split(/[\s|,()[\]]+/).forEach(w => w.length >= 4 && this.vocab.add(w.toLowerCase()));
    }
    return t.split(' ').map(w => {
      const lw = w.toLowerCase(); if (lw.length < 4 || this.vocab.has(lw) || /\d/.test(lw)) return w;
      let best = null, bd = lw.length >= 7 ? 2 : 1;
      for (const v of this.vocab) if (Math.abs(v.length - lw.length) <= bd) { const d = lev(lw, v); if (d <= bd && (!best || d < best[1])) best = [v, d]; }
      return best ? best[0] : w;
    }).join(' ');
  },
  /** Find the command for a phrase. Tries exact phrases/regex/keywords, then again with near-miss words corrected. */
  match(text) {
    const t = tidy(text), pick = list => list.find(r => {
      const b = r.cmd.do?.type === 'builtin' && BUILTINS[r.cmd.do.fn];
      return !b?.ok || b.ok(this.vars(r, t));
    });
    let r = pick(this.candidates(t));
    if (!r) { const f = this.correct(t); if (f !== t) { r = pick(this.candidates(f)); if (r) r = { ...r, how: 'fuzzy', fixed: f }; } }
    return r ? { ...r, text: t, vars: this.vars(r, r.fixed || t) } : { text: t };
  },
  /** Captured words + text (everything) + q (what gets passed along: the action's input template, or the first captured value). */
  vars(r, t) {
    const v = { text: t }; for (const [k, x] of Object.entries(r.vars || {})) v[k] = (x || '').trim();
    const first = Object.keys(r.vars || {}).map(k => v[k]).find(Boolean) || '';
    const input = r.cmd.do?.input;
    v.q = input != null && input !== '' ? fillIn(input, { q: first, ...v }).trim() : (v.q ?? first);
    return v;
  },

  /** Hear/typed text → action, with a spoken reply. */
  run(raw, spoken) {
    Voice.open();
    if (!spoken) { VoiceLog.you(raw, { engine: 'Typed' }); Voice.show(`“${raw}”`, ''); }
    const say = (msg, then, o = {}) => Voice.respond(msg, then, o);
    const r = this.match(raw);
    if (!r.cmd) return say(typeof Convo !== 'undefined' && Convo.active ? 'Sorry, I didn’t get that.' : 'Sorry, I didn’t catch that. Say “what can I say” for ideas.');
    const c = r.cmd, v = r.vars, d = c.do || {}, custom = c.reply ? fillIn(c.reply, v) : '';
    Bus.emit('cmd.run', { value: Object.entries(v).find(([k, x]) => x && k !== 'text' && k !== 'rest')?.[1] || '', command: c.name, id: c.id, text: raw });
    const reply = (auto, then, o) => say(custom || auto, then, o);
    try {
      if (d.type === 'builtin') {
        const b = BUILTINS[d.fn]; if (!b) return say('That command’s action is missing. Edit it in Settings.');
        return b.run(v, custom ? (m, then, o) => say(custom, then, o) : say);
      }
      if (d.type === 'action') {
        if (typeof Actions === 'undefined' || !Actions.list[d.action]) return say('That action isn’t available. Edit the command in Settings.');
        const first = Object.entries(v).find(([k, x]) => x && k !== 'text' && k !== 'rest')?.[1] || '';
        let said = false; const sayA = (m, then, o) => { said = true; say(custom || m, then, o); };
        Actions.run(d.action, d.input ? fillIn(d.input, v) : first, sayA, { value: first });
        if (!said) say(custom || 'Okay.');
        return;
      }
      if (d.type === 'app') {
        const name = d.app === 'custom' ? (c.name || 'the app') : APP_LINKS[d.app]?.[0] || 'the app';
        return reply(`Opening ${name}${v.q ? ` for ${v.q}` : ''}.`, () => openLink(d.app, v.q, d.url, v), { leaves: true });
      }
      if (d.type === 'shortcut') {
        const name = fillIn(d.shortcut, v).trim(); if (!name) return say('Which shortcut? Say “run shortcut” and its name.');
        return reply(`Running ${name}.`, () => runShortcut(name, v.q), { leaves: true });
      }
      if (d.type === 'widget') return W[d.widget] ? (custom ? showWidget(d.widget, (m, then) => say(custom, then)) : showWidget(d.widget, say)) : say('That widget isn’t available.');
      if (d.type === 'screen') {
        if (d.screen === 'dashboard') return reply('Dashboard.', () => openView('dashboard'));
        if (d.screen === 'commands') return reply('Voice commands.', () => CmdUI.open());
        return appById(d.screen) ? reply(`Opening ${appById(d.screen).name}.`, () => openApp(d.screen)) : say('That screen isn’t available.');
      }
      if (d.type === 'say') return say(fillIn(d.text || c.reply || 'Okay.', v));
      say('That command has no action yet.');
    } catch (e) { console.warn('Command failed', e); say('Something went wrong running that.'); }
  },
};
// Kept for app.js callers (typed chips, quick replies) and voice.js.
function handleCommand(raw, spoken) { Commands.run(raw, spoken); }

/* ============================================================
   Settings › Voice commands: list, test, edit, add
   ============================================================ */
const ACTION_TYPES = [['builtin', 'Do a DriveDeck action'], ['action', 'Do a widget action (radio, documents…)'], ['app', 'Open a phone app'], ['shortcut', 'Run a phone shortcut'],
  ['widget', 'Show a widget'], ['screen', 'Open a DriveDeck screen'], ['say', 'Just reply']];
const GROUPS = ['Navigation', 'Music', 'Radio', 'Media', 'Camera', 'Phone', 'Info', 'Dashboard', 'Assistant'];
function actionLabel(d = {}) {
  if (d.type === 'builtin') return BUILTINS[d.fn]?.name || 'Missing action';
  if (d.type === 'action') return (typeof Actions !== 'undefined' && Actions.list[d.action]?.name) || 'Missing action';
  if (d.type === 'app') return APP_LINKS[d.app]?.[0] || 'App';
  if (d.type === 'shortcut') return `Shortcut: ${d.shortcut || '?'}`;
  if (d.type === 'widget') return `Widget: ${W[d.widget]?.name || '?'}`;
  if (d.type === 'screen') return `Screen: ${d.screen === 'dashboard' ? 'Dashboard' : appById(d.screen)?.name || d.screen}`;
  return 'Reply';
}
/** A readable example of a command's first phrase: optional words dropped, the first of each choice kept. */
function example(c) {
  const l = String([].concat(c.say || [])[0] || '');
  if (c.match === 'regex') return l.slice(0, 50);
  if (c.match === 'keywords') return l.split(',').map(g => g.split('|')[0].trim()).join(' … ');
  return l.replace(/\[[^\]]*\]/g, '').replace(/\(([^|)]*)[^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}
const cmdGroup = c => c.custom ? 'Your commands' : c.id.startsWith('app.') ? 'Phone apps & shortcuts' : BUILTINS[c.do?.fn]?.group || 'Dashboard';

const CmdUI = {
  shown: false, draft: null,
  open() { this.shown = true; if (current !== 'settings') openView('settings'); else this.render(); },
  close() { this.shown = false; renderSettings(); },
  render() {
    const all = Commands.all(), groups = {};
    all.forEach(c => (groups[cmdGroup(c)] ||= []).push(c));
    const order = ['Your commands', ...GROUPS, 'Phone apps & shortcuts'];
    const row = c => `<div class="row-wrap cmd-row"><button class="row" data-cmdedit="${esc(c.id)}"><div class="main"><div class="t">${esc(c.name || 'Untitled')}${c.edited ? ' <small>edited</small>' : ''}</div>
        <div class="s">“${esc(example(c))}” · ${esc(actionLabel(c.do))}</div></div></button>
        <span class="cmd-sw"><button class="switch ${c.on === false ? '' : 'on'}" data-cmdon="${esc(c.id)}" role="switch" aria-checked="${c.on !== false}" aria-label="${esc(c.name)} on"></button></span></div>`;
    $('#settingsBody').innerHTML = `
      <button class="row btn back-row" data-cmdui="back"><div class="main"><div class="t">‹ Settings</div></div></button>
      <div class="group-title">Voice commands</div>
      <div class="group"><div class="cmd-try"><input id="cmdTry" placeholder="Type what you’d say, e.g. play music from Maroon 5" autocomplete="off" enterkeyhint="go">
        <button class="big-btn accent" data-cmdui="run">Run</button></div><div class="cmd-test" id="cmdTest">Type a phrase to see which command it triggers and what it passes along.</div></div>
      <p class="cmd-help">Speak or type; DriveDeck matches your words against every command below: exact phrases first, then regular expressions and keywords, then again with near-miss words corrected. Words in <b>{braces}</b> are captured and passed to the action: a phone app’s search, a shortcut’s input, a place, a contact.</p>
      <div class="group"><button class="row btn" data-cmdui="add"><div class="main"><div class="t">＋ Add a command</div></div></button></div>
      ${order.filter(g => groups[g]).map(g => `<div class="group-title">${esc(g)}</div><div class="group">${groups[g].map(row).join('')}</div>`).join('')}
      <div class="group-title"></div><div class="group"><button class="row btn" data-cmdui="reset"><div class="main"><div class="t">Reset all commands to defaults</div></div></button></div>`;
    const inp = $('#cmdTry');
    inp.addEventListener('input', () => this.test(inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); handleCommand(inp.value.trim()); } });
  },
  test(text) {
    const out = $('#cmdTest'); if (!out) return;
    if (!text.trim()) return out.textContent = 'Type a phrase to see which command it triggers and what it passes along.';
    const r = Commands.match(text);
    if (!r.cmd) return out.innerHTML = `<b>No command matches.</b> Add one below, or check the spelling.`;
    const v = Object.entries(r.vars).filter(([k, x]) => x && k !== 'text' && k !== 'rest').map(([k, x]) => `<code>{${esc(k)}}</code> ${esc(x)}`).join(' · ');
    out.innerHTML = `→ <b>${esc(r.cmd.name)}</b> · ${esc(actionLabel(r.cmd.do))}<br><span>${{ phrase: 'Phrase', regex: 'Regular expression', keywords: 'Keywords', fuzzy: `Near-miss corrected (“${esc(r.fixed)}”)` }[r.how]}${v ? ' · ' + v : ''}</span>`;
  },
  toggle(id) {
    const s = Commands.saved(), c = Commands.byId(id); if (!c) return;
    if (c.custom) s.custom = s.custom.map(x => x.id === id ? { ...x, on: c.on === false } : x);
    else s.edits[id] = { ...(s.edits[id] || {}), on: c.on === false };
    Commands.save(s); this.render();
  },
  /** The editor: a sheet with the phrases, how to match them, and what to do. */
  edit(id, draft) {
    const c = draft || (id ? Commands.byId(id) : { id: '', name: '', say: [''], match: 'phrase', do: { type: 'app', app: 'spotify', input: '{q}' }, custom: true });
    this.draft = c; const d = c.do || {};
    const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const builtins = GROUPS.map(g => `<optgroup label="${g}">${opt(Object.entries(BUILTINS).filter(([, b]) => b.group === g).map(([k, b]) => [k, b.name]), d.fn)}</optgroup>`).join('');
    const screens = [['dashboard', 'Dashboard'], ...APPS.map(a => [a.id, a.name]), ['commands', 'Voice commands']];
    const ag = {}; if (typeof Actions !== 'undefined') Object.entries(Actions.list).forEach(([k, a]) => (ag[a.group] ||= []).push([k, a.name]));
    const widgetActions = Object.entries(ag).map(([g, l]) => `<optgroup label="${esc(g)}">${opt(l, d.action)}</optgroup>`).join('');
    sheet(id ? 'Edit command' : 'New command', `<div class="cmd-form">
      <label class="fld"><span>Name</span><input id="ceName" value="${esc(c.name || '')}" placeholder="Play an artist on Spotify"></label>
      <label class="fld"><span>When I say (one phrase per line)</span><textarea id="ceSay" rows="4" placeholder="play {q} on spotify">${esc([].concat(c.say || []).join('\n'))}</textarea></label>
      <p class="hint">{q} or any {name} captures words · [word] is optional · (this|that) means either. Keywords: every comma-separated group must be heard. Regular expressions: named groups like (?&lt;q&gt;.+) are captured.</p>
      <label class="fld"><span>Match using</span><select id="ceMatch">${opt([['phrase', 'Phrases'], ['keywords', 'Keywords'], ['regex', 'Regular expressions']], c.match || 'phrase')}</select></label>
      <label class="fld"><span>Then</span><select id="ceType">${opt(ACTION_TYPES, d.type || 'builtin')}</select></label>
      <label class="fld" data-for="builtin"><span>DriveDeck action</span><select id="ceFn">${builtins}</select></label>
      <label class="fld" data-for="action"><span>Widget action</span><select id="ceAction">${widgetActions}</select></label>
      <label class="fld" data-for="app"><span>App</span><select id="ceApp">${opt(Object.entries(APP_LINKS).map(([k, a]) => [k, a[0]]), d.app || 'spotify')}</select></label>
      <label class="fld" data-for="app-custom"><span>Link, with {q} where the words go</span><input id="ceUrl" value="${esc(d.url || '')}" placeholder="myapp://search?q={q}" autocapitalize="off"></label>
      <label class="fld" data-for="shortcut"><span>Shortcut name (as named in your phone’s shortcuts app)</span><input id="ceSc" value="${esc(d.shortcut || '')}" placeholder="Play Artist"></label>
      <label class="fld" data-for="widget"><span>Widget</span><select id="ceWidget">${opt(Object.entries(W).map(([k, w]) => [k, w.name]), d.widget)}</select></label>
      <label class="fld" data-for="screen"><span>Screen</span><select id="ceScreen">${opt(screens, d.screen)}</select></label>
      <label class="fld" data-for="builtin action app shortcut"><span>Pass along (blank = the first captured words)</span><input id="ceInput" value="${esc(d.input ?? '')}" placeholder="{q}" autocapitalize="off"></label>
      <label class="fld"><span id="ceReplyL">Say back (optional, can use {q})</span><input id="ceReply" value="${esc(d.type === 'say' ? d.text || '' : c.reply || '')}" placeholder="Playing {q} on Spotify"></label>
      <div class="cmd-test" id="ceErr"></div></div>`,
      [['Save', () => this.saveDraft(id)], ...(c.custom && id ? [['Delete', () => this.remove(id)]] : c.edited ? [['Reset to default', () => this.reset(id)]] : []), ['Cancel', () => { this.draft = null; }]]);
    const sync = () => {
      const type = $('#ceType').value, app = $('#ceApp').value;
      $$('.cmd-form [data-for]').forEach(el => { const f = el.dataset.for.split(' ');
        el.hidden = !(f.includes(type) || (f.includes('app-custom') && type === 'app' && app === 'custom')); });
      $('#ceReplyL').textContent = type === 'say' ? 'Reply (can use {q} and your {names})' : 'Say back (optional, can use {q})';
      const err = $('#ceErr'); try { Commands.compile({ say: $('#ceSay').value, match: $('#ceMatch').value }); err.textContent = ''; } catch (e) { err.textContent = e.message; }
    };
    ['ceType', 'ceApp', 'ceMatch', 'ceSay'].forEach(k => $('#' + k).addEventListener('input', sync)); sync();
  },
  readForm(id) {
    const type = $('#ceType').value, d = { type };
    if (type === 'builtin') d.fn = $('#ceFn').value;
    if (type === 'action') d.action = $('#ceAction').value;
    if (type === 'app') { d.app = $('#ceApp').value; if (d.app === 'custom') d.url = $('#ceUrl').value.trim(); }
    if (type === 'shortcut') d.shortcut = $('#ceSc').value.trim();
    if (type === 'widget') d.widget = $('#ceWidget').value;
    if (type === 'screen') d.screen = $('#ceScreen').value;
    if (type === 'say') d.text = $('#ceReply').value.trim();
    if (['builtin', 'action', 'app', 'shortcut'].includes(type) && $('#ceInput').value.trim()) d.input = $('#ceInput').value.trim();
    return { id: id || 'my.' + Date.now().toString(36), name: $('#ceName').value.trim() || 'My command',
      say: $('#ceSay').value.split('\n').map(s => s.trim()).filter(Boolean), match: $('#ceMatch').value, do: d,
      reply: type === 'say' ? '' : $('#ceReply').value.trim() };
  },
  saveDraft(id) {
    const c = this.readForm(id), s = Commands.saved(), prev = id && Commands.byId(id);
    let problem = ''; try { Commands.compile(c); } catch (e) { problem = e.message; }
    if (!problem && c.do.type === 'app' && c.do.app === 'custom' && !/^[a-z][\w+.-]*:/i.test(c.do.url || '')) problem = 'Add the app’s link, like myapp://search?q={q}.';
    if (!problem && c.do.type === 'shortcut' && !c.do.shortcut) problem = 'Add the shortcut’s name.';
    if (problem) { toast(problem); return this.edit(id, { ...c, custom: !prev || prev.custom, edited: prev?.edited }); }
    if (!prev || prev.custom) {
      const i = s.custom.findIndex(x => x.id === c.id), on = prev ? prev.on : true;
      i >= 0 ? s.custom[i] = { ...c, on } : s.custom.unshift({ ...c, on });
    } else s.edits[id] = { name: c.name, say: c.say, match: c.match, do: c.do, reply: c.reply, on: prev.on };
    Commands.save(s); this.draft = null; toast('Command saved'); this.render();
  },
  remove(id) { const s = Commands.saved(); s.custom = s.custom.filter(c => c.id !== id); Commands.save(s); toast('Command deleted'); this.render(); },
  reset(id) { const s = Commands.saved(); delete s.edits[id]; Commands.save(s); toast('Back to the default'); this.render(); },
  resetAll() {
    sheet('Reset voice commands?', '<p>Your edits to the built-in commands are undone. Commands you added stay.</p>',
      [['Reset', () => { const s = Commands.saved(); s.edits = {}; Commands.save(s); this.render(); toast('Commands reset'); }], ['Cancel']]);
  },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-cmdui],[data-cmdedit],[data-cmdon]'); if (!t) return;
  if ('cmdedit' in t.dataset) return CmdUI.edit(t.dataset.cmdedit);
  if ('cmdon' in t.dataset) return CmdUI.toggle(t.dataset.cmdon);
  const a = t.dataset.cmdui;
  if (a === 'back') CmdUI.close();
  else if (a === 'add') CmdUI.edit(null);
  else if (a === 'reset') CmdUI.resetAll();
  else if (a === 'run') { const v = $('#cmdTry')?.value.trim(); if (v) handleCommand(v); }
});
// Settings may have rendered before this file loaded (e.g. ?view=settings): draw it again with the Voice commands row.
if (current === 'settings') renderSettings();
