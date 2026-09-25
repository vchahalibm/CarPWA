# DriveDeck

A car-friendly Progressive Web App dashboard: live map, drive stats, media, phone, messages, weather, calendar and a voice assistant. Big tap targets, frosted-glass cards and a dark theme by default.

> **DriveDeck** is a placeholder name. The app deliberately uses no Apple names, logos or assets, and should keep avoiding Apple trademarks.

The original single-file prototype lives in [`docs/prototype.html`](docs/prototype.html) for reference.

## Getting started

Plain HTML, CSS and JavaScript: no frameworks, no bundler, no build step, no npm. Serve the folder with any static web server:

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening `index.html` straight from disk mostly works, but the service worker (offline + install) needs `http://localhost` or HTTPS.

### Handy URLs

| URL | What it does |
| --- | --- |
| `?demo=1&nav=1` | Start the simulated drive and a navigation run immediately |
| `?view=music&theme=light` | Open a specific screen (`music`, `maps`, `drive`, `phone`, `messages`, `weather`, `calendar`, `settings`, …) in a chosen theme |
| `?play=1` | Start the (silent) player |

## Project layout

```
index.html                App shell markup (dock, views, overlays)
js/app.js                 All app logic (state, GPS/demo, maps, media, assistant, …)
css/styles.css            Design tokens, layout and components
sw.js                     Hand-written service worker (offline shell, tile + weather caching)
manifest.webmanifest      PWA manifest (name, icons, fullscreen display)
icons/                    App icons; icon.svg is the source artwork
vendor/leaflet/           Leaflet 1.9.4 (map library, BSD-2), kept locally so maps work offline
docs/prototype.html       Original single-file prototype
.github/workflows/ci.yml  Checks on every push/PR; deploys main to GitHub Pages
```

All paths are relative, so the app runs from the site root or a sub-path such as `/CarPWA/`.

**Updating the app:** when you change a file listed in `SHELL` in `sw.js`, bump `VERSION` there so installed copies pick up the change.

## Features

### Layout
- **Dock**: clock, signal, location dot (green = GPS, orange = demo), three most recent apps, voice assistant and Home. Left side in landscape, bottom in portrait.
- **Home button**: from an app it goes to the home grid; on the home grid it goes to the dashboard.
- **Dashboard** (start screen): live map, now-playing card, weather and next-calendar-event tiles.
- **Car-friendly design**: 56–78px tap targets, frosted-glass cards, dark by default, plus a light theme and 4 wallpapers.

### Working
- **GPS**: live position, speed, heading, altitude and accuracy via the Geolocation API.
- **Demo drive**: simulated drive down Market St, San Francisco, for desktop testing.
- **Maps** (Leaflet): rotating car marker, search, category chips (Gas, Parking, EV, Coffee, Food), turn-by-turn banner, ETA bar, speed-limit sign and spoken directions.
- **Weather**: live forecast from [Open-Meteo](https://open-meteo.com/) (no key). Falls back to sample data offline.
- **Drive screen**: speedometer, compass, trip distance/time/average/max speed.
- **Assistant**: Web Speech recognition where supported, tappable suggestions otherwise. Understands "take me home", "call Mom", "read my messages", "find parking", "what's the weather".
- **Messages**: read aloud with speech synthesis; text hidden above ~5 mph.
- **Screen and settings**: Screen Wake Lock, full screen, install prompt, and settings stored in `localStorage`.
- **PWA**: installable, works offline once loaded. The app shell is precached, map tiles are cache-first (up to 2,000 tiles) and weather is network-first with a cached fallback.

### Faked for now
- Music, podcasts and radio: controls and progress work, but no audio plays.
- Phone calls: simulated call screen (a real build would hand off to the dialer via `tel:`).
- Contacts, messages, calendar, route geometry and turn instructions are sample data.
- A fake message arrives 25 s after load to show the notification banner.

## Things to know

- **Map tiles**: uses Esri's key-free World Street Map. Night mode is the same tiles with a CSS colour inversion. A production release needs a paid/keyed tile provider (and a routing API for real routes).
- **HTTPS for GPS**: Geolocation works on `localhost` on desktop, but phones need HTTPS. To test on a phone, use the GitHub Pages deploy (below).

## Deployment (GitHub Pages)

`.github/workflows/ci.yml` checks every push and PR (JS syntax, manifest, service-worker precache list). Pushes to `main` publish the repo as-is to GitHub Pages at `https://<owner>.github.io/CarPWA/`.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
