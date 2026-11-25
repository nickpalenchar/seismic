














import { spawnSync } from 'node:child_process';
import path from 'node:path';


export const CHECKOUT = path.join(import.meta.dirname, '..');

/** `owner/name` of a GitHub remote URL (https, ssh or scp-like), or null for any other. */
export function githubRepo(url: string): string | null {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** gh's environment for the GitHub repository of the checkout at `cwd`; throws when its origin is none. */
export function ghEnv(cwd = CHECKOUT): { repo: string; env: NodeJS.ProcessEnv } {
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  const repo = origin.status === 0 ? githubRepo(origin.stdout) : null;
  if (!repo) throw new Error(`the origin of ${cwd} is no GitHub repository, which gh would run on: ${(origin.status === 0 ? origin.stdout : origin.stderr).trim()}`);
  const owner = repo.split('/')[0]!;
  
  const { GH_TOKEN: _, GITHUB_TOKEN: __, ...plain } = process.env;
  const r = spawnSync('gh', ['auth', 'token', '--user', owner], { encoding: 'utf8', env: plain });
  const token = r.status === 0 ? r.stdout.trim() : '';
  return { repo, env: token ? { ...plain, GH_TOKEN: token, GH_REPO: repo } : { ...process.env, GH_REPO: repo } };
}

if (import.meta.main) {
  let env: NodeJS.ProcessEnv;
  try {
    env = ghEnv().env;
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const r = spawnSync('gh', process.argv.slice(2), { stdio: 'inherit', env });
  if (r.error) console.error(`gh: ${r.error.message}`);
  process.exit(r.status ?? 1);
}
