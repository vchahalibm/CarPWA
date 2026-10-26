'use strict';
/* Signing StudioGen (electron-builder's afterPack: after the app is put together, before the DMG and zip are made).
   With the build's certificate (MAC_SIGN_ID, in the keychain MAC_SIGN_KEYCHAIN; the workflow imports it from the secrets
   MAC_CERT_P12 / MAC_CERT_PASSWORD) every version carries the same signature identity, so macOS sees each update as the
   same app: the Keychain's “Always Allow” for “StudioGen Safe Storage” (which encrypts the browser's cookies and kept
   sign-ins) carries over, instead of asking for the login password after every app update. Without it: ad-hoc, as before.
   It's a self-made certificate, not Apple's: Gatekeeper still treats the app as unidentified (not notarised). */
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async ctx => {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const id = process.env.MAC_SIGN_ID, kc = process.env.MAC_SIGN_KEYCHAIN;
  const args = ['--force', '--deep', '--sign', id || '-', ...(id && kc ? ['--keychain', kc] : []), app];
  execFileSync('codesign', args, { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', app], { stdio: 'inherit' });
  const dr = execFileSync('codesign', ['-dr', '-', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  console.log(`  • signed ${path.basename(app)} (${ctx.arch === 1 ? 'x64' : ctx.arch === 3 ? 'arm64' : ctx.arch}) ${id ? 'with the StudioGen certificate' : 'ad-hoc (no certificate in this build)'}: ${dr.split('\n').pop()}`);
};
