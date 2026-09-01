const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

let mainWindow = null;
let fileToOpenOnReady = null;

function getPdfArg(argv) {
  if (!argv || !Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (
      arg &&
      !arg.startsWith('--') &&
      !arg.startsWith('-') &&
      arg.toLowerCase().endsWith('.pdf')
    ) {
      try {
        const resolved = path.resolve(arg);
        if (fs.existsSync(resolved)) {
          return resolved;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

const initialPdf = getPdfArg(process.argv);
if (initialPdf) {
  fileToOpenOnReady = initialPdf;
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      const targetPdf = getPdfArg(commandLine);
      if (targetPdf) {
        openPdfInRenderer(targetPdf);
      }
    }
  });
}

function openPdfInRenderer(filePath) {
  if (!mainWindow || !filePath) return;
  try {
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    mainWindow.webContents.send('open-file', {
      name: fileName,
      path: filePath,
      buffer: Uint8Array.from(buffer),
    });
  } catch (err) {
    console.error('Failed to read PDF file for renderer:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'XPDF Editor',
    icon: path.join(__dirname, '../build/icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Safety fallback to guarantee window is shown
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);

  // Determine correct path to dist/index.html
  let indexPath = path.join(__dirname, '../dist/index.html');
  if (!fs.existsSync(indexPath)) {
    indexPath = path.join(app.getAppPath(), 'dist/index.html');
  }

  mainWindow.loadFile(indexPath);

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error('Failed to load index.html:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (fileToOpenOnReady) {
      setTimeout(() => {
        openPdfInRenderer(fileToOpenOnReady);
        fileToOpenOnReady = null;
      }, 500);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function ensureThumbnailProviderRegistered() {
  if (process.platform !== 'win32') return;
  try {
    const isPackaged = app.isPackaged;
    const candidates = [
      path.join(process.resourcesPath, 'tools', 'thumbnail-provider', 'PdfThumbHandler.dll'),
      path.join(process.resourcesPath, 'app', 'tools', 'thumbnail-provider', 'PdfThumbHandler.dll'),
      path.join(path.dirname(app.getPath('exe')), 'tools', 'thumbnail-provider', 'PdfThumbHandler.dll'),
      path.join(__dirname, '..', 'tools', 'thumbnail-provider', 'PdfThumbHandler.dll'),
      'C:\\Program Files\\PDF24\\PdfThumbHandler.dll'
    ];

    const dllPath = candidates.find((p) => fs.existsSync(p));
    if (dllPath) {
      exec(`regsvr32.exe /s "${dllPath}"`, () => {
        const thumbClsid = '{3AF5A38C-78A5-4CE1-BCE5-6421BF94DCAD}';
        const psCmd = `Set-ItemProperty -Path "HKCU:\\Software\\Classes\\.pdf\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}" -Name "(default)" -Value "${thumbClsid}" -Force -ErrorAction SilentlyContinue; Set-ItemProperty -Path "HKCU:\\Software\\Classes\\SystemFileAssociations\\.pdf\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}" -Name "(default)" -Value "${thumbClsid}" -Force -ErrorAction SilentlyContinue; Set-ItemProperty -Path "HKCU:\\Software\\Classes\\PDF Document\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}" -Name "(default)" -Value "${thumbClsid}" -Force -ErrorAction SilentlyContinue;`;
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, () => {});
      });
    }
  } catch (err) {
    // ignore
  }
}

app.whenReady().then(() => {
  createWindow();
  ensureThumbnailProviderRegistered();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('get-initial-file', async () => {
  if (!fileToOpenOnReady) return null;
  try {
    const buffer = fs.readFileSync(fileToOpenOnReady);
    const fileName = path.basename(fileToOpenOnReady);
    const result = {
      name: fileName,
      path: fileToOpenOnReady,
      buffer: Uint8Array.from(buffer),
    };
    fileToOpenOnReady = null;
    return result;
  } catch {
    return null;
  }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    return {
      name: fileName,
      path: filePath,
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  } catch (err) {
    throw new Error(`Dosya okunamadı: ${err.message}`);
  }
});

ipcMain.handle('show-open-dialog', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'PDF Dosyası Aç',
    filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
    properties: ['openFile', ...(options?.multiSelections ? ['multiSelections'] : [])],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const files = [];
  for (const fp of result.filePaths) {
    const buffer = fs.readFileSync(fp);
    files.push({
      name: path.basename(fp),
      path: fp,
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    });
  }
  return files;
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'PDF Dosyasını Kaydet',
    defaultPath: options?.defaultPath || 'belge.pdf',
    filters: [{ name: 'PDF Dosyaları', extensions: ['pdf'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('save-file', async (_event, { filePath, buffer }) => {
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Windows File Association & Thumbnail Registration Helper
ipcMain.handle('register-pdf-association', async () => {
  if (process.platform !== 'win32') return { success: false, message: 'Only Windows supported' };
  const exePath = app.getPath('exe');
  const iconPath = path.join(path.dirname(exePath), 'resources', 'build', 'icon.ico');

  const psScript = `
    $progId = "XPDF.PDFDocument"
    $exe = "${exePath.replace(/\\/g, '\\\\')}"
    $icon = "${iconPath.replace(/\\/g, '\\\\')}"

    # Register ProgId
    New-Item -Path "HKCU:\\Software\\Classes\\$progId" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\\Software\\Classes\\$progId" -Name "(Default)" -Value "PDF Document"
    New-Item -Path "HKCU:\\Software\\Classes\\$progId\\DefaultIcon" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\\Software\\Classes\\$progId\\DefaultIcon" -Name "(Default)" -Value "$exe,0"
    New-Item -Path "HKCU:\\Software\\Classes\\$progId\\shell\\open\\command" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\\Software\\Classes\\$progId\\shell\\open\\command" -Name "(Default)" -Value "\`"$exe\`" \`"%1\`""

    # Register file association
    New-Item -Path "HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids" -Name "$progId" -Value ""
    
    # Notify Windows Shell
    [System.Runtime.InteropServices.Marshal]::GetType() | Out-Null
  `;

  return new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, message: 'XPDF başarıyla varsayılan PDF yöneticisi olarak ayarlandı.' });
      }
    });
  });
});

// Drag-to-Desktop / Windows Explorer Native File Drag Handler
ipcMain.on('start-drag-page', (event, { fileName, buffer }) => {
  try {
    const tempDir = app.getPath('temp');
    const safeFileName = (fileName || 'sayfa.pdf').replace(/[/\\?%*:|"<>]/g, '_');
    const tempFilePath = path.join(tempDir, safeFileName);
    fs.writeFileSync(tempFilePath, Buffer.from(buffer));

    let iconPath = path.join(__dirname, '../build/icon.ico');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(app.getAppPath(), 'build/icon.ico');
    }

    event.sender.startDrag({
      file: tempFilePath,
      icon: iconPath,
    });
  } catch (err) {
    console.error('startDrag error:', err);
  }
});

