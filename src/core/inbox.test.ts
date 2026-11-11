import { expect, test } from 'bun:test';
import { inboxEntries, needsYouCount, readMark, waitingCount } from './inbox';
import type { Item, Preference, SettingProposal, Talk, Waiting } from './types';
import type { NeedsYou } from './waits';

const ms = (iso: string) => Date.parse(iso);
let rows = 0;
/** A card that waits for the owner, with its open wait: since `since`, last changed `updated` (by default when it began). */
const card = (id: string, since: string, over: Partial<Item> = {}, updated = since): [Item, NeedsYou] => [
  { id, kind: 'task', state: 'waiting', need: 'demo', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...over },
  { id: ++rows, kind: 'demo', card: id, createdAt: ms(since), lastUpdated: ms(updated) },
];
const talk = (id: number, at: string, unread = true): Talk => ({ id, at, said: 'q', answer: `answer ${id}`, ...(unread ? { unread: true as const } : {}) });
const answerRow = (x: Talk): NeedsYou => ({ id: ++rows, kind: 'answer', talk: x.id, createdAt: ms(x.at), lastUpdated: ms(x.at) });
const site = { id: 'site', name: 'Site' };
const app = { id: 'app', name: 'App' };
/** A project's waits: its cards with their rows, the Koordinator's latest unread answer with its row, and any other rows (rules, settings). */
const w = (cards: [Item, NeedsYou][], t: Talk[] = [], more: Partial<Waiting> = {}, extra: NeedsYou[] = []): Waiting => {
  const answer = t.filter((x) => x.unread).at(-1);
  return { items: cards.map(([i]) => i), talk: t, needsYou: [...cards.map(([, r]) => r), ...(answer ? [answerRow(answer)] : []), ...extra], ...more };
};
const rule = (id: number, text: string, at = '2026-11-05T08:00:00Z'): [Preference, NeedsYou] => [{ id, state: 'proposed', text }, { id: ++rows, kind: 'rule', preference: id, createdAt: ms(at), lastUpdated: ms(at) }];
const setting = (id: number, at = '2026-11-05T08:00:00Z'): [SettingProposal, NeedsYou] => [
  { id, repo: 'r', field: 'checks', value: 'test', basis: 'Check it', cards: [] },
  { id: ++rows, kind: 'setting', setting: id, createdAt: ms(at), lastUpdated: ms(at) },
];

test('entries of every project come in one list, the latest changed first', () => {
  const e = inboxEntries([site, app], {
    site: w([card('s-new', '2026-11-05T10:00:00Z'), card('s-old', '2026-11-05T08:00:00Z')]),
    app: w([card('a-mid', '2026-11-05T09:00:00Z')]),
  });
  expect(e.map((x) => x.card?.id)).toEqual(['s-new', 'a-mid', 's-old']);
  expect(e.map((x) => x.projectName)).toEqual(['Site', 'App', 'Site']);
  expect(e[0]).toMatchObject({ kind: 'demo', since: '2026-11-05T10:00:00.000Z', updated: ms('2026-11-05T10:00:00Z') });
});

test('a wait that changed (a new summary, a new question) comes before one that began later; moving a card does not count', () => {
  const refreshed = card('refreshed', '2026-11-05T08:00:00Z', { updatedAt: '2026-11-05T08:00:00Z', review: { summary: 'New demo ready' } }, '2026-11-05T11:00:00Z');
  // moved on the canvas just now: its card's update time changes, its wait does not
  const moved = card('moved', '2026-11-05T10:00:00Z', { updatedAt: '2026-11-05T12:00:00Z' });
  const e = inboxEntries([site, app], { site: w([moved]), app: w([refreshed]) });
  expect(e.map((x) => x.card?.id)).toEqual(['refreshed', 'moved']);
  expect(e[0]!.since).toBe('2026-11-05T08:00:00.000Z');
});

test('Seismic’s latest unread answer is an entry, placed by when it came', () => {
  const e = inboxEntries([site, app], {
    site: w([card('s', '2026-11-05T08:00:00Z')]),
    app: w([], [talk(1, '2026-11-05T07:00:00Z'), talk(2, '2026-11-05T09:00:00Z'), talk(3, '2026-11-05T10:00:00Z', false)]),
  });
  expect(e.map((x) => x.key)).toEqual(['app/obeya', 'site/s']);
  expect(e[0]).toMatchObject({ project: 'app', kind: 'answer', text: 'answer 2', since: '2026-11-05T09:00:00.000Z' });
  expect(e[0]!.card).toBeUndefined();
});

test('an answer left out of the list (its sheet is open) is no entry, though its wait is open', () => {
  const x = talk(1, '2026-11-05T09:00:00Z');
  expect(inboxEntries([site], { site: { items: [], talk: [], needsYou: [answerRow(x)] } })).toEqual([]);
});

test('equal waits keep the projects’ order and, within one, the order they began in', () => {
  const at = '2026-11-05T08:00:00Z';
  const e = inboxEntries([app, site], { site: w([card('s1', at), card('s2', at)]), app: w([card('a1', at)]) });
  expect(e.map((x) => x.card?.id)).toEqual(['a1', 's1', 's2']);
});

test('a card the owner just answered leaves the list; one without an open wait is not in it', () => {
  const working: [Item, NeedsYou] = card('working', '2026-11-05T08:00:00Z', { state: 'working' });
  const site1 = w([card('done', '2026-11-05T08:00:00Z'), card('next', '2026-11-05T09:00:00Z')]);
  const e = inboxEntries([site], { site: { ...site1, items: [...site1.items, working[0]] } }, (id) => id === 'done');
  expect(e.map((x) => x.card?.id)).toEqual(['next']);
});

test('a card snoozed while it waited has no open wait and is not in the inbox', () => {
  const [snoozed] = card('later', '2026-11-05T07:00:00Z', { hold: { reason: 'snoozed', since: '2026-11-05T07:00:00Z', until: '2026-11-06T08:00:00Z', by: 'owner', waiting: true } });
  const s = w([card('s', '2026-11-05T08:00:00Z')]);
  const e = inboxEntries([site, app], { site: { ...s, items: [snoozed, ...s.items] }, app: w([card('a', '2026-11-05T09:00:00Z')]) });
  expect(e.map((x) => x.card?.id)).toEqual(['a', 's']);
  expect(waitingCount(e)).toBe(2);
  expect(waitingCount(e, 'site')).toBe(1);
  expect(waitingCount(e, 'app')).toBe(1);
});

test('what the entry waits for: the question, else the handover’s summary', () => {
  const e = inboxEntries([site], {
    site: w([card('q', '2026-11-05T08:00:00Z', { need: 'question', question: { text: 'Which one?', options: ['A', 'B'] } }), card('d', '2026-11-05T09:00:00Z', { review: { summary: 'Done it.' } })]),
  });
  expect(e.map((x) => x.text)).toEqual(['Done it.', 'Which one?']);
});

test('a project the server has not reported yet adds nothing', () => {
  expect(inboxEntries([site], {})).toEqual([]);
});

test('rule and setting proposals are entries by when they were proposed, and count separately on their project', () => {
  const [p1, r1] = rule(1, 'A rule', '2026-11-05T09:00:00Z');
  const [s1, r2] = setting(1, '2026-11-05T07:00:00Z');
  const entries = inboxEntries([site, app], {
    site: w([card('c', '2026-11-05T08:00:00Z')], [], { preferences: [p1, { id: 2, state: 'active', text: 'Active' }], settingProposals: [s1] }, [r1, r2]),
    app: w([]),
  });
  expect(entries.map((e) => e.key)).toEqual(['site/preference/1', 'site/c', 'site/setting/1']);
  expect(entries.map((e) => e.kind)).toEqual(['rule', 'demo', 'setting']);
  expect(waitingCount(entries, 'site')).toBe(3);
});

test('only unread entries count; a card that waits anew and a newer answer are unread again', () => {
  const [p1, r1] = rule(1, 'A rule');
  const more = { preferences: [p1] };
  const e = inboxEntries([site], { site: w([card('a', '2026-11-05T08:00:00Z'), card('b', '2026-11-05T09:00:00Z')], [talk(1, '2026-11-05T10:00:00Z')], more, [r1]) });
  const read = new Set([readMark(e.find((x) => x.card?.id === 'a')!), readMark(e.find((x) => x.preference)!)]);
  expect(waitingCount(e, undefined, (m) => read.has(m))).toBe(2);
  expect(waitingCount(e, 'site', (m) => read.has(m))).toBe(2);
  // the card read before waits again since later; the proposal keeps its mark
  const again = inboxEntries([site], { site: w([card('a', '2026-11-05T11:00:00Z'), card('b', '2026-11-05T09:00:00Z')], [talk(1, '2026-11-05T10:00:00Z')], more, [r1]) });
  expect(waitingCount(again, undefined, (m) => read.has(m))).toBe(3);
  expect(readMark(again.find((x) => x.preference)!)).toBe('site/preference/1');
  // a new question while the card still waits makes it unread too
  const asked = inboxEntries([site], {
    site: w([card('a', '2026-11-05T08:00:00Z', { need: 'question', question: { text: 'Shipping too?', options: [] } }), card('b', '2026-11-05T09:00:00Z')], [talk(1, '2026-11-05T10:00:00Z')], more, [r1]),
  });
  expect(waitingCount(asked, undefined, (m) => read.has(m))).toBe(3);
});

test('"Needs you" counts the cards waiting on every project, read or not, and nothing else', () => {
  const [p1, r1] = rule(1, 'A rule');
  const entries = inboxEntries([site, app], {
    site: w([card('s', '2026-11-05T08:00:00Z')], [talk(1, '2026-11-05T09:00:00Z')], { preferences: [p1] }, [r1]),
    app: w([card('a', '2026-11-05T09:00:00Z')]),
  });
  expect(waitingCount(entries)).toBe(4);
  expect(needsYouCount(entries)).toBe(2);
  expect(waitingCount(entries, undefined, () => true)).toBe(0);
});
