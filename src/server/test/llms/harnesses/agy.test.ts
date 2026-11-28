import { afterEach, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturesDir, serverDir } from '../../helpers/paths';
import { z } from 'zod';
import { testProcessCode } from '../../../../test-process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { agyArgs, agyRun, endProcessTree, READ_ONLY_PERMISSIONS, agyLimit, agyUsage, agyUsageOf, createAgyRuntime, nativeTool, parseAgyModels, usageLaunch } from '../../../llms/harnesses/agy';
import { agyTranscriptLog } from '../../../llms/harnesses/agyTasks';
import { finished, started } from '../../../llms/harnesses/agyTasksFixture';
import { AGY_BRIDGE_FLAG, AGY_WINDOWS_BRIDGE, agyBridgeEnv, handleMcp, registerAgyTools, wireTools } from '../../../llms/harnesses/agyMcp';
import { installMcpConfig } from '../../../llms/harnesses/agyMcpConfig';
import { endSessionsHere } from '../../../llms/harnesses/codexRpc';
import { environment, SessionRegistry, useSessionRegistry } from '../../../llms/harnesses/sessionRegistry';
import type { AgentEvent, AgentSession, AgentSpec, AgentTool } from '../../../runtime';
import { gitRepo, until } from '../../helpers/testing';
import { git } from '../../../workstations';

const fake = join(fixturesDir, 'fakeAgy.ts');
const fixtureModels = () => parseAgyModels(readFileSync(join(fixturesDir, 'agy-models.txt'), 'utf8'));
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
  const session = createAgyRuntime(launch, () => '/fake/agy', undefined, async () => fixtureModels()).start(s, first);
  sessions.push(session);
  return session;
};

test('flags: full auto inside the sandbox, read-only by permission rules, resume by conversation', () => {
  expect(agyArgs({})).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--dangerously-skip-permissions']);
  expect(agyArgs({ permission: 'readOnly', resume: 'agy:abc', model: 'm', effort: 'high', dirs: ['/d'] })).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--settings', JSON.stringify({ permissions: READ_ONLY_PERMISSIONS }), '--add-dir', '/d', '--conversation', 'abc', '--model', 'm', '--effort', 'high']);
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
  
  expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toContain('ask -> the answer\n\nNEWS');
  expect(events.filter((e) => e.type === 'tool')).toHaveLength(2);
  
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
  expect(error).toMatchObject({ message: readFileSync(join(fixturesDir, 'agy-quota.txt'), 'utf8').trim(), limit: { resetsAt: expect.any(Number) } });
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

test('concurrent sessions in the same checkout keep their tools separate', async () => {
  const repo = workstation();
  const tool = (text: string): AgentTool => ({ name: 'reply', description: 'reply', schema: {}, run: () => text });
  const first: AgentEvent[] = [], second: AgentEvent[] = [];
  const a = start(spec(repo, first, { tools: [tool('first session')] }), 'CALL reply {}');
  const b = start(spec(repo, second, { tools: [tool('second session')] }), 'CALL reply {}');
  await until(() => first.some((e) => e.type === 'idle') && second.some((e) => e.type === 'idle'));
  expect(first).toContainEqual(expect.objectContaining({ type: 'text', text: expect.stringContaining('first session') }));
  expect(second).toContainEqual(expect.objectContaining({ type: 'text', text: expect.stringContaining('second session') }));
  a.close();
  await a.done;
  const config = join(repo, '.agents', 'mcp_config.json');
  expect(readFileSync(config, 'utf8')).not.toContain('Bearer');
  b.close();
  await b.done;
  expect(existsSync(config)).toBe(false);
});

test('independent processes keep the checkout config until the last session ends', async () => {
  const repo = workstation();
  const config = join(repo, '.agents', 'mcp_config.json');
  const module = JSON.stringify(join(serverDir, 'llms/harnesses/agyMcpConfig.ts'));
  const code = `
    import { installMcpConfig } from ${module};
    const release = installMcpConfig(process.argv[1]);
    console.log('ready');
    for await (const chunk of process.stdin) {}
    release();
  `;
  const startHolder = () => Bun.spawn([process.execPath, '-e', code, repo], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });
  const first = startHolder();
  const second = startHolder();
  const stop = async (child: typeof first) => {
    child.stdin.end();
    expect(await child.exited).toBe(0);
  };
  try {
    await Promise.all([first, second].map(async (child) => {
      const { value } = await child.stdout.getReader().read();
      expect(new TextDecoder().decode(value).trim()).toBe('ready');
    }));
    expect(readFileSync(config, 'utf8')).not.toContain('Bearer');
    await stop(first);
    expect(existsSync(config)).toBe(true);
    await stop(second);
    expect(existsSync(config)).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    const interrupted = startHolder();
    try {
      const { value } = await interrupted.stdout.getReader().read();
      expect(new TextDecoder().decode(value).trim()).toBe('ready');
    } finally {
      interrupted.kill('SIGKILL');
      await interrupted.exited;
    }
    const restarted = startHolder();
    try {
      const { value } = await restarted.stdout.getReader().read();
      expect(new TextDecoder().decode(value).trim()).toBe('ready');
      await stop(restarted);
      expect(existsSync(config)).toBe(false);
    } finally {
      restarted.kill();
      await restarted.exited;
    }
  } finally {
    first.kill();
    second.kill();
    await Promise.all([first.exited, second.exited]);
  }
});

test('the shared config launches each session from its own installation path', async () => {
  const repo = workstation();
  const windows = process.platform === 'win32';
  const executable = windows ? join(dirname(repo), 'Seismic Bun & tools.exe') : process.execPath;
  if (windows) copyFileSync(process.execPath, executable);
  const first = installMcpConfig(repo);
  const second = installMcpConfig(repo);
  const config = join(repo, '.agents', 'mcp_config.json');
  const launcher = join(repo, AGY_WINDOWS_BRIDGE.path);
  const command = JSON.parse(readFileSync(config, 'utf8')).mcpServers.seismic as { command: string; args: string[] };
  const module = JSON.stringify(join(serverDir, 'llms/harnesses/agyMcp.ts'));
  const run = async (name: string) => {
    const script = join(dirname(repo), name + '.ts');
    writeFileSync(script, `
      import { runAgyMcpBridge } from ${module};
      if (process.argv.at(-1) !== ${JSON.stringify(AGY_BRIDGE_FLAG)}) process.exit(1);
      await runAgyMcpBridge();
    `);
    const endpoint = registerAgyTools({ tools: wireTools([{ name: 'identity', description: 'Identity', schema: {}, run: () => name }]) });
    try {
      const child = Bun.spawn([command.command, ...command.args], {
        cwd: repo,
        env: { ...process.env, ...agyBridgeEnv(endpoint, executable, script) },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
        timeout: 5000,
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'seismic_identity', arguments: {} } }) + '\n');
      child.stdin.end();
      const [stdout, status] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ result: { content: [{ text: name }] } });
    } finally {
      endpoint.dispose();
    }
  };
  try {
    expect(JSON.stringify(command)).not.toContain(executable);
    if (windows) {
      expect(command.args.at(-1)).toBe('.agents\\seismic-mcp.cmd');
      expect(existsSync(launcher)).toBe(true);
      expect(git(repo, 'status', '--porcelain')).toBe('');
    }
    await run('Seismic from one installation!');
  } finally {
    first();
    try {
      expect(existsSync(config)).toBe(true);
      if (windows) expect(existsSync(launcher)).toBe(true);
      await run('Seismic from another installation');
    } finally {
      second();
    }
  }
  expect(existsSync(config)).toBe(false);
  expect(existsSync(launcher)).toBe(false);
}, 15000);

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
  const t: AgentTool = { name: 'x', description: 'd', schema: { n: z.number().transform(String) }, run: ({ n }) => { throw new Error(`boom ${typeof n}`); } };
  const reg = { tools: wireTools([t]) };
  expect(await handleMcp(reg, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).toMatchObject({
    result: { tools: [{ inputSchema: { properties: { n: { type: 'number' } } } }] },
  });
  const call = (args: unknown) => handleMcp(reg, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'seismic_x', arguments: args } }) as Promise<{ result: { isError?: boolean; content: { text: string }[] } }>;
  expect((await call({ n: 'no' })).result.isError).toBe(true);
  expect((await call({ n: 1 })).result.content[0]!.text).toBe('boom string');
  expect(await handleMcp(reg, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
});

test('unsupported cases fail visibly', () => {
  const repo = workstation();
  expect(() => start(spec('ssh://host/x', []))).toThrow('non-local');
  expect(() => start(spec(repo, [], { resume: 'codex:abc' }))).toThrow('agy: session');
  expect(() => start(spec(repo, [], { watch: {} as never }))).toThrow('before/after');
});

test('the real model list: each model once, with only the efforts agy has for it', () => {
  const models = fixtureModels();
  const efforts = Object.fromEntries(models.map((m) => [m.model, m.supportedReasoningEfforts.map((e) => e.reasoningEffort).join(',')]));
  expect(efforts).toEqual({
    'gemini-4-neon': 'low,medium,high,xhigh',
    'gemini-4-argon': 'low,medium,high',
    'gemini-4-hydrogen': 'low,medium,high,xhigh',
    'gemini-pro-orchestrator-neon': '',
    'gemini-pro-orchestrator-g1-pro': '',
    'gemini-3.8-flash': 'low,medium,high',
    'claude-opus-5-5': 'low,medium,high',
    'claude-sonnet-5-5': 'low,medium,high',
    'gpt-oss-120b': 'medium',
  });
  expect(models.filter((m) => m.isDefault).map((m) => [m.model, m.defaultReasoningEffort])).toEqual([['gemini-4-neon', 'high']]);
  
  expect(parseAgyModels('gemini-ultra-high\tGemini Ultra High\n').map((m) => [m.model, m.supportedReasoningEfforts.length])).toEqual([['gemini-ultra-high', 0]]);
});

test('a session passes a pair agy accepts: base model and effort, none for a model without efforts', async () => {
  const models = fixtureModels();
  expect(agyRun({ model: 'gemini-3.8-flash', effort: 'low' }, models)).toEqual({ model: 'gemini-3.8-flash', effort: 'low' });
  expect(agyRun({ model: 'gemini-3.8-flash-medium', effort: 'high' }, models)).toEqual({ model: 'gemini-3.8-flash', effort: 'medium' });
  expect(agyRun({ model: 'gemini-pro-orchestrator-neon', effort: 'high' }, models)).toEqual({ model: 'gemini-pro-orchestrator-neon' });
  expect(agyRun({ effort: 'medium' }, models)).toEqual({ effort: 'medium' });
  expect(agyRun({ model: 'gpt-oss-120b', effort: 'high' }, models)).toEqual({ model: 'gpt-oss-120b', effort: 'medium' });
  const account = parseAgyModels('gemini-ultra-medium\tGemini Ultra (Medium)\ngemini-ultra-high\tGemini Ultra High\n');
  expect(agyRun({}, account)).toEqual({ effort: 'medium' });
  expect(agyRun({ model: 'gemini-ultra-high', effort: 'high' }, account)).toEqual({ model: 'gemini-ultra-high' });
  
  const refused = (...args: string[]) => spawnSync('bun', [fake, ...args], { encoding: 'utf8' });
  expect(refused('--model', 'gemini-3.8-flash-medium', '--effort', 'high').stderr).toContain('conflicts with --effort=high');
  expect(refused('--model', 'gemini-4-argon', '--effort', 'xhigh').stderr).toContain('available: low, medium, high');
  expect(refused('--model', 'gemini-pro-orchestrator-neon', '--effort', 'high').stderr).toContain('--effort is not supported');
});

test('a cold launch waits for the catalog on a resumed worker and keeps its first turn', async () => {
  const repo = workstation();
  const events: AgentEvent[] = [];
  let launched: string[] | undefined;
  const { promise, resolve } = Promise.withResolvers<ReturnType<typeof fixtureModels>>();
  const runtime = createAgyRuntime((c, args, options) => {
    launched = args;
    return launch(c, args, options);
  }, () => '/fake/cold-agy', undefined, () => promise);
  const session = runtime.start(spec(repo, events, { resume: 'agy:old-conv', model: 'gemini-pro-orchestrator-neon', effort: 'high' }));
  sessions.push(session);
  session.send('continue');
  expect(launched).toBeUndefined();
  resolve(fixtureModels());
  await until(() => events.some((event) => event.type === 'idle'));
  expect(events.find((event) => event.type === 'session')).toMatchObject({ id: 'agy:old-conv', model: 'gemini-pro-orchestrator-neon' });
  expect(events.some((event) => event.type === 'error')).toBe(false);
  expect(launched).toContain('--model');
  expect(launched).not.toContain('--effort');
});

test('shutdown cancels a cold start while model discovery is still pending', async () => {
  const events: AgentEvent[] = [];
  const { promise, resolve } = Promise.withResolvers<ReturnType<typeof fixtureModels>>();
  let launched = false;
  const runtime = createAgyRuntime((c, args, options) => {
    launched = true;
    return launch(c, args, options);
  }, () => '/fake/cancelled-agy', undefined, () => promise);
  const session = runtime.start(spec(workstation(), events, { model: 'gemini-pro-orchestrator-neon', effort: 'high' }));
  await endSessionsHere();
  await session.done;
  resolve(fixtureModels());
  await Bun.sleep(0);
  expect(launched).toBe(false);
  expect(events).toEqual([]);
});

test('parsing: models, limits, native tools', () => {
  expect(parseAgyModels('Fetching available models...\n* gemini-pro (default)\n- gemini-flash\n').map((m) => [m.model, m.isDefault])).toEqual([['gemini-pro', true], ['gemini-flash', false]]);
  expect(agyLimit('RESOURCE_EXHAUSTED: retry in 2 hours', 0)).toEqual({ resetsAt: 7_200_000 });
  expect(agyLimit('boom')).toBeUndefined();
  expect(nativeTool('write_to_file', { path: 'a' }).name).toBe('Edit');
});

test('the usage limits of a real `agy -p /usage` answer, each scoped to its group of models', () => {
  const answer = JSON.parse(readFileSync(join(fixturesDir, 'agy-usage.json'), 'utf8'));
  const [gemini, thirdParty] = answer.command.data.groups;
  gemini.buckets[1].remaining_fraction = 0.83;
  thirdParty.buckets[0].remaining_fraction = 0.04;
  const at = new Date('2026-11-18T17:00:00Z');
  const usage = agyUsageOf(answer, at);
  expect(usage.harness).toBe('agy');
  expect(usage.at).toBe(at.toISOString());
  expect(usage.limits.map((l) => [l.kind, l.scope, Math.round(l.percent), l.severity])).toEqual([
    ['session_scoped', 'Gemini Models', 17, 'normal'],
    ['weekly_scoped', 'Gemini Models', 0, 'normal'],
    ['session_scoped', 'Claude and GPT models', 0, 'normal'],
    ['weekly_scoped', 'Claude and GPT models', 96, 'critical'],
    ['weekly_scoped', 'Gemini 4 Argon', 0, 'normal'],
  ]);
  expect(usage.limits[1]!.resetsAt).toBe(new Date(gemini.buckets[0].reset_time).toISOString());
});

test('agy usage: nothing without agy or signed out, a failure otherwise', async () => {
  const calls: string[][] = [];
  const answer = readFileSync(join(fixturesDir, 'agy-usage.json'), 'utf8');
  let reply = { status: 0, out: answer, err: '' };
  const source = agyUsage(async (_, args) => (calls.push(args), reply), () => '/bin/agy');
  expect((await source.fetch())?.limits).toHaveLength(5);
  expect(calls[0]).toEqual(['-p', '/usage', '--output-format', 'json']);
  reply = { status: 1, out: '', err: 'Please sign in to Antigravity first' };
  expect(await source.fetch()).toBeNull();
  reply = { status: 1, out: '', err: 'network unreachable' };
  await expect(source.fetch()).rejects.toThrow('network unreachable');
  source.close();
  expect(await source.fetch()).toBeNull();
  expect(await agyUsage(async () => reply, () => null).fetch()).toBeNull();
});

test.skipIf(process.platform === 'win32')('closing the agy usage source ends a /usage run under way, with what it started', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-usage-'));
  try {
    const script = join(dir, 'agy');
    
    writeFileSync(script, `#!/bin/sh\nsleep 60 &\necho $! > "${dir}/helper"\necho $$ > "${dir}/agy.pid"\nwait\n`);
    chmodSync(script, 0o755);
    const source = agyUsage(undefined, () => script);
    const fetched = source.fetch();
    await until(() => existsSync(join(dir, 'helper')) && existsSync(join(dir, 'agy.pid')));
    const pids = ['agy.pid', 'helper'].map((f) => Number(readFileSync(join(dir, f), 'utf8')));
    source.close();
    await expect(fetched).rejects.toThrow('stopped');
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    
    await until(() => pids.every((pid) => !alive(pid)), 15_000);
    expect(await source.fetch()).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test('ending a /usage run ends its job on Windows, and if the job refuses closes it at once', () => {
  const killed: string[] = [];
  const child = { pid: 4242, kill: (s: string) => killed.push(s) };
  let terminated = 0;
  let closed = 0;
  const job = (ends: boolean) => ({ assign: () => true, terminate: () => { terminated++; return ends; }, close: () => { closed++; } });
  endProcessTree(child, job(true), false);
  expect([terminated, closed]).toEqual([1, 0]);
  expect(killed).toEqual([]);
  
  endProcessTree(child, job(false), false);
  expect([terminated, closed]).toEqual([2, 1]);
  expect(killed).toEqual(['SIGKILL']);
});

test('on Windows agy is started by a launcher that waits before it starts agy, with its path out of cmd\'s parser', () => {
  const launch = usageLaunch('C:\\Program Files\\Antigravity\\agy.exe', ['-p', '/usage', '--output-format', 'json'], { PATH: 'x' }, 'C:\\Windows\\system32\\cmd.exe');
  expect(launch.command).toBe('C:\\Windows\\system32\\cmd.exe');
  expect(launch.args).toEqual(['/d', '/s', '/c', '"set /p _= & "%SEISMIC_USAGE_AGY%" -p /usage --output-format json"']);
  expect(launch.env).toEqual({ PATH: 'x', SEISMIC_USAGE_AGY: 'C:\\Program Files\\Antigravity\\agy.exe' });
  expect(() => usageLaunch('agy', ['a b'], {})).toThrow('cannot go through cmd');
});

test('real account-quota capture reads the entire reset duration', () => {
  const message = readFileSync(join(fixturesDir, 'agy-quota.txt'), 'utf8').trim();
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
  
  let settled = false;
  void session.done.then(() => { settled = true; });
  await endSessionsHere();
  expect(settled).toBe(true);
  expect(records()).toEqual([]);
});

test.skipIf(!recording)('an agy whose processes cannot be watched ends before any turn', async () => {
  const { records } = registry();
  
  const orphan = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(testProcessCode())}],{detached:true,stdio:'ignore'});console.log(c.pid);c.unref();`;
  const stranger = { pid: Number(spawnSync(process.execPath, ['-e', orphan], { encoding: 'utf8' }).stdout.trim()), kill: (s: NodeJS.Signals) => { try { process.kill(stranger.pid, s); } catch {  } } };
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
  
  const session = createAgyRuntime(scripted(`const turn = () => { const c = spawn(process.execPath, ['-e', ${JSON.stringify(testProcessCode())}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); require('node:fs').writeFileSync(${JSON.stringify(leafFile)}, String(c.pid)); process.exit(0); };`), () => '/fake/agy').start(spec(workstation(), events), 'one');
  sessions.push(session);
  try {
    const started = Date.now();
    await session.done;
    expect(Date.now() - started).toBeLessThan(4500);
  } finally { try { process.kill(Number(readFileSync(leafFile, 'utf8')), 'SIGKILL'); } catch {  } }
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
