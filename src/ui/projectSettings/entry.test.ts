import { expect, test } from 'bun:test';
import type { ProjectConfig } from '../../core/types';
import { mergedEntry, withEntry } from './entry';

test('the edited entry goes over the entry as saved now: settings saved since stay, what the editor sets wins', () => {
  const begun: ProjectConfig = { name: 'Shop', icon: '🛒', repos: [{ path: '/a', settings: { land: 'main' } }, { path: '/b' }] };
  // typed since: a new name, no icon, a path, a repository added
  const { icon: _, ...rest } = begun;
  const draft: ProjectConfig = { ...rest, name: 'Store', oldNames: ['Shop'], repos: [{ path: '/a', settings: { land: 'main' } }, { path: '/b2' }, { path: '/c', clones: 2 }] };
  // saved meanwhile by the sheet's other sections: a repository setting, a project setting
  const fresh: ProjectConfig = { ...begun, agents: { worker: { model: 'opus' } }, repos: [{ path: '/a', settings: { land: 'pr' } }, { path: '/b', settings: { autoMerge: true } }] };
  expect(mergedEntry(draft, fresh)).toEqual({
    name: 'Store',
    oldNames: ['Shop'],
    agents: { worker: { model: 'opus' } },
    repos: [{ path: '/a', settings: { land: 'pr' } }, { path: '/b2' }, { path: '/c', clones: 2 }],
  });
  // a repository whose settings were dropped meanwhile has none
  expect(mergedEntry({ repos: [{ path: '/a', settings: { land: 'main' } }] }, { repos: [{ path: '/a' }] })).toEqual({ repos: [{ path: '/a' }] });
});

test('the entry takes its place in the list, or is added to it', () => {
  const list = [{ repos: [{ path: '/a' }] }, { repos: [{ path: '/b' }] }];
  expect(withEntry(list, 1, { repos: [{ path: '/b2' }] })).toEqual([{ repos: [{ path: '/a' }] }, { repos: [{ path: '/b2' }] }]);
  expect(withEntry(list, 2, { repos: [{ path: '/c' }] })).toEqual([...list, { repos: [{ path: '/c' }] }]);
});
