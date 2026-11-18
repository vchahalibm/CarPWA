# The journal: learning by watching

Design, what was measured, what is built, and what comes next. Code: `desktop/see/main.swift` (the eyes),
`desktop/journal.js` (the store), `js/journal.js` (the screens). The experiments' scripts: `tools/journal-lab/`.

## The idea

An assistant that works alongside one person and learns from what they do every day, then offers to do it for them.
Four steps, each feeding the next:

1. **Notice.** Keep a private journal of what happens on the Mac's screen.
2. **Understand.** While the Mac is idle, on-device models turn the journal into sessions, descriptions and routines
   ("every Friday about 4 pm: Slack, mail, the calendar, then the status report to Priya").
3. **Offer.** A card: "You usually do this now. Shall I?" Each routine climbs a ladder of trust by itself:
   suggest → prepare (everything up to the last step) → do and tell → silent. Money and messages to people stay at
   *prepare* unless a rule says otherwise.
4. **Do.** NaoMuse's existing hands: agent tasks, Teach me, app steps, watchers, the mesh and Workers for splitting a job.

The eyes and the hands share one sense: **it learns by watching the screen and acts by looking at it.** That makes it
work with every app (no automation support needed, remote desktops included) and needs one permission, Screen Recording.

Decisions so far (the owner's): for one person first, a small team later; office work first; visual capture, of every
app; all of it local; the Mac is the eyes and the phone the remote; the next phase of NaoMuse, not another app.

## What is built (phase 1: the eyes and the journal)

- **The eyes** (`sg-see`, Swift, both processors). ScreenCaptureKit, as a screen share uses, at most a frame a second and
  only when the screen changed. A frame is kept when 4% or more of a 96 × 54 grey copy differs from the last kept one
  **and it has settled** (the next frame looks the same, or the screen went still for 1.6 s; a playing video is kept
  once every 30 s). Apple's recogniser (Vision, on the device) reads it. One JSON line comes out: the time, the app in
  front and its window title, the lines of text with where they are, where the pointer is, and a 960-pixel JPEG. The
  full picture is never written anywhere.
- **Left out.** Apps in the exclude list (password managers by default; meeting apps while "Leave out meeting apps" is
  on) are cut out of the capture itself, and nothing is kept while one is in front. NaoMuse's own windows too. A window
  that reads "Incognito" or "Private Browsing" near its top is dropped. Text that looks like a card number, a one-time
  code, a password beside its label, or a key is struck out before anything is written (`strike` in
  `desktop/journal.js`; `tests/journal.cjs`). It can't recognise every private thing, and says so: the menu bar has Pause.
- **The store.** A record is `{id, at, app, bundle, title, text, mouse}`: about 400 bytes to 3 KB. A line per record in
  `<userData>/journal/<day>.jl`, each sealed with the Keychain (safeStorage); small pictures a file each in
  `journal/thumbs`, sealed the same. Without the Keychain nothing is written. Settings in `journal/settings.json`.
- **Retention.** Pictures 2 days by default (0 to 30; "Forget only the pictures" drops them at once); text 30 days
  (0 = until deleted). Pruned at start and every hour.
- **Consent.** Off until the owner has read a plain account of what it does and turned it on (`consentAt`): what it
  sees, that it stays on the Mac, what it leaves out, and that running it on this Mac, and telling whoever should know,
  is their responsibility. macOS asks for Screen Recording and shows when the screen is being looked at.
- **Always visible, always stoppable.** While it is on, the menu bar's menu says so, with Pause for an hour, Pause and
  Resume. Voice: "pause the journal", "resume the journal", "open the journal".
- **Trying it.** "Try it now" (the consent screen, and the settings while it is off): on with no time limit; "End the
  try-out and show me" (menu bar, settings) turns it off again and opens the viewer on what was kept (`op('trial')`,
  `op('trialEnd')`; a notification too, as the owner is in another app by then).
- **The viewer.** Settings › Assistant › Journal › Open the journal: a day by session (a gap of 20 minutes starts a
  new one), each moment with its app, window and text; a moment opens with its picture. Forget a moment, a session, the
  last hour, today, the pictures, or everything.
- **Search** (off until turned on): every word must be in a moment's app, title or text; newest first.
- Only on NaoMuse. Nothing of the journal reaches a phone, the mesh, the hive or any model that isn't on this Mac.

## What was measured

**1. Six simulated days** (39 screenshots of the practice sites; two routines hidden among four one-offs; the pipeline
saw only pictures and times). Apple's recogniser: 71 ms a frame, about 100 MB of memory. Sessions: 13 of 13. A text
model (gpt-oss 20B) describing each session from its text: the gist right for all 13. Routines: both found, with their
sessions, day-and-time pattern and steps; all four one-offs left out. What went wrong: invented details ("on Amazon"),
and it missed what varies (the week number).

**2. Real recordings** (openly licensed screen recordings from Wikimedia Commons: "How to import books to Wikidata using
a spreadsheet and OpenRefine", Ursula Oberst, CC BY 4.0; "LibreOffice Calc – Importing Data", Rich Lewis, CC BY 3.0).
Frame choice by change kept one frame every 16 to 21 seconds: about 1,500 a working day. Reading a 1080p frame: 0.17 to
0.27 s, 140 to 180 lines.

**3. Which model reads a screen best** (five real frames, checked by eye):

| Way | Right | Seconds a frame |
|---|---|---|
| gpt-oss 20B on the recognised text only | 2 of 5 (it took entries in a history list for what was being done) | 10 to 35 |
| Qwen3-VL 8B on the full picture | 5 of 5 | 9 |
| Qwen3-VL 8B on the full picture + the recognised text | 5 of 5 | 3 to 10 |
| **Qwen3-VL 8B on a 960-pixel picture + the recognised text** | **5 of 5** | **about 5** |
| Qwen3-VL 2B on a 960-pixel picture + the recognised text | mostly right, wordy | about 5 |

So: **Apple's recogniser on every frame** (exact words: search, striking out, the vision model's spelling) and
**Qwen3-VL 8B on the small kept picture plus that text** for what is happening. That is why the small pictures are 960
pixels wide and kept two days: they are what the vision model reads, within those two days, and the evidence shown
beside a routine. gpt-oss stays for reasoning over the descriptions (sessions, routines).

**4. Live**, on this Mac (2560 × 1662): a frame read in 0.2 s; two frames kept in 20 mostly idle seconds; an 80 KB
picture each.

Not yet measured: a full real working day (cost, battery, how many frames), and how well clicks can be recovered.

## What comes next

2. **Describe.** While the Mac is idle (and on power), Qwen3-VL 8B describes moments from their picture and text: not
   every one (1,500 × 5 s is two hours) but the first of each run in an app or window and those where the pointer
   acted; the rest inherit. The description joins the record; the picture can then go.
3. **Mine.** Sessions → a description each → repeats (by meaning, EmbeddingGemma, and by day and time) → a routine card
   with its evidence (the moments, with pictures while they last), its steps, and what varies (found by comparing the
   repeats, its own step: the first experiment missed it). The owner confirms or corrects every card.
4. **Offer and do.** Routine cards with Do it / Not now / Never; a confirmed routine becomes an agent task ("Show me
   once" where the steps aren't clear); the ladder of trust; approvals on the phone.
5. **Split.** A planner that divides a routine across the mesh's NaoMuses and Workers.

Rules that hold throughout: journal jobs never use a cloud model, even when one is set for other things; the journal
never leaves the Mac; every routine shows its evidence; nothing irreversible without the owner's rule for it.

## Trying it on recordings

`tools/journal-lab/README.md`: choosing frames from a video, reading them, comparing models, and the simulated days.
`Journal.op('ingest', [{file, at, app, title}])` in NaoMuse reads pictures into the journal as if they had been on
screen (what the MuseTester test `journal` does).
