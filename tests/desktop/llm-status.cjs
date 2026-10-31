// node tests/desktop/llm-status.cjs: desktop/llm.js reports the model it's set to use (a comment once cut that field off
// and the built-in engine never saw its model). Uses a throwaway folder; loads no model.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-llm-')), gguf = path.join(dir, 'fake.gguf'); fs.writeFileSync(gguf, 'GGUF....');
fs.writeFileSync(path.join(dir, 'builtin-model.json'), JSON.stringify({ id: 'gpt-oss:20b', path: gguf, source: 'download' }));
const B = require('../../desktop/llm.js')({ app: { getPath: () => dir }, send() {} });
B.status().then(s => {
  for (const k of ['available', 'why', 'model', 'loaded', 'busy', 'gpu', 'downloading', 'models']) assert.ok(k in s, `status has no “${k}”`);
  assert.strictEqual(s.model?.id, 'gpt-oss:20b', 'the chosen model isn’t reported'); assert.ok(Array.isArray(s.models));
  fs.rmSync(dir, { recursive: true, force: true }); console.log('desktop/llm.js status: ok'); process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
