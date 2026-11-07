import { expect, test } from 'bun:test';
import { inboxEntries, waitingCount } from './inbox';
import type { Item, Talk, Waiting } from './types';

const card = (id: string, since: string, over: Partial<Item> = {}): Item => ({ id, kind: 'task', state: 'waiting', need: 'demo', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', waitingSince: since, ...over });
const talk = (id: number, at: string, unread = true): Talk => ({ id, at, said: 'q', answer: `answer ${id}`, ...(unread ? { unread: true as const } : {}) });
const site = { id: 'site', name: 'Site' };
const app = { id: 'app', name: 'App' };
const w = (items: Item[], t: Talk[] = []): Waiting => ({ items, talk: t });

test('entries of every canvas come in one list, the longest wait first', () => {
  const e = inboxEntries([site, app], {
    site: w([card('s-new', '2026-11-05T10:00:00Z'), card('s-old', '2026-11-05T08:00:00Z')]),
    app: w([card('a-mid', '2026-11-05T09:00:00Z')]),
  });
  expect(e.map((x) => x.card?.id)).toEqual(['s-old', 'a-mid', 's-new']);
  expect(e.map((x) => x.canvasName)).toEqual(['Site', 'App', 'Site']);
});

test('Seismic’s latest unread answer is an entry, placed by when it came', () => {
  const e = inboxEntries([site, app], {
    site: w([card('s', '2026-11-05T08:00:00Z')]),
    app: w([], [talk(1, '2026-11-05T07:00:00Z'), talk(2, '2026-11-05T09:00:00Z'), talk(3, '2026-11-05T10:00:00Z', false)]),
  });
  expect(e.map((x) => x.key)).toEqual(['site/s', 'app/obeya']);
  expect(e[1]).toMatchObject({ canvas: 'app', text: 'answer 2', since: '2026-11-05T09:00:00Z' });
  expect(e[1]!.card).toBeUndefined();
});

test('equal waits keep the canvases’ order and, within one, Tab’s', () => {
  const at = '2026-11-05T08:00:00Z';
  const e = inboxEntries([app, site], { site: w([card('s1', at), card('s2', at)]), app: w([card('a1', at)]) });
  expect(e.map((x) => x.card?.id)).toEqual(['a1', 's1', 's2']);
});

test('a card the owner just answered leaves the list; one that waits for nobody is not in it', () => {
  const e = inboxEntries([site], { site: w([card('done', '2026-11-05T08:00:00Z'), card('working', '2026-11-05T08:00:00Z', { state: 'working' }), card('next', '2026-11-05T09:00:00Z')]) }, (id) => id === 'done');
  expect(e.map((x) => x.card?.id)).toEqual(['next']);
});

test('a card snoozed while it waited does not appear in the inbox', () => {
  const snoozed = card('later', '2026-11-05T07:00:00Z', { snoozed: { until: '2026-11-06T08:00:00Z', waiting: true } as Item['snoozed'] });
  const e = inboxEntries([site, app], { site: w([snoozed, card('s', '2026-11-05T08:00:00Z')]), app: w([card('a', '2026-11-05T09:00:00Z')]) });
  expect(e.map((x) => x.card?.id)).toEqual(['s', 'a']);
  expect(waitingCount(e)).toBe(2);
  expect(waitingCount(e, 'site')).toBe(1);
  expect(waitingCount(e, 'app')).toBe(1);
});

test('what the entry waits for: the question, else the handover’s summary', () => {
  const e = inboxEntries([site], {
    site: w([card('q', '2026-11-05T08:00:00Z', { need: 'question', question: { text: 'Which one?', options: ['A', 'B'] } }), card('d', '2026-11-05T09:00:00Z', { summary: 'Done it.' })]),
  });
  expect(e.map((x) => x.text)).toEqual(['Which one?', 'Done it.']);
});

test('a canvas the server has not reported yet adds nothing', () => {
  expect(inboxEntries([site], {})).toEqual([]);
});

 test('rule and setting proposals count separately on their canvas', () => {
  const entries = inboxEntries([site, app], { site: { ...w([]), preferences: [{ id: 1, state: 'proposed', text: 'A rule' }, { id: 2, state: 'active', text: 'Active' }], settingProposals: [{ id: 1, repo: 'r', field: 'checks', value: 'test', basis: 'Check it', cards: [] }] }, app: w([]) });
  expect(entries.map((e) => e.key)).toEqual(['site/preference/1', 'site/setting/1']);
  expect(waitingCount(entries, 'site')).toBe(2);
 });


test('mobile puts the latest card update first across canvases, including a refreshed handover', () => {
  const old = '2026-11-05T08:00:00Z';
  const mid = '2026-11-05T09:00:00Z';
  const latest = '2026-11-05T10:00:00Z';
  const refreshed = card('refreshed', old, { updatedAt: latest, summary: 'New demo ready' });
  const snapshots = { site: w([card('other', mid, { updatedAt: mid })]), app: w([refreshed], [talk(1, mid)]) };
  const entries = inboxEntries([site, app], snapshots, undefined, 'updated');
  expect(entries.map((e) => e.key)).toEqual(['app/refreshed', 'site/other', 'app/obeya']);
  expect(entries[0]!.since).toBe(old);
  expect(inboxEntries([site, app], snapshots)[0]!.card?.id).toBe('refreshed');
  const changed = { ...snapshots, app: w([{ ...refreshed, updatedAt: old }], [talk(1, mid)]) };
  expect(inboxEntries([site, app], changed, undefined, 'updated').at(-1)!.card?.id).toBe('refreshed');
});

test('mobile falls back to creation or waiting time, with stable ties', () => {
  const at = '2026-11-05T08:00:00Z';
  const snapshots = { site: w([card('created', at, { createdAt: '2026-11-05T09:00:00Z' }), card('one', at), card('two', at)]) };
  expect(inboxEntries([site], snapshots, undefined, 'updated').map((e) => e.card?.id)).toEqual(['created', 'one', 'two']);
});
