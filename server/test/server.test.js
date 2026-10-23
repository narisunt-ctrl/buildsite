import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../src/server.js';
import { loadRules } from '../src/trades.js';
import { transcriptAllowed, UsageReader } from '../src/usage.js';

// fetch() cannot forge the Host header, so raw requests use node:http.
function raw(port, { method = 'GET', pathName = '/health', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('server accepts events, rejects foreign hosts and origins, serves report', async () => {
  const s = await startServer({ rules: loadRules({ userFile: null }) });
  try {
    const base = `http://127.0.0.1:${s.port}`;
    assert.equal((await (await fetch(`${base}/health`)).json()).app, 'buildsite');

    const ev = (o) => fetch(`${base}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: 'p', cwd: '/tmp/site', ...o }) });
    assert.equal((await ev({ hook_event_name: 'UserPromptSubmit' })).status, 202);
    await ev({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'a', tool_input: { file_path: 'x' } });
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.current, 'p');
    assert.equal(state.projects.p.buildings[0].elements.length, 1);

    assert.equal((await raw(s.port, { headers: { Host: 'evil.example:80' } })).status, 421);
    const foreign = await raw(s.port, {
      method: 'POST',
      pathName: '/event',
      headers: { Host: `127.0.0.1:${s.port}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(foreign.status, 403);
    const form = await raw(s.port, { method: 'POST', pathName: '/event', headers: { Host: `127.0.0.1:${s.port}`, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(form.status, 415);
    assert.equal((await raw(s.port, { pathName: '/../src/server.js', headers: { Host: `127.0.0.1:${s.port}` } })).status, 404);

    const report = await fetch(`${base}/report?project=p`);
    assert.equal(report.status, 200);
    assert.match(await report.text(), /ใบตรวจรับงาน/);
  } finally {
    await s.close();
  }
});

test('only transcripts inside the agent config folder are read', () => {
  const env = { CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'cc') };
  assert.ok(transcriptAllowed(path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'a.jsonl'), env));
  assert.ok(!transcriptAllowed(path.join(env.CLAUDE_CONFIG_DIR, '..', 'etc.jsonl'), env));
  assert.ok(!transcriptAllowed(path.join(env.CLAUDE_CONFIG_DIR, 'x.txt'), env));
});

test('usage reader counts each message once and reads incrementally', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-'));
  const file = path.join(dir, 't.jsonl');
  const line = (id, out) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 10, output_tokens: out } } }) + '\n';
  fs.writeFileSync(file, line('m1', 1) + line('m1', 5));
  const r = new UsageReader(file);
  await r.poll();
  assert.deepEqual(r.total(), { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
  fs.appendFileSync(file, line('m2', 3));
  await r.poll();
  assert.equal(r.total().output, 8);
  assert.equal(r.total().input, 20);
});
