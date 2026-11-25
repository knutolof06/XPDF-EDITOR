const { contextBridge, ipcRenderer } = require('electron');

const winrtOcrBindings =
  process.platform === 'win32'
    ? {
        winrtOcrRegion: (imageDataUrl, lang) =>
          ipcRenderer.invoke('winrt-ocr-region', { imageDataUrl, lang }),
        winrtOcrGetLanguages: () => ipcRenderer.invoke('winrt-ocr-get-languages'),
      }
    : {};

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // Event listeners
  onOpenFile: (callback) => {
    if (typeof callback !== 'function') return () => {};
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
  printDocument: (options) => ipcRenderer.invoke('print-document', options),

  // Windows Integration & Native Drag
  registerPdfAssociation: () => ipcRenderer.invoke('register-pdf-association'),
  prepareDragFile: (data) => ipcRenderer.invoke('prepare-drag-file', data),
  startDragFile: (data) => ipcRenderer.send('start-drag-file', data),

  // Auto Updater
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),
  onUpdaterStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('updater-status', subscription);
    return () => ipcRenderer.removeListener('updater-status', subscription);
  },

  // Windows Region OCR (exposed only on Windows)
  ...winrtOcrBindings,
});
