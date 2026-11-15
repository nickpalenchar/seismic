import { expect, test } from 'bun:test';
import { agentStage, agentWork } from './agents';
import type { Item, ReviewItem } from './types';

const card = (id: string, over: Partial<Item> = {}): Item => ({ id, kind: 'task', state: 'working', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', canvasVisible: true, ...over });
const item = (status: ReviewItem['status']): ReviewItem => ({ number: 1, title: 'f', text: '', severity: 'minor', status, log: [] });

test('a card at work is in the stage its agent is at', () => {
  expect(agentStage(card('a'))).toBe('working');
  expect(agentStage(card('a', { agent: { doing: 'recordingDemo' } }))).toBe('working');
  expect(agentStage(card('a', { agent: { doing: 'debugging' } }))).toBe('working');
  expect(agentStage(card('a', { review: { codeReview: { mode: 'auto', state: 'done', items: [item('fixing')] } } }))).toBe('fixing');
  expect(agentStage(card('a', { review: { codeReview: { mode: 'auto', state: 'done', items: [item('underReview'), item('followUp')] } } }))).toBe('working');
  expect(agentStage(card('a', { state: 'waiting', need: 'demo', review: { codeReview: { mode: 'auto', state: 'running', items: [] } } }))).toBe('reviewing');
});

test('whatever needs the owner leaves its own stage, of any kind', () => {
  expect(agentStage(card('a', { state: 'waiting', need: 'demo' }))).toBe('needsYou');
  expect(agentStage(card('a', { state: 'waiting', need: 'question', review: { codeReview: { mode: 'auto', state: 'running', items: [] } } }))).toBe('needsYou');
  expect(agentStage(card('a', { state: 'proposal' }))).toBe('needsYou');
  expect(agentStage(card('a', { kind: 'plan', state: 'waiting', need: 'question' }))).toBe('needsYou');
  // just answered: out of Needs you, as the inbox leaves it out, until the server moves the card on
  expect(agentStage(card('a', { state: 'waiting', need: 'question' }), true)).toBe('working');
  expect(agentWork([card('a', { state: 'proposal' })], (id) => id === 'a')).toEqual({ working: [], planned: [] });
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

test('Agent work holds the cards at work and the planned ones, none that needs the owner', () => {
  const g = agentWork([card('p', { state: 'planned' }), card('d', { agent: { doing: 'preparingDemo' } }), card('w1'), card('n', { state: 'waiting', need: 'review' }), card('l', { state: 'approved' }), card('w2')]);
  expect([g.working.map((i) => i.id), g.planned.map((i) => i.id)]).toEqual([['d', 'w1', 'l', 'w2'], ['p']]);
});
