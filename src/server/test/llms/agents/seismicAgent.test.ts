import { expect, test } from 'bun:test';
import { AGENT_DEFAULTS } from '../../../../core/types';
import { FakeRuntime } from '../../helpers/testing';
import { SeismicAgent } from '../../../llms/agents/seismicAgent';
import { SeismicModel } from '../../../llms/models/seismicModel';
import { ownerPermission, setOwnerPermission } from '../../../llms/agents/permission';
import { labelsSkill } from '../../../llms/skills/labels';

class Probe extends SeismicAgent<{ topic: string }> {
  readonly role = 'explorer' as const;
  readonly name = 'probe';
  readonly description = 'A test agent.';
  override getPermissionMode() { return 'readOnly' as const; }
  override getSkills() { return [labelsSkill]; }
  getModel() { return AGENT_DEFAULTS.explorer; }
  getPrompt(ctx: { topic: string }) { return `Look into ${ctx.topic}.`; }
  override getBriefing(ctx: { topic: string }) { return `Start with ${ctx.topic}.`; }
}

test('toSpec assembles the pieces of the agent', () => {
  const spec = new Probe().toSpec({ topic: 'x' }, { cwd: '/w', onEvent: () => {}, resume: 's1' });
  expect(spec).toMatchObject({ cwd: '/w', system: 'Look into x.', role: 'explorer', setting: AGENT_DEFAULTS.explorer, permission: 'readOnly', resume: 's1', tools: [], skills: [labelsSkill] });
});

test('start hands the spec and the briefing to the runtime', () => {
  const runtime = new FakeRuntime();
  new Probe().start(runtime, { topic: 'y' }, { cwd: '/w', onEvent: () => {} });
  expect(runtime.sessions).toHaveLength(1);
  expect(runtime.last.spec.system).toBe('Look into y.');
});

test('an agent follows the owner’s permission unless it overrides', () => {
  class Plain extends SeismicAgent {
    readonly role = 'worker' as const;
    readonly name = 'plain';
    readonly description = 'A test agent.';
    getModel() { return AGENT_DEFAULTS.worker; }
    getPrompt() { return ''; }
  }
  setOwnerPermission('acceptEdits');
  try {
    expect(new Plain().toSpec(undefined, { cwd: '/w', onEvent: () => {} }).permission).toBe('acceptEdits');
    expect(new Probe().toSpec({ topic: 'x' }, { cwd: '/w', onEvent: () => {} }).permission).toBe('readOnly');
  } finally {
    setOwnerPermission('auto');
  }
  expect(ownerPermission()).toBe('auto');
});

test('an agent checks what it declares of its model, with what a run adds, before it runs', () => {
  class Sees extends Probe {
    override readonly capabilities = { images: 'required' } as const;
  }
  const info = (inputModalities?: string[]) => new SeismicModel('codex', 'm', { model: 'm', isDefault: true, supportedReasoningEfforts: [], ...(inputModalities ? { inputModalities } : {}) });
  const agent = new Sees();
  expect(agent.checkCapabilities(info(['text', 'image'])).ok).toBe(true);
  expect(agent.checkCapabilities(info(['text'])).problem).toBe('The selected Codex model does not support images, which this session needs');
  expect(agent.checkCapabilities(info()).ok).toBe(true);
  expect(new Probe().checkCapabilities(info(['text']), { images: 'optional' }).degraded).toEqual(['images']);
  expect(new Probe().toSpec({ topic: 't' }, { cwd: '/w', onEvent: () => {} }).checkModel).toBeUndefined();
  expect(agent.toSpec({ topic: 't' }, { cwd: '/w', onEvent: () => {} }).checkModel!(info(['text'])).ok).toBe(false);
});
