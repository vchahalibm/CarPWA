'use strict';
/* The names people see. Rename the apps here, then in desktop/package.json (build.productName) and manifest.webmanifest;
   tests/brand.cjs (CI) checks they agree and that no other code writes a name itself. Loaded first by the page, and read by
   the desktop app's main process (desktop/brand.js). Internal names never change (APP_ID in js/log.js, `app: 'StudioGen'`
   between devices, storage keys, the Keychain's “StudioGen Safe Storage”, the update feed's app id). */
const BRAND = { mac: 'NaoMuse', phone: 'DriveGen', hive: 'NaoMuseHive', worker: 'NaoMuse Worker' };
if (typeof module !== 'undefined') module.exports = BRAND;
