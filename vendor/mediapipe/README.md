# MediaPipe Tasks Vision (vendored)

People tracking on Stage (js/people.js) runs these in its own module worker, loaded on first use.

| File | From | Version | License |
|---|---|---|---|
| `vision_bundle.mjs` | npm `@mediapipe/tasks-vision` | 1.0.1 | Apache-2.0 |
| `wasm/vision_wasm_module_internal.{js,wasm}` | same package (the ES-module build, for module workers) | 1.0.1 | Apache-2.0 |
| `models/gesture_recognizer.task` | Google MediaPipe models (float16, `gesture_recognizer/gesture_recognizer`) | latest | Apache-2.0 |
| `models/pose_landmarker_lite.task` | Google MediaPipe models (float16, `pose_landmarker/pose_landmarker_lite`) | latest | Apache-2.0 |
| `models/face_landmarker.task` | Google MediaPipe models (float16, `face_landmarker/face_landmarker`) | latest | Apache-2.0 |

Update: `npm pack @mediapipe/tasks-vision`, copy `vision_bundle.mjs` and `wasm/vision_wasm_module_internal.*`; models from
`https://storage.googleapis.com/mediapipe-models/<task>/<model>/float16/latest/<model>.task`.
The gesture recognizer knows: None, Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou.
