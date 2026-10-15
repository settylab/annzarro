const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

// The page learns that it runs in the desktop app, and on which platform, from here and not from
// the user agent: <html data-desktop data-desktop-platform="darwin|win32|linux"> and, where the
// window has no native title bar, data-desktop-frame="mac|win" (window-chrome.js passes the flag
// as a process argument; a sandboxed preload cannot require it). static/css/desktop-frame.css
// styles them. Set as soon as <html> exists, before the first paint, as theme-init.js does for the theme.
const frameArg = process.argv.find((a) => a.startsWith('--annzarro-frame='));
const frame = frameArg ? frameArg.slice('--annzarro-frame='.length) : '';
function markRoot(root) {
  root.setAttribute('data-desktop', '');
  root.setAttribute('data-desktop-platform', process.platform);
  if (frame) root.setAttribute('data-desktop-frame', frame);
  // macOS hides the traffic lights in full screen, and Windows its overlay: the page takes its room back
  ipcRenderer.invoke('app:isFullScreen').then((on) => root.toggleAttribute('data-desktop-fullscreen', Boolean(on)), () => {});
}
if (document.documentElement) {
  markRoot(document.documentElement);
} else {
  const watch = new MutationObserver(() => {
    if (document.documentElement) {
      watch.disconnect();
      markRoot(document.documentElement);
    }
  });
  watch.observe(document, { childList: true });
}
ipcRenderer.on('app:fullscreen', (event, on) => {
  if (document.documentElement) document.documentElement.toggleAttribute('data-desktop-fullscreen', Boolean(on));
});

// File > Open Dataset...: the page opens its dataset browser. The main process also dispatches the
// DOM event 'annzarro:open-dataset-browser' in the page (cancelable; detail.path is a folder to open
// the browser on, if any), so a page can listen to either; it should use one.
const openDatasetListeners = new Set();
ipcRenderer.on('app:menu-open-dataset', (event, folder) => {
  for (const callback of openDatasetListeners) {
    try { callback(folder || null); } catch (err) { console.error(err); }
  }
});

// Drag and drop of a .zarr folder or .h5ad file anywhere on the window. A full-window target shows
// while files are dragged over (a drag of text or of the page's own elements is left alone);
// Electron 44 has no File.path, so the paths come from webUtils. The main process validates them.
// The target is a plain element styled with the theme's tokens (static/css/theme.css), so it follows
// light and dark. The header is a drag region of the window (desktop-frame.css), which swallows the
// events of a drag over it: while files are dragged everything becomes no-drag.
const DROP_CSS = `
html[data-az-dragging-files] * { -webkit-app-region: no-drag !important; }
#az-drop-target {
  position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: center; justify-content: center;
  background: rgba(var(--az-surface-rgb, 255, 255, 255), 0.88); -webkit-app-region: no-drag;
}
html[data-az-dragging-files] #az-drop-target { display: flex; }
#az-drop-target .az-drop-card {
  box-sizing: border-box; width: min(32rem, calc(100vw - 4rem)); padding: 2.5rem 2rem; text-align: center;
  background: var(--az-surface, #fff); color: var(--az-text, #212529);
  border: 2px dashed var(--az-focus-border, #86b7fe); border-radius: 12px;
  font: 1rem/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; pointer-events: none;
}
#az-drop-target .az-drop-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.4rem; }
#az-drop-target .az-drop-hint { color: var(--az-muted, #5c636a); font-size: 0.9rem; }
`;
function carriesFiles(event) {
  const types = event.dataTransfer && event.dataTransfer.types;
  return Boolean(types) && Array.prototype.includes.call(types, 'Files');
}
function installDropTarget() {
  if (document.getElementById('az-drop-target') || !document.body) return;
  try { webFrame.insertCSS(DROP_CSS); } catch (err) { console.error(err); }
  const root = document.documentElement;
  const target = document.createElement('div');
  target.id = 'az-drop-target';
  target.setAttribute('aria-hidden', 'true');
  const card = document.createElement('div');
  card.className = 'az-drop-card';
  const title = document.createElement('div');
  title.className = 'az-drop-title';
  title.textContent = 'Drop to open the dataset';
  const hint = document.createElement('div');
  hint.className = 'az-drop-hint';
  hint.textContent = 'A .zarr folder or an .h5ad file';
  card.append(title, hint);
  target.append(card);
  document.body.append(target);
  // A drag that leaves the window fires dragleave with no relatedTarget; counting enters is unreliable
  // across child elements, so the target hides on that signal and on drop/dragend.
  const hide = () => root.removeAttribute('data-az-dragging-files');
  window.addEventListener('dragenter', (e) => { if (carriesFiles(e)) root.setAttribute('data-az-dragging-files', ''); });
  window.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    root.setAttribute('data-az-dragging-files', '');
  });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hide(); });
  window.addEventListener('dragend', hide);
  window.addEventListener('drop', (e) => {
    hide();
    if (!carriesFiles(e)) return;
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files).map((f) => {
      try { return webUtils.getPathForFile(f); } catch (err) { return ''; }
    }).filter(Boolean);
    if (paths.length) ipcRenderer.invoke('app:dropPaths', paths).catch((err) => console.error(err));
  });
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', installDropTarget, { once: true });
} else {
  installDropTarget();
}

// Listen for app will-quit events
ipcRenderer.on('app:will-quit', () => {
  // Trigger autosave via global window method if available
  if (window.triggerAppClosingAutosave) {
    window.triggerAppClosingAutosave();
  }
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'api', {
    // App functions
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    platform: process.platform,
    frame,
    // Windows: the colours of the window controls (#rrggbb), those of the header
    setTitleBarOverlay: (colors) => ipcRenderer.invoke('app:setTitleBarOverlay', colors),
    restartServer: () => ipcRenderer.invoke('app:restartServer'),
    
    // Open a dataset: the native dialog ('h5ad' = a file, 'zarr' = a folder, none = the platform's
    // best: one dialog for either on macOS, an .h5ad file elsewhere) or a given local path. The main
    // process validates it and has this page open it (window.annzarro.openDataset). Resolves to
    // {path, kind, result} (result = the page's answer) or {path, kind, error}; null if the dialog
    // was cancelled. {path, allowFolder: true} lets a plain folder go to the browser as a place.
    openDatasetDialog: (which) => ipcRenderer.invoke('app:openDataset', { which }),
    openDatasetPath: (path, options) => ipcRenderer.invoke('app:openDataset', { path, allowFolder: Boolean(options && options.allowFolder) }),
    // The page tells the app which dataset it has open (null for none), however it was opened, so
    // the recent list, the Dock/jump list and the macOS proxy icon follow. Remote URLs clear the icon.
    datasetOpened: (path) => ipcRenderer.invoke('app:datasetOpened', path || null),
    // File > Open Dataset... (Cmd/Ctrl+O): callback(folder|null); returns an unsubscribe function
    onMenuOpenDataset: (callback) => {
      if (typeof callback !== 'function') return () => {};
      openDatasetListeners.add(callback);
      return () => openDatasetListeners.delete(callback);
    },
    // Replaced by openDatasetDialog; the page's folder button still calls it
    selectDirectory: () => ipcRenderer.invoke('app:selectDirectory'),
    
    // Environment info
    getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
    getSystemInfo: () => ipcRenderer.invoke('app:getSystemInfo'),
    
    // App lifecycle
    onWillQuit: (callback) => {
      // Register a function to be called when app is about to quit
      if (typeof callback === 'function') {
        window.triggerAppClosingAutosave = callback;
      }
    }
  }
);