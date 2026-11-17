import { afterEach, expect, test } from 'bun:test';
import { AGENT_DEFAULTS, type AgentSetting } from '../../../core/types';
import { FakeRuntime } from '../../testing';
import { setOwnerPermission } from '../permission';
import { SEISMIC_SKILLS } from '../skills/registry';
import { seismicWorker, type WorkerContext } from './seismicWorker';

afterEach(() => setOwnerPermission('auto'));

const codex: AgentSetting = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'codex-test', effort: 'low' } };
const context = (over: Partial<WorkerContext> = {}): WorkerContext => ({ setting: AGENT_DEFAULTS.worker, system: 'rules', tools: [], options: {}, autoReview: false, message: 'Build it.', ...over });

test('a run is the worker role on the card’s pinned setting, with every skill, its options and its first message', () => {
  const runtime = new FakeRuntime();
  const contextUpdate = () => 'news';
  seismicWorker.start(runtime, context({ options: { at: { card: 'c1' }, dirs: ['/d'], contextUpdate } }), { cwd: '/ws', onEvent: () => {}, resume: 's1', images: ['/i.png'] });
  expect(runtime.last.spec).toMatchObject({ cwd: '/ws', role: 'worker', setting: AGENT_DEFAULTS.worker, system: 'rules', at: { card: 'c1' }, dirs: ['/d'], resume: 's1', contextUpdate, skills: [...SEISMIC_SKILLS] });
  expect(runtime.last.inbox).toEqual(['Build it.']);
  expect(runtime.last.images).toEqual([['/i.png']]);
});

test('a Claude worker follows the owner’s permission mode', () => {
  setOwnerPermission('acceptEdits');
  expect(seismicWorker.getPermissionMode(context())).toBe('acceptEdits');
});

test('a Codex worker asks, reviews automatically where the owner’s setting says, and bypasses only if the owner bypasses all', () => {
  expect(seismicWorker.getPermissionMode(context({ setting: codex }))).toBe('ask');
  expect(seismicWorker.getPermissionMode(context({ setting: codex, autoReview: true }))).toBe('auto');
  setOwnerPermission('acceptEdits');
  expect(seismicWorker.getPermissionMode(context({ setting: codex }))).toBe('ask');
  setOwnerPermission('dangerouslyBypassPermissions');
  expect(seismicWorker.getPermissionMode(context({ setting: codex }))).toBe('dangerouslyBypassPermissions');
});
