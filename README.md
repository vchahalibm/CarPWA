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
  - **Cluster**: an instrument cluster in one of eight styles: **Chronograph** (orange-rimmed needle speedometer with G-meter, clock, elevation, compass, route, temperature and distance-to-go sub-dials), **Twin Dials** (speed and heading dials around a 3D map), **Arc** (thick arcs and a trip/route card), **Analog** (needle speedometer with G-meter, clock and compass sub-dials), **Bars** (big numbers over progress bars and a heading tape), **Band** (full-width gradient with speed, analog clock and now playing), **Telltale** (status icons, speed dial, heading tape and route bar on black) and **Map First** (3D map with glass pills).
  - **Map**: map card with the next turn, arrival/time/distance and street name, plus next-turn (or Home/Work) and now-playing cards.
  - **Widgets in the cluster**: in Edit, every cluster column (each dial, the map, and the columns either side) has an **Add** tile. Stack widgets above or below a dial, move the dial itself up or down, and drag the corner handle to size it.
  - **Widgets beside the cluster**: in the Cluster layout tap **Edit**, then **Add** on either side to stack widgets in a column left or right of the cluster. You can move them up or down, swap sides, remove them, or drag the corner handle to make one taller.
  - **Widgets**: swipe sideways between **pages**, each with its own widgets and sizes (**Edit › New page**, or delete a page). Each page is a flexible grid. Tap **Edit** to remove, reorder, add or **resize** widgets. Drag a widget's corner handle to change its width and height in whole cells; the rest re-pack around it and the rows re-fit the screen. Widgets: Speed, Current Trip, Route, Next Turn, Weather, Calendar, Clock, Now Playing, Heading, Compass, Roll, Pitch, Elevation and G-Force.
  - **Customize** (sliders button): cluster style, accent colour (cyan, magenta, red, orange, khaki, yellow, wine, green) and motion sensors.
  - Every reading is real: GPS, route, clock, weather, player, and the phone's motion sensors for roll, pitch and G-force. There are no fake car readings (gear, rpm, tyres), because a phone can't read them.
- **Car-friendly design**: 56–78px tap targets, frosted-glass cards, dark by default, plus a light theme and 4 wallpapers.

### Working
- **GPS**: live position, speed, heading, altitude and accuracy via the Geolocation API.
- **Demo drive**: simulated drive in Bengaluru (MG Road → Trinity Circle → Old Airport Road), with Bengaluru sample places, for desktop testing.
- **Maps** (MapLibre GL, [OpenFreeMap](https://openfreemap.org/) vector tiles, no key): light and dark map styles, rotating car marker, driven part of the route in grey and the rest in blue.
- **Routing**: [Valhalla](https://valhalla1.openstreetmap.de) (the router behind openstreetmap.org) by default; it avoids service roads, tracks and golf-cart paths and snaps destinations to a proper street. Two OSRM servers are fallbacks, TomTom (live traffic) is used when you add a key, and if nothing is reachable the straight-line estimate is labelled as such and retried every 30 s.
- **Turn-by-turn**: turn-by-turn instructions, distance and time left, arrival time, speed limits along the route, spoken prompts (a heads-up and a "now"), and automatic rerouting after about 6 seconds off the route.
- **Search**: real place search ([Photon](https://photon.komoot.io/) and [Nominatim](https://nominatim.org/) together) and nearby Gas, Parking, EV chargers, Coffee and Food ([Overpass](https://overpass-api.de/)), all from OpenStreetMap data. Tap ☆ on a result to save it as Home or Work; recent destinations are remembered.
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

### Getting around
- The **Maps** screen has a blue **Home** button at the top of its controls that returns to the dashboard, plus a mic button, so you're never stuck even with the dock hidden.
- **Updates**: when a new version is published, DriveDeck downloads it in the background and shows **Update available · Update now**. Choosing **Later** installs it the next time you close and reopen the app. Installed apps check for updates on launch, when you return to them, and every 30 minutes.
- **Voice** (mic in the dock, dashboard bar or Maps controls): "navigate to …", "take me home", "what's my ETA", "how far", "what's next", "how fast am I going", "where am I", "stop navigation", "recenter", "zoom in", "show the widgets" / "cluster layout", "chronograph style", "hide the dock", "dark mode", "open music", "AR mode", "find parking", "call Mom" and about 50 more; every one is listed and editable in **Settings › Voice › Voice commands**.

### Voice and the Assistant widget
- **On-device speech**: Whisper **base** (multilingual), run on the phone with [transformers.js](https://github.com/huggingface/transformers.js). It's about 80 MB on first use (DriveDeck asks first) and works offline after that. Set **Settings › Voice › Language you speak**; anything that isn't English is translated into an English command. **Settings › Voice › Speech recognition › Phone** uses the phone's own recognizer instead.
- **Listening box**: a translucent strip at the bottom shows what it heard, a level meter, model download progress and the reply with the app it used. After you stop talking it waits **5 seconds** for more words (counting down; change it in **Settings › Voice › Act after you stop talking**), then acts. Whisper transcribes during the pause, so the action happens right at the deadline. Tap the orb to act straight away.
- **Spoken replies**: once Whisper is downloaded, replies (and turn-by-turn directions) use **Kokoro**, a natural voice generated on the phone (asked once; works offline). Where the browser has WebGPU it runs on the GPU (about 310 MB; on an iPad it speaks about 1 s after the reply and faster than real time), otherwise on the CPU (about 90 MB; slower). It runs in the background and is loaded a few seconds after launch. If the GPU fails it switches to the CPU for good; devices that already have the CPU voice can switch in **Settings › Voice › Faster reply voice (GPU)**, instead of the phone's built-in voice. Pick the voice in **Settings › Voice › Reply voice**, or switch to the phone's voice or off.
- **Voice commands** (**Settings › Voice › Voice commands**): every command DriveDeck understands, grouped, each with an on/off switch. Type a phrase in the test box to see which command it triggers and what words it passes on, or run it. Tap a command to edit it, or **Add a command**:
  - **When I say**: one phrase per line. `{name}` captures words (`play {q} on spotify`), `[word]` is optional, `(this|that)` means either. Or match with **keywords** (every comma group must be heard) or **regular expressions** (named groups are captured).
  - **Then**: a DriveDeck action, **a phone app** (Spotify, YouTube Music, YouTube, Google Maps, Waze, WhatsApp, dialer, SMS, email, web search, or any app's link with `{q}` where the words go, e.g. `myapp://search?q={q}`), **a phone shortcut** (run by name with the words as its input), a widget, a screen, or just a reply.
  - **Pass along** chooses what goes to the action (default: the first captured words); **Say back** sets the reply, e.g. `Playing {q}`.
  - Matching tries exact phrases first (longer wording wins, your own commands win ties), then keywords, then again with near-miss words corrected (“navigte” → “navigate”).
- **Assistant widget**: the conversation by day. It shows your words with the time and engine, DriveDeck's reply with a chip for the app it opened (tap to jump there), and one-tap chips for the phrases you use most. Add it to a widget page or a cluster column.

### Debug mode and logs (for testing, hidden from ordinary users)
- Open the app with `?debug=<key>` in the URL, e.g. `https://vchahalibm.github.io/CarPWA/?debug=<key>`. In the installed app, which has no address bar, go to **Settings**, tap the **DriveDeck** version row 7 times and enter the key. `?debug=off` or **Turn off debug mode** switches it off and deletes the log.
- **Settings** then gets a **Logs** tab:
  - **Voice diagnostics**: what this device supports, and whether the listening and reply voices are loaded. There are buttons to test the on-device voice and the phone voice, now or after 3 s without a tap (like a real reply), and to test the microphone. Switches choose where the on-device voice runs (a background worker by default, which keeps the app smooth and starts speech sooner, or the main thread), what it computes on (CPU, or GPU via WebGPU where available: faster, but about 310 MB to download), how it plays (audio with a data URL by default, audio with a blob URL, or Web Audio) and the audio mode while replying (playback, auto, transient).
  - **The log**: every tap, screen, setting change, GPS fix, route request and provider, network call, command match (which command, how it matched, which words), hand-off to another app, the microphone and speech recognition steps with timings, each reply sentence generated and played, audio-session changes, errors and warnings. Filter by Problems, Voice, Commands, Navigation, Network or App, or search. **Share** saves it as a text file. It keeps the last 2,500 entries and survives the app being closed.
- The key only keeps the tab away from ordinary users; it isn't security. The log stays on the device unless you share it.

### Phone's own apps
- **Calls, texts, WhatsApp**: add real contacts in **Settings › Phone & apps › Contacts** (or import them where the browser allows). “Call Ravi” opens the phone's dialer, “text Ravi saying running late” opens Messages and “WhatsApp Ravi saying …” opens WhatsApp, each with the text filled in. Sample contacts never dial.
- **Maps hand-off**: the share button in the route bar (or “navigate to … with Waze / Google Maps”) opens the route in Google Maps, Waze or the phone's maps app.
- **Music**: **Settings › Music plays in** picks Spotify, YouTube Music, the phone's music app or **a phone shortcut**. “Play music from Maroon 5” opens the app with “Maroon 5”; “play Believer on Spotify” picks the app for that request. A web app can't control another app's playback, and music apps' links open search results. To start playing straight away, choose **a phone shortcut** and make one once in the phone's shortcuts app: name it “DriveDeck Play”, let it receive text, and add your music app's “play” action using the shortcut input. DriveDeck then runs it with the artist or song you said.

### Full screen on a phone or tablet
- **Install it** to run without the browser bars. On iPhone/iPad, open the site in **Safari**, tap **Share › Add to Home Screen**, keep **Open as Web App** on, then launch DriveDeck from the Home Screen. Browsers have no automatic install prompt on iPhone. **Settings › Install on this device** shows the steps, and on Android it offers the install button.
- **Sliding chrome**: the layout bar at the bottom of the dashboard slides away after 5 seconds; tap anywhere to bring it back. The ⤢ button slides the side dock away too; the thin handle on the left edge brings it back.
- Layouts size themselves to the visible screen (`100dvh`), and the widget grid picks a column count so every widget fits without scrolling when there's room.
- To lock the phone into the app while driving, use iOS **Guided Access** (Settings › Accessibility › Guided Access, then triple-click the side button in the app).

## Things to know

- **Routing and traffic**: the default router is the public [OSRM](https://project-osrm.org/) server: free, no key, OpenStreetMap roads, typical (not live) travel times. Its demo server is fine for testing but not for heavy use. For **live-traffic arrival times** like Google Maps, add a free [TomTom](https://developer.tomtom.com/) key under **Settings › Navigation › TomTom API key** (the free tier covers about 2,500 routes a day). Restrict the key to your site's domain in the TomTom dashboard, because a key used from a web page is visible to anyone who loads it. Google's own Routes API gives the best traffic data, but its terms require showing results on a Google map, so it doesn't fit a MapLibre app.
- **Map tiles**: OpenFreeMap is free and keyless. Elevation for 3D terrain comes from the free AWS Terrain Tiles dataset.
- **AR accuracy**: phone GPS is off by 5–10 m and a car's metal disturbs the compass, so the ribbon shows the road ahead and upcoming turns rather than locking onto a lane. Mount the phone upright, facing forward, then use **Calibrate** once.
- **HTTPS for GPS and camera**: location, camera and motion sensors work on `localhost` on desktop, but phones need HTTPS. To test on a phone, use the GitHub Pages deploy (below).

## Deployment (GitHub Pages)

The repo is published as-is from the `main` branch. There is no build step, and `.nojekyll` makes GitHub serve the files unprocessed. Every push to `main` goes live at `https://<owner>.github.io/CarPWA/` within a minute or two.

One-time setup: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then **Branch: `main`**, folder **`/ (root)`**, and **Save**.

`.github/workflows/ci.yml` checks every push and PR (JS syntax, manifest, service-worker precache list).
