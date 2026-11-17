import { expect, test } from 'bun:test';
import { FakeRuntime } from '../../../testing';
import { reviewerAgent, type ReviewerContext } from './reviewerAgent';

const context = (over: Partial<ReviewerContext> = {}): ReviewerContext => ({
  setting: undefined,
  language: 'English',
  preferences: '',
  resumed: false,
  card: { title: 'Export', body: 'Add an export.' },
  summary: 'Done.',
  files: [{ file: 'a.ts', status: 'modified', added: 2, removed: 1 }],
  truncated: false,
  patch: '+x',
  itemsText: '(none)',
  maxNewItems: 30,
  nextNumber: 1,
  record: () => undefined,
  ...over,
});

test('the reviewer is a read-only review session that reads the diff in its brief', () => {
  const runtime = new FakeRuntime();
  reviewerAgent.start(runtime, context(), { cwd: '/w', onEvent: () => {} });
  expect(runtime.last.spec).toMatchObject({ cwd: '/w', role: 'review', permission: 'readOnly' });
  expect(runtime.last.spec.setting).toBeUndefined();
  const brief = runtime.last.inbox[0]!;
  expect(brief).toContain('<card-title>Export</card-title>');
  expect(brief).toContain('<diff against="main">\n+x\n</diff>');
  expect(brief).toContain('- a.ts (modified, +2 −1)');
});

test('a resumed session gets the short reminder and its saved session id', () => {
  const runtime = new FakeRuntime();
  reviewerAgent.start(runtime, context({ resumed: true }), { cwd: '/w', onEvent: () => {}, resume: 's1' });
  expect(runtime.last.spec.resume).toBe('s1');
  expect(runtime.last.inbox[0]).not.toContain('<diff');
});

test('the review tool hands what was recorded to the service, and tells the agent why it was refused', () => {
  const runtime = new FakeRuntime();
  let got: unknown;
  let refuse: string | undefined = 'item 3 is not under review.';
  reviewerAgent.start(runtime, context({ record: (g) => ((got = g), refuse) }), { cwd: '/w', onEvent: () => {} });
  const args = { verdicts: [], regressions: [], items: [{ title: 't', text: 'x', severity: 'minor' }] };
  expect(runtime.last.call('review', args)).toBe('Not recorded: item 3 is not under review. Call review again with the whole review.');
  refuse = undefined;
  expect(runtime.last.call('review', args)).toBe('Recorded. End your turn now.');
  expect(got).toMatchObject({ items: [{ title: 't' }] });
});
