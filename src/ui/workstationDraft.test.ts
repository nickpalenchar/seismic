import { expect, test } from 'bun:test';
import { parkClones, restoreClones } from './workstationDraft';

test('parked clones follow the repository draft across edits and remounts without being saved', () => {
  const repo = { path: '/repo', clones: 3, workstations: ['/clone'], hosts: [{ name: 'Build', ssh: 'build', root: '/work', clones: 2 }] };
  const parked = parkClones(repo);
  expect(JSON.parse(JSON.stringify(parked))).toEqual({ path: '/repo' });
  const edited = { ...parked, slots: 4 };
  expect(restoreClones(edited)).toEqual({ ...repo, slots: 4 });
  expect(restoreClones(parkClones({ ...restoreClones(edited), clones: 5 }))).toEqual({ ...repo, clones: 5, slots: 4 });
  expect(restoreClones({ path: '/other' })).toEqual({ path: '/other' });
});
