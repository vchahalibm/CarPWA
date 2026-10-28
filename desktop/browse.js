'use strict';
/* The browsers' sessions: the agent browser and web widgets (<webview>), in containers like Firefox's. Each container is its
   own session ('persist:browse' is Default, 'persist:c-<id>' the others), so Work and Personal sign-ins stay apart; which
   site opens in which container is decided in the page (Containers in js/agent.js).
   - Sign-ins kept across restarts and updates: Chromium drops session cookies when the app quits (a Microsoft sign-in
     without “Stay signed in”, some Slack and Google ones), so they're saved on quit, encrypted with the Keychain
     (safeStorage), and put back at the next start before any page loads. Persistent cookies and site storage are on disk
     already; they're flushed on quit too.
   - Forget sign-ins: one container's cookies, storage and saved session cookies are cleared. */
const { app, session, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const OK = /^persist:(browse|c-[a-z0-9-]{1,30})$/;
// What locks the kept session cookies: the Keychain (safeStorage) on a Mac; in a Worker's container (no keyring there, and
// Chromium's own fallback key is a fixed word) a key from SG_SECRET or the file SG_SECRET_FILE (a Docker secret).
const crypto = require('crypto');
const secret = (() => { try { const s = process.env.SG_SECRET || (process.env.SG_SECRET_FILE ? fs.readFileSync(process.env.SG_SECRET_FILE, 'utf8').trim() : ''); return s ? crypto.createHash('sha256').update(s).digest() : null; } catch { return null; } })();
const box = secret ? {
  ok: () => true,
  enc: t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secret, iv), ct = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); },
  dec: b => { const d = crypto.createDecipheriv('aes-256-gcm', secret, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); },
} : { ok: () => safeStorage.isEncryptionAvailable(), enc: t => safeStorage.encryptString(t), dec: b => safeStorage.decryptString(b) };
module.exports = () => {
  const file = name => path.join(app.getPath('userData'), name);
  const read = (name, def) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return def; } };
  const write = (name, data) => { const f = file(name), tmp = `${f}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }; // never half a file
  const known = () => { const l = read('browse-partitions.json', []); return [...new Set(['persist:browse', ...l.filter(p => OK.test(p))])]; };
  const JAR = 'browse-session-cookies.bin';
  const jar = () => { try { return JSON.parse(box.dec(fs.readFileSync(file(JAR)))); } catch { return {}; } };

  /** A webview's session: one of the containers (remembered, so its sign-ins are saved), else Default. */
  function use(p) {
    if (!OK.test(String(p || ''))) return 'persist:browse';
    const l = known(); if (!l.includes(p)) write('browse-partitions.json', JSON.stringify([...l, p]));
    return p;
  }
  /** On quit: every container's session cookies, encrypted. */
  async function save() {
    const out = {};
    for (const p of known()) {
      const s = session.fromPartition(p);
      out[p] = (await s.cookies.get({})).filter(c => c.session).map(({ name, value, domain, hostOnly, path: cp, secure, httpOnly, sameSite }) => ({ name, value, domain, hostOnly, path: cp, secure, httpOnly, sameSite }));
      await s.cookies.flushStore().catch(() => {});
    }
    if (box.ok()) write(JAR, box.enc(JSON.stringify(out)));
    return Object.values(out).reduce((n, l) => n + l.length, 0);
  }
  /** At the start, before any page loads: put them back (as session cookies again, saved again on the next quit). */
  async function restore() {
    let n = 0;
    for (const [p, list] of Object.entries(jar())) {
      if (!OK.test(p)) continue; const s = session.fromPartition(p);
      for (const c of list || []) {
        const host = String(c.domain || '').replace(/^\./, ''); if (!host) continue;
        try { await s.cookies.set({ url: `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`, name: c.name, value: c.value, ...(c.hostOnly ? {} : { domain: c.domain }), path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly, ...(c.sameSite ? { sameSite: c.sameSite } : {}) }); n++; } catch {}
      }
    }
    return n;
  }
  /** Sign out of everything in one container. */
  async function forget(p) {
    if (!OK.test(String(p || ''))) return false;
    await session.fromPartition(p).clearStorageData();
    const j = jar(); if (j[p]) { delete j[p]; if (box.ok()) write(JAR, box.enc(JSON.stringify(j))); }
    return true;
  }
  return { OK, use, save, restore, forget };
};
