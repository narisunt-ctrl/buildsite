// Background site office: one server per machine, shared by every Claude Code session.
// Started on demand by bin/hook.mjs or bin/open.mjs. Writes its address to ~/.buildsite/server.json
// and leaves by itself after an idle hour (no events, no open page).
import fs from 'node:fs';
import { startServer, APP_ID } from './server.js';
import { HOME_DIR, INFO_FILE, LOCK_DIR } from './paths.js';

const PREFERRED_PORT = Number(process.env.BUILDSITE_PORT) || 4646;
const IDLE_MS = 60 * 60 * 1000;
const LOCK_MAX_AGE_MS = 20000;

fs.mkdirSync(HOME_DIR, { recursive: true });

const readInfo = () => {
  try {
    return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
  } catch {
    return null;
  }
};

async function alive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(700) });
    return (await r.json()).app === APP_ID;
  } catch {
    return false;
  }
}

// mkdir is atomic on every platform, so it works as a lock without extra packages.
function lock() {
  try {
    fs.mkdirSync(LOCK_DIR);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') return false;
    try {
      if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > LOCK_MAX_AGE_MS) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        fs.mkdirSync(LOCK_DIR);
        return true;
      }
    } catch {
      // someone else won the race
    }
    return false;
  }
}
const unlock = () => fs.rmSync(LOCK_DIR, { recursive: true, force: true });

const info = readInfo();
if (info?.port && (await alive(info.port))) process.exit(0);
if (!lock()) process.exit(0);

let office;
let leaving = false;
async function leave() {
  if (leaving) return;
  leaving = true;
  try {
    if (readInfo()?.pid === process.pid) fs.rmSync(INFO_FILE, { force: true });
    await office?.close();
  } finally {
    unlock();
    process.exit(0);
  }
}

try {
  office = await startServer({ preferredPort: PREFERRED_PORT, idleMs: IDLE_MS, onIdle: leave });
  fs.writeFileSync(INFO_FILE, JSON.stringify({ pid: process.pid, port: office.port, url: office.url, since: Date.now() }));
} catch {
  unlock();
  process.exit(1);
}
unlock();

process.on('SIGINT', leave);
process.on('SIGTERM', leave);
