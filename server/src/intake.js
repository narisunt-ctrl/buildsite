// Turns the JSON an agent hook receives into a small site event.
// Only whitelisted fields survive. Prompts, file contents, tool output and error text are never kept.

const KINDS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'Stop', 'SessionEnd']);

const str = (v, max) => (typeof v === 'string' && v.length ? v.slice(0, max) : undefined);
const oneLine = (v, max) => {
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function tail(p, parts = 2) {
  return String(p).split(/[\\/]+/).filter(Boolean).slice(-parts).join('/');
}

function urlLabel(u) {
  try {
    const url = new URL(u);
    return oneLine(url.host + url.pathname, 60);
  } catch {
    return oneLine(u, 60);
  }
}

// A short label for the speech bubble, and a longer key used to match a fix to an earlier failure.
export function describe(tool, input) {
  if (!input || typeof input !== 'object') return { target: null, key: tool ?? '' };
  if (typeof input.command === 'string') {
    const cmd = oneLine(input.command, 200);
    return { target: oneLine(cmd, 70), key: `${tool}:${cmd}`, command: cmd };
  }
  const file = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof file === 'string') return { target: tail(file), key: `file:${String(file).slice(0, 400)}` };
  if (typeof input.url === 'string') return { target: urlLabel(input.url), key: `${tool}:${input.url.slice(0, 300)}` };
  for (const field of ['pattern', 'query', 'description', 'skill']) {
    if (typeof input[field] === 'string') return { target: oneLine(input[field], 60), key: `${tool}:${oneLine(input[field], 200)}` };
  }
  return { target: null, key: tool ?? '' };
}

export function intake(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.hook_event_name;
  if (!KINDS.has(kind)) return null;
  const ev = { kind, session: str(raw.session_id, 120) ?? 'default' };
  const cwd = str(raw.cwd, 600);
  if (cwd) ev.cwd = cwd;
  const transcript = str(raw.transcript_path, 600);
  if (transcript) ev.transcript = transcript;

  if (kind === 'PreToolUse' || kind === 'PostToolUse' || kind === 'PostToolUseFailure') {
    ev.tool = str(raw.tool_name, 120) ?? 'unknown';
    const id = str(raw.tool_use_id, 120);
    if (id) ev.toolUseId = id;
    const input = raw.tool_input && typeof raw.tool_input === 'object' ? raw.tool_input : {};
    Object.assign(ev, describe(ev.tool, input));
    if (typeof input.subagent_type === 'string') ev.agentType = oneLine(input.subagent_type, 60);
    if (kind === 'PostToolUseFailure' && raw.is_interrupt === true) ev.interrupted = true;
  }
  if (kind === 'SubagentStop') {
    const type = str(raw.agent_type, 60);
    if (type) ev.agentType = type;
  }
  return ev;
}
