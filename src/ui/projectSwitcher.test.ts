import { expect, test } from 'bun:test';
import type { ProjectInfo } from '../core/types';
import type { InboxEntry } from '../core/inbox';
import { isSwitcherKey, switcherResults, waitingPerProject } from './projectSwitcher';
import { switcherKeys } from './strings';

const project = (id: string, name: string, repos: string[] = [id], more: Partial<ProjectInfo> = {}) =>
  ({ id, name, repos: repos.map((r) => ({ id: r, name: r, path: `/r/${r}`, branch: 'main' })), ...more }) as ProjectInfo;

const projects = [project('a', 'Seismic', ['obeya']), project('b', 'Paper Crane', ['reader']), project('c', 'Site'), project('d', 'Cardinal Bird', ['cbird2'], { oldNames: ['Birdhouse'] })];
const names = (query: string, current = 'x') => switcherResults(projects, query, current).map((p) => p.name);

test('without a query every project is listed, the open one last', () => {
  expect(names('', 'a')).toEqual(['Paper Crane', 'Site', 'Cardinal Bird', 'Seismic']);
});

test('a name that starts with the query comes before one that only contains it', () => {
  expect(names('si')).toEqual(['Site', 'Seismic']);
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
  expect(isSwitcherKey(key({ metaKey: true, shiftKey: true }), 'MacIntel')).toBe(false);
  expect(isSwitcherKey(key({ ctrlKey: true, altKey: true }), 'Win32')).toBe(false);
  expect(switcherKeys('MacIntel')).toBe('⌘P');
  expect(switcherKeys('Win32')).toBe('Ctrl+P');
});

test('the waiting counts start at zero for every project id, also one named like an object key', () => {
  const entry = (p: string) => ({ project: p, card: {} }) as InboxEntry;
  const per = waitingPerProject([entry('constructor'), entry('a'), entry('a')]);
  const id: string = 'constructor';
  expect(per[id]).toBe(1);
  expect(per.a).toBe(2);
  expect(waitingPerProject([]).toString).toBeUndefined();
});
