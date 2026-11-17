// Adding demo sites to this machine's list from the configuration (Configuration → Demos, and a
// project's "Add a demo site …"): set up at a host (Cloudflare Pages, GitHub Pages), entered by hand,
// or connected with another machine's code. A site goes on the list only once Seismic has published to
// it: it reads the live site's manifest, takes over what is there and deploys it again unchanged
// (a new site's blank page, an existing one's pages), so a site whose deploy line or credentials do
// not work never shows as a choice. At GitHub the setup lists the repositories gh's login can push
// to: a repository it creates is the whole site, pushed without history; an existing one takes the
// site in a folder of its default branch (github-folder.ts), its first commit pushed there or in the
// rolling pull request, as the owner confirms, with Pages turned on where it is off. Each runs in the background, since a login in the browser or a
// first deploy may take minutes; the dialog follows its lines.

import { randomUUID } from 'node:crypto';
import { MESSAGES } from '../core/messages';
import type { DemoSiteEntry, DemoSitesView, SiteSetupJob } from '../core/types';
import { BadRequest } from './board';
import { addSite, connect, connectionCode, demoSite, envFileFor, findSite, folderDeploy, hostDeploy, newToken, parseEntry, readSites, removeSite, setMode, type SiteHost, writeEnv } from './demo-sites';
import { enablePages, isFolder, listRepos, repoView, tidyFolder } from './github-folder';
import type { GithubRepoList, GithubRepoView } from '../core/types';
import { serial, siteProblem } from './share';
import { siteMissing, sitePaths, siteTarget } from './site';
import { cloudflareAccounts, type Exec, GITHUB_PAGES_MAX, setupCloudflare, setupGithub, SetupRefused } from './site-hosts';
import { messageOf } from '../core/text';

export interface SiteSetupOptions {
  home: string;
  /** The list changed: every project tells its cards where they share now. */
  changed: () => void;
  /** Who runs Seismic here, for a new site's name at Cloudflare. */
  user?: string;
  /** Runs wrangler, gh and git; a stand-in in tests. */
  x?: Exec;
  /** How long to wait (ms, step by step) for a new site's address to answer; a stand-in in tests. */
  wait?: number[];
  /** Publishes to a site to prove this machine can: why it could not, or null. A deploy through the site's own line without it. */
  check?: (site: DemoSiteEntry) => Promise<string | null>;
  /** The repository a folder site's clone fetches from and pushes to, in place of GitHub's; tests name a local one. */
  gitRemote?: string;
}

/** What "Add a demo site" takes: a host Seismic sets the site up at, or a site entered by hand. */
type AddInput =
  | { host: SiteHost; public?: boolean; unlisted?: boolean; account?: string; token?: string; accountId?: string; name?: string }
  | { host: 'github'; repo: string; folder: string; via: 'pr' | 'push' }
  | { manual: { url: string; deploy: string; env?: string; headers?: Record<string, string>; maxFile?: number } };

export class SiteSetup {
  /** The site being added, as far as it got; one at a time. */
  private job: SiteSetupJob | null = null;

  constructor(private o: SiteSetupOptions) {}

  view(): DemoSitesView {
    return {
      sites: readSites(this.o.home).map((s) => {
        const needs = siteMissing(this.o.home, demoSite(s, ''));
        return {
          url: s.url,
          ...(s.host ? { host: s.host } : {}),
          ...(s.project ? { project: s.project } : {}),
          deploy: s.deploy,
          listed: !s.secret,
          ...(needs ? { needs } : {}),
          paths: sitePaths(this.o.home, s, s.secret),
          ...(s.git ? { git: s.git } : {}),
        };
      }),
      ...(this.job ? { job: this.job } : {}),
      cloudflareAccounts: cloudflareAccounts(this.o.home).map((a) => a.site),
    };
  }

  /** "Add": the site set up at the host, or entered by hand; on the list once a publish there went through. */
  add(input: unknown): DemoSitesView {
    const given = (input ?? {}) as Partial<AddInput> & Record<string, unknown>;
    if ('manual' in given && given.manual) {
      let entry: DemoSiteEntry;
      try {
        entry = parseEntry(given.manual);
      } catch (e) {
        throw new BadRequest('invalid', messageOf(e));
      }
      const wrong = siteProblem(demoSite(entry, 'Demos'), this.o.home);
      if (wrong) throw new BadRequest('invalid', wrong);
      this.run(undefined, async (log) => {
        log(`Publishing to ${entry.url} …`);
        return entry;
      });
      return this.view();
    }
    if (given.host === 'github' && typeof given.repo === 'string') return this.addFolder(given);
    const host = hostOf(given);
    const account = accountOf(given);
    const token = tokenOf(given);
    // a public repository: any GitHub account, and a listed site, since anyone can list its files
    const open = host === 'github' && given.public === true;
    const unlisted = host === 'github' ? !open : given.unlisted !== false;
    this.run(host, async (log) => {
      let entry: DemoSiteEntry;
      if (host === 'cloudflare') {
        const name = `seismic-${slug(this.o.user ?? '') || 'demos'}`.slice(0, 50);
        const r = await setupCloudflare({ home: this.o.home, name, log, ...(account ? { account } : {}), ...(token ? { token } : {}), ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.wait ? { wait: this.o.wait } : {}) });
        entry = { url: r.url.replace(/\/+$/, ''), deploy: hostDeploy(host, r.project), host, project: r.project };
        if (r.env) writeEnv(this.o.home, (entry.env = envFileFor(r.url, host)), r.env);
      } else {
        const r = await setupGithub({ name: repoName(given.name), private: unlisted, log, ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.wait ? { wait: this.o.wait } : {}) });
        entry = { url: r.url.replace(/\/+$/, ''), deploy: hostDeploy(host, r.project), host, project: r.project, maxFile: GITHUB_PAGES_MAX };
      }
      return unlisted ? { ...entry, secret: newToken(128) } : entry;
    });
    return this.view();
  }

  /**
   * "Initialize demo site" for a folder of an existing repository: Pages turned on where it is off
   * (from the default branch's root), the site's first commit pushed to the default branch or into
   * the rolling pull request (`via`), and the site on the list in that mode, which the owner may
   * change right after.
   */
  private addFolder(given: Record<string, unknown>): DemoSitesView {
    const repo = String(given.repo);
    const folder = tidyFolder(typeof given.folder === 'string' ? given.folder : '');
    const via = given.via === 'push' ? 'push' : 'pr';
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new BadRequest('invalid', 'expected { repo: "<owner>/<repository>" }');
    if (!isFolder(folder)) throw new BadRequest('invalid', 'the folder is plain path parts with / between them, none starting with . or _');
    this.run('github', async (log) => {
      log(`Reading ${repo} at GitHub…`);
      const info = await repoView(repo, folder, this.o.x);
      if (!info.address) throw new SetupRefused(info.outside ?? `GitHub Pages does not serve ${folder}`);
      if (via === 'push' && !info.push.allowed) throw new SetupRefused(`A push straight to ${info.branch} of ${repo} does not go through; create a pull request instead.`);
      if (!info.pages) {
        log(`Turning on GitHub Pages for ${repo} (${info.branch}, its root)…`);
        try {
          await enablePages(repo, info.branch, this.o.x);
        } catch (e) {
          const said = messageOf(e);
          if (info.private && /plan|upgrade|not available|422/i.test(said)) throw new SetupRefused(`GitHub Pages from a private repository needs GitHub Pro, which this account does not have. (GitHub: ${said})`, 'cloudflare');
          throw new SetupRefused(`GitHub did not turn on Pages for ${repo}: ${said}`);
        }
      }
      log(via === 'pr' ? `Opening a pull request in ${repo} with the site under ${folder}…` : `Pushing the site under ${folder} to ${info.branch} of ${repo}…`);
      const entry: DemoSiteEntry = {
        url: info.address.replace(/\/+$/, ''),
        deploy: folderDeploy(repo),
        host: 'github',
        project: repo,
        maxFile: GITHUB_PAGES_MAX,
        git: { branch: info.branch, folder, mode: via === 'push' ? 'direct' : 'pr' },
      };
      // a private repository's file list is nobody else's: its site is unlisted
      return info.private ? { ...entry, secret: newToken(128) } : entry;
    });
    return this.view();
  }

  /** The repositories gh's login can push to, for the setup's list. */
  repos(): Promise<GithubRepoList> {
    return listRepos(this.o.x).catch((e) => {
      throw new BadRequest('invalid', messageOf(e));
    });
  }

  /** A repository as the setup reads it for a folder (its Pages, the folder's address, the push check, its size); read afresh each time. */
  repo(repo: string, folder: string): Promise<GithubRepoView> {
    return repoView(repo, tidyFolder(folder), this.o.x).catch((e) => {
      throw new BadRequest('invalid', messageOf(e));
    });
  }

  /** "Publish demos": straight to the branch, where a push goes through, or as the rolling pull request. */
  async mode(input: unknown): Promise<DemoSitesView> {
    const { url, mode } = (input ?? {}) as { url?: unknown; mode?: unknown };
    const site = typeof url === 'string' ? findSite(this.o.home, url) : undefined;
    if (!site?.git || !site.project) throw new BadRequest('invalid', 'no such site in a repository’s folder on this machine');
    if (mode !== 'direct' && mode !== 'pr') throw new BadRequest('invalid', 'expected { mode: "direct" | "pr" }');
    if (mode === 'direct') {
      // the repository as it is now: its default branch and Pages may have changed since the setup
      const info = await this.repo(site.project, site.git.folder);
      if (!info.address) throw new BadRequest('invalid', info.outside ?? `GitHub Pages does not serve ${site.git.folder} of ${site.project}`);
      if (!info.push.allowed) throw new BadRequest('invalid', `a push straight to ${info.branch} of ${site.project} does not go through`);
    }
    setMode(this.o.home, site.url, mode);
    this.o.changed();
    return this.view();
  }

  /** "Connect to an existing site": a site another machine of the owner's has, by its code. */
  connect(input: unknown): DemoSitesView {
    const code = (input as { code?: unknown } | null)?.code;
    if (typeof code !== 'string' || !code.trim()) throw new BadRequest('invalid', 'expected { code }');
    try {
      connect(this.o.home, code);
    } catch (e) {
      throw new BadRequest('invalid', messageOf(e));
    }
    this.o.changed();
    return this.view();
  }

  /** The code that connects another machine to the site at `url`: the site and its credentials. */
  code(url: string): { code: string } {
    const site = findSite(this.o.home, url);
    if (!site) throw new BadRequest('invalid', 'no such demo site on this machine');
    return { code: connectionCode(this.o.home, site) };
  }

  /** "Remove from this machine": projects here no longer share there; the pages online stay, as does the project at the host. */
  remove(input: unknown): DemoSitesView {
    const url = (input as { url?: unknown } | null)?.url;
    if (typeof url !== 'string' || !findSite(this.o.home, url)) throw new BadRequest('invalid', 'no such demo site on this machine');
    removeSite(this.o.home, url);
    this.o.changed();
    return this.view();
  }

  /** The finished job's result was seen: the dialog shows the list without it. */
  seen() {
    if (!this.job?.running) this.job = null;
  }

  /** Sets the site up (`fn`), publishes to it, and puts it on the list. */
  private run(host: SiteHost | undefined, fn: (log: (line: string) => void) => Promise<DemoSiteEntry>) {
    if (this.job?.running) throw new BadRequest('invalid', 'a demo site is being added already');
    const job: SiteSetupJob = { id: randomUUID(), ...(host ? { host } : {}), running: true, lines: [] };
    this.job = job;
    const log = (line: string) => {
      job.lines = [...job.lines, line.slice(0, 400)].slice(-12);
    };
    const check = this.o.check ?? ((site) => this.publishes(site, log));
    fn(log)
      .then(async (site) => {
        const wrong = await check(site);
        if (wrong) throw new Error(`Seismic could not publish to ${site.url}: ${wrong}`);
        addSite(this.o.home, site);
        this.o.changed();
        log(`Ready: ${site.url}`);
        job.running = false;
        job.site = site.url;
      })
      .catch((e) => {
        job.running = false;
        job.error = messageOf(e);
        if (e instanceof SetupRefused && e.offer) job.offer = e.offer;
        console.error(`Seismic: adding a demo site failed: ${job.error}`);
      });
  }

  /** Publishes the site as it is (pulled first, so nothing on it goes), through the queue all sites' changes go through; why it failed, or null. */
  private publishes(site: DemoSiteEntry, log: (line: string) => void): Promise<string | null> {
    return serial(async () => {
      const target = siteTarget(demoSite(site, 'Demos'), this.o.home, this.o.home, MESSAGES.en.share, { ...(site.secret ? { unlisted: { secret: site.secret } } : {}), ...(this.o.x ? { x: this.o.x } : {}), ...(this.o.gitRemote ? { gitRemote: this.o.gitRemote } : {}) });
      const r = await target.repair([], log);
      return r.why ?? null;
    });
  }
}

function hostOf(input: unknown): SiteHost {
  const host = (input as { host?: unknown } | null)?.host;
  if (host !== 'cloudflare' && host !== 'github') throw new BadRequest('invalid', 'expected { host: "cloudflare" | "github" } or { manual }');
  return host;
}

/** The Cloudflare account to set up in, by the site whose credentials it takes; none: the machine's own `wrangler login`. */
function accountOf(input: unknown): string | undefined {
  const a = (input as { account?: unknown } | null)?.account;
  return typeof a === 'string' && a ? a : undefined;
}

/** An API token of another Cloudflare account, with its account's id where given: the new site's credentials. */
function tokenOf(input: unknown): Record<string, string> | undefined {
  const { token, accountId } = (input ?? {}) as { token?: unknown; accountId?: unknown };
  if (typeof token !== 'string' || !token.trim()) return undefined;
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token.trim())) throw new BadRequest('invalid', 'that is not a Cloudflare API token');
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (id && !/^[a-f0-9]{32}$/.test(id)) throw new BadRequest('invalid', 'a Cloudflare account id is 32 hexadecimal characters');
  return { CLOUDFLARE_API_TOKEN: token.trim(), ...(id ? { CLOUDFLARE_ACCOUNT_ID: id } : {}) };
}

/** The name of a repository Seismic creates: the owner's, else `seismic-demos`. */
function repoName(name: unknown): string {
  if (name === undefined || name === '') return 'seismic-demos';
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(name.trim()) || /^\.+$/.test(name.trim())) throw new BadRequest('invalid', 'a repository’s name is letters, digits, ., - and _');
  return name.trim();
}

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
