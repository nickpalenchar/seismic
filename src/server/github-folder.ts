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
// it is merged or closed (or the branch no longer merges cleanly), the next change starts the branch
// afresh from the default branch, with this machine's pages, pushed with a lease on the branch as it
// was; so does a change after commits landed on a closed one's branch. Only a branch no pull request
// ever had goes on as it is: a share whose pull request could not be opened, nor its push undone.

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
  const pages = await ghJson<{ full_name: string; owner: { login: string }; private: boolean; permissions?: { push?: boolean } }[][]>(x,
    ['api', '--paginate', '--slurp', 'user/repos?per_page=100&affiliation=owner,collaborator,organization_member']);
  const repos: GithubRepo[] = pages.flat().filter((r) => r.permissions?.push && REPO.test(r.full_name))
    .map((r) => ({ repo: r.full_name, owner: r.owner.login, private: !!r.private }));
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
  // every page of them: a blocking rule may come after the first
  const pages = await ghJson<{ type: string; ruleset_id?: number }[][]>(x, ['api', '--paginate', '--slurp', `repos/${repo}/rules/branches/${b}?per_page=100`]);
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('GitHub did not return branch rules.');
  const rule = pages.flat().find((r) => BLOCKING_RULES.has(r.type));
  if (rule) return { allowed: false, admin, settings: `https://github.com/${repo}/settings/rules${rule.ruleset_id ? `/${rule.ruleset_id}` : ''}` };
  const { protected: protectedBranch } = await ghJson<{ protected: boolean }>(x, ['api', `repos/${repo}/branches/${b}`]);
  if (typeof protectedBranch !== 'boolean') throw new Error('GitHub did not return branch protection status.');
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
  const pages = await readPages(x, repo);
  const branch = r.default_branch;
  const at = isFolder(folder) ? folderAddress(repo, branch, pages, folder) : { address: null };
  const push = await pushCheck(x, repo, branch, { push: !!r.permissions?.push, admin: !!r.permissions?.admin });
  return { repo, private: !!r.private, branch, size: (r.size ?? 0) * 1024, pages, ...at, push };
}

/** A repository's GitHub Pages as GitHub has them now; null where they are off. */
async function readPages(x: Exec, repo: string): Promise<GithubRepoView['pages']> {
  try {
    const p = await ghJson<{ html_url?: string; build_type?: string; source?: { branch?: string; path?: string } }>(x, ['api', `repos/${repo}/pages`]);
    return { url: (p.html_url ?? pagesAddress(repo)).replace(/\/+$/, ''), ...(p.source?.branch ? { branch: p.source.branch } : {}), ...(p.source?.path ? { path: p.source.path } : {}), workflow: p.build_type === 'workflow' };
  } catch (e) {
    if (!(e as { notFound?: boolean }).notFound) throw new Error(`GitHub did not show the Pages of ${repo}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * The branch a folder site's changes go on now: the repository's default branch as GitHub has it,
 * so a default branch changed after the setup is followed (the one the setup saw is only kept for
 * the list). Refused where its Pages no longer serve the folder from there, since pages published
 * there would not show.
 */
export async function liveBranch(x: Exec, repo: string, folder: string): Promise<string> {
  let r: { default_branch?: string };
  try {
    r = await ghJson(x, ['api', `repos/${repo}`]);
  } catch (e) {
    throw new Error(`GitHub did not show ${repo}: ${e instanceof Error ? e.message : e}`);
  }
  const branch = r.default_branch;
  if (!branch) throw new Error(`GitHub did not say which branch of ${repo} is its default.`);
  const at = folderAddress(repo, branch, await readPages(x, repo), folder);
  if (!at.address) throw new Error(`${folder} of ${repo} is not on its GitHub Pages any more: ${at.outside}`);
  return branch;
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
  const { folder } = o.git;
  /** The default branch as the last look at GitHub found it (`liveBranch`); the setup's until then. */
  let branch = o.git.branch;
  const remote = o.remote ?? `https://github.com/${o.repo}.git`;
  const none = join(o.clone, '.git', 'none');
  const cfg = ['-c', 'user.name=Seismic', '-c', 'user.email=obeya@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${none}`, '-c', `core.excludesFile=${none}`, '-c', 'advice.detachedHead=false'];
  const root = join(o.clone, folder);
  /** The branch the last sync checked out, and how the next push goes. */
  let at: { pr: { url: string; number: number; base: string } | null; lease: string | null } = { pr: null, lease: null };
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
  /**
   * The rolling pull requests, newest first: every one GitHub has, page by page, of this repository's
   * branch alone (a fork's branch of the same name is someone else's), whichever branch each is
   * against (`base`): one opened before the default branch changed is still the rolling one.
   */
  const prs = async (state: 'open' | 'all') => {
    const head = encodeURIComponent(`${o.repo.split('/')[0]}:${DEMOS_BRANCH}`);
    const r = await x(['gh', 'api', '--paginate', '--slurp', `repos/${o.repo}/pulls?state=${state}&head=${head}&per_page=100`]);
    if (r.code !== 0) throw new Error(`gh api pulls: ${lastLine(r)}`);
    const pages = JSON.parse(r.out || '[]') as { html_url: string; number: number; body?: string | null; head?: { sha?: string }; base?: { ref?: string } }[][];
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('GitHub did not return a list of pull requests.');
    return pages.flat().map((p) => ({ url: p.html_url, number: p.number, headRefOid: p.head?.sha ?? '', body: p.body ?? '', base: p.base?.ref ?? '' }));
  };
  /** Whether GitHub finds the pull request no longer merges into the default branch. */
  const conflicting = async (pr: { number: number }) => {
    const r = await x(['gh', 'pr', 'view', String(pr.number), '--repo', o.repo, '--json', 'mergeable', '--jq', '.mergeable']);
    return r.code === 0 && r.out.trim() === 'CONFLICTING';
  };

  /** How `to` stands to `from` at GitHub (ahead: built on it); null where they share no history. */
  const compare = async (from: string, to: string) => {
    const r = await x(['gh', 'api', `repos/${o.repo}/compare/${from}...${to}`, '--jq', '.status']);
    if (r.code !== 0 && /HTTP 404|Not Found/i.test(r.out + r.err)) return null;
    if (r.code !== 0) throw new Error(`GitHub did not compare ${DEMOS_BRANCH} with the pull requests it held: ${lastLine(r)}`);
    return r.out.trim();
  };

  /**
   * Whether the rolling branch's tip belongs to a pull request: it is one's head, lies in its history
   * (the branch reset), or is built on a head the default branch lacks (commits pushed after it was
   * closed). GitHub compares them, since the clone holds the tip alone. A tip none of them has is a
   * proposal whose pull request was never opened (a creation that failed and could not be undone),
   * though it is built on what an earlier merge put on the default branch.
   */
  const inPr = async (tip: string) => {
    // all of them: the head the branch holds may be an old one's, however many came since
    const heads = [...new Set((await prs('all')).flatMap((p) => (p.headRefOid ? [p.headRefOid] : [])))];
    if (heads.includes(tip)) return true;
    for (const head of heads) {
      const on = await compare(head, tip);
      if (on === 'behind') return true;
      if (on === 'ahead' && !['ahead', 'identical'].includes((await compare(head, branch)) ?? '')) return true;
    }
    return false;
  };

  /** The pages the pull request holds: those whose revision differs from the default branch's. */
  const prBody = async (ref?: string) => {
    let theirs: { pages?: Record<string, { rev: number }> } = {};
    const shown = await run(['show', `refs/remotes/origin/${branch}:${folder}/${o.manifestAt}`]);
    if (shown.code === 0) {
      try {
        theirs = JSON.parse(shown.out);
      } catch {}
    }
    const mine = JSON.parse(ref ? await step(['show', `${ref}:${folder}/${o.manifestAt}`], 'git show') : readFileSync(join(root, o.manifestAt), 'utf8')) as { pages: Record<string, { rev: number; withdrawn?: true; meta?: { title?: string } }> };
    const lines = Object.entries(mine.pages)
      .filter(([place, e]) => theirs.pages?.[place]?.rev !== e.rev)
      .map(([place, e]) => (e.withdrawn ? `- withdrawn: \`${place}\`` : `- [${(e.meta?.title ?? place).replace(/[[\]]/g, '')}](${o.pageUrl(place)})`));
    return `Demo pages for \`${folder}\`, published by Seismic: they go online once this is merged. Later demos add to this pull request until then.\n\n${lines.join('\n') || '- none'}\n`;
  };

  /** Brings the pull request's list up to date, and where it is against an earlier default branch, moves it to this one. */
  const updatePr = (pr: { number: number; base: string }, body: string) =>
    x(['gh', 'pr', 'edit', String(pr.number), '--repo', o.repo, ...(pr.base !== branch ? ['--base', branch] : []), '--body', body])
      .catch((e) => ({ code: 1, out: '', err: String(e) }));

  return {
    root,
    async sync() {
      await auth();
      branch = await liveBranch(x, o.repo, folder);
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
        // on the open pull request's branch while it merges into the default branch; else afresh from
        // that, with this machine's pages (one against an earlier default branch is moved over to it)
        if (open && has && open.base === branch && !(await conflicting(open))) {
          base = `refs/remotes/origin/${DEMOS_BRANCH}`;
          at = { pr: open, lease: null };
        } else {
          // a closed or merged proposal's branch, with commits on top or not, never carries into the next one
          if (!open && has && !(await inPr(tip))) base = `refs/remotes/origin/${DEMOS_BRANCH}`;
          at = { pr: open, lease: tip };
        }
      }
      await step(['checkout', '-q', '--force', '-B', 'obeya-work', base], 'git checkout');
      await step(['clean', '-qfdx'], 'git clean');
      // Reconcile the description with the remote proposal on every audit, without pushing.
      // GitHub's stale body is the durable pending state, so this also works after a restart.
      try {
        const proposal = (await prs('open'))[0];
        if (proposal && (await fetch(DEMOS_BRANCH)).code === 0) {
          const body = await prBody(`refs/remotes/origin/${DEMOS_BRANCH}`);
          // against an earlier default branch, it moves once a share rebuilt its branch on this one
          const moves = proposal.base !== branch && (await compare(branch, await step(['rev-parse', `refs/remotes/origin/${DEMOS_BRANCH}`], 'git rev-parse'))) === 'ahead';
          if (proposal.body !== body || moves) await updatePr(moves ? proposal : { ...proposal, base: branch }, body);
        }
      } catch {
        // Description maintenance must not turn a readable site into a failed publication.
        // Its mismatch is checked again on the next audit.
      }
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
      // Prepare metadata before publishing so a local read failure leaves no remote commit.
      const body = pr ? await prBody() : '';
      const tip = pr ? await step(['rev-parse', 'HEAD'], 'git rev-parse') : '';
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
      if (at.pr) {
        const e = await updatePr(at.pr, body);
        return { said: e.code === 0 ? pushed : `${pushed}\nThe pull request will be brought up to date on the next site check: ${lastLine(e)}`, pr: at.pr.url };
      }
      const c = await x(['gh', 'pr', 'create', '--repo', o.repo, '--base', branch, '--head', DEMOS_BRANCH, '--title', 'Demos', '--body', body]).catch((e) => ({ code: 1, out: '', err: String(e) }));
      const url = /https:\/\/\S+\/pull\/\d+/.exec(c.out + c.err)?.[0];
      if (c.code !== 0 || !url) {
        // A timed-out create may have succeeded at GitHub. Recover its URL first.
        const recovered = await prs('open').catch(() => null);
        if (!recovered) throw new Error(`gh pr create: ${lastLine(c)}. The commit remains on ${DEMOS_BRANCH} at ${tip}; GitHub could not confirm whether its pull request exists. Retry publishing to recover it.`);
        if (recovered[0]) return { said: pushed, pr: recovered[0].url };
        const restore = at.lease ?? '';
        const rollback = () => run(['push', '-q', '--no-verify', `--force-with-lease=refs/heads/${DEMOS_BRANCH}:${tip}`, 'origin', `${restore}:refs/heads/${DEMOS_BRANCH}`]);
        let undo = await rollback();
        // Restoring a fetched shallow tip may need its ancestry once it is no longer advertised.
        if (restore && /shallow update not allowed/.test(undo.err + undo.out)) {
          const ancestry = await run(['fetch', '-q', '--unshallow', '--filter=blob:none', 'origin', restore]);
          if (ancestry.code === 0) undo = await rollback();
        }
        throw new Error(`gh pr create: ${lastLine(c)}. ${undo.code === 0 ? 'The branch change was rolled back; retry publishing.' : `The commit remains on ${DEMOS_BRANCH} at ${tip}; rollback failed: ${undo.err.trim() || lastLine(undo)}`}`);
      }
      return { said: `${pushed}\nOpened ${url}.`, pr: url };
    },
    async prState(url) {
      const r = await x(['gh', 'pr', 'view', url, '--json', 'state', '--jq', '.state']);
      const s = r.out.trim().toUpperCase();
      return r.code !== 0 ? null : s === 'MERGED' ? 'merged' : s === 'OPEN' ? 'open' : s === 'CLOSED' ? 'closed' : null;
    },
    async openPr() {
      try {
        branch = await liveBranch(x, o.repo, folder);
        return (await prs('open'))[0]?.url ?? null;
      } catch {
        return null;
      }
    },
  };
}
