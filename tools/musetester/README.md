# MuseTester

MuseTester runs the try-it-out list (docs/TasksNeedingComeBack.md) for you. It drives StudioGen, its Workers and
DriveGen the way you would: it opens the app, makes watchers, presses buttons, types, waits for cards, and takes
pictures. Then it writes a report and, if you ask, ticks the items that passed.

```
node tools/musetester/muse.mjs --list                          # the tests
node tools/musetester/muse.mjs practice                        # every test tagged practice (a throwaway profile)
node tools/musetester/muse.mjs practice-slack drivegen-ipad-settings
node tools/musetester/muse.mjs --profile mine --restart-mine   # the tests that need your accounts (Slack, Outlook, X…)
node tools/musetester/muse.mjs --profile mine mine-slack --mark   # …and tick what passed in the try-it-out list
```

Options:
- `--app installed|dev`: the installed StudioGen (the default when it's there) or the one in `desktop/`, which has
  today's code.
- `--auto`: steps that need you are skipped instead of asked.
- `--headful`: shows DriveGen's Chrome window.
- `--keep`: leaves StudioGen open after the tests.

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
| `launch` | Opens StudioGen. `as` (name, default `studio`), `profile`, `practice` (true/false), `app`, `env` (e.g. a Worker's `SG_NAME`, `SG_LIGHT`), `port`. |
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
| `practice.incoming` | A new message on a practice site: `site` (`slack`, `whatsapp`, `teams`…) and `text` in the site's `?incoming=` form. |
| `watch.make` | A watcher from a template: `template`, `inputs`, `name`, `set` (any fields: `from`, `to`, `every`, `look`…). |
| `watch.check` | Checks it now (`name`). The result `{ hit, error, count, trace, url }` goes in the variable `check` (or `as`). A check with an error fails the step unless `ok: false`. |
| `watch.delete` | Deletes watchers with that `name`. |
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

## Adding tests

Most try-it-out items are a few `watch.*`, `say`, `click` and `expect` steps. Things that need a phone or a car are
`human` steps, so a run still records them. For Workers, `launch` a second StudioGen with `as: "worker"` and its `env`,
and address its steps with `on: "worker"`.
