# StudioGen updates

StudioGen (the desktop app) updates itself from this repository's GitHub release **`updates`**, which
`.github/workflows/desktop.yml` publishes on every push to `main`. There's no Apple Developer ID, so it doesn't use
Squirrel/electron-updater; `desktop/updater.js` does it.

## Two layers

| Layer | What | How often | How it's applied |
|---|---|---|---|
| **Web** | `index.html`, `js/`, `css/`, `icons/`, `samples/`, `bridge/`… (one ~0.6 MB `web-app-<n>.tar.gz`) and `vendor/` (one ~47 MB `web-vendor-<hash>.tar.gz`, only downloaded when the libraries change) | Every push that changes web files | Unpacked under `~/Library/Application Support/StudioGen/updates/`, served instead of the copy inside the app; **Restart now** reloads the window |
| **Shell** | The Electron app itself: `desktop/main.js`, `preload.js`, `webview-preload.js`, `updater.js`, Electron (zipped `StudioGen-<v>-arm64-mac.zip` / `-mac.zip`) | Only when `desktop/package.json` `version` goes up | Unzipped with `ditto`, swapped into place when you quit or press **Restart now**; the old copy is kept as `StudioGen.app.old` until the new one starts, then removed |

The web number is the workflow's run number (`web-version.json`, written in CI and shipped inside the app too). A web
update says which shell it needs (`minShell`, the shell version it was built with); an older shell first updates itself.

The page sees it all through `window.DriveDeckDesktop.updates` (`js/app.js` › `DesktopUpdates`): a bar offers
**Restart now / Later**, and Settings › System › Updates shows the state and checks on demand (also the menu bar ›
Check for updates). Checks run 20 s after start and every 4 hours.

## Security

- `update.json` (versions, file names, sizes, SHA-256s) is signed in CI with an **Ed25519** private key (repository
  secret `UPDATE_SIGNING_KEY`). The app verifies `update.json.sig` with the public key built into `desktop/updater.js`
  **before reading anything**, then each download's size and SHA-256, and the unpacked vendor folder's hash.
- Downloads only over HTTPS from `github.com` and GitHub's release-asset hosts.
- Never a lower version than what's running (no downgrade by replaying an old signed manifest).
- Archives can't write outside their folder (`..`, absolute paths and AppleDouble files are refused).
- Without the secret (forks, pull requests) the workflow builds but doesn't publish.

### The keys

Made once with Node (`crypto.generateKeyPairSync('ed25519')`), kept outside the repository in `~/StudioGen-update-keys/`:

- `update-private.pem`: **secret**. Only in the repository secret `UPDATE_SIGNING_KEY` and your own backup. Anyone with
  it can ship code to every StudioGen. Set or replace the secret with
  `gh secret set UPDATE_SIGNING_KEY < ~/StudioGen-update-keys/update-private.pem`.
- `update-public.pem`: public; its contents are `PUBLIC_KEY` in `desktop/updater.js`.

**Rotating the key** (if the private key leaks): make a new pair, put the new public key in `updater.js`, bump the
shell version, publish one last update **signed with the old key** (so existing apps install the new shell), then
replace the secret. Apps that skip that update need a manual DMG install.

## Testing an update locally

`STUDIOGEN_FEED=http://localhost:8765/` points a packaged app at a local feed (it still has to be signed with the real
key): `WEB_VERSION=2 node tools/release/make-update.mjs version`, then
`UPDATE_SIGNING_KEY="$(cat ~/StudioGen-update-keys/update-private.pem)" node tools/release/make-update.mjs pack feed/`,
serve `feed/` and run the app with `--user-data-dir=<scratch>` so your own data isn't touched.

## When the shell has to change (bump `desktop/package.json` version)

Most work is web files and arrives as a web update. These need a new shell (a version bump; it downloads and swaps itself):

1. **New desktop powers for the page**: anything new in `window.DriveDeckDesktop` (`desktop/preload.js` + an `ipcMain`
   handler in `main.js`), e.g. file system access for recordings, global keyboard shortcuts for the clicker, a native
   notification, screen-recording the presentation to a video file, reading the Bluetooth/OBD car adapter.
2. **Window and presenting behaviour**: new windows (a teleprompter, a second presenter window), always-on-top or
   kiosk mode, multiple displays logic, the menu-bar menu, start-at-login options.
3. **Browser widgets**: changes to how `<webview>` pages are set up (`webview-preload.js`, the browsing session,
   permissions, pop-up handling, injecting the recorder), the frame-header rules for sites that refuse to be framed.
4. **Permissions and protocol**: camera/microphone/location prompts (`Info.plist` usage texts), new `app://` routes,
   Content-Security-Policy, the permission handlers.
5. **Electron itself**: security fixes and new Chromium (WebGPU, codecs, MediaPipe/ONNX needs) — bump `electron` in
   `desktop/package.json`; plan one every few months.
6. **The updater** (`desktop/updater.js`): its feed, checks, the public key (rotation), how it installs.
7. **App identity**: the name, icon, bundle id, file associations (opening `.json` scripts or decks by double-click),
   a URL scheme (`studiogen://run-script?...`).
8. **Native modules** or bundled tools (an ffmpeg for recordings, a local Python for the Trainer).

Everything under `js/`, `css/`, `index.html`, `presenter.html`, `samples/`, `icons/` (in-app), `vendor/` is web layer.
