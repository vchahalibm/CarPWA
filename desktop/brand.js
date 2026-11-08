/* The names people see (js/brand.js, shared with the page): from the bundled web files when packaged, else the checkout
   (development, and the release tools that load desktop/updater.js in plain Node). */
const path = require('path');
let app = null; try { ({ app } = require('electron')); } catch {}
module.exports = require(app?.isPackaged ? path.join(process.resourcesPath, 'web', 'js', 'brand.js') : path.join(__dirname, '..', 'js', 'brand.js'));
