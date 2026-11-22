import { expect, test } from 'bun:test';
import type { ProjectInfo } from '../core/types';
import { isSwitcherKey, switcherResults } from './projectSwitcher';
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

test('⌘P and Ctrl+P open the switcher; with Shift or Alt they do not', () => {
  const key = (more: Partial<KeyboardEvent>) => ({ key: 'p', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...more });
  expect(isSwitcherKey(key({ metaKey: true }))).toBe(true);
  expect(isSwitcherKey(key({ ctrlKey: true, key: 'P' }))).toBe(true);
  expect(isSwitcherKey(key({}))).toBe(false);
  expect(isSwitcherKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
  expect(switcherKeys('MacIntel')).toBe('⌘P');
  expect(switcherKeys('Win32')).toBe('Ctrl+P');
});
