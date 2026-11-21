import { expect, test } from 'bun:test';
import { MESSAGES } from '../../../../core/messages';
import { FakeRuntime } from '../../../testing';
import { type ExplorerContext, explorerAgent } from './explorerAgent';

/** What the tools read when they are built: the board's languages. Calling them needs a running `Explorers` (`ideas.test.ts`). */
const host = { o: { board: { conversation: () => 'en', language: () => 'en', t: MESSAGES.en } }, live: new Map(), answer: () => {} } as never;

/** Only what the prompt and the options are read from: the tools need a running `Explorers` (`ideas.test.ts` covers them). */
const context = (over: Partial<ExplorerContext> = {}): ExplorerContext =>
  ({ conversation: 'en', ui: 'en', repository: 'en', toSeismic: false, preferences: '', message: 'Hello.', options: { at: { card: 'c1' } }, ...over }) as ExplorerContext;

test('the explorer is the explorer role with no permission of its own, so the harness follows the owner', () => {
  const spec = explorerAgent.toSpec(context({ host, live: {} as never, cardId: 'c1' }), { cwd: '/w', onEvent: () => {} });
  expect(spec.role).toBe('explorer');
  expect(spec.permission).toBeUndefined();
  expect(spec.setting).toBeUndefined();
  expect(spec.at).toEqual({ card: 'c1' });
});

test('its preferences are added to the instructions, and its first message is the one handed in', () => {
  const none = explorerAgent.getPrompt(context());
  const some = explorerAgent.getPrompt(context({ preferences: 'Be brief.' }));
  expect(some).toBe(`${none}\n\nBe brief.`);
  expect(explorerAgent.getBriefing(context())).toBe('Hello.');
  const runtime = new FakeRuntime();
  explorerAgent.start(runtime, context({ host, live: {} as never, cardId: 'c1' }), { cwd: '/w', onEvent: () => {} });
  expect(runtime.last.inbox).toEqual(['Hello.']);
});

test('a session from scratch is briefed with the card before what the owner said; a resumed one hears only the words', () => {
  const board = { ...(host as { o: { board: object } }).o.board, decisions: () => [], idea: () => ({ brief: '', mocks: [], variants: [] }), talkOf: () => [] };
  const briefed = { ...(host as object), o: { board } } as never;
  const card = { id: 'c1', title: 'Export readings', body: 'As a tenant I want a CSV.', idea: undefined, images: [] } as never;
  const fresh = explorerAgent.getBriefing(context({ host: briefed, start: { card, shots: [], said: [] } }));
  expect(fresh).toContain('The idea: “Export readings”.');
  expect(fresh).toContain('As a tenant I want a CSV.');
  expect(fresh.endsWith('\n\nHello.')).toBe(true);
  expect(explorerAgent.getBriefing(context())).toBe('Hello.');
});
