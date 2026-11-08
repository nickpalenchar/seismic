import { expect, test } from 'bun:test';
import { generic } from '../adapters/generic';
import { AGENT_DEFAULTS, type AgentSetting, type WorkConfig } from '../core/types';
import { BadRequest, Board } from './board';
import { attribute, checkedFeedback, workConfig } from './feedback';
import { artifact } from './testing';
import { Workers } from './workers';
import { board, docs, eachTest, flush, manual, runtime, setWorkers, spaces, store, workers } from './workers-fixture';

eachTest();
const opus: AgentSetting = { model: 'opus', effort: 'high' };
const codex: AgentSetting = { ...AGENT_DEFAULTS.worker, harness: 'codex', codex: { model: 'default', effort: 'low' } };
function using(choice: () => AgentSetting) {
  setWorkers(new Workers({ board, runtime, workstations: spaces, adapter: { ...generic, workstations: 'clones', land: 'main' }, agentSetting: choice }));
}
const handOver = () => runtime.last.call('ready_for_review', { summary: 'Done.', demo: artifact() });
const approve = (id: string) => board.work(id, { approved_at: new Date().toISOString() });
const claudeOpus: WorkConfig = { harness: 'claude', model: 'claude-opus-5-5', effort: 'high', requested: 'opus' };

test('a response credits the session that did the work as it ran, through changed defaults, a restart and a second click', async () => {
  let choice = opus;
  using(() => choice);
  const card = manual();
  await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 's-1', model: 'claude-opus-5-5' });
  await handOver();
  choice = { model: 'sonnet', effort: 'low' };
  workers.shutdown();
  await flush();
  using(() => choice);
  workers.resumeAll();
  runtime.last.emit({ type: 'session', id: 's-1', model: 'claude-opus-5-5' });
  approve(card.id);

  const first = board.giveFeedback(card.id, { answer: { rating: 4 } });
  expect(first.configs).toEqual([claudeOpus]);
  expect(first).toMatchObject({ cardId: card.id, short: board.row(card.id).short, projectId: 'c', title: 'Zählerstände exportieren', repo: 'home', attribution: 'single', configs: [claudeOpus], credited: claudeOpus, answer: { rating: 4 } });
  expect(first.plan).toBeUndefined();
  expect(first.updatedAt).toBeUndefined();
  // the same click twice is one response; a changed answer replaces it and keeps whom it credits
  expect(board.giveFeedback(card.id, { answer: { rating: 4 } })).toEqual(first);
  const changed = board.giveFeedback(card.id, { answer: { rating: 2, comment: '  Missed the tests. ' } });
  expect(changed).toMatchObject({ id: first.id, answer: { rating: 2, comment: 'Missed the tests.' }, credited: claudeOpus });
  expect(changed.updatedAt).toBeDefined();
  expect(board.feedback(card.id)).toHaveLength(1);
  workers.shutdown();
});

test('work done by two configurations credits neither alone, and an earlier response keeps whom it credited', async () => {
  let choice = opus;
  using(() => choice);
  const card = manual();
  await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 's-1', model: 'claude-opus-5-5' });
  await handOver();
  approve(card.id);
  const first = board.giveFeedback(card.id, { answer: { rating: 5 } });
  await workers.stop(card.id);
  await workers.freed();
  choice = codex;
  await workers.start(card.id);
  // a run begun after a handover is not credited with it
  approve(card.id);
  expect(board.giveFeedback(card.id, { answer: { rating: 5 }, handover: first.handover }).credited).toEqual(claudeOpus);
  runtime.last.emit({ type: 'session', id: 'codex:t-1', setting: { ...codex, codex: { model: 'gpt-resolved', effort: 'low' } } });
  await handOver();
  approve(card.id);
  const second = board.giveFeedback(card.id, { answer: { comment: 'Good in the end.' } });
  expect(second.handover).toBeGreaterThan(first.handover);
  expect(second).toMatchObject({ attribution: 'mixed', configs: [claudeOpus, { harness: 'codex', model: 'gpt-resolved', effort: 'low', requested: 'default' }] });
  expect(second.credited).toBeUndefined();
  expect(board.feedback(card.id).map((f) => f.attribution)).toEqual(['single', 'mixed']);
  workers.shutdown();
});

test('nothing known of who did the work credits no one; a model the session never named stays unknown', async () => {
  const card = manual();
  board.log(card.id, 'review', 'worker', 'Done.');
  approve(card.id);
  expect(board.giveFeedback(card.id, { answer: { rating: 3 } })).toMatchObject({ attribution: 'missing', configs: [] });

  using(() => ({ model: 'default', effort: 'medium' }));
  const other = manual();
  await workers.start(other.id);
  runtime.last.emit({ type: 'session', id: 's-2' });
  await handOver();
  approve(other.id);
  expect(board.giveFeedback(other.id, { answer: { rating: 3 } }).credited).toEqual({ harness: 'claude', model: null, effort: 'medium', requested: 'default' });
  workers.shutdown();
});

test('a legacy session resumed on today’s defaults is credited only with what the session itself says', async () => {
  const card = manual();
  await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 'legacy' });
  workers.shutdown();
  await flush();
  store.db.run('DELETE FROM agent_runs');
  board.work(card.id, { agent_setting: null });
  using(() => opus);
  workers.resumeAll();
  runtime.last.emit({ type: 'session', id: 'legacy', model: 'claude-sonnet-5-5' });
  expect(store.runs(card.id)).toMatchObject([{ session: 'legacy', harness: 'claude', model: 'claude-sonnet-5-5', effort: null }]);
  expect(store.runs(card.id)[0]!.requested).toBeUndefined();
  // restarted before the session names itself, the defaults pinned for it meanwhile are not taken for what it ran on
  workers.shutdown();
  await flush();
  workers.resumeAll();
  runtime.last.emit({ type: 'session', id: 'legacy', model: 'claude-sonnet-5-5' });
  expect(store.runs(card.id)).toMatchObject([{ session: 'legacy', harness: 'claude', model: 'claude-sonnet-5-5', effort: null }]);
  workers.shutdown();
});

test('a workstream’s response carries its plan; it follows the card to another project', () => {
  const w = board.snapshot().items.find((i) => i.label === 'W1')!;
  board.log(w.id, 'review', 'worker', 'Done.');
  approve(w.id);
  const f = board.giveFeedback(w.id, { answer: { rating: 1 }, facets: { type: 'bug' } });
  expect(f).toMatchObject({ title: 'Title W1', plan: { id: w.parent, title: 'A', file: 'docs/plan/a.md' }, facets: { type: 'bug' } });
  store.ensureProject('d', 'D');
  store.moveCard(w.id, 'd', { x: 0, y: 0 });
  expect(store.feedback({ cardId: w.id })[0]).toMatchObject({ id: f.id, projectId: 'd', plan: { title: 'A' } });
  // the dashboard reads every project's responses, from any project
  expect(board.allFeedback().map((x) => [x.id, x.projectId])).toEqual([[f.id, 'd']]);
  expect(board.allFeedback()[0]!.deleted).toBeUndefined();
});

test('a deleted card’s response still counts, marked as having no card to go back to', () => {
  const card = manual();
  board.log(card.id, 'review', 'worker', 'Done.');
  approve(card.id);
  board.giveFeedback(card.id, { answer: { rating: 3 } });
  store.db.query('UPDATE cards SET deleted_at = $at WHERE id = $id').run({ at: new Date().toISOString(), id: card.id });
  expect(board.allFeedback().find((x) => x.cardId === card.id)).toMatchObject({ deleted: true, answer: { rating: 3 } });
});

test('a response is checked before it is kept', () => {
  const card = manual();
  const give = (input: unknown) => () => board.giveFeedback(card.id, input);
  expect(give({ answer: { rating: 1 } })).toThrow('has not handed over');
  board.log(card.id, 'review', 'worker', 'Done.');
  expect(give({ answer: { rating: 1 } })).toThrow('only approved work');
  approve(card.id);
  for (const bad of [null, {}, { answer: {} }, { answer: { comment: '   ' } }, { answer: { rating: 'good' } }, { answer: { rating: Infinity } }, { answer: { stars: 3 } }, { answer: { rating: 1 }, handover: 999 }, { answer: { rating: 1 }, facets: { type: 3 } }])
    expect(give(bad)).toThrow(BadRequest);
  expect(give({ answer: { comment: 'x'.repeat(4001) } })).toThrow('at most');
  // a long conversation after the handover does not hide it
  for (let n = 0; n < 510; n++) board.log(card.id, 'state', 'obeya', `Line ${n}`);
  expect(board.giveFeedback(card.id, { answer: { rating: 1 } }).handover).toBeGreaterThan(0);
  store.db.run('DELETE FROM feedback');
  expect(board.feedback(card.id)).toEqual([]);
  expect(() => board.giveFeedback('nope', { answer: { rating: 1 } })).toThrow(BadRequest);
});

test('distinct configurations are told apart by every field, unknown ones too', () => {
  const run = (model: string | null, at: string) => ({ harness: 'claude' as const, model, effort: 'high' as const, at });
  expect(attribute([run('m', '1'), run('m', '2')])).toEqual({ attribution: 'single', configs: [{ harness: 'claude', model: 'm', effort: 'high' }] });
  expect(attribute([run('m', '1'), run(null, '2')]).attribution).toBe('mixed');
  expect(attribute([run('m', '1'), run(null, '3')], '2').attribution).toBe('single');
  expect(attribute([{ harness: null, model: null, effort: null, at: '1' }]).attribution).toBe('missing');
  expect(attribute([]).attribution).toBe('missing');
});

test('a session’s configuration: the resolved model over the alias, a Codex model chosen by name as it is', () => {
  expect(workConfig(opus, 'claude-opus-5-5')).toEqual(claudeOpus);
  expect(workConfig(opus, undefined)).toEqual({ harness: 'claude', model: null, effort: 'high', requested: 'opus' });
  expect(workConfig({ ...codex, codex: { model: 'gpt-x', effort: 'max' } }, undefined)).toEqual({ harness: 'codex', model: 'gpt-x', effort: 'max', requested: 'gpt-x' });
  expect(workConfig(opus, 'claude-sonnet-5-5', true)).toEqual({ harness: 'claude', model: 'claude-sonnet-5-5', effort: null });
  expect(checkedFeedback({ answer: { rating: 0 }, facets: {} })).toEqual({ answer: { rating: 0 } });
});

test('archiving after the landing, approved work asks for feedback until answered, and the answer stands on the card through a restart', () => {
  board.archiving = () => 'landed';
  const card = manual();
  board.log(card.id, 'review', 'worker', 'Done.');
  const handover = store.handover(card.id)!.id;
  // waiting for approval, nothing is asked yet
  expect(board.item(card.id)!.rate).toBeUndefined();
  board.work(card.id, { state: 'approved', approved_at: new Date().toISOString() });
  expect(board.item(card.id)!.rate).toEqual({ handover });
  // approved again (a retried landing), it is the same prompt; once answered, the card shows the answer
  board.work(card.id, { state: 'approved', approved_at: new Date().toISOString() });
  board.giveFeedback(card.id, { answer: { rating: 4, comment: 'Clean.' }, handover });
  expect(board.item(card.id)!.rate).toEqual({ handover, answer: { rating: 4, comment: 'Clean.' } });
  // read afresh, as after a restart
  const again = new Board(store, board.project, () => ({ docs, dirs: [] }));
  again.archiving = () => 'landed';
  expect(again.item(card.id)!.rate).toEqual({ handover, answer: { rating: 4, comment: 'Clean.' } });
  // work handed over again after more work asks about its new handover
  board.work(card.id, { state: 'waiting' });
  board.log(card.id, 'review', 'worker', 'Done again.');
  board.work(card.id, { state: 'approved' });
  expect(board.item(card.id)!.rate).toEqual({ handover: store.handover(card.id)!.id });
});

test('work that changed nothing asks too once done; a prompt left unanswered stays', () => {
  board.archiving = () => 'landed';
  const card = manual();
  board.log(card.id, 'review', 'worker', 'Nothing to change.');
  board.work(card.id, { state: 'done', approved_at: new Date().toISOString() });
  expect(board.item(card.id)!.rate).toEqual({ handover: store.handover(card.id)!.id });
  // a card nobody handed work over on asks nothing
  const bare = manual();
  board.work(bare.id, { state: 'done' });
  expect(board.item(bare.id)!.rate).toBeUndefined();
});

test('archiving by hand, a card asks for feedback once the owner archives it; a workstream, which goes with its plan, once approved', () => {
  const card = manual();
  board.log(card.id, 'review', 'worker', 'Done.');
  const handover = store.handover(card.id)!.id;
  board.work(card.id, { state: 'live', approved_at: new Date().toISOString() });
  expect(board.item(card.id)!.rate).toBeUndefined();
  board.archive([card.id]);
  expect(board.card(card.id)!.rate).toEqual({ handover });
  expect(board.archived().find((i) => i.id === card.id)!.rate).toEqual({ handover });
  // and takes the answer there
  board.giveFeedback(card.id, { answer: { rating: 4 }, handover });
  expect(board.card(card.id)!.rate).toEqual({ handover, answer: { rating: 4 } });
  // back on the project, it waits to be archived again
  board.unarchive(card.id);
  expect(board.item(card.id)!.rate).toBeUndefined();
  const w = board.snapshot().items.find((i) => i.label === 'W1')!;
  board.log(w.id, 'review', 'worker', 'Done.');
  board.work(w.id, { state: 'approved', approved_at: new Date().toISOString() });
  expect(board.item(w.id)!.rate).toEqual({ handover: store.handover(w.id)!.id });
});

test('archiving after the landing, a finished card goes into the archive once its worker is done, and one still at work stays', () => {
  board.archiving = () => 'landed';
  const card = manual();
  board.work(card.id, { state: 'live', workstation: '/tmp/somewhere', landed: '{}' });
  board.work(card.id, { workstation: null, landed: null });
  board.workDone(card.id);
  expect(board.snapshot().items.some((i) => i.id === card.id)).toBe(false);
  expect(board.archived().map((i) => i.id)).toContain(card.id);
  // archiving by hand, it stays where it is
  board.archiving = () => 'manual';
  const other = manual();
  board.work(other.id, { state: 'live' });
  board.workDone(other.id);
  expect(board.snapshot().items.some((i) => i.id === other.id)).toBe(true);
  // a workstream goes with its plan, not on its own
  board.archiving = () => 'landed';
  const w = board.snapshot().items.find((i) => i.label === 'W1')!;
  board.work(w.id, { state: 'live' });
  board.workDone(w.id);
  expect(board.archived().map((i) => i.id)).not.toContain(w.id);
});

test('turned off, no card asks for feedback and the responses given stay', () => {
  const card = manual();
  board.log(card.id, 'review', 'worker', 'Done.');
  board.work(card.id, { state: 'approved', approved_at: new Date().toISOString() });
  board.giveFeedback(card.id, { answer: { rating: 5 } });
  let asks = false;
  const off = new Board(store, board.project, () => ({ docs, dirs: [] }), undefined, undefined, () => 'de', undefined, () => asks);
  off.archiving = () => 'landed';
  expect(off.item(card.id)!.rate).toBeUndefined();
  expect(off.feedback(card.id)).toHaveLength(1);
  asks = true;
  off.changed();
  expect(off.item(card.id)!.rate).toMatchObject({ answer: { rating: 5 } });
});
