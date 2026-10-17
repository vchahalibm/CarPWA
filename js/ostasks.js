'use strict';
/* ============================================================
   Tasks on this computer (StudioGen on a Mac): script steps that run
   AppleScript, JavaScript for Automation, a macOS Shortcut or a shell
   command (desktop/tasks.js runs them in the main process).
   - Steps: { "do": "os.applescript" | "os.jxa" | "os.shortcut" | "os.shell",
     "value": <the code, or the Shortcut's name>, "args": ["{month}", …],
     "as": "result", "background": true… }. The code is used as written:
     values go in as arguments (AppleScript `on run argv`, JXA
     `function run(argv)`, shell "$1"), never pasted into it.
   - The first run of each piece of code asks (a native dialog showing it);
     “Always allow” is remembered for exactly that code.
   - Output: text, or parsed JSON when the task prints JSON. A failure is
     an error (the step's `as` gets {result_error}).
   - OS_TASKS: ready-made tasks to start from (the editor's picker).
   - DriveGen (web) can't run them itself: later through a paired StudioGen.
   Loaded after brain.js.
   ============================================================ */
const OS_KINDS = { applescript: 'AppleScript', jxa: 'JavaScript for Automation', shortcut: 'Shortcut', shell: 'Shell command' };
const OS_TASKS = [
  { id: 'openApp', name: 'Open an app', kind: 'applescript', args: ['Numbers'], hint: 'The app’s name', code: 'on run argv\n  tell application (item 1 of argv) to activate\nend run' },
  { id: 'openPath', name: 'Open a file, folder or link', kind: 'applescript', args: ['~/Documents'], hint: 'A path or a link', code: 'on run argv\n  set p to item 1 of argv\n  if p starts with "~" then set p to (POSIX path of (path to home folder)) & text 3 thru -1 of p\n  do shell script "open " & quoted form of p\nend run' },
  { id: 'front', name: 'What’s in front', kind: 'jxa', args: [], hint: '', about: 'The frontmost app and its window title, as {app, window}', code: 'function run() {\n  const p = Application("System Events").processes.whose({ frontmost: true })[0];\n  let w = ""; try { w = p.windows[0].name(); } catch (e) {}\n  return JSON.stringify({ app: p.name(), window: w });\n}' },
  { id: 'listFolder', name: 'List a folder', kind: 'jxa', args: ['~/Downloads'], hint: 'A folder', about: 'The names of the files in it, as a list', code: 'ObjC.import("Foundation");\nfunction run(argv) {\n  const p = $(argv[0] || "~").stringByExpandingTildeInPath;\n  const a = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(p, null);\n  return JSON.stringify((ObjC.deepUnwrap(a) || []).filter(n => !n.startsWith(".")));\n}' },
  { id: 'finderSel', name: 'Files selected in Finder', kind: 'applescript', args: [], hint: '', code: 'set out to ""\ntell application "Finder"\n  repeat with f in (selection as alias list)\n    set out to out & POSIX path of f & linefeed\n  end repeat\nend tell\nreturn out' },
  { id: 'notify', name: 'Show a notification', kind: 'applescript', args: ['StudioGen', 'The report is ready'], hint: 'Title, then the message', code: 'on run argv\n  display notification (item 2 of argv) with title (item 1 of argv)\nend run' },
  { id: 'mail', name: 'Draft an email', kind: 'applescript', args: ['someone@example.com', 'Subject', 'Message'], hint: 'To, subject, message', code: 'on run argv\n  tell application "Mail"\n    set m to make new outgoing message with properties {subject:(item 2 of argv), content:(item 3 of argv), visible:true}\n    tell m to make new to recipient at end of to recipients with properties {address:(item 1 of argv)}\n    activate\n  end tell\nend run' },
  { id: 'clipboard', name: 'Read the clipboard', kind: 'applescript', args: [], hint: '', code: 'return (the clipboard as text)' },
  { id: 'volume', name: 'Set the volume', kind: 'applescript', args: ['40'], hint: '0 to 100', code: 'on run argv\n  set volume output volume ((item 1 of argv) as integer)\nend run' },
  { id: 'shortcut', name: 'Run a Shortcut', kind: 'shortcut', args: [''], hint: 'Input for it (optional)', code: 'My Shortcut', about: 'Any shortcut from the Shortcuts app, by its name' },
  { id: 'system', name: 'Battery and disk space', kind: 'shell', args: [], hint: '', code: 'pmset -g batt | tail -1 | sed "s/^ *//"; df -h / | tail -1 | awk \'{print $4 " free of " $2}\'' },
];

const OsTasks = {
  can: () => !!window.DriveDeckDesktop?.tasks,
  async run(kind, code, args = [], label = '', timeout = 60) {
    if (!this.can()) throw new Error(`${OS_KINDS[kind] || 'This'} runs in ${APP_NAME === 'StudioGen' ? 'a newer StudioGen: update it' : 'StudioGen on a Mac'}`);
    const id = Math.random().toString(36).slice(2, 8);
    Log.i('os', `Task: ${label || OS_KINDS[kind]}`, { kind, args: args.length });
    const r = await DriveDeckDesktop.tasks.run({ id, kind, code, args, label, timeout });
    if (!r?.ok) { Log.w('os', 'Task failed', { label, err: r?.err, code: r?.code }); throw new Error(r?.denied ? 'You didn’t allow it' : (r?.err || 'It didn’t work').split('\n')[0].slice(0, 200)); }
    Log.i('os', 'Task done', { label, ms: r.ms, chars: r.out.length });
    const t = r.out.trim(); if (/^[[{]/.test(t)) { try { return JSON.parse(t); } catch {} } return t;
  },
  /** Settings › System › Allowed tasks: the code you always allow, to forget. */
  async approvals() {
    const list = this.can() ? await DriveDeckDesktop.tasks.approvals() : [];
    sheet('Tasks you always allow', list.length ? `<ul class="av-report">${list.map(a => `<li>${esc(OS_KINDS[a.kind] || a.kind)}${a.label ? `: ${esc(a.label)}` : ''} <span class="se-note">${esc(a.at.slice(0, 10))}</span> <button class="link-btn" data-osforget="${esc(a.hash)}">Forget</button></li>`).join('')}</ul>` : '<p>None yet: each task asks the first time it runs.</p>',
      [...(list.length ? [['Forget all', async () => { await DriveDeckDesktop.tasks.forget('all'); toast('Every task asks again'); }]] : []), ['Close']]);
  },
};
for (const [k, n] of Object.entries(OS_KINDS)) Actions.define(`os.${k}`, { group: 'This computer', name: `Run ${n}${k === 'shortcut' ? ' (by name)' : ''}`, arg: k === 'shortcut' ? 'The Shortcut’s name' : 'The code', raw: true,
  run: (v, say, ev = {}) => OsTasks.run(k, v, ev.args || [], ev.label || '', ev.timeout || 60) });
ACTIONS.osApprovals = () => OsTasks.approvals();
document.addEventListener('click', async e => { const b = e.target.closest('[data-osforget]'); if (!b) return; e.stopPropagation(); await DriveDeckDesktop.tasks.forget(b.dataset.osforget); b.closest('li').remove(); toast('It asks again next time'); }, true);
