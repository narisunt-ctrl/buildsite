import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, classify, loadRules } from '../src/trades.js';
import { intake } from '../src/intake.js';
import { createSite, apply, publicView, expireStale, LIMITS } from '../src/site.js';
import { readUsageLine } from '../src/usage.js';
import { renderReport } from '../src/report.js';

const rules = loadRules({ userFile: null });
const hook = (o) => intake({ session_id: 's1', cwd: '/work/my-app', ...o });

test('tools map to trades', () => {
  assert.equal(classify(rules, 'Read').trade, 'survey');
  assert.equal(classify(rules, 'mcp__github__search').trade, 'survey');
  assert.equal(classify(rules, 'Edit').trade, 'build');
  assert.equal(classify(rules, 'Bash', 'npm test').trade, 'qc');
  assert.equal(classify(rules, 'Bash', 'ls -la').trade, 'build');
  assert.equal(classify(rules, 'Agent').trade, 'sub');
  assert.equal(classify(rules, 'SomethingNew').trade, 'build');
});

test('bad rules are dropped, good ones kept', () => {
  const book = compileRules({ rules: [{ tool: 'X', trade: 'nope' }, { tool: 'Y', commandMatch: '(', trade: 'qc' }, { tool: 'Z', trade: 'qc' }] });
  assert.equal(book.rules.length, 1);
  assert.equal(classify(book, 'Z').trade, 'qc');
});

test('intake keeps only whitelisted fields', () => {
  const ev = intake({
    hook_event_name: 'PreToolUse',
    session_id: 's',
    tool_name: 'Write',
    tool_use_id: 't1',
    prompt: 'secret prompt',
    tool_input: { file_path: '/a/b/c/secret.txt', content: 'SECRET CONTENT' },
  });
  assert.equal(ev.target, 'c/secret.txt');
  assert.ok(!JSON.stringify(ev).includes('SECRET'));
  assert.ok(!JSON.stringify(ev).includes('secret prompt'));
  assert.equal(intake({ hook_event_name: 'Nope' }), null);
});

test('a prompt raises a building, tool calls add elements, Stop hands it over', () => {
  const site = createSite();
  apply(site, hook({ hook_event_name: 'UserPromptSubmit' }), rules, 1000);
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'a', tool_input: { file_path: '/x/README.md' } }), rules, 1100);
  let p = site.projects.s1;
  assert.equal(p.name, 'my-app');
  assert.equal(p.crew.survey.busy, 1);
  apply(site, hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'a', tool_input: { file_path: '/x/README.md' } }), rules, 1200);
  p = site.projects.s1;
  assert.equal(p.crew.survey.busy, 0);
  assert.equal(p.buildings[0].elements[0].status, 'done');
  apply(site, hook({ hook_event_name: 'Stop' }), rules, 1300);
  assert.equal(p.buildings[0].status, 'handover');
  apply(site, hook({ hook_event_name: 'UserPromptSubmit' }), rules, 1400);
  assert.equal(p.buildings.length, 2);
  assert.equal(p.buildings[1].no, 2);
});

test('a failure becomes a defect and a later success on the same target repairs it', () => {
  const site = createSite();
  const cmd = { command: 'npm test' };
  apply(site, hook({ hook_event_name: 'UserPromptSubmit' }), rules);
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: '1', tool_input: cmd }), rules);
  apply(site, hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: '1', tool_input: cmd }), rules);
  const b = site.projects.s1.buildings[0];
  assert.equal(b.elements[0].status, 'defect');
  assert.equal(b.elements[0].trade, 'qc');
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: '2', tool_input: cmd }), rules);
  apply(site, hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: '2', tool_input: cmd }), rules);
  assert.equal(b.elements[0].status, 'repaired');
  assert.deepEqual(b.elements[0].repairedBy, { building: 1, element: 2 });
});

test('overlapping calls of one trade are paired by tool_use_id', () => {
  const site = createSite();
  apply(site, hook({ hook_event_name: 'UserPromptSubmit' }), rules);
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: 'a' } }), rules);
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r2', tool_input: { file_path: 'b' } }), rules);
  apply(site, hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'r2', tool_input: { file_path: 'b' } }), rules);
  const b = site.projects.s1.buildings[0];
  assert.equal(b.elements[0].status, 'active');
  assert.equal(b.elements[1].status, 'done');
  assert.equal(site.projects.s1.crew.survey.busy, 1);
});

test('work without a prompt still opens a building; stale calls are closed', () => {
  const site = createSite();
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e', tool_input: { file_path: 'x.js' } }), rules, 0);
  const b = site.projects.s1.buildings[0];
  assert.equal(b.opened, 'resume');
  assert.ok(expireStale(site, LIMITS.staleMs + 1));
  assert.equal(b.elements[0].status, 'done');
  assert.equal(b.elements[0].stale, true);
});

test('public view hides matching keys and tool ids', () => {
  const site = createSite();
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 'w', tool_input: { file_path: '/home/me/private/x.js' } }), rules);
  const text = JSON.stringify(publicView(site));
  assert.ok(!text.includes('/home/me/private'));
  assert.ok(!text.includes('"toolUseId"'));
});

test('usage lines are parsed defensively', () => {
  assert.equal(readUsageLine('not json'), null);
  assert.equal(readUsageLine(JSON.stringify({ type: 'user' })), null);
  const hit = readUsageLine(JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 5, output_tokens: 7 } } }));
  assert.deepEqual(hit, { id: 'm1', usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0 } });
});

test('report escapes HTML from targets', () => {
  const site = createSite();
  apply(site, hook({ hook_event_name: 'UserPromptSubmit' }), rules);
  apply(site, hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'echo <script>alert(1)</script>' } }), rules);
  apply(site, hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'echo <script>alert(1)</script>' } }), rules);
  const view = publicView(site).projects.s1;
  const html = renderReport(view, rules.trades);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('ข้อบกพร่อง'));
});
