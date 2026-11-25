import { expect, test } from 'bun:test';
import type { ProjectConfig } from '../../core/types';
import { entryDraft, mergedEntry, withEntry } from './entry';

test('the edited entry goes over the entry as saved now: settings saved since stay, what the editor sets wins', () => {
  const begun: ProjectConfig = { name: 'Shop', icon: '🛒', repos: [{ path: '/a', settings: { land: 'main' } }, { path: '/b' }] };
  
  const { icon: _, ...rest } = begun;
  const draft = { ...rest, name: 'Store', oldNames: ['Shop'], repos: [
    { path: '/a', originalPath: '/a', settings: { land: 'main' as const } },
    { path: '/b2', originalPath: '/b' },
    { path: '/c', originalPath: null, clones: 2 },
  ] };
  
  const fresh: ProjectConfig = { ...begun, agents: { worker: { model: 'opus' } }, repos: [{ path: '/a', settings: { land: 'pr' } }, { path: '/b', settings: { autoMerge: true } }] };
  expect(mergedEntry(draft, fresh)).toEqual({
    name: 'Store',
    oldNames: ['Shop'],
    agents: { worker: { model: 'opus' } },
    repos: [{ path: '/a', settings: { land: 'pr' } }, { path: '/b2', settings: { autoMerge: true } }, { path: '/c', clones: 2 }],
  });
  
  expect(mergedEntry(entryDraft({ repos: [{ path: '/a', settings: { land: 'main' } }] }), { repos: [{ path: '/a' }] })).toEqual({ repos: [{ path: '/a' }] });
});

test('the entry takes its place in the list, or is added to it', () => {
  const list = [{ repos: [{ path: '/a' }] }, { repos: [{ path: '/b' }] }];
  expect(withEntry(list, 1, { repos: [{ path: '/b2' }] })).toEqual([{ repos: [{ path: '/a' }] }, { repos: [{ path: '/b2' }] }]);
  expect(withEntry(list, 2, { repos: [{ path: '/c' }] })).toEqual([...list, { repos: [{ path: '/c' }] }]);
});

test('an entry save keeps new workstation values and removals on repositories it still lists', () => {
  const draft: ProjectConfig = {
    name: 'Shop',
    repos: [
      { path: '/a', clones: 1, slots: 1, workstations: ['/a-old'], settings: { workstations: 'clones' } },
      { path: '/b', clones: 2, hosts: [{ name: 'old', ssh: 'old', root: '/b', clones: 2 }] },
    ],
  };
  const fresh: ProjectConfig = {
    repos: [
      { path: '/a', clones: 4, slots: 0, workstations: ['/a-new'], hosts: [{ name: 'new', ssh: 'new', root: '/a', clones: 3 }] },
      { path: '/b' },
    ],
  };
  expect(mergedEntry(entryDraft(draft), fresh)).toEqual({ ...fresh, name: 'Shop' });
  expect(mergedEntry(entryDraft({ repos: [{ path: ' /a ' }] }, fresh), fresh)).toEqual({ repos: [{ ...fresh.repos[0]!, path: ' /a ' }] });
  expect(mergedEntry(entryDraft({ repos: [{ path: '/a', git: false }] }), fresh)).toEqual({ repos: [{ path: '/a', git: false }] });
});

test('draft identities survive a reload, multiple path changes, removals, and newly added rows', () => {
  const original = { repos: [{ path: '/first' }, { path: '/second', clones: 1, settings: { direct: false } }] };
  const begun = entryDraft(original);
  const edited = { ...begun, repos: [{ ...begun.repos[1]!, path: '/first' }, { path: '/second', originalPath: null }] };
  const refreshed = { repos: [{ path: '/second', clones: 3, slots: 2, settings: { direct: true } }, { path: '/first', clones: 14 }] };
  const restored = entryDraft(JSON.parse(JSON.stringify(edited)), refreshed);
  expect(mergedEntry(restored, refreshed)).toEqual({ repos: [{ ...refreshed.repos[0]!, path: '/first' }, { path: '/second' }] });

  restored.repos[0] = { ...restored.repos[0]!, path: '/folder', git: false };
  expect(mergedEntry(restored, refreshed).repos[0]).toEqual({ path: '/folder', git: false, settings: { direct: true } });
  expect(mergedEntry(restored, { repos: [] }).repos[0]).toEqual({ path: '/folder', git: false });
});
