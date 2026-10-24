import { build } from 'esbuild';
import { ignoreModulesPlugin } from './scripts/build/plugins/ignoreModulesPlugin.mjs';
import { stripNodePrefixPlugin } from './scripts/build/plugins/stripNodePrefixPlugin.mjs';
import { externalNodeBuiltinsPlugin } from './scripts/build/plugins/externalNodeBuiltinsPlugin.mjs';
import { WEB_IGNORE_MODULES } from './scripts/build/constants.mjs';
await build({ entryPoints: ['src/transformers.js'], bundle: true, minify: true, format: 'esm', platform: 'neutral', target: 'es2022', lineLimit: 160, outfile: 'dist/transformers-phonon.min.js', treeShaking: true,
  plugins: [ignoreModulesPlugin(WEB_IGNORE_MODULES), stripNodePrefixPlugin(), externalNodeBuiltinsPlugin()], logLevel: 'warning' });
