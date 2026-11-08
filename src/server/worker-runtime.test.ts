import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_DEFAULTS } from '../core/types';
import { OBEYA_PLUGIN } from './demo';
import { withAgentSetting, type AgentEvent, type AgentSpec } from './runtime';
import { FakeRuntime, gitRepo } from './testing';
import { workerHarnessRuntime } from './worker-runtime';
import { createCodexRuntime } from './codex-runtime';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture(extra: Partial<AgentSpec> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'obeya-harness-')); dirs.push(cwd);
  gitRepo(cwd);
  const claude = new FakeRuntime(), codex = new FakeRuntime();
  const events: AgentEvent[] = [];
  const spec: AgentSpec = { cwd, system: 'instructions', tools: [], role: 'worker', onEvent: (e) => events.push(e), ...extra };
  const runtime = withAgentSetting(workerHarnessRuntime(claude, codex), () => AGENT_DEFAULTS.worker);
  return { cwd, claude, codex, events, spec, runtime };
}
const setting = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'codex-test', effort: 'low' } } as const;

test('routes pinned harness/model independently of current default, with portable bundled skills', () => {
  const { runtime, spec, claude, codex } = fixture({ setting, plugins: [OBEYA_PLUGIN], permissionMode: 'auto', contextUpdate: () => 'news' });
  runtime.start(spec, 'build');
  expect(claude.sessions).toHaveLength(0);
  expect(codex.last.spec).toMatchObject({ model: 'codex-test', effort: 'low', setting });
  expect(codex.last.spec.plugins).toBeUndefined();
  expect(codex.last.spec.permissionMode).toBeUndefined();
  expect(codex.last.spec.system).toContain(join(OBEYA_PLUGIN, 'skills', 'browser', 'SKILL.md'));
  expect(codex.last.toolStep()).toBe('news');
  runtime.start({ ...spec, setting: AGENT_DEFAULTS.worker, resume: 'legacy-claude' });
  expect(claude.last.spec.resume).toBe('legacy-claude');
});

test('mismatched session ownership and unsupported capabilities fail visibly without starting a harness', async () => {
  for (const extra of [
    { setting, resume: 'claude-id' }, { resume: 'codex:thread' },
    { setting, role: 'koordinator' as const }, { setting, plugins: ['/foreign'] },
    { setting, cwd: 'ssh://host/repo' }, { setting, permissionMode: 'bypassPermissions' as const },
    { setting, watch: { before: async () => {}, after: async () => {} } },
  ]) {
    const { runtime, spec, events, claude, codex } = fixture(extra);
    await runtime.start(spec, 'build').done;
    expect(events.map((e) => e.type)).toEqual(['error', 'idle']);
    expect(claude.sessions).toHaveLength(0); expect(codex.sessions).toHaveLength(0);
  }
});

test('rejects a bare local folder even when no watch hooks were supplied', async () => {
  const { runtime, spec, cwd, events, codex, claude } = fixture({ setting });
  rmSync(join(cwd, '.git'), { recursive: true, force: true });
  await runtime.start(spec).done;
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Codex workers currently require a local Git workstation' }));
  expect(codex.sessions).toHaveLength(0); expect(claude.sessions).toHaveLength(0);
});

test('an unavailable Codex backend never falls back to Claude (including record/replay)', async () => {
  const { spec, claude, events } = fixture({ setting });
  const runtime = workerHarnessRuntime(claude, { start() { throw new Error('Codex workers are not supported in record/replay mode'); } });
  await runtime.start(spec).done;
  expect(events.map((e) => e.type)).toEqual(['error', 'idle']);
  expect(claude.sessions).toHaveLength(0);
});

test("a repository's .codex no longer stops a Codex worker: whether Codex loads it is its trust's to say", async () => {
  const { runtime, spec, cwd, codex, events } = fixture({ setting });
  mkdirSync(join(cwd, '.codex'));
  runtime.start(spec, 'build');
  expect(codex.sessions).toHaveLength(1);
  expect(codex.last.spec.codexConfig).toBeUndefined();
  expect(events.filter((e) => e.type === 'error')).toEqual([]);
});

test("a Codex worker starts in a repository whose Claude Code configuration is held, a review card's stays refused", async () => {
  const connected: AgentSpec[] = [];
  const codex = createCodexRuntime((spec) => { connected.push(spec); throw new Error('no Codex here'); });
  const held = fixture({ setting, claudeHeld: true });
  await withAgentSetting(workerHarnessRuntime(held.claude, codex), () => AGENT_DEFAULTS.worker).start(held.spec, 'build').done;
  expect(connected).toHaveLength(1);
  expect(held.events).toContainEqual(expect.objectContaining({ type: 'error', message: 'no Codex here' }));
  const review = fixture({ setting, untrusted: true });
  await withAgentSetting(workerHarnessRuntime(review.claude, codex), () => AGENT_DEFAULTS.worker).start(review.spec, 'build').done;
  expect(connected).toHaveLength(1);
  expect(review.events).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('untrusted repository configuration') }));
  expect(review.claude.sessions).toHaveLength(0);
});

test('an agy worker routes to Antigravity with portable skills; its sessions are pinned to it and nothing falls back to Claude', async () => {
  const agySetting = { model: 'opus', effort: 'high', harness: 'agy', agy: { model: 'agy-test', effort: 'low' } } as const;
  const { cwd, claude, codex, events } = fixture();
  const agy = new FakeRuntime();
  const runtime = withAgentSetting(workerHarnessRuntime(claude, codex, agy), () => AGENT_DEFAULTS.worker);
  const spec: AgentSpec = { cwd, system: 'instructions', tools: [], role: 'worker', setting: agySetting, plugins: [OBEYA_PLUGIN], permissionMode: 'auto', onEvent: (e) => events.push(e) };
  runtime.start(spec, 'build');
  expect(claude.sessions).toHaveLength(0); expect(codex.sessions).toHaveLength(0);
  expect(agy.last.spec).toMatchObject({ model: 'agy-test', effort: 'low', setting: agySetting });
  expect(agy.last.spec.plugins).toBeUndefined();
  expect(agy.last.spec.system).toContain(join(OBEYA_PLUGIN, 'skills', 'browser', 'SKILL.md'));
  // a session belongs to its harness, both ways
  for (const extra of [{ resume: 'claude-id' }, { resume: 'codex:t' }, { role: 'koordinator' as const }, { cwd: 'ssh://host/repo' }, { setting: { ...agySetting, harness: 'claude' as const }, resume: 'agy:c' }]) {
    const before = events.length;
    await runtime.start({ ...spec, ...extra }, 'build').done;
    expect(events.slice(before).map((e) => e.type)).toEqual(['error', 'idle']);
  }
  expect(agy.sessions).toHaveLength(1); expect(claude.sessions).toHaveLength(0);
  runtime.start({ ...spec, resume: 'agy:conv' });
  expect(agy.sessions).toHaveLength(2);
});
