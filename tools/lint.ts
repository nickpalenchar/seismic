import { existsSync } from 'node:fs';

function gitPaths(args: string[]): string[] {
  const result = Bun.spawnSync(['git', ...args], { stderr: 'inherit' });
  if (!result.success) process.exit(result.exitCode || 1);
  return result.stdout.toString().split('\0').filter(Boolean);
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const staged = args.includes('--staged');
const oxlintArgs = args.filter((arg) => arg !== '--all' && arg !== '--staged');
const paths = all ? ['.'] : [...new Set([
  ...gitPaths(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT', '--']),
  ...(staged ? [] : [
    ...gitPaths(['diff', '--name-only', '-z', '--diff-filter=ACMRT', '--']),
    ...gitPaths(['ls-files', '--others', '--exclude-standard', '-z']),
  ]),
])].filter((path) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && existsSync(path))
  .map((path) => `./${path}`);

if (paths.length === 0) {
  console.log('No changed JavaScript or TypeScript files to lint.');
  process.exit(0);
}

const result = Bun.spawnSync([
  'oxlint', '--deny-warnings', '--no-error-on-unmatched-pattern', ...oxlintArgs, ...paths,
], { stdio: ['inherit', 'inherit', 'inherit'] });
process.exit(result.success ? 0 : result.exitCode || 1);
