import { expect, test } from 'bun:test';
import { filtered, filterLog, groupLog, logChoices, logQuery, readLogQuery, weekOf } from './feedback-log';
import type { Feedback, WorkConfig } from './types';

const opusHigh: WorkConfig = { harness: 'claude', model: 'claude-opus-5-5', effort: 'high' };
const sonnet: WorkConfig = { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' };
const codex: WorkConfig = { harness: 'codex', model: 'gpt-5.5', effort: 'low' };
const unknownModel: WorkConfig = { harness: 'claude', model: null, effort: 'high' };

let n = 0;
function fb(configs: WorkConfig[], answer: Feedback['answer'], at: string, more: Partial<Feedback> = {}): Feedback {
  n++;
  const attribution = !configs.length ? 'missing' : configs.length > 1 ? 'mixed' : 'single';
  return {
    id: n,
    cardId: `card-${n}`,
    short: `k${n}`,
    canvasId: 'c',
    handover: n,
    title: `Card ${n}`,
    repo: 'home',
    attribution,
    configs,
    ...(attribution === 'single' ? { credited: configs[0] } : {}),
    answer,
    at: `${at}T10:00:00.000Z`,
    ...more,
  };
}

const NOW = Date.parse('2026-11-04T12:00:00Z');
const a = fb([opusHigh], { rating: 5, comment: 'Clean.' }, '2026-11-03', { plan: { id: 'p1', title: 'Voice' } });
const b = fb([sonnet], { rating: 2 }, '2026-10-20', { repo: 'site', canvasId: 'd' });
const c = fb([opusHigh, codex], { rating: 4 }, '2026-09-01');
const d = fb([], { comment: 'Only words.' }, '2026-11-02', { plan: { id: 'p2', title: 'Archive' } });
const e = fb([codex], { rating: 3 }, '2026-08-15', { updatedAt: '2026-11-04T08:00:00.000Z' });
const f = fb([unknownModel], { rating: 4.6 }, '2026-10-31');
const all = [a, b, c, d, e, f];
const ids = (l: Feedback[]) => l.map((x) => x.id);

test('the log lists every response the newest first, by when it was last given', () => {
  expect(ids(filterLog(all, {}, NOW))).toEqual(ids([e, a, d, f, b, c]));
});

test("the dashboard's filters narrow the log: canvas, repository, plan and period", () => {
  expect(ids(filterLog(all, { canvas: 'd' }, NOW))).toEqual([b.id]);
  expect(ids(filterLog(all, { repo: 'home', plan: 'p1' }, NOW))).toEqual([a.id]);
  // the last 30 days, by when a response was last given: e was changed yesterday
  expect(ids(filterLog(all, { period: '30' }, NOW))).toEqual(ids([e, a, d, f, b]));
  expect(ids(filterLog(all, { period: 'all' }, NOW))).toHaveLength(6);
});

test('harness, model and effort match the credited configuration; work credited to no one configuration matches none', () => {
  expect(ids(filterLog(all, { harness: 'codex' }, NOW))).toEqual([e.id]);
  expect(ids(filterLog(all, { harness: 'claude', effort: 'high' }, NOW))).toEqual(ids([a, f]));
  expect(ids(filterLog(all, { model: 'claude-sonnet-5-5' }, NOW))).toEqual([b.id]);
  // an unknown model is the empty string
  expect(ids(filterLog(all, { model: '' }, NOW))).toEqual([f.id]);
});

test('rating filters by whole stars, or responses with a comment only', () => {
  expect(ids(filterLog(all, { rating: '5' }, NOW))).toEqual(ids([a, f]));
  expect(ids(filterLog(all, { rating: 'none' }, NOW))).toEqual([d.id]);
  expect(filterLog(all, { rating: '1' }, NOW)).toEqual([]);
});

test('filtered says whether any filter is set; the whole period is none', () => {
  expect(filtered({})).toBe(false);
  expect(filtered({ period: 'all' })).toBe(false);
  expect(filtered({ period: '30' })).toBe(true);
  expect(filtered({ model: '' })).toBe(true);
});

test('the choices are what the credited configurations hold, unknown last, efforts in their order', () => {
  expect(logChoices(all)).toEqual({ harnesses: ['claude', 'codex'], models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-5.5', ''], efforts: ['low', 'medium', 'high'] });
  expect(logChoices([])).toEqual({ harnesses: [], models: [], efforts: [] });
});

test('weeks start on Monday', () => {
  expect(weekOf('2026-11-04T10:00:00Z')).toBe('2026-11-02');
  expect(weekOf('2026-11-02T00:00:00Z')).toBe('2026-11-02');
  expect(weekOf('2026-11-01T23:00:00Z')).toBe('2026-10-26');
});

test('grouped by configuration in the dashboard’s order, mixed and unrecorded work last, each with its count and average', () => {
  const g = groupLog(filterLog(all, {}, NOW), 'config');
  expect(g.map((s) => s.key)).toEqual(['claude|claude-opus-5-5|high', 'claude|claude-sonnet-5-5|medium', 'claude||high', 'codex|gpt-5.5|low', 'mixed', 'missing']);
  expect(g[0]).toMatchObject({ config: opusHigh, ratings: 1, mean: 5 });
  expect(g.at(-1)).toMatchObject({ ratings: 0, mean: null });
  expect(g.at(-1)!.config).toBeUndefined();
});

test('grouped by time the newest first; within a section the newest first too', () => {
  const months = groupLog(filterLog(all, {}, NOW), 'month');
  expect(months.map((s) => s.key)).toEqual(['2026-11', '2026-10', '2026-09']);
  expect(ids(months[0]!.responses)).toEqual(ids([e, a, d]));
  expect(groupLog(filterLog(all, {}, NOW), 'week').map((s) => s.key)).toEqual(['2026-11-02', '2026-10-26', '2026-10-19', '2026-08-31']);
});

test('grouped by plan, repository or canvas by name, those without one last', () => {
  const p = groupLog(filterLog(all, {}, NOW), 'plan');
  expect(p.map((s) => s.title ?? s.key)).toEqual(['Archive', 'Voice', '']);
  expect(groupLog(all, 'repo').map((s) => s.key)).toEqual(['home', 'site']);
  expect(groupLog(all, 'canvas').map((s) => s.key)).toEqual(['c', 'd']);
  expect(groupLog(all, 'none')).toHaveLength(1);
  expect(groupLog([], 'month')).toEqual([]);
});

test('the state round-trips through the query, leaving out what is not set or not known', () => {
  const state = { filter: { canvas: 'c', plan: 'p1', period: '90' as const, model: '', rating: 'none' }, group: 'week' as const };
  expect(readLogQuery(logQuery(state))).toEqual(state);
  expect(logQuery({ filter: { period: 'all' }, group: 'none' })).toBe('');
  expect(readLogQuery('?period=7&rating=9&group=year&canvas=')).toEqual({ filter: {}, group: 'none' });
});

test('reads the old query names project and group=project as plan', () => {
  expect(readLogQuery('?project=p1&group=project')).toEqual({ filter: { plan: 'p1' }, group: 'plan' });
});
