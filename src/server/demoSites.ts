












import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { DemoSite, DemoSiteEntry } from '../core/types';
import { GITHUB_PAGES, GITHUB_PAGES_MAX } from './siteHosts';
import { GITHUB_FOLDER, isFolder } from './githubFolder';
import { parseEnv, SITES_DIR, siteKey } from './site';

export const SITES_FILE = 'demo-sites.json';

const PERSONAL_FILE = 'personal-site.json';


export type SiteHost = 'cloudflare' | 'github';


export const SITE_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/;

const entryShape = z
  .object({
    url: z.string().regex(SITE_URL),
    
    deploy: z
      .string()
      .trim()
      .min(1)
      .transform((d) => d.replace(/^obeya:(github-(?:pages|folder))(?=\s|$)/, 'seismic:$1')),
    
    env: z
      .string()
      .min(1)
      .refine((f) => !/^([\\/~]|[A-Za-z]:)/.test(f) && !f.split(/[\\/]/).includes('..'), 'a path relative to Seismic’s home, without ..')
      .optional(),
    headers: z.record(z.string(), z.string()).optional(),
    maxFile: z.number().int().positive().optional(),
    host: z.enum(['cloudflare', 'github']).optional(),
    
    project: z.string().regex(/^[A-Za-z0-9-]+(\/[A-Za-z0-9._-]+)?$/).optional(),
    secret: z.string().regex(/^[a-z0-9]{16,64}$/).optional(),
    git: z
      .object({
        branch: z.string().regex(/^[A-Za-z0-9._\/-]{1,200}$/),
        folder: z.string().refine(isFolder, 'a folder of plain path parts, none starting with . or _'),
        mode: z.enum(['direct', 'pr']),
      })
      .strict()
      .optional(),
  })
  .strict();

const fileShape = z.object({ sites: z.array(entryShape) }).strict();


const personalShape = z.object({
  host: z.enum(['cloudflare', 'github']),
  url: z.string().regex(SITE_URL),
  project: z.string().regex(/^[A-Za-z0-9-]+(\/[A-Za-z0-9._-]+)?$/),
  secret: z.string().regex(/^[a-z0-9]{16,64}$/).optional(),
  env: z.string().optional(),
});

/** A site's address as the list keeps it: without a trailing slash. */
export const siteUrl = (url: string) => url.trim().replace(/\/+$/, '');

/** The deploy line of a site Seismic set up at a host. */
export const hostDeploy = (host: SiteHost, project: string) => (host === 'cloudflare' ? cloudflareDeploy(project) : `${GITHUB_PAGES} ${project}`);

/** The deploy line of a site in a folder of an existing GitHub repository (the folder and branch are the entry's `git`). */
export const folderDeploy = (repo: string) => `${GITHUB_FOLDER} ${repo}`;

/** The deploy line of a Cloudflare Pages project, as Seismic's own site has it. */
export const cloudflareDeploy = (project: string) => `bunx wrangler@4 pages deploy {dir} --project-name ${project} --branch main --commit-dirty=true`;


const cache = new Map<string, { stamp: string; sites: DemoSiteEntry[] }>();

const stampOf = (file: string) => {
  try {
    const st = statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
};

/** The demo sites of this machine; none without the file, or with a file that is not one. */
export function readSites(home: string): DemoSiteEntry[] {
  const file = join(home, SITES_FILE);
  const stamp = stampOf(file);
  if (!stamp) return fromPersonal(home);
  const known = cache.get(file);
  if (known?.stamp === stamp) return known.sites;
  let sites: DemoSiteEntry[] = [];
  try {
    const p = fileShape.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (p.success) sites = p.data.sites.map((s) => ({ ...s, url: siteUrl(s.url) }));
  } catch {}
  cache.set(file, { stamp, sites });
  return sites;
}

/** The personal site kept before the list, as its first entry; none without it. */
function fromPersonal(home: string): DemoSiteEntry[] {
  try {
    const p = personalShape.safeParse(JSON.parse(readFileSync(join(home, PERSONAL_FILE), 'utf8')));
    if (!p.success) return [];
    const { host, url, project, secret, env } = p.data;
    return [{ url: siteUrl(url), deploy: hostDeploy(host, project), host, project, ...(secret ? { secret } : {}), ...(env ? { env } : {}), ...(host === 'github' ? { maxFile: GITHUB_PAGES_MAX } : {}) }];
  } catch {
    return [];
  }
}

export function writeSites(home: string, sites: DemoSiteEntry[]) {
  const file = join(home, SITES_FILE);
  cache.delete(file);
  mkdirSync(home, { recursive: true });
  writeFileSync(file, `${JSON.stringify(fileShape.parse({ sites }), null, 2)}\n`);
  
  rmSync(join(home, PERSONAL_FILE), { force: true });
}

/** Checks a site as the list keeps it; throws with what is wrong. */
export function parseEntry(input: unknown): DemoSiteEntry {
  const p = entryShape.safeParse(input);
  if (!p.success) throw new Error(z.prettifyError(p.error));
  return { ...p.data, url: siteUrl(p.data.url) };
}

/** Adds a site to the list, in place of one at the same address. */
export function addSite(home: string, site: DemoSiteEntry) {
  writeSites(home, [...readSites(home).filter((s) => s.url !== site.url), site]);
}

/** Sets how changes go into a folder site's repository: pushed to its branch, or collected in the rolling pull request. */
export function setMode(home: string, url: string, mode: 'direct' | 'pr') {
  writeSites(
    home,
    readSites(home).map((s) => (s.url === siteUrl(url) && s.git ? { ...s, git: { ...s.git, mode } } : s)),
  );
}

/** Takes a site off the list: this machine no longer publishes there; its pages stay online. */
export function removeSite(home: string, url: string) {
  writeSites(
    home,
    readSites(home).filter((s) => s.url !== siteUrl(url)),
  );
}

/** The site of the list at `url`; none where this machine has none there. */
export const findSite = (home: string, url: string): DemoSiteEntry | undefined => readSites(home).find((s) => s.url === siteUrl(url));

/** The site of the list a page's address lies on; none where none of the list has it. */
export const siteOfPage = (home: string, page: string): DemoSiteEntry | undefined => readSites(home).find((s) => page.startsWith(`${s.url}/`));

/** A site of the list as a project shares on it: the title its overview and pages carry, and what the project adds. */
export function demoSite(entry: DemoSiteEntry, title: string, extra: Pick<DemoSite, 'publish' | 'tags'> = {}): DemoSite {
  return {
    title,
    url: entry.url,
    deploy: entry.deploy,
    ...(entry.env ? { env: entry.env } : {}),
    ...(entry.headers ? { headers: entry.headers } : {}),
    ...(entry.maxFile ? { maxFile: entry.maxFile } : {}),
    ...(entry.git ? { git: entry.git } : {}),
    ...extra,
  };
}

/**
 * A random lower-case name of at least `bits` bits: the part of a page's URL nobody guesses, and the
 * manifest's directory. 36 letters and digits carry about 5.17 bits each.
 */
export function newToken(bits = 80): string {
  const n = Math.ceil(bits / Math.log2(36));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  
  while (out.length < n) for (const b of randomBytes(n * 2)) if (b < 252 && out.length < n) out += alphabet[b % 36];
  return out;
}

/** Where the env file of a host's credentials goes for a site, relative to Seismic's home. */
export const envFileFor = (url: string, host: SiteHost | 'deploy') => `${SITES_DIR}/${siteKey(url)}/${host}.env`;

/** Writes `KEY=value` lines to a file under Seismic's home, readable by its owner alone. */
export function writeEnv(home: string, rel: string, env: Record<string, string>) {
  const file = join(home, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
    { mode: 0o600 },
  );
}

const CODE_PREFIX = 'seismic-site:';

const OLD_CODE_PREFIX = 'obeya-site:';

/**
 * The connection code for another machine of the owner's: the site with its secret path and the
 * deploy's credentials (none where the machine's own login deploys: wrangler's or gh's).
 */
export function connectionCode(home: string, site: DemoSiteEntry): string {
  const env = site.env && existsSync(join(home, site.env)) ? parseEnv(readFileSync(join(home, site.env), 'utf8')) : undefined;
  const { env: _, ...rest } = site;
  return CODE_PREFIX + Buffer.from(JSON.stringify({ ...rest, ...(env ? { credentials: env } : {}) })).toString('base64url');
}

/** Adds the site a code names to this machine's list; the site, and whether it brought credentials. */
export function connect(home: string, code: string): { site: DemoSiteEntry; credentials: boolean } {
  const text = code.trim();
  const prefix = [CODE_PREFIX, OLD_CODE_PREFIX].find((p) => text.startsWith(p));
  if (!prefix) throw new Error('not a connection code of a demo site');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(text.slice(prefix.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('the connection code is incomplete; copy it again');
  }
  const { credentials, private: _, approved: __, ...rest } = raw as { credentials?: Record<string, unknown>; private?: unknown; approved?: unknown; deploy?: unknown };
  
  const old = !rest.deploy && personalShape.omit({ env: true }).safeParse(rest);
  const parsed = entryShape.omit({ env: true }).safeParse(old && old.success ? { ...old.data, deploy: hostDeploy(old.data.host, old.data.project), ...(old.data.host === 'github' ? { maxFile: GITHUB_PAGES_MAX } : {}) } : rest);
  if (!parsed.success) throw new Error('the connection code is incomplete; copy it again');
  const env = credentials && typeof credentials === 'object' ? Object.fromEntries(Object.entries(credentials).filter((e): e is [string, string] => typeof e[1] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(e[0]))) : {};
  const site: DemoSiteEntry = { ...parsed.data, url: siteUrl(parsed.data.url) };
  if (Object.keys(env).length) {
    site.env = envFileFor(site.url, site.host ?? 'deploy');
    writeEnv(home, site.env, env);
  }
  addSite(home, site);
  return { site, credentials: !!site.env };
}
