# MuseTester

**The apps' main tester.** It covers StudioGen, DriveGen, Workers and the mesh: watchers, map watchers, tasks, scripts, Stage, the voice, the dashboard, memory, and the tandem journeys (pairing, the mesh, shows, remote view, Workers, StudioGBee) from tests/tandem/journeys.mjs, run as MuseTester tests.

MuseTester runs the try-it-out list (docs/TasksNeedingComeBack.md) for you. It drives StudioGen, its Workers and
DriveGen the way you would: it opens the app, makes watchers, presses buttons, types, waits for cards, and takes
pictures. Then it writes a report and, if you ask, ticks the items that passed.

```
node tools/musetester/muse.mjs                                 # the panel, with every test (a throwaway profile)
node tools/musetester/muse.mjs practice watchers               # the panel, with the tests tagged practice or watchers
node tools/musetester/muse.mjs --silent                        # every test, no panel, StudioGen's window hidden
node tools/musetester/muse.mjs --list                          # the tests
node tools/musetester/muse.mjs --profile mine --restart-mine   # the tests that need your accounts (Slack, Outlook, X…)
node tools/musetester/muse.mjs --profile mine --silent --mark  # …on their own, ticking what passed in the try-it-out list
```

## Two ways to run

**Interactive** (the default): a control panel opens in its own window, beside StudioGen's (and DriveGen's, for the
DriveGen tests). It lists the tests. Open one to see its steps, coloured as they go:

- **grey**: to run;
- **blue**: running (or the next one, waiting for you);
- **green**: passed;
- **red**: failed (its note says why; a picture is taken).

**Run all** runs every test; **Run** on a test runs that one. **In one go** runs the steps straight through; **Step by
step** waits for **Next step** before each, so you can watch the app do it. **Pause** stops before the next step. When a
step fails you choose: **Try it again** (after fixing something by hand, say), **Skip it**, or **Stop this test**.
Steps that need you (“drive to…”, “tap … on your phone”) show **Your turn** with Done or It didn't work. **End
MuseTester** closes it.

**You see it happen** (show mode, the default when interactive): MuseTester works the app the way you would, like an
RPA robot you can watch.
- A **pointer** moves to each button, rings it in blue and clicks it with real mouse input. Typing appears letter by
  letter (real key input).
- A **caption** at the top of each app window says the test and the step.
- Watchers are **made through the screens**: 👁 Watchers › + New watcher › the template › its fields › Check and save.
  Templates that need a file picker, a tap on a page or the map form are set up directly; the caption says so.
- Each **check** points at the watcher's Check now, and the **agent browser's panel** shows the page it reads (your
  Slack, Outlook, WhatsApp, Google Maps…), then steps aside for the next clicks.
- Commands are typed into the Agent screen's **Ask box** when it's on screen.
- `--speed 2` goes twice as fast, `--speed 0.5` half as fast; `--no-show` keeps the windows but drives by code.
- Mesh tests show every device's window with the caption; their steps are commands said through each app.

**Silent** (`--silent`): no panel; StudioGen starts with its window hidden (app 0.18.5 or later; an older app shows it),
DriveGen runs headless, steps that need you are skipped. For a run on its own; read the report and the run log after.

## The run log (send it to Claude)

Each run writes `reports/<time>/muse-log.md` (and the same as `muse-log.json`). Hand it to Claude as it is: it's
written to be read without anything else.
- **Summary:** the machine, app and web versions, profile, every test's result and where it failed.
- **How long checks take** per watcher kind: for scaling.
- **Each test's steps** with times, the failures in full, and the app's state after it: every watcher (source, kind,
  how often, its last check's time, items read, failures, healing, live back-off), every agent-browser window and when
  it last loaded, storage and its largest keys, the page's errors, and the DevTools performance metrics (heap, elements,
  listeners, script and task time).
- **A run book:** what to look at for failures, slowness, growth and crashes.
- **The debug log** written during the run (when Settings › System › Debug log is on), and any crash reports.

Options:
- `--app installed|dev`: the installed StudioGen (the default when it's there) or the one in `desktop/`, which has
  today's code.
- `--auto`: steps that need you are skipped instead of asked.
- `--headful`: shows DriveGen's Chrome window.
- `--keep`: leaves StudioGen open after the tests.
- `--skip docker,llm`: leaves out tests with those tags or ids.

Reports are in `tools/musetester/reports/<time>/report.html` (the newest 10 runs, not committed).

## How it drives

| What | How |
|---|---|
| StudioGen's own page | The DevTools protocol. StudioGen is started with `--remote-debugging-port` on 127.0.0.1. The steps call the app's own code (`Watch`, `Agent`, `MapWatch`…), so no test logic is duplicated. |
| The agent browser's pages (what a watcher sees) | Each `<webview>` is a DevTools target of its own: `web.expect` reads it. |
| DriveGen | Chrome (headless unless `--headful`) with the phone or iPad screen, touch and user agent, and the web files served locally by MuseTester. |
| macOS itself | AppleScript (`osascript`): menus, keystrokes (`native.keys`), other apps. Keystrokes need System Settings › Privacy & Security › Accessibility for your terminal. |
| You | `human` steps say what to do (a real drive, your phone) and wait for Enter. |

## Profiles

- **scratch** (the default): a throwaway StudioGen profile, deleted afterwards. With `"practice": true` it uses the
  practice sites in `labs/practice/`. `practice.signin` signs in to them.
- **mine**: your own profile, with your sign-ins. These tests run only with `--profile mine`. StudioGen must not be
  open with your profile: either quit it, or pass `--restart-mine` and MuseTester quits it and opens it again
  afterwards. Watchers that tests make are named “MuseTester …” and removed in `cleanup`. If a test switches the
  practice sites on, your setting is put back when it ends.

The debugging port listens on 127.0.0.1 only, and only while a test runs.

## Your names

Copy `muse.config.example.json` to `muse.config.json` (it isn't committed) and set your channel, the person, the search
words and the route. Tests use them as `${slackChannel}` and so on. A value that is only `${name}` keeps its type, so a
route's `to` stays an object.

## A test

A test is one JSON file in `tests/`:

```json
{
  "id": "practice-slack", "title": "Slack watchers on the practice Slack", "tags": ["practice", "slack"],
  "profile": "scratch",
  "tryitout": ["Slack: Check now on New Slack mentions"],
  "steps": [
    { "do": "launch", "practice": true, "why": "Open StudioGen" },
    { "do": "practice.signin" },
    { "do": "watch.make", "template": "slack.mentions" },
    { "do": "watch.check", "name": "New Slack mentions" },
    { "do": "expect", "var": "check.count", "gte": 1, "why": "It read the Activity rows" }
  ],
  "cleanup": [{ "do": "watch.delete", "name": "New Slack mentions" }]
}
```

- `tryitout` holds the start of the try-it-out lines this test covers: `--mark` ticks them when it passes.
- Every step can have `why` (shown in the report), `on` (which app: `studio` by default, `phone`, or a name given with
  `as`) and `optional` (a failure doesn't stop the test).
- The steps stop at the first failure (a picture is taken). `cleanup` always runs.

### Steps

| Step | Does |
|---|---|
| `launch` | Opens StudioGen. `as` (name, default `studio`), `profile`, `practice` (true/false), `app`, `env` (e.g. a Worker's `SG_NAME`, `SG_LIGHT`), `port`, `folders` (folders a file watcher may read, as if picked). Opening it again after `quit` keeps the same profile (a restart). |
| `drivegen` | Opens DriveGen in Chrome. `device` (`iphone`, `ipad`, `ipad-portrait`), `settings` (DriveGen settings to start with), `url` (default: the local files), `as` (default `phone`). |
| `quit` | Closes an app (`as`). |
| `wait` | `s` seconds. |
| `view` | Opens a screen (`name`: `agent`, `settings`, `home`, `dashboard`…). |
| `say` | A typed command, as if said (`text`). |
| `click` | Clicks by `text` (buttons, tiles, chips, links), by `sel` (CSS), or `sheet: true` (the open sheet's buttons). |
| `type` | Types `text` into `sel`; `enter: true` presses Enter. |
| `key` | Presses `key` in the page. |
| `practice` | Turns the practice sites on or off (`value`). |
| `practice.signin` | Signs in to the practice Slack, WhatsApp, Teams and X. |
| `practice.incoming` | Changes a practice site: `site` (`slack`, `whatsapp`, `teams`, `x`, `shop`…), `text` (a new message in the site's `?incoming=` form) and/or `query` (other parameters, e.g. `price=11499&stock=5` for the shop). |
| `watch.make` | A watcher from a template: `template`, `inputs`, `name`, `set` (any fields: `from`, `to`, `every`, `look`…). |
| `watch.check` | Checks it now (`name`). The result `{ hit, error, count, trace, url }` goes in the variable `check` (or `as`). A check with an error fails the step unless `ok: false`. |
| `watch.set` | Changes a watcher's fields (`set`: `on`, `every`, …). |
| `watch.delete` | Deletes watchers with that `name` (`prefix: true`: every name starting with it). |
| `fixture` | Serves a page MuseTester controls at `${fx.<name>}`: `html`, or `items` (a list, rows `#list .row`), or `rss: true` with `items` (`title`, `text`), or `json`; `feed` (a page naming a feed). Set it again to change what it says. |
| `file` | Writes `text` to `path` (or `remove: true`), for folder watchers. `${tmp}` is the run's own folder. |
| `errors.none` | No errors in the page since it opened (`ignore`: words of errors to let pass). |
| `task` | Runs an agent task (`id`, `inputs`). Its card goes in `card` (or `as`). |
| `eval` | Runs `js` in the app's page; the value goes in `as`. |
| `until` | Waits until `js` is true (or meets `equals`, `contains`, `match`, `gte`, `lte`), up to `timeout` s. |
| `expect` | Checks `var` (a variable, e.g. `check.hit.headline`), `js`, `sel` (shown on screen) or `text` (anywhere on screen) with `equals`, `contains`, `lacks`, `match`, `gte`, `lte` (none of these: it must be true). |
| `web.expect` | The same on a page of the agent browser (`host`: part of its address; `js`, default its text). |
| `screenshot` | A picture of the app (`name`). |
| `responsive` | For `seconds`, asks the app something every `every` s; fails if an answer takes over `maxMs` (a hang). |
| `crash.none` | No StudioGen crash report since the run started. |
| `log` | The debug log (Settings › System › Debug log on) `contains`/`lacks`/`match`. |
| `native` | Runs `applescript`. |
| `native.keys` | Types `text` into an app (`app`, `using`: e.g. `command down`). |
| `human` | Shows `say` and waits for you (Enter: done; n: it didn't work). |

`${name}` in any value comes from your config or from an earlier step's variable.

## The library

| Test | Profile | What it checks |
|---|---|---|
| app-health | scratch | Several live watchers for two minutes: StudioGen keeps answering, no errors, a clean quit |
| commands-cards | scratch | Commands: the weather and the time give answers; on Stage a screen opens as a card |
| dashboard-bundles-tasks | scratch | The dashboard's widgets, a script bundle out and back in, and an agent task imported from JSON |
| drive-real | mine | A real drive: news on the phone, Take it, the next town (you drive, it watches) |
| drivegen-ipad-settings | scratch | DriveGen on an iPad (landscape, Agent screen as home): Settings opens from the app grid |
| drivegen-iphone | scratch | DriveGen on an iPhone: the app grid, the map, a demo drive, a command's card |
| drivegen-roadlocal | scratch | DriveGen with no Mac: it looks ahead itself while navigating |
| fx-feeds-json | scratch | Feeds, a page's own feed, and JSON numbers |
| fx-filters-chain | scratch | Filters (ignore, only from), the change history, and one watcher's news feeding another |
| fx-page-kinds | scratch | Every kind of page watcher on fixture pages: new, gone, changes, words, a number, a count, a pattern |
| mac-folder | scratch | A folder on this Mac: new files are told |
| map-along | scratch | Along the way: fuel on the practice Google Maps, the weather, the next town, 10 minutes away |
| memory | scratch | Memory: remember, recall, forget (downloads EmbeddingGemma, 318 MB, the first time) |
| mesh-basic | scratch | The mesh, basic: two StudioGens and a phone pair, form a mesh, and run a show on every screen |
| mesh-bee | scratch | StudioGBee: requests wait at the bee for an offline member, sealed; another team's bee can't read them |
| mesh-core | scratch | The mesh, in full: pairing with a phrase, the direct link, sharing, relays only, tasks through the Mac, permissions, own devices, remote view, tasks side by side, shows |
| mesh-meaning | scratch | Understood by meaning through the Mac's language model (on the phone and on the Mac) |
| mesh-trouble | scratch | The mesh in trouble: a dead relay first, a member quitting and coming back, a changed secret, a removed member |
| mesh-worker | scratch | A StudioGen Worker in Docker joins as yours and runs tasks for your phone |
| mine-outlook-live | mine | Your Outlook: New mail reads, and a live New mail watcher keeps StudioGen responsive |
| mine-quit-clean | mine | Quitting with the built-in model loaded leaves no crash report |
| mine-slack | mine | Your Slack: mentions, a channel, DMs, threads and a search |
| mine-x-lookahead | mine | Lookahead reads X with your sign-in |
| practice-calendar-x | scratch | The practice calendar (added, moved, cancelled) and practice X (a search, an account) |
| practice-lookahead | scratch | Lookahead on the practice Google Maps and news: finds the protest, offers the other way with its map |
| practice-mail-chat | scratch | Outlook, WhatsApp and Teams watchers on the practice sites |
| practice-shop | scratch | Shopping on the practice shop: a price below a line, back in stock, and a redesigned page healed |
| practice-slack | scratch | Slack watchers on the practice Slack: mentions, a channel by Jump to, DMs, threads, a search |
| practice-tasks | scratch | Agent tasks on the practice sites give cards: mail, calendar, Slack, WhatsApp, Teams |
| real-route | scratch | The real Google Maps: routes, turns and avoid roads by place (no sign-in needed) |
| scripts-interactive | scratch | An interactive script: an intent by its phrase, a slot, a question for a missing slot, the end phrase |
| scripts-run | scratch | Scripts: beats, variables, conditions, a loop, a jump, and stopping |
| settings-tabs | scratch | Every Settings tab opens without errors |
| stage-mode | scratch | Stage mode: the mode switch, a script on Stage moved on by “next”, a command's card, and back to Drive |
| voice-phonon | scratch | The natural voice (Phonon) downloads, loads and speaks |
| watcher-lifecycle | scratch | Watchers: pause, resume, export and import, the counter, and they carry on after a restart |

The scratch ones run anywhere (the practice sites, fixture pages, the public Google Maps and weather); the mine ones need your accounts. Tags (`--list`) pick groups: practice, watchers, kinds, slack, maps, mesh, scripts, stage, drivegen, health, real, slow (long or big downloads), docker (needs Docker: the Worker and StudioGBee images), llm (needs a language model). On 4 Nov all 31 scratch tests passed (`--skip` nothing), the mesh ones included.

## The mesh: tandem journeys

A test with `"journey"` runs acts of a journey from `tests/tandem/journeys.mjs` (where journeys are written: the same
file the old tandem runner used):

```json
{ "id": "mesh-core", "journey": "demo", "acts": ["setup", "pair", "mesh", "shared", "show"], "title": "…",
  "devices": { "A": { "label": "Studio A" }, "B": { "label": "Studio B" }, "P": { "label": "Test iPhone", "kind": "phone" } },
  "then": [ { "do": "eval", "on": "devA", "js": "Tandem.state()" } ] }
```

- The devices are MuseTester's apps: StudioGens with throwaway profiles (the practice sites on), and DriveGen in
  Chrome as a phone. `devices` is optional (the three above). Each is prepared as the tandem runner did: named, the
  voice's replies kept in the log instead of spoken, the Mesh screen open.
- Each journey step is a row: its action runs (said through the command matcher, as if spoken), then its check is
  asked every second until true or its wait runs out. A said step (a command) whose check isn't true a third of the way in
  is said once more (the others weren't online yet); other actions are done once. Steps only a person can do show “Your turn” (skipped when
  silent).
- `then` adds steps after the journey, on a device by `on`: `devA`, `devB`, `devP`.
- The acts: setup, pair, mesh, shared, road, meaning (a language model), agent, ask, own, remote, parallel, worker
  (Docker), bee (Docker), show, trouble, housekeeping, review. `tests/tandem/run.mjs` still runs them on its own (with the
  iOS Simulator's Safari as the phone), but MuseTester is where they're kept and run.

## Adding tests

Most try-it-out items are a few `watch.*`, `say`, `click` and `expect` steps. Things that need a phone or a car are
`human` steps, so a run still records them. For Workers, `launch` a second StudioGen with `as: "worker"` and its `env`,
and address its steps with `on: "worker"`.
