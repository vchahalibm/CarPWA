# DriveDeck

A car-friendly Progressive Web App dashboard: live map, drive stats, media, phone, messages, weather, calendar and a voice assistant. Big tap targets, frosted-glass cards and a dark theme by default.

> **DriveDeck** is a placeholder name. The app deliberately uses no Apple names, logos or assets, and should keep avoiding Apple trademarks.

The original single-file prototype lives in [`docs/prototype.html`](docs/prototype.html) for reference.

## Getting started

Plain HTML, CSS and JavaScript: no frameworks, no bundler, no build step, no npm (npm is used only by the optional desktop wrapper in `desktop/`). Serve the folder with any static web server:

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
js/dash.js                Dashboard: cluster styles, map + stack, widget grid, widget instances, motion sensors
js/events.js              The app-wide event bus (Bus)
js/widgets.js             Actions, widget links and Settings › Widget links
js/radio.js               Internet radio: player, station directory, widget
js/media.js               Document, video, web page and 3D model widgets
js/avatar.js              VRM avatars in the 3D widget: lip-sync, blinking, gestures
js/vision.js              Camera widget and offline object recognition (YOLOv10 / D-FINE)
js/stage.js               Stage mode: Drive/Stage switch, captions, cameras per mode, clicker keys
js/script.js              Scripts: avatar-led presentations (runner, go back / start over, editor, help)
js/people.js              People on Stage: MediaPipe worker, the presenter (claim gesture), gestures, gaze, overlay
js/webdrive.js            Web steps: record and replay clicks on your own pages in a web widget
bridge/                   drivedeck-bridge.js: one line on your own page lets DriveDeck record and replay clicks there
css/styles.css            Design tokens, layout and components
sw.js                     Hand-written service worker (offline shell, tile + weather caching)
manifest.webmanifest      PWA manifest (name, icons, fullscreen display)
icons/                    App icons; icon.svg is the source artwork
vendor/maplibre/          MapLibre GL JS 5.24 (map library, BSD-3), kept locally so maps work offline
vendor/hls/               hls.js light (Apache-2.0), for HLS radio and video streams outside Safari
vendor/pdfjs/             pdf.js (Apache-2.0, legacy build + standard fonts), for PDF documents
vendor/pptx/              PptxViewJS + JSZip + Chart.js (MIT), for PowerPoint files
vendor/mediapipe/         MediaPipe Tasks Vision + hand-gesture, pose and face models (Apache-2.0), for people on Stage
samples/                  A demo deck (.pptx with speaker notes) and a live demo page, used by the sample script
vendor/model-viewer/      model-viewer (Apache-2.0), for 3D models
vendor/three-vrm/         three.js + three-vrm bundle (MIT), for VRM avatars
vendor/models/            Built-in 3D models (CC0): Vita and Ren (VRM) and the robot
vendor/fonts/             Inter variable font (OFL), used where the system font isn't SF
docs/prototype.html       Original single-file prototype
docs/memory-strategy.md   How on-device models share a phone's memory
desktop/                  Electron wrapper: the same web files as a Mac app (DMG)
.github/workflows/ci.yml  Checks on every push/PR (syntax, manifest, precache list)
.github/workflows/desktop.yml  Builds the Mac DMGs
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
  - **Seamless widgets** (**Settings › Display**): the widgets of a page or column merge into one surface, with no gaps, borders or separate cards; a column's dial and its widgets share one frame. Edit mode still outlines each widget. Turn it off for the separate cards. One switch for the whole app for now; per page and per tab later.
  - **Widgets you can add more than once** (documents, videos, web pages, 3D models) get their own settings: in Edit, tap a widget's ⚙.
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
- **Listening**: by default the device's own recognizer (iPhone, iPad, Android, Chrome), which needs no download and leaves memory for other features. **Settings › Voice › Speech recognition › Whisper** listens on the device instead with Whisper **base** (multilingual, [transformers.js](https://github.com/huggingface/transformers.js)): about 80 MB on first use, works offline, and translates anything that isn't English (set **Language you speak**) into an English command. Where there is no built-in recognizer, as in the Mac app, Whisper is used.
- **Conversation mode (beta)**: **Settings › Voice › Conversation mode (beta)**. Tap the mic once and just keep talking: it listens on the device the whole time with its own microphone pipeline (one audio session that records and plays at once, so the iPhone recognizer problem below can't happen), answers, and listens again without another tap. For English, **Listening in conversations** picks the recognizer: Automatic uses [Moonshine](https://huggingface.co/onnx-community/moonshine-tiny-ONNX) tiny on a phone (about 30 MB, fast) and Whisper on tablets and computers (more accurate with accents); any other language, including **Several languages (Whisper)**, uses Whisper. Replies are turned up in a conversation (iOS lowers playback while the microphone is in use), with a limiter; **Settings › Logs › Conversation volume** adjusts it. A command that opens another app keeps the conversation going; if the other app comes to the front, it pauses and one tap carries on. You can talk over a reply: it turns the reply down at once, and "stop" (or "wait", "cancel") stops it. Its own voice coming back from the speakers is ignored. "That's all", "thanks" or "goodbye" ends it, as do 30 seconds of quiet or a tap on the mic. **Reply after a pause of** sets how long you stop talking before it answers (0.7, 1 or 1.5 s). The debug log (`duplex`) shows each turn and, at the end, the counters (turns, interruptions, echo dropped, false alarms, recognition times).
- **Phone recognizer on iPhone/iPad**: iOS often stops feeding the microphone to the recognizer after a reply has played (it works once, then hears nothing). DriveDeck frees the reply player and resets the microphone before listening, and if the recognizer still gets no audio within 3 seconds it resets once more and, if Whisper is downloaded, lets Whisper take that turn. **Settings › Logs › Phone recognizer › Plain** turns this off for testing.
- **Listening box**: a translucent strip at the bottom shows what it heard, a level meter, model download progress and the reply with the app it used. With Whisper, after you stop talking it waits **5 seconds** for more words (counting down; change it in **Settings › Voice › Act after you stop talking**), then acts. Whisper transcribes during the pause, so the action happens right at the deadline. Tap the orb to act straight away.
- **Spoken replies**: replies (and turn-by-turn directions) use **Kokoro**, a natural voice generated on the device, instead of the built-in mechanical one. DriveDeck offers the download on the first mic tap; it works offline after that. Where the browser has WebGPU it runs on the GPU (about 165 MB where the GPU supports 16-bit models, else 310 MB; on an iPad it speaks about 1 s after the reply and faster than real time), otherwise on the CPU (about 90 MB; slower). It runs in the background and is loaded a few seconds after launch. If the GPU fails it switches to the CPU for good; devices that already have the CPU voice can switch in **Settings › Voice › Faster reply voice (GPU)**, instead of the phone's built-in voice. Pick the voice in **Settings › Voice › Reply voice**, or switch to the phone's voice or off.
- **Voice commands** (**Settings › Voice › Voice commands**): every command DriveDeck understands, grouped, each with an on/off switch. Type a phrase in the test box to see which command it triggers and what words it passes on, or run it. Tap a command to edit it, or **Add a command**:
  - **When I say**: one phrase per line. `{name}` captures words (`play {q} on spotify`), `[word]` is optional, `(this|that)` means either. Or match with **keywords** (every comma group must be heard) or **regular expressions** (named groups are captured).
  - **Then**: a DriveDeck action, **a phone app** (Spotify, YouTube Music, YouTube, Google Maps, Waze, WhatsApp, dialer, SMS, email, web search, or any app's link with `{q}` where the words go, e.g. `myapp://search?q={q}`), **a phone shortcut** (run by name with the words as its input), a widget, a screen, or just a reply.
  - **Pass along** chooses what goes to the action (default: the first captured words); **Say back** sets the reply, e.g. `Playing {q}`.
  - Matching tries exact phrases first (longer wording wins, your own commands win ties), then keywords, then again with near-miss words corrected (“navigte” → “navigate”).
- **Assistant widget**: the conversation by day. It shows your words with the time and engine, DriveDeck's reply with a chip for the app it opened (tap to jump there), and one-tap chips for the phrases you use most. Add it to a widget page or a cluster column.

### Radio
- **Radio widget** (add it in Edit, or say “show the radio widget”): the station's logo, name and country, play/pause, previous/next station (your favourites, else the last list shown) and **Stations**. Also in **Settings › Dashboard › Radio stations** and on the home screen's **Radio**.
- **Stations** come from the free [Radio Browser](https://www.radio-browser.info/) directory: **India** first (the most played), then **US** and **Europe** (UK, Germany, France, Netherlands, Italy, Spain, Ireland), plus search for any station by name. ☆ keeps a station in **Favourites**. Only HTTPS streams are listed, because a secure web app can't play `http://` ones. The lists are cached for a day; if the directory can't be reached, a few long-running US and European stations are built in.
- One player for the whole app: it keeps playing while you rearrange the dashboard or switch screens, shows on the lock screen, and stops the demo music player. **It pauses while you talk to the assistant and resumes when the reply is done.** HLS (`.m3u8`) streams play natively in Safari and through [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0, in `vendor/hls/`) elsewhere.
- Voice: “play the radio”, “play Radio Mirchi”, “play BBC World Service radio”, “tune to Vividh Bharati”, “next station”, “stop the radio”, “show the stations”. A station asked for by voice starts when the reply finishes.

### Documents, videos, web pages and 3D models
Four widget types you can add as many times as you like, each showing its own thing. Add one in Edit, choose a link or a file from this device, and give it a title if you like; tap its ⚙ in Edit to change it. Files are kept in the app's own storage on this device. They don't hide or pause while driving.
- **Document**:
  - **PDF**: a file or a link, drawn page by page with [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0, `vendor/pdfjs/`), with ‹ › buttons. Voice: “next slide”, “previous page”, “go to slide 5”.
  - **PowerPoint (.pptx)**: a file or a link, drawn here with [PptxViewJS](https://github.com/gptsci/pptxviewjs) (MIT, `vendor/pptx/`, loaded on first use), turned like a PDF (‹ ›, voice, links, a clicker on Stage). The slide's **speaker notes** are read too: the action **Present the slide's speaker notes** has the assistant say them. No animations, transitions, SmartArt or video, and fonts not on the device are substituted: save as PDF for an exact copy. A link the site won't let the app read falls back to Microsoft's viewer.
  - **Word or Excel, or PowerPoint links on SharePoint/OneDrive**: by **link**. SharePoint and OneDrive links open in their embed view; other links go through Microsoft's online viewer, which needs a link anyone can open. Word and Excel files on this device can't be shown in a web app: save them as PDF first.
  - **SharePoint links that need your work sign-in**: Safari and Chrome block signing in inside another app's frame, so in the web app these may ask you to open them instead. The **Mac app** lets them show in the widget.
- **Video**: a YouTube link (video, short, live, playlist; a `t=` start time is kept) in YouTube's privacy-enhanced player, or a video file or link (`.mp4`, `.webm`, `.m3u8`). Voice: “play the video”, “pause the video”.
- **Web page**: any `https://` address. Many big sites (Google, banks, most news) refuse to be shown inside another app; the ⤢ button opens them outside. The Mac app shows them anyway.
- **3D model**: a `.glb` file or a link to a `.glb`/`.gltf`, shown with Google's [model-viewer](https://modelviewer.dev/) (Apache-2.0, `vendor/model-viewer/`): drag to turn, pinch to zoom, slowly turning on its own.
  - **Built-in: Vita** (the default; anime-style VRoid sample model by pixiv, CC0, `vendor/models/vita.vrm`), drawn with [three.js](https://threejs.org/) and pixiv's [three-vrm](https://github.com/pixiv/three-vrm) (both MIT, one bundle in `vendor/three-vrm/`). She **talks with lip-sync** to the on-device reply voice (loudness opens the mouth, the sound picks the shape: a, i, u, e, o; with the phone's own voice the mouth simply moves while it speaks), **blinks**, breathes, **looks at you**, and reacts like the robot: waves when you start talking or tap her, leans in while listening, nods, gives a thumbs up, shakes her head and looks sad, looks surprised at a camera alert, and dances to the radio. **Built-in: Ren** is the male choice (the VRoid HairSample_Male model by pixiv, CC0, `vendor/models/ren.vrm`) and does all the same. Any **`.vrm` avatar** file or link works the same way, so a realistic VRM avatar can replace her later. She's drawn only while the dashboard is on screen (up to 30 frames a second) and counts 120 MB in the memory budget; if memory runs short she's put away with a **Show again** button.
  - **Built-in: Assistant robot** (CC0, by Quaternius with expressions by Don McCurdy; `vendor/models/`), the other built-in choice. It faces you and idles, and reacts: it **waves** when you start talking (or tap it), **nods** when it has heard you, gives a **thumbs up** for a done command or a new route, **shakes its head and looks sad** when it couldn't help, **jumps, surprised** at a camera alert, and **dances** when a radio station starts. Links can make it gesture (Wave, Yes, No, ThumbsUp, Dance, Jump) or pull a face (Surprised, Sad, Angry).
- Coming back to the dashboard from another screen keeps them exactly where they were (a video keeps playing, a document stays on its page).
- Links and voice commands can drive them: “Next page or slide”, “Go to a page”, “Show a document”, “Play/Pause the video”, “Show a video”, “Show a web page”, “Show a 3D model”. They also announce **A document changes page** and **A video ends**.

### Stage mode (presenting on a big screen)
**Settings › Mode: Drive / Stage** (or say “stage mode”, “presentation mode”, “drive mode”).
- **Drive** (the default): the car rules. The assistant avatar only changes its **expression**; no arm or body movement to catch the driver's eye. Cameras default to the **back** camera.
- **Stage**: for an iPad or computer mirrored to a TV, or a browser on the TV's PC. The avatar uses **full gestures**, the camera defaults to the **front** camera (or a webcam), and the dashboard gets the **Stage** layout:
  - the **content** (left, large: the sample demo deck at first; add any widget), the **presenter column** (right: the avatar, then any widgets, e.g. the Camera widget so the audience sees what it sees), and **captions** along the bottom: what you said and the reply, large enough to read across a room (Settings › Mode › Captions).
  - It adapts to 16:9 TVs, 4:3 (an iPad mirrored to a TV) and portrait.
  - A presentation **clicker** or the keyboard (→ ← Page Up/Down, space) turns the slides.
- **Safety**: on Stage, if the GPS says the car is moving, Drive rules apply until it stops.
- **Scripts** (Settings › Mode › Scripts): the assistant leads a presentation or demo. Each step can turn your slides, open web pages and run any widget action, has a line the assistant says (with `{notes}`, the slide's speaker notes) with an expression and a gesture, and moves on when you say a phrase (“next”), show a hand gesture, press the clicker or after a pause; branches jump elsewhere (“show me the live data”). Presenting goes wrong sometimes: “go back”, “back two steps”, “start over” and the step dots (tap for a list of every step) always work, and going back puts the deck and pages where they were at that step. Make scripts in the editor (with a help page), or download the sample as a template, edit it and upload it. The sample presents the demo deck beside a live web page. Format: [docs/scripts.md](docs/scripts.md).
- **Web steps** (record and replay clicks on your own web pages): in a script step, **Record web steps** shows the page in a web widget with a recording bar; click and type as you will in the demo, then **Done**. Add the recording as **separate steps** (each can sit between the assistant's lines, slides and other actions) or as **one sequence** (one action plays them all, also from voice commands and links). On replay a pointer glides to each element and a ring marks the click, so the audience can follow; each step checks the page changed as recorded (e.g. the `#live` tab). Going back in a script replays them quietly so the page is where it was. Each step is found again by `data-testid`, id, CSS path, text or position, so give your controls a `data-testid` and replays survive layout changes. **Password-like fields are never recorded**: the replay stops there for you to type. Pages served with DriveDeck (like the sample live page) work as they are; pages on your own site elsewhere need one line, the DriveDeck bridge, which only answers the DriveDeck addresses it lists ([bridge/README.md](bridge/README.md)). Settings › Scripts › Recorded web sequences lists, plays and deletes them.
- **Follow the presenter** (Settings › Mode, on Stage): the Stage camera watches the room with [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache-2.0, vendored in `vendor/mediapipe/`, in its own worker, about 80 MB of memory): hands and their gestures, body pose and faces. **Whoever shows the claim gesture** (default: an open palm, then a fist; Settings › Mode › Claim gesture) **becomes the presenter**: the assistant greets them, **looks at them** (head and eyes follow them around the room), and acts on **their** hand gestures only (a script can move on with a thumb up, a swipe…). Someone else takes over by showing the same sequence. The presenter is kept through a moment out of view (found again by place and clothing colour). **Only listen to the presenter**: in a conversation, speech counts only while the presenter's mouth is moving, so the audience isn't taken as commands. **Blur other faces** blurs everyone else in the Camera widget. Nothing is stored; it all stays on the device. Put the **Camera widget** in the presenter column to show the audience what the models see, live: skeletons, hands with their gesture, face boxes, the presenter's tag, claim progress, and how long each model takes. Settings › Logs › People tracking computes on can force the CPU.
- **Settings › Cameras**: the camera for each mode: front, back, or any attached camera by name. Front cameras and webcams are shown as a mirror (the boxes follow, labels stay readable). AR always uses the back camera.

### Camera and object recognition (offline)
- **Camera widget** (add it in Edit): the rear camera with boxes around what it recognises and a line saying what it sees, e.g. “a person and 2 cars”. Tap **Start camera** once; it starts again by itself next time. **AR mode** draws the same boxes over its camera view (the two share one camera).
- Recognition runs **on the device, offline**, in its own background worker and within the memory budget, on 2–5 frames a second, each frame shrunk before it's checked. Two models, chosen in **Settings › Camera & objects › Recognition model**:
  - **YOLOv10 nano** (default): the fastest; licence **AGPL-3.0**.
  - **D-FINE nano**: more accurate, a little slower; licence **Apache-2.0**.
  - Both know the 80 everyday COCO objects: people, cars, trucks, buses, bikes, motorbikes, animals, traffic lights and stop signs among them. They don't read speed-limit or other signs. The model downloads once (about 10–15 MB) and is cached.
- **Spoken alerts** (off until you turn them on): “Person ahead.”, “Dog on the left.” for the objects you pick in **Alert for**, when one is close (big in the frame; traffic lights and stop signs at any size), at most every 10 seconds per kind. Alerts never talk over the assistant. Voice: “turn on object alerts”, “turn off object alerts”.
- **“What do you see?”** (also “what's ahead?”, “describe the road”): answered from the live view, e.g. “I can see a person ahead and a car on the left.” If the camera isn't on, DriveDeck takes a quick look and turns it off again. **Answer “what do you see?”** in Settings turns this off.
- For links: **The camera sees something new** (carries a summary) and **The camera spots an alert object**; actions **Start/Stop the camera widget** and **Say what the camera sees**.

### Widget links (one widget drives another)
- **Settings › Dashboard › Widget links**: *when* something happens, *do* an action. Events: a route starts, you arrive, a route ends, the car starts moving or stops, a screen opens, you say something, a voice command runs, a station starts or stops, the assistant starts or finishes listening. Actions: play a station, next station, stop the radio, show the stations, say something, run a voice command, navigate somewhere, end the route, open a screen, show a widget page, play or pause music.
- **{value}** in the action stands for what the event carries (the destination, the station, the words heard). **Only when it carries these words** limits a link, e.g. only routes to “Office”. Three examples are included, switched off.
- The same actions are available to voice commands: **Settings › Voice commands › Then › Do a widget action**. For example, make “my station” play a chosen station.
- A link can set off other links, three deep at most, and no link runs more than 3 times in 10 seconds, so links can't loop.
- Widgets also react to app events themselves (the radio pausing while you talk is one).

### Debug mode and logs (for testing, hidden from ordinary users)
- Open the app with `?debug=<key>` in the URL, e.g. `https://vchahalibm.github.io/CarPWA/?debug=<key>`. In the installed app, which has no address bar, go to **Settings**, tap the **DriveDeck** version row 7 times and enter the key. `?debug=off` or **Turn off debug mode** switches it off and deletes the log.
- **Settings** then gets a **Logs** tab:
  - **Voice diagnostics**: what this device supports, and whether the listening and reply voices are loaded. There are buttons to test the on-device voice and the phone voice, now or after 3 s without a tap (like a real reply), and to test the microphone. Switches choose where the on-device voice runs (a background worker by default, which keeps the app smooth and starts speech sooner, or the main thread), what it computes on (CPU, or GPU via WebGPU where available: faster, but about 310 MB to download), how it plays (audio with a data URL by default, audio with a blob URL, or Web Audio) and the audio mode while replying (playback, auto, transient).
  - **Compare speech recognition**: say a displayed phrase once. The phone's recognizer listens while the app records you, then Whisper recognises the same recording on the CPU and (where WebGPU exists) the GPU. A table shows what each heard, how long after your last word the result was ready, the share of words right, and the command it would trigger. **Whisper computes on** switches normal listening to the GPU (about 140 MB more; falls back to the CPU if it fails).
  - **Memory**: how much memory this device may give on-device models (phone 400 MB, tablet 1.1 GB, computer 3.2 GB; each model build has an estimated size), what's loaded now, and any model build skipped because the app was killed while loading it. iOS closes a web app that uses too much memory, so on a phone the reply voice and the camera's detector fit together while Whisper (if chosen) takes turns with them, and each model runs in its own background worker that is ended when unloaded. **Device class** overrides the detected class; **Forget the crash history** tries skipped builds again.
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

## Desktop app (Mac)

The same app as a Mac app, for a laptop or a car computer. There are no separate sources: `desktop/main.js` opens the web files in an Electron window. Differences from the web version:
- **Memory**: a computer gives on-device models 3.2 GB (a phone 400 MB), so listening, the reply voice and camera models run together.
- **Listening**: always Whisper on the device. Chromium's built-in recognizer needs a Google key that Electron doesn't have. On a Mac, Whisper runs on the GPU.
- **Files**: the app's files ship inside the app, so it opens offline from the first launch. Models download on first use and stay cached, as on the web.
- **Other apps**: music, maps, messages and shortcut links open the Mac's own apps (or the web page when there's no app).

**Get it:** open **Actions › Desktop app** on GitHub, pick the latest run and download **DriveDeck-mac**. It contains a DMG for Apple silicon (`arm64`) and one for Intel (`x64`). Pushing a tag like `desktop-v0.4.0` also publishes the DMGs as a GitHub release. The app isn't notarised (that needs a paid Apple developer account), so after dragging it to Applications run `xattr -cr /Applications/DriveDeck.app` once in Terminal, or right-click it and choose **Open**. macOS asks once for the microphone and camera. Live location depends on Electron's location support on the Mac; without it, the map and demo drive still work.

**From source:** `cd desktop && npm install && npm start`. `npm run dist` builds the DMGs; this needs a Mac.

The desktop app doesn't update itself: download the new DMG to update. The web version updates on its own.

## Deployment (GitHub Pages)

The repo is published as-is from the `main` branch. There is no build step, and `.nojekyll` makes GitHub serve the files unprocessed. Every push to `main` goes live at `https://<owner>.github.io/CarPWA/` within a minute or two.

One-time setup: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then **Branch: `main`**, folder **`/ (root)`**, and **Save**.

`.github/workflows/ci.yml` checks every push and PR (JS syntax, manifest, service-worker precache list).
