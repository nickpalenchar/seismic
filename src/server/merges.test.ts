import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MERGED_SIZE, onProject, sizeOf } from '../core/layout';
import { type Item, mergeableWith, mergeRank, needsYou, openQuestions } from '../core/types';
import { mergeCandidates } from '../ui/merge';
import { ProjectRuntime } from './project';
import { Store } from './store';
import { Merges } from './merges';
import { FakeRuntime, gitRepo, noForge } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let project: ProjectRuntime;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-merges-'));
  main = join(dir, 'main');
  gitRepo(main);
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  project = new ProjectRuntime({ repos: [{ path: main, clones: 1 }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, mergeSettleMs: 10, limitMargin: 10 });
});
afterEach(() => {
  project.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const board = () => project.board;
const merger = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'merge_cards')).at(-1);

/** A proposal from the agent of "Export", with a question, and the owner's planned card it belongs with. */
function cards(): { p: Item; planned: Item } {
  const from = board().create({ title: 'Export', x: 0, y: 0 });
  const p = board().propose(from.id, { title: 'Check CSV umlauts', task: 'The CSV export writes umlauts wrongly.', questions: [{ text: 'Which encoding?', options: ['UTF-8', 'Latin-1'] }] });
  const planned = board().create({ title: 'Fix the CSV export', body: 'Dates in the CSV export are off by one day.', x: 900, y: 600 });
  return { p, planned };
}

describe('a proposal merged with another card', () => {
  test('an agent writes one card of both; approved, the other card takes it and the proposal goes', async () => {
    const { p, planned } = cards();
    expect(mergeableWith(board().item(p.id)!, board().item(planned.id)!)).toBe(true);
    project.act(p.id, { action: 'merge', with: planned.id });
    const m = merger()!;
    expect(m.spec.readOnly).toBe(true);
    expect(m.inbox[0]).toContain('The CSV export writes umlauts wrongly.');
    expect(m.inbox[0]).toContain('Dates in the CSV export are off by one day.');
    expect(m.inbox[0]).toContain('Which encoding?');

    // while the agent merges: the two show as one, and neither needs the owner
    let a = board().item(p.id)!;
    let b = board().item(planned.id)!;
    expect(a.idea?.proposal?.merge).toMatchObject({ with: planned.id });
    expect(b.idea?.mergingInto).toBe(p.id);
    expect(needsYou(a)).toBe(false);
    expect(openQuestions(a)).toEqual([]);
    expect(sizeOf(a, board().items())).toEqual([...MERGED_SIZE]);
    expect(onProject(board().items()).map((i) => i.id)).not.toContain(planned.id);
    expect(() => project.act(planned.id, { action: 'start' })).toThrow('merged with a proposal');
    expect(() => project.act(p.id, { action: 'accept' })).toThrow('merged with another card');

    m.call('merge_cards', { title: 'Fix the CSV export', task: 'The CSV export writes umlauts wrongly and dates off by one day. Fix both.' });
    m.emit({ type: 'idle' });
    await settle();
    a = board().item(p.id)!;
    expect(a.idea?.proposal?.merge).toMatchObject({ with: planned.id, title: 'Fix the CSV export', task: 'The CSV export writes umlauts wrongly and dates off by one day. Fix both.' });
    // the merged card waits for the owner, in „Braucht dich“
    expect(needsYou(a)).toBe(true);

    project.act(p.id, { action: 'approveMerge' });
    expect(board().item(p.id)).toBeUndefined();
    b = board().item(planned.id)!;
    expect(b.state).toBe('planned');
    expect(b.idea?.mergingInto).toBeUndefined();
    expect(b.title).toBe('Fix the CSV export');
    // the proposal's open question goes with the planned task's text
    expect(b.body).toStartWith('The CSV export writes umlauts wrongly and dates off by one day. Fix both.');
    expect(b.body).toContain('Which encoding? (UTF-8 / Latin-1)');
    expect({ x: b.x, y: b.y }).toEqual({ x: a.x, y: a.y });
    expect(board().events(planned.id).at(-1)?.text).toContain('Check CSV umlauts');
    // marked as merged, not as dismissed by the owner
    expect(board().removed('1970-01-01T00:00:00.000Z').map((r) => r.title)).not.toContain('Check CSV umlauts');
  });

  test('separated, both keep their original text and position', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    project.act(p.id, { action: 'separate' });
    const a = board().item(p.id)!;
    const b = board().item(planned.id)!;
    expect(a.idea?.proposal?.merge).toBeUndefined();
    expect(b.idea?.mergingInto).toBeUndefined();
    expect(b.body).toBe('Dates in the CSV export are off by one day.');
    expect(b.x).toBe(900);
    expect({ x: a.x, y: a.y }).toEqual({ x: p.x, y: p.y });
    expect(needsYou(a)).toBe(true);
    // the agent's late answer changes nothing any more
    merger()!.call('merge_cards', { title: 'x', task: 'y' });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
  });

  test('two proposals merged: the other keeps the questions of both', async () => {
    const { p } = cards();
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.', questions: [{ text: 'Which separator?', options: [';', ','] }] });
    project.act(p.id, { action: 'merge', with: q.id });
    merger()!.call('merge_cards', { title: 'CSV in and out', task: 'Export and import CSV correctly.' });
    merger()!.emit({ type: 'idle' });
    await settle();
    project.act(p.id, { action: 'approveMerge' });
    const b = board().item(q.id)!;
    expect(b.state).toBe('proposal');
    expect(b.body).toBe('Export and import CSV correctly.');
    expect(b.idea?.proposal?.questions.map((x) => x.text)).toEqual(['Which separator?', 'Which encoding?']);
  });

  test('ideas, the card itself and cards already merging are excluded; started partners are allowed', () => {
    const { p, planned } = cards();
    const idea = board().create({ title: 'Think about exports', x: 0, y: 900, idea: true });
    expect(() => project.act(p.id, { action: 'merge', with: p.id })).toThrow();
    expect(() => project.act(p.id, { action: 'merge', with: idea.id })).toThrow('can no longer be merged');
    // a card merged with one proposal is not merged with a second
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.' });
    project.act(q.id, { action: 'merge', with: planned.id });
    expect(() => project.act(p.id, { action: 'merge', with: planned.id })).toThrow();
    project.act(q.id, { action: 'separate' });
    board().work(planned.id, { state: 'working' });
    expect(() => project.act(p.id, { action: 'merge', with: planned.id })).not.toThrow();
    expect(() => project.act(planned.id, { action: 'merge', with: p.id })).toThrow();
  });

  test('an agent that ends without a merged text leaves the reason, and the merge can be tried again', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(board().item(p.id)!.idea?.proposal?.merge?.failed).toBeDefined();
    const before = runtime.sessions.length;
    project.act(p.id, { action: 'merge', with: planned.id });
    expect(runtime.sessions.length).toBe(before + 1);
    expect(board().item(p.id)!.idea?.proposal?.merge).toMatchObject({ with: planned.id });
  });
});


const finishMerge = async (result: Record<string, unknown>) => {
  merger()!.call('merge_cards', result);
  merger()!.emit({ type: 'idle' });
  await settle();
};
const covered = (i: Item) => ({ outcome: 'covered', titleCovered: true, parts: [{ text: i.body, covered: true }] });

describe('folding into a progressed survivor', () => {
  test.each(['working', 'waiting', 'approved', 'inPr', 'done', 'live', 'archived'] as const)('%s survivor stays exactly as it was, including after approval', async (state) => {
    const { p, planned } = cards();
    board().work(planned.id, { state: state === 'archived' ? 'done' : state, branch: 'keep-my-branch', detail: JSON.stringify({ summary: 'CSV encoding and dates are fixed.' }) });
    if (state === 'archived') board().archive([planned.id]);
    board().items();
    const before = store.cards.get(planned.id)!;
    project.act(p.id, { action: 'merge', with: planned.id });
    expect(merger()!.inbox[0]).toContain('CSV encoding and dates are fixed.');
    expect(merger()!.spec.system).toContain('without reading repository files or branch diffs');
    await finishMerge(covered(p));
    const draft = board().item(p.id)!.idea!.proposal!.merge!;
    expect(draft.title).toBe(before.title!);
    expect(draft.task).toBe(before.body!);
    expect(store.cards.get(planned.id)).toEqual(before);
    expect(board().item(p.id)).toBeDefined();
    expect(needsYou(board().item(p.id)!)).toBe(true);
    project.act(p.id, { action: 'approveMerge' });
    expect(store.cards.get(planned.id)).toEqual(before);
    expect(board().item(p.id)).toBeUndefined();
    expect(board().card(planned.id)?.archivedAt !== undefined).toBe(state === 'archived');
  });

  test('approval creates only extra work, carries relevant questions, and moves arrows and follow-ups', async () => {
    const { p, planned } = cards();
    board().work(planned.id, { state: 'working', branch: 'csv-export' });
    const child = board().create({ title: 'Check export', from: p.id });
    const prerequisite = board().create({ title: 'Supply examples', x: 0, y: 1300 });
    board().connect(prerequisite.id, p.id);
    board().connect(p.id, child.id);
    board().items();
    const before = store.cards.get(planned.id)!;
    project.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: p.body, covered: false }], followUp: { title: 'Fix CSV encoding', task: 'Fix the encoding of exported umlauts.', images: [], questions: [0] } });
    expect(board().items().some((i) => i.title === 'Fix CSV encoding')).toBe(false);
    project.act(p.id, { action: 'approveMerge' });
    const next = board().items().find((i) => i.title === 'Fix CSV encoding')!;
    expect(next.state).toBe('planned');
    expect(next.from).toBe(planned.id);
    expect(board().activityRows([project.id], undefined, 100).some((r) => r.cardId === next.id && r.code === 'created' && r.who === 'owner')).toBe(true);
    expect(next.repo).toBe(planned.repo);
    expect(next.body).toStartWith('Fix the encoding of exported umlauts.');
    expect(next.body).toContain('Which encoding?');
    expect(next.plan?.manualDependsOn).toEqual([planned.id]);
    expect(board().item(child.id)!.from).toBe(planned.id);
    expect(board().manualDependencies().map(([a, b]) => [a, b])).toContainEqual([prerequisite.id, planned.id]);
    expect(board().manualDependencies().map(([a, b]) => [a, b])).toContainEqual([planned.id, child.id]);
    expect(store.cards.get(planned.id)).toEqual(before);
  });

  test('a planned task can start a merge and separate with no proposal metadata left behind', async () => {
    const a = board().create({ title: 'XLSX too', body: 'Add CSV. Also XLSX.', x: 10, y: 20 });
    const b = board().create({ title: 'CSV', body: 'Add CSV.', x: 500, y: 20 });
    board().work(b.id, { state: 'working', branch: 'csv' });
    const original = store.cards.get(a.id)!;
    project.act(a.id, { action: 'merge', with: b.id });
    await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: 'Add CSV.', covered: true }, { text: ' Also XLSX.', covered: false }], followUp: { title: 'XLSX', task: 'Add XLSX.', images: [], questions: [] } });
    expect(board().item(a.id)!.idea!.proposal!.merge!.task).toBe('Add CSV.');
    project.act(a.id, { action: 'separate' });
    const { updated_at: _, ...after } = store.cards.get(a.id)!;
    const { updated_at: ___, ...before } = original;
    expect(after).toEqual(before);
    expect(board().items()).toHaveLength(2);
  });

  test('a planned task picking a proposal keeps the planned task and combines both texts', async () => {
    const { p, planned } = cards();
    project.act(planned.id, { action: 'merge', with: p.id });
    expect(board().item(p.id)!.idea!.proposal!.merge!.with).toBe(planned.id);
    await finishMerge({ title: 'CSV fixes', task: 'Fix dates and encoding.' });
    project.act(p.id, { action: 'approveMerge' });
    expect(board().item(planned.id)!.state).toBe('planned');
    expect(board().item(planned.id)!.body).toContain('Fix dates and encoding.');
  });

  test('two planned tasks combine into the selected partner', async () => {
    const a = board().create({ title: 'A', body: 'A task', x: 0, y: 0 });
    const b = board().create({ title: 'B', body: 'B task', x: 400, y: 0 });
    project.act(a.id, { action: 'merge', with: b.id });
    await finishMerge({ title: 'Together', task: 'A and B task' });
    project.act(a.id, { action: 'approveMerge' });
    expect(board().item(a.id)).toBeUndefined();
    expect(board().item(b.id)!.body).toBe('A and B task');
  });

  test('two unworked plan-doc cards combine and the survivor still becomes a plan; a plan-doc card and a task do not merge', async () => {
    const a = board().create({ title: 'New menu', body: 'Write a plan doc: a new menu', x: 0, y: 0 });
    const b = board().create({ title: 'Menu sorting', body: 'Write a plan doc: sort the menu', x: 400, y: 0 });
    const task = board().create({ title: 'Menu icons', body: 'Icons in the menu', x: 800, y: 0 });
    board().work(a.id, { idea: { becomesPlan: true } });
    board().work(b.id, { idea: { becomesPlan: true } });
    board().decide({ plan_id: null, card_id: a.id, question: 'How does “New menu” go on?', answer: 'As a plan', by: 'owner' });
    expect(mergeableWith(board().item(a.id)!, board().item(task.id)!)).toBe(false);
    expect(mergeableWith(board().item(task.id)!, board().item(a.id)!)).toBe(false);
    // one whose plan doc is being written already is no partner
    board().work(b.id, { state: 'working' });
    expect(mergeableWith(board().item(a.id)!, board().item(b.id)!)).toBe(false);
    board().work(b.id, { state: 'planned' });
    project.act(a.id, { action: 'merge', with: b.id });
    expect(merger()!.inbox[0]).toContain('Both cards are unworked.');
    await finishMerge({ title: 'Menu', task: 'Write a plan doc: a new menu, sorted' });
    project.act(a.id, { action: 'approveMerge' });
    expect(board().item(a.id)).toBeUndefined();
    const kept = board().item(b.id)!;
    expect(kept.body).toBe('Write a plan doc: a new menu, sorted');
    expect(kept.idea?.becomesPlan).toBe(true);
    // what was decided on the card that went holds for the one that stays
    expect(board().decisionsOn(b.id).map((d) => d.answer)).toEqual(['As a plan']);
  });

  test('an incomplete coverage map is refused', async () => {
    const { p, planned } = cards();
    board().work(planned.id, { state: 'working', branch: 'csv' });
    project.act(p.id, { action: 'merge', with: planned.id });
    expect(merger()!.call('merge_cards', { outcome: 'covered', titleCovered: true, parts: [{ text: 'Only a fragment', covered: true }] })).toContain('entire left task exactly');
    expect(board().item(p.id)!.idea!.proposal!.merge!.task).toBeUndefined();
  });

  test('picker orders planned, in progress, done and archived, newest within each; eligibility applies to both sides', () => {
    const { p, planned } = cards();
    const all: Item[] = [
      { ...planned, id: 'archived', state: 'done', archivedAt: '2026-11-04', createdAt: '2026-11-04' },
      { ...planned, id: 'done', state: 'live', createdAt: '2026-11-04' },
      { ...planned, id: 'working', state: 'working', createdAt: '2026-11-04' },
      { ...planned, id: 'older', createdAt: '2026-11-02' },
      { ...planned, id: 'newer', createdAt: '2026-11-03' },
    ];
    expect(mergeCandidates(p, all, '').map((i) => i.id)).toEqual(['newer', 'older', 'working', 'done', 'archived']);
    expect(mergeRank(all[0]!)).toBeGreaterThan(mergeRank(all[1]!));
    // a plan's workstream is a partner, but cannot start a merge
    expect(mergeableWith(p, { ...planned, parent: 'plan' })).toBe(true);
    expect(mergeableWith({ ...p, parent: 'plan' }, planned)).toBe(false);
    for (const invalid of [{ idea: { mergingInto: 'another' } }, { repoDown: true }, { hold: { reason: 'snoozed', since: '2026-11-01', why: 'later', by: 'owner', until: '2026-12-01' } }] as Partial<Item>[]) {
      expect(mergeableWith(p, { ...planned, ...invalid })).toBe(false);
      expect(mergeableWith({ ...p, ...invalid }, planned)).toBe(false);
    }
    expect(mergeableWith(all[2]!, all[1]!)).toBe(false);
  });
});


test('late answers from a separated comparison cannot complete a new merge', async () => {
  const { p, planned } = cards();
  project.act(p.id, { action: 'merge', with: planned.id });
  const old = merger()!;
  project.act(p.id, { action: 'separate' });
  project.act(p.id, { action: 'merge', with: planned.id });
  const current = merger()!;
  expect(current).not.toBe(old);
  old.call('merge_cards', { title: 'Stale', task: 'Stale task.' });
  old.emit({ type: 'idle' });
  await settle();
  expect(board().item(p.id)!.idea!.proposal!.merge!.task).toBeUndefined();
  await finishMerge({ title: 'Current', task: 'Current task.' });
  expect(board().item(p.id)!.idea!.proposal!.merge!.task).toBe('Current task.');
});

test('an unfinished planned-card comparison resumes once, including an archived partner', async () => {
  const { planned: back } = cards();
  const survivor = board().create({ title: 'Exports', body: 'Export data.', x: 500, y: 500 });
  board().work(survivor.id, { state: 'done' });
  board().archive([survivor.id]);
  board().mergeStart(back.id, survivor.id);
  const resumed = new Merges({ board: board(), runtime, pathFor: () => main });
  const before = runtime.sessions.length;
  resumed.resume();
  resumed.resume();
  expect(runtime.sessions).toHaveLength(before + 1);
  expect(merger()!.inbox[0]).toContain('archived');
  await finishMerge(covered(back));
  expect(board().item(back.id)!.idea!.proposal!.merge!.outcome).toBe('covered');
});

test('a title-only request can become extra work, with selected screenshots and questions', async () => {
  const { p, planned } = cards();
  const image = project.images.save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=', 'base64'), 'image/png');
  const unused = project.images.save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=', 'base64'), 'image/png');
  board().work(p.id, { body: '', images: JSON.stringify([image, unused]) });
  board().work(planned.id, { state: 'done' });
  board().archive([planned.id]);
  project.act(p.id, { action: 'merge', with: planned.id });
  expect(merger()!.images[0]).toEqual([project.images.path(image)!, project.images.path(unused)!]);
  await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [], followUp: { title: 'Fix umlauts', task: 'Correct umlaut encoding in CSV exports.', images: [image], questions: [0] } });
  project.act(p.id, { action: 'approveMerge' });
  const follow = board().items().find((i) => i.title === 'Fix umlauts')!;
  expect(follow.state).toBe('planned');
  expect(follow.images).toEqual([image]);
  expect(follow.body).toContain('Which encoding?');
  expect(board().card(planned.id)!.archivedAt).toBeDefined();
});

test('a queued unworked card stays held during the merge and continues after separation', async () => {
  const { p, planned } = cards();
  const blocker = board().create({ title: 'Prerequisite', x: 800, y: 800 });
  board().work(planned.id, { queue: JSON.stringify({ behind: [blocker.id], reason: 'Wait', since: new Date().toISOString() }) });
  board().connect(blocker.id, planned.id);
  project.act(planned.id, { action: 'merge', with: p.id });
  board().work(blocker.id, { state: 'done' });
  await settle(40);
  expect(board().item(planned.id)!.state).toBe('planned');
  expect(board().item(planned.id)!.queue).toBeDefined();
  project.act(p.id, { action: 'separate' });
});


test('an archived stopped survivor holds its new follow-up until its work lands', async () => {
  const { p, planned } = cards();
  board().work(planned.id, { branch: 'stopped-export' });
  board().archive([planned.id]);
  project.act(p.id, { action: 'merge', with: planned.id });
  await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: p.body, covered: false }], followUp: { title: 'Remaining encoding work', task: 'Correct encoding after CSV export lands.', images: [], questions: [] } });
  project.act(p.id, { action: 'approveMerge' });
  let next = board().items().find((i) => i.title === 'Remaining encoding work')!;
  expect(next.plan?.manualArchived?.map((i) => i.id)).toEqual([planned.id]);
  expect(next.plan?.manualDependsOn).toEqual([planned.id]);
  project.act(next.id, { action: 'start' });
  await settle(40);
  next = board().item(next.id)!;
  expect(next.state).toBe('planned');
  expect(next.queue && 'behind' in next.queue ? next.queue.behind : []).toContain(planned.id);
  board().unarchive(planned.id);
  board().work(planned.id, { state: 'done' });
  await settle(40);
  expect(board().item(next.id)!.plan?.manualArchived).toBeUndefined();
});


describe('a merged pair whose cards change compares again', () => {
  const merge = (id: string) => board().item(id)!.idea!.proposal!.merge!;
  const lines = (id: string) => board().events(id).map((e) => e.text);

  test('an edit to the left card after the combined text: the result before stays until the new one is in', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge({ title: 'Combined', task: 'Both requirements.' });
    const first = merger();
    expect(merge(p.id).compared).toBeDefined();
    board().work(p.id, { body: 'The CSV export writes umlauts and quotes wrongly.' });
    // the race guard: approved before the watcher noticed
    expect(() => project.act(p.id, { action: 'approveMerge' })).toThrow('comparing again');
    await settle(40);
    expect(merger()).not.toBe(first);
    expect(merger()!.inbox[0]).toContain('umlauts and quotes');
    expect(merge(p.id).task).toBeUndefined();
    expect(merge(p.id).previous).toMatchObject({ title: 'Combined', task: 'Both requirements.' });
    expect(lines(p.id)).toContain('Compared again: “Check CSV umlauts” changed.');
    expect(() => project.act(p.id, { action: 'approveMerge' })).toThrow('not there yet');
    await finishMerge({ title: 'Combined again', task: 'Umlauts, quotes and dates.' });
    expect(merge(p.id).previous).toBeUndefined();
    project.act(p.id, { action: 'approveMerge' });
    expect(board().item(planned.id)!.body).toStartWith('Umlauts, quotes and dates.');
  });

  test('the survivor\'s handover changes its summary: compared again against the new one', async () => {
    const { p, planned } = cards();
    board().work(planned.id, { state: 'working', branch: 'csv' });
    project.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge(covered(p));
    board().work(planned.id, { state: 'waiting', detail: JSON.stringify({ summary: 'Umlauts are written as UTF-8 now.' }) });
    await settle(40);
    expect(merger()!.inbox[0]).toContain('Umlauts are written as UTF-8 now.');
    expect(merge(p.id).previous?.outcome).toBe('covered');
    expect(lines(p.id)).toContain('Compared again: “Fix the CSV export” changed.');
    await finishMerge(covered(p));
    project.act(p.id, { action: 'approveMerge' });
    expect(board().item(p.id)).toBeUndefined();
  });

  test('an unworked survivor that starts is compared as a progressed one, and its text stays', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge({ title: 'Combined', task: 'Both requirements.' });
    board().work(planned.id, { state: 'working', branch: 'csv' });
    await settle(40);
    expect(merger()!.inbox[0]).toContain('The right card has progressed');
    await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: p.body, covered: false }], followUp: { title: 'Fix CSV encoding', task: 'Fix the encoding.', images: [], questions: [] } });
    project.act(p.id, { action: 'approveMerge' });
    expect(board().item(planned.id)!.body).toBe(planned.body);
    expect(board().items().some((i) => i.title === 'Fix CSV encoding')).toBe(true);
  });

  test('a change during the first comparison starts it again; a burst of edits makes one comparison', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    const before = runtime.sessions.length;
    board().work(planned.id, { body: 'Dates are off.' });
    board().work(planned.id, { body: 'Dates are off by one day.' });
    board().work(planned.id, { body: 'Dates are off by one day in CSV.' });
    await settle(40);
    expect(runtime.sessions.length).toBe(before + 1);
    expect(merger()!.inbox[0]).toContain('Dates are off by one day in CSV.');
    expect(merge(p.id).previous).toBeUndefined();
    await settle(40);
    expect(runtime.sessions.length).toBe(before + 1);
  });

  test('a partner that can no longer be merged with separates the pair, saying why', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge({ title: 'Combined', task: 'Both requirements.' });
    board().snooze(planned.id, { until: '2099-01-01T00:00:00.000Z', why: 'later', by: 'owner' });
    await settle(40);
    expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
    expect(lines(p.id)).toContain('Separated from “Fix the CSV export” again: the two can no longer be merged.');

    const other = board().create({ title: 'Other', body: 'Other task.', x: 0, y: 2000 });
    project.act(p.id, { action: 'merge', with: other.id });
    board().remove(other.id);
    await settle(40);
    expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
    expect(lines(p.id)).toContain('Separated again: the other card is gone.');
  });

  test('a failed comparison separates too once its partner can no longer be merged with', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(merge(p.id).failed).toBeDefined();
    board().snooze(planned.id, { until: '2099-01-01T00:00:00.000Z', why: 'later', by: 'owner' });
    await settle(40);
    expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
    expect(lines(p.id)).toContain('Separated from “Fix the CSV export” again: the two can no longer be merged.');
  });

  test('a change to the survivor\'s screenshots, questions or reason compares again', async () => {
    const { p } = cards();
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.', questions: [{ text: 'Which separator?', options: [';', ','] }] });
    project.act(p.id, { action: 'merge', with: q.id });
    await finishMerge({ title: 'CSV in and out', task: 'Export and import CSV correctly.' });
    const first = merger();
    const image = project.images.save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=', 'base64'), 'image/png');
    board().work(q.id, { images: JSON.stringify([image]) });
    await settle(40);
    expect(merger()).not.toBe(first);
    expect(merger()!.inbox[0]).toContain(image);
    expect(lines(p.id)).toContain('Compared again: “CSV import” changed.');
  });

  test('a card that changes while its comparison fails is compared again rather than left on the failure', async () => {
    const { p, planned } = cards();
    project.act(p.id, { action: 'merge', with: planned.id });
    const first = merger()!;
    board().work(planned.id, { body: 'Dates are off by two days.' });
    first.emit({ type: 'idle' });
    await settle(40);
    expect(merger()).not.toBe(first);
    expect(merger()!.inbox[0]).toContain('Dates are off by two days.');
    expect(merge(p.id).failed).toBeUndefined();
    // a failure of unchanged cards waits for "Try again"
    const second = merger()!;
    second.emit({ type: 'idle' });
    await settle(40);
    expect(merge(p.id).failed).toBeDefined();
    expect(merger()).toBe(second);
  });

  test('a restart after the partner of an unfinished comparison was deleted separates the pair instead of failing', () => {
    const { p, planned } = cards();
    board().mergeStart(p.id, planned.id);
    board().remove(planned.id);
    const before = runtime.sessions.length;
    expect(() => new Merges({ board: board(), runtime, pathFor: () => main }).resume()).not.toThrow();
    expect(runtime.sessions.length).toBe(before);
    expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
    expect(lines(p.id)).toContain('Separated again: the other card is gone.');
  });
});


describe('merge deletion and settling regressions', () => {
  for (const state of ['pending', 'ready', 'failed'] as const) {
    test(`deleting and immediately restoring the dissolving card separates a ${state} merge`, async () => {
      const { p, planned } = cards();
      project.act(p.id, { action: 'merge', with: planned.id });
      const old = merger()!;
      if (state === 'ready') await finishMerge({ title: 'Combined', task: 'Both requirements.' });
      if (state === 'failed') { old.emit({ type: 'idle' }); await settle(); }
      board().remove(p.id);
      board().restore(p.id);
      expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
      expect(board().item(planned.id)!.idea?.mergingInto).toBeUndefined();
      expect(board().item(p.id)!.body).toBe(p.body);
      if (state === 'pending') {
        old.call('merge_cards', { title: 'Late', task: 'Late result.' });
        old.emit({ type: 'idle' });
        await settle();
        expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
      }
    });
  }

  test('restart repairs a persisted deleted merge owner and restores its original place', () => {
    const { planned } = cards();
    const other = board().create({ title: 'Other', x: 2000, y: 2000 });
    board().mergeStart(planned.id, other.id);
    // Simulate deletion saved by another path or an older version before shutdown.
    store.cards.update(planned.id, { deleted_at: new Date().toISOString() });
    const resumed = new Merges({ board: board(), runtime, pathFor: () => main });
    const before = runtime.sessions.length;
    resumed.resume();
    resumed.shutdown();
    expect(runtime.sessions.length).toBe(before);
    expect(store.cards.get(planned.id)!.idea?.proposal?.merge).toBeUndefined();
    board().restore(planned.id);
    expect(board().item(planned.id)).toMatchObject({ x: planned.x, y: planned.y, title: planned.title });
    expect(board().item(planned.id)!.idea?.proposal).toBeUndefined();
  });

  test('the settle window starts again after each edit, even across the first deadline', async () => {
    const { p, planned } = cards();
    project.shutdown();
    const watcher = new Merges({ board: board(), runtime, pathFor: () => main, settleMs: 150 });
    try {
      watcher.merge(p.id, planned.id);
      const before = runtime.sessions.length;
      board().work(planned.id, { body: 'First edit.' });
      await settle(100);
      board().work(planned.id, { body: 'Second edit.' });
      await settle(100);
      expect(runtime.sessions.length).toBe(before);
      board().work(planned.id, { body: 'Final edit.' });
      await settle(100);
      expect(runtime.sessions.length).toBe(before);
      await settle(100);
      expect(runtime.sessions.length).toBe(before + 1);
      expect(merger()!.inbox[0]).toContain('Final edit.');
    } finally { watcher.shutdown(); }
  });
});

for (const state of ['pending', 'ready', 'failed'] as const) {
  test(`unrelated worker activity cannot starve a changed ${state} merge`, async () => {
    const { p, planned } = cards();
    const unrelated = board().create({ title: 'Another worker', x: 3000, y: 0 });
    project.shutdown();
    const watcher = new Merges({ board: board(), runtime, pathFor: () => main, settleMs: 100 });
    try {
      watcher.merge(p.id, planned.id);
      if (state === 'ready') await finishMerge({ title: 'Combined', task: 'Both requirements.' });
      if (state === 'failed') { merger()!.emit({ type: 'idle' }); await settle(); }
      const before = runtime.sessions.length;
      board().work(planned.id, { body: 'Changed requirement.' });
      for (let n = 0; n < 8; n++) {
        board().work(unrelated.id, { body: `Progress ${n}` });
        // Status updates on the pair itself are not comparison inputs either.
        board().work(planned.id, { status_line: `Progress ${n}` });
        await settle(30);
      }
      expect(runtime.sessions.length).toBe(before + 1);
      expect(merger()!.inbox[0]).toContain('Changed requirement.');
    } finally { watcher.shutdown(); }
  });
}

test('two merging pairs settle independently and separation cancels a pending comparison', async () => {
  const { p, planned } = cards();
  const a = board().create({ title: 'Other left', x: 3000, y: 0 });
  const b = board().create({ title: 'Other right', x: 4000, y: 0 });
  project.shutdown();
  const watcher = new Merges({ board: board(), runtime, pathFor: () => main, settleMs: 100 });
  try {
    watcher.merge(p.id, planned.id);
    watcher.merge(a.id, b.id);
    const before = runtime.sessions.length;
    board().work(planned.id, { body: 'Settled pair.' });
    for (let n = 0; n < 8; n++) {
      board().work(b.id, { body: `Still editing ${n}` });
      await settle(30);
    }
    expect(runtime.sessions.length).toBe(before + 1);
    expect(merger()!.inbox[0]).toContain('Settled pair.');
    board().separate(a.id);
    await settle(150);
    expect(runtime.sessions.length).toBe(before + 1);
  } finally { watcher.shutdown(); }
});

test('unrelated activity cannot postpone automatic separation either', async () => {
  const { p, planned } = cards();
  const unrelated = board().create({ title: 'Another worker', x: 3000, y: 0 });
  project.shutdown();
  const watcher = new Merges({ board: board(), runtime, pathFor: () => main, settleMs: 100 });
  try {
    watcher.merge(p.id, planned.id);
    board().snooze(planned.id, { until: '2099-01-01T00:00:00.000Z', why: 'later', by: 'owner' });
    for (let n = 0; n < 8; n++) {
      board().work(unrelated.id, { body: `Progress ${n}` });
      await settle(30);
    }
    expect(board().item(p.id)!.idea?.proposal?.merge).toBeUndefined();
  } finally { watcher.shutdown(); }
});
