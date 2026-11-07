import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generic } from '../adapters/generic';
import { AGENT_DEFAULTS, type AgentSetting } from '../core/types';
import { Workers } from './workers';
import { board, eachTest, flush, manual, runtime, setWorkers, spaces, workers } from './workers-fixture';

eachTest();
const codex: AgentSetting = { ...AGENT_DEFAULTS.worker, harness: 'codex', codex: { model: 'test-codex', effort: 'low' } };
function using(choice: () => AgentSetting) {
  setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'main' }, agentSetting: choice }));
}

test('pins before first session id and resumes the same harness after settings change and server restart', async () => {
  let choice = codex;
  using(() => choice);
  const card = manual();
  await workers.start(card.id);
  expect(JSON.parse(board.row(card.id).agent_setting!)).toEqual(codex);
  const resolved: AgentSetting = { ...codex, codex: { model: 'resolved-account-default', effort: 'low' } };
  runtime.last.emit({ type: 'session', id: 'codex:thread-1', setting: resolved });
  expect(JSON.parse(board.row(card.id).agent_setting!)).toEqual(resolved);
  workers.shutdown(); await flush();
  choice = AGENT_DEFAULTS.worker;
  using(() => choice); workers.resumeAll();
  expect(runtime.last.spec).toMatchObject({ resume: 'codex:thread-1', setting: resolved });
  workers.shutdown();
});

test('a choice made for one start reaches the worker and is kept across replies and restarts, whatever the default', async () => {
  const chosen: AgentSetting = { model: 'sonnet', effort: 'low' };
  let choice: AgentSetting = AGENT_DEFAULTS.worker;
  using(() => choice);
  const card = manual();
  await workers.start(card.id, chosen);
  expect(runtime.last.spec).toMatchObject({ setting: chosen });
  expect(board.events(card.id).some((e) => e.text.includes('Claude Code · sonnet · low'))).toBe(true);
  runtime.last.emit({ type: 'session', id: 'session-1' });
  workers.shutdown(); await flush();
  choice = codex;
  using(() => choice); workers.resumeAll();
  expect(runtime.last.spec).toMatchObject({ resume: 'session-1', setting: chosen });
  workers.shutdown();
});

test('legacy session is Claude even when new worker default is Codex', async () => {
  const card = manual(); await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 'legacy-session' });
  workers.shutdown(); await flush();
  board.work(card.id, { agent_setting: null });
  using(() => codex); workers.resumeAll();
  expect(runtime.last.spec.resume).toBe('legacy-session');
  expect(runtime.last.spec.setting?.harness).toBeUndefined();
  expect(JSON.parse(board.row(card.id).agent_setting!).harness).toBeUndefined();
  workers.shutdown();
});

test('a worker restarted deliberately takes the new default instead of its old harness', async () => {
  using(() => codex); const card = manual(); await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 'codex:thread-1' });
  await workers.stop(card.id); await workers.freed();
  using(() => AGENT_DEFAULTS.worker); await workers.start(card.id);
  expect(runtime.last.spec.resume).toBeUndefined();
  expect(runtime.last.spec.setting).toEqual(AGENT_DEFAULTS.worker);
  workers.shutdown();
});

/** The `dirs` a worker with this setting starts with, the demos directory being `demos`. */
async function dirsWith(choice: AgentSetting, demos: () => string) {
  setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'main' }, agentSetting: () => choice, demoDirectory: demos }));
  await workers.start(manual().id);
  const dirs = runtime.last.spec.dirs;
  workers.shutdown();
  return dirs;
}

test('a Codex worker may write in the demos directory', async () => {
  const demos = mkdtempSync(join(tmpdir(), 'obeya-demos-'));
  try {
    expect(await dirsWith(codex, () => demos)).toEqual([demos]);
  } finally {
    rmSync(demos, { recursive: true, force: true });
  }
});

test('a demos directory that is not there yet is not offered as a place to write', async () => {
  expect(await dirsWith(codex, () => join(tmpdir(), 'obeya-demos-missing-dir'))).toBeUndefined();
});

test('a Claude worker gets no extra directory for the demos', async () => {
  const demos = mkdtempSync(join(tmpdir(), 'obeya-demos-'));
  try {
    expect(await dirsWith(AGENT_DEFAULTS.worker, () => demos)).toBeUndefined();
  } finally {
    rmSync(demos, { recursive: true, force: true });
  }
});

/** The names of the tools a worker with this setting starts with. */
async function toolsWith(choice: AgentSetting) {
  using(() => choice);
  await workers.start(manual().id);
  const spec = runtime.last.spec;
  workers.shutdown();
  return { tools: spec.tools.map((t) => t.name), system: spec.system };
}

test('a Codex worker gets seismic_run and seismic_git, and a note on what its sandbox keeps from it', async () => {
  const { tools, system } = await toolsWith(codex);
  expect(tools).toContain('run');
  expect(tools).toContain('git');
  expect(system).toContain('seismic_run');
});

test('a Claude worker has neither', async () => {
  const { tools, system } = await toolsWith(AGENT_DEFAULTS.worker);
  expect(tools).not.toContain('run');
  expect(tools).not.toContain('git');
  expect(system).not.toContain('seismic_run');
});

/** The spec a worker with this setting starts with, Codex's automatic review on. */
async function autoSpec(choice: AgentSetting) {
  setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'main' }, agentSetting: () => choice, codexAutoReview: () => true }));
  await workers.start(manual().id);
  const spec = runtime.last.spec;
  workers.shutdown();
  return spec;
}

test("a Codex worker with Codex's automatic review on starts with it and is told to ask for escalation, not the owner", async () => {
  const spec = await autoSpec(codex);
  expect(spec.autoReview).toBe(true);
  expect(spec.system).toContain('request escalated permissions');
  expect(spec.tools.find((t) => t.name === 'run')!.description).toContain('escalated permissions');
});

test("Codex's automatic review leaves a Claude worker as it was", async () => {
  expect((await autoSpec(AGENT_DEFAULTS.worker)).autoReview).toBeUndefined();
});

test('without it, a Codex worker is told the owner is asked', async () => {
  const { system } = await toolsWith(codex);
  expect(system).not.toContain('request escalated permissions');
});
