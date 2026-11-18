import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_DEFAULTS, HARNESSES, type Harness } from '../../../core/types';
import { SEISMIC_PLUGIN } from '../../demo';
import { withAgentSetting, type AgentEvent, type AgentSpec } from '../../runtime';
import { FakeRuntime, gitRepo } from '../../testing';
import { connectedHarnesses, HarnessCheck, harnessNames, workerHarnessRuntime } from '.';
import { createCodexRuntime } from './codex';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture(extra: Partial<AgentSpec> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'seismic-harness-')); dirs.push(cwd);
  gitRepo(cwd);
  const claude = new FakeRuntime(), codex = new FakeRuntime();
  const events: AgentEvent[] = [];
  const spec: AgentSpec = { cwd, system: 'instructions', tools: [], role: 'worker', onEvent: (e) => events.push(e), ...extra };
  const runtime = withAgentSetting(workerHarnessRuntime(claude, codex), () => AGENT_DEFAULTS.worker);
  return { cwd, claude, codex, events, spec, runtime };
}
const setting = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'codex-test', effort: 'low' } } as const;

test('routes pinned harness/model independently of current default, with portable bundled skills', () => {
  const { runtime, spec, claude, codex } = fixture({ setting, plugins: [SEISMIC_PLUGIN], contextUpdate: () => 'news' });
  runtime.start(spec, 'build');
  expect(claude.sessions).toHaveLength(0);
  expect(codex.last.spec).toMatchObject({ model: 'codex-test', effort: 'low', setting });
  expect(codex.last.spec.plugins).toBeUndefined();
  expect(codex.last.spec.system).toContain(join(SEISMIC_PLUGIN, 'skills', 'browser', 'SKILL.md'));
  expect(codex.last.toolStep()).toBe('news');
  runtime.start({ ...spec, setting: AGENT_DEFAULTS.worker, resume: 'legacy-claude' });
  expect(claude.last.spec.resume).toBe('legacy-claude');
});

test('mismatched session ownership and unsupported capabilities fail visibly without starting a harness', async () => {
  for (const extra of [
    { setting, resume: 'claude-id' }, { resume: 'codex:thread' },
    { setting, role: 'koordinator' as const }, { setting, plugins: ['/foreign'] },
    { setting, cwd: 'ssh://host/repo' },
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
  const spec: AgentSpec = { cwd, system: 'instructions', tools: [], role: 'worker', setting: agySetting, plugins: [SEISMIC_PLUGIN], onEvent: (e) => events.push(e) };
  runtime.start(spec, 'build');
  expect(claude.sessions).toHaveLength(0); expect(codex.sessions).toHaveLength(0);
  expect(agy.last.spec).toMatchObject({ model: 'agy-test', effort: 'low', setting: agySetting });
  expect(agy.last.spec.plugins).toBeUndefined();
  expect(agy.last.spec.system).toContain(join(SEISMIC_PLUGIN, 'skills', 'browser', 'SKILL.md'));
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

test('names the harnesses installed and signed in on this machine, Antigravity included; the asking one where none answers', async () => {
  const on = (...hs: string[]) => ({ claude: async () => hs.includes('claude'), codex: async () => hs.includes('codex'), agy: async () => hs.includes('agy') });
  expect(await connectedHarnesses(on('agy', 'codex'))).toEqual(['codex', 'agy']);
  // a check that fails counts as not signed in
  expect(await connectedHarnesses({ ...on('codex'), claude: () => Promise.reject(new Error('gone')) })).toEqual(['codex']);
  expect(harnessNames('codex', await connectedHarnesses(on('codex', 'agy')))).toEqual(['Codex', 'Antigravity']);
  expect(harnessNames('claude', await connectedHarnesses(on('claude', 'codex', 'agy')))).toEqual(['Claude Code', 'Codex', 'Antigravity']);
  expect(harnessNames('agy', [])).toEqual(['Antigravity']);
});

test('the harness check never keeps a caller waiting: it answers with what the last check found and checks again in the background once that is stale', async () => {
  let clock = 0;
  let calls = 0;
  let answer: (found: Harness[]) => void = () => {};
  const check = new HarnessCheck(() => (calls++, new Promise<Harness[]>((r) => (answer = r))), 60_000, () => clock);
  // nothing known yet: an answer at once, the check under way
  expect(check.current()).toEqual([]);
  expect(check.current()).toEqual([]);
  expect(calls).toBe(1);
  const first = check.refresh();
  answer(['codex']);
  await first;
  expect(check.current()).toEqual(['codex']);
  expect(calls).toBe(1);
  // the setup assistant's check counts as fresh
  clock = 50_000;
  check.set(['claude', 'codex']);
  clock = 100_000;
  expect(check.current()).toEqual(['claude', 'codex']);
  const before = calls;
  // stale: the last finding still answers while the next runs
  clock = 200_000;
  expect(check.current()).toEqual(['claude', 'codex']);
  expect(calls).toBe(before + 1);
  const next = check.refresh();
  answer(['agy']);
  await next;
  expect(check.current()).toEqual(['agy']);
});

test('a check that started earlier but answers later does not overwrite a newer finding, also within the same millisecond', async () => {
  // a clock that stands still: only the order the checks began in tells them apart
  let answer: (found: Harness[]) => void = () => {};
  const check = new HarnessCheck(() => new Promise<Harness[]>((r) => (answer = r)), 60_000, () => 0);
  // the background check begins, then the setup assistant's begins and answers first: Codex was just signed in
  const background = check.refresh();
  const setup = check.begin();
  check.set(['claude', 'codex'], setup);
  answer(['claude']);
  await background;
  expect(check.current()).toEqual(['claude', 'codex']);
  // two setup checks the other way round: the earlier one answering last changes nothing
  const earlier = check.begin();
  const later = check.begin();
  check.set(['codex'], later);
  check.set(['agy'], earlier);
  expect(check.current()).toEqual(['codex']);
});

test('a setup check that began before the background check never overwrites its newer finding', async () => {
  let answer: (found: Harness[]) => void = () => {};
  const check = new HarnessCheck(() => new Promise<Harness[]>((r) => (answer = r)), 60_000, () => 0);
  const setup = check.begin();
  const background = check.refresh();
  answer(['claude']);
  await background;
  // the setup check answers last, with what was true when it began
  expect(check.set(['claude', 'codex'], setup)).toEqual(['claude']);
  expect(check.current()).toEqual(['claude']);
});

test('a finding set without a check of its own is the newest at that moment', async () => {
  let answer: (found: Harness[]) => void = () => {};
  const check = new HarnessCheck(() => new Promise<Harness[]>((r) => (answer = r)), 60_000, () => 0);
  const background = check.refresh();
  check.set(['codex']);
  answer(['claude']);
  expect(await background).toEqual(['codex']);
  expect(check.current()).toEqual(['codex']);
});

test('a failed check changes nothing, whichever check it was', async () => {
  let fail: (e: Error) => void = () => {};
  const check = new HarnessCheck(() => new Promise<Harness[]>((_, r) => (fail = r)), 60_000, () => 0);
  check.set(['claude']);
  // a background check that fails after a setup check began keeps the setup check's finding
  const background = check.refresh();
  const setup = check.begin();
  check.set(['codex'], setup);
  fail(new Error('no network'));
  expect(await background).toEqual(['codex']);
  // a setup check that never reports (it threw) leaves the finding, and a later one still places itself
  check.begin();
  expect(check.current()).toEqual(['codex']);
  const later = check.begin();
  check.set(['agy'], later);
  expect(check.current()).toEqual(['agy']);
  // a failed background check does not block the next
  const failing = check.refresh();
  fail(new Error('boom'));
  expect(await failing).toEqual(['agy']);
  const again = check.refresh();
  fail(new Error('boom'));
  await again;
});

test('overlapping setup checks answering in every order leave the one that began last', () => {
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2], [0, 2, 1], [2, 0, 1]]) {
    const check = new HarnessCheck(async () => [], 60_000, () => 0);
    const began = [check.begin(), check.begin(), check.begin()];
    for (const i of order) check.set([HARNESSES[i]!], began[i]);
    expect(check.current()).toEqual([HARNESSES[2]]);
  }
});

test('a check of some harnesses places only those, each by the check that began last for it', () => {
  const check = new HarnessCheck(async () => [], 60_000, () => 0);
  check.set(['claude', 'agy']);
  // the setup assistant checks Codex alone: Claude Code and Antigravity stay as they were
  check.set(['codex'], check.begin(), ['codex']);
  expect(check.current()).toEqual(['claude', 'codex', 'agy']);
  // Claude Code's check began before Antigravity's but answers after it: both stand
  const claude = check.begin();
  const agy = check.begin();
  check.set([], agy, ['agy']);
  check.set([], claude, ['claude']);
  expect(check.current()).toEqual(['codex']);
  // a full check that began before them changes neither, only Codex
  const full = { order: 0, at: 0 };
  check.set(['claude', 'agy'], full);
  expect(check.current()).toEqual(['codex']);
});
