// Starts the site office if needed, prints its address, and opens it in the default browser.
import { spawn } from 'node:child_process';
import { startOffice } from './common.mjs';

const info = await startOffice(6000);
if (!info) {
  console.log('เปิดสำนักงานไซต์ไม่สำเร็จ — ลองรัน: node server/src/daemon.js เพื่อดูข้อผิดพลาด');
  process.exit(0);
}
console.log(`ไซต์ก่อสร้าง Buildsite: ${info.url}`);
if (!process.argv.includes('--no-browser')) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', info.url]] : process.platform === 'darwin' ? ['open', [info.url]] : ['xdg-open', [info.url]];
  try {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', () => {});
    c.unref();
  } catch {
    // printing the URL is enough
  }
}
