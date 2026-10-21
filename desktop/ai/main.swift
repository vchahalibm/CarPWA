// sg-ai: Apple's on-device language model (Foundation Models, the model behind Apple Intelligence) for StudioGen
// (desktop/ai.js starts it; the page sees it as window.DriveDeckDesktop.ai: the Brain's “This Mac” provider and
// commands by intent, also for the phones that ask their Mac).
// Needs macOS 26+, Apple silicon and Apple Intelligence on; otherwise it says so ("status") and the app does without.
//
// Protocol: one JSON object per line.
//   stdin:  {"cmd":"status"}
//           {"cmd":"ask","id":7,"instructions":"…","prompt":"…","schema":{…JSON-schema subset…},"temperature":0.2,"max":300}
//   stdout: {"ev":"status","available":true}  or  {"ev":"status","available":false,"reason":"…"}
//           {"ev":"done","id":7,"text":"…"}  or, with a schema,  {"ev":"done","id":7,"json":"{…}"}
//           {"ev":"error","id":7,"error":"…"}
// Schemas: {"type":"object","properties":{…},"required":[…]}, {"type":"string","enum":[…]}, string, number, integer,
// boolean, {"type":"array","items":{…}}; "description" anywhere.
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

setvbuf(stdout, nil, _IOLBF, 0)
// `sg-ai --built-with`: whether this build has the framework (CI checks it, so a too-old Xcode can't ship a helper that
// always says “not available”).
if CommandLine.arguments.dropFirst().first == "--built-with" {
  #if canImport(FoundationModels)
  print("FoundationModels"); exit(0)
  #else
  print("none"); exit(1)
  #endif
}
let out = DispatchQueue(label: "out")
func emit(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  out.sync { print(s) }
}

func status() -> [String: Any] {
  #if canImport(FoundationModels)
  if #available(macOS 26.0, *) {
    switch SystemLanguageModel.default.availability {
    case .available: return ["ev": "status", "available": true]
    case .unavailable(let why): return ["ev": "status", "available": false, "reason": "\(why)"]
    }
  }
  #endif
  return ["ev": "status", "available": false, "reason": "needs macOS 26 or later"]
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
func dyn(_ j: [String: Any], _ name: String) -> DynamicGenerationSchema {
  let desc = j["description"] as? String
  switch j["type"] as? String ?? "string" {
  case "object":
    let props = j["properties"] as? [String: Any] ?? [:], req = Set(j["required"] as? [String] ?? Array(props.keys))
    return DynamicGenerationSchema(name: name, description: desc, properties: props.keys.sorted().map { k in
      DynamicGenerationSchema.Property(name: k, description: (props[k] as? [String: Any])?["description"] as? String,
                                       schema: dyn(props[k] as? [String: Any] ?? [:], "\(name)_\(k)"), isOptional: !req.contains(k)) })
  case "array": return DynamicGenerationSchema(arrayOf: dyn(j["items"] as? [String: Any] ?? [:], "\(name)_item"))
  case "number": return DynamicGenerationSchema(type: Double.self)
  case "integer": return DynamicGenerationSchema(type: Int.self)
  case "boolean": return DynamicGenerationSchema(type: Bool.self)
  default:
    if let e = j["enum"] as? [String], !e.isEmpty { return DynamicGenerationSchema(name: name, description: desc, anyOf: e) }
    return DynamicGenerationSchema(type: String.self)
  }
}

@available(macOS 26.0, *)
func ask(_ o: [String: Any]) async {
  let id = o["id"] as? Int ?? 0
  do {
    guard case .available = SystemLanguageModel.default.availability else { throw NSError(domain: "sg-ai", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence isn't available on this Mac"]) }
    let s = LanguageModelSession(instructions: o["instructions"] as? String ?? "")
    let opts = GenerationOptions(temperature: o["temperature"] as? Double, maximumResponseTokens: o["max"] as? Int)
    let prompt = o["prompt"] as? String ?? ""
    if let sj = o["schema"] as? [String: Any] {
      let schema = try GenerationSchema(root: dyn(sj, "Answer"), dependencies: [])
      let r = try await s.respond(to: prompt, schema: schema, options: opts)
      emit(["ev": "done", "id": id, "json": r.content.jsonString])
    } else {
      let r = try await s.respond(to: prompt, options: opts)
      emit(["ev": "done", "id": id, "text": r.content])
    }
  } catch { emit(["ev": "error", "id": id, "error": error.localizedDescription]) }
}
#endif

FileHandle.standardInput.readabilityHandler = { h in
  let data = h.availableData
  if data.isEmpty { exit(0) } // StudioGen went away
  for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
    guard let o = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any], let cmd = o["cmd"] as? String else { continue }
    if cmd == "status" { emit(status()); continue }
    if cmd == "ask" {
      #if canImport(FoundationModels)
      if #available(macOS 26.0, *) { Task { await ask(o) }; continue }
      #endif
      emit(["ev": "error", "id": o["id"] as? Int ?? 0, "error": "needs macOS 26 or later"])
    }
  }
}
RunLoop.main.run()
