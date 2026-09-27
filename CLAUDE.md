# DriveDeck (CarPWA)

Pure HTML/CSS/JavaScript PWA. **No frameworks, no bundler/build step, no npm dependencies.** The only third-party code is MapLibre GL JS 5.x (UMD build), vendored in `vendor/maplibre/`. Keep to the 5.x line: 6.x ships ES modules only and can't load as a classic script.

- Run: `python3 -m http.server 8000` from the repo root. Check: `for f in js/*.js sw.js; do node --check $f; done`.
- Classic scripts sharing globals, loaded in order: `js/routing.js` (routing/search providers, the `Routing` object), `js/app.js` (app logic), `js/modes.js` (Map/3D/AR/HUD modes), `js/dash.js` (dashboard layouts, cluster styles, widgets, sensors). Later files use earlier files' globals; don't redeclare a global name (e.g. `rad`, `deg`). Styles in `css/styles.css`, markup in `index.html`. Keep the existing idiom: `$`/`$$` helpers, `store` for localStorage (keys prefixed `dd.`), icons in the `I` map rendered via `svg()`.
- Keep all URLs relative so the app works under a sub-path (GitHub Pages serves it at `/CarPWA/`).
- When changing any file in `SHELL` in `sw.js`, bump `VERSION`. Add new static files to `SHELL`.
- Car-first UI: tap targets ≥ 56px, respect the "hide while driving" setting, and keep both dark and light themes working (tokens on `:root` / `[data-theme="light"]`).
- Routes are normalised by `js/routing.js` (`coords`, `cum`, `tcum`, `steps`, `segLimit`); add new providers there, not in app.js.
- Dashboard gauges bind to live values via `data-t`/`data-arc`/`data-rot`/`data-w`/`data-tf`/`data-show`/`data-html`/`data-cls` keys from `vals()` in `js/dash.js`. Only show data the phone really has.
- Never use Apple names, logos or assets.
- `docs/prototype.html` is the original reference prototype. Don't edit it.
