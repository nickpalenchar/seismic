import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import components from '../../../components.json';
import tsconfig from '../../../tsconfig.json';




const root = resolve(import.meta.dir, '../../..');
const paths = (tsconfig as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions.paths;
const at = (alias: string) => {
  const [prefix, [target]] = Object.entries(paths).find(([p]) => alias.startsWith(p.replace('*', '')))! as [string, string[]];
  return resolve(root, target!.replace('*', alias.slice(prefix.length - 1)));
};

test('the aliases the shadcn CLI writes resolve to directories and modules that exist', async () => {
  const { aliases, tailwind } = components;
  expect(existsSync(resolve(root, tailwind.css))).toBe(true);
  for (const dir of [aliases.components, aliases.ui, aliases.lib]) expect(existsSync(at(dir))).toBe(true);
  
  expect(at(aliases.hooks)).toStartWith(resolve(root, 'src/ui'));
  expect(existsSync(`${at(aliases.utils)}.ts`)).toBe(true);
  const utils = await import(aliases.utils);
  expect(utils.cn('px-2 text-xs', 'px-3')).toBe('text-xs px-3');
});
