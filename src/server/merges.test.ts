import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MERGED_SIZE, onCanvas, sizeOf } from '../core/layout';
import { type Item, mergeableWith, mergeRank, needsYou, openQuestions } from '../core/types';
import { mergeCandidates } from '../ui/merge';
import { CanvasRuntime } from './canvas';
import { Store } from './db';
import { Merges } from './merges';
import { FakeRuntime, gitRepo, noForge } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let canvas: CanvasRuntime;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-merges-'));
  main = join(dir, 'main');
  gitRepo(main);
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  canvas = new CanvasRuntime({ repos: [{ path: main, clones: 1 }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, limitMargin: 10 });
});
afterEach(() => {
  canvas.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const board = () => canvas.board;
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
    canvas.act(p.id, { action: 'merge', with: planned.id });
    const m = merger()!;
    expect(m.spec.readOnly).toBe(true);
    expect(m.inbox[0]).toContain('The CSV export writes umlauts wrongly.');
    expect(m.inbox[0]).toContain('Dates in the CSV export are off by one day.');
    expect(m.inbox[0]).toContain('Which encoding?');

    // while the agent merges: the two show as one, and neither needs the owner
    let a = board().item(p.id)!;
    let b = board().item(planned.id)!;
    expect(a.proposal?.merge).toMatchObject({ with: planned.id });
    expect(b.mergingInto).toBe(p.id);
    expect(needsYou(a)).toBe(false);
    expect(openQuestions(a)).toEqual([]);
    expect(sizeOf(a, board().items())).toEqual([...MERGED_SIZE]);
    expect(onCanvas(board().items()).map((i) => i.id)).not.toContain(planned.id);
    expect(() => canvas.act(planned.id, { action: 'start' })).toThrow('merged with a proposal');
    expect(() => canvas.act(p.id, { action: 'accept' })).toThrow('merged with another card');

    m.call('merge_cards', { title: 'Fix the CSV export', task: 'The CSV export writes umlauts wrongly and dates off by one day. Fix both.' });
    m.emit({ type: 'idle' });
    await settle();
    a = board().item(p.id)!;
    expect(a.proposal?.merge).toMatchObject({ with: planned.id, title: 'Fix the CSV export', task: 'The CSV export writes umlauts wrongly and dates off by one day. Fix both.' });
    // the merged card waits for the owner, in „Braucht dich“
    expect(needsYou(a)).toBe(true);

    canvas.act(p.id, { action: 'approveMerge' });
    expect(board().item(p.id)).toBeUndefined();
    b = board().item(planned.id)!;
    expect(b.state).toBe('planned');
    expect(b.mergingInto).toBeUndefined();
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
    canvas.act(p.id, { action: 'merge', with: planned.id });
    canvas.act(p.id, { action: 'separate' });
    const a = board().item(p.id)!;
    const b = board().item(planned.id)!;
    expect(a.proposal?.merge).toBeUndefined();
    expect(b.mergingInto).toBeUndefined();
    expect(b.body).toBe('Dates in the CSV export are off by one day.');
    expect(b.x).toBe(900);
    expect({ x: a.x, y: a.y }).toEqual({ x: p.x, y: p.y });
    expect(needsYou(a)).toBe(true);
    // the agent's late answer changes nothing any more
    merger()!.call('merge_cards', { title: 'x', task: 'y' });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(board().item(p.id)!.proposal?.merge).toBeUndefined();
  });

  test('two proposals merged: the other keeps the questions of both', async () => {
    const { p } = cards();
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.', questions: [{ text: 'Which separator?', options: [';', ','] }] });
    canvas.act(p.id, { action: 'merge', with: q.id });
    merger()!.call('merge_cards', { title: 'CSV in and out', task: 'Export and import CSV correctly.' });
    merger()!.emit({ type: 'idle' });
    await settle();
    canvas.act(p.id, { action: 'approveMerge' });
    const b = board().item(q.id)!;
    expect(b.state).toBe('proposal');
    expect(b.body).toBe('Export and import CSV correctly.');
    expect(b.proposal?.questions.map((x) => x.text)).toEqual(['Which separator?', 'Which encoding?']);
  });

  test('ideas, the card itself and cards already merging are excluded; started partners are allowed', () => {
    const { p, planned } = cards();
    const idea = board().create({ title: 'Think about exports', x: 0, y: 900, idea: true });
    expect(() => canvas.act(p.id, { action: 'merge', with: p.id })).toThrow();
    expect(() => canvas.act(p.id, { action: 'merge', with: idea.id })).toThrow('can no longer be merged');
    // a card merged with one proposal is not merged with a second
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.' });
    canvas.act(q.id, { action: 'merge', with: planned.id });
    expect(() => canvas.act(p.id, { action: 'merge', with: planned.id })).toThrow();
    canvas.act(q.id, { action: 'separate' });
    board().work(planned.id, { state: 'working' });
    expect(() => canvas.act(p.id, { action: 'merge', with: planned.id })).not.toThrow();
    expect(() => canvas.act(planned.id, { action: 'merge', with: p.id })).toThrow();
  });

  test('an agent that ends without a merged text leaves the reason, and the merge can be tried again', async () => {
    const { p, planned } = cards();
    canvas.act(p.id, { action: 'merge', with: planned.id });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(board().item(p.id)!.proposal?.merge?.failed).toBeDefined();
    const before = runtime.sessions.length;
    canvas.act(p.id, { action: 'merge', with: planned.id });
    expect(runtime.sessions.length).toBe(before + 1);
    expect(board().item(p.id)!.proposal?.merge).toMatchObject({ with: planned.id });
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
    const before = store.card(planned.id)!;
    canvas.act(p.id, { action: 'merge', with: planned.id });
    expect(merger()!.inbox[0]).toContain('CSV encoding and dates are fixed.');
    expect(merger()!.spec.system).toContain('without reading repository files or branch diffs');
    await finishMerge(covered(p));
    const draft = board().item(p.id)!.proposal!.merge!;
    expect(draft.title).toBe(before.title!);
    expect(draft.task).toBe(before.body!);
    expect(store.card(planned.id)).toEqual(before);
    expect(board().item(p.id)).toBeDefined();
    expect(needsYou(board().item(p.id)!)).toBe(true);
    canvas.act(p.id, { action: 'approveMerge' });
    expect(store.card(planned.id)).toEqual(before);
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
    const before = store.card(planned.id)!;
    canvas.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: p.body, covered: false }], followUp: { title: 'Fix CSV encoding', task: 'Fix the encoding of exported umlauts.', images: [], questions: [0] } });
    expect(board().items().some((i) => i.title === 'Fix CSV encoding')).toBe(false);
    canvas.act(p.id, { action: 'approveMerge' });
    const next = board().items().find((i) => i.title === 'Fix CSV encoding')!;
    expect(next.state).toBe('planned');
    expect(next.from).toBe(planned.id);
    expect(next.repo).toBe(planned.repo);
    expect(next.body).toStartWith('Fix the encoding of exported umlauts.');
    expect(next.body).toContain('Which encoding?');
    expect(next.manualDependsOn).toEqual([planned.id]);
    expect(board().item(child.id)!.from).toBe(planned.id);
    expect(board().manualDependencies().map(([a, b]) => [a, b])).toContainEqual([prerequisite.id, planned.id]);
    expect(board().manualDependencies().map(([a, b]) => [a, b])).toContainEqual([planned.id, child.id]);
    expect(store.card(planned.id)).toEqual(before);
  });

  test('a planned task can start a merge and separate with no proposal metadata left behind', async () => {
    const a = board().create({ title: 'XLSX too', body: 'Add CSV. Also XLSX.', x: 10, y: 20 });
    const b = board().create({ title: 'CSV', body: 'Add CSV.', x: 500, y: 20 });
    board().work(b.id, { state: 'working', branch: 'csv' });
    const original = store.card(a.id)!;
    canvas.act(a.id, { action: 'merge', with: b.id });
    await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: 'Add CSV.', covered: true }, { text: ' Also XLSX.', covered: false }], followUp: { title: 'XLSX', task: 'Add XLSX.', images: [], questions: [] } });
    expect(board().item(a.id)!.proposal!.merge!.task).toBe('Add CSV.');
    canvas.act(a.id, { action: 'separate' });
    const { updated_at: _, waiting_since: __, ...after } = store.card(a.id)!;
    const { updated_at: ___, waiting_since: ____, ...before } = original;
    expect(after).toEqual(before);
    expect(board().items()).toHaveLength(2);
  });

  test('a planned task picking a proposal keeps the planned task and combines both texts', async () => {
    const { p, planned } = cards();
    canvas.act(planned.id, { action: 'merge', with: p.id });
    expect(board().item(p.id)!.proposal!.merge!.with).toBe(planned.id);
    await finishMerge({ title: 'CSV fixes', task: 'Fix dates and encoding.' });
    canvas.act(p.id, { action: 'approveMerge' });
    expect(board().item(planned.id)!.state).toBe('planned');
    expect(board().item(planned.id)!.body).toContain('Fix dates and encoding.');
  });

  test('two planned tasks combine into the selected partner', async () => {
    const a = board().create({ title: 'A', body: 'A task', x: 0, y: 0 });
    const b = board().create({ title: 'B', body: 'B task', x: 400, y: 0 });
    canvas.act(a.id, { action: 'merge', with: b.id });
    await finishMerge({ title: 'Together', task: 'A and B task' });
    canvas.act(a.id, { action: 'approveMerge' });
    expect(board().item(a.id)).toBeUndefined();
    expect(board().item(b.id)!.body).toBe('A and B task');
  });

  test('an incomplete coverage map is refused, and changed survivor text requires a new comparison', async () => {
    const { p, planned } = cards();
    board().work(planned.id, { state: 'working', branch: 'csv' });
    canvas.act(p.id, { action: 'merge', with: planned.id });
    expect(merger()!.call('merge_cards', { outcome: 'covered', titleCovered: true, parts: [{ text: 'Only a fragment', covered: true }] })).toContain('entire left task exactly');
    expect(board().item(p.id)!.proposal!.merge!.task).toBeUndefined();
    await finishMerge(covered(p));
    board().work(planned.id, { body: 'Changed requirements.' });
    expect(() => canvas.act(p.id, { action: 'approveMerge' })).toThrow('changed since the comparison');
    expect(board().item(p.id)).toBeDefined();
  });

  test('a combined draft cannot overwrite a card that started while waiting for approval', async () => {
    const { p, planned } = cards();
    canvas.act(p.id, { action: 'merge', with: planned.id });
    await finishMerge({ title: 'Combined', task: 'Both requirements.' });
    board().work(planned.id, { state: 'working', branch: 'csv' });
    expect(() => canvas.act(p.id, { action: 'approveMerge' })).toThrow('progressed');
    expect(board().item(planned.id)!.body).toBe(planned.body);
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
    for (const invalid of [{ parent: 'plan' }, { mergingInto: 'another' }, { repoDown: true }, { snoozed: { why: 'later', by: 'owner', until: '2026-12-01' } }] as Partial<Item>[]) {
      expect(mergeableWith(p, { ...planned, ...invalid })).toBe(false);
      expect(mergeableWith({ ...p, ...invalid }, planned)).toBe(false);
    }
    expect(mergeableWith(all[2]!, all[1]!)).toBe(false);
  });
});


test('late answers from a separated comparison cannot complete a new merge', async () => {
  const { p, planned } = cards();
  canvas.act(p.id, { action: 'merge', with: planned.id });
  const old = merger()!;
  canvas.act(p.id, { action: 'separate' });
  canvas.act(p.id, { action: 'merge', with: planned.id });
  const current = merger()!;
  expect(current).not.toBe(old);
  old.call('merge_cards', { title: 'Stale', task: 'Stale task.' });
  old.emit({ type: 'idle' });
  await settle();
  expect(board().item(p.id)!.proposal!.merge!.task).toBeUndefined();
  await finishMerge({ title: 'Current', task: 'Current task.' });
  expect(board().item(p.id)!.proposal!.merge!.task).toBe('Current task.');
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
  expect(board().item(back.id)!.proposal!.merge!.outcome).toBe('covered');
});

test('a title-only request can become extra work, with selected screenshots and questions', async () => {
  const { p, planned } = cards();
  const image = canvas.images.save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=', 'base64'), 'image/png');
  const unused = canvas.images.save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=', 'base64'), 'image/png');
  board().work(p.id, { body: '', images: JSON.stringify([image, unused]) });
  board().work(planned.id, { state: 'done' });
  board().archive([planned.id]);
  canvas.act(p.id, { action: 'merge', with: planned.id });
  expect(merger()!.images[0]).toEqual([canvas.images.path(image)!, canvas.images.path(unused)!]);
  await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [], followUp: { title: 'Fix umlauts', task: 'Correct umlaut encoding in CSV exports.', images: [image], questions: [0] } });
  canvas.act(p.id, { action: 'approveMerge' });
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
  canvas.act(planned.id, { action: 'merge', with: p.id });
  board().work(blocker.id, { state: 'done' });
  await settle(40);
  expect(board().item(planned.id)!.state).toBe('planned');
  expect(board().item(planned.id)!.queue).toBeDefined();
  canvas.act(p.id, { action: 'separate' });
});


test('an archived stopped survivor holds its new follow-up until its work lands', async () => {
  const { p, planned } = cards();
  board().work(planned.id, { branch: 'stopped-export' });
  board().archive([planned.id]);
  canvas.act(p.id, { action: 'merge', with: planned.id });
  await finishMerge({ outcome: 'followUp', titleCovered: false, parts: [{ text: p.body, covered: false }], followUp: { title: 'Remaining encoding work', task: 'Correct encoding after CSV export lands.', images: [], questions: [] } });
  canvas.act(p.id, { action: 'approveMerge' });
  let next = board().items().find((i) => i.title === 'Remaining encoding work')!;
  expect(next.manualArchived?.map((i) => i.id)).toEqual([planned.id]);
  expect(next.manualDependsOn).toEqual([planned.id]);
  canvas.act(next.id, { action: 'start' });
  await settle(40);
  next = board().item(next.id)!;
  expect(next.state).toBe('planned');
  expect(next.queue && 'behind' in next.queue ? next.queue.behind : []).toContain(planned.id);
  board().unarchive(planned.id);
  board().work(planned.id, { state: 'done' });
  await settle(40);
  expect(board().item(next.id)!.manualArchived).toBeUndefined();
});
