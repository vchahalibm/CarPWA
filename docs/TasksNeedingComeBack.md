# Tasks needing come back

Things started or decided but not finished, and things to perform together later. Newest first within each section. Tick them off (or delete them) as they're done.

## To perform (with you)

- [ ] **Phonon in the apps, on your iPhone and iPad** (built 24 Oct): after the update the setup screen appears (what's new, the voice downloading, the speed check). Then a few replies, a long one (“summarise my unread mail”), interrupting one, a conversation, and the assistant's lips. Measured here: Chrome on this Mac 8–9× faster than speech, StudioGen ~6.7× (7.1 s of speech in 1.3 s), first sound ~0.4 s for the first reply and ~30 ms after.
- [ ] **Transformers.js release with Phonon**: when PR #1811 ships, drop vendor/transformers-phonon and load the release from jsDelivr (pinned).

- [x] **Several CPU threads for the natural voice** (tested 23 Oct, removed): iPhone 15 Pro Max 2.4× → 1.4× (2 threads) and 1.6× (4 threads) slower than real time, never keeping up; the iPad keeps up anyway (its GPU voice). The isolation it needs also blocks YouTube, web-page widgets and some radio, so the code was taken out: iPhones use the device voice (Automatic), iPads the natural voice where it measures fast enough. Measured on the simulator: 1 thread 1.58×, 2: 1.11×, 3: 0.98×, 4: 0.92×.

- [ ] **The agent with your accounts** (built 23 Oct): in StudioGen, Agent › Library › Agent browser: sign in once to Outlook (work: outlook.office.com, or personal in Agent › Settings), Teams, Slack and WhatsApp Web (link your phone). Then ask: “summarise my unread mail”, “what’s my day”, “read the mail from <someone>”, “any teams messages”, “any whatsapp messages”; and from DriveGen the same. Add People (email, WhatsApp number) before the sending tasks. The page selectors for Outlook/Teams/Slack/WhatsApp are best guesses (the model reads whatever text is there); note what comes back wrong and I'll tune each task. Tried so far without accounts: news and flight status (right), Outlook asks to sign in (right).

- [ ] **Main-process error in StudioGen (“out of range”)**, seen 21 Oct; couldn't be reproduced with an empty profile. From 0.9.3 such errors go to `~/Library/Logs/StudioGen/main.log` with the stack: when it happens again, say so and I'll read the file and fix the line.
- [x] **Voice settled** (21 Oct): phones use the device voice (Automatic) and the phone's recognizer, listening acts ~0.45–0.8 s after you stop; Kokoro stays a choice but is 2.4× slower than speech on the CPU of an iPhone 15 Pro Max, and its GPU build crashed the app (too big for a web app on a phone), so the GPU option is gone on phones. StudioGen keeps Kokoro (fast on a Mac) and Apple's recognizer. No more voice experiments unless something breaks.
- [ ] ~~Voice: try on the iPhone~~ (done, see above): Settings › Voice › Check the voices (a tap: unlocks iOS speech), then a few replies with Automatic; listening should act ~0.8 s after you stop. In the iPhone simulator the device voice doesn't start without a tap (same symptom as the real phone): the retry and the on-screen note now cover it.
- [ ] (parked) **Voice reliability plan, the rest**: step 1 and the Voice check / automatic choice are built (21 Oct); left: one owner for the audio channel, a voice summary in Logs, a voice act in the tandem tests. Was: 1) confirmed-start fallback in 1.5 s, iOS audio-channel reset before the phone voice, text when no voice can speak, faster end of listening (act after ~0.7 s of unchanged words); 2) Voice check + automatic voice choice by measured speed; 3) one owner for the audio channel, voice summary in Logs, voice act in the tandem tests. Cause seen on the iPhone: Kokoro ~2–3× slower than real time (watchdog at 8 s), then the phone voice silently refused (voices: 0, no start event) after the mic.
- [ ] **Try Apple's recognizer in StudioGen 0.9.2** (English on the Mac, Hindi via Apple's servers; “Keep speech on this device” forces local): Settings › Voice › Speech recognition: Mac; say a few commands with script and device names; a conversation (Kokoro replying) on Stage. Note what it misses.
- [ ] **Reply-voice pauses on the iPhone**: after the update, a multi-sentence reply; send the debug log lines “Sentence n generated in … ms … speed …” and “On-device voice … engine”. If speed is above 2 (generation much slower than playback), try the GPU voice (Settings › Logs › Reply voice device) or the phone voice for long replies.
- [ ] **Debug DriveGen hanging / going blank on the iPhone** (mobile data, paired with StudioGen on this Mac, 20 Oct 2026). Needs the phone's own logs: Safari Web Inspector over USB, or DriveGen's debug log (Settings › Logs). A Chrome phone paired the same way stays stable (no errors, memory flat), so it's iPhone-specific. Steps in the reply of 20 Oct; findings go here.
- [ ] **Real-device journey: DriveGen on the iPhone runs a script on StudioGen, and the mesh forms.** StudioGen › Mesh › Create a mesh; the paired iPhone joins by itself; run a script by voice/typing/tap; look at Mesh › Live, Activity, History.
- [ ] **Tandem test, Demo Day journey, you doing the steps**: `node tests/tandem/run.mjs` (guide: docs/tandem-guide.html). Only the automatic run has been done (35/35 on the simulator and on a Chrome phone).
- [ ] Tandem test with **talking** instead of typing (STT on the iPhone simulator and on StudioGen), to check the phrases are recognised as well as typed.
- [ ] A mesh with **two real phones** (or iPhone + iPad) and **two real Macs**.

## Code features

- [x] **“Say a filler first” for spoken replies**: built 23 Oct (Working in js/agent.js: a line at once, Typing then Think, the answer with a gesture); decided: (tested 23 Oct). A filler line in the device voice starts at once (~2 ms; ~2 s long) while the assistant types, then thinks (the new Typing and Think motions), and the natural voice is made in the background. Measured for a 7-sentence email summary (27 s of speech): Mac GPU 2.4 s to make all of it (with the assistant animating: no slowdown), Mac CPU 38 s (one thread: the app isn't cross-origin isolated), iPhone CPU ~2.4× slower than real time. Waiting for the whole reply: Mac 2.4 s (fine), phone ~47 s (not usable). Streaming without pauses after the filler: phone ~33 s before the answer starts. Options for DriveGen: the device voice for long replies (today), the Mac making the natural voice and sending it to the phone, or multi-threaded voice on the phone (cross-origin isolation via the service worker), to measure.

- [ ] **Data lake: SQL queries as task data sources** (decided 23 Oct): for now tasks read Excel/CSV and draw charts; later, queries against a data-lake setup (connection, read-only, parameters bound like `data.sql`).

- [x] **Commands by intent with Apple's on-device model** (built 21 Oct, StudioGen 0.10): phones ask their Mac; checked in the Demo Day journey (39/39). Left from the proposal: the “What can I say” screen per mode (1:1, mesh, show), and “No, I meant…” teaching.
- [ ] ~~Commands by intent, not by phrase lists~~ (was proposed 20 Oct): utterance → intent → action. A small on-device sentence-embedding model classifies what was said against a few examples per intent (no permutations to list); slots (script, device, person) filled from what the app knows; “No, I meant…” teaches it. Plus a “What can I say” screen per mode (1:1, mesh, show), showing only what works right now.
- [ ] **Native speech recognition in StudioGen**: built 20 Oct (desktop 0.9.0), to be tried by you: the first use asks for speech-recognition and microphone permission; check Indian-English commands and a conversation on Stage. Was: Electron has no Web Speech, so StudioGen uses Whisper, which misses words with an Indian accent. A small macOS helper with Apple's speech recognizer (en-IN, on-device, biased to script and device names) and Apple's echo cancellation, feeding conversation mode like the phone's recognizer does. Needs a desktop version bump.
- [ ] **Pairing on the iPhone**: StudioGen keeps its pairings across updates (checked 20 Oct). On iOS, Safari and the Home Screen app have separate storage, so a phone paired in one isn't paired in the other; the app now asks to keep its storage. Show this in DriveGen's pairing screen.
- [x] **Multi-peer direct links**: built 21 Oct (js/meshdirect.js): a direct link per pair of members; checked in the Demo Day journey (37/37 with the simulator and a Chrome phone).
- [x] **A visible “in a show” state on each screen**: built 21 Oct, the show badge (MeshView.pill).
- [ ] **Typing on the phone**: the Assistant is a small tile on the iPhone's widgets page; a bigger typing view (or typing in the listening panel).
- [ ] **Relay list for paired devices outside a mesh**: a changed list reaches devices only through the mesh (owner shares it); paired-only devices keep the old list until paired again.
- [ ] **Web Push wake-ups** (requirement L-10, the part still to do).
- [ ] Data rows from a script on StudioGen shown on the phone, checked end to end (DataViz from `mac.run` results).

- [ ] **Teams on the real site**: the Teams tasks (unread chats, read a chat, send) are checked on labs/practice/teams.html only; the real Teams' `data-tid` names are best guesses. Sign in to Teams in the agent browser and try “any teams messages”, “what did <someone> say on teams”.
- [ ] **Profiles and StudioGBee, phases 2–7** (design agreed 27 Oct, docs/studiogbee.html): StudioGBee (queue, push, backup, federation, Docker + Cloudflare), its dashboard, remote sign-in, StudioGen Worker in Docker, tasks in parallel, TURN on the bee. Phase 1 (only my devices, shared tasks in the mesh, waiting requests, Teams) is built.
- [ ] **Sign in from your iPhone** (built 28 Oct): with the iPhone and the Mac on the same Wi-Fi, ask something that needs a sign-in you haven't done, tap “Sign in from here”, sign in (Outlook's two-step works on the phone). Over mobile data only if the direct link comes up.
- [ ] **A StudioGen Worker of yours** (built 28 Oct): worker/README.md on this Mac with Docker; sign in to a WhatsApp in it from your phone; ask “unread whatsapp” from the phone.
- [ ] **StudioGBee with your real devices**: run it in Docker on this Mac with `tailscale serve --bg 8840` (phones need https), add it in StudioGen, turn on notifications in DriveGen (from the Home Screen app), close DriveGen, quit StudioGen, ask… (iPhone push not tried yet). Cloudflare Worker version still to make.
- [ ] **Only my devices with real devices**: a second person's phone in your mesh asks your StudioGen for “unread mail” (refused) and a shared web task (runs); your own iPhone gets both.
- [ ] **A practice calendar** (labs/practice): the calendar tasks (cal.today, cal.next) can't be tried on the practice sites yet (`{outlook}/calendar/…` lands on the practice inbox).
- [ ] **The Stage assistant builds tasks by voice** (asked 25 Oct, once the LLM build is mature): the assistant interviews you with “person is Priya” answers, plans on the Mac's model (`TaskLocal`), opens the result in the editor, asks you to point at anything unclear (Teach me / Show me), then runs it watched.
- [ ] **Try the build prompt on the real Slack and WhatsApp** (the selectors were checked on the practice copies, which follow the real pages' structure).

- [ ] **A reply still cut off on the user's Mac** (26 Oct): not reproducible here (the mail summary plays in full by tap and by voice). `Voice.hush` now logs who stopped a reply; ask for a debug log (Settings › System › Debug log) from the next one.

## Tests

- [ ] Add to the Demo Day journey: changing the secret phrase (Mac, then phone), data rows coming back, a captured motion shared and fetched, the journal back-fill after a device was away (history gap filled), the history export file, a second phone.
- [ ] Run the tandem journey in CI (nightly): `--auto --phone chrome --studio chrome` needs no simulator or Electron.
- [ ] Act 7 “Studio B quits” takes up to 90 s (presence timeout); a ‘bye’ when a StudioGen quits would make it immediate.

## Decided against (for the record)

- **Headscale** in StudioGen: not worth the extra code; people who want their own network can use Tailscale (already supported).
- **vphone-cli** virtual iPhones: needs SIP and AMFI turned off on the Mac; the Xcode iPhone simulator is used instead.
