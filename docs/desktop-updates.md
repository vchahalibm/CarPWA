# NaoMuse updates

NaoMuse (the desktop app) updates itself from this repository's GitHub release **`updates`**, which
`.github/workflows/desktop.yml` publishes on every push to `main`. There's no Apple Developer ID, so it doesn't use
Squirrel/electron-updater; `desktop/updater.js` does it.

## Two layers

| Layer | What | How often | How it's applied |
|---|---|---|---|
| **Web** | `index.html`, `js/`, `css/`, `icons/`, `samples/`, `bridge/`… (one ~0.6 MB `web-app-<n>.tar.gz`) and `vendor/` (one ~47 MB `web-vendor-<hash>.tar.gz`, only downloaded when the libraries change) | Every push that changes web files | Unpacked under `~/Library/Application Support/StudioGen/updates/`, served instead of the copy inside the app; **Restart now** restarts the app |
| **Shell** | The Electron app itself: `desktop/main.js`, `preload.js`, `webview-preload.js`, `updater.js`, Electron (zipped `NaoMuse-<v>-arm64-mac.zip` / `-mac.zip`) | Only when `desktop/package.json` `version` goes up | Unzipped with `ditto`, swapped into place when you quit or press **Restart now**; the old copy is kept as `NaoMuse.app.old` until the new one starts, then removed |

**Lazy files** (`LAZY` in desktop/updater.js: `vendor/models/*.vrm`, `vendor/mediapipe/models/*.task`,
`vendor/mediapipe/wasm/*.wasm`) are in neither the app nor the vendor bundle. `web-version.json` lists each with its
SHA-256 and size (`lazy`) and the commit; the first request for one downloads it from
`raw.githubusercontent.com/vchahalibm/CarPWA/<commit>/<path>` (`lazyFile`), checks it and keeps it in `assets/`.
Offline before the first use, the request fails (503) and the app says so.

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
  it can ship code to every NaoMuse. Set or replace the secret with
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

## Publishing from this Mac

The source lives on this Mac and nowhere else. What runs is built here and pushed to the public repository
**vchahalibm/CarPWA**, which installed apps already use: GitHub Pages serves DriveGen from its main branch, the update
feed is its `updates` release, and big files come from its tags. Nothing had to move or be renamed.

```
node tools/release/PublishApps.mjs                 everything that changed: the web app, the Mac app, the images
node tools/release/PublishApps.mjs --dry           build and check everything, push nothing
node tools/release/PublishApps.mjs --only web      just one: web, mac, hive, worker (comma-separated for several)
node tools/release/backup.mjs --upload             a locked copy of the source, kept in the public repo
```

It prints a plan first (what it will build, and why the rest is skipped), runs the checks, builds, asks before
pushing, then checks the feed and the website really changed. The Mac app builds only when `desktop/package.json`'s
version isn't published yet; the NaoMuseHive image (ghcr.io/vchahalibm/naomusehive) only when bee/ changed since its
last tag (`hive-v<version>`), the Worker image (ghcr.io/vchahalibm/studiogen-worker) only when what it's built from
changed since `worker-v<version>`. Images are built for both kinds of processor and need a token that may publish
packages, once: `gh auth refresh -s write:packages`. How often to publish is up to you: nothing runs by itself.
On "minified and obfuscated": what ships is minified (comments gone, local names shortened, one long line), not
obfuscated. That makes it a chore to read, not impossible; see the note on keeping valuable logic off the device.

- **It builds from the last commit**, in a throwaway worktree, so your working tree is never minified and what ships is
  what you committed. It refuses to run with uncommitted changes.
- **The checks run first** (the ones CI used to run: the code parses, phrases, watchers, map watchers, lookahead,
  MuseTester's coverage, the names, the Handbook, the packaged desktop files, the manifest). A failure publishes nothing.
- **What goes out**: the web app, practice sites, script library, vendor files and guides, with the app's own JavaScript
  minified (`tools/release/dist.mjs`). Never desktop/, tools/, tests/, bee/, worker/, CLAUDE.md or the try-it-out list.
- **The Mac app** is built here by electron-builder and signed with the certificate in your login keychain, so every
  version keeps the same identity. It is built only when `desktop/package.json`'s version isn't in the published feed
  yet (or `--mac`). The DMGs go to a `v<version>` release.
- **The feed** is signed here with `~/StudioGen-update-keys/update-private.pem`. With no Mac build, the published shell
  entry is kept (`PREV_UPDATE`), so a web-only release needs no build at all.
- **Update numbers** continue above the old CI runs (they reached 149, so these start at 1000).
- **There is no CI.** The checks are the publish script's first step; run them yourself any time with the same commands.
- **Pushing source is blocked**: the remote is named `public-dist-do-not-push` and `.githooks/pre-push` refuses. The
  publish script pushes from its own copy.
- **Backup.** The Mac is the only place the source exists, so `backup.mjs --upload` puts an encrypted bundle of every
  branch and commit in the public repo's `backup` release. It is AES-256 with a slow key derivation, so it is only noise
  to anyone else. The passphrase is `~/StudioGen-update-keys/backup-pass.txt`: **keep a copy in your password manager**,
  because nothing can open the backup without it. Restore with
  `node tools/release/backup.mjs --restore <file.enc> <new folder>`.
- **What was already public stays public.** The repository's history still holds the source as it was until November
  2026; that cannot be recalled. From here on, only the built app is pushed.
