import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifact } from './testing';
import { board, eachTest, flush, manual, runtime, store, workers } from './workers-fixture';
import { git } from './workstations';

eachTest();

/** The Activity log's lines of a card, oldest first. */
const log = (id: string) => board.activityRows(['c'], undefined, 100).filter((r) => r.cardId === id).reverse().map((r) => `${r.who}:${r.code}`);

describe('the Activity log', () => {
  test('created: a card the owner made, and none of the plan doc\'s', () => {
    const c = board.create({ title: 'Mine', x: 0, y: 0 }, undefined, 'owner');
    board.create({ title: 'Silent', x: 0, y: 0 });
    expect(log(c.id)).toEqual(['owner:created']);
    expect(board.activityRows(['c'], undefined, 100)).toHaveLength(1);
  });

  test('proposed: a card an agent proposes', async () => {
    const c = manual();
    const p = board.propose(c.id, { title: 'Later', task: 'Do it' });
    expect(log(p.id)).toEqual(['agent:proposed']);
  });

  test('started, approved and landed, in order', async () => {
    const c = manual();
    await workers.start(c.id);
    const clone = board.row(c.id).workstation!;
    writeFileSync(join(clone, 'x.ts'), '');
    git(clone, 'add', '.');
    git(clone, 'commit', '--quiet', '-m', 'X');
    await runtime.last.call('ready_for_review', { summary: 'S', demo: artifact() });
    runtime.last.emit({ type: 'idle' });
    await workers.approve(c.id);
    await flush();
    expect(log(c.id).slice(0, 2)).toEqual(['agent:started', 'owner:approved']);
    expect(log(c.id)).toContain('obeya:landed');
  });

  test('archived and deleted by the owner, the deleted card still named', () => {
    const a = manual();
    board.work(a.id, { state: 'done' });
    board.archive([a.id]);
    const d = board.create({ title: 'Gone', x: 0, y: 0 });
    board.remove(d.id);
    expect(log(a.id)).toEqual(['owner:archived']);
    expect(log(d.id)).toEqual(['owner:deleted']);
    const entries = board.activityEntries(board.activityRows(['c'], undefined, 100), 'C');
    expect(entries.find((e) => e.card.id === d.id)).toMatchObject({ deleted: true, card: { title: 'Gone' } });
  });

  test('reviewSent: held comments the owner sends', async () => {
    const c = manual();
    await workers.start(c.id);
    await runtime.last.call('ready_for_review', { summary: 'S', demo: artifact() });
    runtime.last.emit({ type: 'idle' });
    workers.message(c.id, 'Zu schnell.', [], false, undefined, { at: 1 });
    workers.released(c.id, true);
    expect(log(c.id)).toContain('owner:reviewSent');
  });

  test('usageLimit: once for a limit that is read again, with the harness', async () => {
    const c = manual();
    await workers.start(c.id);
    runtime.last.emit({ type: 'error', message: 'Session limit', limit: {} });
    runtime.last.emit({ type: 'idle' });
    board.waitsForLimit({ card: c.id }, Date.now() + 60_000);
    board.waitsForLimit({ card: c.id }, Date.now() + 90_000);
    expect(log(c.id).filter((l) => l === 'obeya:usageLimit')).toHaveLength(1);
  });

  test('usageLimit: a limit that cleared and comes again is a stop of its own', async () => {
    const c = manual();
    await workers.start(c.id);
    board.waitsForLimit({ card: c.id }, Date.now() + 60_000);
    board.waitsForLimit({ card: c.id }, undefined);
    board.waitsForLimit({ card: c.id }, Date.now() + 90_000);
    expect(log(c.id).filter((l) => l === 'obeya:usageLimit')).toHaveLength(2);
  });

  test('deleted: each deletion keeps the title the card had then', () => {
    const d = board.create({ title: 'First', x: 0, y: 0 });
    board.remove(d.id);
    board.restore(d.id);
    store.cards.update(d.id, { title: 'Second' });
    board.remove(d.id);
    const entries = board.activityEntries(board.activityRows(['c'], undefined, 100), 'C');
    expect(entries.filter((e) => e.card.id === d.id).map((e) => e.card.title)).toEqual(['Second', 'First']);
  });

  test('paging: older lines come after `before`, and `more` tells there are some', () => {
    for (let n = 0; n < 5; n++) board.create({ title: `C${n}`, x: 0, y: 0 }, undefined, 'owner');
    const first = board.activityRows(['c'], undefined, 3);
    expect(first).toHaveLength(4);
    const next = board.activityRows(['c'], first[2]!.id, 3);
    expect(next.map((r) => r.id)).toEqual([first[3]!.id, ...board.activityRows(['c'], first[3]!.id, 3).map((r) => r.id)]);
  });

  test('stopped: taking the workstation from an active card logs the stop once, also when moving the clone fails', async () => {
    const c = manual();
    await workers.start(c.id);
    expect(await workers.evict(c.id)).toBe(true);
    expect(log(c.id).filter((l) => l === 'owner:stopped')).toHaveLength(1);

    const d = manual();
    await workers.start(d.id);
    const real = workers['o'].workstations.evict;
    workers['o'].workstations.evict = async () => { throw new Error('git is gone'); };
    try {
      expect(await workers.evict(d.id)).toBe(false);
    } finally {
      workers['o'].workstations.evict = real;
    }
    expect(log(d.id).filter((l) => l === 'owner:stopped')).toHaveLength(1);
  });
});
