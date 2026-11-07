// The demo sites this machine publishes to, kept in Seismic's home (`demo-sites.json`), not in any
// repository: a site is a person's (its credentials are), and a canvas chooses one of them with a
// path of its own (`CanvasDemoSite`), so several canvases share one site, each under its path.
//
// A site Seismic set up at a host (Cloudflare Pages, GitHub Pages) names it and its project there; one
// entered by hand names its deploy line. On Cloudflare Pages or from a private GitHub repository a
// site is unlisted (site.ts): no overview, no feed, each page under a random part of its URL drawn
// once per card, the manifest under a secret directory only the owner's machines know. Another
// machine joins a site with a connection code, which carries the site and its credentials.
//
// The owner's personal site, kept in `personal-site.json` before, is read as the first of the list
// and goes into the file with its next change.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { DemoSite, DemoSiteEntry } from '../core/types';
import { GITHUB_PAGES, GITHUB_PAGES_MAX } from './site-hosts';
import { parseEnv, SITES_DIR, siteKey } from './site';

export const SITES_FILE = 'demo-sites.json';
/** Where the owner's personal site was kept before the list. */
const PERSONAL_FILE = 'personal-site.json';

/** Where a site is hosted, where Seismic set it up. */
export type SiteHost = 'cloudflare' | 'github';

/** A site's address: an http(s) URL without a query, its path made of plain characters. */
export const SITE_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/;

const entryShape = z
  .object({
    url: z.string().regex(SITE_URL),
    deploy: z.string().trim().min(1),
    // under Seismic's home: the file's values go to the site
    env: z
      .string()
      .min(1)
      .refine((f) => !/^([\\/~]|[A-Za-z]:)/.test(f) && !f.split(/[\\/]/).includes('..'), 'a path relative to Seismic’s home, without ..')
      .optional(),
    headers: z.record(z.string(), z.string()).optional(),
    maxFile: z.number().int().positive().optional(),
    host: z.enum(['cloudflare', 'github']).optional(),
    /** The host's project: a Cloudflare Pages project's name, or the GitHub repository (`owner/name`). */
    project: z.string().regex(/^[A-Za-z0-9-]+(\/[A-Za-z0-9._-]+)?$/).optional(),
    secret: z.string().regex(/^[a-z0-9]{16,64}$/).optional(),
  })
  .strict();

const fileShape = z.object({ sites: z.array(entryShape) }).strict();

/** The personal site as `personal-site.json` kept it. */
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

/** The deploy line of a Cloudflare Pages project, as Seismic's own site has it. */
export const cloudflareDeploy = (project: string) => `bunx wrangler@4 pages deploy {dir} --project-name ${project} --branch main --commit-dirty=true`;

/** The list as last read, by its file: read again once it changed (sharing asks for it often). */
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
  // the personal site is in the list now
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

/** A site of the list as a canvas shares on it: the title its overview and pages carry, and what the canvas adds. */
export function demoSite(entry: DemoSiteEntry, title: string, extra: Pick<DemoSite, 'publish' | 'tags'> = {}): DemoSite {
  return {
    title,
    url: entry.url,
    deploy: entry.deploy,
    ...(entry.env ? { env: entry.env } : {}),
    ...(entry.headers ? { headers: entry.headers } : {}),
    ...(entry.maxFile ? { maxFile: entry.maxFile } : {}),
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
  // drawn without a bias: bytes past the last whole round of 36 are thrown away
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

const CODE_PREFIX = 'obeya-site:';

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
  if (!text.startsWith(CODE_PREFIX)) throw new Error('not a connection code of a demo site');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(text.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('the connection code is incomplete; copy it again');
  }
  const { credentials, private: _, approved: __, ...rest } = raw as { credentials?: Record<string, unknown>; private?: unknown; approved?: unknown; deploy?: unknown };
  // a personal site's code from before names its host and project, not its deploy line
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
