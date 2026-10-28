'use strict';
/* ============================================================
   StudioGen Worker: StudioGen in a Linux container (worker/README.md, docs/studiogbee.html § 8). No screen of its own, so
   it sets itself up from its environment (window.DriveDeckDesktop.worker, desktop/main.js): its name, the mesh invite an
   owner made for one of their own devices (it joins, and treats the inviter as its owner's: Mesh.join(code, true); the
   owner's StudioGen then tells it the owner's other devices, own-sync in js/mesh.js), the model for cards (no Apple model
   on Linux: Claude or an OpenAI-compatible server such as Ollama), the practice sites for tests. The heavy parts (the 3D
   assistant, the voice) stay off; it opens on the Agent screen. Seen and used from your devices: js/remoteview.js.
   Loaded after remoteview.js.
   ============================================================ */
const Worker0 = window.DriveDeckDesktop?.worker || null;
if (Worker0) {
  if (store.get('workerInit') !== 1) { // the first start: settings for a machine nobody sits at, then once more with them
    Object.assign(settings, { startScreen: 'agent', tts: 'off', startGreet: false, intentAI: false });
    store.set('settings', settings); store.set('setupDone', 'skip'); store.set('workerInit', 1); location.reload();
  } else {
    store.set('setupDone', 'skip'); store.set('meshName', Worker0.name); document.title = `${Worker0.name} · StudioGen Worker`;
    if (Worker0.practice) store.set('agentCfg', { ...Agent.cfg(), practice: true });
    if (Worker0.llm) { store.set('llm', { provider: Worker0.llm.provider, model: Worker0.llm.model, url: Worker0.llm.url }); if (Worker0.llm.key) store.set('llmKey', Worker0.llm.key); }
    // the mesh: joined once with the invite, then kept (the invite is used up)
    setTimeout(async () => {
      if (!Worker0.invite || Mesh.m) return;
      try { await Mesh.join(Worker0.invite.trim(), true); Log.i('worker', 'Joining the mesh with the invite'); } catch (e) { Log.w('worker', `Didn’t join the mesh: ${e.message}`); }
    }, 3000);
  }
}
