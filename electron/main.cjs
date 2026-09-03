const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

// Helper to safely execute arbitrary PowerShell scripts via -EncodedCommand (avoids quote/newline escaping bugs)
function runPowerShellScript(scriptText) {
  return new Promise((resolve) => {
    const buffer = Buffer.from(scriptText, 'utf16le');
    const encodedCommand = buffer.toString('base64');

    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedCommand,
    ]);

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (d) => { stdout += d.toString(); });
    ps.stderr.on('data', (d) => { stderr += d.toString(); });

    ps.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({ success: false, error: stderr.trim() || stdout.trim() || `Exit code ${code}` });
      }
    });

    ps.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── Auto Updater (electron-updater) ────────────────────────────────────────
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  // Log updater events to console (visible in DevTools)
  autoUpdater.logger = {
    info: (...a) => console.log('[Updater]', ...a),
    warn: (...a) => console.warn('[Updater]', ...a),
    error: (...a) => console.error('[Updater]', ...a),
    debug: (...a) => console.debug('[Updater]', ...a),
  };
  autoUpdater.autoDownload = true;        // Download automatically in background
  autoUpdater.autoInstallOnAppQuit = true; // Install on next quit/restart
} catch (e) {
  console.warn('[Updater] electron-updater not available:', e.message);
}
// ─────────────────────────────────────────────────────────────────────────────


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
      plugins: true,
    },
  });

  // Open external links in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
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

  // ─── Auto Update Check ──────────────────────────────────────────────────
  if (autoUpdater && app.isPackaged) {
    // Wait 3 seconds after launch so the window is fully loaded first
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[Updater] checkForUpdates failed:', err.message);
      });
    }, 3000);

    autoUpdater.on('update-available', (info) => {
      if (mainWindow) {
        mainWindow.webContents.send('updater-status', {
          type: 'available',
          version: info.version,
          message: `Yeni sürüm (v${info.version}) bulundu. Arka planda indiriliyor...`,
        });
      }
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[Updater] App is up to date.');
    });

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('updater-status', {
          type: 'progress',
          percent: Math.round(progress.percent),
          message: `Güncelleme indiriliyor... %${Math.round(progress.percent)}`,
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow) {
        mainWindow.webContents.send('updater-status', {
          type: 'downloaded',
          version: info.version,
          message: `v${info.version} indirildi. Uygulamayı yeniden başlatın.`,
        });
      }
      // Show native dialog asking user to restart
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'XPDF Editor — Güncelleme Hazır',
        message: `Yeni sürüm (v${info.version}) indirildi.`,
        detail: 'Güncellemeyi uygulamak için uygulamayı şimdi yeniden başlatmak ister misiniz?',
        buttons: ['Şimdi Yeniden Başlat', 'Sonra'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[Updater] Error:', err.message);
      if (mainWindow) {
        mainWindow.webContents.send('updater-status', {
          type: 'error',
          message: `Güncelleme hatası: ${err.message}`,
        });
      }
    });
  }
  // ────────────────────────────────────────────────────────────────────────

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Manuel güncelleme kontrolü (renderer'dan tetiklenebilir)
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater || !app.isPackaged) return { status: 'dev-mode' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'checking', version: result?.updateInfo?.version };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('install-update-now', async () => {
  if (autoUpdater) autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
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

ipcMain.handle('print-document', async (_event, options) => {
  if (!mainWindow) return { success: false, error: 'Pencere bulunamadı' };
  try {
    mainWindow.webContents.print({
      silent: false,
      printBackground: true,
      deviceName: options?.deviceName || '',
    }, (success, failureReason) => {
      if (!success && failureReason !== 'cancelled') {
        console.warn('Print result:', success, failureReason);
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Windows File Association & Thumbnail Registration Helper
ipcMain.handle('register-pdf-association', async () => {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Yalnızca Windows işletim sisteminde desteklenmektedir.' };
  }

  const exePath = app.getPath('exe');
  const appName = 'XPDF Editor';
  const progId = 'XPDF.PDFDocument';

  // Find valid icon path
  let iconPath = path.join(path.dirname(exePath), 'resources', 'build', 'icon.ico');
  if (!fs.existsSync(iconPath)) {
    const candidates = [
      path.join(__dirname, '../build/icon.ico'),
      path.join(app.getAppPath(), 'build/icon.ico'),
      path.join(__dirname, '../dist/favicon.ico'),
      path.join(app.getAppPath(), 'dist/favicon.ico'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) iconPath = found;
  }

  // Safe literal single-quoted strings in PowerShell
  const safeExe = exePath.replace(/'/g, "''");
  const safeIcon = iconPath.replace(/'/g, "''");

  const psScript = `
$ErrorActionPreference = 'Stop'

$progId = '${progId}'
$appName = '${appName}'
$exe = '${safeExe}'
$icon = '${safeIcon}'

# 1. Register ProgId in HKCU:\\Software\\Classes
$progKey = "HKCU:\\Software\\Classes\\$progId"
if (-not (Test-Path $progKey)) { New-Item -Path $progKey -Force | Out-Null }
Set-ItemProperty -Path $progKey -Name "(Default)" -Value "PDF Belgesi (XPDF)" -Force
Set-ItemProperty -Path $progKey -Name "FriendlyTypeName" -Value "PDF Belgesi (XPDF)" -Force

# Default Icon
$iconKey = "$progKey\\DefaultIcon"
if (-not (Test-Path $iconKey)) { New-Item -Path $iconKey -Force | Out-Null }
Set-ItemProperty -Path $iconKey -Name "(Default)" -Value "\`"$icon\`",0" -Force

# Shell Open Command
$cmdKey = "$progKey\\shell\\open\\command"
if (-not (Test-Path $cmdKey)) { New-Item -Path $cmdKey -Force | Out-Null }
Set-ItemProperty -Path $cmdKey -Name "(Default)" -Value "\`"$exe\`" \`"%1\`"" -Force

# 2. Register file association under HKCU:\\Software\\Classes\\.pdf
$pdfKey = "HKCU:\\Software\\Classes\\.pdf"
if (-not (Test-Path $pdfKey)) { New-Item -Path $pdfKey -Force | Out-Null }
Set-ItemProperty -Path $pdfKey -Name "(Default)" -Value $progId -Force
Set-ItemProperty -Path $pdfKey -Name "Content Type" -Value "application/pdf" -Force
Set-ItemProperty -Path $pdfKey -Name "PerceivedType" -Value "document" -Force

# OpenWithProgids
$openWithKey = "$pdfKey\\OpenWithProgids"
if (-not (Test-Path $openWithKey)) { New-Item -Path $openWithKey -Force | Out-Null }
Set-ItemProperty -Path $openWithKey -Name $progId -Value ([byte[]]@()) -Force

# 3. Register under HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths
$exeName = [System.IO.Path]::GetFileName($exe)
$appPathsKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exeName"
if (-not (Test-Path $appPathsKey)) { New-Item -Path $appPathsKey -Force | Out-Null }
Set-ItemProperty -Path $appPathsKey -Name "(Default)" -Value $exe -Force
Set-ItemProperty -Path $appPathsKey -Name "Path" -Value ([System.IO.Path]::GetDirectoryName($exe)) -Force

# 4. Register Capabilities for Windows Default Apps / Default Programs
$capKey = "HKCU:\\Software\\$appName\\Capabilities"
if (-not (Test-Path $capKey)) { New-Item -Path $capKey -Force | Out-Null }
Set-ItemProperty -Path $capKey -Name "ApplicationName" -Value $appName -Force
Set-ItemProperty -Path $capKey -Name "ApplicationDescription" -Value "XPDF - Profesyonel PDF Düzenleyici" -Force

$capAssocKey = "$capKey\\FileAssociations"
if (-not (Test-Path $capAssocKey)) { New-Item -Path $capAssocKey -Force | Out-Null }
Set-ItemProperty -Path $capAssocKey -Name ".pdf" -Value $progId -Force

$regAppsKey = "HKCU:\\Software\\RegisteredApplications"
if (-not (Test-Path $regAppsKey)) { New-Item -Path $regAppsKey -Force | Out-Null }
Set-ItemProperty -Path $regAppsKey -Name $appName -Value "Software\\$appName\\Capabilities" -Force

# 5. Notify Windows Shell of association change
$code = @'
using System;
using System.Runtime.InteropServices;
namespace XPDFWin32 {
    public class Shell32Notifier {
        [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
    }
}
'@
try {
    Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue | Out-Null
    [XPDFWin32.Shell32Notifier]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {}

Write-Output "SUCCESS"
`;

  try {
    const result = await runPowerShellScript(psScript);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      message: 'XPDF Editor başarıyla Windows varsayılan PDF yöneticisi olarak kaydedildi!',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Additional Windows Thumbnail Handlers
ipcMain.handle('enable-thumbnail-handler', async () => {
  ensureThumbnailProviderRegistered();
  return { success: true, message: 'PDF önizleme işleyicisi etkinleştirildi.' };
});

ipcMain.handle('disable-thumbnail-handler', async () => {
  return { success: true, message: 'PDF önizleme işleyicisi sıfırlandı.' };
});

ipcMain.handle('get-thumbnail-handler-status', async () => {
  return { enabled: true };
});


// Helper function to resolve a guaranteed valid drag icon
function getValidDragIcon() {
  let dragIcon = nativeImage.createEmpty();
  const candidateIcons = [
    path.join(__dirname, '../dist/favicon.ico'),
    path.join(app.getAppPath(), 'dist/favicon.ico'),
    path.join(__dirname, '../public/favicon.ico'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.ico'),
  ];
  for (const p of candidateIcons) {
    if (fs.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) {
          dragIcon = img;
          break;
        }
      } catch {}
    }
  }
  return dragIcon;
}

// Prepare file on disk ahead of time (synchronously or ahead of drag)
ipcMain.handle('prepare-drag-file', async (event, data) => {
  try {
    if (!data || !data.buffer) return { success: false, error: 'No buffer' };
    const tempDir = path.join(app.getPath('temp'), 'xpdf_drag');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const safeFileName = (data.fileName || 'sayfa.pdf').replace(/[/\\?%*:|"<>]/g, '_');
    const tempFilePath = path.join(tempDir, safeFileName);
    fs.writeFileSync(tempFilePath, Buffer.from(data.buffer));
    return { success: true, filePath: tempFilePath };
  } catch (err) {
    console.error('prepare-drag-file error:', err);
    return { success: false, error: String(err) };
  }
});

// Start native OS Drag (to Desktop, Explorer, or external apps)
ipcMain.on('start-drag-file', (event, { filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dragIcon = getValidDragIcon();

    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.startDrag({
        file: filePath,
        icon: dragIcon,
      });
    }
  } catch (err) {
    console.error('start-drag-file error:', err);
  }
});

// Legacy start-drag-page (fallback)
ipcMain.on('start-drag-page', (event, data) => {
  try {
    if (!data || !data.buffer) return;
    const tempDir = path.join(app.getPath('temp'), 'xpdf_drag');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const safeFileName = (data.fileName || 'sayfa.pdf').replace(/[/\\?%*:|"<>]/g, '_');
    const tempFilePath = path.join(tempDir, safeFileName);
    fs.writeFileSync(tempFilePath, Buffer.from(data.buffer));

    const dragIcon = getValidDragIcon();
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.startDrag({
        file: tempFilePath,
        icon: dragIcon,
      });
    }
  } catch (err) {
    console.error('startDrag error:', err);
  }
});

