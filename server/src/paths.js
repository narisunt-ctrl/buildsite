import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = process.env.BUILDSITE_HOME || path.join(os.homedir(), '.buildsite');
export const INFO_FILE = path.join(HOME_DIR, 'server.json');
export const LOCK_DIR = path.join(HOME_DIR, 'start.lock');
export const LOG_FILE = path.join(HOME_DIR, 'hook.log');
