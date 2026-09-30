# Full-duplex voice for DriveDeck: design

**Goal:** you can talk while DriveDeck is talking, and it reacts the way a person would.
- "Stop", "no, take me to work instead" or a new command cuts the reply off within about half a second.
- DriveDeck never reacts to its own voice coming out of the car speakers.
- Nothing gets stuck, whatever the phone, the silent switch, Bluetooth or an incoming call does.

**Status:** design only; nothing here is built yet. It builds on the pieces that already exist: on-device Whisper, the Kokoro reply voice, the command engine in `js/commands.js`, and the debug log in `js/log.js`.

---

## 1. Why the current design can't do it

Today each turn is strictly half-duplex:

`tap → open the mic → record until 5 s of quiet → close the mic → Whisper → command → speak`

- **Mic lifecycle:** the mic is opened and closed every turn, and nothing listens while a reply plays.
- **Two audio contexts at different rates:** a 16 kHz one records and a separate output plays. On an iPhone that combination is fragile: earpiece routing, the audio session getting blocked, and the silent switch are the bugs fixed in the last rounds.
- **Whisper on the main thread:** a long transcription freezes the UI and delays audio callbacks.

Duplex needs the opposite: one long-lived audio pipeline that plays and records at the same time, and a controller that decides what counts as the user speaking.

## 2. Architecture

```
            ┌─────────────────────── main thread ───────────────────────┐
 mic ──►┐   │  TurnManager (state machine, turn ids, cancellation)      │
        │   │     ▲ events            │ commands                        │
        ▼   │     │                   ▼                                 │
  ┌──────────────┐  frames   ┌──────────────┐  text   ┌──────────────┐  │
  │ AudioEngine  │──────────►│  STT worker  │────────►│ Commands.run │  │
  │ (1 context,  │           │ (Whisper,    │         └──────┬───────┘  │
  │  worklets)   │◄──────────│  VAD, echo   │                │ reply    │
  │  capture ◄─┐ │  playback │  filter)     │         ┌──────▼───────┐  │
  │  render ───┼─┼──────────►└──────────────┘         │  TTS worker  │  │
  └─────┬──────┘ │  reference signal                  │  (Kokoro)    │  │
        │        └────────────────────────────────────┴──────────────┘  │
        ▼ speaker                                                        │
            └────────────────────────────────────────────────────────────┘
```

### 2.1 AudioEngine: one context, one session, all conversation long

- **One `AudioContext`** at the device rate (48 kHz), created on the tap that starts a conversation and kept running until it ends. No second 16 kHz context, so there is no sample-rate conflict.
- **Audio session `play-and-record`** (`navigator.audioSession.type`) for the whole conversation. That is the only iPhone mode that plays and records at once. It isn't muted by the silent switch, and WebKit routes it to the loudspeaker or Bluetooth when capture is active. When the conversation ends, set it back to `auto` so music apps behave normally.
- **Capture worklet:** gets mic frames from `getUserMedia({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })`. It resamples them to 16 kHz in the worklet and posts 20 ms frames to the STT worker through a `MessagePort`. Nothing touches the main thread.
- **Render worklet:** plays TTS audio from a ring buffer that the TTS worker fills. Because the app renders every output sample itself, it knows exactly what went to the speaker and when. That is the *reference signal*. It sends each block's energy, and the samples decimated to 16 kHz, to the STT worker, timestamped with `currentTime`.
- **One mic stream** for the whole conversation: no per-turn `getUserMedia` (no permission prompts, no session churn).
- **Health watch:**
  - Track `mute`/`ended` events, which fire on phone calls, voice assistants and Bluetooth changes.
  - Context `statechange`, since iOS can suspend it.
  - `devicechange`.
  - On any of these: pause the conversation, show "Paused: tap to resume", and on resume re-acquire with back-off (0.5 s, 1 s, 2 s).

### 2.2 Keeping DriveDeck's own voice out: three layers

Each layer catches what the one before misses, and each is cheap.

1. **Platform echo cancellation (AEC).**
   - iPhone: Safari records with voice processing (the same echo canceller calls use) when `echoCancellation` is on, and it cancels whatever the phone itself plays. Android Chrome uses the hardware AEC.
   - This removes most of the echo, often 25–35 dB.
2. **Double-talk detection with the reference signal**, in the STT worker.
   - Estimate the echo path's gain and delay during the first 300–500 ms of each reply, when the user is most likely silent. Cross-correlate reference energy with mic energy; the delay is typically 40–250 ms, and larger over Bluetooth. Keep the estimate per output route.
   - During playback, count a mic frame as *user speech* only if `micEnergy > max(noiseFloor × 3, echoGain × refEnergy(t − delay) × 4)`. It must also be voiced: zero-crossing rate and spectral flatness in the speech range.
   - Require ≥ 250 ms of such frames within 350 ms before calling it speech.
3. **Transcript echo filter.** Compare anything recognised while a reply is playing with the reply text, word by word, allowing near-misses.
   - If it is mostly the reply's own words (≥ 60 % of its words appear in the current reply sentence or the one before), drop it as echo.
   - This last check is what makes the system stable in a car with loud speakers.

**Self-check.** Count how often layer 3 fires. If echo gets past layers 1–2 more than twice in one reply, the room is too echoey (open windows, speakers at full volume). For the rest of the conversation, switch to "tap or say *stop* to interrupt": keep listening only for a short list of barge-in words (see 2.4) with a stricter threshold. Record this in the debug log.

### 2.3 STT worker: continuous, segmented recognition

- **Where it runs:** Whisper runs in a dedicated Web Worker, which transformers.js supports. The main thread never blocks.
- **Buffering:** a 30 s rolling buffer, with a VAD that cuts it into *utterances*: start on 250 ms of speech, end on quiet. The quiet time is 0.8 s during a reply, where people pause less, and the "act after" setting (5 s default) otherwise.
- **Partial results:** re-decode the open utterance every ~700 ms, without letting a partial delay a final. Partials drive barge-in decisions and the live caption.
- **Final result:** the last decode after the utterance ends, as today's "guess during the pause" does.
- **Model choice:**
  - Partials: `whisper-tiny.en` (fast, ~40 MB).
  - Finals: `whisper-base`, as now.
  - On older phones, or when the debug log shows decode time above 1.5× real time, use base for finals only and skip partials.
- **Messages it sends back:** `speechStart`, `partial{text}`, `final{text, lang, ms}`, `echo{text}`, and `bargeCandidate` (from 2.2 layer 2).

### 2.4 TurnManager: the state machine

```
IDLE ──tap/wake──► LISTENING ──final──► THINKING ──reply──► SPEAKING
  ▲                    ▲                    │                  │  ▲
  │                    │   no command       │                  │  │ false alarm
  │  30 s no speech     └────── "sorry" ◄────┘       speech ◄───┘  │ (no words in 1.2 s)
  └──────────────────────────────────────────────────────────── DUCKED ──words──► BARGE-IN
                                                                                   │
                                            LISTENING ◄── stop TTS, cancel turn ────┘
```

- **Turn ids:** every turn has an id. Every async result (partial, final, TTS sentence, command follow-up) carries it, and anything from an old turn is dropped. The code already does this with `sayId`/`respId`; this design makes it the one rule everywhere.
- **Barge-in happens in two steps**, which is what keeps it stable:
  1. **Duck (soft):** on `bargeCandidate` during SPEAKING, lower the reply to 25 % volume within 50 ms (gain on the render worklet). This costs nothing if it's a false alarm and immediately helps AEC and the user.
  2. **Confirm (hard):** stop the reply and cancel the remaining sentences when either:
     - a `partial` holds ≥ 2 real words that aren't echo, or
     - it holds one barge-in word: *stop, wait, cancel, no, pause, quiet, hang on*, or DriveDeck's name.

     If nothing is confirmed within 1.2 s, restore the volume and carry on.
- **After a barge-in:** the new utterance continues seamlessly. The audio from the duck point onwards is already in the buffer, so no words are lost. Its final result becomes the next command. "Stop" on its own just ends the reply.
- **Hand-offs that leave the app** (a call, Spotify, maps) end the conversation. The mic is released first, then the hand-off happens once the short confirmation has finished, as now.
- **The conversation ends** after 30 s with no speech, on "that's all" or "thanks", or when a hand-off leaves the app. It never keeps the mic open silently: the orb shows a live ring the whole time.

### 2.5 TTS worker: speech that can stop at any time

- **Where it runs:** Kokoro runs in its own Worker and generates sentence by sentence into the render ring buffer, one sentence ahead of playback.
- **Cancel** clears the ring buffer and drops queued sentences. Playback stops within one render quantum (~3 ms).
- **CPU priority:** STT goes first. While the user is speaking, the TTS worker pauses generation between sentences, since there's nothing new to say until the user finishes.
- **Fallback:** if a sentence takes longer than 8 s or the worker dies, the phone's own voice is used, as today. That voice can't be tapped for the reference signal, so layer 2 treats its audio as unknown. The system relies on layers 1 and 3 and raises the barge-in threshold.

### 2.6 Bluetooth and the car's speakers

- **Delay:** Bluetooth adds 100–300 ms of output delay, and cars add cabin echo. The delay estimate from 2.2 covers this, stored per route and re-estimated each reply.
- **Hands-free profile:** if the car connects as a hands-free (phone call) device, iOS may switch to the car's microphone. Log the route (`devicechange` plus track label) and let the engine reset its noise floor on a route change.
- **Recommended setup:** A2DP media audio plus the phone's own mic, which gives the best quality. The debug log shows which one is in use.

## 3. Stability rules

1. **One owner per resource.** AudioEngine owns the context, the mic and the session; nothing else creates audio contexts or calls `getUserMedia`.
2. **Everything cancellable, everything tagged** with its turn id. There are no global "busy" flags that can get stuck.
3. **Watchdogs on every stage:**

   | Stage | Limit | On timeout |
   |---|---|---|
   | STT final | > 6 s | drop it, "sorry" |
   | TTS first sound | > 8 s | phone voice |
   | Context not running | > 1 s after resume | re-create |
   | No mic frames | 2 s while listening | re-acquire the mic |

4. **Degrade, don't fail:**
   - duplex → "say stop to interrupt" → half-duplex (today's behaviour) → typed or tapped commands.
   - The current mode shows on the orb and in the debug log.
5. **Idempotent commands.** A final result runs at most once: the utterance id is recorded when it runs. A partial never triggers an action, except the barge-in words, which only stop playback.
6. **Memory budget:** Whisper-base q8 (~80 MB) plus tiny (~40 MB) plus Kokoro q8 (~90 MB), in workers. If the page is reloaded after a memory kill (iOS), resume in half-duplex and preload the models lazily.

## 4. What the debug log will show

For each conversation, the log will show:
- route, AEC setting, echo delay and gain estimates;
- every `speechStart` / `partial` / `final` / `echo` with times;
- barge-ins: candidate → duck → confirm or false alarm, with latency;
- TTS sentence timings;
- watchdog firings and mode downgrades.

It will also keep per-conversation counters: barge-in latency (target < 500 ms), false barge-ins (target < 1 per 10 replies), echo rejections, and duplex → half-duplex downgrades.

## 5. How to test it

- **Scripted audio:** browser tests with a fake mic that plays recorded speech mixed with the TTS output, delayed by 150 ms and 20 dB down (simulated echo). Check:
  - no self-trigger from echo alone;
  - "stop" during a reply stops it within 500 ms;
  - a new command mid-reply runs, and the old reply's follow-up action doesn't.
- **State-machine unit tests:** feed event timelines (partials, finals, echoes, device changes) to the TurnManager and check the states and actions.
- **In the car:** the debug build with the Logs tab, using the counters above. Try the loudspeaker, Bluetooth media, a hands-free car link, windows open and closed, and music playing.

## 6. Build order

1. **AudioEngine** (one context, `play-and-record`, capture and render worklets), used by today's half-duplex flow. Removes the remaining iPhone audio-routing risk on its own.
2. **Whisper and Kokoro in workers.** The UI stays smooth.
3. **Continuous listening with VAD segmentation and partials.** Conversation mode without barge-in: listening resumes the moment a reply ends.
4. **Echo layers 2 and 3** plus duck-and-confirm barge-in, behind **Settings › Voice › Conversation mode (beta)**.
5. **Automatic downgrade and route handling.** Make it the default once the counters in section 4 meet their targets in real drives.
