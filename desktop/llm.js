'use strict';
/* The language model built into StudioGen (the page: js/llm.js, job runner 'builtin'): llama.cpp through node-llama-cpp,
   on the Mac's graphics chip (Metal), in this process. No other app to install.
   - The model is a GGUF file: downloaded from Hugging Face into <userData>/models (resumable, size checked), or the copy
     Ollama already has (read in place, nothing downloaded twice).
   - Loaded on first use, unloaded after 15 idle minutes (it holds ~13 GB). Up to 3 requests at once (tasks side by side),
     each in its own sequence of one context; more wait their turn.
   - gpt-oss speaks its own chat format (Harmony): named explicitly, as a GGUF from Ollama doesn't carry its template.
   Not in Docker Workers (they use your Mac's model through the mesh). */
const path = require('path'), fs = require('fs'), https = require('https'), os = require('os');

const MODELS = { // what the page offers (js/llm.js LLM_MODELS ids)
  'gpt-oss:20b': { name: 'gpt-oss 20B', files: ['https://huggingface.co/ggml-org/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-MXFP4.gguf'], harmony: true },
  'gpt-oss:120b': { name: 'gpt-oss 120B', files: ['https://huggingface.co/ggml-org/gpt-oss-120b-GGUF/resolve/main/gpt-oss-120b-MXFP4.gguf'], harmony: true },
};
const SEQS = 3, CTX = 16384, IDLE = 15 * 60000;

module.exports = ({ app, send }) => {
  const dir = () => path.join(app.getPath('userData'), 'models'), cfgFile = () => path.join(app.getPath('userData'), 'builtin-model.json');
  const cfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
  const keep = c => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2));
  let lib = null, llama = null, model = null, ctx = null, loading = null, loadedPath = '', idle = null, busy = 0, downloading = null, why = '';
  const waiters = [];

  async function L() { // node-llama-cpp is an ES module, loaded when first needed
    if (lib) return lib;
    try { lib = await import('node-llama-cpp'); } catch (e) { why = `llama.cpp isn’t in this build (${e.message})`; throw new Error(why); }
    return lib;
  }
  const fileOf = id => path.join(dir(), path.basename(new URL(MODELS[id].files[0]).pathname));
  /** The copy of a model Ollama has (its GGUF blob), if any. */
  function ollamaCopy(id) {
    try {
      const [n, tag] = id.split(':'), base = path.join(os.homedir(), '.ollama', 'models');
      const m = JSON.parse(fs.readFileSync(path.join(base, 'manifests', 'registry.ollama.ai', 'library', n, tag), 'utf8'));
      const l = m.layers.find(x => /model$/.test(x.mediaType)); const p = path.join(base, 'blobs', l.digest.replace(':', '-'));
      const h = Buffer.alloc(4); const fd = fs.openSync(p, 'r'); fs.readSync(fd, h, 0, 4, 0); fs.closeSync(fd);
      return h.toString() === 'GGUF' ? p : null;
    } catch { return null; }
  }
  const present = id => { const f = fileOf(id); return MODELS[id].files.every((u, i) => fs.existsSync(i ? f.replace(/-00001-of/, `-0000${i + 1}-of`) : f)) ? f : null; };

  async function load() {
    const c = cfg(); if (!c.path || !fs.existsSync(c.path)) throw new Error('No model chosen for the built-in engine (Settings › Assistant › Language model)');
    if (model && loadedPath === c.path) return;
    if (loading) return loading;
    loading = (async () => {
      const { getLlama } = await L();
      llama ||= await getLlama({ gpu: 'auto', build: 'never' });
      if (model) await unload();
      const t0 = Date.now(); model = await llama.loadModel({ modelPath: c.path }); loadedPath = c.path;
      ctx = await model.createContext({ contextSize: CTX, sequences: SEQS, flashAttention: true }); // flash attention: less memory for the 3 sequences
      console.log(`builtin model: ${path.basename(c.path)} loaded in ${Date.now() - t0} ms (${llama.gpu || 'cpu'})`);
    })().finally(() => { loading = null; });
    return loading;
  }
  async function unload() { const m = model, x = ctx; model = ctx = null; loadedPath = ''; try { await x?.dispose(); } catch {} try { await m?.dispose(); } catch {} }
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => { if (!busy) unload().then(() => console.log('builtin model: unloaded (idle)')); }, IDLE); };

  /** { system, prompt | messages [{role, content}], schema?, max?, temperature?, effort? } → { text }. A failure of the graphics
      chip (out of memory: another app took it) leaves llama.cpp's backend broken: it's made again and the request tried once more. */
  async function chat(o = {}) {
    try { return await chat1(o); }
    catch (e) {
      if (!/Eval has failed|backend|Metal|memory/i.test(e.message)) throw e;
      console.warn('builtin model: the graphics chip failed, starting again', e.message);
      await unload(); try { await llama?.dispose(); } catch {} llama = null; busy = 0;
      return chat1(o);
    }
  }
  async function chat1(o = {}) {
    await load(); touch();
    if (busy >= SEQS) await new Promise(r => waiters.push(r)); // all sequences in use: wait for one
    busy++;
    const { LlamaChatSession, HarmonyChatWrapper } = lib, seq = ctx.getSequence();
    try {
      const harmony = cfg().harmony !== false && (/gpt-oss/i.test(cfg().id || '') || model.fileInfo?.metadata?.general?.architecture === 'gpt-oss');
      const msgs = o.messages?.length ? o.messages : [{ role: 'user', content: String(o.prompt ?? '') }];
      const last = msgs[msgs.length - 1], before = msgs.slice(0, -1).filter(m => m.role !== 'system');
      const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: String(o.system || ''), ...(harmony ? { chatWrapper: new HarmonyChatWrapper({ reasoningEffort: ['low', 'medium', 'high'].includes(o.effort) ? o.effort : 'low' }) } : {}) });
      if (before.length) session.setChatHistory([{ type: 'system', text: String(o.system || '') }, ...before.map(m => m.role === 'assistant' ? { type: 'model', response: [String(m.content)] } : { type: 'user', text: String(m.content) })]);
      const maxTokens = Math.min(12000, Math.max(+o.max || 600, 1500)), temperature = o.temperature ?? 0.2;
      // A JSON shape: gpt-oss thinks first, then answers (a grammar from the first token would skip the thinking and it picks
      // worse); the answer is checked, and only when it isn't JSON is it asked again under the grammar.
      if (o.schema && harmony) {
        const t = String(await session.prompt(`${String(last.content ?? '')}\n\nAnswer only with JSON matching this schema: ${JSON.stringify(o.schema)}`, { maxTokens, temperature }) || '').trim();
        const j = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1); try { JSON.parse(j); return { text: j }; } catch {}
        session.setChatHistory([{ type: 'system', text: String(o.system || '') }]);
      }
      const grammar = o.schema ? await llama.createGrammarForJsonSchema(o.schema) : undefined;
      const text = await session.prompt(String(last.content ?? ''), { grammar, maxTokens, temperature });
      return { text: String(text || '').trim() };
    } finally { seq.dispose(); busy--; waiters.shift()?.(); touch(); }
  }

  /** Download a model's file(s) into the models folder, resuming a part already there; progress to the page. */
  async function download(id) {
    const m = MODELS[id]; if (!m) throw new Error('Unknown model'); if (downloading) throw new Error('A download is already running');
    fs.mkdirSync(dir(), { recursive: true });
    const urls = m.files, sizes = await Promise.all(urls.map(head)), total = sizes.reduce((a, b) => a + b, 0); let doneBytes = 0;
    downloading = { id, done: 0, total };
    try {
      for (let i = 0; i < urls.length; i++) {
        const f = path.join(dir(), path.basename(new URL(urls[i]).pathname));
        if (fs.existsSync(f) && fs.statSync(f).size === sizes[i]) { doneBytes += sizes[i]; continue; }
        await get(urls[i], `${f}.part`, sizes[i], n => { downloading.done = doneBytes + n; send({ id, done: downloading.done, total }); });
        if (fs.statSync(`${f}.part`).size !== sizes[i]) throw new Error('The download is incomplete: try again (it carries on where it stopped)');
        fs.renameSync(`${f}.part`, f); doneBytes += sizes[i];
      }
      send({ id, done: total, total, ok: true }); use({ id }); return fileOf(id);
    } finally { downloading = null; }
  }
  function req(url, headers = {}, hops = 0) {
    return new Promise((res, rej) => https.get(url, { headers: { 'user-agent': 'StudioGen', ...headers } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 8) { r.resume(); return res(req(new URL(r.headers.location, url).href, headers, hops + 1)); }
      res(r);
    }).on('error', rej));
  }
  async function head(url) { const r = await req(url, { range: 'bytes=0-0' }); r.resume(); const m = /\/(\d+)$/.exec(r.headers['content-range'] || ''); if (!m) throw new Error(`Hugging Face didn’t answer (${r.statusCode})`); return +m[1]; }
  async function get(url, part, size, onp) {
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0; if (have > size) { fs.rmSync(part); have = 0; }
    const r = await req(url, have ? { range: `bytes=${have}-` } : {}); if (![200, 206].includes(r.statusCode)) { r.resume(); throw new Error(`The download failed (${r.statusCode})`); }
    if (r.statusCode === 200) have = 0; // the server sent it all
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' }); let n = have, last = 0;
    await new Promise((res, rej) => { r.on('data', d => { n += d.length; if (Date.now() - last > 500) { last = Date.now(); onp(n); } }); r.on('error', rej); out.on('error', rej); out.on('finish', res); r.pipe(out); });
    onp(n);
  }
  /** Which model the engine uses: a downloaded one, or Ollama's copy ({ id, ollama: true }). */
  function use({ id, ollama }) {
    const p = ollama ? ollamaCopy(id) : present(id); if (!p) throw new Error(ollama ? 'Ollama hasn’t got that model' : 'That model isn’t downloaded');
    keep({ id, path: p, source: ollama ? 'ollama' : 'download', at: new Date().toISOString() }); if (loadedPath && loadedPath !== p) unload(); return true;
  }
  async function status() {
    let ok = true; try { await L(); } catch { ok = false; }
    const c = cfg();
    return { available: ok && process.platform === 'darwin', why, model: c.path && fs.existsSync(c.path) ? { id: c.id, source: c.source, file: path.basename(c.path) } : null, loaded: !!model, busy, gpu: llama?.gpu || null,
      downloading, models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, downloaded: !!present(id), ollama: !!ollamaCopy(id) })) };
  }
  async function remove(id) { const c = cfg(); if (c.id === id && c.source === 'download') { await unload(); keep({}); } for (const f of fs.readdirSync(dir()).filter(f => f.startsWith(path.basename(fileOf(id)).replace(/-00001-of-.*|\.gguf$/, '')))) fs.rmSync(path.join(dir(), f)); return true; }
  return { status, chat, download, use, remove, unload };
};
