import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execTools, gitRefusal, placeFor, type ExecLane } from './exec-tools';
import type { PermissionRequest } from './runtime';
import { gitRepo } from './testing';

let root: string;
let workspace: string;
let asked: PermissionRequest[];
let answer: { allow: true } | { allow: false; message: string };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'obeya-exec-')));
  workspace = join(root, 'ws');
  gitRepo(workspace);
  asked = [];
  answer = { allow: true };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lane = (rules: string[] = [], places: string[] = []): ExecLane => ({
  workspace,
  places: () => places,
  rules: () => rules,
  ask: async (r) => (asked.push(r), answer),
});
const tool = (l: ExecLane, name: string) => execTools(l).find((t) => t.name === name)!;
const run = (l: ExecLane, args: Record<string, unknown>) => Promise.resolve(tool(l, 'run').run(args));
const git = (l: ExecLane, ...args: string[]) => Promise.resolve(tool(l, 'git').run({ args }));

test('a command the allow list covers runs without asking, in the workspace', async () => {
  const out = await run(lane(['pwd']), { command: 'pwd' });
  expect(out).toContain('exit code 0');
  expect(out).toContain(workspace);
  expect(asked).toEqual([]);
});

test('a chain of covered commands runs without asking', async () => {
  const out = await run(lane(['echo *']), { command: 'echo a && echo b' });
  expect(out).toContain('a\nb');
  expect(asked).toEqual([]);
});

test('a command the list does not cover asks the owner and runs on yes', async () => {
  const out = await run(lane(['echo *']), { command: 'echo a && uname', reason: 'to see the system' });
  expect(asked).toEqual([{ name: 'Bash', input: { command: 'echo a && uname' }, reason: 'to see the system' }]);
  expect(out).toContain('exit code 0');
});

test("with Codex's automatic review, a command the list does not cover is not asked but sent to the worker's own shell", async () => {
  const auto = { ...lane(['pwd']), auto: true };
  expect(await run(auto, { command: 'touch made' })).toContain('request escalated permissions');
  expect(asked).toEqual([]);
  expect(await run(auto, { command: 'pwd' })).toContain('exit code 0');
});

test('a declined command does not run', async () => {
  answer = { allow: false, message: 'No, not that.' };
  const out = await run(lane(), { command: `touch ${join(workspace, 'made')}` });
  expect(out).toBe('Not run: No, not that.');
  expect(await Bun.file(join(workspace, 'made')).exists()).toBe(false);
});

test('a pipe is never covered by a rule for its first command', async () => {
  answer = { allow: false, message: 'declined' };
  await run(lane(['echo *']), { command: 'echo a | cat' });
  expect(asked).toHaveLength(1);
});

test('cwd: the workspace, its subdirectories, the places named; nothing else', async () => {
  const demos = join(root, 'demos');
  mkdirSync(demos);
  mkdirSync(join(workspace, 'sub'));
  const outside = join(root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(workspace, 'link'));
  const l = lane([], [demos]);
  expect(placeFor(l, undefined)).toBe(workspace);
  expect(placeFor(l, 'sub')).toBe(join(workspace, 'sub'));
  expect(placeFor(l, demos)).toBe(demos);
  expect(placeFor(l, outside)).toBeNull();
  expect(placeFor(l, '..')).toBeNull();
  expect(placeFor(l, 'link')).toBeNull();
  expect(placeFor(l, 'missing')).toBeNull();
  expect(await run(l, { command: 'pwd', cwd: outside })).toStartWith('Not run: cwd');
  expect(asked).toEqual([]);
});

test('a command that outlives its timeout is ended with what it started', async () => {
  const started = Date.now();
  const marker = join(root, 'child-lived');
  const out = await run(lane(['*']), { command: `(sleep 3; touch ${marker}) & sleep 30`, timeout_seconds: 1 });
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(out).toContain('stopped after 1 seconds');
  await Bun.sleep(3500);
  expect(await Bun.file(marker).exists()).toBe(false);
}, 20_000);

test('long output keeps its start and end', async () => {
  const out = await run(lane(['*']), { command: 'seq 1 20000' });
  expect(out).toContain('characters left out');
  expect(out).toContain('\n1\n');
  expect(out).toContain('\n20000');
});

test('the command has no stdin and the environment of Seismic without a Claude session', async () => {
  process.env.CLAUDE_CODE_TEST_MARK = 'x';
  try {
    const out = await run(lane(['*']), { command: 'cat; echo "[${CLAUDE_CODE_TEST_MARK-unset}]"' });
    expect(out).toContain('[unset]');
  } finally {
    delete process.env.CLAUDE_CODE_TEST_MARK;
  }
});

test('git commits in the workspace without asking', async () => {
  writeFileSync(join(workspace, 'a.txt'), 'a\n');
  expect(await git(lane(), 'add', 'a.txt')).toContain('exit code 0');
  expect(await git(lane(), 'commit', '-m', 'Add a')).toContain('exit code 0');
  expect(await git(lane(), 'log', '--oneline')).toContain('Add a');
  expect(asked).toEqual([]);
});

test('git refuses what reaches a remote, git’s settings or another directory', () => {
  for (const args of [['push'], ['remote', 'add', 'x', 'y'], ['config', 'user.name', 'x'], ['-c', 'core.pager=x', 'log'], ['--git-dir=/x', 'log'], ['clean', '-fd'], ['rebase', '-x', 'touch x', 'main'], ['rebase', '--exec=sh', 'main'], ['diff', '--output=/tmp/x'], ['log', '--work-tree=/x'], []]) {
    expect(gitRefusal(args)).not.toBeNull();
  }
  for (const args of [['status'], ['commit', '-m', 'x'], ['rebase', 'main'], ['rebase', '--continue'], ['reset', '--hard', 'HEAD'], ['checkout', '-b', 'x'], ['stash', 'pop']]) {
    expect(gitRefusal(args)).toBeNull();
  }
});

test('a refused git call does not run', async () => {
  expect(await git(lane(), 'push')).toStartWith('Not run:');
});
