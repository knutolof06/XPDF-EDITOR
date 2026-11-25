const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;

  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;

  const rceditCandidates = [
    path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
    path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit.exe'),
  ];
  const rcedit = rceditCandidates.find((p) => fs.existsSync(p));
  const exe = path.join(appOutDir, 'XPDF Editor.exe');
  const ico = path.join(projectDir, 'build', 'icon.ico');

  if (!rcedit) {
    console.warn('afterPack: rcedit not found');
    return;
  }
  if (!fs.existsSync(exe)) {
    console.warn('afterPack: exe not found at', exe);
    return;
  }

  let pkgVersion = '1.5.7';
  let pkgDescription = 'XPDF - Profesyonel PDF Düzenleyici & Yöneticisi';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    if (pkg.version) pkgVersion = pkg.version;
    if (pkg.description) pkgDescription = pkg.description;
  } catch {
    // use defaults
  }

  const args = [
    exe,
    '--set-file-version', pkgVersion,
    '--set-product-version', pkgVersion,
    '--set-version-string', 'ProductName', 'XPDF Editor',
    '--set-version-string', 'FileDescription', pkgDescription,
    '--set-version-string', 'CompanyName', 'XPDF Team',
    '--set-version-string', 'OriginalFilename', 'XPDF Editor.exe',
    '--set-version-string', 'InternalName', 'XPDF Editor',
  ];

  if (fs.existsSync(ico)) {
    args.push('--set-icon', ico);
  } else {
    console.warn('afterPack: icon.ico not found');
  }

  try {
    execFileSync(rcedit, args, { stdio: 'inherit' });
    console.log('afterPack: Successfully embedded icon and PE metadata into', exe);
  } catch (e) {
    console.warn('afterPack: rcedit error:', e.message);
  }
};
