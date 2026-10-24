# Transformers.js with Phonon (pre-release build)

The reply voice (js/phonon.js) uses Gradium's Phonon 31M text-to-speech model, which Transformers.js supports only in
pull request #1811 (https://github.com/huggingface/transformers.js/pull/1811, branch `model/gradium-phonon`, commit
35b1892). Until a release includes it, this folder holds a build of that branch. Licence: Apache-2.0 (Hugging Face).

`transformers.min.js` is the full library, minified with esbuild but broken into short lines (`lineLimit`): GitHub's push
protection otherwise mistakes long minified lines, where a model name like "Mistral" sits beside a long class name, for a
Mistral API key. The ONNX runtime's WebAssembly comes from jsDelivr at the version the build names (cached by sw.js).

Rebuild:

```sh
git clone --depth 1 -b model/gradium-phonon https://github.com/huggingface/transformers.js.git tjs
cd tjs && npx pnpm@10.28.1 install --frozen-lockfile && cd packages/transformers
cp <this folder>/build-phonon.mjs . && node build-phonon.mjs   # → dist/transformers-phonon.min.js
```

When a Transformers.js release includes Phonon, delete this folder and load the release from jsDelivr at a pinned
version (like TRANSFORMERS_URL in js/voice.js).
