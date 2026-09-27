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
| `?demo=1&nav=1&mode=ar` | Start a demo route straight into a driving mode (`map`, `3d`, `ar`, `hud`) |

## Project layout

```
index.html                App shell markup (dock, views, overlays)
js/routing.js             Routing, place search and nearby places (OSRM, TomTom, Photon, Overpass)
js/app.js                 App logic (state, GPS/demo, maps, navigation, media, assistant, …)
js/modes.js               Driving modes: Map, 3D, AR camera and HUD
js/dash.js                Dashboard: cluster styles, map + stack, widget grid, motion sensors
css/styles.css            Design tokens, layout and components
sw.js                     Hand-written service worker (offline shell, tile + weather caching)
manifest.webmanifest      PWA manifest (name, icons, fullscreen display)
icons/                    App icons; icon.svg is the source artwork
vendor/maplibre/          MapLibre GL JS 5.24 (map library, BSD-3), kept locally so maps work offline
vendor/fonts/             Inter variable font (OFL), used where the system font isn't SF
docs/prototype.html       Original single-file prototype
.github/workflows/ci.yml  Checks on every push/PR (syntax, manifest, precache list)
```

All paths are relative, so the app runs from the site root or a sub-path such as `/CarPWA/`.

**Updating the app:** when you change a file listed in `SHELL` in `sw.js`, bump `VERSION` there so installed copies pick up the change.

## Features

### Layout
- **Dock**: clock, signal, location dot (green = GPS, orange = demo), three most recent apps, voice assistant and Home. Left side in landscape, bottom in portrait.
- **Home button**: from an app it goes to the home grid; on the home grid it goes to the dashboard.
- **Dashboard** (start screen), three layouts; swipe sideways or use the pill at the bottom to switch:
  - **Cluster**: an instrument cluster in one of seven styles: **Twin Dials** (speed and heading dials around a 3D map), **Arc** (thick arcs and a trip/route card), **Analog** (needle speedometer with G-meter, clock and compass sub-dials), **Bars** (big numbers over progress bars and a heading tape), **Band** (full-width gradient with speed, analog clock and now playing), **Telltale** (status icons, speed dial, heading tape and route bar on black) and **Map First** (3D map with glass pills).
  - **Map**: map card with the next turn, arrival/time/distance and street name, plus next-turn (or Home/Work) and now-playing cards.
  - **Widgets**: an editable grid. Tap **Edit** to remove, reorder or add widgets: Speed, Current Trip, Route, Next Turn, Weather, Calendar, Clock, Now Playing, Heading, Compass, Roll, Pitch, Elevation and G-Force.
  - **Customize** (sliders button): cluster style, accent colour (cyan, magenta, red, orange, khaki, yellow, wine, green) and motion sensors.
  - Every reading is real: GPS, route, clock, weather, player, and the phone's motion sensors for roll, pitch and G-force. There are no fake car readings (gear, rpm, tyres), because a phone can't read them.
- **Car-friendly design**: 56–78px tap targets, frosted-glass cards, dark by default, plus a light theme and 4 wallpapers.

### Working
- **GPS**: live position, speed, heading, altitude and accuracy via the Geolocation API.
- **Demo drive**: simulated drive down Market St, San Francisco, for desktop testing.
- **Maps** (MapLibre GL, [OpenFreeMap](https://openfreemap.org/) vector tiles, no key): light and dark map styles, rotating car marker, driven part of the route in grey and the rest in blue.
- **Real routing**: turn-by-turn instructions, distance and time left, arrival time, speed limits along the route, spoken prompts (a heads-up and a "now"), and automatic rerouting after about 6 seconds off the route.
- **Search**: real place search ([Photon](https://photon.komoot.io/)) and nearby Gas, Parking, EV chargers, Coffee and Food ([Overpass](https://overpass-api.de/)), all from OpenStreetMap data. Tap ☆ on a result to save it as Home or Work; recent destinations are remembered.
- **Driving modes** (mode button on the map, or say "AR mode", "HUD mode", "3D view"):
  - **Map**: flat, north-up.
  - **3D**: map tilted toward the horizon, heading-up, zoom follows speed, with 3D buildings, terrain and sky.
  - **AR**: the route drawn as a ribbon on the rear camera view, with chevrons, a floating sign over the next turn and one over the destination. A glass strip shows a driven/remaining progress bar, arrival time, time left, distance to go, speed and the speed limit. Direction comes from the GPS course while moving (a compass is unreliable inside a car) and pitch/roll from the motion sensors. **Calibrate** adjusts direction, horizon and field of view for your mount. Without a camera it draws a simulated road.
  - **HUD**: huge turn arrow, distance, street, speed and limit on black, plus a progress bar and arrival time. **Mirror** flips it for reading as a reflection in the windshield.
- **First run**: a welcome card asks for location with a tap (iPhone only shows its permission prompt in response to one). If location is blocked it explains how to re-enable it.
- **Weather**: live forecast from [Open-Meteo](https://open-meteo.com/) (no key). Falls back to sample data offline.
- **Drive screen**: speedometer, compass, trip distance/time/average/max speed.
- **Assistant**: Web Speech recognition where supported, tappable suggestions otherwise. Understands "take me home", "navigate to <place>", "AR mode", "call Mom", "read my messages", "find parking", "what's the weather".
- **Messages**: read aloud with speech synthesis; text hidden above ~5 mph.
- **Screen and settings**: Screen Wake Lock, full screen, install prompt, and settings stored in `localStorage`.
- **PWA**: installable, works offline once loaded. The app shell is precached, map tiles and elevation are cache-first, and weather is network-first with a cached fallback. With no network, navigation falls back to an approximate route.

### Faked for now
- Music, podcasts and radio: controls and progress work, but no audio plays.
- Phone calls: simulated call screen (a real build would hand off to the dialer via `tel:`).
- Contacts, messages and calendar are sample data. Home and Work are samples until you save your own.
- A fake message arrives 25 s after load to show the notification banner.

## Things to know

- **Routing and traffic**: the default router is the public [OSRM](https://project-osrm.org/) server: free, no key, OpenStreetMap roads, typical (not live) travel times. Its demo server is fine for testing but not for heavy use. For **live-traffic arrival times** like Google Maps, add a free [TomTom](https://developer.tomtom.com/) key under **Settings › Navigation › TomTom API key** (the free tier covers about 2,500 routes a day). Restrict the key to your site's domain in the TomTom dashboard, because a key used from a web page is visible to anyone who loads it. Google's own Routes API gives the best traffic data, but its terms require showing results on a Google map, so it doesn't fit a MapLibre app.
- **Map tiles**: OpenFreeMap is free and keyless. Elevation for 3D terrain comes from the free AWS Terrain Tiles dataset.
- **AR accuracy**: phone GPS is off by 5–10 m and a car's metal disturbs the compass, so the ribbon shows the road ahead and upcoming turns rather than locking onto a lane. Mount the phone upright, facing forward, then use **Calibrate** once.
- **HTTPS for GPS and camera**: location, camera and motion sensors work on `localhost` on desktop, but phones need HTTPS. To test on a phone, use the GitHub Pages deploy (below).

## Deployment (GitHub Pages)

The repo is published as-is from the `main` branch. There is no build step, and `.nojekyll` makes GitHub serve the files unprocessed. Every push to `main` goes live at `https://<owner>.github.io/CarPWA/` within a minute or two.

One-time setup: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then **Branch: `main`**, folder **`/ (root)`**, and **Save**.

`.github/workflows/ci.yml` checks every push and PR (JS syntax, manifest, service-worker precache list).
