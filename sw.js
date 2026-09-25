'use strict';
/* DriveDeck service worker — hand-written, no build step.
   Bump VERSION whenever any file in SHELL changes so clients pick up the new copy. */
const VERSION = 'v1';
const SHELL_CACHE = 'dd-shell-' + VERSION;
const TILE_CACHE = 'dd-tiles';
const WEATHER_CACHE = 'dd-weather';
const MAX_TILES = 2000;

const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'manifest.webmanifest',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'icons/icon.svg',
  'icons/favicon.ico',
  'icons/apple-touch-icon-180x180.png',
  'icons/pwa-192x192.png',
  'icons/pwa-512x512.png',
  'icons/maskable-icon-512x512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('dd-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimCache(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// Map tiles: cache-first so the map survives patchy signal.
async function tile(req) {
  const c = await caches.open(TILE_CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimCache(TILE_CACHE, MAX_TILES); }
  return res;
}

// Weather: network-first, falling back to the last forecast when offline.
async function weather(req) {
  const c = await caches.open(WEATHER_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

// App shell: cache-first, refreshed in the background (stale-while-revalidate).
async function shell(req) {
  const c = await caches.open(SHELL_CACHE);
  const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' }) ||
    (req.mode === 'navigate' ? await c.match('index.html') : undefined);
  const net = fetch(req).then(res => { if (res.ok && !req.url.includes('?')) c.put(req, res.clone()); return res; });
  if (hit) { net.catch(() => {}); return hit; }
  return net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'server.arcgisonline.com') e.respondWith(tile(req));
  else if (url.hostname === 'api.open-meteo.com') e.respondWith(weather(req));
  else if (url.origin === self.location.origin) e.respondWith(shell(req));
});
