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
