const { contextBridge, ipcRenderer } = require('electron');

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
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
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