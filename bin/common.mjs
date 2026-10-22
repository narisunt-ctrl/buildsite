// Shared by hook.mjs and open.mjs: find the site office server, or start it in the background.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME_DIR, INFO_FILE, LOG_FILE } from '../server/src/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.resolve(here, '..', 'server', 'src', 'daemon.js');

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function serverInfo() {
  try {
    return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export async function isUp(port, ms = 500) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(ms) });
    return (await r.json()).app === 'buildsite';
  } catch {
    return false;
  }
}

export async function post(port, body, ms = 900) {
  const r = await fetch(`http://127.0.0.1:${port}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  return r.status < 300;
}

export async function startOffice(timeoutMs = 4000) {
  let info = serverInfo();
  if (info?.port && (await isUp(info.port))) return info;
  const child = spawn(process.execPath, [DAEMON], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await wait(120);
    info = serverInfo();
    if (info?.port && (await isUp(info.port, 300))) return info;
  }
  return null;
}

// Silent unless BUILDSITE_DEBUG is set. A hook must never print or fail because of logging.
export function debug(msg) {
  if (!process.env.BUILDSITE_DEBUG) return;
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // ignore
  }
}
