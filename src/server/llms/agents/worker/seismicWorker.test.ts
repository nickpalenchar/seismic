import { afterEach, expect, test } from 'bun:test';
import { AGENT_DEFAULTS, type AgentSetting } from '../../../../core/types';
import type { Live } from '../../../workerSupervisor/workerSupervisor';
import { setOwnerPermission } from '../permission';
import { SEISMIC_SKILLS } from '../../skills/registry';
import { seismicWorker, type WorkerContext } from './seismicWorker';

afterEach(() => setOwnerPermission('auto'));

const codex: AgentSetting = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'codex-test', effort: 'low' } };
/** Only what the permission and the model are read from: the prompt and tools need a running `WorkerSupervisor` (`workers.test.ts` covers them). */
const context = (setting: AgentSetting = AGENT_DEFAULTS.worker, autoReview = false) => ({ setting, live: { autoReview } as Live }) as WorkerContext;

test('the worker is the worker role on the card’s pinned setting, with every skill', () => {
  expect(seismicWorker.role).toBe('worker');
  expect(seismicWorker.getModel(context(codex))).toBe(codex);
  expect(seismicWorker.getSkills()).toEqual([...SEISMIC_SKILLS]);
});

test('a Claude worker follows the owner’s permission mode', () => {
  setOwnerPermission('acceptEdits');
  expect(seismicWorker.getPermissionMode(context())).toBe('acceptEdits');
});

test('a Codex worker asks, reviews automatically where the owner’s setting says, and bypasses only if the owner bypasses all', () => {
  expect(seismicWorker.getPermissionMode(context(codex))).toBe('ask');
  expect(seismicWorker.getPermissionMode(context(codex, true))).toBe('auto');
  setOwnerPermission('acceptEdits');
  expect(seismicWorker.getPermissionMode(context(codex))).toBe('ask');
  setOwnerPermission('dangerouslyBypassPermissions');
  expect(seismicWorker.getPermissionMode(context(codex))).toBe('dangerouslyBypassPermissions');
});
