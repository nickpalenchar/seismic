import { afterEach, expect, test } from 'bun:test';
import { clock, setLanguage, stateLabel, t } from './strings';

afterEach(() => setLanguage('en', []));

test('the strings follow the language set, dates and numbers too', () => {
  const d = new Date(2026, 9, 6, 15, 4);
  setLanguage('en', []);
  expect(t.newCard).toBe('New task');
  expect(clock(d)).toMatch(/03:04\sPM/);
  expect(t.archive.day(d, new Date(2026, 9, 6))).toBe('Today');
  expect(t.archive.day(d, new Date(2026, 9, 9))).toBe('Tuesday, October 6');
  expect(t.share.tooLarge(12.34 * 1024 * 1024)).toContain('12.3 MB');
});

test('the browser\'s variant of the language writes dates its way', () => {
  setLanguage('en', ['en-GB']);
  expect(t.archive.day(new Date(2026, 9, 6), new Date(2026, 9, 9))).toBe('Tuesday 6 October');
  expect(clock(new Date(2026, 9, 6, 15, 4))).toBe('15:04');
});

test('a language tag Intl refuses falls back to the usual variant', () => {
  setLanguage('en', ['en-US@posix']);
  expect(clock(new Date(2026, 9, 6, 15, 4))).toMatch(/03:04\sPM/);
});

test("a proposal of the Arbeitsrückschau is labelled as Seismic's, a worker's proposal as an agent's", () => {
  setLanguage('en', []);
  expect(stateLabel({ state: 'proposal', idea: { retro: 'Two cards hit the same wall.' } })).toBe('Proposed by Seismic');
  expect(stateLabel({ state: 'proposal' })).toBe('Proposed by an agent');
  expect(stateLabel({ state: 'planned', idea: { retro: 'Two cards hit the same wall.' } })).toBe('Planned');
});

test('a card whose agent answered the owner without a new demo says so instead of "Demo ready"', () => {
  setLanguage('en', []);
  expect(stateLabel({ state: 'waiting', need: 'demo' })).toBe('Demo ready');
  expect(stateLabel({ state: 'waiting', need: 'demo', demo: { earlier: [{}] } })).toBe('2nd demo ready');
  expect(stateLabel({ state: 'waiting', need: 'demo', demo: { earlier: [{}, {}, {}] } })).toBe('4th demo ready');
  expect(stateLabel({ state: 'waiting', need: 'demo', demo: { earlier: [{ asked: true }] } })).toBe('Demo ready');
  expect(stateLabel({ state: 'waiting', need: 'demo', review: { answered: true } })).toBe('Agent answered, waiting for you');
  expect(stateLabel({ state: 'waiting', need: 'review', review: { answered: true } })).toBe('Agent answered, waiting for you');
});

test('a card whose agent paused for a restart says so in place of being at work', () => {
  setLanguage('en', []);
  expect(stateLabel({ state: 'working', hold: { reason: 'restart' } })).toBe('Paused, pending restart');
  expect(stateLabel({ state: 'working' })).toBe('Agent at work');
  expect(stateLabel({ state: 'waiting', need: 'review', review: { codeReview: { state: 'running' } } })).toBe('Agent reviewing');
});

test('a stopped card names the state it was stopped at', () => {
  setLanguage('en', []);
  expect(stateLabel({ state: 'planned', agent: { branch: 'b' } })).toBe('Stopped');
  expect(stateLabel({ state: 'planned', agent: { branch: 'b', stoppedAt: { state: 'waiting', need: 'demo' } } })).toBe('Stopped at Demo ready');
  expect(stateLabel({ state: 'planned', agent: { branch: 'b', stoppedAt: { state: 'working' } } })).toBe('Stopped at Agent at work');
});
