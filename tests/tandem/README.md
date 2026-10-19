# Tandem tests

Tests that need several devices: pairing, the mesh (create, invite, auto-join, everyone online), a request from the phone run on another StudioGen, a show across screens, changing the secret, removing a member. The runner starts the devices on this Mac, does what it can, asks **you** to do the marked steps in the real apps, and checks every step by watching the apps.

```
node tests/tandem/run.mjs                 # tandem: you do the marked steps, the runner checks
node tests/tandem/run.mjs --auto          # the runner does every step itself
node tests/tandem/run.mjs --only pair,mesh
```

Options: `--phone sim|chrome` (default: `sim` when Xcode's simulator is installed), `--studio electron|chrome` (default: `electron`, the desktop app from `desktop/`, needs `cd desktop && npm install`), `--port 8822`.

## The devices

| Name | What it is | How the runner sees it |
|---|---|---|
| Studio A, Studio B | StudioGen: the desktop app from `desktop/` with its own scratch profile (never yours), or Chrome in lab mode (`?linktest=host`) | Chrome DevTools protocol |
| Test iPhone | DriveGen in the iOS Simulator's Safari (Xcode), or a phone-sized Chrome window | Simulator: the page reports to the runner every 2 s (`?tandem=<name>`, `Tandem` in js/linktest.js) and takes steps from a fixed list (`Tandem.STEPS`); Chrome: DevTools protocol |

The Simulator has no camera, so pairing uses **No camera? Paste the code**: the runner puts the code on the simulated iPhone's clipboard. Everything goes through the real public relays, as between real devices.

## The control panel

Opens in your browser at `http://localhost:8822/tandem/`: the step now, what to do (buttons in bold), what the runner is waiting for, each device's state (paired, mesh, members seen online, show step, direct link), and the results. **Skip this step** and **Mark failed** are there when something can't be done.

## Results

`tests/tandem/out/<time>/`: `report.json` (each step: passed, failed or skipped, how long it took, why it failed) and a screenshot of every device after every step. The exit code is 1 when a step failed.

## Adding a step

In `SCENARIOS` in run.mjs: `title`, `you` (the instruction, or a function returning it), `auto` (what the runner does in `--auto`), `check` (returns `true`, or a short text saying what it's still waiting for), `wait` (seconds before an unattended check fails). A step the Simulator must do needs an entry in `Tandem.STEPS` (js/linktest.js): a fixed list, nothing else runs.
