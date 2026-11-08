import { expect, test } from 'bun:test';
import { agentStage, byStage } from './agents';
import type { Finding, Item } from './types';

const card = (id: string, over: Partial<Item> = {}): Item => ({ id, kind: 'task', state: 'working', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...over });
const finding = (over: Partial<Finding>): Finding => ({ id: 1, title: 'f', text: '', status: 'open', ...over });

test('a card at work is in the stage its agent is at', () => {
  expect(agentStage(card('a'))).toBe('working');
  expect(agentStage(card('a', { agent: { doing: 'recordingDemo' } }))).toBe('working');
  expect(agentStage(card('a', { agent: { doing: 'debugging' } }))).toBe('working');
  expect(agentStage(card('a', { review: { codeReview: { mode: 'auto', state: 'done', findings: [finding({ decided: 'self' })] } } }))).toBe('fixing');
  expect(agentStage(card('a', { review: { codeReview: { mode: 'auto', state: 'done', findings: [finding({ status: 'fixed', decided: 'self' }), finding({ decided: 'later' })] } } }))).toBe('working');
  expect(agentStage(card('a', { state: 'waiting', need: 'demo', review: { codeReview: { mode: 'auto', state: 'running' } } }))).toBe('reviewing');
});

test('whatever needs the owner leaves its own stage, of any kind', () => {
  expect(agentStage(card('a', { state: 'waiting', need: 'demo' }))).toBe('needsYou');
  expect(agentStage(card('a', { state: 'waiting', need: 'question', review: { codeReview: { mode: 'auto', state: 'running' } } }))).toBe('needsYou');
  expect(agentStage(card('a', { state: 'proposal' }))).toBe('needsYou');
  expect(agentStage(card('a', { kind: 'plan', state: 'waiting', need: 'question' }))).toBe('needsYou');
  // just answered: out of Needs you, as the inbox leaves it out, until the server moves the card on
  expect(agentStage(card('a', { state: 'waiting', need: 'question' }), true)).toBe('working');
  expect(byStage([card('a', { state: 'proposal' })], (id) => id === 'a')).toEqual([]);
});

test('approved work and work in a pull request is landing; a planned card not queued is planned', () => {
  expect(agentStage(card('a', { state: 'approved' }))).toBe('landing');
  expect(agentStage(card('a', { state: 'inPr' }))).toBe('landing');
  expect(agentStage(card('a', { state: 'waiting', need: 'demo', review: { landing: true } }))).toBe('landing');
  expect(agentStage(card('a', { state: 'planned' }))).toBe('planned');
});

test('queued, finished, archived cards, other kinds and ideas without a question are left out', () => {
  for (const over of [{ state: 'planned', queue: { reason: 'r', behind: ['b'] } }, { state: 'live' }, { state: 'done' }, { state: 'idea' }, { archivedAt: '2026-11-01T00:00:00Z' }, { kind: 'plan' }] as Partial<Item>[])
    expect(agentStage(card('a', over))).toBeUndefined();
});

test('the stages come in their order, empty ones left out', () => {
  const g = byStage([card('p', { state: 'planned' }), card('d', { agent: { doing: 'preparingDemo' } }), card('w1'), card('n', { state: 'waiting', need: 'review' }), card('w2')]);
  expect(g.map((x) => [x.stage, x.items.map((i) => i.id)])).toEqual([['needsYou', ['n']], ['working', ['d', 'w1', 'w2']], ['planned', ['p']]]);
});
