// "Always allow" writes the rules into the repository: committed on its main branch, beside the
// checkout as "For everyone, into the repository" does; in a folder without git, into its files.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnOutput } from '../../server/spawn';
import { defaultBranch, GIT } from '../../server/workspaces';
import { ALLOW_FILE, CODEX_RULES_FILE, codexRulesAgain, withAllowed } from './rules';

async function git(repoPath: string, args: string[], o: { env?: Record<string, string>; stdin?: string } = {}) {
  const r = await spawnOutput([GIT, '-C', repoPath, ...args], {
    stdin: o.stdin !== undefined ? new Blob([o.stdin]) : 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...o.env },
  });
  return { code: r.code, out: r.stdout.trim(), err: r.stderr.trim() };
}

async function must(repoPath: string, args: string[], o?: Parameters<typeof git>[2]): Promise<string> {
  const r = await git(repoPath, args, o);
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.err || r.out || `exit code ${r.code}`}`);
  return r.out;
}

/** A commit with `files` (by path) on top of `parent`, made beside the checkout (its index and files stay as they are). */
async function commitBeside(repoPath: string, parent: string, files: Record<string, string>, message: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-allow-'));
  try {
    const env = { GIT_INDEX_FILE: join(dir, 'index') };
    await must(repoPath, ['read-tree', parent], { env });
    for (const [path, content] of Object.entries(files)) {
      const blob = await must(repoPath, ['hash-object', '-w', '--stdin'], { stdin: content });
      await must(repoPath, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
    }
    const tree = await must(repoPath, ['write-tree'], { env });
    const commit = await git(repoPath, ['commit-tree', tree, '-p', parent, '-m', message]);
    if (commit.code !== 0) {
      if (/user\.email|user\.name|identity/i.test(commit.err)) throw new Error('git has no name and e-mail for commits (user.name, user.email)');
      throw new Error(`git commit-tree: ${commit.err}`);
    }
    return commit.out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Commits `rules` into the allow list of the repository's `.claude/settings.json` on its main
 * branch (the local one, where work lands), with `.codex/rules/obeya.rules` made again where the
 * repository has it made from the list: beside the checkout, which, where it is on that branch,
 * then has the files as committed. Refused where the checkout has changes of its own in them. None
 * committed where every rule is in the list already.
 */
export async function commitAllowed(repoPath: string, rules: string[]): Promise<{ committed: string; branch: string } | null> {
  const branch = defaultBranch(repoPath);
  const parent = (await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`])).out;
  if (!parent) throw new Error(`the repository has no local branch ${branch}`);
  const blob = async (path: string) => {
    const r = await git(repoPath, ['cat-file', 'blob', `${parent}:${path}`]);
    return r.code === 0 ? `${r.out}\n` : undefined;
  };
  const text = withAllowed(await blob(ALLOW_FILE), rules);
  if (text === null) return null;
  const files: Record<string, string> = { [ALLOW_FILE]: text };
  const codex = codexRulesAgain(await blob(CODEX_RULES_FILE), text);
  if (codex !== null) files[CODEX_RULES_FILE] = codex;
  const onIt = (await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).out === branch;
  if (onIt && (await git(repoPath, ['status', '--porcelain', '--', ...Object.keys(files)])).out)
    throw new Error(`${Object.keys(files).join(', ')} has changes of its own in ${repoPath}; commit or discard them first`);
  const commit = await commitBeside(repoPath, parent, files, `Allow for agents: ${rules.join(', ')}`);
  await must(repoPath, ['update-ref', '-m', 'obeya: always allow', `refs/heads/${branch}`, commit, parent]);
  if (onIt) await must(repoPath, ['checkout', commit, '--', ...Object.keys(files)]);
  return { committed: commit, branch };
}

/** `rules` into the allow list of a folder without git, in its files; false where every rule is in it already. */
export function writeAllowed(path: string, rules: string[]): boolean {
  const text = (rel: string) => (existsSync(join(path, rel)) ? readFileSync(join(path, rel), 'utf8') : undefined);
  const settings = withAllowed(text(ALLOW_FILE), rules);
  if (settings === null) return false;
  const codex = codexRulesAgain(text(CODEX_RULES_FILE), settings);
  mkdirSync(dirname(join(path, ALLOW_FILE)), { recursive: true });
  writeFileSync(join(path, ALLOW_FILE), settings);
  if (codex !== null) writeFileSync(join(path, CODEX_RULES_FILE), codex);
  return true;
}
