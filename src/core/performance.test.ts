import { expect, test } from 'bun:test';
import { ageStep, FEW, filterChoices, filterFeedback, performance, scatter, trend } from './performance';
import type { Feedback, WorkConfig } from './types';

const opusHigh: WorkConfig = { harness: 'claude', model: 'claude-opus-5-5', effort: 'high', requested: 'opus' };
const opusMedium: WorkConfig = { harness: 'claude', model: 'claude-opus-5-5', effort: 'medium' };
const sonnet: WorkConfig = { harness: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' };
const codex: WorkConfig = { harness: 'codex', model: 'gpt-5.5', effort: 'low' };
const unknownModel: WorkConfig = { harness: 'claude', model: null, effort: 'high' };

let n = 0;
function fb(configs: WorkConfig[], answer: Feedback['answer'], more: Partial<Feedback> = {}): Feedback {
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
    at: `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`,
    ...more,
  };
}

test('responses group by the configuration they credit; mixed and unrecorded work have rows of their own, last', () => {
  const list = [
    fb([sonnet], { rating: 3 }),
    fb([opusHigh], { rating: 5, comment: 'Clean.' }),
    fb([opusHigh, codex], { rating: 2 }),
    fb([], { rating: 4 }),
    fb([opusHigh], { rating: 4 }),
    fb([codex], { rating: 5 }),
    fb([opusMedium], { comment: 'Only words.' }),
    fb([unknownModel], { rating: 1 }),
  ];
  const p = performance(list);
  // by harness, model (unknown last) and effort in its order, never by how well a row did
  expect(p.rows.map((r) => r.key)).toEqual(['claude|claude-opus-5-5|medium', 'claude|claude-opus-5-5|high', 'claude|claude-sonnet-5-5|medium', 'claude||high', 'codex|gpt-5.5|low', 'mixed', 'missing']);
  const high = p.rows[1]!;
  expect(high).toMatchObject({ kind: 'config', ratings: [5, 4], counts: [0, 0, 0, 1, 1], mean: 4.5, median: 4.5, comments: 1, few: true });
  // the alias it was asked for does not split a row
  expect(high.config).toEqual({ harness: 'claude', model: 'claude-opus-5-5', effort: 'high' });
  // the latest response first
  expect(high.responses.map((f) => f.id)).toEqual([list[4]!.id, list[1]!.id]);
  // a comment without stars counts as a response, not as a rating
  expect(p.rows[0]).toMatchObject({ ratings: [], mean: null, median: null, comments: 1 });
  expect(p.rows[5]).toMatchObject({ kind: 'mixed', ratings: [2] });
  expect(p.rows[6]).toMatchObject({ kind: 'missing', ratings: [4] });
  expect(p).toMatchObject({ responses: 8, ratings: 7, uncredited: 2 });
});

test('a row has few ratings until it has FEW; ratings are whole stars from 1 to 5', () => {
  const list = Array.from({ length: FEW }, (_, k) => fb([opusHigh], { rating: k === 0 ? 7 : k === 1 ? 0.2 : 3.6 }));
  const before = performance(list.slice(0, FEW - 1)).rows[0]!;
  expect(before.few).toBe(true);
  const row = performance(list).rows[0]!;
  expect(row.few).toBe(false);
  expect(row.ratings).toEqual([5, 1, 4, 4, 4]);
  expect(row.median).toBe(4);
});

test('nothing given is an empty table', () => {
  expect(performance([])).toEqual({ rows: [], responses: 0, ratings: 0, uncredited: 0 });
});

test('filters by canvas, repository, plan and since when; the choices are what responses were given in', () => {
  const list = [
    fb([opusHigh], { rating: 5 }, { canvasId: 'a', repo: 'web', plan: { id: 'p1', title: 'Billing' }, at: '2026-09-01T00:00:00.000Z' }),
    fb([opusHigh], { rating: 4 }, { canvasId: 'b', repo: 'api', at: '2026-11-01T00:00:00.000Z' }),
    // changed lately: counts from its change
    fb([sonnet], { rating: 2 }, { canvasId: 'a', repo: 'api', plan: { id: 'p2', title: 'Auth' }, at: '2026-08-01T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' }),
  ];
  const ids = (f: Parameters<typeof filterFeedback>[1]) => filterFeedback(list, f).map((x) => x.id);
  expect(ids({})).toEqual(list.map((x) => x.id));
  expect(ids({ canvas: 'a' })).toEqual([list[0]!.id, list[2]!.id]);
  expect(ids({ repo: 'api' })).toEqual([list[1]!.id, list[2]!.id]);
  expect(ids({ plan: 'p1' })).toEqual([list[0]!.id]);
  expect(ids({ since: '2026-10-15T00:00:00.000Z' })).toEqual([list[1]!.id, list[2]!.id]);
  expect(ids({ canvas: 'b', plan: 'p1' })).toEqual([]);
  expect(filterChoices(list)).toEqual({ canvases: ['a', 'b'], repos: ['api', 'web'], plans: [{ id: 'p2', title: 'Auth' }, { id: 'p1', title: 'Billing' }] });
});

test('the trend is each row’s average per month, over every month from the first to the last', () => {
  const list = [
    fb([opusHigh], { rating: 5 }, { at: '2026-08-03T00:00:00.000Z' }),
    fb([opusHigh], { rating: 3 }, { at: '2026-10-03T00:00:00.000Z' }),
    fb([opusHigh], { rating: 4 }, { at: '2026-10-20T00:00:00.000Z' }),
    fb([sonnet], { comment: 'no stars' }, { at: '2026-11-01T00:00:00.000Z' }),
    fb([sonnet], { rating: 2 }, { at: '2026-07-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }),
  ];
  const t = trend(performance(list).rows);
  expect(t.months).toEqual(['2026-08', '2026-09', '2026-10']);
  expect(t.series).toEqual([
    { key: 'claude|claude-opus-5-5|high', points: [{ month: '2026-08', mean: 5, n: 1 }, { month: '2026-10', mean: 3.5, n: 2 }] },
    { key: 'claude|claude-sonnet-5-5|medium', points: [{ month: '2026-10', mean: 2, n: 1 }] },
  ]);
  expect(trend([])).toEqual({ months: [], series: [] });
});

test('a response’s age is one of five steps, by when it was last given', () => {
  const now = Date.parse('2026-11-03T12:00:00.000Z');
  const aged = (days: number, more: Partial<Feedback> = {}) => ageStep(fb([opusHigh], { rating: 4 }, { at: new Date(now - days * 86_400_000).toISOString(), ...more }), now);
  expect([0, 3, 3.5, 7, 8, 30, 45, 60, 61, 400].map((d) => aged(d))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  expect(aged(200, { updatedAt: new Date(now - 86_400_000).toISOString() })).toBe(0);
});

test('a dot’s place in its cloud is within its bounds and the same for the same seed', () => {
  for (let seed = 1; seed < 200; seed++) {
    const [x, y] = scatter(seed);
    expect(Math.abs(x)).toBeLessThanOrEqual(1);
    expect(Math.abs(y)).toBeLessThanOrEqual(1);
    expect(scatter(seed)).toEqual([x, y]);
  }
  expect(scatter(1)).not.toEqual(scatter(2));
});
