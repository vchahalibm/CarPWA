# On-device AI in a PWA: memory strategy

DriveDeck runs several AI models inside the browser: speech recognition (Whisper), the reply voice (Kokoro), and soon camera object detection and scene summaries. On iPhone the page is killed and reloaded when it uses too much memory. This document says why that happens, lists the ways around it, and recommends one design.

## 1. What the logs show

| Device | What happened |
|---|---|
| iPad (8 cores) | Reloaded when Whisper CPU, Whisper GPU and the fp32 GPU reply voice (~310 MB) were loaded together, and when two comparisons overlapped. Fine with one or two models loaded. |
| iPhone (4 cores) | Reloaded while loading Whisper for the GPU (fp16 encoder + q4 decoder, ~165 MB), **with nothing else tracked as loaded**. The CPU reply voice took 5.7 s to its first sentence (iPad GPU: 1.2 s). |

The iPhone crash happened with "nothing loaded" because the tracker only counts models. The CPU Whisper that had just been freed left its **WebAssembly heap** behind. A WebAssembly memory can grow but never shrink; it is released only when its thread (the page or a worker) ends. The GPU model's download buffer, its copy into the runtime, and its upload to the GPU then pushed the page over the limit.

## 2. The constraint

- **The limit is per page and not exposed to the page.** On iOS the tab's web-content process is killed ("jetsam") above a limit that depends on the device's RAM, what else is running, and even the time since reboot. Examples reported: about **1.5 GB on iPhone 12 Pro** and **about 3 GB on iPhone 15 Pro** before the tab reloads. iPads have far more headroom. No exception is thrown and `try/catch` can't catch it. The page just reloads ("This webpage was reloaded because it was using significant memory").
- **Everything counts.** Workers run in the same process, so their memory counts too. WebGPU buffers live in unified memory. The map's WebGL tiles and 3D terrain textures, and canvases, count as well.
- **Loading costs more than running.** A model briefly needs **2–3× its file size**: the downloaded buffer, the runtime's own copy, and for WebGPU the upload to GPU buffers. While running it uses about 1.2–1.5× plus activations. WebGPU on phones also caps a single storage buffer at 256 MB.
- **"Unload" doesn't return WebAssembly memory.** `dispose()` frees the model inside the runtime, but the heap stays at its peak size until its worker ends.

## 3. Techniques that help

| # | Technique | What it saves | Effort | Verdict |
|---|---|---|---|---|
| 1 | **One model per worker; end the worker when idle** | All of it: ending a worker is the only way to hand WebAssembly and GPU memory back | Medium | **Core fix** |
| 2 | **Memory budget + scheduler** (per device class; only what the current activity needs stays loaded) | Stops models piling up | Medium | **Core fix** |
| 3 | **One big load at a time** (already added) | Halves the peak during loading | Done | Keep |
| 4 | **Disk caching** (Cache Storage/OPFS + `navigator.storage.persist()`) | *No RAM saved*, but reloading from disk takes 1–2 s instead of a download, so unloading and reloading become cheap | Low (mostly done) | **Enabler** for 1–2 |
| 5 | **Smaller models**: Moonshine tiny (27M parameters) or whisper-tiny.en for speech recognition; Kokoro q8/fp16; a small detector for vision; the smallest vision-language model (SmolVLM-256M) | 2–10× per model | Low–medium | **Yes**, by device class |
| 6 | **Quantisation** (q4/q8/fp16 by device) | 2–4× | Low | Yes (fp16 on GPU already) |
| 7 | **Runtime settings**: turn off ONNX Runtime's CPU memory arena and memory pattern (`enableCpuMemArena: false`, `enableMemPattern: false`); don't keep the download buffer after loading | 10–30% of the runtime overhead | Low | Yes |
| 8 | **One runtime for all models** (today Whisper uses transformers.js 4.3 and Kokoro brings its own 3.5, so two runtimes) | One WebAssembly heap and one set of WebGPU shaders instead of two | Medium | Later |
| 9 | **The phone's own engines**: built-in speech recognition and voices | **Zero** app memory; they run outside the page | Low (exists) | **Yes on iPhone** |
| 10 | **Cloud for the heavy part** (scene summaries by a hosted vision model, when online) | Whole model classes | Medium | **Yes for summaries** |
| 11 | **Slim the rest of the app** while AI is busy: 3D terrain off, smaller map tile cache, one map instead of two, cap the pixel ratio | 100–300 MB | Low | Yes |
| 12 | **Camera frames without copies**: `VideoFrame`/`ImageBitmap` passed straight to the worker, downscaled to the model's input (e.g. 320 px), 2–5 frames/s | Avoids 10s of MB per second of garbage | Low | Yes, for vision |
| 13 | Cross-origin isolation (multi-threaded WebAssembly) | Speed, not memory (adds shared memory) | Medium | Only for speed |
| 14 | WebNN (phone neural hardware) | Future: native-like efficiency | — | Not in Safari yet |
| 15 | **Native shell** (e.g. Capacitor) with the web UI inside and native plugins for speech/vision using the system's ML frameworks and neural engine | Native apps get much larger limits; the heavy models leave the page | High | The escape hatch if many models must run together on iPhone |

**What doesn't help:** more caching of model files does not reduce RAM. Service-worker caching, IndexedDB and OPFS are disk. They matter only because they make on-demand loading fast (technique 4).

## 4. Recommended design: "load per activity, in workers, within a budget"

### 4.1 Model host
- Each model family runs in **its own dedicated worker**: `stt`, `tts`, `detect`, `vlm`. The page talks to it by message; audio and frames are *transferred* (no copies).
- Unloading a model **ends its worker** (`worker.terminate()`), which returns its WebAssembly heap and GPU buffers to the system. Reloading from the disk cache takes about 1–2 s.
- Every load goes through the existing one-at-a-time queue. Each worker uses the lean runtime settings (technique 7).

### 4.2 Budget and scheduler
- A **device class** is chosen on first run and refined by the crash detector. If a load was running when the app died, the budget drops a level and that model build is marked "too big here".

  | Class | Example | Large models loaded at once | Policy |
  |---|---|---|---|
  | **Phone** | iPhone | **1** | Speech recognition and the reply voice take turns. Camera mode unloads both and uses the phone's engines for voice. |
  | **Tablet** | iPad | 2 | Listening and reply voice both loaded (full-duplex possible). Camera mode swaps one out. |
  | **Desktop / car head unit** | Chrome on a laptop | 3–4 | Everything loaded. |

- Models are loaded **by activity**. The dashboard idle needs nothing. Talking needs speech recognition, then the reply voice. The camera needs the detector, plus the summariser only when asked. Idle models are ended after about 60 s on a phone, and are pre-loaded when an activity is about to start (e.g. the mic button is pressed).

### 4.3 What runs where

| Capability | iPhone (phone class) | iPad (tablet class) |
|---|---|---|
| Speech recognition | Phone's recognizer by default (0 MB). Offline option: Moonshine tiny / whisper-tiny.en in a worker (~40–60 MB) | Whisper base, GPU fp16/q4 in a worker (0.4 s after you stop) |
| Reply voice | Kokoro fp16 on the GPU in a worker when it fits; else the phone's voice | Kokoro fp16 on the GPU in a worker (~1.2 s to first sound) |
| Object detection (camera) | Small detector (YOLO-nano class / EfficientDet-Lite0, ~5–12 MB), 2–5 frames/s, in a worker, frames downscaled | Same, more frames/s |
| Scene summary | **Cloud** vision model when online (send one frame + detections); offline: detection labels turned into a sentence | Cloud when online; offline option SmolVLM-256M on the GPU while the voice models are swapped out |

### 4.4 Effect on full-duplex
Full-duplex needs listening and the reply voice loaded together:
- **Tablet class:** fine.
- **Phone class:** use the phone's recognizer or Moonshine tiny for listening, with Kokoro fp16 on the GPU for replies. If the budget is still exceeded, the phone's voice for replies.
- **Camera mode on a phone:** pauses duplex, or uses only the phone's engines.

## 5. Order of work
1. ✅ **Whisper into its own worker** (like Kokoro), and end workers on unload. Fixes the iPhone crash, where a freed model's heap was still resident. A build that fails to load has its worker ended before the next one is tried.
2. ✅ **Lean runtime settings** for Whisper (`enableCpuMemArena: false`, `enableMemPattern: false`). kokoro-js doesn't pass session options through, so the reply voice keeps the defaults; its worker is still ended on unload.
3. ✅ **Device class + budget scheduler + crash-driven downgrade** (`Budget` in js/voice.js); the comparison test runs each engine in a fresh worker.
   - Class from the user agent (an iPad reports a Mac user agent with touch; Electron counts as a computer). It can be set by hand in Settings › Logs.
   - A model needed now (listening, or a download you asked for) unloads the least recently used one when the budget is full. Background preloads only use a free slot. So on a phone with Whisper listening, replies use the phone's voice.
   - Each load is noted before it starts and cleared after, or when the app is closed normally. A note still there at launch means the app was killed during that load: the build is skipped from then on (the CPU build is always kept as the last resort), and if other models were loaded, the budget drops by one. Settings › Logs can forget this history.
   - Whisper defaults to the GPU on tablets and computers, unless only the CPU build is downloaded.
3a. ✅ **Desktop build** (`desktop/`, Electron): the same web files as a Mac app. It gets the computer budget (4 models at once), and macOS doesn't kill the app for memory the way iOS kills a tab.
4. **Slim the map while models load** (terrain off on phones during AI loads, smaller tile cache).
5. **Vision:** detector worker plus camera pipeline, then cloud summaries (with an offline fallback).
6. Later: one shared runtime for all models; WebNN when Safari ships it; a native shell only if the phone must run many models at once.

## Sources
- WebKit memory internals: https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit
- iPhone vs iPad WebContent kills (jetsam), per-device limits: https://developer.apple.com/forums/thread/822200 · https://github.com/Nehanth/pooled/issues/207 · https://developer.apple.com/forums/thread/688973
- WebAssembly memory on iOS Safari: https://github.com/godotengine/godot/issues/70621
- ONNX Runtime session options (memory arena / pattern): https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html
- Moonshine in transformers.js: https://huggingface.co/posts/Xenova/486935205804807
- SmolVLM in the browser: https://github.com/huggingface/transformers.js-examples/tree/main/smolvlm-webgpu · https://github.com/huggingface/transformers.js/issues/1205
