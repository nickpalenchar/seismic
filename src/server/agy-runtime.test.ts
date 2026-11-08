import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { agyArgs, READ_ONLY_PERMISSIONS, agyLimit, createAgyRuntime, nativeTool, parseAgyModels } from './agy-runtime';
import { handleMcp, registerAgyTools, wireTools } from './agy-mcp';
import type { AgentEvent, AgentSession, AgentSpec, AgentTool } from './runtime';
import { gitRepo, until } from './testing';
import { git } from './workstations';

const fake = join(import.meta.dir, 'fixtures', 'fake-agy.ts');
const launch = (_command: string, args: string[], options: Parameters<Parameters<typeof createAgyRuntime>[0] & {}>[2]) => spawn('bun', [fake, ...args], { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
const sessions: AgentSession[] = [];
const dirs: string[] = [];
afterEach(async () => { for (const s of sessions.splice(0)) { s.close(); await s.done; } for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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
  expect(events.find((e) => e.type === 'error')).toMatchObject({ message: 'Quota exceeded. Retry in 30s.', limit: { resetsAt: expect.any(Number) } });
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
