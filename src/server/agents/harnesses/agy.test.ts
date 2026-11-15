import { afterEach, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { testProcessCode } from '../../../test-process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { agyArgs, READ_ONLY_PERMISSIONS, agyLimit, createAgyRuntime, nativeTool, parseAgyModels } from './agy';
import { agyTranscriptLog } from './agyTasks';
import { finished, started } from './agyTasksFixture';
import { handleMcp, registerAgyTools, wireTools } from './agyMcp';
import { endSessionsHere } from './codexRpc';
import { environment, SessionRegistry, useSessionRegistry } from './sessionRegistry';
import type { AgentEvent, AgentSession, AgentSpec, AgentTool } from '../../runtime';
import { gitRepo, until } from '../../testing';
import { git } from '../../workstations';

const fake = join(import.meta.dir, '..', '..', 'fixtures', 'fake-agy.ts');
const launch = (_command: string, args: string[], options: Parameters<Parameters<typeof createAgyRuntime>[0] & {}>[2]) => spawn('bun', [fake, ...args], { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
const sessions: AgentSession[] = [];
const dirs: string[] = [];
afterEach(async () => { useSessionRegistry(undefined); for (const s of sessions.splice(0)) { s.close(); await s.done; } for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workstation() {
  const dir = mkdtempSync(join(tmpdir(), 'agy-'));
  dirs.push(dir);
  const repo = join(dir, 'repo');
  gitRepo(repo);
  return repo;
}
const spec = (cwd: string, events: AgentEvent[], extra: Partial<AgentSpec> = {}): AgentSpec => ({ cwd, system: 'SYSTEM', tools: [], onEvent: (e) => events.push(e), ...extra });
const start = (s: AgentSpec, first?: string) => {
  const session = createAgyRuntime(launch as never, () => '/fake/agy').start(s, first);
  sessions.push(session);
  return session;
};

test('flags: full auto inside the sandbox, read-only by permission rules, resume by conversation', () => {
  expect(agyArgs({})).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--dangerously-skip-permissions']);
  expect(agyArgs({ readOnly: true, resume: 'agy:abc', model: 'm', effort: 'high', dirs: ['/d'] })).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--settings', JSON.stringify({ permissions: READ_ONLY_PERMISSIONS }), '--add-dir', '/d', '--conversation', 'abc', '--model', 'm', '--effort', 'high']);
});

test('a session runs a turn, calls a Seismic tool over the MCP endpoint and ends idle', async () => {
  const repo = workstation();
  const events: AgentEvent[] = [];
  const asked: unknown[] = [];
  const ask: AgentTool = { name: 'ask', description: 'ask', schema: { question: z.string() }, run: (a) => { asked.push(a); return 'the answer'; } };
  const session = start(spec(repo, events, { tools: [ask], contextUpdate: () => 'NEWS', setting: { model: 'opus', effort: 'high', harness: 'agy', agy: { model: 'default', effort: 'high' } } }), 'CALL ask {"question":"why"}\nRUN ls -la');
  await until(() => events.some((e) => e.type === 'idle'));
  expect(asked).toEqual([{ question: 'why' }]);
  expect(events.find((e) => e.type === 'session')).toMatchObject({ id: 'agy:conv-1', setting: { harness: 'agy', agy: { model: 'default' } } });
  expect(events).toContainEqual({ type: 'tool', name: 'mcp__seismic__ask', input: { question: 'why' } });
  expect(events).toContainEqual({ type: 'tool', name: 'Bash', input: { command: 'ls -la' } });
  expect(events).toContainEqual({ type: 'toolDone', name: 'Bash', ok: true });
  // the endpoint's result carries what changed since, and Seismic's own tool is no native step
  expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toContain('ask -> the answer\n\nNEWS');
  expect(events.filter((e) => e.type === 'tool')).toHaveLength(2);
  // the system prompt goes with the first turn only
  session.send('hello');
  await until(() => events.filter((e) => e.type === 'idle').length === 2);
});

test('a second message waits for the turn, a failed turn reports the usage limit, resume names the conversation', async () => {
  const repo = workstation();
  const events: AgentEvent[] = [];
  const session = start(spec(repo, events, { resume: 'agy:old-conv' }), 'FAIL');
  session.send('next');
  await until(() => events.filter((e) => e.type === 'idle').length === 2);
  const error = events.find((e) => e.type === 'error');
  if (error?.type === 'error') expect(error.limit!.resetsAt!).toBeGreaterThan(Date.now() + 152 * 3_600_000);
  expect(error).toMatchObject({ message: readFileSync(join(import.meta.dir, '../../fixtures/agy-quota.txt'), 'utf8').trim(), limit: { resetsAt: expect.any(Number) } });
  expect(events.find((e) => e.type === 'session')).toMatchObject({ id: 'agy:old-conv' });
  expect(events.filter((e) => e.type === 'idle')[0]).toMatchObject({ more: true });
});

test('the MCP registration stays out of git and goes with the session', async () => {
  const repo = workstation();
  const events: AgentEvent[] = [];
  const session = start(spec(repo, events), 'hi');
  await until(() => events.some((e) => e.type === 'idle'));
  expect(existsSync(join(repo, '.agents', 'mcp_config.json'))).toBe(true);
  expect(git(repo, 'status', '--porcelain')).toBe('');
  session.close();
  await session.done;
  expect(existsSync(join(repo, '.agents', 'mcp_config.json'))).toBe(false);
});

test('the endpoint opens to the session token only', async () => {
  const endpoint = registerAgyTools({ tools: wireTools([]) });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect((await fetch(endpoint.url, { method: 'POST', body })).status).toBe(401);
  expect((await fetch(endpoint.url, { method: 'POST', body, headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  const ok = await fetch(endpoint.url, { method: 'POST', body, headers: { authorization: `Bearer ${endpoint.token}` } });
  expect((await ok.json() as { result: { tools: unknown[] } }).result.tools).toEqual([]);
  endpoint.dispose();
  expect((await fetch(endpoint.url, { method: 'POST', body, headers: { authorization: `Bearer ${endpoint.token}` } })).status).toBe(401);
});

test('tool calls validate arguments and report failures to the model', async () => {
  const t: AgentTool = { name: 'x', description: 'd', schema: { n: z.number() }, run: () => { throw new Error('boom'); } };
  const reg = { tools: wireTools([t]) };
  const call = (args: unknown) => handleMcp(reg, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'seismic_x', arguments: args } }) as Promise<{ result: { isError?: boolean; content: { text: string }[] } }>;
  expect((await call({ n: 'no' })).result.isError).toBe(true);
  expect((await call({ n: 1 })).result.content[0]!.text).toBe('boom');
  expect(await handleMcp(reg, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
});

test('unsupported cases fail visibly', () => {
  const repo = workstation();
  expect(() => start(spec('ssh://host/x', []))).toThrow('non-local');
  expect(() => start(spec(repo, [], { resume: 'codex:abc' }))).toThrow('agy: session');
  expect(() => start(spec(repo, [], { watch: {} as never }))).toThrow('before/after');
});

test('parsing: models, limits, native tools', () => {
  expect(parseAgyModels('Fetching available models...\n* gemini-pro (default)\n- gemini-flash\n').map((m) => [m.model, m.isDefault])).toEqual([['gemini-pro', true], ['gemini-flash', false]]);
  expect(agyLimit('RESOURCE_EXHAUSTED: retry in 2 hours', 0)).toEqual({ resetsAt: 7_200_000 });
  expect(agyLimit('boom')).toBeUndefined();
  expect(nativeTool('write_to_file', { path: 'a' }).name).toBe('Edit');
});

test('real account-quota capture reads the entire reset duration', () => {
  const message = readFileSync(join(import.meta.dir, '../../fixtures/agy-quota.txt'), 'utf8').trim();
  const now = Date.UTC(2026, 10, 7, 16, 3, 35, 868);
  expect(agyLimit(message, now)).toEqual({ resetsAt: now + (152 * 3600 + 12 * 60 + 37) * 1000 });
  for (const [duration, ms] of [['145h5m46s', 522346000], ['1h2m3s', 3723000], ['12m37s', 757000], ['0s', 0], ['1.5s', 1500]] as const) {
    expect(agyLimit(`Quota reached. Resets in ${duration}.`, now)).toEqual({ resetsAt: now + ms });
  }
  expect(agyLimit('Quota exceeded. Retry in 30s.', now)).toEqual({ resetsAt: now + 30000 });
  expect(agyLimit('Quota exceeded. Try again in 2 hours 3 minutes.', now)).toEqual({ resetsAt: now + 7380000 });
  expect(agyLimit('Quota reached.', now)).toEqual({});
  expect(agyLimit('Quota reached. Resets in unknown.', now)).toEqual({});
  expect(agyLimit('Quota reached. Resets in 2hgarbage.', now)).toEqual({});
  expect(agyLimit('Network unavailable. Retry in 30s.', now)).toBeUndefined();
});

test('a reset or retry duration must parse completely, not just its valid prefix', () => {
  for (const marker of ['Resets in', 'Reset in', 'Retry in', 'Retry after', 'Try again in', 'Try again after']) {
    for (const duration of ['2h 3days', '2h3days', '2h 3', '2h garbage', '2h\n3days', '2h, 3days', '2h 3ms', '2h 0.5days', '2h3m junk', '1.5s garbage']) {
      expect(agyLimit(`Quota reached. ${marker} ${duration}.`, 0)).toEqual({});
      expect(agyLimit(`Quota reached. ${marker} ${duration}`, 0)).toEqual({});
    }
    expect(agyLimit(`Quota reached. ${marker} 2h 3m. Please wait.`, 0)).toEqual({ resetsAt: 7380000 });
    expect(agyLimit(`Quota reached. ${marker} 1.5s.`, 0)).toEqual({ resetsAt: 1500 });
  }
});

const recording = !!environment();
const registry = () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-registry-'));
  dirs.push(root);
  useSessionRegistry(new SessionRegistry(root));
  const records = () => readdirSync(root).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, f), 'utf8')) as { processes: { pid: number }[] });
  return { root, records };
};

test.skipIf(!recording)('the first turn goes to agy only once its identity is on record', async () => {
  const { records } = registry();
  const events: AgentEvent[] = [];
  let pid = 0;
  let recordedAtFirstText: number[] | undefined;
  const session = createAgyRuntime((c, a, o) => { const child = launch(c, a, o); pid = child.pid!; return child; }, () => '/fake/agy').start(spec(workstation(), events, {
    onEvent: (e) => { events.push(e); if (e.type === 'text' && !recordedAtFirstText) recordedAtFirstText = records().flatMap((r) => r.processes.map((p) => p.pid)); },
  }), 'hi');
  sessions.push(session);
  await until(() => events.some((e) => e.type === 'idle'));
  expect(recordedAtFirstText).toContain(pid);
  // an orderly end takes the record away, and the server's shutdown waits for it
  let settled = false;
  void session.done.then(() => { settled = true; });
  await endSessionsHere();
  expect(settled).toBe(true);
  expect(records()).toEqual([]);
});

test.skipIf(!recording)('an agy whose processes cannot be watched ends before any turn', async () => {
  const { records } = registry();
  // agy as Seismic would see a process it did not start: its ownership cannot be established
  const orphan = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});console.log(c.pid);c.unref();`;
  const stranger = { pid: Number(spawnSync(process.execPath, ['-e', orphan], { encoding: 'utf8' }).stdout.trim()), kill: (s: NodeJS.Signals) => { try { process.kill(stranger.pid, s); } catch { /* gone */ } } };
  const events: AgentEvent[] = [];
  const session = createAgyRuntime((c, a, o) => {
    const child = launch(c, a, o);
    child.once('exit', () => stranger.kill('SIGKILL'));
    const wrapper = Object.create(child) as typeof child;
    Object.defineProperty(wrapper, 'pid', { value: stranger.pid });
    return wrapper;
  }, () => '/fake/agy').start(spec(workstation(), events), 'hi');
  sessions.push(session);
  await session.done;
  expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('could not be put on record'), ended: true });
  expect(events.some((e) => e.type === 'text')).toBe(false);
  // no turn went out, so nothing it could have started is owed to a sweep
  expect(records()).toEqual([]);
});

/** An agy stand-in from a script: `code` runs with `turn(n)` called on each user frame, after which the turn ends. */
const scripted = (code: string) => (_c: string, _a: string[], o: Parameters<Parameters<typeof createAgyRuntime>[0] & {}>[2]) => spawn(process.execPath, ['-e', testProcessCode(`
  const { spawn } = require('node:child_process');
  let n = 0;
  ${code}
  process.stdin.on('data', () => { turn(++n); process.stdout.write(JSON.stringify({ event: 'result', result: { status: 'SUCCESS' } }) + '\\n'); });
  process.stdin.on('end', () => process.exit(0));
  setInterval(() => {}, 1000);`)], { ...o, stdio: ['pipe', 'pipe', 'pipe'] });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test.skipIf(!recording)('a command that can no longer be put on record ends the session, and the command with it', async () => {
  const { root, records } = registry();
  const leafFile = join(root, '..', `leaf-${process.pid}`);
  const events: AgentEvent[] = [];
  // the second turn starts a command once the registry has stopped taking writes
  const session = createAgyRuntime(scripted(`const turn = (n) => { if (n === 2) { const c = spawn(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(leafFile)}, String(c.pid)); } };`), () => '/fake/agy').start(spec(workstation(), events), 'one');
  sessions.push(session);
  await until(() => events.some((e) => e.type === 'idle'));
  chmodSync(root, 0o500);
  try {
    session.send('two');
    await session.done;
  } finally { chmodSync(root, 0o700); }
  expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('could not be put on record'), ended: true });
  await until(() => !alive(Number(readFileSync(leafFile, 'utf8'))));
  expect(records()).toHaveLength(1);
});

test.skipIf(!recording)('a command agy left holding its pipes does not hold up the end of the session', async () => {
  registry();
  const leafFile = join(mkdtempSync(join(tmpdir(), 'agy-leaf-')), 'leaf');
  dirs.push(join(leafFile, '..'));
  const events: AgentEvent[] = [];
  // detached into a group of its own and holding agy's output, it is gone from agy's tree once agy exits
  const session = createAgyRuntime(scripted(`const turn = () => { const c = spawn(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); require('node:fs').writeFileSync(${JSON.stringify(leafFile)}, String(c.pid)); process.exit(0); };`), () => '/fake/agy').start(spec(workstation(), events), 'one');
  sessions.push(session);
  try {
    const started = Date.now();
    await session.done;
    expect(Date.now() - started).toBeLessThan(4500);
  } finally { try { process.kill(Number(readFileSync(leafFile, 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
});

test('background tasks in agy\'s transcript show on the card, and one ending between turns wakes the session', async () => {
  const repo = workstation();
  const brain = join(dirname(repo), 'brain');
  const events: AgentEvent[] = [];
  const session = createAgyRuntime(launch as never, () => '/fake/agy', () => brain).start(spec(repo, events), 'hello');
  sessions.push(session);
  await until(() => events.some((e) => e.type === 'idle'));
  const log = agyTranscriptLog(brain, 'conv-1');
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(log, `${started('conv-1/task-2', 'bun run build')}\n`);
  await until(() => events.some((e) => e.type === 'background' && e.tasks.length === 1));
  expect(events).toContainEqual({ type: 'background', tasks: [{ id: 'conv-1/task-2', description: 'bun run build' }] });
  expect(events.at(-1)).toEqual({ type: 'idle', background: 1, more: false });
  appendFileSync(log, `${finished('conv-1/task-2')}\n`);
  await until(() => events.filter((e) => e.type === 'idle').length >= 4);
  expect(events).toContainEqual({ type: 'background', tasks: [] });
  expect(events).toContainEqual({ type: 'idle', background: 0, more: true });
});

test.each([true, false])('resume captures history before launching agy (existing transcript: %s)', async (history) => {
  const repo = workstation();
  const brain = join(dirname(repo), 'brain');
  const log = agyTranscriptLog(brain, 'old-conv');
  mkdirSync(dirname(log), { recursive: true });
  if (history) appendFileSync(log, `${started('old-conv/task-1', 'old task')}\n`);
  const events: AgentEvent[] = [];
  // The resumed process may write before init is received or the first watcher tick runs.
  const resumeLaunch: typeof launch = (command, args, options) => {
    appendFileSync(log, `${started('old-conv/task-2', 'new task')}\n`);
    return launch(command, args, options);
  };
  const session = createAgyRuntime(resumeLaunch, () => '/fake/agy', () => brain).start(spec(repo, events, { resume: 'agy:old-conv' }), 'hello');
  sessions.push(session);
  await until(() => events.some((e) => e.type === 'idle'));
  expect(events).toContainEqual({ type: 'background', tasks: [{ id: 'old-conv/task-2', description: 'new task' }] });
  expect(events.filter((e) => e.type === 'idle').at(-1)).toMatchObject({ background: 1 });
  appendFileSync(log, `${finished('old-conv/task-2')}\n`);
  await until(() => events.filter((e) => e.type === 'idle').length >= 3);
  expect(events).toContainEqual({ type: 'idle', background: 0, more: true });
  expect(events).toContainEqual({ type: 'background', tasks: [] });
});

test.each(['echo café 日本語 🚀', 'for name in café 日本語; do\n  echo "$name 🚀"\ndone', "cat <<'EOF'\ncafé 日本語 🚀\nTask logs are available at: file:///quoted.log\nYOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS\nEOF\necho done"])('task description reaches the card and completion prompt intact: %s', async (description) => {
  const repo = workstation();
  const brain = join(dirname(repo), 'brain');
  const log = agyTranscriptLog(brain, 'old-conv');
  const inbox = join(dirname(repo), 'inbox.jsonl');
  mkdirSync(dirname(log), { recursive: true });
  const events: AgentEvent[] = [];
  const session = createAgyRuntime(scripted(`
    const fs = require('node:fs');
    process.stdin.on('data', (chunk) => fs.appendFileSync(${JSON.stringify(inbox)}, chunk));
    const turn = (n) => { if (n === 1) fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${started('old-conv/task-2', description)}\n`)}); };
  `), () => '/fake/agy', () => brain).start(spec(repo, events, { resume: 'agy:old-conv' }), 'hello');
  sessions.push(session);
  await until(() => events.some((e) => e.type === 'idle'));
  expect(events).toContainEqual({ type: 'background', tasks: [{ id: 'old-conv/task-2', description }] });
  appendFileSync(log, `${finished('old-conv/task-2')}\n`);
  await until(() => readFileSync(inbox, 'utf8').split('\n').filter(Boolean).length === 2);
  const wake = JSON.parse(readFileSync(inbox, 'utf8').trim().split('\n')[1]!);
  expect(wake.message.content).toBe(`Background commands have ended: ${description}. Inspect their results and continue your task.`);
});
