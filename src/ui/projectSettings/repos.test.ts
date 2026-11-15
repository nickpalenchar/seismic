import { expect, test } from 'bun:test';
import { shape, withPlaceOf } from './repos';

test('what restarts a repository’s agents is where they work, not how the entry is typed or its other settings', () => {
  const saved = { path: '/r', settings: { checks: ['make'] } };
  expect(shape({ ...saved, settings: { checks: ['make', 'make lint'] } })).toBe(shape(saved));
  expect(shape({ ...saved, workstations: ['', '  '], clones: 0 })).toBe(shape(saved));
  expect(shape({ ...saved, settings: { workstations: 'clones' } })).not.toBe(shape(saved));
  expect(shape({ ...saved, clones: 2 })).not.toBe(shape(saved));
  expect(shape({ ...saved, slots: 0 })).not.toBe(shape(saved));
});

test('an edit saved without its change of where agents work keeps every other setting', () => {
  const saved = { path: '/r', clones: 2, settings: { workstations: 'clones' as const, setup: 'make' } };
  const edited = { path: '/r', settings: { workstations: 'worktrees' as const, setup: 'make deps', checks: ['make test'] } };
  expect(withPlaceOf(edited, saved)).toEqual({ path: '/r', clones: 2, settings: { setup: 'make deps', checks: ['make test'], workstations: 'clones' } });
  expect(withPlaceOf({ path: '/r', clones: 3, settings: { workstations: 'clones' } }, { path: '/r' })).toEqual({ path: '/r' });
});
