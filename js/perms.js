'use strict';
/* ============================================================
   Permissions said “no” to, often by mistake: the microphone, speech recognition, the camera. The system asks only once;
   when something needs one that's off, `Perm.denied(kind, retry)` explains and offers to ask again:
   - StudioGen: Ask me again resets this app's answer (tccutil, desktop/main.js 'dd:perm') and the Mac asks again; or Open
     System Settings at the right page. Then `retry` runs (listening, the camera…).
   - DriveGen (a browser can't reset its answer): Try again (the browser asks again when it can), with the steps for this
     browser or the iPhone otherwise.
   Settings › System › Permissions lists them, with the same buttons.
   Loaded after voice.js.
   ============================================================ */
const PERM_KINDS = { mic: 'the microphone', speech: 'speech recognition', camera: 'the camera' };
const Perm = {
  desk: () => !!window.DriveDeckDesktop?.perm,
  /** 'granted' | 'denied' | 'not-determined' | 'restricted' | 'prompt' | 'unknown' */
  async status(kind) {
    if (this.desk()) return (await DriveDeckDesktop.perm('status', kind)) || 'unknown';
    try { const q = await navigator.permissions.query({ name: kind === 'camera' ? 'camera' : 'microphone' }); return q.state; } catch { return 'unknown'; }
  },
  /** Ask the system again: StudioGen resets this app's answer first; a browser just tries. true when allowed now. */
  async ask(kind) {
    if (this.desk()) {
      await DriveDeckDesktop.perm('reset', kind);
      if (kind === 'speech') return true; // the speech helper asks when it next starts (listening, right after)
      return !!(await DriveDeckDesktop.perm('ask', kind));
    }
    try { const s = await navigator.mediaDevices.getUserMedia(kind === 'camera' ? { video: true } : { audio: true }); s.getTracks().forEach(t => t.stop()); return true; } catch { return false; }
  },
  /** Where to turn it on by hand, in words, for this device. */
  how(kind) {
    const what = kind === 'camera' ? 'Camera' : 'Microphone';
    if (this.desk()) return `System Settings › Privacy & Security › ${kind === 'speech' ? 'Speech Recognition' : what} › turn on StudioGen.`;
    if (isIOS) return `On the iPhone or iPad: Settings › Apps › Safari › ${what} › Ask or Allow (from the Home Screen app: also Settings › ${APP_NAME} if it's listed), then open ${APP_NAME} again. In a Safari tab: the aA button › Website Settings › ${what} › Allow.`;
    if (/Android/.test(navigator.userAgent)) return `Tap the icon left of the address › Permissions › ${what} › Allow, then try again.`;
    return `Click the icon left of the address (site settings) › ${what} › Allow, then try again.`;
  },
  /** Something needed `kind` and was refused: explain, and offer to ask again. Once a minute at most per kind. */
  denied(kind, retry) {
    if (Date.now() - (this.shown?.[kind] || 0) < 60000) return; (this.shown ||= {})[kind] = Date.now();
    Log.w('perm', `Refused: ${kind}`);
    const name = PERM_KINDS[kind] || kind, again = async () => {
      closeSheet(); const ok = await this.ask(kind);
      if (ok) { toast(`${name[0].toUpperCase()}${name.slice(1)} is allowed`); if (retry) setTimeout(retry, 400); }
      else sheet('Still off', `<p>${esc(this.how(kind))}</p>`, [...(this.desk() ? [['Open System Settings', () => DriveDeckDesktop.perm('open', kind)]] : []), ['OK']]);
    };
    sheet(`${APP_NAME} can’t use ${name}`, `<p>It isn’t allowed${kind === 'speech' ? ' (it turns what you say into words)' : ''}. Perhaps it was turned down by mistake when ${APP_NAME} asked.</p><p class="se-note">${esc(this.how(kind))}</p>`,
      [[this.desk() ? 'Ask me again' : 'Try again', again], ...(this.desk() ? [['Open System Settings', () => { DriveDeckDesktop.perm('open', kind); this.watch(kind, retry); }]] : []), ['Not now']]);
  },
  /** Back from System Settings with it turned on: carry on. */
  watch(kind, retry) {
    const check = async () => { if (document.visibilityState !== 'visible') return; if (await this.status(kind) === 'granted' || kind === 'speech') { removeEventListener('focus', check); if (retry) retry(); } };
    addEventListener('focus', check);
  },
  /** Settings › System › Permissions. */
  async settings() {
    const kinds = this.desk() ? ['mic', 'speech', 'camera'] : ['mic', 'camera'];
    const st = await Promise.all(kinds.map(k => this.status(k)));
    const word = s => ({ granted: '✓ allowed', denied: '✗ off', restricted: '✗ blocked by the system', 'not-determined': 'not asked yet', prompt: 'asks when needed', unknown: this.desk() ? 'asked the first time you talk' : 'asks when needed' })[s] || s;
    sheet('Permissions', `<p class="se-note">What ${APP_NAME} may use. Turned one down by mistake? Ask again here.</p>
      ${kinds.map((k, i) => `<div class="se-row"><span><b>${esc(PERM_KINDS[k][0].toUpperCase() + PERM_KINDS[k].slice(1))}</b> <span class="se-note">${word(st[i])}</span></span><span><button class="chip" data-perm="ask|${k}">${this.desk() ? 'Ask again' : 'Try again'}</button>${this.desk() ? ` <button class="chip" data-perm="open|${k}">System Settings</button>` : ''}</span></div>`).join('')}
      ${this.desk() ? '' : `<p class="se-note">If the browser doesn’t ask again: ${esc(this.how('mic'))}</p>`}`, [['Close']]);
  },
};
ACTIONS.permissions = () => Perm.settings();
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-perm]'); if (!b) return; e.stopPropagation();
  const [op, kind] = b.dataset.perm.split('|');
  if (op === 'open') return DriveDeckDesktop.perm('open', kind);
  const ok = await Perm.ask(kind); toast(ok ? `${PERM_KINDS[kind]} is allowed` : `Still off: ${Perm.how(kind)}`); Perm.settings();
}, true);
