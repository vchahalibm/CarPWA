'use strict';
/* What the desktop app adds for the web page, as window.DriveDeckDesktop. The web files only use it behind a
   feature check (`window.DriveDeckDesktop?.…`), so they stay the same as on the web. Sandboxed: only these calls. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DriveDeckDesktop', {
  version: 1,
  /** The screens attached: [{ id, label, primary, here, w, h }] (`here`: the one the main window is on). */
  displays: () => ipcRenderer.invoke('dd:displays'),
  /** Show DriveDeck full screen on a screen (the wall), and the presenter view on another one if there is one. */
  present: id => ipcRenderer.invoke('dd:present', id),
  /** Back to a normal window; closes the presenter view. */
  stopPresenting: () => ipcRenderer.invoke('dd:stop-presenting'),
  /** Open (or bring forward) the presenter view, on another screen when there is one. */
  presenter: () => ipcRenderer.invoke('dd:presenter'),
  /** Start DriveDeck when you log in (in the menu bar). */
  loginItem: on => ipcRenderer.invoke('dd:login-item', on),
  /** The menu bar asks the page for something (e.g. 'settings'). */
  onMenu: f => ipcRenderer.on('dd:menu', (e, what) => f(what)),
});
