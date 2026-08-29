const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // Event listeners
  onOpenFile: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('open-file', subscription);
    return () => ipcRenderer.removeListener('open-file', subscription);
  },

  // File operations
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  saveFile: (filePath, buffer) => ipcRenderer.invoke('save-file', { filePath, buffer }),

  // Windows Integration
  registerPdfAssociation: () => ipcRenderer.invoke('register-pdf-association'),
  enableThumbnailHandler: () => ipcRenderer.invoke('enable-thumbnail-handler'),
  disableThumbnailHandler: () => ipcRenderer.invoke('disable-thumbnail-handler'),
  getThumbnailHandlerStatus: () => ipcRenderer.invoke('get-thumbnail-handler-status'),
});
