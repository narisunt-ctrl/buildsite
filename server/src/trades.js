// Trade rules: which crew on the site handles which agent tool.
// Rules live in config/trades.json and can be overridden by ~/.buildsite/trades.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_FILE = path.join(here, '..', 'config', 'trades.json');
export const USER_CONFIG_FILE = path.join(os.homedir(), '.buildsite', 'trades.json');

export const TRADE_IDS = ['survey', 'build', 'qc', 'sub'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Turns raw JSON into a checked rule book. Bad rules are dropped one by one, never the whole file.
export function compileRules(raw) {
  const trades = {};
  for (const id of TRADE_IDS) {
    const t = raw?.trades?.[id] ?? {};
    trades[id] = { label: String(t.label ?? id), color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888' };
  }
  const rules = [];
  for (const r of Array.isArray(raw?.rules) ? raw.rules : []) {
    if (!TRADE_IDS.includes(r?.trade)) continue;
    let commandMatch = null;
    if (typeof r.commandMatch === 'string') {
      try {
        commandMatch = new RegExp(r.commandMatch, 'i');
      } catch {
        continue;
      }
    }
    const tools = Array.isArray(r.tool) ? r.tool.map(String) : typeof r.tool === 'string' ? [r.tool] : null;
    const prefix = typeof r.toolPrefix === 'string' ? r.toolPrefix : null;
    if (!tools && !prefix) continue;
    rules.push({ tools, prefix, commandMatch, trade: r.trade, verb: String(r.verb ?? r.trade) });
  }
  const fb = raw?.fallback;
  const fallback = { trade: TRADE_IDS.includes(fb?.trade) ? fb.trade : 'build', verb: String(fb?.verb ?? 'งานทั่วไป') };
  return { trades, rules, fallback };
}

export function loadRules({ userFile = USER_CONFIG_FILE } = {}) {
  const user = userFile ? readJson(userFile) : null;
  return compileRules(user ?? readJson(DEFAULT_CONFIG_FILE));
}

export function classify(book, tool, command = '') {
  if (!tool) return { ...book.fallback };
  for (const rule of book.rules) {
    const toolOk = (rule.tools && rule.tools.includes(tool)) || (rule.prefix && tool.startsWith(rule.prefix));
    if (!toolOk) continue;
    if (rule.commandMatch && !rule.commandMatch.test(command ?? '')) continue;
    return { trade: rule.trade, verb: rule.verb };
  }
  return { ...book.fallback };
}
