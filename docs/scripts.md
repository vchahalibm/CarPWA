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

## Bundles (sharing)

`{ "format": "drivegen-bundle", "version": 1, "name", "app", "created", "scripts": [{ "name", "json" }], "motions": { name: motion },
"helpers": [{ name, match, css, js, on }], "webRecs": [...], "appRecs": [...] }` (js/bundles.js). Export includes what the
scripts use (`Bundles.uses`); import renames clashes and rewrites the references. The library is an index:
`{ "bundles": [{ "name", "about", "url" (relative to the index), "author" }] }`, by default `library/index.json` on GitHub Pages.

## Variables, conditions, loops and background steps

Any text in a step can use `{name}` (dots reach into objects: `{result.rows}`; `{time}` and `{date}` are built in).

- `{ "set": "n", "value": "3" }`: remember a value (numbers stay numbers, JSON is parsed, `{k} - 1` is worked out).
- `"as": "result"` on an action step keeps what it gives back (`brain.ask`'s answer, later an OS task's output); a failure
  goes into `{result_error}`.
- `{ "if": "{n} > 3", "then": [ … ], "else": [ … ] }`: conditions compare with `==, !=, >, <, >=, <=, is, is not`, or say
  `{x} contains Paris`, `{x} is empty`, joined with `and` / `or`.
- `{ "repeat": "3", "steps": [ … ] }`, `{ "until": "{done} is yes", "steps": [ … ] }`, `{ "each": "{rows}", "as": "row", "steps": [ … ] }`
  (a list variable or comma-separated text; `{index}` counts the rounds; at most 1000).
- `{ "goto": "beatId" }` jumps (also backwards: a loop over steps); `{ "stop": true }` ends the script.
- **Background**: `"background": true` on an action step runs it as a job: the script carries on (the assistant keeps
  talking or listening), `"then": [ … ]` runs when it's done (after the current sentence), `"else": [ … ]` if it fails,
  `"name"` names it; `{ "await": "name" }` (or `"all"`) waits for it; the event `script.job` fires; the Stage bar shows
  what runs.

## Interactive scripts

`"mode": "interactive"`: no timeline. It runs `setup` (a greeting), listens (conversation mode; `"listen": false` to
leave the microphone to you), and when what you say matches an intent, does it, then listens again until you end it.

```json
{ "name": "Desk helper", "mode": "interactive",
  "setup": [ { "say": "Hi! What can I do?" } ],
  "intents": [
    { "id": "sales", "title": "Show sales", "on": ["show sales for {month}", "sales"], "ask": { "month": "Which month?" },
      "say": "Here are the sales for {month}.", "steps": [ { "do": "…", "value": "{month}", "as": "rows" } ] } ],
  "fallback": [ { "say": "Sorry, I can show sales or the time." } ],
  "idle": { "after": 90, "steps": [ { "say": "I'm here if you need me." } ] },
  "end": { "on": ["that's all", "goodbye"], "steps": [ { "say": "Talk soon!" } ] } }
```

- An intent starts on one of its phrases (`{slot}` catches words; loose matching when most of the phrase's words are
  there), its hand `gesture`, or an app `event` (with `{event}` = what the event carried).
- `ask`: questions for slots still missing; the next thing you say is the answer ("two" counts as 2).
- `{ "intent": "id" }` runs another intent from a step.
- Nothing matched: with **Understanding** (Settings › Assistant: Claude with your key, or an OpenAI-compatible server such
  as a local Ollama) a language model picks the intent and fills its slots, or answers briefly; otherwise `fallback`.
- The action `brain.ask` (“Ask the model”) asks the model anything from a step; keep the answer with `as`.

## Tasks on this computer (StudioGen on a Mac)

`{ "do": "os.applescript" | "os.jxa" | "os.shortcut" | "os.shell", "value": "<code, or the Shortcut's name>", "args": ["{month}"], "as": "result", "timeout": 60 }`

- The code runs as written in the desktop app (desktop/tasks.js). Values go in as **arguments**: AppleScript
  `on run argv` (`item 1 of argv`), JXA `function run(argv)` (`argv[0]`), shell `"$1"`, a Shortcut's input; never pasted
  into the code, so nothing someone says can become code.
- The first run of each piece of code shows it in a native dialog: **Run once**, **Always allow this code** (remembered
  by its SHA-256; changed or imported code asks again) or **Don't run**. Settings › System › Tasks you always allow.
- The output is text, or data when it prints JSON; a failure sets `{result_error}`. Mark it `background` to keep talking
  meanwhile. macOS asks once per app a task controls (Automation).
- Ready-made tasks are in the editor's picker (This computer). DriveGen will run them through a paired StudioGen.

## The agent's steps (js/agent.js)

Tasks of the agent library are scripts like these, with inputs (`params`) filled from what was said. The steps work in any script:
- `agent.open` (a web address in StudioGen's agent browser; `?name=value` inputs go into the address, `wait=<selector>`, `site=<name>` to ask for a sign-in), `agent.read` (selectors to read, `||` between choices; the whole page if none fit), `agent.wait`, `agent.click` (by text, or `sel=`), `agent.type` (a field by label, the text, `enter`), `agent.key`, `agent.show`, `agent.fail` (stop with a message), `agent.task` (run another task: `name=value` inputs; a composite).
- `ai.card` (the model makes a card `{ headline, items: [{ title, detail, when, place, person }] }` from text: `{ "do": "ai.card", "value": "what to pull out", "args": ["{read}"], "as": "card" }`), `ai.when` (a spoken time → `{ start, end }`).
- `car.park`, `car.findcar`, `car.eta`. Use `{read}` (not `{page}`, which is the slide number) for page text.

## Data (the data widget)

- `{ "do": "data.csv", "value": "samples/sales.csv", "as": "rows" }`: a CSV, TSV or JSON link, or a path on this computer
  (StudioGen; the first read of each file asks). The rows go into the data widget (one is added when there's none) and `as`.
- `{ "do": "data.sql", "value": "SELECT region, SUM(revenue) AS revenue FROM sales WHERE month = ? GROUP BY region", "args": ["~/data/sales.sqlite", "{month}"] }`:
  SQLite in StudioGen, **read-only**; the query is used as written and the inputs after the file are bound to each `?`.
- `{ "do": "data.show", "value": "{rows}" }`: rows from an earlier step (a task's JSON, the model's answer, CSV text).
- `{ "do": "data.chart", "value": "bar of revenue by region" }` or `type=line x=month y=revenue,units agg=sum sort=desc top=5 view=chart`
  (types bar, line, pie, doughnut, scatter, none; agg none, sum, avg, count, min, max; sort none, x, desc, asc; view both, chart, table).
- `{ "do": "data.summary" }` says a few sentences about the data (rows, totals, averages, ranges, the top label); with `as` it's kept, not said.
