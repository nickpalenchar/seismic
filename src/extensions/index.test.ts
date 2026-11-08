import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { checkShared } from '../adapters/schema';
import { SEAM_FILES } from './index';

test('repository settings retain their existing validation', () => {
  expect(checkShared({ checks: ['bun test'], typo: true })).toEqual({
    settings: { checks: ['bun test'] },
    problems: ['typo: no such field'],
  });
  expect(SEAM_FILES).toContain('src/server/server.ts');
});

test('a repository setting under its old name counts as the new one, which wins where both are set', () => {
  expect(checkShared({ workspaces: 'clones' })).toEqual({ settings: { workstations: 'clones' }, problems: [] });
  expect(checkShared({ workspaces: 'clones', workstations: 'worktrees' })).toEqual({ settings: { workstations: 'worktrees' }, problems: [] });
});


test('the seam list names every core file that imports the registry', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : [path];
  });
  const callers = files('src').map((path) => path.replaceAll('\\', '/')).filter((path) => !path.startsWith('src/extensions/') && /\.(ts|tsx)$/.test(path) && /from ['"]\.\.\/extensions\/(client|server)['"]/.test(readFileSync(path, 'utf8')));
  expect<string[]>([...SEAM_FILES].sort()).toEqual(['src/extensions/index.ts', 'src/extensions/client.ts', 'src/extensions/server.ts', 'src/ui/config.tsx', 'src/server/project.ts', 'src/server/runtime.ts', ...callers].sort());
});
