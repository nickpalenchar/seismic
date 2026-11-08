import { expect, test } from 'bun:test';
import { agentStage, byStage } from './agents';
import type { Finding, Item } from './types';

const card = (id: string, over: Partial<Item> = {}): Item => ({ id, kind: 'task', state: 'working', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...over });
const finding = (over: Partial<Finding>): Finding => ({ id: 1, title: 'f', text: '', status: 'open', ...over });

test('a card at work is in the stage its agent is at', () => {
  expect(agentStage(card('a'))).toBe('working');
  expect(agentStage(card('a', { state: 'inPr' }))).toBe('working');
  expect(agentStage(card('a', { doing: 'recordingDemo' }))).toBe('demo');
  expect(agentStage(card('a', { doing: 'debugging' }))).toBe('working');
  expect(agentStage(card('a', { codeReview: { mode: 'auto', state: 'done', findings: [finding({ decided: 'self' })] } }))).toBe('fixing');
  expect(agentStage(card('a', { codeReview: { mode: 'auto', state: 'done', findings: [finding({ status: 'fixed', decided: 'self' }), finding({ decided: 'later' })] } }))).toBe('working');
});

test('a running code review counts while its card waits for the owner', () => {
  expect(agentStage(card('a', { state: 'waiting', need: 'demo', codeReview: { mode: 'auto', state: 'running' } }))).toBe('reviewing');
  expect(agentStage(card('a', { state: 'waiting', need: 'demo' }))).toBeUndefined();
});

test('planned, queued, finished, archived and other kinds of cards are not at work', () => {
  for (const over of [{ state: 'planned' }, { state: 'live' }, { state: 'done' }, { state: 'idea' }, { state: 'proposal' }, { queue: { reason: 'r', behind: ['b'] } }, { archivedAt: '2026-11-01T00:00:00Z' }, { kind: 'plan' }] as Partial<Item>[])
    expect(agentStage(card('a', over))).toBeUndefined();
});

test('the stages come in their order, empty ones left out', () => {
  const g = byStage([card('d', { doing: 'preparingDemo' }), card('w1'), card('p', { state: 'planned' }), card('w2')]);
  expect(g.map((x) => [x.stage, x.items.map((i) => i.id)])).toEqual([['working', ['w1', 'w2']], ['demo', ['d']]]);
});
