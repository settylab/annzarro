const { contextBridge, ipcRenderer } = require('electron');

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
    getSystemInfo: () => ipcRenderer.invoke('app:getSystemInfo')
  }
);