import { expect, spyOn, test } from 'bun:test';
import { bundledThemes } from 'shiki/themes';
import { parseHunks } from './diffLines';
import { loadTokenizer, paintHunks } from './highlight';

const darkLoad = spyOn(bundledThemes, 'github-dark');
const lightLoad = spyOn(bundledThemes, 'github-light');

test('omitted gaps reset both source grammars; contiguous hunks preserve state', async () => {
  const tokenize = (await loadTokenizer('typescript', 'light'))!;
  expect(lightLoad).toHaveBeenCalledTimes(1);
  expect(darkLoad).not.toHaveBeenCalled();
  const patch = (start: number) => parseHunks([
    '@@ -1,2 +1,2 @@', '-/* old comment', '+/* new comment', ' still inside',
    `@@ -${start},1 +${start},1 @@`, '-export const before = 1;', '+export const after = 2;',
  ]);
  const isolated = paintHunks(patch(10), tokenize);
  expect(isolated.old.get(10)).toEqual(tokenize('export const before = 1;')[0]);
  expect(isolated.new.get(10)).toEqual(tokenize('export const after = 2;')[0]);
  const adjacent = paintHunks(patch(3), tokenize);
  expect(adjacent.old.get(3)).toEqual(tokenize('/* old comment\nstill inside\nexport const before = 1;')[2]);
  expect(adjacent.new.get(3)).toEqual(tokenize('/* new comment\nstill inside\nexport const after = 2;')[2]);
});

test('tokenizers keep the requested theme after another theme loads', async () => {
  const light = (await loadTokenizer('typescript', 'light'))!;
  const before = light('export const value = 1;');
  const dark = (await loadTokenizer('typescript', 'dark'))!;
  expect(dark('export const value = 1;')).not.toEqual(before);
  expect(darkLoad).toHaveBeenCalledTimes(1);
  expect(lightLoad).toHaveBeenCalledTimes(1);
  expect(light('export const value = 1;')).toEqual(before);
  expect(await loadTokenizer(null, 'dark')).toBeNull();
});
