import { expect, test } from 'bun:test';
import { FakeRuleBoard, FakeRuntime, heard } from '../../../helpers/testing';
import { proposeRulesFromHistory } from '../../../../llms/agents/agentJobs/proposeRulesFromHistory';

const run = async (over: ConstructorParameters<typeof FakeRuleBoard>[0] = {}) => {
  const fake = new FakeRuleBoard(over);
  const runtime = new FakeRuntime();
  const done = proposeRulesFromHistory({ runtime, board: fake.board, cwd: '/home', language: 'German unless a preference names another', history: ['- 2026-11-20 10:00 "A": the owner deleted it'] });
  await heard();
  return { ...fake, runtime, done };
};

test('the retrospective reads the history and the rules in a read-only Koordinator session, the owner’s preferences after its instructions', async () => {
  const { runtime } = await run({ active: ['Ask little.'], preferences: 'Be brief.' });
  expect(runtime.last.spec).toMatchObject({ cwd: '/home', role: 'koordinator', permission: 'readOnly' });
  expect(runtime.last.spec.system.endsWith('\n\nBe brief.')).toBe(true);
  const brief = runtime.last.inbox[0]!;
  expect(brief).toContain('oldest first:\n- 2026-11-20 10:00 "A": the owner deleted it');
  expect(brief).toContain('1. Ask little.');
  expect(brief).toContain('- home: App, at /app (the home repository)');
  expect(runtime.last.spec.tools.find((t) => t.name === 'propose')?.description).toContain('in German unless a preference names another');
});

test('a rule is proposed with why as its quote, replacing a recorded rule by its number, once per target', async () => {
  const { runtime, proposals, done } = await run({ active: ['Ask little.'] });
  expect(runtime.last.call('propose', { rule: ' Short questions. ', why: 'Seen twice.', replaces: 1, repos: ['api'] })).toBe('Proposed.');
  expect(proposals).toEqual([{ text: 'Short questions.', source: { review: true, quote: 'Seen twice.' }, replaces: 'r1', target: 'api' }]);
  expect(runtime.last.call('propose', { rule: 'Short questions.', why: 'x', repos: ['api'] })).toBe('Already proposed.');
  expect(runtime.last.call('propose', { rule: 'Other.', why: 'x', repos: ['nope'] })).toContain('Unknown repository nope');
  expect(runtime.last.call('propose', { rule: '  ', why: 'x' })).toBe('Empty rule ignored.');
  runtime.last.call('done', {});
  await done;
});

test('it ends after the third proposal', async () => {
  const { runtime, proposals, done } = await run();
  runtime.last.call('propose', { rule: 'One.', why: 'a' });
  runtime.last.call('propose', { rule: 'Two.', why: 'a' });
  expect(runtime.last.call('propose', { rule: 'Three.', why: 'a' })).toContain('That was the last one');
  await done;
  expect(proposals.map((p) => p.text)).toEqual(['One.', 'Two.', 'Three.']);
});
