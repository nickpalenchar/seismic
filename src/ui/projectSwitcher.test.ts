import { expect, test } from 'bun:test';
import type { ProjectInfo } from '../core/types';
import type { InboxEntry } from '../core/inbox';
import type { Item, Waiting } from '../core/types';
import { isSwitcherKey, readProjects, switcherResults, waitingPerProject } from './projectSwitcher';
import { switcherCombo, switcherKeys, t } from './strings';

const project = (id: string, name: string, repos: string[] = [id], more: Partial<ProjectInfo> = {}) =>
  ({ id, name, repos: repos.map((r) => ({ id: r, name: r, path: `/r/${r}`, branch: 'main' })), ...more }) as ProjectInfo;

const projects = [project('a', 'Seismic', ['obeya']), project('b', 'Paper Crane', ['reader']), project('c', 'Site'), project('d', 'Cardinal Bird', ['cbird2'], { oldNames: ['Birdhouse'] })];
const names = (query: string, current = 'x') => switcherResults(projects, query, current).map((p) => p.name);

test('without a query every project is listed, the open one last', () => {
  expect(names('', 'a')).toEqual(['Paper Crane', 'Site', 'Cardinal Bird', 'Seismic']);
});

test('a name that starts with the query comes first, then a word of it, the name containing it, a repository, the letters in order', () => {
  const ladder = [project('e', 'Cobra Art'), project('f', 'Zed', ['cranberry']), project('g', 'Scrap'), project('h', 'Paper Crane'), project('i', 'Crane Works')];
  
  expect(switcherResults(ladder, 'cra', 'x').map((p) => p.name)).toEqual(['Crane Works', 'Paper Crane', 'Scrap', 'Zed', 'Cobra Art']);
});

test('a word of the name, a repository, an old name and letters in order all match', () => {
  expect(names('crane')).toEqual(['Paper Crane']);
  expect(names('reader')).toEqual(['Paper Crane']);
  expect(names('birdh')).toEqual(['Cardinal Bird']);
  expect(names('obeya')).toEqual(['Seismic']);
  expect(names('smc')).toEqual(['Seismic']);
  expect(names('zzz')).toEqual([]);
});

test('⌘P opens the switcher on a Mac and Ctrl+P elsewhere, as the hint says; with Shift or Alt neither does', () => {
  const key = (more: Partial<KeyboardEvent>) => ({ key: 'p', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...more });
  expect(isSwitcherKey(key({ metaKey: true }), 'MacIntel')).toBe(true);
  expect(isSwitcherKey(key({ metaKey: true }), 'iPad')).toBe(true);
  expect(isSwitcherKey(key({ ctrlKey: true }), 'MacIntel')).toBe(false);
  expect(isSwitcherKey(key({ ctrlKey: true, key: 'P' }), 'Win32')).toBe(true);
  expect(isSwitcherKey(key({ ctrlKey: true }), 'Linux x86_64')).toBe(true);
  expect(isSwitcherKey(key({ metaKey: true }), 'Win32')).toBe(false);
  expect(isSwitcherKey(key({}), 'MacIntel')).toBe(false);
  for (const [platform, more] of [['MacIntel', { metaKey: true }], ['Win32', { ctrlKey: true }]] as const) {
    expect(isSwitcherKey(key({ ...more, shiftKey: true }), platform)).toBe(false);
    expect(isSwitcherKey(key({ ...more, altKey: true }), platform)).toBe(false);
  }
  expect(switcherKeys('MacIntel')).toBe('⌘P');
  expect(switcherKeys('Win32')).toBe('Ctrl+P');
});

test('the legend shows the key this system takes, not both', () => {
  expect(switcherCombo('MacIntel')).toEqual(['⌘', 'P']);
  expect(switcherCombo('Linux x86_64')).toEqual(['Ctrl', 'P']);
  const row = t.help.sections.flatMap((s) => s.rows).find((r) => r.text === 'Switch to another project');
  expect(row?.keys).toEqual([switcherCombo()]);
});

test('the waiting counts start at zero for every project id, also one named like an object key', () => {
  const entry = (p: string) => ({ project: p, card: {} }) as InboxEntry;
  const per = waitingPerProject([entry('constructor'), entry('a'), entry('a')]);
  const id: string = 'constructor';
  expect(per[id]).toBe(1);
  expect(per.a).toBe(2);
  expect(waitingPerProject([]).toString).toBeUndefined();
});

/** What waits on a project: one card waiting for the owner's look at its demo. */
const oneWaiting = (id: string): Waiting => ({
  items: [{ id, kind: 'task', state: 'waiting', need: 'demo', title: id, body: '', x: 0, y: 0, source: 'manual', repo: 'r', canvasVisible: true } as Item],
  talk: [],
  needsYou: [{ id: 1, kind: 'demo', card: id, createdAt: 1, lastUpdated: 1 }],
});
/** A read that answers only when `settle` is called (or fails with `fail`). */
const held = <T,>() => {
  let settle!: (v: T) => void, fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((settle = res), (fail = rej)));
  return { promise, settle, fail };
};
const reading = () => {
  const list = held<ProjectInfo[]>(), waiting = held<Record<string, Waiting>>();
  const out: { projects?: ProjectInfo[]; waiting?: Record<string, number> } = {};
  const done = readProjects(
    { projects: () => list.promise, waiting: () => waiting.promise },
    { projects: (l) => (out.projects = l), waiting: (c) => (out.waiting = c) },
  );
  return { list, waiting, out, done };
};

test('the project list goes out as soon as it is read, while what waits is still being read', async () => {
  const r = reading();
  r.list.settle([projects[1]!]);
  await Bun.sleep(0);
  expect(r.out.projects?.map((p) => p.id)).toEqual(['b']);
  expect(r.out.waiting).toBeUndefined();
  
  r.waiting.settle({ a: oneWaiting('gone'), b: oneWaiting('here') });
  await r.done;
  expect({ ...r.out.waiting }).toEqual({ b: 1 });
});

test('a failed waiting read leaves the fresh list and gives no counts; a failed list read gives nothing', async () => {
  const r = reading();
  r.waiting.fail(new Error('slow server'));
  r.list.settle([projects[0]!]);
  await r.done;
  expect(r.out.projects?.map((p) => p.id)).toEqual(['a']);
  expect(r.out.waiting).toBeUndefined();

  const f = reading();
  f.list.fail(new Error('down'));
  f.waiting.settle({ a: oneWaiting('x') });
  await f.done;
  expect(f.out).toEqual({});
});
