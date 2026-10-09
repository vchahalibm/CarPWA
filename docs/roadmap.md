# DriveDeck roadmap

Where the app goes next, in order. Each phase ships on its own, through a PR, and ✅ marks what's done.

## The shape of it

```
 Car (phone PWA)                     Stage on the Mac (menu-bar app)            Stage on an iPad (PWA)
 ─────────────────                   ─────────────────────────────────          ────────────────────────
 Phone's own speech recognition      Stage window: presenter view +             Same Stage screen,
 → fuzzy command matching            audience window on the wall display        models run on the Mac
 Natural voice (Kokoro) for replies  Full browser widgets (click anywhere)  ◄──  over WebRTC (LAN with a
 No people or face models            Model host: Whisper large, Kokoro full,    one-time certificate from
                                     people/face, detector, later a local LLM   a QR code; or Tailscale)
                                                                                Falls back to on-device
```

- **Car**: listening maps speech to commands, so it uses the phone's own recognizer and a forgiving matcher; the memory goes to a clear reply voice.
- **Stage** mostly runs on a Mac, sometimes an iPad. It drives a lot on screen, so conversation mode (full duplex) and the best models matter most there. On the Mac the desktop app runs them; an iPad uses the Mac's models when it can reach it.
- People, hands and face tracking run only in Stage mode.
- It stays **Stage** mode (no rename).

## Why models move to the Mac (decided)

A PWA can't be a background service: a service worker only wakes briefly for events, has no GPU and can't keep a model loaded; iOS freezes a web app as soon as it isn't on screen; a browser page can't listen on a socket; and each home-screen web app on iOS has its own isolated storage, so two can't talk on the device. An iPad can show two web apps side by side (each its own process), but a hidden one freezes and they'd still need a relay to talk. So the iPad stays the screen, with on-device models as the fallback, and the Mac's desktop app (Electron, which may listen on sockets, start at login and live in the menu bar) hosts the models, running the same web code.

## Phase A: Car voice ✅

1. ✅ **Fuzzy command matching.** Score every command by how much of what was said it covers: content words weigh more than fillers, order counts a little, a missing word or two is fine, and the place / contact / song is taken from what's left. High confidence runs it; medium asks back (“Navigate to Costco?” yes / no); low says what it didn't get. All the recognizer's alternatives are scored, not just its first guess. Phrase tests gain missing-word cases, and a phrase still mustn't steal another command's words.
2. ✅ **The phone's own recognizer is the default in the car** (also in conversations: Automatic uses it in Drive mode, the on-device models on Stage); on-device listening is the offline fallback. That leaves memory for the natural voice and the detector.
3. ✅ **Clear spoken results**: short fixed wording for each action, an optional soft tone when a command runs.

## Phase B: Stage desktop shell (Electron)

1. ✅ **Menu-bar app**: starts at login, lives in the menu bar, opens the Stage window; **Present on** a screen puts DriveDeck full screen on the wall with the **presenter view** (`presenter.html`: the step, the line, speaker notes, what's next, timer, controls, live preview) on this screen. The presenter view also works in a browser.
2. ✅ **Full browser widgets** (desktop app only): a web widget is a real embedded Chromium view, not an iframe. Any site, persistent logins, back / forward / address bar. The PWA keeps the iframe widget.
3. ✅ **Click anywhere inside Stage**: clicks, swipes and recorded steps go into the widget under them as real input events; gestures can move a visible pointer.
4. ✅ **Record and replay any site in a browser widget.** The user records clicks, typing, scrolling and navigation, and they become steps in a Stage script. A helper script is injected into browser widgets (in an isolated world, so the page can't see or touch it) to record precise targets and replay them, with real input events at the element's position as the fallback. Users can add **site helpers**: a script for chosen sites or URL patterns (for example dismiss a cookie banner, or expose a page's state) that runs when those pages load.
   - Guardrails: only in the desktop app's browser widgets; a visible “Recording” badge; password, payment and one-time-code fields are never recorded (their steps say “type your password here” and wait); recordings and site helpers stay on the device; no proxy.
   - The PWA keeps today's rule for iframes: same-origin pages directly, other pages only through `bridge/drivedeck-bridge.js`.
5. **Visual click fallback**: when a recorded target has moved, screenshot the widget, find the control with a detector trained in `tools/trainer`, click it.

## Phase C: Models on the Mac

1. **`Services` layer** in the web code: one interface per ability (listening, reply voice, people/face, detector, later chat) with providers in order: the Mac host (in-process in the desktop app, over the network for an iPad) → on-device (today's code) → the device's built-ins.
2. **Host runner** in the desktop app: each model in its own process with real memory: Whisper large-v3-turbo, full-quality Kokoro, people/hands/face at full rate, the detector. Same JavaScript models first; a native MLX helper later where clearly faster.
3. **Conversation mode is the Stage default** on the Mac (no longer beta there), with model pickers for listening and voice. People/face never load outside Stage.

## Phase D: iPad joins the Mac

1. **Pairing by QR code** from the menu-bar app. First time, the iPad installs the Mac's own certificate (a profile, trusted once in Settings), so after that it reconnects by itself over secure WebSocket signaling and WebRTC (microphone up, replies and results back, camera frames when the Mac tracks people for the iPad).
2. **Revoke and re-pair**: the menu-bar app lists paired devices; **Revoke** ends a device's access at once (its token stops working). **Reset certificate** makes a new one, so every device has to scan again. On the iPad, **Forget this Mac** clears the pairing (and Settings says how to remove the old profile). Scanning again pairs from scratch.
3. **Tailscale option**: use the Mac's Tailscale name and certificate instead (works away from home, nothing to install on the iPad).
4. **Fallback**: if the Mac goes away mid-show, the iPad switches to on-device models (with the memory priorities) and says so.

## Phase E: Later and parked

- Local LLM on the Mac for free-form questions and scripts that answer the audience naturally.
- A realistic avatar (a drop-in VRM; the Mac can draw a heavier one).
- One model runtime instead of two (saves memory on phones).
- A lighter map while models load (phones).
- Dropped: the Windows build; the Node / Node-RED proxy (Phase B's browser widgets do that job).

## Done before this roadmap

- ✅ Conversation mode (beta), the 3D assistant (Vita, Ren), Stage mode, Scripts, People on Stage, Web steps on your own pages, the trainer, iPad memory fixes, the phone's recognizer in conversations, model priorities so Stage keeps the natural voice.
