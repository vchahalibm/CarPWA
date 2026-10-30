'use strict';
/* ============================================================
   Workers, made from StudioGen (design: docs/studiogbee.html § 8; worker/README.md):
   - In OrbStack (a container, recommended): StudioGen checks for OrbStack (installs it from orbstack.dev if you want:
     its disk image into Applications; you finish its welcome window), then runs the published image
     (ghcr.io/vchahalibm/studiogen-worker, built by .github/workflows/worker-image.yml) with an invite for one of your
     own devices and a secret for its sign-ins (a file in StudioGen's folder, mounted read-only). All of it through one
     shell script (WORKER_CTL) you approve once; names and values are its arguments, never part of the code.
   - Light, on this Mac (no install): a second, hidden StudioGen with its own profile (desktop/main.js LightWorkers),
     using this Mac's model directly.
   - On another machine: the docker command to paste there, invite and secret filled in.
   Each joins the mesh as yours; then it's signed in and used from here or your phone (Sign in from here, js/remoteview.js).
   Loaded after worker.js.
   ============================================================ */
const WORKER_IMAGE = 'ghcr.io/vchahalibm/studiogen-worker:latest';
// $1 = what to do, then its values. Docker is OrbStack's (or any Docker on the PATH).
const WORKER_CTL = `export PATH="$HOME/.orbstack/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
op="$1"; shift
up() { docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; }
case "$op" in
  check) a=0; [ -d /Applications/OrbStack.app ] || [ -d "$HOME/Applications/OrbStack.app" ] && a=1; d=0; command -v docker >/dev/null && d=1; u=0; up && u=1
    echo "{\\"orbstack\\":$a,\\"docker\\":$d,\\"up\\":$u}" ;;
  install)
    T=$(mktemp -d); curl -fsSL "https://orbstack.dev/download/stable/latest/$(uname -m | sed s/x86_64/amd64/)" -o "$T/o.dmg"
    M=$(hdiutil attach -nobrowse -readonly "$T/o.dmg" | awk -F'\\t' '/Volumes/{print $NF; exit}')
    D=/Applications; [ -w "$D" ] || { D="$HOME/Applications"; mkdir -p "$D"; }
    cp -R "$M/OrbStack.app" "$D/"; hdiutil detach -quiet "$M"; rm -rf "$T"; open "$D/OrbStack.app"; echo installed ;;
  start) open -a OrbStack 2>/dev/null; i=0; while ! up && [ $i -lt 90 ]; do sleep 2; i=$((i+1)); done; up && echo up || { echo "OrbStack isn't running yet: finish its welcome window, then try again" >&2; exit 1; } ;;
  create) n="$1"; img="$2"; inv="$3"; dir="$4"; name="$5"
    mkdir -p "$dir"; chmod 700 "$dir"; [ -s "$dir/secret" ] || { umask 077; openssl rand -hex 32 > "$dir/secret"; }
    docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null || exit 1
    docker run -d --name "sg-worker-$n" --label studiogen.worker="$n" --restart unless-stopped --shm-size 1g \\
      -e SG_NAME="$name" -e SG_MESH_INVITE="$inv" -e SG_SECRET_FILE=/run/sg/secret -v "$dir:/run/sg:ro" -v "sg-worker-$n:/data" "$img" ;;
  update) n="$1"; img="$2"; docker pull -q "$img" >/dev/null || exit 1
    name=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "sg-worker-$n" | sed -n 's/^SG_NAME=//p'); dir=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/run/sg"}}{{.Source}}{{end}}{{end}}' "sg-worker-$n")
    docker rm -f "sg-worker-$n" >/dev/null && docker run -d --name "sg-worker-$n" --label studiogen.worker="$n" --restart unless-stopped --shm-size 1g \\
      -e SG_NAME="$name" -e SG_SECRET_FILE=/run/sg/secret -v "$dir:/run/sg:ro" -v "sg-worker-$n:/data" "$img" ;;
  list) echo "[$(docker ps -a --filter label=studiogen.worker --format '{{json .}}' | paste -sd, -)]" ;;
  start1) docker start "sg-worker-$1" ;;
  stop1) docker stop "sg-worker-$1" ;;
  remove) docker rm -f "sg-worker-$1" >/dev/null; [ "$2" = data ] && { docker volume rm "sg-worker-$1" >/dev/null; rm -rf "$3"; }; echo removed ;;
  logs) docker logs --tail 60 "sg-worker-$1" 2>&1 | grep -v -i dbus | tail -40 ;;
  *) echo "unknown $op" >&2; exit 2 ;;
esac`;
const Workers = {
  can: () => LINK_HOST && typeof OsTasks !== 'undefined' && OsTasks.can(),
  image: () => store.get('workerImage', WORKER_IMAGE),
  ctl(op, ...args) { return OsTasks.run('shell', WORKER_CTL, [op, ...args], 'StudioGen Workers (OrbStack)', op === 'install' ? 900 : op === 'create' || op === 'update' ? 900 : 200); },
  async secretDir(n) { const home = (await OsTasks.run('shell', 'printf %s "$HOME"', [], 'Your home folder', 10)); return `${home}/Library/Application Support/StudioGen/worker-secrets/${n}`; },
  slug: s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'worker',
  /** The mesh the Worker joins: yours, or a new one made now (a Worker is reached through it). */
  async mesh() { if (!Mesh.m) { await Mesh.create(`${Mesh.myName()}’s devices`); toast('Made a mesh for your devices'); await new Promise(r => setTimeout(r, 1500)); } if (!Mesh.amOwner()) throw new Error('Only a mesh owner makes Workers'); return Mesh.invite('member', true); },
  /** Docker ones (containers) and light ones (processes), with their place in the mesh. */
  async list() {
    const out = [];
    if (window.DriveDeckDesktop?.light) for (const w of await DriveDeckDesktop.light('list') || []) out.push({ kind: 'light', id: w.id, name: w.name, state: w.running ? 'running' : 'stopped' });
    if (store.get('workersDocker', false)) try { const r = await this.ctl('list'); for (const j of Array.isArray(r) ? r : []) { out.push({ kind: 'docker', id: j.Labels?.match(/studiogen\.worker=([^,]+)/)?.[1] || j.Names.replace(/^sg-worker-/, ''), name: j.Names, state: j.State, status: j.Status }); } } catch (e) { out.push({ kind: 'docker', error: e.message }); }
    for (const w of out) { const m = Mesh.members().find(x => x.app === 'StudioGen' && (x.name === w.name || this.slug(x.name) === w.id)); if (m) { w.meshId = m.id; w.name = m.name; w.online = Date.now() - (Mesh.presence[m.id]?.at || 0) < 60000; } }
    return out;
  },
  /** In OrbStack: install it if asked, start it, then the container. say(text) tells each step. */
  async createDocker(name, say) {
    store.set('workersDocker', true);
    say('Checking for OrbStack…'); let c = await this.ctl('check');
    if (!c.orbstack && !c.docker) { if (!await new Promise(res => sheet('OrbStack', '<p>Workers run in <b>OrbStack</b> (orbstack.dev), a small app that runs containers on your Mac. It’s free for personal use (businesses need a licence). StudioGen can download it (about 470 MB) and open it; you finish its welcome window.</p>', [['Install OrbStack', () => res(true)], ['Cancel', () => res(false)]]))) throw new Error('Not now');
      say('Installing OrbStack (about 470 MB)…'); await this.ctl('install'); }
    if (!c.up) { say('Starting OrbStack (finish its welcome window if it shows one)…'); await this.ctl('start'); }
    const id = this.slug(name), inv = await this.mesh(), dir = await this.secretDir(id);
    say(`Making ${name} (the first time, its image downloads: about 1 GB)…`);
    await this.ctl('create', id, this.image(), inv, dir, name);
    Log.i('workers', `Worker ${name} started in OrbStack`); return id;
  },
  /** Light: a hidden StudioGen on this Mac (no install), using this Mac's model directly. */
  async createLight(name, say) {
    const id = this.slug(name), inv = await this.mesh(), c = LLM.cfg(); say(`Starting ${name}…`);
    await DriveDeckDesktop.light('create', { id, name, invite: inv, llm: !LLM.biReady() && LLM.health?.ok ? { url: c.url, model: c.model } : null }); // with the built-in model, it asks this StudioGen (a second copy would need another 13 GB)
    Log.i('workers', `Light worker ${name} started`); return id;
  },
  /** For another machine (NAS, server): the command to paste there. */
  async command(name) {
    const inv = await this.mesh(), sec = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''), id = this.slug(name);
    return `docker run -d --name sg-worker-${id} --restart unless-stopped --shm-size 1g -e SG_NAME="${name.replace(/"/g, '')}" -e SG_MESH_INVITE="${inv}" -e SG_SECRET="${sec}" -v sg-worker-${id}:/data ${this.image()}`;
  },
  /* ---------- Mesh › Workers ---------- */
  async sheet() {
    if (!this.can()) return sheet('Workers', '<p>Workers are made from StudioGen on a Mac.</p>', [['OK']]);
    sheet('Workers', '<p class="se-note">Looking…</p>', [['Close']]);
    const l = await this.list().catch(e => [{ error: e.message }]);
    const row = w => w.error ? `<li class="se-note">${esc(w.error)}</li>` : `<li>${w.online ? '🟢' : w.state === 'running' ? '🟡' : '⚪️'} <b>${esc(w.name)}</b> <span class="se-note">${w.kind === 'docker' ? 'in OrbStack' : 'light, on this Mac'} · ${esc(w.state)}${w.online ? ' · in the mesh' : w.state === 'running' ? ' · joining…' : ''}</span><br>
      ${w.meshId ? `<button class="link-btn" data-rvopen="web|${esc(w.meshId)}">Sign in from here</button> <button class="link-btn" data-rvopen="app|${esc(w.meshId)}">See its screen</button> ` : ''}${w.kind === 'light' && w.state === 'running' ? `<button class="link-btn" data-wk="show|light|${esc(w.id)}">Show its window</button> ` : ''}
      <button class="link-btn" data-wk="${w.state === 'running' ? 'stop' : 'start'}|${w.kind}|${esc(w.id)}">${w.state === 'running' ? 'Stop' : 'Start'}</button> ${w.kind === 'docker' ? `<button class="link-btn" data-wk="update|docker|${esc(w.id)}">Update</button> <button class="link-btn" data-wk="logs|docker|${esc(w.id)}">Log</button> ` : ''}<button class="link-btn" data-wk="remove|${w.kind}|${esc(w.id)}">Remove</button></li>`;
    sheet('Workers', `<p class="se-note">A Worker is another StudioGen of yours that runs by itself: its own sign-ins (a second WhatsApp, a work account), tasks run side by side, all using this Mac’s language model. Sign in to it from here or your phone.</p>
      ${l.length ? `<ul class="av-report">${l.map(row).join('')}</ul>` : '<p class="se-note">None yet.</p>'}
      <div class="chip-row"><button class="chip accent" data-wk="new">+ New Worker</button></div>`, [['Close']]);
  },
  newSheet() {
    sheet('New Worker', `<label class="se-field"><span>Its name</span><input id="wkName" value="Worker ${(Mesh.members().filter(x => x.app === 'StudioGen').length || 1)}"></label>
      <label class="se-check"><input type="radio" name="wkKind" value="docker" checked> <span><b>In OrbStack</b> (recommended): a container, kept apart from this Mac; StudioGen installs OrbStack if needed</span></label>
      <label class="se-check"><input type="radio" name="wkKind" value="light"> <span><b>Light, on this Mac</b>: nothing to install; a hidden StudioGen with its own sign-ins (stops when this Mac sleeps)</span></label>
      <label class="se-check"><input type="radio" name="wkKind" value="remote"> <span><b>On another machine</b> (a NAS or server with Docker): a command to paste there</span></label>
      <div class="su-bar" id="wkBar" hidden><i></i></div><p class="se-note" id="wkSay"></p>`,
      [['Make it', () => this.make($('#wkName').value.trim(), $('input[name="wkKind"]:checked').value)], ['Cancel', () => this.sheet()]]);
  },
  async make(name, kind) {
    if (!name) return toast('A name, please');
    const say = t => { const p = $('#wkSay'); if (p) p.textContent = t; else toast(t); };
    try {
      if (kind === 'remote') { const cmd = await this.command(name); return sheet('On another machine', `<p class="se-note">Run this on the machine with Docker (it joins your mesh by itself, as yours). It holds an invite (good for a day) and the secret that locks its sign-ins: keep it to yourself.</p><textarea rows="7" readonly class="se-wide" onclick="this.select()">${esc(cmd)}</textarea>`, [['Copy', () => navigator.clipboard?.writeText(cmd).then(() => toast('Copied'))], ['Done', () => this.sheet()]]); }
      say('Working…');
      const id = kind === 'light' ? await this.createLight(name, say) : await this.createDocker(name, say);
      toast(`${name} is starting: it joins your mesh in a minute`); setTimeout(() => this.sheet(), 800); return id;
    } catch (e) { say(`Didn’t work: ${e.message}`); toast(e.message); }
  },
};
ACTIONS.workers = () => Workers.sheet();
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-wk]'); if (!b) return; e.stopPropagation();
  const [k, kind, id] = b.dataset.wk.split('|');
  if (k === 'new') return Workers.newSheet();
  try {
    if (kind === 'light') { if (k === 'remove' && !confirm('Remove this Worker? Its sign-ins and tasks go too.')) return; await DriveDeckDesktop.light(k, k === 'remove' ? { id, data: true } : id); }
    else if (k === 'logs') return sheet('Its log', `<pre class="se-wide" style="max-height:50vh;overflow:auto;font-size:12px">${esc(await Workers.ctl('logs', id))}</pre>`, [['Back', () => Workers.sheet()]]);
    else if (k === 'update') { toast('Updating (downloads the newest image)…'); await Workers.ctl('update', id, Workers.image()); toast('Updated'); }
    else if (k === 'remove') { if (!confirm('Remove this Worker? Its sign-ins and tasks go too.')) return; await Workers.ctl('remove', id, 'data', await Workers.secretDir(id)); }
    else await Workers.ctl(k === 'stop' ? 'stop1' : 'start1', id);
  } catch (err) { toast(err.message); }
  setTimeout(() => Workers.sheet(), 600);
}, true);
