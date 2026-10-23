// Agent hook → site office.
// Contract: print nothing, exit 0 quickly, send only the fields the scene needs.
import { serverInfo, post, startOffice, debug } from './common.mjs';

const TOP = ['hook_event_name', 'session_id', 'cwd', 'transcript_path', 'tool_name', 'tool_use_id', 'agent_type', 'is_interrupt'];
const INPUT = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'subagent_type', 'skill'];
const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'boolean' ? v : undefined);

function slim(raw) {
  const out = {};
  for (const k of TOP) {
    const v = cut(raw[k], 600);
    if (v !== undefined) out[k] = v;
  }
  if (raw.tool_input && typeof raw.tool_input === 'object') {
    out.tool_input = {};
    for (const k of INPUT) {
      const v = cut(raw.tool_input[k], 400);
      if (typeof v === 'string') out.tool_input[k] = v;
    }
  }
  return out;
}

function stdin(limitMs = 2500) {
  return new Promise((resolve) => {
    let text = '';
    const finish = () => resolve(text);
    const t = setTimeout(finish, limitMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      text += c;
      if (text.length > 4_000_000) finish();
    });
    process.stdin.on('end', () => {
      clearTimeout(t);
      finish();
    });
    process.stdin.on('error', finish);
  });
}

async function deliver(payload) {
  const info = serverInfo();
  if (info?.port) {
    try {
      if (await post(info.port, payload)) return;
    } catch (e) {
      debug(`post ${info.port}: ${e.message}`);
    }
  }
  const started = await startOffice(3500);
  if (started) {
    try {
      await post(started.port, payload);
    } catch (e) {
      debug(`retry ${started.port}: ${e.message}`);
    }
  }
}

try {
  const text = await stdin();
  if (text.trim() && !process.env.BUILDSITE_OFF) await deliver(slim(JSON.parse(text)));
} catch (e) {
  debug(`hook: ${e.message}`);
}
process.exit(0);
