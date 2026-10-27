import { execFileSync } from 'child_process';
// Tandem journeys: acts of steps the runner (run.mjs) walks through. Add acts here as features land.
// A step: title; you (what you do: html, or a function returning it); auto (what the runner does instead in --auto);
// always (the runner always does it: setup); check (true, or a short text saying what it's still waiting for);
// wait (seconds before an unattended check fails); before (runs first, e.g. to remember a value).
// say(dev, text, ui) makes a step you can do by talking or typing (the Assistant widget, or the mic) and that the
// runner does in --auto by sending the same words through the app's command matcher (Tandem.STEPS.command).

export function journeys({ A, B, P, devs, sleep }) {
  const S = {}, st = async d => (await d.state().catch(() => null)) || {};
  const id = async d => (await st(d)).mesh?.me;
  const say = (dev, text, ui) => ({
    you: () => `On <b>${dev.label}</b>: ${ui ? `${ui}<br>— or say or type in the Assistant: ` : 'say or type in the Assistant: '}<q class="cmd">${text}</q>`,
    auto: () => dev.step('command', text), words: text,
  });
  const since = (s, t, re) => (s.said || []).some((l, i) => /^app:/.test(l) && re.test(l) && (s.saidAt?.[i] || 0) > t);
  const lastReply = s => (s.said || []).filter(l => /^app:/.test(l)).pop() || '';

  // What each StudioGen has before the journey starts
  const setup = {
    A: `(()=>{ const add=(n,j)=>Scripts.add({ name:n, ...j });
      add('Daily brief', { beats:[{ id:'a', title:'Brief', do:[{say:'Three meetings today; the first at ten.'}], next:{after:0.3} }] });
      add('Keynote', { beats:[{ id:'a', title:'Welcome', say:'Welcome, everyone.', next:{after:2} }, { id:'b', title:'The numbers', say:'Here are the numbers.', next:{event:'mesh.cue'} }, { id:'c', title:'Thank you', say:'Thank you.' }] });
      store.set('linkOffers', Scripts.mine().filter(s => s.name==='Daily brief').map(s => s.id)); return 1 })()`,
    B: `(()=>{ const add=(n,j)=>Scripts.add({ name:n, ...j });
      add('Sales summary', { beats:[{ id:'a', title:'Sales', do:[{say:'Sales are up 12 percent.'}], next:{after:0.3} }] });
      add('Welcome tour', { beats:[{ id:'a', title:'Hello', say:'Welcome to the lobby.' }] });
      add('Draft pitch', { beats:[{ id:'a', title:'Draft', say:'Not ready yet.' }] });
      store.set('linkOffers', Scripts.mine().filter(s => s.name==='Sales summary').map(s => s.id)); Mesh.setPrivate('script','Draft pitch',true); return 1 })()`,
  };

  const demo = {
    setup: [
      { title: 'The StudioGens get their scripts (Daily brief and Keynote on A; Sales summary, Welcome tour and a private Draft pitch on B)', always: true,
        auto: async () => { await A.eval(setup.A); await B.eval(setup.B); }, check: async () => { const [a, b] = await Promise.all([st(A), st(B)]); return a.scripts?.includes('Keynote') && b.scripts?.includes('Draft pitch') || 'scripts not there yet'; } },
    ],
    pair: [
      { title: 'Studio A makes a pairing code, with a secret phrase', you: 'On <b>Studio A</b>: Settings › Connections › <b>Pair a phone or iPad (once)</b>, type the secret phrase <q class="cmd">blue harbour</q>, and leave the code on screen.',
        auto: () => A.eval(`Relay.newPairing('blue harbour')`), check: async () => (S.code = await A.eval('Relay._tandemCode || ""')) ? true : 'no code yet' },
      { title: 'The phone pairs with the pasted code and the phrase', you: async () => `On <b>Test iPhone</b>: Settings › Connections › <b>Pair once</b> › <b>No camera? Paste the code</b> (it's on ${await P.clip(S.code)}) › <b>Use this code</b>, then type the phrase <q class="cmd">blue harbour</q>.`,
        auto: async () => { await P.step('pair', S.code); await P.step('phrase', 'blue harbour'); },
        check: async () => { const p = await st(P), a = await st(A); return p.paired?.[0]?.online && p.paired[0].pass && a.paired?.some(x => x.online) || 'not linked yet'; }, wait: 120 },
      { title: 'The phone tests the connection', ...say(P, 'test the connection'), check: async () => { const t = (await st(P)).test; return t && t.relaysOk >= 1 || 'no test result yet'; }, wait: 90 },
      { title: 'The direct link comes up (same Mac, so the networks allow it)', check: async () => (await st(P)).direct || 'relays only so far', wait: 90 },
    ],
    mesh: [
      { title: 'Studio A creates the mesh', ...say(A, 'create a mesh called Demo day', 'Mesh › <b>Create a mesh</b>, name it “Demo day”'), check: async () => (await st(A)).mesh?.owner || 'no mesh yet' },
      { title: 'The phone joins by itself (it is paired with Studio A)', check: async () => (await st(P)).mesh?.member || 'not a member yet', wait: 90 },
      { title: 'Studio B joins with an invite', you: 'On <b>Studio A</b>: Mesh › <b>Invite</b> (or say <q class="cmd">invite to the mesh</q>) › copy the text. On <b>Studio B</b>: Mesh › <b>Join with an invite</b> (or say <q class="cmd">join the mesh</q>) › paste › Join.',
        auto: async () => B.step('join', await A.eval('Mesh.invite()')),
        check: async () => { const s = await Promise.all(devs.map(st)); return s.every(x => x.mesh?.members?.length === 3) || `member lists ${s.map(x => x.mesh?.members?.length ?? '–').join('/')}`; }, wait: 120 },
      { title: 'Direct links form between the members (not only the paired phone and Mac)', check: async () => { const [a, b, p] = await Promise.all([st(A), st(B), st(P)]); return b.meshDirect?.length >= 2 && a.meshDirect?.includes('Studio B') || `direct links: A ${a.meshDirect?.join(', ') || 'none'} · B ${b.meshDirect?.join(', ') || 'none'}`; }, wait: 120 },
      { title: 'Everyone sees everyone online', ...say(P, 'who’s around'), check: async () => { const s = await Promise.all(devs.map(st)); return s.every(x => x.mesh?.online?.length >= 2) || `online seen ${s.map(x => x.mesh?.online?.length ?? '–').join('/')}`; }, wait: 90 },
    ],
    shared: [
      { title: 'Studio A sees what Studio B shares, but not the private draft', ...say(A, 'what’s shared', 'Mesh › <b>Shared</b>'),
        check: async () => { const sh = (await st(A)).mesh?.shared || []; return sh.some(x => /Welcome tour/.test(x)) && !sh.some(x => /Draft pitch/.test(x)) || `shared seen: ${sh.join(', ') || 'nothing'}`; }, wait: 60 },
      { title: 'Studio A gets the Welcome tour', ...say(A, 'get the welcome tour from the mesh', 'Mesh › Shared › Welcome tour › <b>Get</b>'), check: async () => (await st(A)).scripts?.includes('Welcome tour') || 'not here yet', wait: 60 },
      { title: 'Studio B shares the draft', ...say(B, 'share the draft pitch with the mesh', 'Mesh › Shared › Yours › tick <b>shared</b> for Draft pitch'),
        check: async () => (await st(A)).mesh?.shared?.some(x => /Draft pitch/.test(x)) || 'Studio A doesn’t see it yet', wait: 60 },
    ],
    road: [
      { title: 'On the road: relays only', ...say(P, 'turn off the direct link', 'Settings › Connections › Direct link › <b>Never</b>'), check: async () => { const p = await st(P); return p.directCfg === 'off' && !p.direct && !p.meshDirect?.length || 'direct link still on'; }, wait: 30 },
      { title: '1:1 with the paired Mac', ...say(P, 'run the daily brief on my mac'), check: async () => since(await st(P), S.t0, /three meetings/i) || `last reply: ${lastReply(await st(P)) || 'none'}`, wait: 90 },
      { title: 'Studio A’s Activity shows the request', check: async () => (await st(A)).mesh?.events?.some(e => e.kind === 'request') || 'no request in the activity yet', wait: 60 },
    ],
    meaning: [
      { title: 'The phone is understood by meaning, through its Mac (Apple’s on-device model)', ...say(P, 'is it going to pour later'),
        check: async () => { const [a, p] = await Promise.all([st(A), st(P)]); return !a.ai || since(p, S.t0, /degrees|rain|drizzle|sunny|cloud/i) || `last reply: ${lastReply(p) || 'none'}`; }, wait: 60 },
      { title: 'And on the Mac itself', ...say(A, 'switch the gauges to a different look'), check: async () => { const a = await st(A); return !a.ai || since(a, S.t0, /style/i) || `last reply: ${lastReply(a) || 'none'}`; }, wait: 60 },
    ],
    agent: [
      { title: 'The phone asks its Mac for a task of the agent library; the result comes back as a card', ...say(P, 'what can i present'),
        check: async () => { const [a, p] = await Promise.all([st(A), st(P)]); const c = p.agent?.[0]; return c?.task === 'present.scripts' && c.status === 'done' && /\d+ scripts/.test(c.headline) && a.agent?.some(x => x.task === 'present.scripts' && / · for /.test(x.title)) || `phone card: ${c ? `${c.status} ${c.headline}` : 'none'}`; }, wait: 60 },
      { title: 'A car task on the phone itself: remember where it parked', ...say(P, 'remember where i parked'), check: async () => (await st(P)).agent?.[0]?.task === 'car.park' || 'no card yet', wait: 20 },
      { title: 'And find it again', ...say(P, 'where did i park'), check: async () => { const c = (await st(P)).agent?.[0]; return c?.task === 'car.findcar' && /away/.test(c.headline) || `card: ${c?.headline || 'none'}`; }, wait: 20 },
      { title: 'A task that acts for you is asked first (a WhatsApp message sent from the Mac)', ...say(P, 'whatsapp Mom saying hello from the test'),
        check: async () => { const c = (await st(P)).agent?.[0]; return c?.status === 'ask' && /Shall I/.test(c.headline) || `card: ${c ? `${c.status} ${c.headline}` : 'none'}`; }, wait: 20 },
      { title: 'Saying no sends nothing', ...say(P, 'no'), check: async () => (await st(P)).agent?.[0]?.status !== 'ask' || 'still asking', wait: 20 },
    ],
    ask: [
      { title: 'Run a script on the other Mac, through the mesh', ...say(P, 'run the sales summary on studio b', 'Mesh › Who’s around › Studio B › <b>▶ Sales summary</b>'),
        check: async () => since(await st(P), S.t0, /12 percent/i) || `last reply: ${lastReply(await st(P)) || 'none'}`, wait: 90 },
      { title: 'The owner stops the phone running scripts', ...say(A, 'don’t let test iphone run scripts', 'Mesh › Devices › Test iPhone › untick <b>scripts</b>'),
        check: async () => { const pid = await id(P), b = await st(B); return b.mesh?.perms?.[pid] === false || 'Studio B hasn’t got the change yet'; }, wait: 60 },
      { title: 'The phone is refused', ...say(P, 'run the sales summary on studio b'), check: async () => since(await st(P), S.t0, /may not run/i) || `last reply: ${lastReply(await st(P)) || 'none'}`, wait: 90 },
      { title: 'The owner allows it again', ...say(A, 'allow test iphone to run scripts', 'Mesh › Devices › Test iPhone › tick <b>scripts</b>'),
        check: async () => { const pid = await id(P), b = await st(B); return b.mesh?.perms?.[pid] === true || 'not allowed yet'; }, wait: 60 },
    ],
    own: [
      { title: 'Studio B shares two tasks: one needing no sign-in (a page title), one using its Slack', always: true,
        auto: () => B.eval(`(()=>{ store.set('agentCfg', { ...Agent.cfg(), practice: true });
          Agent.put({ id: 'my.title', name: 'Mesh page title', runs: 'mac', share: true, examples: ['title of the mesh page', 'mesh page title'], steps: [{ do: 'agent.open', value: location.origin + '/docs/mesh.html', args: ['wait=h1'] }, { do: 'agent.read', value: 'h1', as: 'read' }, { set: 'card', value: '{"type":"summary","headline":"{read}"}' }] });
          Agent.put({ id: 'my.slack', name: 'My Slack mentions', runs: 'mac', share: true, examples: ['my slack mentions please'], steps: [{ do: 'agent.open', value: '{slack}', args: ['site=Slack', 'wait=[role="tree"]'] }, { do: 'agent.read', value: '[role="tree"]', as: 'read' }] });
          return Agent.offered(false).map(t => t.id).join() })()`),
        check: async () => { const o = await B.eval('Agent.offered(false).map(t => t.id).join()'); return o === 'my.title' || `offered to others: ${o}`; } },
      { title: 'Studio A (not Studio B’s owner) sees only the one without a sign-in',
        auto: () => A.eval('Agent.meshAt = 0, Agent.refresh().then(() => 1)'),
        check: async () => { const l = await A.eval('Agent.meshMine().map(t => t.origId).join()'); return l === 'my.title' || `Studio A sees: ${l || 'nothing'}`; }, wait: 60 },
      { title: 'The phone runs it on Studio B by asking in its own words', ...say(P, 'title of the mesh page'),
        check: async () => since(await st(P), S.t0, /mesh view/i) || `last reply: ${lastReply(await st(P)) || 'none'}`, wait: 150 },
      { title: 'Studio A asking for Studio B’s Slack task is refused', always: true,
        auto: async () => { S.err = await A.eval(`Mesh.call(${JSON.stringify(await id(B))}, 'task', { id: 'my.slack', params: {}, confirmed: true }, 60000).then(() => 'ran', e => e.message)`, 90000); },
        check: async () => /only its owner/.test(S.err || '') || `answer: ${S.err}` },
      { title: 'Studio B marks Studio A as its owner’s: now it may (it stops at Slack’s sign-in instead)', always: true,
        auto: async () => { await B.eval(`Mesh.setOwn(${JSON.stringify(await id(A))}, true)`); S.err = await A.eval(`Mesh.call(${JSON.stringify(await id(B))}, 'task', { id: 'my.slack', params: {}, confirmed: true }, 90000).then(() => 'ran', e => e.message)`, 120000); },
        check: async () => !/only its owner/.test(S.err || 'x') || `answer: ${S.err}` },
      { title: 'And back: Studio A isn’t Studio B’s owner’s', always: true, auto: async () => B.eval(`Mesh.setOwn(${JSON.stringify(await id(A))}, false), 1`), check: async () => (await B.eval(`Mesh.own(${JSON.stringify(await id(A))})`)) === false || 'still marked' },
      { title: 'Studio B quits; Studio A asks for the page title: it waits', always: true,
        auto: async () => { await B.stop(); await sleep(70000); await A.eval(`(()=>{ const t = Agent.meshMine().find(x => x.origId === 'my.title'); Agent.start(t, {}, { confirmed: true }); return 1 })()`); },
        check: async () => (await st(A)).agent?.[0]?.status === 'waiting' || `card: ${JSON.stringify((await st(A)).agent?.[0] || null)}`, wait: 30 },
      { title: 'Studio B comes back: the waiting request runs and the card arrives', always: true, auto: () => B.restart(),
        check: async () => { const c = (await st(A)).agent?.[0]; return c?.status === 'done' && /mesh view/i.test(c.headline || '') || `card: ${c?.status} ${c?.headline || ''}`; }, wait: 240 },
    ],
    bee: [
      { title: 'Two StudioGBees start in Docker (this team’s and another team’s)', always: true,
        auto: async () => { for (const [n, p, nm] of [[1, 8841, 'Team bee'], [2, 8842, 'Other team bee']]) { try { execFileSync('docker', ['rm', '-f', `sg-bee-${n}`], { stdio: 'ignore' }); } catch {} execFileSync('docker', ['run', '-d', '--name', `sg-bee-${n}`, '-p', `${p}:8840`, '-e', `BEE_ADMIN_CODE=TESTBEE${n}`, '-e', `BEE_NAME=${nm}`, 'studiogbee'], { stdio: 'ignore' }); } await sleep(2500); },
        check: async () => { try { const [a, b] = await Promise.all([8841, 8842].map(p => fetch(`http://localhost:${p}/healthz`).then(r => r.json()))); return a.ok && b.ok || 'not up'; } catch (e) { return `not up: ${e.message}`; } }, wait: 30 },
      { title: 'Studio A (owner) adds the team bee; Studio B and the phone connect by themselves', always: true,
        auto: () => A.eval(`Bee.add('http://localhost:8841', 'TESTBEE1')`, 30000),
        check: async () => { const ups = await Promise.all([A, B, P].map(d => d.eval('Bee.up()').catch(() => false))); return ups.every(Boolean) || `connected: A ${ups[0]}, B ${ups[1]}, phone ${ups[2]}`; }, wait: 60 },
      { title: 'Studio B quits; the phone asks for its page title: it waits at the bee', always: true,
        auto: async () => { await B.stop(); await sleep(70000); await P.step('command', 'title of the mesh page'); },
        check: async () => { const c = (await st(P)).agent?.[0]; return c?.status === 'waiting' && /StudioGBee/.test(c.headline) || `card: ${c?.status} ${c?.headline || ''}`; }, wait: 40 },
      { title: 'The phone app is closed and opened again (the answer must still find it)', always: true,
        auto: async () => { await P.eval('location.reload(), 1').catch(() => {}); await sleep(6000); }, check: async () => (await P.eval('typeof Bee !== "undefined" && Object.keys(store.get("beePending", {})).length')) >= 1 || 'nothing pending after the reload', wait: 30 },
      { title: 'Studio B comes back: it takes the waiting request from the bee, and the answer lands on the phone’s card', always: true, auto: () => B.restart(),
        check: async () => { const c = (await st(P)).agent?.find(x => x.title === 'Mesh page title'); return c?.status === 'done' && /mesh view/i.test(c.headline || '') || `card: ${c?.status} ${c?.headline || ''}`; }, wait: 240 },
      { title: 'The dashboard: Studio A gets a code, the owner signs in, sees the three devices and what waited', always: true,
        auto: async () => { const code = await A.eval('Bee.dashCode()'); const r = await fetch('http://localhost:8841/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); S.cookie = (r.headers.get('set-cookie') || '').split(';')[0]; },
        check: async () => { const d = await (await fetch('http://localhost:8841/api/state', { headers: { cookie: S.cookie || '' } })).json(); const k = new Set((d.events || []).map(e => e.kind)); return d.devices?.length === 3 && k.has('queued') && k.has('delivered') || `devices ${d.devices?.length}, events: ${[...k].join(', ') || d.error}`; }, wait: 30 },
      { title: 'Studio A backs up its library; Studio B restores from it', always: true,
        auto: async () => { await A.eval('Bee.backup(true)', 60000); S.restored = await B.eval(`Bee.restore(${JSON.stringify(await id(A))})`, 60000).catch(e => e.message); },
        check: async () => typeof S.restored === 'number' && S.restored > 0 || `restored: ${S.restored}` },
      { title: 'Another team’s bee: added to the mesh, linked with a code, and accepted on the team bee’s dashboard', always: true,
        auto: async () => { await A.eval(`Bee.add('http://localhost:8842', 'TESTBEE2')`, 30000); const code = await A.eval(`Bee.linkCode('http://localhost:8841', 'http://host.docker.internal:8841')`); /* the other bee runs in its own container */ await A.eval(`Bee.linkJoin(${JSON.stringify(code)}, 'http://localhost:8842')`); await sleep(3000);
          const d = await (await fetch('http://localhost:8841/api/state', { headers: { cookie: S.cookie } })).json(); const p = d.peers?.find(x => x.state === 'pending'); if (p) await fetch('http://localhost:8841/api/link/accept', { method: 'POST', headers: { cookie: S.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ peer: p.id }) }); },
        check: async () => { const d = await (await fetch('http://localhost:8841/api/state', { headers: { cookie: S.cookie } })).json(); return d.peers?.some(p => p.state === 'active' && p.up) || `peers: ${JSON.stringify(d.peers)}`; }, wait: 30 },
      { title: 'Studio B uses only the other bee, the phone only the team bee: a request from the phone is passed between the bees', always: true,
        auto: async () => { await B.eval(`store.set('beeHome', 'http://localhost:8842'), Bee.start(), 1`); await P.eval(`store.set('beeHome', 'http://localhost:8841'), Bee.start(), 1`); await sleep(5000);
          S.fwd = await P.eval(`Bee.call(${JSON.stringify(await id(B))}, 'task', { id: 'my.title', params: {}, confirmed: true }, 60000).then(r => JSON.stringify(r), e => 'ERR ' + e.message)`, 90000); },
        check: async () => /mesh view/i.test(S.fwd || '') || `answer: ${S.fwd}` },
      { title: 'The bees stop', always: true, auto: async () => { for (const n of [1, 2]) try { execFileSync('docker', ['rm', '-f', `sg-bee-${n}`], { stdio: 'ignore' }); } catch {} await B.eval(`store.set('beeHome', ''), 1`).catch(() => {}); await P.eval(`store.set('beeHome', ''), 1`).catch(() => {}); }, check: async () => true },
    ],
    show: [
      { title: 'The phone starts the Keynote on all screens', ...say(P, 'start the keynote on all screens'),
        check: async () => { const [a, b] = await Promise.all([st(A), st(B)]); return a.mesh?.conducting && b.mesh?.show?.state === 'on' || 'screens not in the show yet'; }, wait: 90 },
      { title: 'Every screen shows the show badge', check: async () => { const [a, b, p] = await Promise.all([st(A), st(B), st(P)]); return /Conducting/.test(a.pill) && /In the show/.test(b.pill) && /Keynote/.test(p.pill) || `badges: A “${a.pill}” · B “${b.pill}” · phone “${p.pill}”`; }, wait: 20 },
      { title: 'Studio A moves on by itself; both screens together', before: async () => sleep(2500),
        check: async () => { const b = (await st(B)).mesh?.show; return b?.step >= 1 && Math.abs(b.drift || 0) < 100 || `Studio B at step ${(b?.step ?? -1) + 1}, drift ${b?.drift ?? '–'} ms`; }, wait: 60 },
      { title: 'Next on every screen, from the phone', ...say(P, 'next slide everywhere'), before: async () => { S.step = (await st(B)).mesh?.show?.step; },
        check: async () => { const b = (await st(B)).mesh?.show; return b == null || b.step > S.step || `Studio B still at step ${(b?.step ?? -1) + 1}`; }, wait: 30 },
      { title: 'Stop the show from the phone', ...say(P, 'stop the show'), check: async () => { const [a, b] = await Promise.all([st(A), st(B)]); return !a.mesh?.conducting && !b.mesh?.show || 'still running'; }, wait: 30 },
      { title: 'Start it in tandem', ...say(P, 'start the keynote in tandem'), check: async () => (await st(B)).script?.i >= 1 || 'Studio B not at its waiting step yet', wait: 60 },
      { title: 'The cue moves Studio B on', ...say(P, 'send the cue'), check: async () => (await st(B)).script?.i >= 2 || (await st(B)).script == null || 'Studio B still waiting for the cue', wait: 30 },
      { title: 'Stop the tandem show', ...say(P, 'stop the show'), check: async () => { const [a, b] = await Promise.all([st(A), st(B)]); return !a.mesh?.conducting && !b.script || 'still running'; }, wait: 30 },
    ],
    trouble: [
      { title: 'A dead relay goes to the top of Studio A’s list', always: true,
        auto: () => A.eval(`(()=>{ const L=Relay.list(); store.set('relayList',{ rev:L.rev+1, brokers:[{ url:'wss://relay.invalid:8084/mqtt', name:'Dead relay' }, ...L.brokers] }); return 1 })()`), check: async () => (await st(A)).relays > 0 },
      { title: 'Studio A shares the new relay list with the mesh', ...say(A, 'share the relay list with the mesh', 'Mesh › ⚙ › <b>Share the relay list with the mesh</b>'),
        check: async () => { const [b, p] = await Promise.all([st(B), st(P)]); return [b, p].every(x => x.meshRelays?.[0] === 'wss://relay.invalid:8084/mqtt') || 'not everyone has the new list yet'; }, wait: 90 },
      { title: 'The mesh still works with the dead relay first', ...say(P, 'run the sales summary on studio b'), before: async () => { S.t = Date.now(); },
        check: async () => since(await st(P), S.t, /12 percent/i) || `last reply: ${lastReply(await st(P)) || 'none'}`, wait: 90 },
      { title: 'Studio B quits', you: 'Quit <b>Studio B</b> (⌘Q in its window). The runner opens it again in the next step.', auto: () => B.stop(),
        check: async () => { const a = await st(A), bid = S.bid ||= Object.entries(a.mesh?.names || {}).find(([, n]) => n === 'Studio B')?.[0]; return !a.mesh?.online?.includes(bid) || 'Studio A still sees Studio B online (it notices within 90 s)'; }, wait: 150 },
      { title: 'Studio B comes back and rejoins', always: true, auto: () => B.restart(),
        check: async () => { const [a, b] = await Promise.all([st(A), st(B)]); return b.mesh?.member && a.mesh?.online?.includes(b.mesh.me) || 'not back yet'; }, wait: 120 },
    ],
    housekeeping: [
      { title: 'Change the phone’s secret while connected', ...say(A, 'change the secret for test iphone', 'Settings › Connections › Test iPhone › <b>Change secret</b>'), before: async () => { S.key = (await st(P)).paired?.[0]?.key; },
        check: async () => { const p = (await st(P)).paired?.[0]; return p && p.key !== S.key && p.online || 'old secret still in use'; }, wait: 120 },
      { title: 'Remove Studio B from the mesh', ...say(A, 'remove studio b from the mesh', 'Mesh › Devices › Studio B › <b>Remove</b>'),
        check: async () => { const a = await st(A); return a.mesh?.members?.length === 2 || `${a.mesh?.members?.length} members`; }, wait: 90 },
      { title: 'The phone carries on with the new key; Studio B is left out', check: async () => { const [a, b, p] = await Promise.all([st(A), st(B), st(P)]); return a.mesh?.key === p.mesh?.key && b.mesh?.key !== a.mesh?.key || 'keys not settled yet'; }, wait: 90 },
    ],
    review: [
      { title: 'Studio A’s history has the whole run', ...say(A, 'show me the mesh', 'Mesh › <b>History</b> (and Activity: search “may not”)'),
        check: async () => { const m = (await st(A)).mesh; return m?.history >= 10 && ['request', 'show', 'share'].every(k => m.histKinds.includes(k)) || `history ${m?.history} events: ${m?.histKinds?.join(', ')}`; }, wait: 60 },
    ],
  };

  // The first, shorter run: pairing, mesh, a show, a secret change and a removal
  const basic = {
    setup: demo.setup,
    pair: [{ ...demo.pair[0], you: 'On <b>Studio A</b>: Settings › Connections › <b>Pair a phone or iPad (once)</b>, no phrase.', auto: () => A.eval('Relay.newPairing()') }, { ...demo.pair[1], auto: () => P.step('pair', S.code), check: async () => { const p = await st(P), a = await st(A); return p.paired?.[0]?.online && a.paired?.some(x => x.online) || 'not linked yet'; } }],
    mesh: demo.mesh.slice(0, 3),
    show: [{ ...demo.show[0], ...say(A, 'start the keynote on all screens') }],
    housekeeping: demo.housekeeping,
  };
  // every step notes when it started, so a reply only counts if it came after that
  for (const j of [demo, basic]) for (const steps of Object.values(j)) for (const st0 of steps) if (!st0._t) { const b0 = st0.before; st0.before = async () => { S.t0 = Date.now(); await b0?.(); }; st0._t = 1; }
  return { demo, basic };
}
