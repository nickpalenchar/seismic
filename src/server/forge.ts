


import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrReviewEntry, PrThread, PrWait } from '../core/types';
import { enterpriseServer, ghHosts, onGitHub, remoteHost } from './repo';
import { spawnOutput } from './spawn';

export interface PrStatus {
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  




  mergeState?: string;
  
  head: string;
  




  changedAt?: string;
  checks: { name: string; state: 'pending' | 'success' | 'failure'; url?: string }[];
  





  comments: {
    id: string;
    author: string;
    body: string;
    at?: string;
    edited?: string;
    path?: string;
    line?: number;
    url?: string;
    round?: string;
    replyTo?: string;
    resolved?: boolean;
    
    verdict?: 'approved' | 'changes' | 'dismissed';
  }[];
  
  author: string;
  
  viewer?: string;
  
  mergeCommit?: string;
}





export interface Forge {
  status(cwd: string, url: string): Promise<PrStatus>;
  
  body(cwd: string, url: string): Promise<string>;
  
  setBody(cwd: string, url: string, body: string): Promise<void>;
  



  merge(cwd: string, url: string, head: string): Promise<string | void>;
  
  open(cwd: string, pr: { base: string; head: string; title: string; body: string }): Promise<string>;
  
  urlOf(cwd: string, n: number): Promise<string>;
  
  contribution(cwd: string, url: string): Promise<ContributionInfo>;
  
  comment(cwd: string, url: string, body: string): Promise<string | void>;
  
  requestChanges(cwd: string, url: string, body: string): Promise<string | void>;
  
  visibility?(cwd: string): Promise<'public' | 'private' | null>;
}


export interface ContributionInfo {
  title: string;
  author: string;
  state: PrStatus['state'];
  
  head: string;
  
  canModify: boolean;
  
  headRepo?: string;
  headRef?: string;
}

/**
 * A pull request URL: on GitHub `https://<host>/<owner>/<repo>/pull/<n>` (github.com, or a GitHub
 * Enterprise server, whose PRs have the same path), on Forgejo or Gitea (Codeberg, a server of one's
 * own, perhaps below a path) `https://<host>/<owner>/<repo>/pulls/<n>`. `github` says which hosts
 * are GitHub's; the host decides, since agents write one forge's path on the other (Codeberg
 * answers `/pull/` with 404). `base`: the server's address; `host`: GitHub's host as gh names it;
 * `url`: the address as the forge writes it.
 */
export function parsePrUrl(
  url: string,
  github: (url: string) => boolean = onGitHub,
): { forge: 'github' | 'forgejo'; base: string; host: string; owner: string; repo: string; number: number; url: string } | null {
  const m = /^(https?:\/\/[^/\s]+(?:\/[^/\s]+)*?)\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)\/?$/.exec(url.trim());
  
  
  if (!m || /[@?#\\]/.test(m[1]!) || !URL.canParse(m[1]!)) return null;
  const [, , owner, repo, n] = m as unknown as [string, string, string, string, string];
  const at = new URL(m[1]!);
  const host = at.host;
  const number = Number(n);
  
  if (github(`${at.protocol}//${host}`)) {
    return at.pathname === '/' ? { forge: 'github', base: `https://${host}`, host, owner, repo, number, url: `https://${host}/${owner}/${repo}/pull/${number}` } : null;
  }
  const base = `${at.protocol}//${host}${at.pathname.replace(/\/$/, '')}`;
  return { forge: 'forgejo', base, host, owner, repo, number, url: `${base}/${owner}/${repo}/pulls/${number}` };
}

/** Whether a git remote (https, ssh, scp-like, or a path) is the repository `owner/repo`. */
export const sameRepo = (remote: string, owner: string, repo: string) =>
  remote
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .slice(-2)
    .join('/') === `${owner}/${repo}`.toLowerCase();

/**
 * Where work that landed on the default branch without a pull request shows on the forge of
 * `remote` (https, ssh or scp-like): its commit `to`, or with `from` the comparison over its
 * commits `from..to`. The path is GitHub's, Forgejo's and Gitea's; GitLab puts it below `/-/`.
 * None for a repository on this machine.
 */
export function landedUrl(remote: string, to: string, from?: string): string | null {
  const url = remote.trim();
  const host = remoteHost(url);
  if (!host) return null;
  const web = /^https?:\/\//i.test(url)
    ? url.replace(/^(https?:\/\/)[^@/]*@/i, '$1')
    : `https://${host}/${url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '').replace(/^[^/\\:]*:\/?/, '')}`;
  const repo = `${web.replace(/\/+$/, '').replace(/\.git$/, '')}${host.includes('gitlab') ? '/-' : ''}`;
  return from ? `${repo}/compare/${from}...${to}` : `${repo}/commit/${to}`;
}

/**
 * The forge a pull request is on, by its URL; one is opened on the forge of the repository's
 * `origin` (GitHub where `onGitHub` says so, else Forgejo).
 */
export const routedForge = (github: Forge, forgejo: Forge, origin: (cwd: string) => Promise<string | null>, onGitHub: (remote: string) => boolean): Forge => {
  const of = (url: string) => (parsePrUrl(url, onGitHub)?.forge === 'forgejo' ? forgejo : github);
  return {
    status: (cwd, url) => of(url).status(cwd, url),
    body: (cwd, url) => of(url).body(cwd, url),
    setBody: (cwd, url, body) => of(url).setBody(cwd, url, body),
    merge: (cwd, url, head) => of(url).merge(cwd, url, head),
    contribution: (cwd, url) => of(url).contribution(cwd, url),
    urlOf: async (cwd, n) => {
      const remote = await origin(cwd);
      return (remote && !onGitHub(remote) ? forgejo : github).urlOf(cwd, n);
    },
    comment: (cwd, url, body) => of(url).comment(cwd, url, body),
    requestChanges: (cwd, url, body) => of(url).requestChanges(cwd, url, body),
    open: async (cwd, pr) => {
      const remote = await origin(cwd);
      return (remote && !onGitHub(remote) ? forgejo : github).open(cwd, pr);
    },
    visibility: async (cwd) => {
      const remote = await origin(cwd);
      if (!remote) return null;
      const f = onGitHub(remote) ? github : forgejo;
      return f.visibility ? f.visibility(cwd) : null;
    },
  };
};





export interface GhAt {
  cwd: string;
  host?: string;
  owner?: string;
}

/**
 * The host and owner of a GitHub repository by its remote URL (https, ssh or scp-like) on
 * github.com or a GitHub Enterprise server gh is logged into (`onGitHub`), or none for any other.
 */
export function githubRepo(remote: string, hosts: () => string[] = ghHosts): { host: string; owner: string } | undefined {
  const url = remote.trim();
  const host = remoteHost(url);
  if (!host || !onGitHub(url, hosts)) return undefined;
  const path = url.includes('://') ? url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '') : url.replace(/^[^:]*:\/?/, '');
  const owner = /^([^/]+)\/[^/]+?\/?$/.exec(path)?.[1];
  
  return owner ? { host: host.endsWith('.github.com') ? 'github.com' : host, owner } : undefined;
}



const TOKEN_TTL = 10 * 60_000;

const tokens = new Map<string, { token: Promise<string | null>; at: number }>();





const GH_TIMEOUT = 60_000;

/**
 * gh's environment for a repository of `owner` on `host`: gh sent to that host (`GH_HOST`; else
 * `gh api` would ask github.com), and the token of gh's login there for that account where it
 * has one, so that a private repository of the owner is seen whichever account gh has active on
 * this machine (another one finds no such repository); else gh as it runs anyway (an
 * organisation's repository, say).
 */
async function ghEnv(program: string, { host, owner }: Omit<GhAt, 'cwd'>, timeout: number): Promise<NodeJS.ProcessEnv | undefined> {
  if (!host) return undefined;
  let token: string | null = null;
  if (owner) {
    const key = `${program}\n${host}\n${owner}`;
    let known = tokens.get(key);
    if (!known || Date.now() - known.at > TOKEN_TTL) {
      
      const { GH_TOKEN: _, GITHUB_TOKEN: __, GH_ENTERPRISE_TOKEN: ___, GITHUB_ENTERPRISE_TOKEN: ____, ...plain } = process.env;
      const asked = spawnOutput([program, 'auth', 'token', '--hostname', host, '--user', owner], { env: plain, stdin: 'ignore', timeout }).then(
        (r) => (r.code === 0 && r.stdout.trim()) || null,
        () => null,
      );
      known = { token: asked, at: Date.now() };
      tokens.set(key, known);
    }
    token = await known.token;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, GH_HOST: host };
  if (token) {
    
    const [name, other] = enterpriseServer(host) ? ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'] : ['GH_TOKEN', 'GITHUB_TOKEN'];
    delete env[other];
    env[name] = token;
  }
  return env;
}

/**
 * A runner for `makeGhForge` that runs gh (`program`; a stand-in in tests) without blocking the
 * server: each call is a round trip to GitHub, a second when all is well and many when GitHub or
 * the machine is slow, in which the server would answer nothing else.
 */
export const ghCli =
  (program = 'gh', timeout = GH_TIMEOUT) =>
  async ({ cwd, ...at }: GhAt, ...args: string[]): Promise<string> => {
    const env = await ghEnv(program, at, timeout);
    const r = await spawnOutput([program, ...args], { cwd, stdin: 'ignore', timeout, ...(env ? { env } : {}) });
    if (r.signal) throw new Error(`gh ${args.slice(0, 3).join(' ')}: no answer within ${timeout / 1000} s`);
    if (r.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${r.stderr.trim()}`);
    return r.stdout;
  };

/** The host and owner of the GitHub repository a checkout's `origin` is, where it is one. */
async function originRepo(cwd: string): Promise<{ host: string; owner: string } | undefined> {
  const r = await spawnOutput(['git', '-C', cwd, 'remote', 'get-url', 'origin'], { stdin: 'ignore' });
  return r.code === 0 ? githubRepo(r.stdout) : undefined;
}

/** A pull request URL read as GitHub's, whatever its host: `routedForge` sent it to gh. */
const githubPr = (url: string) => parsePrUrl(url, () => true);

/**
 * The pull request's address as gh takes it: one recorded with Forgejo's `/pulls/` (an Enterprise
 * PR reported before gh was logged in there) gh would reject.
 */
const ghUrl = (url: string) => githubPr(url)?.url ?? url;

/** Where gh runs for the pull request at `url`. */
const atPr = (cwd: string, url: string): GhAt => {
  const ref = githubPr(url);
  return ref ? { cwd, host: ref.host, owner: ref.owner } : { cwd };
};

/** The pull request at `url`; throws for a URL that is no GitHub pull request's. */
function prRef(url: string) {
  const ref = githubPr(url);
  if (!ref) throw new Error(`not a GitHub pull request URL: ${url}`);
  return ref;
}

/** Runs `f` with `body` in a file: a long description as an argument would pass Windows' limit on a command line. */
export async function withBodyFile<T>(body: string, f: (file: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'seismic-pr-body-'));
  try {
    const file = join(dir, 'body.md');
    writeFileSync(file, body);
    return await f(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface GhPr {
  state: PrStatus['state'];
  mergeable: PrStatus['mergeable'];
  mergeStateStatus?: string;
  headRefOid: string;
  mergeCommit?: { oid: string } | null;
  author: { login: string };
  statusCheckRollup: { __typename: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }[];
  comments: { id: string; author: { login: string }; body: string; url: string; createdAt?: string }[];
  reviews: { id: string; author: { login: string }; body: string; submittedAt?: string; state?: string }[];
}

/** GitHub through a `gh` runner (the real CLI, or canned output in tests). */
export const makeGhForge = (
  run: (at: GhAt, ...args: string[]) => string | Promise<string>,
  repoOf: (cwd: string) => Promise<{ host: string; owner: string } | undefined> = originRepo,
): Forge => ({
  async status(cwd, url) {
    const ref = prRef(url);
    const at = atPr(cwd, url);
    
    const [pr, inline, threads] = await Promise.all([
      run(at, 'pr', 'view', ghUrl(url), '--json', 'state,mergeable,mergeStateStatus,headRefOid,mergeCommit,author,statusCheckRollup,comments,reviews'),
      run(at, 'api', `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments`, '--paginate'),
      run(
        at,
        'api',
        'graphql',
        '-F',
        `owner=${ref.owner}`,
        '-F',
        `repo=${ref.repo}`,
        '-F',
        `number=${ref.number}`,
        '-f',
        'query=query($owner: String!, $repo: String!, $number: Int!) { viewer { login } repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved comments(first: 1) { nodes { databaseId } } } } comments(last: 100) { nodes { id updatedAt } } commits(last: 30) { nodes { commit { committedDate parents { totalCount } } } } } } }',
      ),
    ]);
    return ghStatus(pr, inline, threads);
  },
  async body(cwd, url) {
    return (JSON.parse(await run(atPr(cwd, url), 'pr', 'view', ghUrl(url), '--json', 'body')) as { body: string }).body;
  },
  async setBody(cwd, url, body) {
    await withBodyFile(body, (file) => run(atPr(cwd, url), 'pr', 'edit', ghUrl(url), '--body-file', file));
  },
  async open(cwd, pr) {
    const at: GhAt = { cwd, ...(await repoOf(cwd)) };
    
    const out = await withBodyFile(pr.body, (file) => run(at, 'pr', 'create', '--base', pr.base, '--head', pr.head, '--title', pr.title, '--body-file', file));
    return out.trim().split('\n').at(-1)!.trim();
  },
  async urlOf(cwd, n) {
    const at: GhAt = { cwd, ...(await repoOf(cwd)) };
    return (await run(at, 'pr', 'view', String(n), '--json', 'url', '--jq', '.url')).trim();
  },
  async visibility(cwd) {
    const at: GhAt = { cwd, ...(await repoOf(cwd)) };
    const v = (await run(at, 'repo', 'view', '--json', 'visibility', '--jq', '.visibility')).trim().toUpperCase();
    return v === 'PUBLIC' ? 'public' : v ? 'private' : null;
  },
  async contribution(cwd, url) {
    const ref = prRef(url);
    const pr = JSON.parse(
      await run(atPr(cwd, url), 'pr', 'view', ghUrl(url), '--json', 'title,author,state,headRefOid,headRefName,headRepository,headRepositoryOwner,maintainerCanModify'),
    ) as { title: string; author: { login: string }; state: PrStatus['state']; headRefOid: string; headRefName?: string; headRepository?: { name: string } | null; headRepositoryOwner?: { login: string } | null; maintainerCanModify?: boolean };
    const owner = pr.headRepositoryOwner?.login;
    const repo = pr.headRepository?.name;
    return {
      title: pr.title,
      author: pr.author.login,
      state: pr.state,
      head: pr.headRefOid,
      canModify: !!pr.maintainerCanModify,
      ...(owner && repo ? { headRepo: `https://${ref.host}/${owner}/${repo}.git` } : {}),
      ...(pr.headRefName ? { headRef: pr.headRefName } : {}),
    };
  },
  async comment(cwd, url, body) {
    
    const out = await withBodyFile(body, (file) => run(atPr(cwd, url), 'pr', 'comment', ghUrl(url), '--body-file', file));
    return out.trim().split('\n').at(-1)?.trim() || undefined;
  },
  async requestChanges(cwd, url, body) {
    const ref = prRef(url);
    
    const out = await withBodyFile(body, (file) =>
      run(atPr(cwd, url), 'api', '-X', 'POST', `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`, '-f', 'event=REQUEST_CHANGES', '-F', `body=@${file}`, '--jq', '.html_url'),
    );
    return out.trim() || undefined;
  },
  async merge(cwd, url, head) {
    const ref = prRef(url);
    const at = atPr(cwd, url);
    
    const allows = JSON.parse(await run(at, 'api', `repos/${ref.owner}/${ref.repo}`, '--jq', '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge}')) as Record<string, boolean>;
    const method = (['squash', 'merge', 'rebase'] as const).find((m) => allows[m] !== false) ?? 'squash';
    
    await run(at, 'pr', 'merge', ghUrl(url), `--${method}`, '--match-head-commit', head);
    try {
      return (await run(at, 'pr', 'view', ghUrl(url), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid')).trim() || undefined;
    } catch {
      
      return undefined;
    }
  },
});

/** A PR's status from gh's three answers: the PR, its inline comments, and GraphQL's threads and commits. */
function ghStatus(prOut: string, inlineOut: string, threadsOut: string): PrStatus {
  const pr = JSON.parse(prOut) as GhPr;
  const inline = JSON.parse(inlineOut) as {
    id: number;
    user: { login: string };
    body: string;
    path: string;
    line: number | null;
    html_url: string;
    created_at?: string;
    pull_request_review_id?: number | null;
    in_reply_to_id?: number | null;
  }[];
  
  
  const threads = JSON.parse(threadsOut) as {
    data?: {
      viewer?: { login: string };
      repository?: {
        pullRequest?: {
          reviewThreads?: { nodes: { isResolved: boolean; comments: { nodes: { databaseId: number }[] } }[] };
          comments?: { nodes: { id: string; updatedAt: string }[] };
          commits?: { nodes: { commit: { committedDate: string; parents: { totalCount: number } } }[] };
        };
      };
    };
  };
  const resolved = new Set(
    (threads.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).filter((t) => t.isResolved).map((t) => t.comments.nodes[0]?.databaseId),
  );
  const changedAt = (threads.data?.repository?.pullRequest?.commits?.nodes ?? []).findLast((n) => n.commit.parents.totalCount < 2)?.commit.committedDate;
  const updated = new Map((threads.data?.repository?.pullRequest?.comments?.nodes ?? []).map((c) => [c.id, c.updatedAt]));
  
  const edited = (id: string, at?: string) => {
    const u = updated.get(id);
    return u && at && Date.parse(u) - Date.parse(at) > 60_000 ? { edited: u } : {};
  };
  const checks = (pr.statusCheckRollup ?? []).map((c) => {
    const name = c.name ?? c.context ?? 'check';
    const verdict = (c.conclusion ?? c.state ?? '').toUpperCase();
    const done = c.__typename === 'CheckRun' ? c.status === 'COMPLETED' : verdict !== 'PENDING' && verdict !== 'EXPECTED';
    const state: PrStatus['checks'][number]['state'] = !done
      ? 'pending'
      : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(verdict)
        ? 'success'
        : 'failure';
    return { name, state, ...((c.detailsUrl ?? c.targetUrl) ? { url: c.detailsUrl ?? c.targetUrl } : {}) };
  });
  return {
    state: pr.state,
    mergeable: pr.mergeable,
    ...(pr.mergeStateStatus ? { mergeState: pr.mergeStateStatus } : {}),
    head: pr.headRefOid,
    ...(changedAt ? { changedAt } : {}),
    author: pr.author.login,
    ...(threads.data?.viewer?.login ? { viewer: threads.data.viewer.login } : {}),
    ...(pr.state === 'MERGED' && pr.mergeCommit?.oid ? { mergeCommit: pr.mergeCommit.oid } : {}),
    checks,
    comments: [
      ...pr.comments.map((c) => ({
        id: `c${c.id}`,
        author: c.author.login,
        body: c.body,
        ...(c.createdAt ? { at: c.createdAt } : {}),
        ...edited(c.id, c.createdAt),
        url: c.url,
      })),
      ...pr.reviews
        .map((r) => ({ id: `r${r.id}`, author: r.author.login, body: r.body, ...(r.submittedAt ? { at: r.submittedAt } : {}), ...verdictOf(r.state) }))
        .filter((r) => r.body.trim() || r.verdict),
      
      ...inline.map((c) => ({
        id: `i${c.id}`,
        author: c.user.login.replace(/\[bot\]$/, ''),
        body: c.body,
        ...(c.created_at ? { at: c.created_at } : {}),
        path: c.path,
        ...(c.line ? { line: c.line } : {}),
        url: c.html_url,
        ...(c.pull_request_review_id ? { round: String(c.pull_request_review_id) } : {}),
        ...(c.in_reply_to_id ? { replyTo: `i${c.in_reply_to_id}` } : { resolved: resolved.has(c.id) }),
      })),
    ],
  };
}

/** A review's verdict by the state the forge gives it (GitHub's `CHANGES_REQUESTED`, Forgejo's `REQUEST_CHANGES`); none for a comment. */
export const verdictOf = (state?: string): { verdict?: 'approved' | 'changes' | 'dismissed' } => {
  const v = (state ?? '').toUpperCase();
  return v === 'APPROVED' ? { verdict: 'approved' } : v === 'CHANGES_REQUESTED' || v === 'REQUEST_CHANGES' ? { verdict: 'changes' } : v === 'DISMISSED' ? { verdict: 'dismissed' } : {};
};

export const ghForge = makeGhForge(ghCli());

/**
 * What the card shows of a pull request's review, oldest first: each round a reviewer left comments
 * on the code in, with the replies in each thread, and the conversation between the rounds.
 * Comments by `skip` (bots that are not reviewers) are left out; `mine` marks `self`: the PR's
 * author, which is the worker writing in the owner's name, or on a review card the owner's account.
 */
export function reviewOf(s: PrStatus, skip: string[] = [], self = s.author): PrReviewEntry[] {
  const shown = s.comments.filter((c) => !skip.includes(c.author));
  const mine = (author: string) => (author === self ? { mine: true } : {});
  const threads = new Map<string, PrThread>();
  const rounds = new Map<string, Extract<PrReviewEntry, { threads: PrThread[] }>>();
  const entries: PrReviewEntry[] = [];
  for (const c of shown) {
    if (c.replyTo || !c.id.startsWith('i')) continue;
    const thread: PrThread = {
      author: c.author,
      ...mine(c.author),
      body: readable(c.body),
      at: c.at ?? '',
      ...(c.path ? { path: c.path } : {}),
      ...(c.line ? { line: c.line } : {}),
      ...(c.url ? { url: c.url } : {}),
      resolved: !!c.resolved,
      replies: [],
    };
    threads.set(c.id, thread);
    const key = c.round ?? c.id;
    const round = rounds.get(key);
    if (round) round.threads.push(thread);
    else {
      const r = { author: c.author, ...mine(c.author), at: c.at ?? '', threads: [thread] };
      rounds.set(key, r);
      entries.push(r);
    }
  }
  for (const c of shown) {
    const reply = { author: c.author, ...mine(c.author), body: readable(c.body), at: c.at ?? '' };
    if (c.replyTo) threads.get(c.replyTo)?.replies.push(reply);
    
    else if (!c.id.startsWith('i')) entries.push({ ...reply, ...(c.edited ? { at: c.edited, edited: true } : {}), ...(c.url ? { url: c.url } : {}) });
  }
  for (const r of rounds.values()) r.at = r.threads.reduce((a, t) => (t.at && t.at < a ? t.at : a), r.at);
  return entries.filter((e) => 'threads' in e || e.body).sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * What the pull request waits for before it can be merged, in the order it is in the way: what the
 * forge sees (a conflict, a branch behind its base, a draft, branch protection, mergeability not
 * worked out yet), checks failed or running, review threads open, a reviewer who has not seen the
 * PR's own latest changes, and whoever was asked for another look not having answered since the
 * author last asked (a review bot answers a re-review by rewriting its summary, often without a new
 * comment). Comments by `skip` do not count as an answer. Nothing for a PR no longer open.
 */
export function waitsOf(s: PrStatus, skip: string[] = []): PrWait[] {
  if (s.state !== 'OPEN') return [];
  const waits: PrWait[] = [];
  if (s.mergeable === 'CONFLICTING' || s.mergeState === 'DIRTY') waits.push('conflict');
  else if (s.mergeState === 'BEHIND') waits.push('behind');
  else if (s.mergeState === 'DRAFT') waits.push('draft');
  else if (s.mergeState === 'BLOCKED') waits.push('protection');
  
  else if (s.mergeable !== 'MERGEABLE' || (s.mergeState !== 'CLEAN' && s.mergeState !== 'HAS_HOOKS' && !(s.mergeState === 'UNSTABLE' && s.checks.some((c) => c.state !== 'success'))))
    waits.push('forge');
  if (s.checks.some((c) => c.state === 'failure')) waits.push('checksFailed');
  else if (s.checks.some((c) => c.state !== 'success')) waits.push('checks');
  const others = reviewers(s, skip);
  if (others.some((c) => c.id.startsWith('i') && !c.replyTo && !c.resolved)) waits.push('threads');
  if (changesRequested(s, skip).length) waits.push('changes');
  if (reviewStale(s, skip)) waits.push('review');
  else {
    const asked = requestOf(s, skip);
    const after = (who?: string) => others.some((c) => (!who || c.author === who) && (c.edited ?? c.at ?? '') > asked!.at);
    if (asked && !(asked.awaits.length ? asked.awaits.every(after) : after())) waits.push('answer');
  }
  return waits;
}

/** Whether the pull request only waits for the merge: open, and nothing of `waitsOf` in the way. */
export function readyToMerge(s: PrStatus, skip: string[] = []): boolean {
  return s.state === 'OPEN' && !waitsOf(s, skip).length;
}

/**
 * Whether a reviewer wrote on the pull request, but nothing since its own changes last changed
 * (a merge of the base does not count): the last verdict is about an older state. A PR merged on Greptile's 3/5 of its first commit
 * (2026-10-02): the fix pushed after it was never reviewed, as nobody asked for another look.
 */
export function reviewStale(s: PrStatus, skip: string[] = []): boolean {
  if (!s.changedAt) return false;
  const last = reviewers(s, skip).reduce((a, c) => latest(a, c.edited ?? c.at), '');
  return !!last && last < s.changedAt;
}

/**
 * The author's latest request for another look, and whose answer it waits for: a conversation
 * comment of theirs that answers a reviewer whose latest word in the conversation before it was no
 * passing verdict (a request for changes in a plain comment, which names nobody, is answered so;
 * that reviewer's answer is awaited, another's does not stand in for it), or that mentions an
 * account, as review bots are asked (`@greptile review`; then any reviewer's word answers). A
 * comment that mentions nobody while every reviewer's latest word is a passing verdict (a thank-you
 * for a 5/5 summary without findings) asks for nothing: waiting for its answer stalled a PR whose
 * review was through (2026-11-02). Passing: an approval, or a confidence of at least 4/5. A
 * reviewer's word in a thread on the code is the thread's business, not the conversation's.
 * Comments by `skip` are no reviewer's word.
 */
export function requestOf(s: PrStatus, skip: string[] = []): { at: string; awaits: string[] } | null {
  const said = reviewers(s, skip).filter((c) => !c.id.startsWith('i'));
  const when = (c: PrStatus['comments'][number]) => c.edited ?? c.at ?? '';
  let found: { at: string; awaits: string[] } | null = null;
  for (const c of s.comments) {
    if (c.author !== s.author || !c.id.startsWith('c') || !c.at || (found && c.at < found.at)) continue;
    const latestOf = new Map<string, PrStatus['comments'][number]>();
    for (const o of said) if (when(o) <= c.at && (!latestOf.has(o.author) || when(o) >= when(latestOf.get(o.author)!))) latestOf.set(o.author, o);
    const awaits = [...latestOf].filter(([, o]) => !passing(o)).map(([who]) => who);
    if (awaits.length || mentions(c.body)) found = { at: c.at, awaits };
  }
  return found;
}

/** When the author last asked for another look (`requestOf`); empty where they never did. */
export const lastAsked = (s: PrStatus, skip: string[] = []) => requestOf(s, skip)?.at ?? '';


export const MIN_CONFIDENCE = 0.8;

/** Whether a reviewer's comment is a verdict that lets the PR go: an approval, or a confidence of at least 4/5. */
export const passing = (c: PrStatus['comments'][number]) => {
  if (c.verdict === 'approved') return true;
  const m = /Confidence Score:\s*(\d+)\s*\/\s*(\d+)/i.exec(c.body);
  return !!m && Number(m[1]) / Number(m[2]) >= MIN_CONFIDENCE;
};

/**
 * The reviewers whose request for changes (GitHub's "Request changes") stands: their latest review
 * with a verdict asks for changes, not approved or dismissed since.
 */
export function changesRequested(s: PrStatus, skip: string[] = []): string[] {
  const last = new Map<string, { at: string; verdict: string }>();
  for (const c of reviewers(s, skip)) {
    if (!c.verdict) continue;
    const at = c.at ?? '';
    const known = last.get(c.author);
    if (!known || at >= known.at) last.set(c.author, { at, verdict: c.verdict });
  }
  return [...last].filter(([, v]) => v.verdict === 'changes').map(([who]) => who);
}

/** Whether a comment mentions an account (`@name`), outside code (fenced, indented or inline) and quoted lines. */
const mentions = (body: string) =>
  /(^|[^\w`@/.-])@[a-z0-9][a-z0-9-]*/i.test(
    body
      .replace(/^ {0,3}(```|~~~)[\s\S]*?(^ {0,3}\1|$(?![\s\S]))/gm, '')
      .replace(/`[^`\n]*`/g, '')
      .replace(/^ {0,3}>.*$/gm, '')
      .replace(/^(?: {4}|\t).*$/gm, ''),
  );

/**
 * The confidence a reviewer gave last, in a comment rewritten or written latest (Greptile's
 * "Confidence Score: 3/5" in its summary); none when no reviewer gives one.
 */
export function confidence(s: PrStatus, skip: string[] = []): { score: number; of: number; by: string } | undefined {
  let found: { score: number; of: number; by: string; at: string } | undefined;
  for (const c of reviewers(s, skip)) {
    const m = /Confidence Score:\s*(\d+)\s*\/\s*(\d+)/i.exec(c.body);
    const at = c.edited ?? c.at ?? '';
    if (m && (!found || at >= found.at)) found = { score: Number(m[1]), of: Number(m[2]), by: c.author, at };
  }
  return found && { score: found.score, of: found.of, by: found.by };
}

const reviewers = (s: PrStatus, skip: string[]) => s.comments.filter((c) => c.author !== s.author && !skip.includes(c.author));
const latest = (a: string, b?: string) => (b && b > a ? b : a);

const MAX_BODY = 3000;

const GONE = '\u0000';

/**
 * A comment as text the card renders: review bots write HTML (badges, folded prompts for other
 * agents, diagrams) into their Markdown; the badges' names stay, code and folded parts go.
 */
export function readable(body: string): string {
  let t = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<details>[\s\S]*?<\/details>/gi, `\n${GONE}\n`)
    .replace(/<picture>[\s\S]*?<\/picture>/gi, '')
    .replace(/```[\s\S]*?(```|$)/g, `\n${GONE}\n`)
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, '$1')
    .replace(/<h\d[^>]*>([\s\S]*?)<\/h\d>/gi, '\n### $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, '$1');
  
  const lines = t.split('\n').map((l) => l.trimEnd());
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (!h) {
      if (line.trim() !== GONE) out.push(line);
      continue;
    }
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next && next.trim() !== GONE && !/^#{1,6}\s/.test(next.trim()) && h[1]!.trim()) out.push(`**${h[1]!.trim()}**`);
  }
  t = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > MAX_BODY ? `${t.slice(0, MAX_BODY).trimEnd()} …` : t;
}
