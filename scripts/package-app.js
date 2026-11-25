import packager from '@electron/packager';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function bundle() {
  console.log('Building standalone Windows Executable (.exe)...');

  const distIndex = path.join(rootDir, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('dist/index.html not found! Run npm run build first.');
  }

  let pkgVersion = '1.5.7';
  let pkgDescription = 'XPDF Profesyonel PDF Düzenleyici & Yöneticisi';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    if (pkg.version) pkgVersion = pkg.version;
    if (pkg.description) pkgDescription = pkg.description;
  } catch {
    // use defaults
  }

  const appPaths = await packager({
    dir: rootDir,
    name: 'XPDF Editor',
    platform: 'win32',
    arch: 'x64',
    appVersion: pkgVersion,
    icon: path.join(rootDir, 'build', 'icon.ico'),
    out: path.join(rootDir, 'release'),
    overwrite: true,
    asar: true,
    prune: true,
    ignore: [
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/\.gemini($|\/)/,
      /^\/release($|\/)/,
      /^\/src($|\/)/,
      /^\/scripts($|\/)/,
      /^\/tools($|\/)/,
      /^\/build($|\/)/,
      /^\/scratch($|\/)/,
      /^\/vitest\.config\.ts$/,
      /^\/eslint\.config\.js$/,
      /^\/tsconfig(\.node)?\.json$/,
      /^\/vite\.config\.ts$/,
      /^\/tailwind\.config\.js$/,
      /^\/postcss\.config\.js$/,
      /^\/index\.html$/,
      /^\/manifest\.json$/,
      /\.md$/i,
    ],
    win32metadata: {
      CompanyName: 'XPDF Team',
      FileDescription: pkgDescription,
      OriginalFilename: 'XPDF Editor.exe',
      ProductName: 'XPDF Editor',
      InternalName: 'XPDF Editor',
    },
  });

  const appDir = appPaths[0];
  console.log(`Packaging complete! Output directory: ${appDir}`);

  // Copy build icons outside ASAR so Windows Registry DefaultIcon and shell tools can read them
  const targetBuildDir = path.join(appDir, 'resources', 'build');
  fs.mkdirSync(targetBuildDir, { recursive: true });
  for (const iconFile of ['icon.ico', 'icon.png']) {
    const srcIcon = path.join(rootDir, 'build', iconFile);
    if (fs.existsSync(srcIcon)) {
      fs.copyFileSync(srcIcon, path.join(targetBuildDir, iconFile));
    }
  }

  // Copy thumbnail provider tool (excluding third-party PDF24 DLLs and personal test files)
  const toolsDir = path.join(rootDir, 'tools', 'thumbnail-provider');
  const targetToolsDir = path.join(appDir, 'resources', 'tools', 'thumbnail-provider');
  if (fs.existsSync(toolsDir)) {
    fs.mkdirSync(targetToolsDir, { recursive: true });
    fs.cpSync(toolsDir, targetToolsDir, {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src);
        return !/^PdfThumbHandler.*\.dll$/i.test(name) && name !== 'test_pdf.cs';
      },
    });
    console.log(`Copied thumbnail provider tools to ${targetToolsDir}`);
  }

  // Patch XPDF Editor.exe PE icon & metadata with rcedit
  const rceditExe = path.join(rootDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const targetExe = path.join(appDir, 'XPDF Editor.exe');
  const icoFile = path.join(rootDir, 'build', 'icon.ico');
  if (fs.existsSync(rceditExe) && fs.existsSync(targetExe) && fs.existsSync(icoFile)) {
    try {
      execFileSync(
        rceditExe,
        [
          targetExe,
          '--set-icon', icoFile,
          '--set-file-version', pkgVersion,
          '--set-product-version', pkgVersion,
        ],
        { stdio: 'ignore' }
      );
      console.log('Successfully embedded custom multi-res icon into XPDF Editor.exe');
    } catch (e) {
      console.warn('rcedit warning:', e.message);
    }
  }

  // Create a 1-click Windows registry setup script in the output folder (safe env-var passing, zero escaping bugs)
  const setupBat = [
    '@echo off',
    'cd /d "%~dp0"',
    'echo ====================================================================',
    'echo  XPDF - Windows Varsayilan PDF ve Gezgin Entegrasyonu',
    'echo ====================================================================',
    'echo.',
    'set "XPDF_EXE=%~dp0XPDF Editor.exe"',
    'set "XPDF_ICON=%~dp0resources\\build\\icon.ico"',
    '',
    'echo [1/2] XPDF varsayilan PDF yoneticisi olarak kaydediliyor...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$progId = \'XPDF.PDFDocument\'; $exe = $env:XPDF_EXE; $icon = if (Test-Path $env:XPDF_ICON) { $env:XPDF_ICON } else { $exe }; $q = [char]34; New-Item -Path (\'HKCU:\\Software\\Classes\\\' + $progId + \'\\DefaultIcon\') -Force | Out-Null; New-Item -Path (\'HKCU:\\Software\\Classes\\\' + $progId + \'\\shell\\open\\command\') -Force | Out-Null; Set-ItemProperty -Path (\'HKCU:\\Software\\Classes\\\' + $progId) -Name \'(Default)\' -Value \'PDF Document\'; Set-ItemProperty -Path (\'HKCU:\\Software\\Classes\\\' + $progId + \'\\DefaultIcon\') -Name \'(Default)\' -Value ($icon + \',0\'); Set-ItemProperty -Path (\'HKCU:\\Software\\Classes\\\' + $progId + \'\\shell\\open\\command\') -Name \'(Default)\' -Value ($q + $exe + $q + \' \' + $q + \'%%1\' + $q); New-Item -Path \'HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids\' -Force | Out-Null; Set-ItemProperty -Path \'HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids\' -Name $progId -Value ([byte[]]@())"',
    '',
    'echo [2/2] Kucuk resim (Thumbnail) onizlemeleri kontrol ediliyor...',
    'if exist "%~dp0resources\\tools\\thumbnail-provider\\enable-thumbnails.bat" (',
    '  call "%~dp0resources\\tools\\thumbnail-provider\\enable-thumbnails.bat"',
    ')',
    '',
    'echo.',
    'echo ====================================================================',
    'echo  Tebrikler! XPDF artik tum PDF dosyalarinizla iliskilendirildi.',
    'echo ====================================================================',
    'pause',
    '',
  ].join('\r\n');

  fs.writeFileSync(path.join(appDir, 'Varsayilan-PDF-Yap-Ve-Onizlemeleri-Ac.bat'), setupBat, 'utf8');
  console.log(`Created 1-click installer batch file in ${appDir}`);
}

bundle().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
