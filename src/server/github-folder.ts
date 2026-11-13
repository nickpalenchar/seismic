// A demo site in a folder of a GitHub repository the owner already has, served by its GitHub Pages:
// what the setup reads at GitHub (the repositories gh's login can push to, a repository's Pages and
// whether a push straight to its default branch goes through), and the git store a share goes
// through (`folderStore`).
//
// The store keeps a shallow, sparse clone of the folder alone (`--filter=blob:none`, a sparse
// checkout of the folder), so a large repository stays cheap. Before a change it fetches the branch
// the change goes on and reads the site's manifest from the folder: git holds the pages, so the
// clone takes the place of reading the live site. A change replaces the folder's contents with the
// site's directory, commits and pushes, never with force on the default branch; a push rejected
// because another machine pushed meanwhile is fetched again and made once more (site.ts). Nothing
// outside the folder is touched, and no `.nojekyll` goes in: it would switch off the owner's own
// Jekyll site; the pages have no front matter, so Jekyll copies them as they are.
//
// In pull-request mode the changes collect on one rolling branch (`DEMOS_BRANCH`) and its pull
// request against the default branch, opened with the first and listing the pages it holds. Once
// it is merged (or the branch no longer merges cleanly), the next change starts the branch afresh
// from the default branch, with this machine's pages, pushed with a lease on the branch as it was.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GitFolder, GithubRepo, GithubRepoList, GithubRepoView, PushCheck } from '../core/types';
import { type Exec, exec } from './site-hosts';

/** The deploy line's word for a site in a folder of an existing repository: `obeya:github-folder <owner>/<repository>`. */
export const GITHUB_FOLDER = 'obeya:github-folder';
/** The rolling branch of pull-request mode. */
export const DEMOS_BRANCH = 'seismic/demos';
/** Above this, the site's entry warns of the repository's size: GitHub warns at about 1 GB, and Pages serves at most about 1 GB. */
export const SIZE_WARNING = 800 * 1000 * 1000;

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * A folder in a repository the demos may go in: plain path parts, none starting with `.` or `_`
 * (Jekyll leaves those out of the site).
 */
export const isFolder = (folder: string) => /^[A-Za-z0-9-][A-Za-z0-9._-]{0,80}(\/[A-Za-z0-9-][A-Za-z0-9._-]{0,80}){0,5}$/.test(folder) && !folder.split('/').includes('..');

/** A folder as typed, as it is kept: without slashes at either end. */
export const tidyFolder = (folder: string) => folder.trim().replace(/^\/+|\/+$/g, '');

const lastLine = (r: { out: string; err: string }) =>
  (r.err.trim() || r.out.trim())
    .split('\n')
    .filter((l) => l.trim())
    .at(-1)
    ?.trim()
    .slice(0, 400) ?? 'no output';

/** gh's answer as JSON; throws with its last line where it failed (`status`: 404 where GitHub said Not Found). */
async function ghJson<T>(x: Exec, args: string[]): Promise<T> {
  const r = await x(['gh', ...args]);
  if (r.code !== 0) throw Object.assign(new Error(lastLine(r)), { notFound: /HTTP 404|Not Found/i.test(r.out + r.err) });
  return JSON.parse(r.out) as T;
}

/** The repositories gh's login can push to, the login's own first, then each organization's, by name. */
export async function listRepos(x: Exec = exec): Promise<GithubRepoList> {
  let login: string;
  try {
    login = (await ghJson<{ login: string }>(x, ['api', 'user'])).login;
  } catch (e) {
    throw new Error(`gh is not logged in to GitHub (gh auth login): ${e instanceof Error ? e.message : e}`);
  }
  const r = await x(['gh', 'api', '--paginate', 'user/repos?per_page=100&affiliation=owner,collaborator,organization_member', '--jq', '.[] | select(.permissions.push) | {repo: .full_name, owner: .owner.login, private: .private}']);
  if (r.code !== 0) throw new Error(`GitHub did not list the repositories: ${lastLine(r)}`);
  const repos = r.out
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const v = JSON.parse(l) as GithubRepo;
        return typeof v.repo === 'string' && REPO.test(v.repo) ? [{ repo: v.repo, owner: v.owner, private: !!v.private }] : [];
      } catch {
        return [];
      }
    });
  const rank = (o: string) => (o.toLowerCase() === login.toLowerCase() ? 0 : 1);
  repos.sort((a, b) => rank(a.owner) - rank(b.owner) || a.owner.localeCompare(b.owner) || a.repo.localeCompare(b.repo));
  return { login, repos };
}

/** The address GitHub gives a repository's Pages: the account's own site for `<owner>.github.io`, else under the repository's name. */
export function pagesAddress(repo: string): string {
  const [owner, name] = repo.split('/') as [string, string];
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}` : `https://${host}/${name}`;
}

/**
 * Where a folder's pages are served: under the address Pages has, relative to the folder Pages
 * serves from. Pages built by a workflow serve what the workflow makes of the repository: the folder
 * is taken as it lies in it. Outside what Pages serves (another branch, another folder), null and why.
 */
export function folderAddress(repo: string, branch: string, pages: GithubRepoView['pages'], folder: string): { address: string | null; outside?: string } {
  const base = (pages?.url ?? pagesAddress(repo)).replace(/\/+$/, '');
  if (!pages || pages.workflow) return { address: `${base}/${folder}` };
  if (pages.branch && pages.branch !== branch) return { address: null, outside: `GitHub Pages serves the branch ${pages.branch}, not ${branch}.` };
  const root = (pages.path ?? '/').replace(/^\/+|\/+$/g, '');
  if (root && folder !== root && !folder.startsWith(`${root}/`)) return { address: null, outside: `GitHub Pages serves only /${root} of ${branch}.` };
  const rel = root ? folder.slice(root.length).replace(/^\/+/, '') : folder;
  if (!rel) return { address: null, outside: `/${root} is the whole of what GitHub Pages serves: choose a folder inside it.` };
  return { address: `${base}/${rel}` };
}

/** Rules of a ruleset that keep a plain push from going straight to the branch. */
const BLOCKING_RULES = new Set(['pull_request', 'update', 'required_status_checks', 'required_signatures', 'required_deployments', 'merge_queue', 'code_scanning', 'workflows']);

/**
 * Whether gh's login can push straight to the branch: its rights on the repository, the rulesets on
 * the branch (a pull request required, say), and classic branch protection. Where a ruleset blocks,
 * the address of that ruleset's settings; else of the branch protection's. A protection the login
 * cannot read (only admins can) counts as blocking.
 */
export async function pushCheck(x: Exec, repo: string, branch: string, rights: { push: boolean; admin: boolean }): Promise<PushCheck> {
  const { admin } = rights;
  if (!rights.push) return { allowed: false, admin };
  const b = encodeURIComponent(branch);
  let rules: { type: string; ruleset_id?: number }[] = [];
  try {
    rules = await ghJson(x, ['api', `repos/${repo}/rules/branches/${b}`]);
  } catch {}
  const rule = Array.isArray(rules) ? rules.find((r) => BLOCKING_RULES.has(r.type)) : undefined;
  if (rule) return { allowed: false, admin, settings: `https://github.com/${repo}/settings/rules${rule.ruleset_id ? `/${rule.ruleset_id}` : ''}` };
  let protectedBranch = false;
  try {
    protectedBranch = !!(await ghJson<{ protected?: boolean }>(x, ['api', `repos/${repo}/branches/${b}`])).protected;
  } catch {}
  if (!protectedBranch) return { allowed: true, admin };
  const blocked = { allowed: false, admin, settings: `https://github.com/${repo}/settings/branches` };
  if (!admin) return blocked;
  try {
    const p = await ghJson<{ enforce_admins?: { enabled?: boolean }; lock_branch?: { enabled?: boolean }; required_pull_request_reviews?: unknown; required_status_checks?: { contexts?: string[]; checks?: unknown[] }; required_signatures?: { enabled?: boolean }; restrictions?: unknown }>(x, ['api', `repos/${repo}/branches/${b}/protection`]);
    if (p.lock_branch?.enabled) return blocked;
    // an admin passes classic protection unless it includes administrators
    const strict = !!p.required_pull_request_reviews || !!p.required_status_checks?.contexts?.length || !!p.required_status_checks?.checks?.length || !!p.required_signatures?.enabled || !!p.restrictions;
    return strict && p.enforce_admins?.enabled ? blocked : { allowed: true, admin };
  } catch {
    return blocked;
  }
}

/** An existing repository as the setup reads it for a folder: its Pages, the folder's address, the push check, its size. */
export async function repoView(repo: string, folder: string, x: Exec = exec): Promise<GithubRepoView> {
  if (!REPO.test(repo)) throw new Error(`expected <owner>/<repository>, got ${repo || 'nothing'}`);
  let r: { private: boolean; default_branch: string; size?: number; permissions?: { push?: boolean; admin?: boolean } };
  try {
    r = await ghJson(x, ['api', `repos/${repo}`]);
  } catch (e) {
    throw new Error(`GitHub did not show ${repo}: ${e instanceof Error ? e.message : e}`);
  }
  let pages: GithubRepoView['pages'] = null;
  try {
    const p = await ghJson<{ html_url?: string; build_type?: string; source?: { branch?: string; path?: string } }>(x, ['api', `repos/${repo}/pages`]);
    pages = { url: (p.html_url ?? pagesAddress(repo)).replace(/\/+$/, ''), ...(p.source?.branch ? { branch: p.source.branch } : {}), ...(p.source?.path ? { path: p.source.path } : {}), workflow: p.build_type === 'workflow' };
  } catch (e) {
    if (!(e as { notFound?: boolean }).notFound) throw new Error(`GitHub did not show the Pages of ${repo}: ${e instanceof Error ? e.message : e}`);
  }
  const branch = r.default_branch;
  const at = isFolder(folder) ? folderAddress(repo, branch, pages, folder) : { address: null };
  const push = await pushCheck(x, repo, branch, { push: !!r.permissions?.push, admin: !!r.permissions?.admin });
  return { repo, private: !!r.private, branch, size: (r.size ?? 0) * 1024, pages, ...at, push };
}

/** Turns on GitHub Pages for a repository, from the branch's root. */
export async function enablePages(repo: string, branch: string, x: Exec = exec): Promise<void> {
  const r = await x(['gh', 'api', '-X', 'POST', `repos/${repo}/pages`, '-f', `source[branch]=${branch}`, '-f', 'source[path]=/']);
  if (r.code !== 0) throw new Error(lastLine(r));
}

/** How a store reaches its repository: `remote` stands in for GitHub in tests. */
export interface FolderStoreOptions {
  repo: string;
  git: GitFolder;
  /** The clone's directory. */
  clone: string;
  /** The manifest's place in the folder. */
  manifestAt: string;
  /** Where a page lies on the site, for the pull request's list. */
  pageUrl: (place: string) => string;
  /** An unlisted site: the repository must be private. */
  unlisted?: boolean;
  x?: Exec;
  remote?: string;
}

/** A change pushed: what git said, and in pull-request mode the pull request it is in. */
export type Pushed = { said: string; pr?: string } | 'rejected';

export interface FolderStore {
  /** Fetches the branch the next change goes on; the manifest the folder holds there, null where it holds none. */
  sync(): Promise<string | null>;
  /** Where the folder's files lie in the clone, as `sync` checked them out. */
  root: string;
  /** Replaces the folder's contents with the site's directory, commits and pushes; 'rejected' where the branch moved meanwhile. */
  push(dir: string, message: string): Promise<Pushed>;
  /** A pull request's state: open, merged or closed; null where GitHub did not say. */
  prState(url: string): Promise<'open' | 'merged' | 'closed' | null>;
  /** The rolling pull request open now, if any. */
  openPr(): Promise<string | null>;
}

/** What a share leaves out of a folder: Cloudflare's headers, and files that would change the owner's whole site. */
const LEFT_OUT = new Set(['_headers', '.nojekyll', 'CNAME']);

export function folderStore(o: FolderStoreOptions): FolderStore {
  const x = o.x ?? exec;
  const { branch, folder } = o.git;
  const remote = o.remote ?? `https://github.com/${o.repo}.git`;
  const none = join(o.clone, '.git', 'none');
  const cfg = ['-c', 'user.name=Seismic', '-c', 'user.email=obeya@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${none}`, '-c', `core.excludesFile=${none}`, '-c', 'advice.detachedHead=false'];
  const root = join(o.clone, folder);
  /** The branch the last sync checked out, and how the next push goes. */
  let at: { pr: { url: string; number: number } | null; lease: string | null } = { pr: null, lease: null };
  let env: Record<string, string> = {};

  const auth = async () => {
    const token = await x(['gh', 'auth', 'token']);
    if (token.code !== 0 || !token.out.trim()) throw new Error(`gh is not logged in to GitHub (gh auth login): ${lastLine(token)}`);
    // gh's token goes into git's environment, never onto the command line
    env = {
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token.out.trim()}`).toString('base64')}`,
    };
  };
  const run = (args: string[]) => x(['git', '-C', o.clone, ...cfg, ...args], { env, timeout: 15 * 60_000 });
  const step = async (args: string[], what: string) => {
    const r = await run(args);
    if (r.code !== 0) throw new Error(`${what}: ${lastLine(r)}`);
    return r.out.trim();
  };
  const fetch = (ref: string) => run(['fetch', '-q', '--no-tags', '--filter=blob:none', '--depth=1', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`]);
  const prs = async (state: 'open' | 'all') => {
    const r = await x(['gh', 'pr', 'list', '--repo', o.repo, '--head', DEMOS_BRANCH, '--base', branch, '--state', state, '--json', 'url,number,mergeable,state', '--limit', '5']);
    if (r.code !== 0) throw new Error(`gh pr list: ${lastLine(r)}`);
    return JSON.parse(r.out || '[]') as { url: string; number: number; mergeable?: string; state?: string }[];
  };

  /** The pages the pull request holds: those whose revision differs from the default branch's. */
  const prBody = async () => {
    let theirs: { pages?: Record<string, { rev: number }> } = {};
    const shown = await run(['show', `refs/remotes/origin/${branch}:${folder}/${o.manifestAt}`]);
    if (shown.code === 0) {
      try {
        theirs = JSON.parse(shown.out);
      } catch {}
    }
    const mine = JSON.parse(readFileSync(join(root, o.manifestAt), 'utf8')) as { pages: Record<string, { rev: number; withdrawn?: true; meta?: { title?: string } }> };
    const lines = Object.entries(mine.pages)
      .filter(([place, e]) => theirs.pages?.[place]?.rev !== e.rev)
      .map(([place, e]) => (e.withdrawn ? `- withdrawn: \`${place}\`` : `- [${(e.meta?.title ?? place).replace(/[[\]]/g, '')}](${o.pageUrl(place)})`));
    return `Demo pages for \`${folder}\`, published by Seismic: they go online once this is merged. Later demos add to this pull request until then.\n\n${lines.join('\n') || '- none'}\n`;
  };

  return {
    root,
    async sync() {
      await auth();
      if (o.unlisted) {
        const v = await x(['gh', 'repo', 'view', o.repo, '--json', 'visibility', '--jq', '.visibility']);
        const visibility = v.out.trim().toUpperCase();
        if (v.code !== 0 || visibility !== 'PRIVATE') throw new Error(`${o.repo} is ${v.code === 0 ? visibility.toLowerCase() || 'of unknown visibility' : `not readable (${lastLine(v)})`}, not private: Seismic puts no unlisted page there`);
      }
      if (!existsSync(join(o.clone, '.git'))) {
        rmSync(o.clone, { recursive: true, force: true });
        mkdirSync(dirname(o.clone), { recursive: true });
        const c = await x(['git', ...cfg, 'clone', '-q', '--filter=blob:none', '--no-checkout', '--depth=1', '--no-tags', '--branch', branch, remote, o.clone], { env, timeout: 15 * 60_000 });
        if (c.code !== 0) {
          rmSync(o.clone, { recursive: true, force: true });
          throw new Error(`git clone of ${o.repo}: ${lastLine(c)}`);
        }
        // only the folder comes out of the repository
        await step(['config', 'core.sparseCheckout', 'true'], 'git config');
        mkdirSync(join(o.clone, '.git', 'info'), { recursive: true });
        writeFileSync(join(o.clone, '.git', 'info', 'sparse-checkout'), `/${folder}/\n`);
      }
      await step(['remote', 'set-url', 'origin', remote], 'git remote');
      const f = await fetch(branch);
      if (f.code !== 0) throw new Error(`git fetch of ${branch}: ${lastLine(f)}`);
      let base = `refs/remotes/origin/${branch}`;
      at = { pr: null, lease: null };
      if (o.git.mode === 'pr') {
        const open = (await prs('open'))[0] ?? null;
        const has = (await fetch(DEMOS_BRANCH)).code === 0;
        const tip = has ? await step(['rev-parse', `refs/remotes/origin/${DEMOS_BRANCH}`], 'git rev-parse') : '';
        // on the open pull request's branch while it merges; else afresh from the default branch, with this machine's pages
        if (open && has && open.mergeable !== 'CONFLICTING') {
          base = `refs/remotes/origin/${DEMOS_BRANCH}`;
          at = { pr: open, lease: null };
        } else at = { pr: open, lease: tip };
      }
      await step(['checkout', '-q', '--force', '-B', 'obeya-work', base], 'git checkout');
      await step(['clean', '-qfdx'], 'git clean');
      const file = join(root, o.manifestAt);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    async push(dir, message) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      cpSync(dir, root, { recursive: true, filter: (src) => !LEFT_OUT.has(src.slice(dir.length + 1)) });
      await step(['add', '-A', '--', folder], 'git add');
      const same = (await run(['diff', '--cached', '--quiet'])).code === 0;
      const pr = o.git.mode === 'pr';
      if (same && !(pr && at.lease !== null && !at.pr)) return { said: `Nothing changed in ${o.repo}/${folder}.`, ...(at.pr ? { pr: at.pr.url } : {}) };
      if (!same) await step(['commit', '-q', '--no-verify', '-m', message], 'git commit');
      const to = pr ? DEMOS_BRANCH : branch;
      const lease = pr && at.lease !== null ? [`--force-with-lease=refs/heads/${DEMOS_BRANCH}:${at.lease}`] : [];
      const r = await run(['push', '-q', '--no-verify', ...lease, 'origin', `HEAD:refs/heads/${to}`]);
      if (r.code !== 0) {
        const said = r.out + r.err;
        // a rule or protection refused it: not a race to retry
        if (/GH006|GH013|protected branch|rule violation|declined/i.test(said)) throw new Error(`GitHub refused the push to ${to}: ${lastLine(r)}`);
        if (/rejected|non-fast-forward|fetch first|stale info/i.test(said)) return 'rejected';
        throw new Error(`git push to ${to}: ${lastLine(r)}`);
      }
      const pushed = `Pushed a commit to ${o.repo} (${to}, ${folder}).`;
      if (!pr) return { said: pushed };
      const body = await prBody();
      if (at.pr) {
        const e = await x(['gh', 'pr', 'edit', String(at.pr.number), '--repo', o.repo, '--body', body]);
        return { said: e.code === 0 ? pushed : `${pushed}\nThe pull request's list did not change: ${lastLine(e)}`, pr: at.pr.url };
      }
      const c = await x(['gh', 'pr', 'create', '--repo', o.repo, '--base', branch, '--head', DEMOS_BRANCH, '--title', 'Demos', '--body', body]);
      const url = /https:\/\/\S+\/pull\/\d+/.exec(c.out + c.err)?.[0];
      if (c.code !== 0 || !url) throw new Error(`gh pr create: ${lastLine(c)}`);
      return { said: `${pushed}\nOpened ${url}.`, pr: url };
    },
    async prState(url) {
      const r = await x(['gh', 'pr', 'view', url, '--json', 'state', '--jq', '.state']);
      const s = r.out.trim().toUpperCase();
      return r.code !== 0 ? null : s === 'MERGED' ? 'merged' : s === 'OPEN' ? 'open' : s === 'CLOSED' ? 'closed' : null;
    },
    async openPr() {
      try {
        return (await prs('open'))[0]?.url ?? null;
      } catch {
        return null;
      }
    },
  };
}
