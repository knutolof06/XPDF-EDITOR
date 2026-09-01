const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  if (context.electronPlatformName !== 'win32') return;

  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;

  const rcedit = path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  const exe    = path.join(appOutDir, 'XPDF Editor.exe');
  const ico    = path.join(projectDir, 'build', 'icon.ico');

  if (!fs.existsSync(rcedit)) { console.warn('afterPack: rcedit not found'); return; }
  if (!fs.existsSync(exe))    { console.warn('afterPack: exe not found at', exe); return; }
  if (!fs.existsSync(ico))    { console.warn('afterPack: icon.ico not found'); return; }

  try {
    execSync(`"${rcedit}" "${exe}" --set-icon "${ico}"`, { stdio: 'inherit' });
    console.log('afterPack: Successfully embedded custom icon into', exe);
  } catch (e) {
    console.warn('afterPack: rcedit error:', e.message);
  }
};
