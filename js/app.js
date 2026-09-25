'use strict';
/* ============================================================
   Utilities
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('dd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dd.' + k, JSON.stringify(v)); } catch {} }
};

const R_EARTH = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const P = ([lat, lon]) => ({ lat, lon });
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const pathLength = pts => pts.slice(1).reduce((s, p, i) => s + haversine(P(pts[i]), P(p)), 0);
const cardinal = h => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(h / 45) % 8];
const fmtClock = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDur = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/* ============================================================
   Icons (24×24 stroke glyphs)
   ============================================================ */
const I = {
  maps: '<path d="M12 2.5l7.5 18.5-7.5-4.2L4.5 21z" fill="currentColor" stroke="none"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" fill="currentColor" stroke="none"/>',
  messages: '<path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 5 3.7 6.5L5 21.5l4.2-2.2c.9.2 1.8.3 2.8.3 5.5 0 10-3.8 10-8.5S17.5 3 12 3z" fill="currentColor" stroke="none"/>',
  weather: '<path d="M8 2.5v1.5M3.2 4.7l1.1 1.1M1.5 9.5H3M12.8 4.7l-1.1 1.1"/><path d="M11.8 9.2A4 4 0 1 0 5.4 12.6"/><path d="M17.5 21H9a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 20.4 15 3 3 0 0 1 17.5 21z" fill="currentColor" stroke="none"/>',
  gauge: '<path d="M4.2 18.5a9.5 9.5 0 1 1 15.6 0"/><path d="M12 14l4.5-5"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  podcasts: '<circle cx="12" cy="11" r="2.2" fill="currentColor"/><path d="M12 14v7.5"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  radio: '<rect x="2.5" y="8" width="19" height="13" rx="2.5"/><path d="M7 8l11-5"/><circle cx="8.5" cy="14.5" r="2.5"/><path d="M15 12.5h3M15 16.5h3"/>',
  parking: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  food: '<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2 1.2-3 4-3 7h3"/>',
  coffee: '<path d="M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v2.5M12 2.5v2.5"/>',
  house: '<path d="M3 11.5L12 4l9 7.5M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M3 13h18"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  dumbbell: '<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
  next: '<path d="M3 5.5v13l8.5-6.5zM12 5.5v13l8.5-6.5z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M21 5.5v13l-8.5-6.5zM12 5.5v13L3.5 12z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  dash: '<rect x="3" y="4" width="11" height="16" rx="2"/><rect x="16" y="4" width="5" height="7" rx="1.5"/><rect x="16" y="13" width="5" height="7" rx="1.5"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
  locate: '<path d="M3 11l18-8-8 18-2-8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevUp: '<path d="M6 15l6-6 6 6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  signal: '<path d="M4 20v-3M9 20v-6M14 20v-9M19 20V5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  callIn: '<path d="M16 3v5h5M22 2l-6 6"/>',
  callOut: '<path d="M22 8V3h-5M16 8l6-6"/>',
  keypad: '<circle cx="6" cy="5" r="1.3"/><circle cx="12" cy="5" r="1.3"/><circle cx="18" cy="5" r="1.3"/><circle cx="6" cy="11" r="1.3"/><circle cx="12" cy="11" r="1.3"/><circle cx="18" cy="11" r="1.3"/><circle cx="6" cy="17" r="1.3"/><circle cx="12" cy="17" r="1.3"/><circle cx="18" cy="17" r="1.3"/>',
  mute: '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.3 5.5M12 18v3.5M3 3l18 18"/>',
  speaker: '<path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
  del: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6"/>',
  turnRight: '<path d="M7 21v-8a5 5 0 0 1 5-5h8M15 3l5 5-5 5"/>',
  turnLeft: '<path d="M17 21v-8a5 5 0 0 0-5-5H4M9 3L4 8l5 5"/>',
  straight: '<path d="M12 21V4M6 10l6-6 6 6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 12a3.5 3.5 0 0 1-3 7z"/>',
  rain: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="M8 19h.01M12 19h.01M16 19h.01M10 22h.01M14 22h.01"/>',
  storm: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="M13 15l-2 4h3l-2 4"/>',
  fog: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  partly: '<path d="M8 2.5v1.5M3.2 4.7l1.1 1.1M1.5 9.5H3M12.8 4.7l-1.1 1.1"/><path d="M11.8 9.2A4 4 0 1 0 5.4 12.6"/><path d="M17.5 21H9a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 20.4 15 3 3 0 0 1 17.5 21z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`;
function hydrateIcons(root = document) { $$('[data-icon]', root).forEach(el => { el.outerHTML = svg(el.dataset.icon); }); }

/* ============================================================
   Settings & theme
   ============================================================ */
const settings = Object.assign({
  theme: 'dark', units: 'imperial', wallpaper: 0, speedLimit: true, voice: true,
  hideWhileDriving: true, readAloud: true, wakeLock: true
}, store.get('settings', {}));

const WALLS = [
  { dark: 'radial-gradient(110% 90% at 0% 0%,#1d3a8a 0%,transparent 55%),radial-gradient(90% 80% at 100% 100%,#5b21b6 0%,transparent 55%),#05060b',
    light: 'radial-gradient(110% 90% at 0% 0%,#bcd3ff 0%,transparent 60%),radial-gradient(90% 80% at 100% 100%,#e5d4ff 0%,transparent 60%),#f4f6fb' },
  { dark: 'radial-gradient(100% 90% at 100% 0%,#0f766e 0%,transparent 55%),radial-gradient(90% 80% at 0% 100%,#14532d 0%,transparent 55%),#030a08',
    light: 'radial-gradient(100% 90% at 100% 0%,#b7f0e4 0%,transparent 60%),radial-gradient(90% 80% at 0% 100%,#d6f5d6 0%,transparent 60%),#f3faf7' },
  { dark: 'radial-gradient(100% 90% at 0% 100%,#b45309 0%,transparent 55%),radial-gradient(90% 80% at 100% 0%,#7f1d1d 0%,transparent 55%),#0b0504',
    light: 'radial-gradient(100% 90% at 0% 100%,#ffd9a8 0%,transparent 60%),radial-gradient(90% 80% at 100% 0%,#ffc9c9 0%,transparent 60%),#fff7f2' },
  { dark: 'linear-gradient(160deg,#1c1c1e,#050505)', light: 'linear-gradient(160deg,#ffffff,#e5e5ea)' },
];
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => settings.theme === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : settings.theme;

function applySettings() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  $('meta[name=theme-color]').content = theme === 'dark' ? '#000000' : '#f2f2f7';
  $('#app').style.setProperty('--wallpaper', WALLS[settings.wallpaper][theme]);
  renderLimit(); updateSpeedUI(); updateDrive();
  syncWakeLock();
  store.set('settings', settings);
}
darkMQ.addEventListener?.('change', () => settings.theme === 'auto' && applySettings());

/* ============================================================
   Apps & navigation between views
   ============================================================ */
const APPS = [
  { id: 'maps', name: 'Maps', icon: 'maps', bg: 'linear-gradient(150deg,#6be38a 0%,#2cc2ff 55%,#0a6cff 100%)' },
  { id: 'music', name: 'Music', icon: 'music', bg: 'linear-gradient(160deg,#ff6a88,#fa233b)', source: 'music' },
  { id: 'phone', name: 'Phone', icon: 'phone', bg: 'linear-gradient(160deg,#6ef08a,#1fbf4a)' },
  { id: 'messages', name: 'Messages', icon: 'messages', bg: 'linear-gradient(160deg,#6ef08a,#1fbf4a)' },
  { id: 'weather', name: 'Weather', icon: 'weather', bg: 'linear-gradient(160deg,#5cc0ff,#1a5fd6)' },
  { id: 'drive', name: 'Drive', icon: 'gauge', bg: 'linear-gradient(160deg,#ffb340,#ff6a00)' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar', bg: 'linear-gradient(160deg,#ff6b6b,#d0213f)' },
  { id: 'settings', name: 'Settings', icon: 'settings', bg: 'linear-gradient(160deg,#a1a1a8,#5b5b62)' },
  { id: 'podcasts', name: 'Podcasts', icon: 'podcasts', bg: 'linear-gradient(160deg,#d68bff,#8a2be2)', view: 'music', source: 'podcasts' },
  { id: 'radio', name: 'Radio', icon: 'radio', bg: 'linear-gradient(160deg,#ff8a5c,#e5383b)', view: 'music', source: 'radio' },
  { id: 'parking', name: 'Parking', icon: 'parking', bg: 'linear-gradient(160deg,#6ad4ff,#0070c9)', view: 'maps', category: 'Parking' },
  { id: 'charging', name: 'EV Charging', icon: 'bolt', bg: 'linear-gradient(160deg,#63e6be,#0ca678)', view: 'maps', category: 'EV Chargers' },
];
const appById = id => APPS.find(a => a.id === id);
let current = 'dashboard';
let recents = store.get('recents', ['maps', 'music', 'phone']).filter(appById);

function appIcon(a, withBadge) {
  return `<div class="app-icon" style="background:${a.bg}">${svg(a.icon)}${withBadge && a.id === 'messages' ? '<span class="badge" data-badge hidden></span>' : ''}</div>`;
}
function renderHome() {
  const pages = [APPS.slice(0, 8), APPS.slice(8)];
  $('#homePages').innerHTML = pages.map(p => `<div class="home-page">${p.map(a =>
    `<button class="app-tile" data-app="${a.id}">${appIcon(a, true)}<span class="app-label">${a.name}</span></button>`).join('')}</div>`).join('');
  $('#pageDots').innerHTML = pages.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('');
  $('#homePages').addEventListener('scroll', e => {
    const i = Math.round(e.target.scrollLeft / e.target.clientWidth);
    $$('#pageDots i').forEach((d, j) => d.classList.toggle('on', i === j));
  }, { passive: true });
}
function renderDock() {
  $('#dockRecents').innerHTML = recents.map(id => {
    const a = appById(id), active = (a.view || a.id) === current;
    return `<button class="dock-app ${active ? 'active' : ''}" data-app="${id}" aria-label="${a.name}">${appIcon(a, true)}</button>`;
  }).join('');
  $('#homeBtn').innerHTML = svg(current === 'home' ? 'dash' : 'grid');
  updateBadges();
}
function pushRecent(id) {
  recents = [id, ...recents.filter(r => r !== id)].slice(0, 3);
  store.set('recents', recents);
}
function openApp(id) {
  const a = appById(id); if (!a) return;
  if (a.source && a.source !== player.source) setSource(a.source);
  if (a.category) { panel.mode = 'category'; panel.cat = a.category; panel.collapsed = false; renderMapPanel(); }
  pushRecent(id);
  openView(a.view || a.id, true);
}
function openView(id, fromApp) {
  if (!fromApp && appById(id)) pushRecent(id);
  current = id;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
  renderDock();
  ({
    dashboard: () => { ensureMap('dash'); renderDashTiles(); },
    maps: () => { ensureMap('main'); renderMapPanel(); },
    weather: () => loadWeather(),
    messages: () => renderMessages(),
    phone: () => renderPhone(),
    calendar: () => renderCalendar(),
    settings: () => renderSettings(),
    drive: () => updateDrive(),
  })[id]?.();
}
function homeButton() {
  closeAssistant();
  openView(current === 'home' ? 'dashboard' : 'home');
}

/* ============================================================
   Location: device GPS or simulated demo drive
   ============================================================ */
const loc = { lat: 37.7749, lon: -122.4194, speed: 0, heading: 0, alt: null, acc: null, source: 'none', ts: 0 };
const trip = { dist: 0, moving: 0, max: 0, start: Date.now() };
let gpsWatch = null, demo = null, gotFirstFix = false;

// Demo route: Embarcadero → down Market St (San Francisco)
const DEMO = [[37.7955, -122.3937], [37.7929, -122.3969], [37.7897, -122.4010], [37.7867, -122.4048], [37.7838, -122.4087],
  [37.7810, -122.4121], [37.7786, -122.4153], [37.7752, -122.4194], [37.7725, -122.4230], [37.7698, -122.4265]];
const segLen = i => haversine(P(DEMO[i]), P(DEMO[i + 1]));
const demoCum = DEMO.map((_, i) => { let s = 0; for (let j = 0; j < i; j++) s += segLen(j); return s; });

function startGPS() {
  if (!('geolocation' in navigator)) { toast('Geolocation is not supported here'); return; }
  if (!window.isSecureContext) toast('GPS needs HTTPS or localhost');
  stopDemo();
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gotFirstFix = false;
  gpsWatch = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  toast('Acquiring GPS…');
}
function stopGPS() { if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
function onPosition(p) {
  const c = p.coords, next = { lat: c.latitude, lon: c.longitude };
  const moved = loc.ts ? haversine(loc, next) : 0, dt = loc.ts ? (p.timestamp - loc.ts) / 1000 : 0;
  let speed = c.speed, heading = c.heading;
  if (speed == null || isNaN(speed)) speed = dt > 0 ? moved / dt : 0;
  if (heading == null || isNaN(heading)) heading = moved > 3 ? bearing(loc, next) : loc.heading;
  if (loc.source === 'gps' && moved < 500) addTrip(moved, dt, speed);
  Object.assign(loc, next, { speed, heading, alt: c.altitude, acc: c.accuracy, source: 'gps', ts: p.timestamp });
  store.set('locSource', 'gps');
  if (!gotFirstFix) { gotFirstFix = true; toast(`GPS locked · ±${Math.round(c.accuracy)} m`); recenterAll(); }
  emit();
}
function onPositionError(err) {
  const msg = err.code === 1 ? 'Location permission denied — try Demo drive' : err.code === 3 ? 'GPS timed out, still trying…' : 'Location unavailable';
  toast(msg);
  if (err.code === 1) { stopGPS(); loc.source = 'none'; store.set('locSource', 'none'); emit(); }
}
function startDemo() {
  stopGPS();
  clearInterval(demo?.timer);
  demo = { seg: 0, t: 0, timer: setInterval(demoTick, 500) };
  Object.assign(loc, P(DEMO[0]), { speed: 0, heading: bearing(P(DEMO[0]), P(DEMO[1])), alt: 12, acc: 5, source: 'demo', ts: Date.now() });
  store.set('locSource', 'demo');
  recenterAll(); emit();
}
function stopDemo(announce) {
  if (!demo) return;
  clearInterval(demo.timer); demo = null;
  loc.speed = 0; loc.source = 'none'; store.set('locSource', 'none');
  if (announce) toast('Demo drive stopped');
  emit();
}
function demoTick() {
  const dt = 0.5, atEnd = demo.seg >= DEMO.length - 1;
  if (atEnd) {
    if (nav) { loc.speed = 0; emit(); return; } // hold at destination until arrival fires
    demo.seg = 0; demo.t = 0;
  }
  const target = 14 + Math.sin(Date.now() / 5000) * 4; // ~ 22–40 mph with gentle variation
  let move = target * dt;
  while (move > 0 && demo.seg < DEMO.length - 1) {
    const len = segLen(demo.seg), rem = len * (1 - demo.t);
    if (move < rem) { demo.t += move / len; move = 0; } else { move -= rem; demo.seg++; demo.t = 0; }
  }
  const i = Math.min(demo.seg, DEMO.length - 2), a = P(DEMO[i]), b = P(DEMO[i + 1]), t = demo.seg >= DEMO.length - 1 ? 1 : demo.t;
  const next = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  addTrip(haversine(loc, next), dt, target);
  Object.assign(loc, next, { speed: target, heading: bearing(a, b), alt: 12 + Math.sin(Date.now() / 9000) * 6, acc: 5, ts: Date.now() });
  emit();
}
function addTrip(d, dt, speed) { trip.dist += d; if (speed > 0.8) trip.moving += dt; trip.max = Math.max(trip.max, speed); }

const listeners = [];
function emit() { listeners.forEach(fn => fn()); }

/* Units */
const imperial = () => settings.units === 'imperial';
const speedVal = ms => Math.round(imperial() ? ms * 2.23694 : ms * 3.6);
const speedUnit = () => imperial() ? 'mph' : 'km/h';
const limitVal = () => imperial() ? 35 : 50;
function fmtDist(m) {
  if (imperial()) {
    const ft = m * 3.28084;
    if (ft < 1000) return { v: Math.max(50, Math.round(ft / 50) * 50), u: 'ft' };
    const mi = m / 1609.34; return { v: mi < 10 ? mi.toFixed(1) : Math.round(mi), u: 'mi' };
  }
  if (m < 1000) return { v: Math.max(10, Math.round(m / 10) * 10), u: 'm' };
  const km = m / 1000; return { v: km < 10 ? km.toFixed(1) : Math.round(km), u: 'km' };
}
const distStr = m => { const d = fmtDist(m); return d.v + ' ' + d.u; };
const spokenDist = m => distStr(m).replace(/ ft$/, ' feet').replace(/ mi$/, ' miles').replace(/ km$/, ' kilometers').replace(/ m$/, ' meters');

function updateSpeedUI() {
  const v = speedVal(loc.speed), over = settings.speedLimit && v > limitVal();
  $$('[data-speed]').forEach(e => e.textContent = loc.source === 'none' ? '—' : v);
  $$('[data-speed-unit]').forEach(e => e.textContent = speedUnit());
  $$('[data-speed-pill]').forEach(e => e.classList.toggle('over', over));
  $('#gpsDot').className = 'gps-dot ' + (loc.source === 'none' ? '' : loc.source);
  $('#locPrompt').hidden = loc.source !== 'none';
}
function renderLimit() {
  $('#limitSign').innerHTML = !settings.speedLimit ? '' : imperial()
    ? `<div class="limit-us"><small>SPEED<br>LIMIT</small><b>${limitVal()}</b></div>`
    : `<div class="limit-eu">${limitVal()}</div>`;
}
listeners.push(updateSpeedUI);

/* ============================================================
   Maps (Leaflet + CARTO basemap; graceful offline fallback)
   ============================================================ */
const maps = { main: { follow: true, rot: 0 }, dash: { follow: true, rot: 0 } };
// Key-free prototype basemap; night mode is a CSS filter on the tile pane. Production needs a keyed provider.
const tileUrl = () => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const carHtml = '<div class="car-dot"><div class="car-arrow"></div></div>';

function ensureMap(key) {
  const M = maps[key];
  if (M.map) { requestAnimationFrame(() => M.map.invalidateSize()); updateMaps(); return; }
  if (M.fallback) { updateMaps(); return; }
  const el = $(key === 'main' ? '#mainMap' : '#dashMap');
  if (!window.L) { M.fallback = true; el.classList.add('fallback'); el.innerHTML = `<div class="fallback-car">${carHtml}</div>`; updateMaps(); return; }
  const interactive = key === 'main';
  M.map = L.map(el, { zoomControl: false, attributionControl: true, dragging: interactive, touchZoom: interactive, scrollWheelZoom: interactive,
    doubleClickZoom: interactive, boxZoom: false, keyboard: false }).setView([loc.lat, loc.lon], interactive ? 16 : 15);
  M.tiles = L.tileLayer(tileUrl(), { maxZoom: 19, attribution: 'Tiles © Esri, HERE, Garmin, © OpenStreetMap' }).addTo(M.map);
  M.map.attributionControl.setPrefix(false);
  if (interactive) M.map.on('dragstart', () => { M.follow = false; $('#recenterBtn').classList.add('on'); });
  drawRoute(M); updateMaps();
}
function updateMaps() {
  for (const M of Object.values(maps)) {
    const h = loc.heading || 0;
    M.rot += ((h - M.rot) % 360 + 540) % 360 - 180; // shortest rotation path
    if (M.fallback) { const a = $('.car-arrow', M === maps.main ? $('#mainMap') : $('#dashMap')); if (a) a.style.transform = `rotate(${M.rot}deg)`; continue; }
    if (!M.map) continue;
    const ll = [loc.lat, loc.lon];
    if (!M.car) M.car = L.marker(ll, { icon: L.divIcon({ className: 'car-marker', html: carHtml, iconSize: [44, 44], iconAnchor: [22, 22] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(M.map);
    else M.car.setLatLng(ll);
    const arrow = M.car.getElement()?.querySelector('.car-arrow');
    if (arrow) arrow.style.transform = `rotate(${M.rot}deg)`;
    if (M.follow && loc.source !== 'none') M.map.panTo(ll, { animate: true, duration: 0.45 });
  }
}
function recenterAll() {
  for (const M of Object.values(maps)) { M.follow = true; M.map?.setView([loc.lat, loc.lon], nav ? 17 : 16); }
  $('#recenterBtn').classList.remove('on');
}
listeners.push(updateMaps);

/* Search panel, destinations & points of interest */
const panel = { mode: 'home', q: '', cat: null, collapsed: false };
let panelItems = [];
const CATS = [['Gas', 'fuel', '#ff9f0a'], ['Parking', 'parking', '#0a84ff'], ['EV Chargers', 'bolt', '#30d158'], ['Coffee', 'coffee', '#ac8e68'], ['Food', 'food', '#ff453a']];
const POIS = {
  'Gas': ['Shell', 'Chevron', '76 Station', 'Arco'],
  'Parking': ['Civic Center Garage', '5th & Mission Garage', 'Union Square Garage', 'Sutter-Stockton Garage'],
  'EV Chargers': ['ChargePoint · 4 stalls', 'Supercharger · 12 stalls', 'EVgo Fast Charging', 'Electrify America'],
  'Coffee': ['Blue Bottle Coffee', 'Sightglass', 'Ritual Coffee', 'Philz Coffee'],
  'Food': ['Tartine Bakery', 'Souvla', 'Nopa', 'Zuni Café'],
};
function destinations() {
  return [
    { id: 'home', name: 'Home', sub: '1234 Oak Street', icon: 'house', color: '#0a84ff', dLat: -0.024, dLon: -0.009 },
    { id: 'work', name: 'Work', sub: 'Bobworks HQ', icon: 'briefcase', color: '#8e5cf7', dLat: 0.016, dLon: 0.013 },
    { id: 'coffee', name: 'Blue Bottle Coffee', sub: 'Recent', icon: 'coffee', color: '#ac8e68', dLat: 0.006, dLon: -0.004 },
    { id: 'gym', name: 'Equinox', sub: 'Recent', icon: 'dumbbell', color: '#ff375f', dLat: -0.009, dLon: 0.011 },
  ].map(d => ({ ...d, lat: loc.lat + d.dLat, lon: loc.lon + d.dLon }));
}
function poisFor(cat) {
  const [, icon, color] = CATS.find(c => c[0] === cat);
  return POIS[cat].map((name, i) => ({ id: cat + i, name, icon, color, sub: cat,
    lat: loc.lat + (i + 1) * 0.0045 * (i % 2 ? 1 : -1), lon: loc.lon + (i + 1) * 0.0055 * (i % 3 ? -1 : 1) }));
}
function renderMapPanel() {
  const el = $('#mapPanel');
  el.classList.toggle('collapsed', panel.collapsed);
  const collapse = `<button class="icon-btn" data-panel="collapse" aria-label="Collapse">${svg(panel.collapsed ? 'chevDown' : 'chevUp')}</button>`;
  if (panel.mode === 'category') {
    el.innerHTML = `<div class="panel-top"><button class="icon-btn" data-panel="back" aria-label="Back">${svg('back')}</button><div class="panel-h">${esc(panel.cat)}</div>${collapse}</div>
      <div class="list scroll panel-list" id="panelList"></div>`;
  } else {
    el.innerHTML = `<div class="panel-top"><label class="search">${svg('search')}<input id="mapSearch" placeholder="Where to?" autocomplete="off" enterkeyhint="search" value="${esc(panel.q)}"></label>${collapse}</div>
      <div class="panel-chips">${CATS.map(([n, ic, c]) => `<button class="chip" data-cat="${n}"><span style="color:${c}">${svg(ic)}</span>${n}</button>`).join('')}</div>
      <div class="list scroll panel-list" id="panelList"></div>`;
    $('#mapSearch').addEventListener('input', e => { panel.q = e.target.value; renderPanelList(); });
    $('#mapSearch').addEventListener('focus', () => { if (panel.collapsed) { panel.collapsed = false; el.classList.remove('collapsed'); } });
  }
  renderPanelList();
}
function renderPanelList() {
  const list = $('#panelList'); if (!list) return;
  if (panel.mode === 'category') panelItems = poisFor(panel.cat);
  else {
    const q = panel.q.trim().toLowerCase();
    const all = [...destinations(), ...CATS.flatMap(c => poisFor(c[0]))];
    panelItems = q ? all.filter(d => (d.name + ' ' + d.sub).toLowerCase().includes(q)) : destinations();
  }
  panelItems.forEach(d => d.dist = haversine(loc, d));
  if (panel.mode === 'category') panelItems.sort((a, b) => a.dist - b.dist);
  list.innerHTML = panelItems.length ? panelItems.map((d, i) => `<button class="row" data-dest="${i}">
      <div class="poi-ic" style="background:${d.color}">${svg(d.icon)}</div>
      <div class="main"><div class="t">${esc(d.name)}</div><div class="s">${distStr(d.dist)} · ${esc(d.sub)}</div></div>${svg('chevDown').replace('<svg', '<svg style="transform:rotate(-90deg);width:18px;height:18px;opacity:.4"')}</button>`).join('')
    : `<div class="row"><div class="main"><div class="s">No results for “${esc(panel.q)}”</div></div></div>`;
}

/* Turn-by-turn navigation (mock guidance on a real or simulated track) */
let nav = null;
function startNav(dest) {
  if (!dest) return;
  if (loc.source === 'none') { toast('Starting demo drive for navigation'); }
  let route;
  if (loc.source === 'gps') route = [[loc.lat, loc.lon], [dest.lat, dest.lon]];
  else { startDemo(); route = DEMO.map(p => [...p]); dest = { ...dest, lat: DEMO.at(-1)[0], lon: DEMO.at(-1)[1] }; }
  const total = pathLength(route);
  nav = { dest, route, total, lastSpoken: -1, maneuvers: [
    { at: total * 0.2, type: 'turnRight', street: 'Market St' },
    { at: total * 0.5, type: 'straight', street: 'Market St' },
    { at: total * 0.8, type: 'turnLeft', street: 'Valencia St' },
    { at: total, type: 'flag', street: dest.name },
  ] };
  $('#view-maps').classList.add('navigating'); $('#view-dashboard').classList.add('navigating');
  Object.values(maps).forEach(drawRoute);
  openView('maps'); recenterAll();
  speak(`Starting route to ${dest.name}.`);
  updateNav();
}
function drawRoute(M) {
  if (!M.map) return;
  (M.routeLayers || []).forEach(l => l.remove()); M.routeLayers = [];
  if (!nav) return;
  M.routeLayers = [
    L.polyline(nav.route, { color: '#0647a8', weight: 12, opacity: .9, lineCap: 'round', lineJoin: 'round' }),
    L.polyline(nav.route, { color: '#1a8cff', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }),
    L.marker(nav.route.at(-1), { icon: L.divIcon({ className: 'dest-pin', html: '<div></div>', iconSize: [30, 30], iconAnchor: [15, 34] }), interactive: false }),
  ].map(l => l.addTo(M.map));
}
const VERB = { turnRight: 'Turn right onto', turnLeft: 'Turn left onto', straight: 'Continue on', flag: 'Arrive at' };
function updateNav() {
  if (!nav) return;
  const done = loc.source === 'demo' && demo ? demoCum[Math.min(demo.seg, DEMO.length - 1)] + (demo.seg < DEMO.length - 1 ? demo.t * segLen(demo.seg) : 0)
    : Math.max(0, nav.total - haversine(loc, nav.dest));
  const remain = Math.max(0, nav.total - done);
  if (remain < 25) return arrive();
  const idx = nav.maneuvers.findIndex(m => m.at > done + 3), man = nav.maneuvers[idx], toNext = man.at - done;
  const d = fmtDist(toNext);
  $('#manIcon').innerHTML = svg(man.type);
  $('#manDist').textContent = `${d.v} ${d.u}`;
  $('#manStreet').textContent = `${VERB[man.type]} ${man.street}`;
  $('#dashMan').hidden = false;
  $('#dashMan').innerHTML = `${svg(man.type)}<div><b>${d.v} ${d.u}</b><span>${esc(man.street)}</span></div>`;
  const secs = remain / Math.max(loc.speed, 11), rd = fmtDist(remain);
  $('#etaArr').textContent = fmtClock(new Date(Date.now() + secs * 1000)).replace(/\s?[AP]M/i, '');
  $('#etaMin').textContent = Math.max(1, Math.round(secs / 60));
  $('#etaDist').textContent = rd.v; $('#etaDistU').textContent = rd.u;
  if (idx !== nav.lastSpoken && settings.voice) { nav.lastSpoken = idx; speak(`In ${spokenDist(toNext)}, ${VERB[man.type].toLowerCase()} ${man.street}.`); }
}
function arrive() { const n = nav.dest.name; endNav(); toast(`Arrived at ${n}`); if (settings.voice) speak(`You have arrived at ${n}.`); }
function endNav() {
  nav = null;
  $('#view-maps').classList.remove('navigating'); $('#view-dashboard').classList.remove('navigating');
  $('#dashMan').hidden = true;
  Object.values(maps).forEach(drawRoute);
  if (maps.main.map) maps.main.map.setZoom(16);
}
listeners.push(updateNav);

/* ============================================================
   Media player (simulated playback)
   ============================================================ */
const LIB = {
  music: [
    { t: 'Midnight City Lights', a: 'Neon Harbor', dur: 214, art: ['#ff5f6d', '#ffc371'] },
    { t: 'Open Road', a: 'The Wanderers', dur: 248, art: ['#43cea2', '#185a9d'] },
    { t: 'Coastline', a: 'Luma', dur: 197, art: ['#fbd786', '#f7797d'] },
    { t: 'Northbound', a: 'Atlas Echo', dur: 231, art: ['#4568dc', '#b06ab3'] },
    { t: 'Golden Hour Drive', a: 'Sunset Club', dur: 205, art: ['#f12711', '#f5af19'] },
    { t: 'Satellite Hearts', a: 'Kite Lines', dur: 262, art: ['#00c6ff', '#0072ff'] },
  ],
  podcasts: [
    { t: 'The Commute · Ep. 142', a: 'Daily Drive Show', dur: 1830, art: ['#8e2de2', '#4a00e0'] },
    { t: 'Shipping Small, Shipping Often', a: 'Bobworks Radio', dur: 2640, art: ['#11998e', '#38ef7d'] },
    { t: 'The Year Without a Summer', a: 'Five-Minute History', dur: 312, art: ['#c94b4b', '#4b134f'] },
    { t: 'Chips, Batteries & Cars', a: 'Signal & Noise', dur: 2210, art: ['#232526', '#66a6ff'] },
  ],
  radio: [
    { t: 'KQED 88.5 FM', a: 'Public Radio', live: true, art: ['#e52d27', '#b31217'] },
    { t: 'Hits 99.7', a: 'Top 40', live: true, art: ['#ff512f', '#dd2476'] },
    { t: 'Jazz 91.1', a: 'Smooth Jazz', live: true, art: ['#3a1c71', '#ffaf7b'] },
    { t: 'News 740 AM', a: 'News & Traffic', live: true, art: ['#1e3c72', '#2a5298'] },
  ],
};
const SRC_NAME = { music: 'Music', podcasts: 'Podcasts', radio: 'Radio' };
const SRC_ICON = { music: 'music', podcasts: 'podcasts', radio: 'radio' };
const player = { source: 'music', idx: 0, pos: 37, playing: false, shuffle: false, repeat: false };
const curTrack = () => LIB[player.source][player.idx];

function setSource(src) { player.source = src; player.idx = 0; player.pos = 0; updatePlayerUI(); }
function playTrack(i) { player.idx = i; player.pos = 0; player.playing = true; updatePlayerUI(); }
function playerAction(a) {
  const n = LIB[player.source].length;
  if (a === 'toggle') player.playing = !player.playing;
  else if (a === 'next') { player.idx = player.shuffle ? Math.floor(Math.random() * n) : (player.idx + 1) % n; player.pos = 0; }
  else if (a === 'prev') { if (player.pos > 3 && !curTrack().live) player.pos = 0; else { player.idx = (player.idx - 1 + n) % n; player.pos = 0; } }
  else if (a === 'shuffle') player.shuffle = !player.shuffle;
  else if (a === 'repeat') player.repeat = !player.repeat;
  updatePlayerUI();
}
function artStyle(t) { return `--a:${t.art[0]};--b:${t.art[1]}`; }
function updatePlayerUI() {
  const t = curTrack();
  $$('[data-np=title]').forEach(e => e.textContent = t.t);
  $$('[data-np=artist]').forEach(e => e.textContent = t.live ? `${t.a} · Live` : t.a);
  $$('[data-np=source]').forEach(e => e.textContent = SRC_NAME[player.source]);
  $$('[data-np=art]').forEach(e => { e.style.cssText = artStyle(t); e.innerHTML = svg(SRC_ICON[player.source]); });
  $$('[data-np=barwrap]').forEach(e => e.classList.toggle('live', !!t.live));
  $$('[data-player=toggle]').forEach(b => b.innerHTML = svg(player.playing ? 'pause' : 'play'));
  $$('[data-player=prev]').forEach(b => b.innerHTML = svg('prev'));
  $$('[data-player=next]').forEach(b => b.innerHTML = svg('next'));
  $$('[data-player=shuffle]').forEach(b => { b.innerHTML = svg('shuffle'); b.classList.toggle('on', player.shuffle); });
  $$('[data-player=repeat]').forEach(b => { b.innerHTML = svg('repeat'); b.classList.toggle('on', player.repeat); });
  $$('#musicSeg button').forEach(b => b.classList.toggle('on', b.dataset.src === player.source));
  $('#queueTitle').textContent = player.source === 'radio' ? 'Stations' : player.source === 'podcasts' ? 'Episodes' : 'Up Next';
  $('#queue').classList.toggle('paused', !player.playing);
  $('#queue').innerHTML = LIB[player.source].map((x, i) => `<button class="row ${i === player.idx ? 'cur' : ''}" data-track="${i}">
    <div class="art" style="${artStyle(x)}">${svg(SRC_ICON[player.source])}</div>
    <div class="main"><div class="t">${esc(x.t)}</div><div class="s">${esc(x.a)}</div></div>
    <div class="meta">${i === player.idx && player.playing ? '<div class="eq"><i></i><i></i><i></i></div>' : x.live ? 'LIVE' : fmtDur(x.dur)}</div></button>`).join('');
  updateProgress();
}
function updateProgress() {
  const t = curTrack(), f = t.live ? 1 : Math.min(1, player.pos / t.dur);
  $$('[data-np=bar]').forEach(e => e.style.width = (f * 100) + '%');
  $$('[data-np=elapsed]').forEach(e => e.textContent = t.live ? 'LIVE' : fmtDur(player.pos));
  $$('[data-np=remain]').forEach(e => e.textContent = t.live ? '' : '-' + fmtDur(t.dur - player.pos));
}
function playerTick() {
  if (!player.playing) return;
  player.pos++;
  const t = curTrack();
  if (!t.live && player.pos >= t.dur) { if (player.repeat) player.pos = 0; else playerAction('next'); return; }
  updateProgress();
}

/* ============================================================
   Phone
   ============================================================ */
const CONTACTS = [
  { id: 'mom', n: 'Mom', c: '#ff375f', num: '(415) 555-0101', fav: true },
  { id: 'alex', n: 'Alex Rivera', c: '#ff9f0a', num: '(415) 555-0132', fav: true },
  { id: 'priya', n: 'Priya Shah', c: '#bf5af2', num: '(628) 555-0177', fav: true },
  { id: 'jordan', n: 'Jordan Lee', c: '#0a84ff', num: '(510) 555-0144', fav: true },
  { id: 'sam', n: 'Sam Carter', c: '#30d158', num: '(415) 555-0190' },
  { id: 'taylor', n: 'Taylor Kim', c: '#40c8e0', num: '(650) 555-0122' },
  { id: 'chris', n: 'Chris Morgan', c: '#e0a800', num: '(415) 555-0168' },
  { id: 'dana', n: 'Dana Whitfield', c: '#ac8e68', num: '(408) 555-0155' },
];
const contact = id => CONTACTS.find(c => c.id === id);
const initials = n => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (c, size = '') => `<div class="avatar ${size}" style="--c:${c.c}">${esc(initials(c.n))}</div>`;
const RECENT_CALLS = [
  { id: 'alex', type: 'incoming', when: '10:24 AM' }, { id: 'mom', type: 'missed', when: '9:02 AM' },
  { id: 'jordan', type: 'outgoing', when: 'Yesterday' }, { id: 'priya', type: 'outgoing', when: 'Yesterday' },
  { id: 'taylor', type: 'missed', when: 'Monday' }, { id: 'sam', type: 'incoming', when: 'Monday' },
];
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
let phoneTab = 'favorites', dialed = '';

function renderPhone() {
  $$('#phoneSeg button').forEach(b => b.classList.toggle('on', b.dataset.tab === phoneTab));
  const body = $('#phoneBody');
  if (phoneTab === 'favorites') {
    body.innerHTML = `<div class="fav-grid">${CONTACTS.filter(c => c.fav).map(c =>
      `<button class="fav" data-call="${c.id}">${avatar(c, 'lg')}<div class="t">${esc(c.n.split(' ')[0])}</div><div class="s">mobile</div></button>`).join('')}</div>`;
  } else if (phoneTab === 'recents') {
    body.innerHTML = `<div class="list" style="--inset:84px">${RECENT_CALLS.map(r => { const c = contact(r.id);
      return `<button class="row ${r.type === 'missed' ? 'missed' : ''}" data-call="${c.id}">${avatar(c)}<div class="main"><div class="t">${esc(c.n)}</div>
        <div class="s">${svg(r.type === 'outgoing' ? 'callOut' : 'callIn')}${r.type[0].toUpperCase() + r.type.slice(1)} · mobile</div></div><div class="meta">${r.when}</div></button>`; }).join('')}</div>`;
  } else if (phoneTab === 'contacts') {
    body.innerHTML = `<div class="list" style="--inset:84px">${[...CONTACTS].sort((a, b) => a.n.localeCompare(b.n)).map(c =>
      `<button class="row" data-call="${c.id}">${avatar(c)}<div class="main"><div class="t">${esc(c.n)}</div><div class="s">${c.num}</div></div><span style="color:var(--green)">${svg('phone')}</span></button>`).join('')}</div>`;
  } else {
    body.innerHTML = `<div class="keypad-wrap">
      <div class="keypad">${KEYS.map(([d, l]) => `<button class="key" data-key="${d}"><b>${d}</b><small>${l}</small></button>`).join('')}</div>
      <div class="dial-side"><div class="dial-display">${esc(dialed) || '<span style="color:var(--text-3)">Enter number</span>'}</div>
        <div class="dial-actions"><button class="call-btn" data-action="dial" aria-label="Call">${svg('phone')}</button>
        <button class="icon-btn" data-action="delDigit" aria-label="Delete" ${dialed ? '' : 'style="visibility:hidden"'}>${svg('del')}</button></div></div></div>`;
  }
}

/* In production this hands off via a tel: link; the prototype simulates the call UI. */
let call = null;
function openCall(c) {
  if (!c) return;
  closeAssistant();
  clearInterval(call?.timer);
  call = { c, start: null, muted: false, speaker: false };
  call.timer = setInterval(renderCall, 1000);
  setTimeout(() => { if (call && call.c === c) { call.start = Date.now(); renderCall(); } }, 2200);
  $('#callScreen').hidden = false; renderCall();
}
function renderCall() {
  if (!call) return;
  const act = (a, ic, label, on) => `<button class="call-act ${on ? 'on' : ''} ${a === 'endCall' ? 'end' : ''}" data-action="${a}"><i>${svg(ic)}</i>${label}</button>`;
  $('#callScreen').innerHTML = `${avatar(call.c)}<div class="call-name">${esc(call.c.n)}</div>
    <div class="call-status">${call.start ? fmtDur((Date.now() - call.start) / 1000) : 'calling mobile…'}</div>
    <div class="call-actions">${act('mute', 'mute', 'mute', call.muted)}${act('noop', 'keypad', 'keypad')}${act('speaker', 'speaker', 'audio', call.speaker)}${act('endCall', 'phone', 'end')}</div>`;
  $('.call-act.end svg', $('#callScreen')).style.transform = 'rotate(135deg)';
}
function endCall() { if (!call) return; clearInterval(call.timer); const d = call.start; call = null; $('#callScreen').hidden = true; toast(d ? 'Call ended · ' + fmtDur((Date.now() - d) / 1000) : 'Call cancelled'); }

/* ============================================================
   Messages
   ============================================================ */
const THREADS = [
  { id: 'alex', when: '9:32 AM', unread: true, msgs: [{ me: false, t: 'Grabbing coffee before the review' }, { me: true, t: 'Nice, see you there' }, { me: false, t: 'Running about 10 min late, can you grab us a table?' }] },
  { id: 'priya', when: '8:47 AM', unread: true, msgs: [{ me: false, t: 'Can you pick up oat milk on the way home? 🥛' }] },
  { id: 'jordan', when: 'Yesterday', unread: false, msgs: [{ me: true, t: 'Sent you the deck' }, { me: false, t: 'Looks great. Let’s ship it 🚀' }] },
  { id: 'mom', when: 'Monday', unread: false, msgs: [{ me: false, t: 'Dinner Sunday at 6? Bring the kids!' }] },
];
let activeThread = null, lastHidden = null;
const drivingHidden = () => settings.hideWhileDriving && loc.speed > 2.2;
const QUICK = ['On my way', 'Running 5 min late', 'Can’t talk, driving', 'Call you soon'];

function renderMessages() {
  $('#msgList').innerHTML = THREADS.map(th => { const c = contact(th.id), last = th.msgs.at(-1);
    return `<button class="row ${activeThread === th.id ? 'sel' : ''}" data-thread="${th.id}">${avatar(c)}
      <div class="main"><div class="t">${esc(c.n)}</div><div class="s">${drivingHidden() ? (th.unread ? 'New message · tap to listen' : 'Tap to listen') : esc((last.me ? 'You: ' : '') + last.t)}</div></div>
      <div class="meta">${th.when}${th.unread ? '<i class="dot"></i>' : ''}</div></button>`; }).join('');
  $('#msgSplit').classList.toggle('has-thread', !!activeThread);
  renderThread(); updateBadges();
  lastHidden = drivingHidden();
}
function renderThread() {
  const d = $('#msgDetail'), th = THREADS.find(t => t.id === activeThread);
  if (!th) { d.innerHTML = `<div class="empty">${svg('messages')}Select a conversation</div>`; return; }
  const c = contact(th.id), hidden = drivingHidden();
  const quick = nav ? ['Share my ETA', ...QUICK] : QUICK;
  d.innerHTML = `<div class="thread-head"><button class="icon-btn back" data-action="closeThread" aria-label="Back">${svg('back')}</button>${avatar(c, 'sm')}<div class="t">${esc(c.n)}</div></div>
    <div class="bubbles scroll" id="bubbles">${hidden
      ? `<div class="hidden-note">${svg('speaker')}<div>Message text is hidden while driving.<br>Tap <b>Listen</b> to hear it.</div></div>`
      : th.msgs.map(m => `<div class="bubble ${m.me ? 'me' : ''}">${esc(m.t)}</div>`).join('')}</div>
    <div class="quick">${quick.map(q => `<button class="chip" data-reply="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="thread-actions"><button class="big-btn accent" data-action="listen">${svg('speaker')}Listen</button><button class="big-btn green" data-call="${c.id}">${svg('phone')}Call</button></div>`;
  const b = $('#bubbles'); b.scrollTop = b.scrollHeight;
}
function openThread(id, listen) {
  activeThread = id;
  const th = THREADS.find(t => t.id === id);
  if (listen || (drivingHidden() && settings.readAloud)) readThread(th);
  else { th.unread = false; }
  renderMessages();
}
function readThread(th) {
  const c = contact(th.id), incoming = th.msgs.filter(m => !m.me).slice(-2).map(m => m.t).join('. ');
  speak(`${c.n} said: ${incoming}`);
  th.unread = false; updateBadges();
}
function sendReply(text) {
  const th = THREADS.find(t => t.id === activeThread); if (!th) return;
  if (text === 'Share my ETA' && nav) text = `On my way — arriving around ${$('#etaArr').textContent} (${$('#etaMin').textContent} min)`;
  th.msgs.push({ me: true, t: text }); th.when = fmtClock(new Date());
  renderMessages(); toast(`Sent to ${contact(th.id).n}`);
}
function updateBadges() {
  const n = THREADS.filter(t => t.unread).length;
  $$('[data-badge]').forEach(b => { b.textContent = n; b.hidden = !n; });
}
listeners.push(() => { if (current === 'messages' && drivingHidden() !== lastHidden) renderMessages(); });

/* ============================================================
   Weather (Open-Meteo, no API key; falls back to sample data)
   ============================================================ */
let wx = null, wxAt = 0, wxLoc = null, wxBusy = false;
function wxInfo(code) {
  if (code === 0) return ['Clear', 'sun'];
  if (code <= 2) return [code === 1 ? 'Mostly Clear' : 'Partly Cloudy', 'partly'];
  if (code === 3) return ['Cloudy', 'cloud'];
  if (code === 45 || code === 48) return ['Fog', 'fog'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['Snow', 'snow'];
  if (code >= 95) return ['Thunderstorms', 'storm'];
  if (code >= 51) return [code >= 80 ? 'Showers' : code <= 57 ? 'Drizzle' : 'Rain', 'rain'];
  return ['—', 'cloud'];
}
function mockWeather() {
  const cv = f => imperial() ? f : (f - 32) * 5 / 9, now = new Date(); now.setMinutes(0, 0, 0);
  const codes = [2, 2, 1, 0, 0, 1, 2, 3, 3, 2];
  return { live: false, units: settings.units,
    cur: { temp: cv(68), feels: cv(67), code: 2, wind: imperial() ? 8 : 13, hum: 62 },
    hourly: codes.map((code, i) => ({ t: new Date(+now + i * 3600e3), temp: cv(68 + Math.round(Math.sin(i / 3) * 4)), code })),
    daily: [[72, 58, 2, 5], [75, 59, 0, 0], [70, 57, 3, 20], [64, 55, 61, 70], [67, 54, 2, 10], [71, 56, 1, 0]].map(([hi, lo, code, pop], i) =>
      ({ t: new Date(+now + i * 864e5), hi: cv(hi), lo: cv(lo), code, pop })) };
}
async function loadWeather(force) {
  const fresh = wx && Date.now() - wxAt < 15 * 60e3 && wxLoc && haversine(wxLoc, loc) < 10000 && wx.units === settings.units;
  if (fresh && !force) { renderWeather(); return; }
  if (!wx) { wx = mockWeather(); renderWeather(); }
  if (wxBusy) return;
  wxBusy = true;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(3)}&longitude=${loc.lon.toFixed(3)}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&hourly=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=6` +
      (imperial() ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const j = await r.json(), cur = j.current, hour = cur.time.slice(0, 13);
    const ci = Math.max(0, j.hourly.time.findIndex(t => t.slice(0, 13) === hour));
    wx = { live: true, units: settings.units,
      cur: { temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, wind: cur.wind_speed_10m, hum: cur.relative_humidity_2m },
      hourly: j.hourly.time.slice(ci, ci + 12).map((t, i) => ({ t: new Date(t), temp: j.hourly.temperature_2m[ci + i], code: j.hourly.weather_code[ci + i] })),
      daily: j.daily.time.map((t, i) => ({ t: new Date(t + 'T12:00'), hi: j.daily.temperature_2m_max[i], lo: j.daily.temperature_2m_min[i],
        code: j.daily.weather_code[i], pop: j.daily.precipitation_probability_max[i] })) };
    wxAt = Date.now(); wxLoc = { lat: loc.lat, lon: loc.lon };
  } catch { wx = mockWeather(); wxAt = Date.now(); wxLoc = { lat: loc.lat, lon: loc.lon }; }
  wxBusy = false;
  renderWeather(); renderDashTiles();
}
function renderWeather() {
  if (!wx) return;
  const [label, icon] = wxInfo(wx.cur.code), r = Math.round, today = wx.daily[0];
  const min = Math.min(...wx.daily.map(d => d.lo)), max = Math.max(...wx.daily.map(d => d.hi)), span = Math.max(1, max - min);
  $('#wxUpdated').textContent = wx.live ? 'Live · Open-Meteo' : 'Sample data (offline)';
  $('#wxBody').innerHTML = `
    <div class="wx-now">
      <div class="wx-place">${svg('locate')}${loc.source === 'demo' ? 'San Francisco' : 'My Location'}</div>
      <div class="wx-temp">${r(wx.cur.temp)}°</div>
      <div class="wx-cond">${svg(icon)}${label}</div>
      <div class="wx-hl">H:${r(today.hi)}°  L:${r(today.lo)}°</div>
      <div class="wx-stats"><div><span>Feels like</span><b>${r(wx.cur.feels)}°</b></div><div><span>Wind</span><b>${r(wx.cur.wind)} ${imperial() ? 'mph' : 'km/h'}</b></div><div><span>Humidity</span><b>${r(wx.cur.hum)}%</b></div></div>
    </div>
    <div class="wx-side">
      <div class="panel"><div class="panel-title">Hourly</div><div class="hourly">${wx.hourly.map((h, i) =>
        `<div class="hour"><span>${i ? h.t.toLocaleTimeString([], { hour: 'numeric' }) : 'Now'}</span>${svg(wxInfo(h.code)[1])}${r(h.temp)}°</div>`).join('')}</div></div>
      <div class="panel daily scroll"><div class="panel-title">${wx.daily.length}-day forecast</div>${wx.daily.map((d, i) =>
        `<div class="day"><span>${i ? d.t.toLocaleDateString([], { weekday: 'short' }) : 'Today'}</span>${svg(wxInfo(d.code)[1])}<span class="lo">${r(d.lo)}°</span>
         <div class="range"><i style="left:${(d.lo - min) / span * 100}%;right:${100 - (d.hi - min) / span * 100}%"></i></div><span>${r(d.hi)}°</span></div>`).join('')}</div>
    </div>`;
}

/* ============================================================
   Calendar & dashboard tiles
   ============================================================ */
const EVENTS = (() => {
  const at = mins => { const d = new Date(Date.now() + mins * 60e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d; };
  return [
    { title: 'Design review', at: at(40), dur: 45, loc: 'Bobworks HQ', dest: 'work', color: '#0a84ff', contact: 'alex' },
    { title: 'Lunch with Sam', at: at(180), dur: 60, loc: 'Blue Bottle Coffee', dest: 'coffee', color: '#30d158', contact: 'sam' },
    { title: 'Workout', at: at(330), dur: 60, loc: 'Equinox', dest: 'gym', color: '#ff375f' },
    { title: 'Dinner at home', at: at(480), dur: 90, loc: 'Home', dest: 'home', color: '#ff9f0a', contact: 'priya' },
  ];
})();
const relTime = d => { const m = Math.round((d - Date.now()) / 60e3); return m <= 0 ? 'Now' : m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`; };

function renderCalendar() {
  $('#calDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  $('#calList').innerHTML = EVENTS.map(e => `<div class="event"><div class="ev-bar" style="background:${e.color}"></div>
    <div class="ev-time"><b>${fmtClock(e.at)}</b><span class="${e.at - Date.now() < 3600e3 ? 'soon' : ''}">${relTime(e.at)}</span></div>
    <div class="main"><div class="t">${esc(e.title)}</div><div class="s">${svg('pin')}${esc(e.loc)} · ${e.dur} min</div></div>
    ${e.contact ? `<button class="round-btn" data-call="${e.contact}" aria-label="Call">${svg('phone')}</button>` : ''}
    <button class="go-btn" data-go="${e.dest}">${svg('maps')}Go</button></div>`).join('');
}
function renderDashTiles() {
  const w = wx || mockWeather(), [label, icon] = wxInfo(w.cur.code);
  $('#dashWeather').innerHTML = `<div class="k">${svg('weather')}Weather</div><div class="big">${svg(icon)}${Math.round(w.cur.temp)}°</div><div class="s">${label} · H:${Math.round(w.daily[0].hi)}° L:${Math.round(w.daily[0].lo)}°</div>`;
  const e = EVENTS.find(x => x.at > Date.now() - 15 * 60e3) || EVENTS[0];
  $('#dashEvent').innerHTML = `<div class="k">${svg('calendar')}${fmtClock(e.at)} · ${relTime(e.at)}</div><div class="t">${esc(e.title)}</div><span class="go-inline" data-go="${e.dest}">${svg('maps')}Go</span>`;
}

/* ============================================================
   Drive (trip computer)
   ============================================================ */
function updateDrive() {
  const v = speedVal(loc.speed), scale = imperial() ? 100 : 160, over = settings.speedLimit && v > limitVal();
  $('#gVal').setAttribute('stroke-dasharray', `${Math.min(1, v / scale) * 405.3} 540.4`);
  $('#gaugeLimit').textContent = settings.speedLimit ? `Limit ${limitVal()}` : '';
  $('#gaugeLimit').hidden = !settings.speedLimit;
  $('#gaugeLimit').classList.toggle('over', over);
  const h = loc.heading || 0;
  $('#needle').style.transform = `rotate(${h}deg)`;
  $('#dHeading').textContent = loc.source === 'none' ? '—' : `${Math.round(h)}° ${cardinal(h)}`;
  $('#dTrip').textContent = distStr(trip.dist).replace(/^(50|10) (ft|m)$/, trip.dist < 5 ? '0 $2' : '$&');
  $('#dTime').textContent = fmtDur((Date.now() - trip.start) / 1000);
  $('#dAvg').textContent = `${speedVal(trip.moving ? trip.dist / trip.moving : 0)} ${speedUnit()}`;
  $('#dMax').textContent = `${speedVal(trip.max)} ${speedUnit()}`;
  $('#dAlt').textContent = loc.alt == null ? '—' : imperial() ? `${Math.round(loc.alt * 3.28084)} ft` : `${Math.round(loc.alt)} m`;
  $('#dAcc').textContent = loc.acc == null ? '—' : `±${Math.round(loc.acc)} m`;
  $('#dCoord').textContent = loc.source === 'none' ? '—' : `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`;
  const src = { gps: ['var(--green)', 'Device GPS'], demo: ['var(--orange)', 'Demo drive'], none: ['var(--text-3)', 'No location'] }[loc.source];
  $('#srcChip').innerHTML = `<i class="gps-dot" style="background:${src[0]}"></i>${src[1]}`;
}
listeners.push(updateDrive);

/* ============================================================
   Settings
   ============================================================ */
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
function renderSettings() {
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${k}:${v}" class="${settings[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tog = (k, t, s = '') => `<div class="row"><div class="main"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div><button class="switch ${settings[k] ? 'on' : ''}" data-toggle="${k}" role="switch" aria-checked="${!!settings[k]}" aria-label="${t}"></button></div>`;
  const btn = (a, t, v = '') => `<button class="row btn" data-action="${a}"><div class="main"><div class="t">${t}</div></div><span class="val">${v}</span></button>`;
  const srcLabel = { gps: 'Device GPS', demo: 'Demo drive', none: 'Off' }[loc.source];
  $('#settingsBody').innerHTML = `
    <div class="group-title">Display</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Appearance</div></div>${seg('theme', [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}</div>
      <div class="row"><div class="main"><div class="t">Wallpaper</div></div><div class="swatches">${WALLS.map((w, i) =>
        `<button class="swatch ${settings.wallpaper === i ? 'on' : ''}" data-wall="${i}" style="background:${w[resolvedTheme()]}" aria-label="Wallpaper ${i + 1}"></button>`).join('')}</div></div>
    </div>
    <div class="group-title">Driving</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Units</div></div>${seg('units', [['imperial', 'mph · mi'], ['metric', 'km/h · km']])}</div>
      ${tog('speedLimit', 'Show speed limit')}
      ${tog('voice', 'Spoken navigation')}
      ${tog('hideWhileDriving', 'Hide message text while driving', 'Messages are read aloud instead')}
      ${tog('readAloud', 'Auto-read messages when opened while driving')}
    </div>
    <div class="group-title">Location</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Source</div></div><span class="val">${srcLabel}</span></div>
      ${btn('gps', 'Use device GPS')}
      ${loc.source === 'demo' ? btn('stopdemo', 'Stop demo drive') : btn('demo', 'Start demo drive', 'Simulated route')}
    </div>
    <div class="group-title">System</div>
    <div class="group">
      ${tog('wakeLock', 'Keep screen awake', 'wakeLock' in navigator ? 'Uses the Screen Wake Lock API' : 'Not supported in this browser')}
      ${btn('fullscreen', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen')}
      ${deferredInstall ? btn('install', 'Install app') : ''}
      <div class="row"><div class="main"><div class="t">DriveDeck</div></div><span class="val">Prototype v0.1</span></div>
    </div>`;
}

/* ============================================================
   Voice assistant
   ============================================================ */
let rec = null;
function setAsst(text, hint = '') { $('#asstText').textContent = text; $('#asstHint').textContent = hint; }
function openAssistant() {
  $('#assistant').hidden = false;
  setAsst('What can I help with?');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#asstHint').textContent = 'Voice input isn’t supported in this browser — tap a suggestion.'; return; }
  try {
    rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
    rec.onresult = e => {
      const text = [...e.results].map(r => r[0].transcript).join(' ');
      $('#asstText').textContent = `“${text}”`;
      if (e.results[e.results.length - 1].isFinal) { rec = null; setTimeout(() => handleCommand(text), 350); }
    };
    rec.onerror = () => { $('#asstHint').textContent = 'Couldn’t hear you — tap a suggestion.'; };
    rec.start();
    $('#asstHint').textContent = 'Listening…';
  } catch { $('#asstHint').textContent = 'Tap a suggestion.'; }
}
function closeAssistant() { try { rec?.abort(); } catch {} rec = null; $('#assistant').hidden = true; }
function handleCommand(raw) {
  const t = raw.toLowerCase();
  $('#assistant').hidden = false;
  const reply = (msg, then) => { setAsst(msg); speak(msg); setTimeout(() => { closeAssistant(); then?.(); }, 1300); };
  let m;
  if (/\b(home|work)\b/.test(t) && /(take|navigate|directions|go|drive|route|get)/.test(t)) {
    const id = /work/.test(t) ? 'work' : 'home';
    reply(`Getting directions to ${id === 'home' ? 'Home' : 'Work'}.`, () => startNav(destinations().find(d => d.id === id)));
  } else if ((m = t.match(/(gas|fuel|parking|charg|coffee|food|restaurant)/))) {
    const cat = { gas: 'Gas', fuel: 'Gas', parking: 'Parking', charg: 'EV Chargers', coffee: 'Coffee', food: 'Food', restaurant: 'Food' }[m[1]];
    reply(`Here’s ${cat.toLowerCase()} nearby.`, () => { panel.mode = 'category'; panel.cat = cat; panel.collapsed = false; openView('maps'); renderMapPanel(); });
  } else if (/\b(pause|stop)\b/.test(t)) {
    player.playing = false; updatePlayerUI(); reply('Paused.');
  } else if (/\b(next|skip)\b/.test(t)) {
    playerAction('next'); reply(`Playing ${curTrack().t}.`);
  } else if (/\b(play|music|song|podcast|radio|listen to)\b/.test(t)) {
    const src = /podcast/.test(t) ? 'podcasts' : /radio/.test(t) ? 'radio' : player.source;
    if (src !== player.source) setSource(src);
    player.playing = true; updatePlayerUI();
    reply(`Playing ${curTrack().t} by ${curTrack().a}.`, () => openView('music'));
  } else if ((m = t.match(/call\s+(.+)/))) {
    const q = m[1].trim().replace(/[.?!]$/, ''), c = CONTACTS.find(c => c.n.toLowerCase().split(' ').some(w => q.includes(w)));
    c ? reply(`Calling ${c.n}.`, () => openCall(c)) : reply(`I couldn’t find “${q}” in your contacts.`);
  } else if (/(read|message|text)/.test(t)) {
    const th = THREADS.find(x => x.unread) || THREADS[0];
    closeAssistant(); openView('messages'); openThread(th.id, true);
  } else if (/(weather|temperature|rain|forecast)/.test(t)) {
    const w = wx || mockWeather();
    reply(`It’s ${Math.round(w.cur.temp)} degrees and ${wxInfo(w.cur.code)[0].toLowerCase()}.`, () => openView('weather'));
  } else reply('Sorry, I didn’t catch that.');
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.03;
    speechSynthesis.speak(u);
  } catch {}
}

/* ============================================================
   System: notifications, toast, wake lock, full screen
   ============================================================ */
function notify({ app, title, body, onTap }) {
  const a = appById(app), b = $('#banner');
  b.innerHTML = `${appIcon(a)}<div class="main"><div class="t">${esc(title)}</div><div class="s">${esc(body)}</div></div>`;
  b.onclick = () => { b.classList.remove('show'); onTap?.(); };
  b.classList.add('show');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('show'), 6500);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
}
let wakeLock = null;
async function syncWakeLock() {
  try {
    if (settings.wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', syncWakeLock);
async function toggleFullscreen() {
  try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen(); }
  catch { toast('Full screen not available'); }
  setTimeout(renderSettings, 200);
}
function simulateIncomingMessage() {
  const th = { id: 'sam', when: fmtClock(new Date()), unread: true, msgs: [{ me: false, t: 'Are we still on for lunch? I can grab a table.' }] };
  THREADS.unshift(th); updateBadges();
  if (current === 'messages') renderMessages();
  notify({ app: 'messages', title: 'Sam Carter', body: drivingHidden() ? 'New message · tap to listen' : th.msgs[0].t,
    onTap: () => { openView('messages'); openThread('sam', true); } });
  if (settings.readAloud) speak('New message from Sam Carter.');
}

/* ============================================================
   Input: one delegated click handler for the whole UI
   ============================================================ */
const ACTIONS = {
  noop() {}, home: homeButton, assistant: openAssistant, closeAssistant,
  gps: () => { startGPS(); if (current === 'settings') setTimeout(renderSettings, 50); },
  demo: () => { startDemo(); toast('Demo drive started'); if (current === 'settings') renderSettings(); },
  stopdemo: () => { stopDemo(true); if (current === 'settings') renderSettings(); },
  where: () => { panel.mode = 'home'; panel.collapsed = false; openView('maps'); setTimeout(() => $('#mapSearch')?.focus(), 300); },
  zoomIn: () => maps.main.map?.zoomIn(), zoomOut: () => maps.main.map?.zoomOut(), recenter: recenterAll,
  endNav: () => { endNav(); toast('Route ended'); },
  endCall, mute: () => { call.muted = !call.muted; renderCall(); }, speaker: () => { call.speaker = !call.speaker; renderCall(); },
  dial: () => { if (!dialed) return; openCall({ n: dialed, c: '#8e8e93' }); dialed = ''; renderPhone(); },
  delDigit: () => { dialed = dialed.slice(0, -1); renderPhone(); },
  listen: () => { const th = THREADS.find(t => t.id === activeThread); if (th) { readThread(th); renderMessages(); } },
  closeThread: () => { activeThread = null; renderMessages(); },
  tripReset: () => { Object.assign(trip, { dist: 0, moving: 0, max: 0, start: Date.now() }); updateDrive(); toast('Trip reset'); },
  fullscreen: toggleFullscreen,
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; renderSettings(); },
};
const CLICK = {
  action: v => ACTIONS[v]?.(),
  cmd: v => handleCommand(v),
  app: v => { closeAssistant(); openApp(v); },
  open: v => openView(v),
  go: v => startNav(destinations().find(d => d.id === v)),
  call: v => openCall(contact(v)),
  player: v => playerAction(v),
  src: v => setSource(v),
  track: v => playTrack(+v),
  tab: v => { phoneTab = v; renderPhone(); },
  key: v => { if (dialed.length < 18) dialed += v; renderPhone(); },
  thread: v => openThread(v),
  reply: v => sendReply(v),
  cat: v => { panel.mode = 'category'; panel.cat = v; panel.collapsed = false; renderMapPanel(); },
  panel: v => { if (v === 'back') { panel.mode = 'home'; renderMapPanel(); } else { panel.collapsed = !panel.collapsed; renderMapPanel(); } },
  dest: v => startNav(panelItems[+v]),
  set: v => { const [k, val] = v.split(':'); settings[k] = val; applySettings(); renderSettings(); if (k === 'units') { wx = null; renderDashTiles(); } },
  toggle: v => { settings[v] = !settings[v]; applySettings(); renderSettings(); },
  wall: v => { settings.wallpaper = +v; applySettings(); renderSettings(); },
};
const CLICK_SEL = Object.keys(CLICK).map(k => `[data-${k}]`).join(',');
document.addEventListener('click', e => {
  const t = e.target.closest(CLICK_SEL); if (!t) return;
  for (const k of Object.keys(CLICK)) if (k in t.dataset) { CLICK[k](t.dataset[k]); break; }
});
addEventListener('resize', () => Object.values(maps).forEach(M => M.map?.invalidateSize()));
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') closeAssistant();
  if (e.key === 'h') homeButton();
  if (e.key === 'v') openAssistant();
});

/* ============================================================
   Boot
   ============================================================ */
function tick() {
  $('#dockTime').textContent = fmtClock(new Date()).replace(/\s?[AP]M/i, '');
  playerTick();
  if (current === 'drive') updateDrive();
}
hydrateIcons();
$('#siriBtn').innerHTML = svg('mic');
$('#netIcon').innerHTML = svg('signal');
applySettings(); renderHome(); updatePlayerUI(); renderDashTiles(); renderMessages();
openView('dashboard');
tick(); setInterval(tick, 1000);
emit();

// Resume the last location source; auto-start GPS if permission was already granted.
const lastSrc = store.get('locSource', 'none');
if (lastSrc === 'demo') startDemo();
else navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted' || lastSrc === 'gps') startGPS(); }).catch(() => {});
loadWeather();
setTimeout(simulateIncomingMessage, 25000);

// Review hooks, e.g. prototype.html?demo=1&nav=1 or ?view=music&theme=light
const qs = new URLSearchParams(location.search);
if (qs.get('theme')) { settings.theme = qs.get('theme'); applySettings(); }
if (qs.has('demo')) startDemo();
if (qs.has('nav')) startNav(destinations()[0]);
if (qs.get('view')) openView(qs.get('view'));
if (qs.has('play')) { player.playing = true; updatePlayerUI(); }

// Offline support and installability. Relative URL so the app works from any sub-path.
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
