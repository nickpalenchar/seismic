import { expect, test } from 'bun:test';
import { AGENT_DEFAULTS } from '../../core/types';
import { FakeRuntime } from '../testing';
import { SeismicAgent } from './seismicAgent';
import { labelsSkill } from './skills/labels';

class Probe extends SeismicAgent<{ topic: string }> {
  readonly role = 'explorer' as const;
  readonly name = 'probe';
  readonly description = 'A test agent.';
  override readOnly = true;
  override getSkills() { return [labelsSkill]; }
  getModel() { return AGENT_DEFAULTS.explorer; }
  getPrompt(ctx: { topic: string }) { return `Look into ${ctx.topic}.`; }
  override getBriefing(ctx: { topic: string }) { return `Start with ${ctx.topic}.`; }
}

test('toSpec assembles the pieces of the agent', () => {
  const spec = new Probe().toSpec({ topic: 'x' }, { cwd: '/w', onEvent: () => {}, resume: 's1' });
  expect(spec).toMatchObject({ cwd: '/w', system: 'Look into x.', role: 'explorer', setting: AGENT_DEFAULTS.explorer, readOnly: true, resume: 's1', tools: [], skills: [labelsSkill] });
});

test('start hands the spec and the briefing to the runtime', () => {
  const runtime = new FakeRuntime();
  new Probe().start(runtime, { topic: 'y' }, { cwd: '/w', onEvent: () => {} });
  expect(runtime.sessions).toHaveLength(1);
  expect(runtime.last.spec.system).toBe('Look into y.');
});
