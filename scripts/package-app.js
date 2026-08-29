import packager from '@electron/packager';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function bundle() {
  console.log('Building standalone Windows Executable (.exe)...');

  // Verify dist exists
  const distIndex = path.join(rootDir, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('dist/index.html not found! Run npm run build first.');
  }

  const appPaths = await packager({
    dir: rootDir,
    name: 'XPDF Editor',
    platform: 'win32',
    arch: 'x64',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    out: path.join(rootDir, 'release'),
    overwrite: true,
    asar: false,
    prune: true,
    ignore: [
      /^\/\.git/,
      /^\/\.gemini/,
      /^\/release/,
      /\.md$/,
    ],
    win32metadata: {
      CompanyName: 'XPDF Team',
      FileDescription: 'XPDF Profesyonel PDF Düzenleyici & Yöneticisi',
      OriginalFilename: 'XPDF Editor.exe',
      ProductName: 'XPDF Editor',
      InternalName: 'XPDF Editor',
    },
  });

  const appDir = appPaths[0];
  console.log(`Packaging complete! Output directory: ${appDir}`);

  // Ensure dist is copied directly into resources/app/dist
  const srcDist = path.join(rootDir, 'dist');
  const targetDist = path.join(appDir, 'resources', 'app', 'dist');
  if (fs.existsSync(srcDist)) {
    fs.cpSync(srcDist, targetDist, { recursive: true });
    console.log(`Verified dist copied to ${targetDist}`);
  }

  // Ensure thumbnail provider tool is copied to appDir
  const toolsDir = path.join(rootDir, 'tools', 'thumbnail-provider');
  const targetToolsDir = path.join(appDir, 'tools', 'thumbnail-provider');
  if (fs.existsSync(toolsDir)) {
    fs.cpSync(toolsDir, targetToolsDir, { recursive: true });
    console.log(`Copied thumbnail provider to ${targetToolsDir}`);
  }

  // Create a 1-click Windows registry setup script in the output folder
  const setupBat = `@echo off
cd /d "%~dp0"
echo ====================================================================
echo  XPDF - Windows Varsayilan PDF ve Gezgin Entegrasyonu
echo ====================================================================
echo.
set "EXE=%~dp0XPDF Editor.exe"

echo [1/2] XPDF varsayilan PDF yoneticisi olarak kaydediliyor...
powershell -NoProfile -Command "
  \\$progId = 'XPDF.PDFDocument';
  \\$exe = '$EXE'.Replace('\\\\', '\\\\');
  New-Item -Path 'HKCU:\\Software\\Classes\\\\$progId' -Force | Out-Null;
  Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\\\$progId' -Name '(Default)' -Value 'PDF Document';
  New-Item -Path 'HKCU:\\Software\\Classes\\\\$progId\\DefaultIcon' -Force | Out-Null;
  Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\\\$progId\\DefaultIcon' -Name '(Default)' -Value \\\"$EXE,0\\\";
  New-Item -Path 'HKCU:\\Software\\Classes\\\\$progId\\shell\\open\\command' -Force | Out-Null;
  Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\\\$progId\\shell\\open\\command' -Name '(Default)' -Value \\\"\\\"\\\"$EXE\\\"\\\" \\\"\\\"%%1\\\"\\\"\\\";
  New-Item -Path 'HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids' -Force | Out-Null;
  Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids' -Name \\\"\\$progId\\\" -Value '';
"

echo [2/2] Kucuk resim (Thumbnail) onizlemeleri yukleniyor...
if exist "%~dp0tools\\thumbnail-provider\\enable-thumbnails.bat" (
  call "%~dp0tools\\thumbnail-provider\\enable-thumbnails.bat"
)

echo.
echo ====================================================================
echo  Tebrikler! XPDF artik tum PDF dosyalarinizla iliskilendirildi.
echo ====================================================================
pause
`;
  fs.writeFileSync(path.join(appDir, 'Varsayilan-PDF-Yap-Ve-Onizlemeleri-Ac.bat'), setupBat);
  console.log(`Created 1-click installer batch file in ${appDir}`);
}

bundle().then(() => {
  pushToGitHub();
}).catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});

function pushToGitHub() {
  const GIT = 'C:\\Program Files\\Git\\bin\\git.exe';
  if (!fs.existsSync(GIT)) {
    console.log('⚠️  Git bulunamadı, GitHub güncellemesi atlandı.');
    return;
  }

  try {
    console.log('\n📤 GitHub\'a yükleniyor...');
    const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    execSync(`"${GIT}" add -A`, { cwd: rootDir, stdio: 'inherit' });
    execSync(`"${GIT}" diff --cached --quiet || "${GIT}" commit -m "Otomatik güncelleme: ${now}"`, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });
    execSync(`"${GIT}" push origin main`, { cwd: rootDir, stdio: 'inherit' });
    console.log('✅ GitHub başarıyla güncellendi!');
  } catch (err) {
    console.warn('⚠️  GitHub push sırasında hata (yerel build etkilenmez):', err.message);
  }
}
