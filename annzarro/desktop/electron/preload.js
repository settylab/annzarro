const { contextBridge, ipcRenderer } = require('electron');

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
    
    // File system dialog functions
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