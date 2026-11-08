import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifact, identify, until } from './testing';
import { board, dir, eachTest, main, manual, runtime, setWorkers, setup, spaces, workers } from './workers-fixture';
import { git } from './workstations';
import { cardTalk } from '../ui/talk';
import { generic } from '../adapters/generic';
import { Workers } from './workers';

eachTest();
afterEach(() => workers.shutdown());

/** Real repositories, fake sessions, and a git hook whose release the test controls. */
async function card(files: Record<string, string>, subject = 'Update checkout') {
  spaces.ensureClones(main, spaces.list().length + 1);
  for (const w of spaces.list()) identify(w.path);
  const c = manual();
  await workers.start(c.id);
  const session = runtime.last;
  const cwd = board.row(c.id).workstation!;
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
  const handOver = async () => {
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '-m', subject);
    await session.call('ready_for_review', { summary: subject, demo: artifact() });
    session.emit({ type: 'idle' });
  };
  return { ...c, cwd, session, handOver };
}

async function heldMerge(cwd: string) {
  const releases: (() => void)[] = [];
  const gate = Bun.serve({ port: 0, fetch: () => new Promise<Response>((r) => { releases.push(() => r(new Response('ok'))); }) });
  const hooks = join(cwd, '.git/hooks');
  mkdirSync(hooks, { recursive: true });
  git(cwd, 'config', 'core.hooksPath', hooks);
  const hook = join(hooks, 'post-merge');
  // A local HTTP gate holds git without timing assumptions or a polling shell loop.
  writeFileSync(hook, `#!/bin/sh\ncurl --max-time 15 -sf http://127.0.0.1:${gate.port}/ >/dev/null\n`, { mode: 0o755 });
  return {
    entered: () => until(() => releases.length > 0, 10000),
    release: () => releases.shift()!(),
    close: () => { for (const release of releases.splice(0)) release(); gate.stop(true); },
  };
}

describe('the visible landing queue', () => {
  test('waiters move up and clear their positions after landing', async () => {
    const a = await card({ 'a.ts': 'a' }, 'First'); await a.handOver();
    const b = await card({ 'b.ts': 'b' }, 'Second'); await b.handOver();
    const c = await card({ 'c.ts': 'c' }, 'Third'); await c.handOver();
    const gate = await heldMerge(main);
    const first = workers.approve(a.id);
    const approvals = [first];
    try {
      await gate.entered();
      const second = workers.approve(b.id); approvals.push(second);
      await until(() => board.item(b.id)?.review?.landingPosition === 1);
      const third = workers.approve(c.id); approvals.push(third);
      await until(() => board.item(c.id)?.review?.landingPosition === 2);
      expect(board.item(a.id)?.review?.landingPosition).toBe(0);
      await expect(workers.approve(b.id)).rejects.toThrow('not ready');
      gate.release();
      await first;
      await gate.entered();
      await until(() => board.item(b.id)?.review?.landingPosition === 0);
      expect(board.item(c.id)?.review?.landingPosition).toBe(1);
      gate.release();
      await second;
      await until(() => board.item(c.id)?.review?.landingPosition === 0);
      // Release the third hook when it arrives, rather than an earlier release closure.
      gate.close();
      await third;
      for (const x of [a, b, c]) {
        expect(board.item(x.id)?.state).toBe('live');
        expect(board.item(x.id)?.review?.landingPosition).toBeUndefined();
      }
      expect(git(main, 'log', '-3', '--format=%s').split('\n')).toEqual(['Third', 'Second', 'First']);
    } finally { gate.close(); await Promise.allSettled(approvals); }
  });

  test('stopping a queued card withdraws it before git runs and moves the next up', async () => {
    const a = await card({ 'a.ts': 'a' }); await a.handOver();
    const b = await card({ 'b.ts': 'b' }, 'Withdrawn'); await b.handOver();
    const c = await card({ 'c.ts': 'c' }); await c.handOver();
    const gate = await heldMerge(main);
    const first = workers.approve(a.id);
    const approvals = [first];
    try {
      await gate.entered();
      const second = workers.approve(b.id); approvals.push(second);
      await until(() => board.item(b.id)?.review?.landingPosition === 1);
      const third = workers.approve(c.id); approvals.push(third);
      await until(() => board.item(c.id)?.review?.landingPosition === 2);
      await workers.stop(b.id);
      await second;
      expect(board.item(b.id)?.review?.landingPosition).toBeUndefined();
      expect(board.item(c.id)?.review?.landingPosition).toBe(1);
      gate.close();
      await Promise.all([first, third]);
      expect(git(main, 'log', '--format=%s')).not.toContain('Withdrawn');
    } finally { gate.close(); await Promise.allSettled(approvals); }
  });
});

test('only overlapping workers hear a successful landing, on their next turn', async () => {
  const a = await card({ 'shared.ts': 'landed\n', 'docs/plan/guide.md': 'new docs' }, 'Make checkout faster');
  await a.handOver();
  const busy = await card({ 'shared.ts': 'busy\n' });
  const waiting = await card({ 'shared.ts': 'waiting\n' }); await waiting.handOver();
  const other = await card({ 'other.ts': 'independent' });
  const docs = await card({ 'docs/plan/guide.md': 'only docs' });
  const inboxes = [busy, waiting, other, docs].map((c) => c.session.inbox.length);
  await workers.approve(a.id);
  for (const [n, c] of [busy, waiting, other, docs].entries()) expect(c.session.inbox.length).toBe(inboxes[n]!);
  expect(board.events(busy.id).at(-1)?.text).toContain('shared.ts');
  expect(cardTalk(board.item(busy.id)!, board.events(busy.id)).shown.some((turn) => turn.e.text.includes('shared.ts'))).toBe(true);
  expect(board.events(waiting.id).at(-1)?.text).toContain('Make checkout faster');
  // Tool results and an idle event do not consume the notice or start a new turn.
  expect(await busy.session.call('report', { status: 'Still working' })).not.toContain('Landed commits');
  busy.session.emit({ type: 'idle' });
  expect(busy.session.inbox.length).toBe(inboxes[0]!);
  other.session.emit({ type: 'idle' });
  docs.session.emit({ type: 'idle' });
  for (const c of [busy, waiting, other, docs]) workers.message(c.id, 'Please continue.');
  for (const c of [busy, waiting]) {
    expect(c.session.inbox.at(-1)).toContain('Make checkout faster');
    expect(c.session.inbox.at(-1)).toContain('- shared.ts');
    expect(c.session.inbox.at(-1)).toContain('rebase now');
    expect(c.session.inbox.at(-1)).not.toContain('- docs/plan/guide.md');
  }
  for (const c of [other, docs]) expect(c.session.inbox.at(-1)).not.toContain('Landed commits');
});


test('a failed landing clears its place and emits no overlap notice', async () => {
  const a = await card({ 'shared.ts': 'first' }, 'Lands first'); await a.handOver();
  const b = await card({ 'shared.ts': 'conflicting' }, 'Cannot land'); await b.handOver();
  const c = await card({ 'c.ts': 'independent' }); await c.handOver();
  const gate = await heldMerge(main);
  const first = workers.approve(a.id);
  const approvals = [first];
  try {
    await gate.entered();
    const second = workers.approve(b.id); approvals.push(second);
    await until(() => board.item(b.id)?.review?.landingPosition === 1);
    const third = workers.approve(c.id); approvals.push(third);
    await until(() => board.item(c.id)?.review?.landingPosition === 2);
    gate.close();
    await Promise.all([first, second, third]);
    expect(board.item(b.id)?.state).toBe('working');
    expect(board.item(b.id)?.review?.landingPosition).toBeUndefined();
    expect(board.item(c.id)?.state).toBe('live');
    expect(board.events(a.id).some((e) => e.text.includes('Cannot land'))).toBe(false);
  } finally { gate.close(); await Promise.allSettled(approvals); }
});

test('a forge merge notifies overlapping workers using the merged commit', async () => {
  const a = await card({ 'shared.ts': 'merged' }, 'Merged change'); await a.handOver();
  const b = await card({ 'shared.ts': 'in progress' });
  const commit = git(a.cwd, 'rev-parse', 'HEAD');
  workers.merged(a.id, commit);
  await until(() => board.events(b.id).some((e) => e.text.includes('Merged change')));
  expect(board.row(b.id).unheard).toContain(commit.slice(0, 7));
});


test('a direct push notifies from the workstation even while the checkout stays behind', async () => {
  workers.shutdown();
  rmSync(dir, { recursive: true, force: true });
  setup({ ...generic, land: 'pr', direct: true, workstations: 'clones' }, true);
  const a = await card({ 'shared.ts': 'pushed' }, 'Push checkout directly'); await a.handOver();
  const b = await card({ 'shared.ts': 'in progress' });
  await workers.approve(a.id, { direct: true });
  expect(git(main, 'log', '-1', '--format=%s')).toBe('init');
  expect(board.row(b.id).unheard).toContain('Push checkout directly');
});


test('an overlap notice already being read survives replacing the workers at restart', async () => {
  const a = await card({ 'shared.ts': 'merged' }, 'Restart-safe merge'); await a.handOver();
  const b = await card({ 'shared.ts': 'in progress' });
  b.session.emit({ type: 'session', id: 'overlapping-session' });
  const changedFiles = spaces.changedFiles.bind(spaces);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let reading = false;
  spaces.changedFiles = async (id, ...args) => {
    if (id === b.id) { reading = true; await gate; }
    return changedFiles(id, ...args);
  };
  workers.merged(a.id, git(a.cwd, 'rev-parse', 'HEAD'));
  await until(() => reading);
  expect(workers.busyCards()).toContain(a.id);
  workers.shutdown();
  setWorkers(new Workers({ board, runtime, workstations: spaces, adapter: { ...generic, land: 'main', workstations: 'clones' } }));
  release();
  await until(() => !!board.row(b.id).unheard);
  workers.message(b.id, 'Please continue after the restart.');
  expect(runtime.last.inbox.at(-1)).toContain('Restart-safe merge');
});
