const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

// Helper to safely execute PowerShell scripts via -EncodedCommand with optional env vars
function runPowerShellScript(scriptText, extraEnv = {}) {
  return new Promise((resolve) => {
    const buffer = Buffer.from(scriptText, 'utf16le');
    const encodedCommand = buffer.toString('base64');

    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      {
        env: { ...process.env, ...extraEnv },
        windowsHide: true,
      }
    );

    const stdoutChunks = [];
    const stderrChunks = [];

    ps.stdout.on('data', (d) => { stdoutChunks.push(d); });
    ps.stderr.on('data', (d) => { stderrChunks.push(d); });

    ps.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        resolve({ success: false, error: stderr || stdout || `Exit code ${code}` });
      }
    });

    ps.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── Auto Updater (electron-updater) ────────────────────────────────────────
let autoUpdater = null;
let isManualUpdateCheck = false;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.logger = {
    info: (...a) => console.log('[Updater]', ...a),
    warn: (...a) => console.warn('[Updater]', ...a),
    error: (...a) => console.error('[Updater]', ...a),
    debug: (...a) => console.debug('[Updater]', ...a),
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
} catch (e) {
  console.warn('[Updater] electron-updater not available:', e.message);
}

function isAutoUpdateSupported() {
  if (!autoUpdater || !app.isPackaged) return false;
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) return false;
  try {
    return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  } catch {
    return false;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Authorized Filesystem Path Allowlist ────────────────────────────────────
const authorizedPaths = new Set();
const persistedAuthorizedList = [];
const MAX_PERSISTED_PATHS = 200;

function toAuthKey(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) return null;
  try {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return null;
  }
}

function getAuthorizedPathsFile() {
  try {
    return path.join(app.getPath('userData'), 'authorized-paths.json');
  } catch {
    return null;
  }
}

function loadAuthorizedPaths() {
  try {
    const file = getAuthorizedPathsFile();
    if (!file || !fs.existsSync(file)) return;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const key = toAuthKey(entry);
        if (key && !authorizedPaths.has(key)) {
          authorizedPaths.add(key);
          persistedAuthorizedList.push(path.resolve(entry));
        }
      }
    }
  } catch (err) {
    console.warn('[AuthPaths] Failed to load:', err.message);
  }
}

function persistAuthorizedPaths() {
  const file = getAuthorizedPathsFile();
  if (!file) return;
  fs.promises
    .writeFile(file, JSON.stringify(persistedAuthorizedList.slice(0, MAX_PERSISTED_PATHS), null, 2), 'utf8')
    .catch(() => {});
}

function authorizePath(filePath, shouldPersist = true) {
  const key = toAuthKey(filePath);
  if (!key) return null;
  const resolved = path.resolve(filePath);
  authorizedPaths.add(key);
  if (shouldPersist && resolved.toLowerCase().endsWith('.pdf')) {
    const idx = persistedAuthorizedList.findIndex((p) => toAuthKey(p) === key);
    if (idx !== -1) persistedAuthorizedList.splice(idx, 1);
    persistedAuthorizedList.unshift(resolved);
    if (persistedAuthorizedList.length > MAX_PERSISTED_PATHS) {
      persistedAuthorizedList.length = MAX_PERSISTED_PATHS;
    }
    persistAuthorizedPaths();
  }
  return resolved;
}

function isPathAuthorized(filePath) {
  const key = toAuthKey(filePath);
  return Boolean(key && authorizedPaths.has(key));
}
// ─────────────────────────────────────────────────────────────────────────────

let mainWindow = null;
let fileToOpenOnReady = null;
let rendererReadyForEvents = false;

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
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return resolved;
        }
      } catch {
        // ignore invalid CLI arg
      }
    }
  }
  return null;
}

const initialPdf = getPdfArg(process.argv);
if (initialPdf) {
  fileToOpenOnReady = initialPdf;
  authorizePath(initialPdf, false);
}

async function openPdfInRenderer(filePath) {
  if (!mainWindow || mainWindow.isDestroyed() || !filePath) return;
  const authorized = authorizePath(filePath, true);
  if (!authorized) return;
  try {
    const buffer = await fs.promises.readFile(authorized);
    const fileName = path.basename(authorized);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('open-file', {
      name: fileName,
      path: authorized,
      buffer: Uint8Array.from(buffer),
    });
  } catch (err) {
    console.error('Failed to read PDF file for renderer:', err);
  }
}

function getWindowStatePath() {
  try {
    return path.join(app.getPath('userData'), 'window-state.json');
  } catch {
    return null;
  }
}

let lastNormalBounds = { width: 1380, height: 900 };

function loadWindowState() {
  const defaultState = {
    width: 1380,
    height: 900,
    isMaximized: false,
  };
  try {
    const filePath = getWindowStatePath();
    if (filePath && fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof parsed.width === 'number' && parsed.width >= 400) {
        defaultState.width = parsed.width;
      }
      if (typeof parsed.height === 'number' && parsed.height >= 400) {
        defaultState.height = parsed.height;
      }
      if (typeof parsed.isMaximized === 'boolean') {
        defaultState.isMaximized = parsed.isMaximized;
      }
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some((display) => {
          const { x, y, width, height } = display.bounds;
          return (
            parsed.x >= x - 50 &&
            parsed.x < x + width - 100 &&
            parsed.y >= y - 50 &&
            parsed.y < y + height - 100
          );
        });
        if (isVisible) {
          defaultState.x = parsed.x;
          defaultState.y = parsed.y;
        }
      }
      lastNormalBounds = {
        width: defaultState.width,
        height: defaultState.height,
        ...(typeof defaultState.x === 'number' ? { x: defaultState.x } : {}),
        ...(typeof defaultState.y === 'number' ? { y: defaultState.y } : {}),
      };
      return defaultState;
    }
  } catch (err) {
    console.warn('[WindowState] Failed to load:', err);
  }
  return defaultState;
}

let saveWindowStateTimer = null;
function clearSaveWindowStateTimer() {
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = null;
  }
}

function saveWindowState() {
  clearSaveWindowStateTimer();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const filePath = getWindowStatePath();
    if (!filePath) return;
    const isMaximized = mainWindow.isMaximized();
    if (!isMaximized && !mainWindow.isMinimized()) {
      lastNormalBounds = mainWindow.getNormalBounds();
    }
    const state = {
      ...lastNormalBounds,
      isMaximized,
    };
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[WindowState] Failed to save:', err);
  }
}

function debouncedSaveWindowState() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
    lastNormalBounds = mainWindow.getNormalBounds();
  }
  clearSaveWindowStateTimer();
  saveWindowStateTimer = setTimeout(saveWindowState, 300);
}

function resolveAppIconPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'build', 'icon.ico') : null,
    path.join(path.dirname(app.getPath('exe')), 'resources', 'build', 'icon.ico'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
  ].filter(Boolean);

  return candidates.find((p) => !p.includes('.asar') && fs.existsSync(p)) || path.join(__dirname, '../build/icon.ico');
}

function createWindow() {
  const windowState = loadWindowState();

  const windowOptions = {
    width: windowState.width || 1380,
    height: windowState.height || 900,
    minWidth: 900,
    minHeight: 600,
    title: 'XPDF Editor',
    icon: resolveAppIconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };

  if (typeof windowState.x === 'number' && typeof windowState.y === 'number') {
    windowOptions.x = windowState.x;
    windowOptions.y = windowState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('resize', debouncedSaveWindowState);
  mainWindow.on('move', debouncedSaveWindowState);
  mainWindow.on('maximize', debouncedSaveWindowState);
  mainWindow.on('unmaximize', debouncedSaveWindowState);
  mainWindow.on('close', saveWindowState);

  // Determine correct path to dist/index.html
  let indexPath = path.join(__dirname, '../dist/index.html');
  if (!fs.existsSync(indexPath)) {
    indexPath = path.join(app.getAppPath(), 'dist/index.html');
  }
  const allowedIndexUrl = pathToFileURL(indexPath).href;

  // Lock navigation strictly to our bundled app entry
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const target = new URL(navigationUrl);
      if (target.href !== allowedIndexUrl && !target.href.startsWith(`${allowedIndexUrl}#`)) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  // Restrict external links to http/https only; never allow new Electron windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch {
      // deny invalid URLs
    }
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Safety fallback to guarantee window is shown
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);

  mainWindow.loadFile(indexPath);

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error('Failed to load index.html:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReadyForEvents = false;
  });

  mainWindow.on('closed', () => {
    clearSaveWindowStateTimer();
    rendererReadyForEvents = false;
    mainWindow = null;
  });
}

// Cleanup temporary drag & OCR folders
function cleanupTempFolders() {
  const dirs = [
    path.join(app.getPath('temp'), 'xpdf_drag'),
    path.join(app.getPath('temp'), 'xpdf_ocr'),
  ];
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // ignore locked temp items
    }
  }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }

    const targetPdf = getPdfArg(commandLine);
    if (targetPdf) {
      authorizePath(targetPdf, true);
      if (mainWindow && rendererReadyForEvents) {
        openPdfInRenderer(targetPdf);
      } else {
        fileToOpenOnReady = targetPdf;
      }
    }
  });

  // macOS Finder "Open With" / file double-click support
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (!filePath || !filePath.toLowerCase().endsWith('.pdf')) return;
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return;
      authorizePath(resolved, true);
      if (mainWindow && rendererReadyForEvents) {
        openPdfInRenderer(resolved);
      } else {
        fileToOpenOnReady = resolved;
      }
    } catch {
      // ignore
    }
  });

  app.whenReady().then(() => {
    loadAuthorizedPaths();
    if (initialPdf) {
      authorizePath(initialPdf, true);
    }
    cleanupTempFolders();
    createWindow();

    // ─── Auto Update Check (only on installed NSIS builds with app-update.yml) ─
    if (isAutoUpdateSupported()) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.warn('[Updater] checkForUpdates failed:', err.message);
        });
      }, 3000);

      autoUpdater.on('update-available', (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater-status', {
            type: 'available',
            version: info.version,
            message: 'Yeni güncelleme indiriliyor, lütfen bekleyin...',
          });
        }
      });

      autoUpdater.on('update-not-available', () => {
        console.log('[Updater] App is up to date.');
      });

      autoUpdater.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater-status', {
            type: 'progress',
            percent: Math.round(progress.percent),
            message: `Güncelleme indiriliyor... %${Math.round(progress.percent)}`,
          });
        }
      });

      autoUpdater.on('update-downloaded', (info) => {
        // Never restart unconditionally; notify renderer so user can install when safe
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater-status', {
            type: 'downloaded',
            version: info.version,
            message: 'Güncelleme indirildi ve kuruluma hazır. Yüklemek için yeniden başlatabilirsiniz.',
          });
        }
      });

      autoUpdater.on('error', (err) => {
        console.error('[Updater] Error:', err.message);
        if (isManualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater-status', {
            type: 'error',
            message: `Güncelleme hatası: ${err.message}`,
          });
        }
        isManualUpdateCheck = false;
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

  app.on('before-quit', () => {
    saveWindowState();
    cleanupTempFolders();
  });
}

// ─── Auto-updater IPC ────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev-mode' };
  if (!isAutoUpdateSupported()) return { status: 'unsupported' };
  isManualUpdateCheck = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const isUpdateAvailable = Boolean(result?.isUpdateAvailable);
    if (!isUpdateAvailable) {
      isManualUpdateCheck = false;
    }
    return {
      status: 'checking',
      isUpdateAvailable,
      version: result?.updateInfo?.version,
    };
  } catch (err) {
    isManualUpdateCheck = false;
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('install-update-now', async () => {
  if (isAutoUpdateSupported()) {
    autoUpdater.quitAndInstall(false, true);
  }
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

// ─── File & Dialog IPC Handlers ──────────────────────────────────────────────
ipcMain.handle('get-initial-file', async () => {
  rendererReadyForEvents = true;
  if (!fileToOpenOnReady) return null;
  const targetPath = fileToOpenOnReady;
  fileToOpenOnReady = null;
  try {
    authorizePath(targetPath, true);
    const buffer = await fs.promises.readFile(targetPath);
    return {
      name: path.basename(targetPath),
      path: targetPath,
      buffer: Uint8Array.from(buffer),
    };
  } catch {
    return null;
  }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  if (!isPathAuthorized(filePath)) {
    throw new Error('Bu dosya yolu için okuma izni yok.');
  }
  const resolved = path.resolve(filePath);
  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      throw new Error('Hedef bir dosya değil.');
    }
    const buffer = await fs.promises.readFile(resolved);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return {
      name: path.basename(resolved),
      path: resolved,
      buffer: arrayBuffer,
      byteOffset: 0,
      byteLength: arrayBuffer.byteLength,
    };
  } catch (err) {
    throw new Error(`Dosya okunamadı: ${err.message}`);
  }
});

function sanitizeDialogFilters(filters, fallback) {
  if (!Array.isArray(filters) || filters.length === 0) return fallback;
  const cleaned = filters
    .filter((f) => f && typeof f.name === 'string' && Array.isArray(f.extensions) && f.extensions.length > 0)
    .map((f) => ({
      name: f.name,
      extensions: f.extensions.filter((ext) => typeof ext === 'string' && /^[a-zA-Z0-9]+$/.test(ext)),
    }))
    .filter((f) => f.extensions.length > 0);
  return cleaned.length > 0 ? cleaned : fallback;
}

ipcMain.handle('show-open-dialog', async (_event, options) => {
  const properties = ['openFile'];
  if (options?.multiSelections) properties.push('multiSelections');

  const result = await dialog.showOpenDialog(mainWindow, {
    title: typeof options?.title === 'string' ? options.title : 'PDF Dosyası Aç',
    defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
    filters: sanitizeDialogFilters(options?.filters, [{ name: 'PDF Dosyaları', extensions: ['pdf'] }]),
    properties,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filePaths: [], files: [] };
  }

  const authorizedFilePaths = [];
  const files = [];
  for (const fp of result.filePaths) {
    const resolved = authorizePath(fp, true);
    if (!resolved) continue;
    authorizedFilePaths.push(resolved);
    const buffer = await fs.promises.readFile(resolved);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    files.push({
      name: path.basename(resolved),
      path: resolved,
      buffer: arrayBuffer,
      byteOffset: 0,
      byteLength: arrayBuffer.byteLength,
    });
  }

  return {
    canceled: false,
    filePaths: authorizedFilePaths,
    files,
  };
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: typeof options?.title === 'string' ? options.title : 'Dosyayı Kaydet',
    defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : 'belge.pdf',
    filters: sanitizeDialogFilters(options?.filters, [{ name: 'PDF Dosyaları', extensions: ['pdf'] }]),
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true, filePath: null };
  }

  const resolved = authorizePath(result.filePath, true);
  return {
    canceled: false,
    filePath: resolved || result.filePath,
  };
});

ipcMain.handle('save-file', async (_event, payload) => {
  const filePath = payload?.filePath;
  const buffer = payload?.buffer;
  if (!isPathAuthorized(filePath)) {
    return { success: false, error: 'Bu dosya yolu için yazma izni yok.' };
  }
  if (!buffer) {
    return { success: false, error: 'Kaydedilecek veri bulunamadı.' };
  }
  try {
    const resolved = path.resolve(filePath);
    const bytes = ArrayBuffer.isView(buffer)
      ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : Buffer.from(buffer);
    await fs.promises.writeFile(resolved, bytes);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('print-document', async (_event, options) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: 'Pencere bulunamadı' };
  }
  return new Promise((resolve) => {
    try {
      mainWindow.webContents.print(
        {
          silent: Boolean(options?.silent),
          printBackground: true,
          deviceName: typeof options?.deviceName === 'string' ? options.deviceName : '',
        },
        (success, failureReason) => {
          if (success) {
            resolve({ success: true });
          } else {
            resolve({
              success: false,
              canceled: failureReason === 'cancelled',
              error: failureReason || 'Yazdırma başarısız',
            });
          }
        }
      );
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

// Windows File Association Helper
ipcMain.handle('register-pdf-association', async () => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Yalnızca Windows işletim sisteminde desteklenmektedir.' };
  }

  const exePath = app.getPath('exe');
  const iconPath = resolveAppIconPath();

  const psScript = `
$ErrorActionPreference = 'Stop'

$progId = 'XPDF.PDFDocument'
$appName = 'XPDF Editor'
$exe = $env:XPDF_ASSOC_EXE
$icon = $env:XPDF_ASSOC_ICON

# 1. Register ProgId in HKCU:\\Software\\Classes
$progKey = "HKCU:\\Software\\Classes\\$progId"
if (-not (Test-Path $progKey)) { New-Item -Path $progKey -Force | Out-Null }
Set-ItemProperty -Path $progKey -Name "(Default)" -Value "PDF Belgesi (XPDF)" -Force
Set-ItemProperty -Path $progKey -Name "FriendlyTypeName" -Value "PDF Belgesi (XPDF)" -Force

$iconKey = "$progKey\\DefaultIcon"
if (-not (Test-Path $iconKey)) { New-Item -Path $iconKey -Force | Out-Null }
Set-ItemProperty -Path $iconKey -Name "(Default)" -Value "\`"$icon\`",0" -Force

$cmdKey = "$progKey\\shell\\open\\command"
if (-not (Test-Path $cmdKey)) { New-Item -Path $cmdKey -Force | Out-Null }
Set-ItemProperty -Path $cmdKey -Name "(Default)" -Value "\`"$exe\`" \`"%1\`"" -Force

# 2. Register file association under HKCU:\\Software\\Classes\\.pdf
$pdfKey = "HKCU:\\Software\\Classes\\.pdf"
if (-not (Test-Path $pdfKey)) { New-Item -Path $pdfKey -Force | Out-Null }
Set-ItemProperty -Path $pdfKey -Name "(Default)" -Value $progId -Force
Set-ItemProperty -Path $pdfKey -Name "Content Type" -Value "application/pdf" -Force
Set-ItemProperty -Path $pdfKey -Name "PerceivedType" -Value "document" -Force

$openWithKey = "$pdfKey\\OpenWithProgids"
if (-not (Test-Path $openWithKey)) { New-Item -Path $openWithKey -Force | Out-Null }
Set-ItemProperty -Path $openWithKey -Name $progId -Value ([byte[]]@()) -Force

# 3. Register under HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths
$exeName = [System.IO.Path]::GetFileName($exe)
$appPathsKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exeName"
if (-not (Test-Path $appPathsKey)) { New-Item -Path $appPathsKey -Force | Out-Null }
Set-ItemProperty -Path $appPathsKey -Name "(Default)" -Value $exe -Force
Set-ItemProperty -Path $appPathsKey -Name "Path" -Value ([System.IO.Path]::GetDirectoryName($exe)) -Force

# 4. Register Capabilities for Windows Default Apps
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
    const result = await runPowerShellScript(psScript, {
      XPDF_ASSOC_EXE: exePath,
      XPDF_ASSOC_ICON: iconPath,
    });
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

// ─── Native OS Drag & Drop ───────────────────────────────────────────────────
function getValidDragIcon() {
  let dragIcon = nativeImage.createEmpty();
  const candidateIcons = [
    path.join(__dirname, '../dist/favicon.ico'),
    path.join(app.getAppPath(), 'dist/favicon.ico'),
    path.join(__dirname, '../public/favicon.ico'),
    resolveAppIconPath(),
  ];
  for (const p of candidateIcons) {
    if (p && fs.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) {
          dragIcon = img;
          break;
        }
      } catch {
        // try next
      }
    }
  }
  if (dragIcon.isEmpty()) {
    const fallbackPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVDhPY/wPBAwUACMYNWDUAAYGAHmcASWqO6dSAAAAAElFTkSuQmCC',
      'base64'
    );
    dragIcon = nativeImage.createFromBuffer(fallbackPng);
  }
  return dragIcon;
}

function sanitizeDragFileName(rawName) {
  const base = path.basename(String(rawName || 'sayfa.pdf')).trim();
  const cleaned = base.replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '');
  const stem = cleaned.replace(/\.[^.]*$/, '').toUpperCase();
  if (
    !cleaned ||
    cleaned === '.' ||
    cleaned === '..' ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
  ) {
    return 'sayfa.pdf';
  }
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

ipcMain.handle('prepare-drag-file', async (_event, data) => {
  try {
    if (!data || !data.buffer) return { success: false, error: 'No buffer' };
    const baseTempDir = path.join(app.getPath('temp'), 'xpdf_drag');
    const sessionDir = path.join(
      baseTempDir,
      `drag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );
    await fs.promises.mkdir(sessionDir, { recursive: true });

    const safeFileName = sanitizeDragFileName(data.fileName);
    const tempFilePath = path.resolve(sessionDir, safeFileName);
    if (path.dirname(tempFilePath) !== path.resolve(sessionDir)) {
      return { success: false, error: 'Invalid filename' };
    }

    const bytes = ArrayBuffer.isView(data.buffer)
      ? Buffer.from(data.buffer.buffer, data.buffer.byteOffset, data.buffer.byteLength)
      : Buffer.from(data.buffer);
    await fs.promises.writeFile(tempFilePath, bytes);
    return { success: true, filePath: tempFilePath };
  } catch (err) {
    console.error('prepare-drag-file error:', err);
    return { success: false, error: String(err) };
  }
});

ipcMain.on('start-drag-file', (event, payload) => {
  try {
    const filePath = payload?.filePath;
    const iconDataUrl = payload?.iconDataUrl;
    if (typeof filePath !== 'string' || !filePath) return;

    const dragRoot = path.resolve(app.getPath('temp'), 'xpdf_drag');
    const resolvedTarget = path.resolve(filePath);
    const normalizedRoot = process.platform === 'win32' ? dragRoot.toLowerCase() : dragRoot;
    const normalizedTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
    if (!normalizedTarget.startsWith(normalizedRoot + path.sep) || !fs.existsSync(resolvedTarget)) {
      return;
    }

    let dragIcon = getValidDragIcon();
    if (typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')) {
      try {
        const customImg = nativeImage.createFromDataURL(iconDataUrl);
        if (!customImg.isEmpty()) {
          dragIcon = customImg;
        }
      } catch {
        // fallback to default drag icon
      }
    }

    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.startDrag({
        file: resolvedTarget,
        icon: dragIcon,
      });
    }
  } catch (err) {
    console.error('start-drag-file error:', err);
  }
});

// ─── WinRT Bölge OCR (Windows only) ─────────────────────────────────────────
ipcMain.handle('winrt-ocr-region', async (_event, payload) => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'WinRT OCR yalnızca Windows işletim sisteminde desteklenmektedir.' };
  }
  const imageDataUrl = payload?.imageDataUrl;
  const lang = payload?.lang;
  let tempImg = null;

  try {
    if (typeof imageDataUrl !== 'string') {
      return { success: false, error: 'Geçersiz görüntü verisi.' };
    }

    const imgMatch = imageDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if (!imgMatch) {
      return { success: false, error: 'Desteklenmeyen görüntü formatı (PNG/JPEG/WEBP bekleniyor).' };
    }

    const extMap = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp' };
    const ext = extMap[imgMatch[1].toLowerCase()] || 'png';
    const base64Data = imgMatch[2].replace(/[\r\n]/g, '');

    const tempDir = path.join(app.getPath('temp'), 'xpdf_ocr');
    await fs.promises.mkdir(tempDir, { recursive: true });
    tempImg = path.join(
      tempDir,
      `region_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`
    );
    await fs.promises.writeFile(tempImg, Buffer.from(base64Data, 'base64'));

    const langParam = String(lang || 'tr').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const ps = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1

function Await-WinRt($asyncOp, $resultType) {
    $method = $global:asTaskGeneric.MakeGenericMethod($resultType)
    $task = $method.Invoke($null, @($asyncOp))
    $task.Wait()
    return $task.Result
}

$imagePath = $env:XPDF_OCR_IMG
$langPrefix = $env:XPDF_OCR_LANG

if ([string]::IsNullOrWhiteSpace($imagePath) -or -not (Test-Path $imagePath)) {
    $errOut = @{ success=$false; error="Image file not found" } | ConvertTo-Json -Compress
    [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($errOut))
    exit 0
}

$fs = $null
$ras = $null
try {
    $fs = [System.IO.File]::OpenRead($imagePath)
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fs)

    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
    $targetLang = $null
    if (-not [string]::IsNullOrWhiteSpace($langPrefix)) {
        $targetLang = $langs | Where-Object { $_.LanguageTag.ToLower().StartsWith($langPrefix.ToLower()) } | Select-Object -First 1
    }
    $ocrEngine = $null
    if ($targetLang) {
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($targetLang)
    }
    if (-not $ocrEngine) {
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if (-not $ocrEngine) {
        $errOut = @{ success=$false; error="OCR engine not available for requested language" } | ConvertTo-Json -Compress
        [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($errOut))
        exit 0
    }

    $ocrResult = Await-WinRt ($ocrEngine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($line in $ocrResult.Lines) {
        $words = @()
        foreach ($word in $line.Words) {
            $r = $word.BoundingRect
            $words += @{ text=$word.Text; x=[int]$r.X; y=[int]$r.Y; w=[int]$r.Width; h=[int]$r.Height }
        }
        $lines += @{ text=$line.Text; words=$words }
    }

    $outObj = @{ success=$true; text=$ocrResult.Text; lines=$lines }
    $outJson = $outObj | ConvertTo-Json -Depth 6 -Compress
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($outJson))
    Write-Output $b64
} finally {
    if ($ras) { try { $ras.Dispose() } catch {} }
    if ($fs) { try { $fs.Dispose() } catch {} }
}
`;

    const res = await runPowerShellScript(ps, {
      XPDF_OCR_IMG: tempImg,
      XPDF_OCR_LANG: langParam,
    });

    if (!res.success) {
      return { success: false, error: res.error };
    }

    try {
      const outputText = res.output.trim();
      let jsonString = '';
      try {
        jsonString = Buffer.from(outputText, 'base64').toString('utf8');
      } catch {
        jsonString = outputText;
      }

      if (jsonString.startsWith('{')) {
        return JSON.parse(jsonString);
      }

      const match = jsonString.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }

      return { success: false, error: 'Geçersiz OCR yanıtı: ' + jsonString.substring(0, 150) };
    } catch (parseErr) {
      return { success: false, error: 'JSON parse hatası: ' + parseErr.message };
    }
  } catch (err) {
    console.error('winrt-ocr-region error:', err);
    return { success: false, error: String(err) };
  } finally {
    if (tempImg) {
      fs.promises.unlink(tempImg).catch(() => {});
    }
  }
});

ipcMain.handle('winrt-ocr-get-languages', async () => {
  if (process.platform !== 'win32') {
    return { success: false, languages: [] };
  }
  try {
    const ps = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
$list = @($langs | Where-Object { $_ -ne $null } | ForEach-Object { @{ tag=$_.LanguageTag; name=$_.DisplayName } })
$json = ConvertTo-Json -InputObject $list -Compress
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
`;
    const res = await runPowerShellScript(ps);
    if (!res.success || !res.output) return { success: false, languages: [] };
    try {
      const jsonStr = Buffer.from(res.output.trim(), 'base64').toString('utf8');
      const parsed = JSON.parse(jsonStr);
      const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      const valid = arr.filter((l) => l && typeof l.tag === 'string' && l.tag.length > 0);
      return { success: true, languages: valid };
    } catch {
      return { success: false, languages: [] };
    }
  } catch {
    return { success: false, languages: [] };
  }
});
