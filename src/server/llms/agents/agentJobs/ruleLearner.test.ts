import { expect, test } from 'bun:test';
import { FakeRuleBoard, FakeRuntime, fakeCard } from '../../../testing';
import { learnFrom } from './ruleLearner';

const run = (over: Partial<Parameters<typeof learnFrom>[0]> = {}, fakeOver: ConstructorParameters<typeof FakeRuleBoard>[0] = {}) => {
  const fake = new FakeRuleBoard(fakeOver);
  const runtime = new FakeRuntime();
  const done = learnFrom({
    runtime, board: fake.board, cwd: '/app', language: 'English unless a preference names another', card: fakeCard('c1', 'Export'), kind: 'answer',
    text: 'Always the short version.', context: { question: 'Short or long?' }, around: ['The card’s text:\nExport it.'], ...over,
  });
  return { ...fake, runtime, done };
};

test('the learner reads the input with its card, context and rules in a read-only Koordinator session', () => {
  const { runtime } = run({ context: { question: 'Short or long?', reply: 'Short.', before: 'Old text' } }, { active: ['Ask little.'], preferences: 'Be brief.' });
  expect(runtime.last.spec).toMatchObject({ cwd: '/app', role: 'koordinator', permission: 'readOnly' });
  expect(runtime.last.spec.system.endsWith('\n\nBe brief.')).toBe(true);
  const brief = runtime.last.inbox[0]!;
  expect(brief).toContain('Card: "Export".');
  expect(brief).toContain('The card’s text:\nExport it.');
  expect(brief).toContain('The worker asked: Short or long?');
  expect(brief).toContain("Before the owner wrote in it, the card's text read:\nOld text");
  expect(brief).toContain("The owner's answer: Always the short version.");
  expect(brief).toContain('You replied: Short.');
  expect(brief).toContain('1. Ask little.');
  expect(brief).toContain("(the card's)");
});

test('without a card the brief names none, and a talk names the card the owner had open', () => {
  expect(run({ card: null, kind: 'talk' }).runtime.last.inbox[0]).not.toContain('Card');
  expect(run({ kind: 'talk' }).runtime.last.inbox[0]).toContain('Card the owner had open: "Export".');
});

test('a proposal carries the input as its quote and the card, is logged on the card, and ends the session', async () => {
  const { runtime, proposals, logs, done } = run({}, { active: ['Ask little.'] });
  expect(runtime.last.call('propose', { rule: ' Short answers. ', replaces: 1 })).toBe('Proposed. End your turn now.');
  await done;
  expect(proposals).toEqual([{ text: 'Short answers.', source: { cardId: 'c1', quote: 'Always the short version.' }, replaces: 'r1', target: undefined }]);
  expect(logs).toEqual(['proposes: Short answers.']);
});

test('one proposal per input, none twice, none for a repository the project lacks', () => {
  const { runtime, proposals } = run();
  expect(runtime.last.call('propose', { rule: 'X.', repos: ['nope'] })).toContain('Unknown repository nope');
  runtime.last.call('propose', { rule: 'X.', repos: ['api', 'home'] });
  expect(proposals.map((p) => p.target)).toEqual(['api', 'home']);
  expect(runtime.last.call('propose', { rule: 'Y.' })).toBe('One proposal per input. End your turn now.');
  const again = run();
  again.runtime.last.call('propose', { rule: 'X.', repos: ['api'] });
});

test('a rule that already waits is not proposed again, and nothing to record ends the session', async () => {
  const fake = new FakeRuleBoard();
  fake.board.proposePreference('X.', {}, undefined, 'api');
  const runtime = new FakeRuntime();
  const done = learnFrom({ runtime, board: fake.board, cwd: '/app', language: 'English', card: null, kind: 'talk', text: 't', context: {}, around: [] });
  expect(runtime.last.call('propose', { rule: 'X.', repos: ['api'] })).toBe('Already proposed. End your turn now.');
  await done;
  const none = run();
  none.runtime.last.call('nothing', {});
  await none.done;
  expect(none.proposals).toEqual([]);
});
