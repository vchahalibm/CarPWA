# avatar-lib.min.mjs

One ES module with the parts of [three.js](https://threejs.org/) 0.186.1 (MIT), its GLTFLoader (MIT) and
[@pixiv/three-vrm](https://github.com/pixiv/three-vrm) 3.5.5 (MIT) that the VRM avatar in `js/avatar.js` uses.
Their licence texts are at the end of the file. Loaded with dynamic `import()` the first time an avatar is shown.

Built once from `entry.js` (no build step in the app):

```bash
npm i three@0.186.1 @pixiv/three-vrm@3.5.5 esbuild
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --target=es2020,safari15 --outfile=avatar-lib.min.mjs
```
