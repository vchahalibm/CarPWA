// node tools/prompts/gen.cjs → docs/llm/app-prompts.md: every prompt the apps send to a language model, from LLM_PROMPTS in
// js/llm.js (the defaults; Settings › Assistant › Prompts shows what you changed). Run it after changing a prompt.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '../..'), src = fs.readFileSync(path.join(root, 'js/llm.js'), 'utf8');
const ctx = { store: { get: (k, d) => d, set() {} }, document: { addEventListener() {} }, ACTIONS: {}, setTimeout() {}, setInterval() {}, console };
vm.createContext(ctx); vm.runInContext(src + '\n;globalThis.__P = LLM_PROMPTS; globalThis.__R = LLM.ROLES;', ctx);
const P = ctx.__P, R = Object.fromEntries(ctx.__R.map(([k, n, d]) => [k, `${n} (${d})`]));
let md = `# The prompts in the apps\n\nEvery prompt DriveGen and StudioGen send to a language model, as shipped. Generated from \`LLM_PROMPTS\` in [js/llm.js](../../js/llm.js) by \`node tools/prompts/gen.cjs\`; don't edit this file by hand.\n\nYou can read and change each one in **Settings › Assistant › Prompts** (changes are kept on that device; Reset brings the default back). Words in {braces} listed under a prompt are filled in by the app.\n\nWhich model answers: **Settings › Assistant › Language model**. There are three jobs, and each can run on this Mac's model (gpt-oss by default, through Ollama), on your Mac's model from a phone or Worker, on Claude, or on Apple's on-device model as the last resort:\n\n${Object.entries(R).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}\n`;
for (const [id, p] of Object.entries(P)) {
  md += `\n## ${p.name} \`${id}\`\n\n- Job: **${p.role}**\n- Used in: ${p.where}\n${p.vars.length ? `- Filled in by the app: ${p.vars.map(v => `\`{${v}}\``).join(', ')}\n` : ''}`;
  const text = p.file ? fs.readFileSync(path.join(root, p.file), 'utf8') : p.text;
  md += p.file ? `\n<details><summary>The full text of ${p.file} (${text.split(/\s+/).length} words)</summary>\n\n\`\`\`\`markdown\n${text}\n\`\`\`\`\n\n</details>\n` : `\n\`\`\`text\n${text}\n\`\`\`\n`;
}
md += `\n## Also sent (not editable)\n\n- **JSON schemas**: cards, times, commands and the planner ask for a fixed shape (e.g. \`CARD_SCHEMA\` in js/agent.js); with Claude the schema is added to the prompt as text.\n- **Commands by meaning** fill \`{commands}\` with up to 20 commands that share words with what was said (Intent.shortlist in js/brain.js), plus names of scripts, devices and people as \`{hints}\`.\n- **Build by talking** adds, after the build prompt and \`build.inapp\`, the list of tasks already in the app (TaskBuild.system in js/taskbuild.js).\n`;
fs.writeFileSync(path.join(root, 'docs/llm/app-prompts.md'), md); console.log(`docs/llm/app-prompts.md: ${Object.keys(P).length} prompts`);
