// Reads token usage from an agent session transcript (.jsonl), incrementally.
//
// The transcript format is not a public API, so parsing is defensive: unknown lines are skipped
// and, if nothing is found, totals stay null. A streamed assistant message can be written on several
// lines that share one message id; we keep the latest usage seen for each id, so nothing is counted twice.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const n = (v) => (Number.isFinite(v) ? v : 0);

export function readUsageLine(line) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  const msg = rec?.message;
  const u = msg?.usage;
  if (rec?.type !== 'assistant' || !u || typeof u !== 'object') return null;
  const id = msg.id ?? rec.requestId ?? rec.uuid;
  if (typeof id !== 'string') return null;
  return {
    id,
    usage: {
      input: n(u.input_tokens),
      output: n(u.output_tokens),
      cacheRead: n(u.cache_read_input_tokens),
      cacheWrite: n(u.cache_creation_input_tokens),
    },
  };
}

// The server may only read transcripts that live inside the agent's config folder.
export function transcriptAllowed(file, env = process.env) {
  if (typeof file !== 'string' || path.extname(file) !== '.jsonl') return false;
  const root = path.resolve(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const full = path.resolve(file);
  return full.startsWith(root + path.sep);
}

export function addUsage(a, b, sign = 1) {
  return {
    input: a.input + sign * b.input,
    output: a.output + sign * b.output,
    cacheRead: a.cacheRead + sign * b.cacheRead,
    cacheWrite: a.cacheWrite + sign * b.cacheWrite,
  };
}

export class UsageReader {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.rest = '';
    this.byId = new Map();
    this.seen = false;
  }

  total() {
    if (!this.seen) return null;
    let t = zero();
    for (const u of this.byId.values()) t = addUsage(t, u);
    return t;
  }

  // Reads what was appended since the last call. Returns true when the total changed.
  async poll() {
    let handle;
    try {
      handle = await fs.open(this.file, 'r');
      const { size } = await handle.stat();
      if (size < this.offset) {
        // File was replaced or truncated: start again.
        this.offset = 0;
        this.rest = '';
        this.byId.clear();
      }
      if (size === this.offset) return false;
      const len = Math.min(size - this.offset, 8 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, this.offset);
      this.offset += len;
      const lines = (this.rest + buf.toString('utf8')).split('\n');
      this.rest = lines.pop() ?? '';
      let changed = false;
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        const hit = readUsageLine(line);
        if (!hit) continue;
        this.byId.set(hit.id, hit.usage);
        this.seen = true;
        changed = true;
      }
      return changed;
    } catch {
      return false;
    } finally {
      await handle?.close();
    }
  }
}
