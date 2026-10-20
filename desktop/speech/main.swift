// sg-speech: Apple's speech recognizer for StudioGen (desktop/speech.js starts it; the page sees it as
// window.DriveDeckDesktop.speech and js/voice.js wraps it as a Web Speech API recognizer).
// Electron has no Web Speech API, and Whisper misses words with some accents (Indian English); this one supports
// en-IN and the other Indian languages, works on the device where the Mac can, and can be told the words to expect.
//
// Protocol: one JSON object per line.
//   stdin:  {"cmd":"start","id":7,"lang":"en-IN","continuous":true,"onDevice":true,"context":["Sales summary"],"pause":0.9}
//           {"cmd":"stop"}   finish what was heard, then end      {"cmd":"abort"}   end now
//   stdout: {"ev":"ready","auth":"authorized"|"denied"|"restricted"|"notDetermined","mic":true}
//           {"ev":"start"}   {"ev":"result","final":false,"text":"…","alts":["…"]}   {"ev":"error","error":"…","message":"…"}
//           {"ev":"end"}
// One utterance is final after `pause` seconds without new words; with "continuous" it then listens for the next.
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)
var session = 0 // the page's id for the current start, sent back with every event
func emit(_ o: [String: Any]) {
  var o = o; o["id"] = session
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  print(s)
}

final class Listener {
  let engine = AVAudioEngine()
  var recognizer: SFSpeechRecognizer?
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var opts: [String: Any] = [:]
  var running = false, stopping = false, tapped = false
  var lastText = "", lastChange = Date(), timer: Timer?

  func start(_ o: [String: Any]) {
    if running { abort(quiet: true) }
    opts = o
    let lang = o["lang"] as? String ?? "en-IN"
    guard let r = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer() else {
      return fail("language-not-supported", "No recognizer for \(lang)")
    }
    guard r.isAvailable else { return fail("network", "The recognizer isn't available right now") }
    recognizer = r
    let input = engine.inputNode, format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0 else { return fail("audio-capture", "No microphone") }
    if !tapped {
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buf, _ in self?.request?.append(buf) }
      tapped = true
    }
    engine.prepare()
    do { try engine.start() } catch { return fail("audio-capture", error.localizedDescription) }
    running = true; stopping = false
    emit(["ev": "start"])
    begin()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in self?.tick() }
  }

  /** One utterance: a new request and task on the running microphone. */
  func begin() {
    guard let r = recognizer else { return }
    let q = SFSpeechAudioBufferRecognitionRequest()
    q.shouldReportPartialResults = true
    q.taskHint = .dictation
    if #available(macOS 13, *) { q.addsPunctuation = false }
    if let c = opts["context"] as? [String] { q.contextualStrings = Array(c.prefix(100)) }
    if (opts["onDevice"] as? Bool ?? true) && r.supportsOnDeviceRecognition { q.requiresOnDeviceRecognition = true }
    request = q; lastText = ""; lastChange = Date()
    task = r.recognitionTask(with: q) { [weak self] res, err in
      guard let self = self, q === self.request || res?.isFinal == true else { return }
      if let res = res {
        let text = res.bestTranscription.formattedString
        if text != self.lastText { self.lastText = text; self.lastChange = Date() }
        let alts = res.transcriptions.prefix(3).map { $0.formattedString }
        emit(["ev": "result", "final": res.isFinal, "text": text, "alts": Array(alts)])
        if res.isFinal { self.next() }
      } else if let e = err as NSError? {
        // 1110: nothing was said; 216/301: cancelled (we did it)
        if e.code == 1110 { self.next(heard: false) } else if e.code != 216 && e.code != 301 { self.fail("network", e.localizedDescription) }
      }
    }
  }

  /** The words stopped coming: that utterance is done. */
  func tick() {
    guard running, let q = request else { return }
    let pause = opts["pause"] as? Double ?? 0.9
    if !lastText.isEmpty && Date().timeIntervalSince(lastChange) > pause { q.endAudio(); request = nil }
  }

  func next(heard: Bool = true) {
    task = nil
    if running && !stopping && (opts["continuous"] as? Bool ?? false) { begin() } else { end() }
  }

  func stop() { guard running else { return }; stopping = true; if let q = request { q.endAudio(); request = nil } else { end() } }

  func abort(quiet: Bool = false) { task?.cancel(); task = nil; request = nil; if !quiet { end() } else { halt() } }

  func halt() { timer?.invalidate(); timer = nil; if engine.isRunning { engine.stop() }; running = false }

  func end() { let was = running; halt(); if was { emit(["ev": "end"]) } }

  func fail(_ code: String, _ msg: String) { emit(["ev": "error", "error": code, "message": msg]); end() }
}

let listener = Listener()

func authorize(_ then: @escaping () -> Void) {
  SFSpeechRecognizer.requestAuthorization { st in
    AVCaptureDevice.requestAccess(for: .audio) { mic in
      let auth = ["authorized", "denied", "restricted", "notDetermined"][[SFSpeechRecognizerAuthorizationStatus.authorized, .denied, .restricted, .notDetermined].firstIndex(of: st) ?? 3]
      emit(["ev": "ready", "auth": auth, "mic": mic])
      DispatchQueue.main.async { if st == .authorized && mic { then() } else { listener.fail("not-allowed", "Speech recognition or the microphone isn't allowed for StudioGen (System Settings › Privacy & Security)") } }
    }
  }
}

FileHandle.standardInput.readabilityHandler = { h in
  let data = h.availableData
  if data.isEmpty { exit(0) } // StudioGen went away
  for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
    guard let o = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any], let cmd = o["cmd"] as? String else { continue }
    DispatchQueue.main.async {
      switch cmd {
      case "start": listener.abort(quiet: true); session = o["id"] as? Int ?? 0; authorize { listener.start(o) }
      case "stop": listener.stop()
      case "abort": listener.abort()
      default: break
      }
    }
  }
}
RunLoop.main.run()
