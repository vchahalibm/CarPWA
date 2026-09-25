# DriveDeck (CarPWA)

Pure HTML/CSS/JavaScript PWA. **No frameworks, no bundler/build step, no npm dependencies.** The only third-party code is Leaflet, vendored in `vendor/leaflet/`.

- Run: `python3 -m http.server 8000` from the repo root. Check: `node --check js/app.js && node --check sw.js`.
- App logic is in `js/app.js` (classic script, `'use strict'`), styles in `css/styles.css`, markup in `index.html`. Keep the existing idiom: `$`/`$$` helpers, `store` for localStorage (keys prefixed `dd.`), icons in the `I` map rendered via `svg()`.
- Keep all URLs relative so the app works under a sub-path (GitHub Pages serves it at `/CarPWA/`).
- When changing any file in `SHELL` in `sw.js`, bump `VERSION`. Add new static files to `SHELL`.
- Car-first UI: tap targets ≥ 56px, respect the "hide while driving" setting, and keep both dark and light themes working (tokens on `:root` / `[data-theme="light"]`).
- Never use Apple names, logos or assets.
- `docs/prototype.html` is the original reference prototype. Don't edit it.
