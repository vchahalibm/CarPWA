# Scripts: avatar-led presentations

A script has the assistant lead a presentation or demo on Stage (Settings › Mode › Stage). It is JSON, made in
**Settings › Scripts** (an editor with its own help page) or in any text editor and uploaded there. `js/script.js`
holds the format check (`scriptCheck`), the runner (`Script`), saved scripts (`Scripts`) and the editor (`ScriptUI`).

```json
{
  "name": "My demo",
  "about": "What it presents",
  "setup": [ { "do": "mode.set", "value": "stage" }, { "do": "doc.open", "value": "https://example.com/deck.pptx" } ],
  "beats": [
    { "id": "intro", "title": "Welcome",
      "do": [ { "do": "doc.page", "value": "1" } ],
      "say": "{notes}", "mood": "Happy", "gesture": "Wave",
      "next": { "on": ["next", "continue"], "gesture": "Swipe_Left", "key": true, "after": 0, "event": "", "goto": "" },
      "branches": [ { "on": ["show me the live data"], "gesture": "", "goto": "live" } ] }
  ]
}
```

- **setup**: steps run once at the start (and replayed quietly when going back).
- **beats** (steps), in order. Each:
  - `do`: steps, each `{ "do": <action id>, "value": "…" }`, `{ "say": "…", "mood", "gesture" }` or `{ "wait": ms }`. Any action in
    `Actions.list` works (documents, web pages, radio, navigation, `say`, `cmd` to run a voice command, `stage.widgets` to
    arrange the Stage layout, `wait`…). Async actions (a page that has to load) are awaited.
  - `say`: the assistant's line, spoken with lip-sync and shown as a caption. `{notes}` is the current slide's speaker notes,
    `{page}` its number.
  - `mood` (Happy, Sad, Angry, Surprised, Relaxed) and `gesture` (Wave, Yes, No, ThumbsUp, Dance, Jump) as it starts.
  - `next`: what moves it on: a phrase in `on`, a hand gesture (Open_Palm, Closed_Fist, Thumb_Up, Thumb_Down, Pointing_Up,
    Victory, ILoveYou, Swipe_Left, Swipe_Right; from the people tracker), the clicker/→ (`key`, on by default), an app event
    (`event`, any Bus event), or a timer (`after`, seconds). `goto` jumps to a beat id instead of the following beat.
  - `branches`: other phrases or gestures that jump to a beat.
- While a script runs: “next”, “go back”, “back two steps”, “start over”, “repeat that”, “stop the demo”; → ← Page Up/Down
  Home; the step dots on Stage (tap for a list to jump anywhere). Every other voice command still works.
- **Going back** replays the setup and the earlier beats' `do` steps quietly (no speech, no waits), then plays the beat. Write
  actions that set a state (`doc.page 3`, `web.open <url>`) rather than relative ones (`doc.next`) so this lands right.
  Opening the document or page that is already shown does nothing, so replays are quick.
- Events: `script.beat` (each step, with its title) and `script.end`. Actions: `script.run`, `script.next`, `script.back`,
  `script.restart`, `script.goto`, `script.stop`, `stage.widgets`, `wait`.
- The sample (`SAMPLE_SCRIPT`) presents `samples/drivedeck-demo.pptx` beside `samples/demo-page.html`, a live page whose tabs
  follow its `#hash` and whose controls carry `data-testid`s for recorded clicks.
- **Web steps** (`js/webdrive.js`): `web.step` (value: a recorded step, JSON `{ "t": "click"|"type", "loc": { testid, id, css,
  tag, role, text, name, x, y }, "value", "expect" }`), `web.play` (a named recorded sequence, kept in `dd.webRecs`) and
  `web.click` (by text or data-testid). Recorded in the editor (Record web steps) on the page in a web widget. Same-origin
  pages are driven directly; other pages need `bridge/drivedeck-bridge.js` with `data-allow` listing DriveDeck's origin.
  Shown replays move a pointer and draw a ring; quiet ones (going back) don't. Password-like fields are never recorded.
- **App steps** (`js/appsteps.js`): `app.step` (value: a recorded step, JSON `{ "t": "click"|"drag"|"type"|"select"|"key"|"scroll"|"web"|"wait",
  "loc": { wid, scope, tag, data, id, label, text, name, ph, path, fx, fy, wx, wy, view }, … }`: `drag` has `to` [x, y] window fractions and
  `ms`; `type`/`select` a `value`; `key` a `key`; `scroll` `top`, `left`, `frac`; `web` a widget id `wid` and a Web step `step`),
  `app.play` (a named recording in `dd.appRecs`) and `app.click` (by label or text, or `x,y` fractions). Recorded from Settings ›
  Scripts › Record a new script (a one-step script whose actions are the recording, with `wait`s where you paused) or a step's
  Record app steps. Replays glide a pointer, show a pulsating dot at each click, and use real input in the desktop app
  (`DriveDeckDesktop.input` / `insertText`); a covered spot is clicked on another visible part of the element, or directly.
- Floating widgets: `widget.float` (`camera` or `model~id`, then optional `x,y,w,h` fractions) and `widget.dock`.

## Steps made in the editor

- `{ "say": "…" }`: the assistant says it (with `{notes}`), lip-synced, captioned.
- `{ "do": "avatar.gesture", "value": "PointLeft" }`: a motion from `MOTIONS` (js/motions.js); a beat's `gesture` takes the same names
  (older ones like `Yes`/`No` still work). `{ "do": "avatar.pointAt", "value": "doc" }` points at a widget (id or type) or
  left/right/up/down, choosing the arm and direction from where it is.
- App steps found by **text on screen**: `"loc": { "match": { "text": "Next page" }, "wx": 0.5, "wy": 0.5 }` (visible text,
  labels and titles, same-site frames and web widgets; nearest to wx/wy wins ties), or by **a picture of an area**:
  `"match": { "img": "<data URL>", "w": 68, "h": 68, "at": [x, y] }` (template matching on a picture of the window; the
  desktop app takes it itself, the PWA shares its tab once). Editor-made scrolls use `"amount": "down" | "up" | "top" | "bottom"`.
- More targets: `"match": { "ai": "the Search button", "in": "web" }` (the screen model, js/screenmodel.js: words read
  on screen first, then phrase grounding; `in` limits it to a widget), `"match": { "det": "button" }` (your own detector:
  the nearest element of that kind to `wx`/`wy`). `"optional": true` on an app step: if it isn't there, carry on quietly.
- In browser widgets (desktop app) clicks, typing and keys go to the page itself; text is found inside it; pictures match
  against the page's own capture.
- The sample **IndiGo live booking demo** (`INDIGO_DEMO` in js/script.js) uses all of these on goindigo.in.
