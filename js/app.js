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
  doc: '<path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5z"/><path d="M14 2.5v5h5M8.5 13h7M8.5 17h5"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 3.8 6 3.8 9.5S14.6 18.7 12 21.5C9.4 18.7 8.2 15.5 8.2 12S9.4 5.3 12 2.5z"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none"/>',
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
  slightRight: '<path d="M9 21v-7.5L17 5.5M11.5 5h6v6"/>',
  slightLeft: '<path d="M15 21v-7.5L7 5.5M12.5 5h-6v6"/>',
  uturn: '<path d="M17 21V9a5 5 0 0 0-10 0v10M3 15l4 4 4-4"/>',
  roundabout: '<circle cx="12" cy="9" r="4.5"/><path d="M12 21v-7.5M16.5 9H21M18.5 6l3 3-3 3"/>',
  merge: '<path d="M7 21v-4l10-10V3M13 7l4-4 4 4"/>',
  cube: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M3.5 7.3L12 12l8.5-4.7M12 12v9.5"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  hud: '<rect x="2.5" y="5" width="19" height="12" rx="2.5"/><path d="M8 21h8M12 17v4M8.5 13l3.5-4 3.5 4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  mirror: '<path d="M12 3v18M9 7L4 12l5 5V7zM15 7l5 5-5 5V7z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  resize: '<path d="M21 13v8h-8M21 21l-7-7M3 11V3h8M3 3l7 7"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 12a3.5 3.5 0 0 1-3 7z"/>',
  rain: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="M8 19h.01M12 19h.01M16 19h.01M10 22h.01M14 22h.01"/>',
  storm: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="M13 15l-2 4h3l-2 4"/>',
  fog: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>',
  partly: '<path d="M8 2.5v1.5M3.2 4.7l1.1 1.1M1.5 9.5H3M12.8 4.7l-1.1 1.1"/><path d="M11.8 9.2A4 4 0 1 0 5.4 12.6"/><path d="M17.5 21H9a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 20.4 15 3 3 0 0 1 17.5 21z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  stage: '<rect x="2.5" y="3.5" width="19" height="12.5" rx="1.5"/><path d="M12 16v4.5M8 20.5h8M7 12l3.5-3.5 2.5 2.5L17 7"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>',
  restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 3.5V9h5.5"/>',
  person: '<circle cx="12" cy="7" r="3.8"/><path d="M4.5 21c.8-4.2 3.8-6.5 7.5-6.5s6.7 2.3 7.5 6.5"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`;
function hydrateIcons(root = document) { $$('[data-icon]', root).forEach(el => { el.outerHTML = svg(el.dataset.icon); }); }

/* ============================================================
   Settings & theme
   ============================================================ */
const settings = Object.assign({
  theme: 'dark', units: 'metric', wallpaper: 0, speedLimit: true, voice: true,
  hideWhileDriving: true, readAloud: true, wakeLock: true,
  router: 'osrm', tomtomKey: '', navMode: 'map', hudMirror: false, terrain: true,
  arYaw: 0, arPitch: 0, arFov: 64, nativeCalls: true, musicApp: 'demo', stt: 'browser', voiceLang: 'auto', tts: 'neural', ttsVoice: 'af_heart', vadSilence: '5', musicShortcut: 'DriveDeck Play', dashLayout: 'cluster', cluster: 'twin', accent: null,
  convo: false, convoGap: '1', convoStt: 'auto', appMode: 'drive', driveCam: 'back', stageCam: 'front', captions: true, detModel: 'yolo', detOn: true, detAR: true, detAlerts: false, detAnswer: true, detFps: '3', detAlertList: null
}, store.get('settings', {}));
// Listening moved to the device's own recognizer (no model to hold in memory); Whisper stays an option. Once, for earlier installs.
if (!store.get('sttNative')) { if (settings.stt === 'whisper') settings.stt = 'browser'; store.set('sttNative', true); store.set('settings', settings); }

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
  syncWakeLock(); restyleMaps(); applyDock();
  $('#app').classList.toggle('seamless', !!settings.seamless);
  store.set('settings', settings);
  if (typeof Stage !== 'undefined') Stage.apply();
}
darkMQ.addEventListener?.('change', () => settings.theme === 'auto' && applySettings());
/** The side dock can slide away so the current screen gets the full width (or height in portrait). */
function applyDock() {
  $('#app').classList.toggle('dock-hidden', !!settings.dockHidden);
  setTimeout(() => { Object.values(maps).forEach(M => M.map?.resize()); if (typeof Dash !== 'undefined') Dash.fitGrid(); }, 320);
}

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
  { id: 'radio', name: 'Radio', icon: 'radio', bg: 'linear-gradient(160deg,#ff8a5c,#e5383b)', run: () => typeof Radio !== 'undefined' && Radio.browse() },
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
  if (a.run) { pushRecent(id); return a.run(); }
  if (a.source && a.source !== player.source) setSource(a.source);
  if (a.category) { panel.mode = 'category'; panel.cat = a.category; panel.collapsed = false; renderMapPanel(); }
  pushRecent(id);
  openView(a.view || a.id, true);
}
function openView(id, fromApp) {
  if (!fromApp && appById(id)) pushRecent(id);
  current = id;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
  Bus.emit('view.open', { value: id });
  renderDock();
  ({
    dashboard: () => { if (typeof Dash !== 'undefined') Dash.show(); },
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
const loc = { lat: 12.9716, lon: 77.5946, speed: 0, heading: 0, alt: null, acc: null, source: 'none', ts: 0 };
const trip = { dist: 0, moving: 0, max: 0, start: Date.now() };
let gpsWatch = null, demo = null, gotFirstFix = false;

// Demo drive: Bengaluru, along MG Road past Trinity Circle onto Old Airport Road. Used when no real route is available.
const DEMO = [[12.9757, 77.6000], [12.9756, 77.6033], [12.9755, 77.6066], [12.9752, 77.6098], [12.9745, 77.6130],
  [12.9737, 77.6160], [12.9729, 77.6190], [12.9716, 77.6215], [12.9700, 77.6250], [12.9680, 77.6300]];
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Launched from the Home Screen (no browser bars) rather than in a browser tab.
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
document.documentElement.classList.toggle('standalone', isStandalone());
function showInstallHelp() {
  if (deferredInstall) return ACTIONS.install();
  const share = '<svg viewBox="0 0 24 24" class="inline-ic" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  sheet('Install DriveDeck', isStandalone()
    ? '<p>DriveDeck is already running as an installed app, full screen with no browser bars.</p>'
    : isIOS
      ? `<ol><li>Open this page in <b>Safari</b>. In another app’s built-in browser, tap its menu and choose <b>Open in Safari</b> first.</li>
         <li>Tap <b>Share</b> ${share}: at the bottom in portrait on iPhone, or at the top on iPad and in landscape.</li>
         <li>Scroll down and tap <b>Add to Home Screen</b>. Not there? Tap <b>Edit Actions…</b> and add it.</li>
         <li>Leave <b>Open as Web App</b> on and tap <b>Add</b>.</li>
         <li>Open <b>DriveDeck</b> from the Home Screen. It runs full screen, without Safari’s bars.</li></ol>`
      : `<ol><li>Open the browser menu (⋮).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Open DriveDeck from the Home screen.</li></ol>`,
    [['Got it']]);
}

function startGPS(quiet) {
  if (!('geolocation' in navigator)) { toast('Geolocation is not supported here'); return; }
  if (!window.isSecureContext) toast('GPS needs HTTPS or localhost');
  stopDemo();
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gotFirstFix = false;
  gpsWatch = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  if (!quiet) toast('Acquiring GPS…');
}
// iPhone can stop delivering positions to a web app after it has been in the background, and may
// ignore a request that isn't tied to a tap: restart on return, and retry on the first tap.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.get('locSource', 'none') === 'gps' && loc.source !== 'demo') startGPS(true);
});
document.addEventListener('pointerdown', () => {
  if (loc.source === 'none' && store.get('locSource', 'none') === 'gps') startGPS(true);
}, { once: true, capture: true });
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
  if (!gotFirstFix) { gotFirstFix = true; toast(`GPS locked · ±${Math.round(c.accuracy)} m`); recenterAll(true); }
  emit();
}
function onPositionError(err) {
  if (err.code === 1) { stopGPS(); loc.source = 'none'; store.set('locSource', 'none'); emit(); showLocationHelp(); return; }
  toast(err.code === 3 ? 'GPS timed out, still trying…' : 'Location unavailable');
}
function showLocationHelp() {
  sheet('Location is blocked', isIOS
    ? `<p>Your iPhone won’t ask again until location is allowed for this site:</p>
       <ol><li>Open <b>Settings › Privacy &amp; Security › Location Services</b> and make sure it’s on.</li>
       <li>Choose <b>Safari Websites</b> (or <b>DriveDeck</b> if you added it to the Home Screen) and pick <b>While Using the App</b> or <b>Ask Next Time</b>.</li>
       <li>Come back and tap <b>Use GPS</b> again.</li></ol>`
    : '<p>Allow location for this site in your browser’s site settings (the icon beside the address), then tap <b>Use GPS</b> again.</p>',
    [['Try demo drive', () => ACTIONS.demo()], ['OK']]);
}

/* Demo drive: follows a path at realistic speeds (the route’s own road speeds while navigating). */
function startDemo(path = DEMO, speeds = null) {
  stopGPS();
  clearInterval(demo?.timer);
  demo = { path, cum: Routing.cumulative(path), speeds, along: 0, timer: setInterval(demoTick, 500) };
  const a = P(path[0]), b = P(path[1] || path[0]);
  Object.assign(loc, a, { speed: 0, heading: bearing(a, b), alt: 12, acc: 5, source: 'demo', ts: Date.now() });
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
  const dt = 0.5, d = demo, end = d.cum.at(-1);
  if (d.along >= end - 0.5) {
    if (nav) { loc.speed = 0; loc.ts = Date.now(); emit(); return; } // hold at the destination until arrival fires
    d.along = 0;
  }
  const base = d.speeds?.[segAt(d.cum, d.along)] || 14;
  const target = Math.min(31, Math.max(4, base)) * (0.92 + Math.sin(Date.now() / 5000) * 0.08);
  d.along = Math.min(end, d.along + target * dt);
  const i = segAt(d.cum, d.along), a = P(d.path[i]), b = P(d.path[Math.min(i + 1, d.path.length - 1)]);
  const len = d.cum[i + 1] - d.cum[i] || 0, t = len ? Math.min(1, (d.along - d.cum[i]) / len) : 0;
  const next = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  addTrip(haversine(loc, next), dt, target);
  Object.assign(loc, next, { speed: target, heading: len > 0.5 ? bearing(a, b) : loc.heading, alt: 12 + Math.sin(Date.now() / 9000) * 6, acc: 5, ts: Date.now() });
  emit();
}
/** Index of the segment that contains distance `along` (binary search over cumulative distances). */
function segAt(cum, along) {
  let lo = 0, hi = cum.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= along) lo = mid; else hi = mid - 1; }
  return lo;
}

function addTrip(d, dt, speed) { trip.dist += d; if (speed > 0.8) trip.moving += dt; trip.max = Math.max(trip.max, speed); }

const listeners = [];
function emit() { listeners.forEach(fn => fn()); }

/* Units */
const imperial = () => settings.units === 'imperial';
const speedVal = ms => Math.round(imperial() ? ms * 2.23694 : ms * 3.6);
const speedUnit = () => imperial() ? 'mph' : 'km/h';
/** Speed limit for the road ahead in display units, or null when unknown. */
function limitVal() {
  const kmh = nav?.view?.limitKmh;
  if (kmh) return imperial() ? Math.round(kmh / 1.609344 / 5) * 5 : Math.round(kmh);
  return loc.source === 'demo' ? (imperial() ? 35 : 50) : null;
}
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
  const v = speedVal(loc.speed), lim = limitVal(), over = settings.speedLimit && lim != null && v > lim;
  $$('[data-speed]').forEach(e => e.textContent = loc.source === 'none' ? '—' : v);
  $$('[data-speed-unit]').forEach(e => e.textContent = speedUnit());
  $$('[data-speed-pill]').forEach(e => e.classList.toggle('over', over));
  $('#gpsDot').className = 'gps-dot ' + (loc.source === 'none' ? '' : loc.source);
  $('#locPrompt').hidden = loc.source !== 'none';
  renderLimit();
}
let shownLimit = '';
function renderLimit() {
  const lim = settings.speedLimit ? limitVal() : null, key = `${lim}${settings.units}`;
  if (key === shownLimit) return;
  shownLimit = key;
  const html = lim == null ? '' : imperial()
    ? `<div class="limit-us"><small>SPEED<br>LIMIT</small><b>${lim}</b></div>`
    : `<div class="limit-eu">${lim}</div>`;
  $$('[data-limit]').forEach(e => e.innerHTML = html);
}
listeners.push(updateSpeedUI);

/* ============================================================
   Maps (MapLibre GL + OpenFreeMap vector tiles: free, no key)
   ============================================================ */
const maps = { main: { follow: true, el: '#mainMap' }, dash: { follow: true, el: '#dashMap' } };
const MAP_STYLE = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const carHtml = '<div class="car-dot"><div class="car-arrow"></div></div>';
const htmlEl = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const offlineStyle = () => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background',
  paint: { 'background-color': resolvedTheme() === 'dark' ? '#16181d' : '#e9e6df' } }] });
let mapMode = settings.navMode === '3d' ? '3d' : 'map'; // how the main map is drawn: flat or tilted 3D
let smoothHeading = 0;

function ensureMap(key) {
  const M = maps[key];
  if (M.map) { requestAnimationFrame(() => M.map.resize()); updateMaps({ force: true, instant: true }); return; }
  if (M.fallback) { updateMaps({ force: true }); return; }
  const el = $(M.el);
  try {
    if (!window.maplibregl) throw new Error('MapLibre not loaded');
    M.styleKey = resolvedTheme();
    M.map = new maplibregl.Map({ container: el, style: MAP_STYLE[M.styleKey], center: [loc.lon, loc.lat], zoom: key === 'main' ? 16 : 15,
      interactive: key === 'main', attributionControl: { compact: true }, maxPitch: 75, fadeDuration: 0, dragRotate: false, pitchWithRotate: false });
  } catch (e) {
    console.warn('Map unavailable', e);
    M.map = null; M.fallback = true; el.classList.add('fallback');
    el.innerHTML = `<div class="fallback-car">${carHtml}</div>`; updateMaps({ force: true }); return;
  }
  M.map.touchZoomRotate?.disableRotation();
  M.map.on('style.load', () => { M.styleReady = true; addOverlays(M); });
  M.map.on('error', e => {
    // Elevation tiles failing mid-drive: drop terrain rather than risk a broken 3D render.
    if (e.sourceId === 'dd-dem') { demState = { ok: false, at: Date.now() }; if (M.map.getTerrain?.()) M.map.setTerrain(null); return; }
    // Style or tiles unreachable (offline with an empty cache): use a plain background so the route still draws.
    if (!M.offline && !M.styleReady) {
      if (!M.triedLight && M.styleKey !== 'light') { M.triedLight = true; M.map.setStyle(MAP_STYLE.light); } // dark style missing: try the light one
      else { M.offline = true; el.classList.add('fallback'); M.map.setStyle(offlineStyle()); }
    }
    console.warn('Map error', e.error?.message || e);
  });
  M.car = new maplibregl.Marker({ element: htmlEl(carHtml), rotationAlignment: 'map', pitchAlignment: 'map' })
    .setLngLat([loc.lon, loc.lat]).addTo(M.map);
  if (key === 'main') M.map.on('dragstart', () => { M.follow = false; $('#recenterBtn').classList.add('on'); });
  updateMaps({ force: true, instant: true });
}
function addOverlays(M) {
  const map = M.map, dark = resolvedTheme() === 'dark', empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['dd-done', 'dd-left']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
  const width = (lo, hi) => ['interpolate', ['linear'], ['zoom'], 12, lo, 18, hi];
  const line = (id, source, color, w) => map.getLayer(id) || map.addLayer({ id, type: 'line', source,
    layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': color, 'line-width': w } });
  line('dd-done', 'dd-done', dark ? '#6b6f78' : '#a3a8b0', width(4, 12));         // driven part of the route
  line('dd-left-casing', 'dd-left', '#0647a8', width(7, 19));                        // remaining part
  line('dd-left', 'dd-left', '#1a8cff', width(4, 12));
  drawRoute(M); apply3D(M);
}
/** Tilt, terrain, 3D buildings and sky for the main map in 3D mode; flat everywhere else. */
function apply3D(M) {
  const map = M.map; if (!map || !M.styleReady) return;
  const on = M === maps.main ? mapMode === '3d' : !!M.threeD, dark = resolvedTheme() === 'dark';
  try {
    if (on && !map.getLayer('dd-buildings') && map.getSource('openmaptiles') && !map.getStyle().layers.some(l => l.type === 'fill-extrusion'))
      map.addLayer({ id: 'dd-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-extrusion-color': dark ? '#2b2f38' : '#d8d3ca', 'fill-extrusion-opacity': 0.9,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } }, 'dd-done');
    if (on && settings.terrain && !M.offline && demReachable() === undefined) probeDem().then(() => apply3D(M));
    if (on && settings.terrain && !M.offline && demReachable()) {
      if (!map.getSource('dd-dem')) map.addSource('dd-dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium',
        tileSize: 256, maxzoom: 14, attribution: 'Elevation: Mapzen, AWS Open Data' });
      map.setTerrain({ source: 'dd-dem', exaggeration: 1.2 });
    } else if (map.getTerrain?.()) map.setTerrain(null);
    if (on) map.setSky(dark
      ? { 'sky-color': '#0a1330', 'horizon-color': '#2a426f', 'fog-color': '#10131a', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35 }
      : { 'sky-color': '#79b2ff', 'horizon-color': '#e4f0ff', 'fog-color': '#eef3fa', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35 });
  } catch (e) { console.warn('3D setup failed', e); }
}
// Terrain only goes on once an elevation tile has actually loaded: MapLibre can crash
// drawing terrain whose tiles all fail (offline, blocked network).
let demState = { ok: undefined, at: 0 };
const demReachable = () => Date.now() - demState.at > 300000 ? undefined : demState.ok;
async function probeDem() {
  if (demState.pending) return demState.pending;
  const z = 12, n = 2 ** z, x = Math.floor((loc.lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(rad(loc.lat)) + 1 / Math.cos(rad(loc.lat))) / Math.PI) / 2 * n);
  demState.pending = fetch(TERRAIN_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y))
    .then(r => r.ok, () => false)
    .then(ok => { demState = { ok, at: Date.now() }; });
  return demState.pending;
}
function restyleMaps() {
  for (const M of Object.values(maps)) {
    if (!M.map || M.styleKey === resolvedTheme()) continue;
    M.styleKey = resolvedTheme(); M.offline = false; M.triedLight = false; M.styleReady = false; $(M.el).classList.remove('fallback');
    M.map.setStyle(MAP_STYLE[M.styleKey]); // 'style.load' re-adds the route layers
  }
}
function setMapMode(mode) {
  mapMode = mode;
  maps.main.follow = true; $('#recenterBtn').classList.remove('on');
  apply3D(maps.main);
  updateMaps({ force: true });
}
const zoomForSpeed = () => { const v = loc.speed || 0; return v < 8 ? 17.3 : v < 18 ? 16.6 : v < 28 ? 15.9 : 15.2; };
function updateMaps(opts = {}) {
  const h = loc.heading || 0;
  smoothHeading += ((h - smoothHeading) % 360 + 540) % 360 - 180; // shortest rotation path
  for (const [key, M] of Object.entries(maps)) {
    if (M.fallback) { const a = $('.car-arrow', $(M.el)); if (a) a.style.transform = `rotate(${smoothHeading}deg)`; continue; }
    if (!M.map) continue;
    M.car.setLngLat([loc.lon, loc.lat]).setRotation(smoothHeading);
    const el = M.map.getContainer();
    if (!M.follow || (loc.source === 'none' && !opts.force) || !el.clientWidth) continue;
    const threeD = key === 'main' ? mapMode === '3d' : !!M.threeD, pad = { top: 0, bottom: 0, left: 0, right: 0 };
    const cam = threeD
      ? { center: [loc.lon, loc.lat], bearing: smoothHeading, pitch: 62, zoom: zoomForSpeed(), padding: { ...pad, top: el.clientHeight * 0.42 } }
      : { center: [loc.lon, loc.lat], bearing: 0, pitch: 0, padding: pad };
    M.map.easeTo({ ...cam, duration: opts.instant ? 0 : 900, easing: t => t, essential: true });
  }
}
function recenterAll(instant) {
  for (const M of Object.values(maps)) { M.follow = true; if (M.map && !(M === maps.main ? mapMode === '3d' : M.threeD)) M.map.setZoom(nav ? 17 : 16); }
  $('#recenterBtn').classList.remove('on');
  updateMaps({ force: true, instant: !!instant });
}
listeners.push(() => updateMaps());

/* ============================================================
   Search panel, saved places and nearby places
   ============================================================ */
const panel = { mode: 'home', q: '', cat: null, collapsed: false };
let panelItems = [], remoteItems = [], remoteFor = '', searchTimer = null;
const CATS = [['Gas', 'fuel', '#ff9f0a'], ['Parking', 'parking', '#0a84ff'], ['EV Chargers', 'bolt', '#30d158'], ['Coffee', 'coffee', '#ac8e68'], ['Food', 'food', '#ff453a']];
// Offline samples, used only when the live nearby search is unreachable.
const POIS = {
  'Gas': ['Indian Oil', 'HP Petrol Pump', 'Bharat Petroleum', 'Shell'],
  'Parking': ['UB City Parking', 'Garuda Mall Parking', 'MG Road Metro Parking', 'Commercial Street Parking'],
  'EV Chargers': ['Tata Power EZ Charge', 'Statiq · 4 chargers', 'ChargeZone Fast Charging', 'Ather Grid'],
  'Coffee': ['Third Wave Coffee', 'Blue Tokai', 'Starbucks', 'Café Coffee Day'],
  'Food': ['MTR', 'Vidyarthi Bhavan', 'Truffles', 'Meghana Foods'],
};
const DEMO_CITY = { lat: 12.9716, lon: 77.5946, name: 'Bengaluru' };
function destinations() {
  const saved = store.get('places', {}), nearCity = haversine(loc, DEMO_CITY) < 30000;
  // Unsaved Home/Work fall back to samples: real Bengaluru spots for the demo drive, else offsets from you.
  const place = (id, name, icon, color, city, dLat, dLon) => saved[id]
    ? { id, name, icon, color, sub: saved[id].sub, lat: saved[id].lat, lon: saved[id].lon }
    : { id, name, icon, color, sub: 'Sample · save yours with ☆ in search', ...(nearCity ? city : { lat: loc.lat + dLat, lon: loc.lon + dLon }) };
  const recent = store.get('recentPlaces', []).map(r => ({ ...r, icon: 'pin', color: '#ff9f0a', sub: r.sub || 'Recent' }));
  return [
    place('home', 'Home', 'house', '#0a84ff', { lat: 12.9719, lon: 77.6412 }, -0.024, -0.009),
    place('work', 'Work', 'briefcase', '#8e5cf7', { lat: 12.9544, lon: 77.6421 }, 0.016, 0.013),
    ...(recent.length ? recent.slice(0, 4) : [
      place('coffee', 'Third Wave Coffee', 'coffee', '#ac8e68', { lat: 12.9784, lon: 77.6408 }, 0.006, -0.004),
      place('gym', 'Cult Gym', 'dumbbell', '#ff375f', { lat: 12.9352, lon: 77.6245 }, -0.009, 0.011),
    ]),
  ];
}
function poisFor(cat) {
  const [, icon, color] = CATS.find(c => c[0] === cat);
  return POIS[cat].map((name, i) => ({ id: cat + i, name, icon, color, sub: 'Sample · offline',
    lat: loc.lat + (i + 1) * 0.0045 * (i % 2 ? 1 : -1), lon: loc.lon + (i + 1) * 0.0055 * (i % 3 ? -1 : 1) }));
}
function rememberPlace(d) {
  if (d.id === 'home' || d.id === 'work') return;
  const r = { id: 'r' + Math.round(d.lat * 1e4) + Math.round(d.lon * 1e4), name: d.name, sub: d.sub, lat: d.lat, lon: d.lon };
  store.set('recentPlaces', [r, ...store.get('recentPlaces', []).filter(x => x.name !== r.name)].slice(0, 5));
}
function savePlace(id, d) {
  const p = store.get('places', {});
  p[id] = { lat: d.lat, lon: d.lon, sub: [d.name, d.sub].filter(Boolean).join(', ') };
  store.set('places', p); toast(`${id === 'home' ? 'Home' : 'Work'} saved`); renderPanelList();
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
  let loading = false;
  if (panel.mode === 'category') {
    const key = 'cat:' + panel.cat;
    if (remoteFor !== key) { remoteFor = key; remoteItems = null; fetchNearby(panel.cat, key); }
    loading = remoteItems === null;
    panelItems = remoteItems?.length ? remoteItems : loading ? [] : poisFor(panel.cat);
  } else {
    const q = panel.q.trim().toLowerCase();
    const local = q ? destinations().filter(d => (d.name + ' ' + d.sub).toLowerCase().includes(q)) : destinations();
    if (q.length >= 3) {
      const key = 'q:' + q;
      if (remoteFor !== key) { remoteFor = key; remoteItems = null; clearTimeout(searchTimer); searchTimer = setTimeout(() => fetchSearch(q, key), 350); }
      loading = remoteItems === null;
    } else { remoteFor = ''; remoteItems = []; }
    panelItems = [...local, ...(remoteItems || [])];
  }
  panelItems.forEach(d => d.dist = haversine(loc, d));
  if (panel.mode === 'category') panelItems.sort((a, b) => a.dist - b.dist);
  const chev = svg('chevDown').replace('<svg', '<svg style="transform:rotate(-90deg);width:18px;height:18px;opacity:.4"');
  list.innerHTML = panelItems.map((d, i) => `<div class="row-wrap"><button class="row" data-dest="${i}">
      <div class="poi-ic" style="background:${d.color}">${svg(d.icon)}</div>
      <div class="main"><div class="t">${esc(d.name)}</div><div class="s">${distStr(d.dist)}${d.sub ? ' · ' + esc(d.sub) : ''}</div></div>${d.remote ? '' : chev}</button>
      ${d.remote ? `<button class="row-act" data-save="${i}" aria-label="Save ${esc(d.name)} as Home or Work">${svg('star')}</button>` : ''}</div>`).join('')
    + (loading ? '<div class="row"><div class="main"><div class="s">Searching…</div></div></div>' : '')
    + (!panelItems.length && !loading ? `<div class="row"><div class="main"><div class="s">No results for “${esc(panel.q || panel.cat)}”</div></div></div>` : '');
}
async function fetchSearch(q, key) {
  let items = [];
  try { items = await Routing.search(q, loc); } catch (e) { console.warn('Search failed', e); if (remoteFor === key) toast('Place search is offline'); }
  if (remoteFor === key) { remoteItems = items; renderPanelList(); }
}
async function fetchNearby(cat, key) {
  const [, icon, color] = CATS.find(c => c[0] === cat);
  let items = [];
  try { items = (await Routing.nearby(cat, loc)).map(p => ({ ...p, icon, color })); } catch (e) { console.warn('Nearby search failed', e); }
  if (remoteFor === key) { remoteItems = items; renderPanelList(); }
}

/* ============================================================
   Turn-by-turn navigation on a real route
   ============================================================ */
let nav = null, navToken = 0;
const routeOpts = () => ({ provider: settings.router, tomtomKey: settings.tomtomKey });
const localXY = (lat0, lon0) => { const kx = Math.cos(rad(lat0)) * 111320, ky = 110540; return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky]; };
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const fmtMins = s => s < 3600 ? String(Math.max(1, Math.round(s / 60))) : `${Math.floor(s / 3600)}:${String(Math.round(s % 3600 / 60)).padStart(2, '0')}`;

/** Snap a position onto the route: nearest segment around the previous match (whole route if lost). */
function snapToRoute(route, pos, hint = 0) {
  const c = route.coords, xy = localXY(pos.lat, pos.lon);
  let best = { d: Infinity, i: 0, t: 0 };
  const scan = (from, to) => {
    for (let i = from; i <= to; i++) {
      const [ax, ay] = xy(c[i][0], c[i][1]), [bx, by] = xy(c[i + 1][0], c[i + 1][1]);
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d < best.d) best = { d, i, t };
    }
  };
  scan(Math.max(0, hint - 10), Math.min(c.length - 2, hint + 150));
  if (best.d > 80) scan(0, c.length - 2);
  const { i, t } = best, j = Math.min(i + 1, c.length - 1);
  return { idx: i, cross: best.d, along: route.cum[i] + (route.cum[j] - route.cum[i]) * t,
    time: route.tcum[i] + (route.tcum[j] - route.tcum[i]) * t,
    pos: { lat: c[i][0] + (c[j][0] - c[i][0]) * t, lon: c[i][1] + (c[j][1] - c[i][1]) * t } };
}
function drawRoute(M) {
  const map = M.map; if (!map || !map.getSource('dd-left')) return;
  const empty = { type: 'FeatureCollection', features: [] };
  if (!nav) { map.getSource('dd-done').setData(empty); map.getSource('dd-left').setData(empty); M.dest?.remove(); M.dest = null; return; }
  const line = pts => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([la, lo]) => [lo, la]) } });
  const c = nav.route.coords, v = nav.view, cut = v ? [v.pos.lat, v.pos.lon] : c[0], i = v ? v.idx : 0;
  map.getSource('dd-done').setData(line([...c.slice(0, i + 1), cut]));
  map.getSource('dd-left').setData(line([cut, ...c.slice(i + 1)]));
  const d = c.at(-1);
  if (!M.dest) M.dest = new maplibregl.Marker({ element: htmlEl('<div class="dest-pin"><div></div></div>'), anchor: 'bottom' }).setLngLat([d[1], d[0]]).addTo(map);
  else M.dest.setLngLat([d[1], d[0]]);
}
function startDemoOnRoute(route) {
  const speeds = route.cum.slice(1).map((d, i) => { const dt = route.tcum[i + 1] - route.tcum[i]; return dt > 0 ? (d - route.cum[i]) / dt : null; });
  startDemo(route.coords, speeds);
}
async function startNav(dest) {
  if (!dest) return;
  const token = ++navToken;
  nav = null;
  if (loc.source === 'none') { toast('Starting demo drive for navigation'); startDemo(); }
  toast('Finding the best route…');
  const from = { lat: loc.lat, lon: loc.lon };
  let route;
  try { route = await Routing.route(from, dest, routeOpts()); }
  catch (e) {
    console.warn('Routing failed', e);
    if (token !== navToken) return;
    if (loc.source === 'demo') { route = Routing.approx(DEMO, dest.name); dest = { ...dest, lat: DEMO.at(-1)[0], lon: DEMO.at(-1)[1] }; }
    else route = Routing.approx([[from.lat, from.lon], [dest.lat, dest.lon]], dest.name);
    toast('Couldn’t reach the routing service. Showing a straight line until a road route loads');
  }
  if (token !== navToken) return;
  if (loc.source === 'demo') startDemoOnRoute(route);
  nav = { dest, route, idx: 0, said: {}, offSince: 0, lastReroute: Date.now(), view: null };
  rememberPlace(dest);
  $('#view-maps').classList.add('navigating'); $('#view-dashboard').classList.add('navigating');
  if (current !== 'maps' && !modeOverlayOpen()) openView('maps');
  recenterAll();
  const mins = Math.max(1, Math.round(route.duration / 60));
  if (settings.voice) speak(`Starting route to ${dest.name}. ${mins} minute${mins === 1 ? '' : 's'}` +
    (route.trafficDelay > 120 ? `, including ${Math.round(route.trafficDelay / 60)} minutes of traffic.` : '.'));
  updateNav();
  Bus.emit('nav.start', { value: dest.name, dest });
}
async function reroute() {
  if (!nav || nav.rerouting) return;
  const cur = nav;
  cur.rerouting = true; cur.lastReroute = Date.now();
  const quiet = cur.route.provider === 'approx'; // background retries for a real road route stay silent
  if (!quiet) { toast('Rerouting…'); if (settings.voice) speak('Rerouting.'); }
  try {
    const route = await Routing.route({ lat: loc.lat, lon: loc.lon }, cur.dest, routeOpts());
    if (nav === cur) { Object.assign(cur, { route, idx: 0, said: {}, offSince: 0 }); if (quiet) toast('Road route loaded'); }
  } catch (e) { console.warn('Reroute failed', e); }
  cur.rerouting = false;
}
function updateNav() {
  if (!nav) return;
  const r = nav.route, total = r.cum.at(-1), s = snapToRoute(r, loc, nav.idx);
  nav.idx = s.idx;
  const remain = Math.max(0, total - s.along), remainT = Math.max(0, r.tcum.at(-1) - s.time);
  if (remain < 25 || (s.cross < 40 && haversine(loc, P(r.coords.at(-1))) < 20)) return arrive();
  // Off the route for a few seconds on live GPS → ask for a new route.
  const off = s.cross > Math.max(40, (loc.acc || 0) * 1.5);
  if (off && loc.source === 'gps') {
    nav.offSince ||= Date.now();
    if (Date.now() - nav.offSince > 6000 && Date.now() - nav.lastReroute > 15000) reroute();
  } else nav.offSince = 0;
  const si = r.steps.findIndex(st => st.at > s.along + 5), step = r.steps[si] ?? r.steps.at(-1), toNext = Math.max(0, step.at - s.along);
  const eta = new Date(Date.now() + remainT * 1000);
  nav.view = { ...s, remain, remainT, eta, step, stepIdx: si, toNext, limitKmh: r.segLimit?.[s.idx] ?? null, progress: total ? 1 - remain / total : 0, off };

  const d = fmtDist(toNext), rd = fmtDist(remain);
  $('#manIcon').innerHTML = svg(step.icon);
  $('#manDist').textContent = `${d.v} ${d.u}`;
  $('#manStreet').textContent = step.text;
  $('#dashMan').hidden = false;
  $('#dashMan').innerHTML = `${svg(step.icon)}<div><b>${d.v} ${d.u}</b><span>${esc(step.street || step.text)}</span></div>`;
  $('#etaArr').textContent = fmtClock(eta).replace(/\s?[AP]M/i, '');
  $('#etaMin').textContent = fmtMins(remainT); $('#etaMinU').textContent = remainT >= 3600 ? 'hr' : 'min';
  $('#etaDist').textContent = rd.v; $('#etaDistU').textContent = rd.u;
  const delay = r.trafficDelay > 60 ? Math.round(r.trafficDelay / 60) : 0, approx = r.provider === 'approx';
  $('#etaTraffic').hidden = !delay && !approx;
  $('#etaTraffic').textContent = approx ? 'No road route yet · straight line' : delay ? `+${delay} min traffic` : '';
  // A straight-line fallback isn't a real route: keep trying for one while on live GPS.
  if (approx && loc.source === 'gps' && Date.now() - nav.lastReroute > 30000) reroute();
  Object.values(maps).forEach(drawRoute);
  renderLimit();
  announce(si, step, toNext);
}
/** Two spoken prompts per maneuver: a heads-up ~30 s out, then "now" just before it. */
function announce(si, step, toNext) {
  if (!settings.voice || si < 0) return;
  const said = nav.said[si] ||= {}, near = Math.max(60, loc.speed * 9);
  if (!said.near && toNext <= near) { said.near = said.prep = true; speak(step.text + '.'); }
  else if (!said.prep && toNext > near * 1.6 && toNext < Math.max(500, loc.speed * 35)) { said.prep = true; speak(`In ${spokenDist(toNext)}, ${lowerFirst(step.text)}.`); }
}
function arrive() { const n = nav.dest.name; Bus.emit('nav.arrive', { value: n, dest: nav.dest }); endNav(); toast(`Arrived at ${n}`); if (settings.voice) speak(`You have arrived at ${n}.`); }
function endNav() {
  if (nav) Bus.emit('nav.end', { value: nav.dest.name, dest: nav.dest });
  nav = null; navToken++;
  $('#view-maps').classList.remove('navigating'); $('#view-dashboard').classList.remove('navigating');
  $('#dashMan').hidden = true;
  Object.values(maps).forEach(drawRoute);
  if (maps.main.map && mapMode !== '3d') maps.main.map.setZoom(16);
  renderLimit(); emit();
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
].map(c => ({ ...c, sample: true }));
// Your own contacts (added in Settings or imported) come first and are the ones that really dial.
const COLORS = ['#ff375f', '#ff9f0a', '#bf5af2', '#0a84ff', '#30d158', '#40c8e0', '#e0a800'];
function loadContacts() {
  const mine = store.get('contacts', []).map((c, i) => ({ ...c, c: c.c || COLORS[i % COLORS.length], fav: true }));
  CONTACTS.splice(0, CONTACTS.length, ...mine, ...CONTACTS.filter(c => c.sample && !mine.some(m => m.n.toLowerCase() === c.n.toLowerCase())));
}
loadContacts();

/* ============================================================
   Hand-offs to the phone's own apps (calls, SMS, WhatsApp, maps, music)
   ============================================================ */
const telNum = n => (n || '').replace(/[^\d+]/g, '');
/** Open another app by URL scheme; if nothing takes over within a moment, open the web fallback in a new tab. */
function openExternal(scheme, web) {
  if (!scheme) { window.open(web, '_blank'); return; }
  let left = false; const gone = () => { left = true; };
  document.addEventListener('visibilitychange', gone, { once: true });
  location.href = scheme;
  if (web) setTimeout(() => { document.removeEventListener('visibilitychange', gone); if (!left && document.visibilityState === 'visible') window.open(web, '_blank'); }, 1600);
}
function textContact(c, body = '') {
  const num = telNum(c.num); if (!num) return toast(`No number for ${c.n}`);
  location.href = `sms:${num}${body ? (isIOS ? '&' : '?') + 'body=' + encodeURIComponent(body) : ''}`;
}
function whatsappContact(c, body = '') {
  const num = telNum(c.num).replace(/^\+/, ''); if (!num) return toast(`No number for ${c.n}`);
  openExternal(`whatsapp://send?phone=${num}&text=${encodeURIComponent(body)}`, `https://wa.me/${num}?text=${encodeURIComponent(body)}`);
}
const MAP_APPS = {
  google: ['Google Maps', d => `comgooglemaps://?daddr=${d.lat},${d.lon}&directionsmode=driving`, d => `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lon}&travelmode=driving`],
  waze: ['Waze', d => `waze://?ll=${d.lat},${d.lon}&navigate=yes`, d => `https://waze.com/ul?ll=${d.lat},${d.lon}&navigate=yes`],
  phone: ['Phone’s maps app', d => isIOS ? `maps://?daddr=${d.lat},${d.lon}&dirflg=d` : `geo:${d.lat},${d.lon}?q=${d.lat},${d.lon}`, null],
};
function openInMaps(app, d = nav?.dest) {
  if (!d) return toast('Pick a destination first');
  const [, scheme, web] = MAP_APPS[app]; openExternal(scheme(d), web?.(d));
}
function mapsHandoffSheet() {
  sheet('Open route in another app', `<p>${nav ? `Destination: <b>${esc(nav.dest.name)}</b>` : 'No active route.'}</p>`,
    [...Object.entries(MAP_APPS).map(([id, [name]]) => [name, () => openInMaps(id)]), ['Cancel']]);
}
const MUSIC_APPS = {
  demo: ['DriveDeck demo player'],
  spotify: ['Spotify', q => `spotify:search:${encodeURIComponent(q)}`, q => `https://open.spotify.com/search/${encodeURIComponent(q)}`],
  ytmusic: ['YouTube Music', null, q => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`],
  phone: ['Phone’s music app', () => isIOS ? 'music://' : null, q => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`],
  // A shortcut you make once (input: text → your music app's “play” action) starts playback directly, not just a search.
  shortcut: ['A phone shortcut (plays straight away)', q => `shortcuts://run-shortcut?name=${encodeURIComponent(settings.musicShortcut || 'DriveDeck Play')}&input=text&text=${encodeURIComponent(q)}`, null],
};
/** Play through the chosen music app; returns false when the demo player should handle it. */
function playInMusicApp(q = '', app = settings.musicApp) {
  const m = MUSIC_APPS[app]; if (!m || app === 'demo') return false;
  openExternal(m[1]?.(q) || null, m[2]?.(q || 'music')); return true;
}
function contactsSheet() {
  const mine = store.get('contacts', []);
  sheet('Contacts', `<p>Your contacts are stored only on this device. Calls, texts and WhatsApp open the phone’s own apps.</p>
    <div class="ct-list">${mine.map((c, i) => `<div class="ct-row"><b>${esc(c.n)}</b><span>${esc(c.num)}</span><button class="ct-x" data-ctdel="${i}" aria-label="Remove ${esc(c.n)}">${svg('close')}</button></div>`).join('') || '<p class="hint">No contacts yet. Samples like “Mom” are placeholders and won’t dial.</p>'}</div>`,
    [['Add contact', addContact], ...('contacts' in navigator && 'select' in navigator.contacts ? [['Import from phone', importContacts]] : []), ['Done']]);
}
function addContact() {
  const n = prompt('Contact name'); if (!n) return;
  const num = prompt(`Phone number for ${n} (with country code, e.g. +91 98765 43210)`); if (!num) return;
  store.set('contacts', [...store.get('contacts', []), { id: 'c' + Date.now(), n: n.trim(), num: num.trim() }]); loadContacts(); contactsSheet();
}
async function importContacts() {
  try {
    const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
    const add = picked.filter(c => c.tel?.length).map((c, i) => ({ id: 'c' + Date.now() + i, n: (c.name?.[0] || c.tel[0]).trim(), num: c.tel[0] }));
    store.set('contacts', [...store.get('contacts', []), ...add]); loadContacts(); toast(`${add.length} contact${add.length === 1 ? '' : 's'} added`);
  } catch { toast('Contact import was cancelled'); }
  contactsSheet();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ctdel]'); if (!b) return;
  const l = store.get('contacts', []); l.splice(+b.dataset.ctdel, 1); store.set('contacts', l); loadContacts(); contactsSheet();
});
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
  const num = telNum(c.num);
  if (settings.nativeCalls !== false && num && !c.sample) { toast(`Calling ${c.n}…`); location.href = `tel:${num}`; return; }
  if (c.sample && settings.nativeCalls !== false) toast('Sample contact: this call is simulated. Add real contacts in Settings › Phone & apps');
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
      <div class="wx-place">${svg('locate')}${loc.source === 'demo' ? DEMO_CITY.name : 'My Location'}</div>
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
    { title: 'Lunch with Sam', at: at(180), dur: 60, loc: 'Third Wave Coffee', dest: 'coffee', color: '#30d158', contact: 'sam' },
    { title: 'Workout', at: at(330), dur: 60, loc: 'Cult Gym', dest: 'gym', color: '#ff375f' },
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
/** Dashboard tiles live in js/dash.js; refresh them when weather or units change. */
function renderDashTiles() { if (typeof Dash !== 'undefined') Dash.update(true); }

/* ============================================================
   Drive (trip computer)
   ============================================================ */
function updateDrive() {
  const v = speedVal(loc.speed), scale = imperial() ? 100 : 160, lim = limitVal(), over = settings.speedLimit && lim != null && v > lim;
  $('#gVal').setAttribute('stroke-dasharray', `${Math.min(1, v / scale) * 405.3} 540.4`);
  $('#gaugeLimit').textContent = settings.speedLimit && lim != null ? `Limit ${lim}` : '';
  $('#gaugeLimit').hidden = !settings.speedLimit || lim == null;
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
  if (typeof CmdUI !== 'undefined' && CmdUI.shown) return CmdUI.render();
  if (typeof LinkUI !== 'undefined' && LinkUI.shown) return LinkUI.render();
  const debug = typeof DebugUI !== 'undefined' && Log.on;
  if (debug && DebugUI.tab === 'logs') return DebugUI.render();
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${k}:${v}" class="${settings[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tog = (k, t, s = '') => `<div class="row"><div class="main"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div><button class="switch ${settings[k] ? 'on' : ''}" data-toggle="${k}" role="switch" aria-checked="${!!settings[k]}" aria-label="${t}"></button></div>`;
  const btn = (a, t, v = '') => `<button class="row btn" data-action="${a}"><div class="main"><div class="t">${t}</div></div><span class="val">${v}</span></button>`;
  const srcLabel = { gps: 'Device GPS', demo: 'Demo drive', none: 'Off' }[loc.source];
  const routerNote = settings.router === 'tomtom'
    ? (settings.tomtomKey ? 'Live-traffic travel times from TomTom' : 'Add your free TomTom key below')
    : 'OpenStreetMap routing · typical travel times, no live traffic';
  $('#settingsBody').innerHTML = `${debug ? DebugUI.tabs() : ''}
    ${typeof Stage !== 'undefined' ? Stage.settingsHtml(seg, tog, btn) : ''}
    <div class="group-title">Display</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Appearance</div></div>${seg('theme', [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}</div>
      <div class="row"><div class="main"><div class="t">Wallpaper</div></div><div class="swatches">${WALLS.map((w, i) =>
        `<button class="swatch ${settings.wallpaper === i ? 'on' : ''}" data-wall="${i}" style="background:${w[resolvedTheme()]}" aria-label="Wallpaper ${i + 1}"></button>`).join('')}</div></div>
      ${tog('seamless', 'Seamless widgets', 'Widgets merge into one surface: no gaps, borders or separate cards')}
    </div>
    <div class="group-title">Dashboard</div>
    <div class="group">
      ${btn('dashCustomize', 'Cluster style, accent &amp; sensors')}
      ${typeof Links !== 'undefined' ? btn('links', 'Widget links', `${Links.all().filter(k => k.on !== false).length} on`) : ''}
      ${typeof Radio !== 'undefined' ? btn('radio', 'Radio stations', Radio.cur ? esc(Radio.cur.name) : 'Choose') : ''}
    </div>
    ${typeof Vision !== 'undefined' ? `<div class="group-title">Camera &amp; objects</div>
    <div class="group">
      ${tog('detOn', 'Recognise objects', 'On this device, offline: people, vehicles, bikes, animals, traffic lights, stop signs')}
      <div class="row"><div class="main"><div class="t">Recognition model</div><div class="s">${esc(VISION_MODELS[settings.detModel]?.note || '')} · licence ${esc(VISION_MODELS[settings.detModel]?.license || '')}</div></div>${seg('detModel', Object.entries(VISION_MODELS).map(([k, m]) => [k, `${m.name.replace(' nano', '')} · ${m.license}`]))}</div>
      ${tog('detAR', 'Boxes in AR mode', 'Draws what it recognises over the AR camera view')}
      ${tog('detAlerts', 'Spoken alerts', 'Says when something you chose is close, e.g. “Person ahead.”')}
      ${btn('detAlertList', 'Alert for', esc((settings.detAlertList || DEFAULT_ALERTS).join(', ')))}
      ${tog('detAnswer', 'Answer “what do you see?”', 'Looks through the camera when you ask')}
      <div class="row"><div class="main"><div class="t">Frames checked per second</div><div class="s">More is quicker to react, less saves battery</div></div>${seg('detFps', [['2', '2'], ['3', '3'], ['5', '5']])}</div>
    </div>` : ''}
    <div class="group-title">Driving</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Units</div></div>${seg('units', [['imperial', 'mph · mi'], ['metric', 'km/h · km']])}</div>
      ${tog('speedLimit', 'Show speed limit')}
      ${tog('voice', 'Spoken navigation')}
      ${tog('hideWhileDriving', 'Hide message text while driving', 'Messages are read aloud instead')}
      ${tog('readAloud', 'Auto-read messages when opened while driving')}
    </div>
    <div class="group-title">Navigation</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Routing &amp; traffic</div><div class="s">${routerNote}</div></div>${seg('router', [['osrm', 'Free'], ['tomtom', 'TomTom traffic']])}</div>
      ${btn('tomtomKey', 'TomTom API key', settings.tomtomKey ? '••••' + esc(settings.tomtomKey.slice(-4)) : 'Not set')}
      ${tog('terrain', '3D terrain', 'Hills and elevation in 3D mode')}
      ${tog('hudMirror', 'Mirror HUD for the windshield', 'Lay the phone flat below the windshield and read the reflection')}
      ${btn('arReset', 'Reset AR calibration')}
    </div>
    <div class="group-title">Voice</div>
    <div class="group">
      <div class="row"><div class="main"><div class="t">Speech recognition</div><div class="s">${(typeof Voice !== 'undefined' && !SR) ? 'Whisper base · on this device, works offline (no built-in recognizer here)' : settings.stt === 'whisper' ? (store.get('whisperOK') ? 'Whisper base · on this device, works offline; uses more memory' : 'Whisper base · about 80 MB on first use, works offline; uses more memory') : 'This device’s own recognizer: no download, leaves memory for other features'}</div></div>${(typeof Voice !== 'undefined' && !SR) ? '' : seg('stt', [['browser', 'Device'], ['whisper', 'Whisper']])}</div>
      ${tog('convo', 'Conversation mode (beta)', 'Tap the mic once and keep talking: it listens while it replies, so you can interrupt. Listens on this device: Moonshine or Whisper for English, Whisper for other languages')}
      ${settings.convo && ['auto', 'en'].includes(settings.voiceLang || 'auto') ? `<div class="row"><div class="main"><div class="t">Listening in conversations</div><div class="s">${{ auto: 'Automatic: Moonshine on a phone (smaller), Whisper on tablets and computers (more accurate)', moonshine: 'Moonshine tiny: about 50 MB, fastest, English only', whisper: 'Whisper base: more accurate with accents; best with a GPU' }[settings.convoStt || 'auto']}</div></div>${seg('convoStt', [['auto', 'Auto'], ['moonshine', 'Moonshine'], ['whisper', 'Whisper']])}</div>` : ''}
      ${settings.convo ? `<div class="row"><div class="main"><div class="t">Reply after a pause of</div><div class="s">How long you stop talking before it answers</div></div>${seg('convoGap', [['0.7', '0.7 s'], ['1', '1 s'], ['1.5', '1.5 s']])}</div>` : ''}
      ${btn('voiceLang', 'Language you speak', (typeof LANGS !== 'undefined' && LANGS[settings.voiceLang]?.[0]) || 'Auto-detect')}
      ${store.get('whisperOK') || (settings.stt !== 'whisper' && !((typeof Voice !== 'undefined' && !SR))) ? '' : btn('voiceModel', 'Download the voice model now', 'Use Wi-Fi')}
      ${typeof Voice !== 'undefined' && Voice.engine() !== 'whisper' ? '' : `<div class="row"><div class="main"><div class="t">Act after you stop talking</div><div class="s">Whisper waits this long for more words</div></div>${seg('vadSilence', [['1.5', '1.5 s'], ['3', '3 s'], ['5', '5 s'], ['8', '8 s']])}</div>`}
      <div class="row"><div class="main"><div class="t">Replies spoken by</div><div class="s">${settings.tts === 'neural' ? (store.get('kokoroOK') ? 'Kokoro · natural voice on this phone, works offline' : `Kokoro · about ${typeof ttsSize === 'function' ? ttsSize() : '90 MB'} on first use, the phone’s voice until then`) : settings.tts === 'phone' ? 'The phone’s built-in voice' : 'Replies are shown, not spoken'}</div></div>${seg('tts', [['neural', 'On-device'], ['phone', 'Phone'], ['off', 'Off']])}</div>
      ${settings.tts === 'neural' && typeof TTS_VOICES !== 'undefined' ? btn('ttsVoice', 'Reply voice', TTS_VOICES[settings.ttsVoice]?.[0] || 'Heart') : ''}
      ${settings.tts === 'neural' && !store.get('kokoroOK') ? btn('ttsModel', 'Download the reply voice now', 'Use Wi-Fi') : ''}
      ${settings.tts === 'neural' && typeof gpuOK === 'function' && gpuOK() && Diag.get().device !== 'webgpu' ? btn('ttsGpu', 'Faster reply voice (GPU)', 'Download 310 MB') : ''}
      ${typeof Commands !== 'undefined' ? btn('commands', 'Voice commands', Commands.all().filter(c => c.on !== false).length + ' on') : ''}
      ${btn('voiceLogClear', 'Clear conversation history')}
    </div>
    <div class="group-title">Phone &amp; apps</div>
    <div class="group">
      ${tog('nativeCalls', 'Place real calls and texts', 'Opens the phone’s own dialer, Messages or WhatsApp')}
      ${btn('contacts', 'Contacts', store.get('contacts', []).length + ' saved')}
      ${btn('musicAppPick', 'Music plays in', MUSIC_APPS[settings.musicApp]?.[0] || 'Demo player')}
      ${btn('mapsHandoff', 'Open current route in…', 'Google Maps, Waze')}
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
      ${btn('installHelp', isStandalone() ? 'Installed' : 'Install on this device', isStandalone() ? '✓' : 'Full screen, no browser bars')}
      <button class="row" data-action="versionTap"><div class="main"><div class="t">DriveDeck</div></div><span class="val">v0.4${typeof Log !== 'undefined' && Log.on ? ' · debug' : ''}</span></button>
    </div>`;
}

/* ============================================================
   Voice assistant
   ============================================================ */
// Listening, speech-to-text and the conversation log live in js/voice.js.
function setAsst(text, hint = '') { Voice.show(text, hint); }
function openAssistant() { Voice.start(); }
function closeAssistant() { if (typeof Voice !== 'undefined') Voice.close(); }
// What you say or type is matched to a command in js/commands.js (handleCommand); replies are spoken by Voice.speak.
/** Say something out loud: the on-device voice when it's downloaded, else the phone's. Resolves when done. */
function speak(text) {
  if (typeof Voice !== 'undefined') return Voice.speak(text);
  try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
  return Promise.resolve();
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
let sheetFns = [];
/** Modal card with big buttons: sheet(title, html, [[label, fn?], …]); the first button is the accent one. */
function sheet(title, body, buttons) {
  sheetFns = buttons.map(b => b[1]);
  $('#sheet').innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="sheet-body">${body}</div>
    <div class="btns">${buttons.map((b, i) => `<button class="big-btn ${i ? '' : 'accent'}" data-sheet="${i}">${esc(b[0])}</button>`).join('')}</div></div>`;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
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
  dial: () => { if (!dialed) return; openCall({ n: dialed, num: dialed, c: '#8e8e93' }); dialed = ''; renderPhone(); },
  delDigit: () => { dialed = dialed.slice(0, -1); renderPhone(); },
  listen: () => { const th = THREADS.find(t => t.id === activeThread); if (th) { readThread(th); renderMessages(); } },
  closeThread: () => { activeThread = null; renderMessages(); },
  tripReset: () => { Object.assign(trip, { dist: 0, moving: 0, max: 0, start: Date.now() }); updateDrive(); toast('Trip reset'); },
  fullscreen: toggleFullscreen,
  tomtomKey: () => {
    const k = prompt('Paste your TomTom API key (free at developer.tomtom.com):', settings.tomtomKey || '');
    if (k == null) return;
    settings.tomtomKey = k.trim();
    if (settings.tomtomKey) settings.router = 'tomtom';
    applySettings(); renderSettings();
    toast(settings.tomtomKey ? 'TomTom traffic routing on' : 'TomTom key removed');
  },
  installHelp: () => showInstallHelp(),
  contacts: () => contactsSheet(),
  voiceLang: () => sheet('Language you speak', '<p>Whisper understands all of these. Anything that isn’t English is translated into an English command. In conversation mode, English and Auto-detect use Moonshine (faster, English only); any other choice uses Whisper.</p>',
    [...Object.entries(LANGS).map(([id, [name]]) => [name + (settings.voiceLang === id ? ' ✓' : ''), () => { settings.voiceLang = id; applySettings(); if (current === 'settings') renderSettings(); }]), ['Cancel']]),
  voiceModel: () => { Voice.open(); Voice.show('Downloading voice model…', 'Whisper base · one time'); Voice.loadModel().then(() => { Voice.show('Voice model ready', 'Works offline from now on'); if (current === 'settings') renderSettings(); }).catch(e => Voice.fail(e)); },
  voiceLogClear: () => { VoiceLog.clear(); toast('Conversation history cleared'); },
  mapsHandoff: () => mapsHandoffSheet(),
  openMusicApp: () => { if (!playInMusicApp(curTrack().t)) sheet('Music app', '<p>Choose where music plays: the demo player, or hand off to a music app on your phone.</p>', [['Choose app', () => ACTIONS.musicAppPick()], ['Cancel']]); },
  musicAppPick: () => sheet('Music plays in', `<p>“Play music from Maroon 5” opens this app with Maroon 5. Music apps’ links open the artist’s search results; to start playing straight away, choose <b>a phone shortcut</b> and make one once in your phone’s shortcuts app: name it “${esc(settings.musicShortcut || 'DriveDeck Play')}”, let it take text input, and add your music app’s “play” action with the shortcut input as what to play.</p>`,
    [...Object.entries(MUSIC_APPS).map(([id, [name]]) => [name + (settings.musicApp === id ? ' ✓' : ''), () => {
      if (id === 'shortcut') { const n = prompt('Name of the shortcut that plays music:', settings.musicShortcut || 'DriveDeck Play'); if (!n) return; settings.musicShortcut = n.trim(); }
      settings.musicApp = id; applySettings(); if (current === 'settings') renderSettings(); }]), ['Cancel']]),
  commands: () => CmdUI.open(),
  links: () => LinkUI.open(),
  detAlertList: () => {
    const cur = new Set(settings.detAlertList || DEFAULT_ALERTS);
    sheet('Alert for', `<div class="cz-styles">${ALERTABLE.map(l => `<button class="cz-style ${cur.has(l) ? 'on' : ''}" data-alertpick="${esc(l)}">${esc(l)}</button>`).join('')}</div>`,
      [['Done', () => { settings.detAlertList = [...$$('[data-alertpick].on')].map(b => b.dataset.alertpick); applySettings(); renderSettings(); }]]);
    $$('[data-alertpick]').forEach(b => b.addEventListener('click', () => b.classList.toggle('on')));
  },
  radio: () => Radio.browse(),
  ttsGpu: () => { Diag.set('device', 'webgpu'); ACTIONS.ttsModel(); },
  versionTap: () => typeof DebugUI !== 'undefined' && DebugUI.versionTap(),
  ttsVoice: () => sheet('Reply voice', '<p>The on-device voice that answers you and reads directions.</p>',
    [...Object.entries(TTS_VOICES).map(([id, [name]]) => [name + (settings.ttsVoice === id ? ' ✓' : ''), () => { settings.ttsVoice = id; applySettings(); renderSettings(); Voice.speak('This is how I sound.'); }]), ['Cancel']]),
  ttsModel: () => { Voice.open(); Voice.show('Downloading the reply voice…', 'Kokoro · one time'); Voice.loadTTS(true).then(() => { Voice.show('Reply voice ready', 'Works offline from now on'); Voice.speak('Reply voice ready.'); Voice.closeT = setTimeout(() => Voice.close(), 2500); if (current === 'settings') renderSettings(); }).catch(e => { console.warn(e); Voice.show('Couldn’t download the reply voice', 'Check the connection and try again'); }); },
  backToDash: () => { closeModeMenu(); openView('dashboard'); },
  dockShow: () => { settings.dockHidden = false; store.set('settings', settings); applyDock(); if (typeof Dash !== 'undefined') Dash.renderBar(); },
  dismissInstall: () => { store.set('installTipOff', true); $('#installTip').hidden = true; },
  arReset: () => { Object.assign(settings, { arYaw: 0, arPitch: 0, arFov: 64 }); applySettings(); toast('AR calibration reset'); },
  modes: () => toggleModeMenu(),
  dashCustomize: () => Dash.customize(),
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
  toggle: v => { settings[v] = !settings[v]; applySettings(); renderSettings(); if (v === 'terrain') apply3D(maps.main); if (v === 'seamless' && typeof Dash !== 'undefined') requestAnimationFrame(() => Dash.fitGrid()); },
  mode: v => setMode(v),
  sheet: v => { const fn = sheetFns[+v]; closeSheet(); fn?.(); },
  save: v => { const d = panelItems[+v]; if (!d) return;
    sheet('Save place', `<p><b>${esc(d.name)}</b>${d.sub ? '<br>' + esc(d.sub) : ''}</p>`,
      [['Set as Home', () => savePlace('home', d)], ['Set as Work', () => savePlace('work', d)], ['Cancel']]); },
  wall: v => { settings.wallpaper = +v; applySettings(); renderSettings(); },
};
const CLICK_SEL = Object.keys(CLICK).map(k => `[data-${k}]`).join(',');
document.addEventListener('click', e => {
  const t = e.target.closest(CLICK_SEL); if (!t) return;
  for (const k of Object.keys(CLICK)) if (k in t.dataset) { CLICK[k](t.dataset[k]); break; }
});
addEventListener('resize', () => Object.values(maps).forEach(M => M.map?.resize()));
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
$('#installTip').hidden = isStandalone() || store.get('installTipOff') || !(isIOS || /Android/i.test(navigator.userAgent));

// First run: ask for location with a tap (iPhone only shows its permission prompt in response to one).
if (!store.get('onboarded') && lastSrc === 'none' && !qs.has('demo') && !qs.has('view')) {
  const tip = isIOS && !isStandalone() ? '<p class="hint">Tip: install it for full screen with no browser bars: in Safari tap <b>Share › Add to Home Screen</b>.</p>' : '';
  const done = fn => () => { store.set('onboarded', true); fn?.(); };
  sheet('Welcome to DriveDeck', `<p>Turn on location for live position, speed and turn-by-turn directions. Your location stays on this device.</p>${tip}`,
    [['Use my location', done(startGPS)], ['Try demo drive', done(() => ACTIONS.demo())], ['Not now', done()]]);
}

// Offline support and installability. Relative URL so the app works from any sub-path.
if ('serviceWorker' in navigator) addEventListener('load', async () => {
  let reg;
  try { reg = await navigator.serviceWorker.register('sw.js'); } catch { return; }
  if (!reg) return;
  // A waiting worker means new code is downloaded; only offer it when an older version is running.
  const offer = w => { if (w && navigator.serviceWorker.controller) showUpdate(w); };
  offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
  });
  // Installed apps on iPhone rarely check on their own: check on launch/return and every 30 minutes.
  const check = () => reg.update().catch(() => {});
  setInterval(check, 30 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
});
let updating = false;
function showUpdate(worker) {
  const bar = $('#updateBar');
  bar.hidden = false;
  $('#updateNow').onclick = () => { updating = true; bar.hidden = true; worker.postMessage('skipWaiting'); };
  $('#updateLater').onclick = () => { bar.hidden = true; toast('The update installs next time you close and reopen DriveDeck'); };
}
