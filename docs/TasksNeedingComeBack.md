# Tasks needing come back

Things started or decided but not finished, and things to perform together later. Newest first within each section. Tick them off (or delete them) as they're done.

## To perform (with you)

- [ ] **Debug DriveGen hanging / going blank on the iPhone** (mobile data, paired with StudioGen on this Mac, 20 Oct 2026). Needs the phone's own logs: Safari Web Inspector over USB, or DriveGen's debug log (Settings › Logs). A Chrome phone paired the same way stays stable (no errors, memory flat), so it's iPhone-specific. Steps in the reply of 20 Oct; findings go here.
- [ ] **Real-device journey: DriveGen on the iPhone runs a script on StudioGen, and the mesh forms.** StudioGen › Mesh › Create a mesh; the paired iPhone joins by itself; run a script by voice/typing/tap; look at Mesh › Live, Activity, History.
- [ ] **Tandem test, Demo Day journey, you doing the steps**: `node tests/tandem/run.mjs` (guide: docs/tandem-guide.html). Only the automatic run has been done (35/35 on the simulator and on a Chrome phone).
- [ ] Tandem test with **talking** instead of typing (STT on the iPhone simulator and on StudioGen), to check the phrases are recognised as well as typed.
- [ ] A mesh with **two real phones** (or iPhone + iPad) and **two real Macs**.

## Code features

- [ ] **Commands by intent, not by phrase lists** (proposed 20 Oct): utterance → intent → action. A small on-device sentence-embedding model classifies what was said against a few examples per intent (no permutations to list); slots (script, device, person) filled from what the app knows; “No, I meant…” teaches it. Plus a “What can I say” screen per mode (1:1, mesh, show), showing only what works right now.
- [ ] **Native speech recognition in StudioGen** (proposed 20 Oct): Electron has no Web Speech, so StudioGen uses Whisper, which misses words with an Indian accent. A small macOS helper with Apple's speech recognizer (en-IN, on-device, biased to script and device names) and Apple's echo cancellation, feeding conversation mode like the phone's recognizer does. Needs a desktop version bump.
- [ ] **Pairing on the iPhone**: StudioGen keeps its pairings across updates (checked 20 Oct). On iOS, Safari and the Home Screen app have separate storage, so a phone paired in one isn't paired in the other; the app now asks to keep its storage. Show this in DriveGen's pairing screen.
- [ ] **Multi-peer direct links**: `Direct` holds one WebRTC connection, so in a mesh only one pair gets full telemetry over a direct link; the rest go through the relays (budgeted).
- [ ] **A visible “in a show” state on each screen** (step, conductor), not only in StudioGen › Mesh › Shows.
- [ ] **Typing on the phone**: the Assistant is a small tile on the iPhone's widgets page; a bigger typing view (or typing in the listening panel).
- [ ] **Relay list for paired devices outside a mesh**: a changed list reaches devices only through the mesh (owner shares it); paired-only devices keep the old list until paired again.
- [ ] **Web Push wake-ups** (requirement L-10, the part still to do).
- [ ] Data rows from a script on StudioGen shown on the phone, checked end to end (DataViz from `mac.run` results).

## Tests

- [ ] Add to the Demo Day journey: changing the secret phrase (Mac, then phone), data rows coming back, a captured motion shared and fetched, the journal back-fill after a device was away (history gap filled), the history export file, a second phone.
- [ ] Run the tandem journey in CI (nightly): `--auto --phone chrome --studio chrome` needs no simulator or Electron.
- [ ] Act 7 “Studio B quits” takes up to 90 s (presence timeout); a ‘bye’ when a StudioGen quits would make it immediate.

## Decided against (for the record)

- **Headscale** in StudioGen: not worth the extra code; people who want their own network can use Tailscale (already supported).
- **vphone-cli** virtual iPhones: needs SIP and AMFI turned off on the Mac; the Xcode iPhone simulator is used instead.
