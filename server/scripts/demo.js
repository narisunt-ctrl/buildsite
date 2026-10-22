// A made-up Claude Code session on repeat, so the site can be seen without Claude Code.
//   npm run demo            → http://127.0.0.1:4646/
//   npm run demo -- --once  → play the script once, then keep the page up
import { startServer } from '../src/server.js';

const port = Number(process.env.BUILDSITE_PORT) || 4646;
const office = await startServer({ preferredPort: port });
console.log(`demo site: ${office.url}  (Ctrl+C to stop)`);

const session = 'demo-session';
const cwd = '/projects/home-inspection-app';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;

async function send(o) {
  await fetch(`${office.url}event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: session, cwd, ...o }),
  });
}

async function tool(name, input, { ms = 900, fail = false } = {}) {
  const tool_use_id = `demo-${++id}`;
  await send({ hook_event_name: 'PreToolUse', tool_name: name, tool_use_id, tool_input: input });
  await pause(ms);
  await send({ hook_event_name: fail ? 'PostToolUseFailure' : 'PostToolUse', tool_name: name, tool_use_id, tool_input: input });
  await pause(250);
}

async function parallel(calls) {
  await Promise.all(calls.map(([name, input, opts], i) => pause(i * 150).then(() => tool(name, input, opts))));
}

const prompts = [
  async () => {
    await parallel([
      ['Glob', { pattern: 'src/**/*.ts' }],
      ['Read', { file_path: `${cwd}/README.md` }],
      ['Grep', { pattern: 'inspectionReport' }],
    ]);
    await tool('Read', { file_path: `${cwd}/src/report/cover.ts` });
    await pause(1600); // "planning"
    for (const f of ['cover.ts', 'defects.ts', 'photos.ts', 'summary.ts', 'sign.ts', 'pdf.ts']) await tool('Edit', { file_path: `${cwd}/src/report/${f}` }, { ms: 700 });
    await tool('Bash', { command: 'npm test' }, { ms: 1800, fail: true });
    await tool('Read', { file_path: `${cwd}/src/report/defects.ts` });
    await tool('Edit', { file_path: `${cwd}/src/report/defects.ts` });
    await tool('Bash', { command: 'npm test' }, { ms: 1800 });
  },
  async () => {
    await tool('WebSearch', { query: 'มาตรฐานตรวจรับบ้าน 2569' }, { ms: 1400 });
    await tool('Agent', { subagent_type: 'Explore', description: 'map the photo pipeline' }, { ms: 3500 });
    for (const f of ['upload.ts', 'resize.ts', 'exif.ts', 'gallery.tsx']) await tool('Write', { file_path: `${cwd}/src/photos/${f}` }, { ms: 650 });
    await tool('Bash', { command: 'npx tsc --noEmit' }, { ms: 1500 });
    await tool('Bash', { command: 'git status' }, { ms: 500 });
  },
];

const once = process.argv.includes('--once');
do {
  for (const run of prompts) {
    await send({ hook_event_name: 'UserPromptSubmit' });
    await pause(1200);
    await run();
    await pause(1500);
    await send({ hook_event_name: 'Stop' });
    await pause(3500);
  }
} while (!once);
