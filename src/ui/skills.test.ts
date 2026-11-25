import { expect, test } from 'bun:test';
import { matching, skillWord, slashAt } from './skills';

test('a slash at the start of the text or of a word opens the menu, with what follows it', () => {
  expect(slashAt('/', 1)).toEqual({ start: 0, query: '' });
  expect(slashAt('please /se', 10)).toEqual({ start: 7, query: 'se' });
  expect(slashAt('first line\n/seismic:de', 22)).toEqual({ start: 11, query: 'seismic:de' });
});

test('a path, a slash inside a word, or a word already ended opens none', () => {
  expect(slashAt('see /src/ui', 11)).toBeNull();
  expect(slashAt('and/or', 6)).toBeNull();
  expect(slashAt('/seed-data ', 11)).toBeNull();
  
  expect(slashAt('/seed-data 200', 3)).toEqual({ start: 0, query: 'se' });
});

test('names that start with the query come first, also after a plugin prefix, then those that contain it', () => {
  const skills = ['release-notes', 'seed-data', 'seismic:settings', 'code-review', 'security-review'].map((name) => ({ name, description: '' }));
  expect(matching(skills, 'se').map((s) => s.name)).toEqual(['seed-data', 'seismic:settings', 'security-review', 'release-notes']);
  expect(matching(skills, 'REVIEW').map((s) => s.name)).toEqual(['code-review', 'security-review']);
  expect(matching(skills, '')).toEqual(skills);
});

test('a skill picked is typed over the slash word, with a space unless one follows', () => {
  expect(skillWord('please /se', { start: 7, query: 'se' }, 10, 'seed-data')).toEqual({ from: 7, to: 10, word: '/seed-data ', skip: 0 });
  
  expect(skillWord('/se 200', { start: 0, query: 'se' }, 3, 'seed-data')).toEqual({ from: 0, to: 3, word: '/seed-data', skip: 1 });
});
