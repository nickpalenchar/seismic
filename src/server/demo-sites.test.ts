import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MESSAGES } from '../core/messages';
import { Board } from './board';
import { Store } from './store';
import { connect, connectionCode, findSite, newToken, readSites, SITES_FILE, writeSites } from './demo-sites';
import type { DemoSiteEntry } from '../core/types';
import type { SharePage, ShareSource } from './share';
import { Sharing } from './share';
import { MANIFEST, siteKey, siteTarget } from './site';
import { cloudflareAccounts, type Exec, exec, githubPagesDeploy, setupCloudflare, setupGithub, SetupRefused } from './site-hosts';
import { SiteSetup } from './site-setup';
import { FakeRuntime, noForge } from './testing';

let dir: string;
let home: string;
let repo: string;
let demo: string;

// the deploy line's stand-in: copies the site's directory to `deployed/`, the host's snapshot
const DEPLOY = `
const { cpSync, rmSync } = require('node:fs');
const [site, out] = process.argv.slice(2);
rmSync(out + '/deployed', { recursive: true, force: true });
cpSync(site, out + '/deployed', { recursive: true });
`;

// the host: serves what was deployed last, `404.html` for what it lacks (as Cloudflare and GitHub Pages do)
const server = Bun.serve({
  port: 0,
  fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(dir, 'deployed', path);
    if (!path.includes('..') && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
    const missing = join(dir, 'deployed', '404.html');
    return new Response(existsSync(missing) ? Bun.file(missing) : 'not found', { status: 404 });
  },
});
afterAll(() => server.stop(true));
const URL_ = `http://localhost:${server.port}/`;

const SECRET = 's3cr3tdirectory000000000';
/** A site of the list, unlisted, deploying with the stand-in in place of wrangler. */
const entry = (extra: Partial<DemoSiteEntry> = {}): DemoSiteEntry => ({ url: URL_.replace(/\/$/, ''), deploy: `deploy.ts {dir} ${dir}`, host: 'cloudflare', project: 'obeya-ada', secret: SECRET, ...extra });
/** The unlisted site as a target. */
const unlisted = (at = home, machine = 'a') =>
  siteTarget({ title: 'Demos', url: URL_, deploy: `deploy.ts {dir} ${dir}` }, repo, at, MESSAGES.en.share, { machine, checkWaits: [0, 10, 10], by: 'Ada Lovelace', unlisted: { secret: SECRET } });
const siteDir = (at = home) => join(at, 'sites', siteKey(URL_), 'site');
const deployed = () => join(dir, 'deployed');
const page = (slug: string, extra: Partial<SharePage> = {}): SharePage => ({ slug, title: `Title ${slug}`, text: 'One sentence.', kind: 'video', chapters: [[0, 'Before']], pr: null, language: 'en', dir: demo, shared: [], ...extra });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-personal-'));
  home = join(dir, 'home');
  repo = join(dir, 'repo');
  mkdirSync(repo);
  mkdirSync(home);
  writeFileSync(join(repo, 'deploy.ts'), DEPLOY);
  demo = join(dir, 'demo');
  mkdirSync(demo);
  writeFileSync(join(demo, 'demo.mp4'), 'video');
  writeFileSync(join(demo, 'captions.vtt'), 'WEBVTT\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const A = 'k7f3q9w2m4xa8b1c';
const B = 'z9y8x7w6v5u4t3s2';

describe('an unlisted site', () => {
  test('gives away no list of its pages: not at its root, its 404 page, a manifest at the root, or a feed', async () => {
    expect(await unlisted().publish(page(`${A}/sync-button`))).toMatchObject({ url: `${URL_}${A}/sync-button/` });
    expect(await unlisted().publish(page(`${B}/csv-export`, { shared: [`${A}/sync-button`] }))).toMatchObject({ url: `${URL_}${B}/csv-export/` });
    const files = readdirSync(deployed()).sort();
    expect(files).toEqual(['404.html', '_headers', A, B, 's3cr3tdirectory000000000', 'index.html'].sort());
    for (const f of ['index.html', '404.html', '_headers']) {
      const text = readFileSync(join(deployed(), f), 'utf8');
      for (const leak of [A, B, 'sync-button', 'csv-export', 'Title', 's3cr3t']) expect(text).not.toContain(leak);
    }
    // the host's answers: nothing at the root, nothing one level up from a page, no manifest or feed where a listed site has them
    const get = async (path: string) => {
      const r = await fetch(`${URL_}${path}`);
      return { status: r.status, text: await r.text() };
    };
    for (const path of ['', `${A}/`, MANIFEST, 'feed.xml', 'nothing/']) {
      const r = await get(path);
      for (const leak of [A, B, 'sync-button', 'csv-export']) expect(r.text).not.toContain(leak);
      if (path) expect(r.status).toBe(404);
    }
    // the manifest only under the secret directory, the pages in it by their whole place
    const m = JSON.parse((await get(`s3cr3tdirectory000000000/${MANIFEST}`)).text) as { pages: Record<string, unknown> };
    expect(Object.keys(m.pages).sort()).toEqual([`${A}/sync-button`, `${B}/csv-export`]);
  });

  test('its pages keep search engines out, send no referrer, and link no overview or tags', async () => {
    await unlisted().publish(page(`${A}/sync-button`, { tags: { Area: ['Billing'] } }));
    const html = readFileSync(join(siteDir(), A, 'sync-button/index.html'), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).not.toContain('href="../');
    expect(html).not.toContain('All demos');
    expect(html).not.toContain('class="tags"');
    expect(html).not.toContain(' · Demos</title>');
    // the credit line stays, and goes without a referrer
    expect(html).toContain('href="https://obeya.si"');
    const headers = readFileSync(join(siteDir(), '_headers'), 'utf8');
    expect(headers).toContain('/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: no-referrer\n');
    expect(headers).toContain('/:token/:slug/artifact/*');
  });

  test('refuses a place that is not one', async () => {
    expect(await unlisted().publish(page('../sync-button'))).toMatchObject({ why: expect.stringContaining('not a slug') });
    expect(await unlisted().publish(page('Sync Button'))).toMatchObject({ why: expect.stringContaining('not a slug') });
  });

  test('a second machine connected with the code pulls the pages under the secret path, and keeps them when it publishes', async () => {
    await unlisted().publish(page(`${A}/sync-button`));
    writeSites(home, [entry({ env: 'sites/p/cloudflare.env' })]);
    mkdirSync(join(home, 'sites/p'), { recursive: true });
    writeFileSync(join(home, 'sites/p/cloudflare.env'), 'CLOUDFLARE_API_TOKEN=t0k\nCLOUDFLARE_ACCOUNT_ID=acc\n');
    const code = connectionCode(home, readSites(home)[0]!);
    const other = join(dir, 'other');
    const joined = connect(other, code);
    expect(joined.credentials).toBe(true);
    expect(readSites(other)[0]).toMatchObject({ host: 'cloudflare', url: entry().url, secret: SECRET, deploy: entry().deploy });
    expect(readFileSync(join(other, readSites(other)[0]!.env!), 'utf8')).toContain('CLOUDFLARE_API_TOKEN=t0k');
    expect(await unlisted(other, 'b').publish(page(`${B}/csv-export`))).toMatchObject({ url: `${URL_}${B}/csv-export/` });
    expect(existsSync(join(deployed(), A, 'sync-button/demo.mp4'))).toBe(true);
    expect(existsSync(join(deployed(), B, 'csv-export/demo.mp4'))).toBe(true);
    expect(() => connect(other, 'something else')).toThrow('not a connection code');
  });
});

test('the random part of an address carries at least 80 bits', () => {
  const t = newToken();
  expect(t).toMatch(/^[a-z0-9]{16,}$/);
  expect(t.length * Math.log2(36)).toBeGreaterThanOrEqual(80);
  expect(new Set(Array.from({ length: 50 }, () => newToken())).size).toBe(50);
});

describe("sharing on the project's site", () => {
  let board: Board;
  let source: ShareSource;
  let sharing: Sharing;
  /** The project's site from the list, under a path. */
  const projectSite = (e: DemoSiteEntry, path = 'shop', extra: { publish?: 'approved' } = {}): ShareSource => ({ site: { site: { title: 'Shop', url: e.url, deploy: e.deploy, ...extra }, path, ...(e.secret ? { secret: e.secret } : {}) }, repo, title: 'Shop' });
  beforeEach(() => {
    board = new Board(new Store(':memory:'), { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: repo, branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    writeSites(home, [entry()]);
    source = projectSite(entry());
    sharing = new Sharing({ board, runtime: new FakeRuntime(), home, forge: noForge, sourceFor: () => source });
  });
  const card = () => {
    const c = board.create({ title: 'Sync button', x: 0, y: 0 });
    board.work(c.id, { state: 'live', demo: JSON.stringify({ kind: 'video', dir: demo, chapters: [[0, 'Before']], page: { title: 'Sync button', text: 'A sentence.' } }) });
    return c.id;
  };
  const settled = async (id: string, state: string | undefined) => {
    for (let i = 0; i < 300 && board.item(id)!.share?.state !== state; i++) await Bun.sleep(10);
    return board.item(id)!.share;
  };

  test('an unlisted site: under the path, a random part drawn once for the card', async () => {
    const id = card();
    sharing.share(id);
    const first = await settled(id, 'shared');
    expect(first?.url).toMatch(new RegExp(`^${URL_}shop/[a-z0-9]{16,}/sync-button-[0-9a-z]+/$`));
    expect(first!.unlisted).toBe(true);
    sharing.unshare(id);
    await settled(id, undefined);
    expect(existsSync(join(deployed(), first!.url!.slice(URL_.length)))).toBe(false);
    sharing.share(id);
    // shared again, the same link
    expect((await settled(id, 'shared'))?.url).toBe(first!.url!);
  });

  test('a listed site: no random part, an overview of the path listing the page, none at the root', async () => {
    const { secret: _, ...listed } = entry({ host: 'github', project: 'ada/obeya-demos' });
    writeSites(home, [listed]);
    source = projectSite(listed, 'team/shop');
    const id = card();
    sharing.share(id);
    const url = (await settled(id, 'shared'))!.url!;
    expect(url).toMatch(new RegExp(`^${URL_}team/shop/sync-button-[0-9a-z]+/$`));
    expect(board.item(id)!.share!.unlisted).toBeUndefined();
    expect(readFileSync(join(deployed(), 'team/shop/index.html'), 'utf8')).toContain('Sync button');
    expect(readFileSync(join(deployed(), 'index.html'), 'utf8')).not.toContain('Sync button');
    expect(existsSync(join(deployed(), MANIFEST))).toBe(true);
  });

  test("a page stays where it went out: on the site and path it has, once the project chose another", async () => {
    const id = card();
    sharing.share(id);
    const url = (await settled(id, 'shared'))!.url!;
    source = projectSite(entry(), 'elsewhere');
    sharing.unshare(id);
    await settled(id, undefined);
    expect(existsSync(join(deployed(), url.slice(URL_.length), 'demo.mp4'))).toBe(false);
  });

  test('a page on a site this machine no longer has is left alone', async () => {
    const id = card();
    sharing.share(id);
    await settled(id, 'shared');
    writeSites(home, []);
    source = { site: null, repo, title: 'Shop' };
    expect(() => sharing.unshare(id)).not.toThrow();
    await settled(id, 'shared');
    expect(board.events(id).some((e) => e.kind === 'error')).toBe(true);
  });

  test("approving shares there where the project's site publishes on approval, unless the card opts out", async () => {
    const id = card();
    expect(sharing.approved(id)).toBeNull();
    expect(board.item(id)!.share).toBeUndefined();
    source = projectSite(entry(), 'shop', { publish: 'approved' });
    expect(sharing.approved(id)).toStartWith(`Demo-Video: ${URL_}shop/`);
    expect((await settled(id, 'shared'))?.url).toStartWith(URL_);
    const other = card();
    sharing.onApproval(other, false);
    expect(sharing.approved(other)).toBeNull();
    expect(board.item(other)!.share?.url).toBeUndefined();
  });
});

describe("this machine's list of demo sites", () => {
  test('takes the personal site kept before as its first site, into its own file with the next change', () => {
    writeFileSync(join(home, 'personal-site.json'), JSON.stringify({ host: 'github', url: 'https://ada.github.io/obeya-demos/', project: 'ada/obeya-demos', secret: SECRET, private: ['/x'] }));
    expect(readSites(home)).toEqual([{ url: 'https://ada.github.io/obeya-demos', deploy: 'obeya:github-pages ada/obeya-demos', host: 'github', project: 'ada/obeya-demos', secret: SECRET, maxFile: 100 * 1024 * 1024 }]);
    writeSites(home, [...readSites(home), { url: 'https://demos.example.dev', deploy: 'true' }]);
    expect(existsSync(join(home, 'personal-site.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(home, SITES_FILE), 'utf8')).sites).toHaveLength(2);
    expect(findSite(home, 'https://demos.example.dev/')?.deploy).toBe('true');
  });

  test("a personal site's connection code from before adds it to the list", () => {
    const old = 'obeya-site:' + Buffer.from(JSON.stringify({ host: 'cloudflare', url: 'https://obeya-ada.pages.dev', project: 'obeya-ada', secret: SECRET, credentials: { CLOUDFLARE_API_TOKEN: 't' } })).toString('base64url');
    expect(connect(home, old).site).toMatchObject({ url: 'https://obeya-ada.pages.dev', deploy: expect.stringContaining('--project-name obeya-ada'), secret: SECRET, env: expect.stringMatching(/cloudflare\.env$/) });
    expect(() => connect(home, 'something else')).toThrow('not a connection code');
  });

  test('a site entered by hand goes on the list once a publish there went through, else with the reason', async () => {
    let check: string | null = 'HTTP 403';
    let changed = 0;
    const setup = new SiteSetup({ home, changed: () => changed++, check: async () => check });
    const manual = { url: 'https://demos.example.dev/', deploy: 'true {dir}' };
    expect(() => setup.add({ manual: { ...manual, url: 'demos' } })).toThrow();
    expect(() => setup.add({ manual: { ...manual, deploy: 'no-such-deploy-anywhere {dir}' } })).toThrow('not on the PATH');
    setup.add({ manual });
    for (let i = 0; i < 100 && setup.view().job?.running; i++) await Bun.sleep(5);
    expect(setup.view()).toMatchObject({ sites: [], job: { running: false, error: expect.stringContaining('HTTP 403') } });
    check = null;
    setup.add({ manual });
    for (let i = 0; i < 100 && setup.view().job?.running; i++) await Bun.sleep(5);
    expect(setup.view().sites).toEqual([{ url: 'https://demos.example.dev', deploy: 'true {dir}', listed: true, paths: [] }]);
    expect(setup.view().job).toMatchObject({ site: 'https://demos.example.dev' });
    expect(changed).toBe(1);
    setup.seen();
    expect(setup.view().job).toBeUndefined();
    expect(setup.code('https://demos.example.dev').code).toStartWith('obeya-site:');
    setup.remove({ url: 'https://demos.example.dev' });
    expect(readSites(home)).toEqual([]);
  });

  test('publishing to a site to add it takes over what is on it and deploys it again', async () => {
    const setup = new SiteSetup({ home, changed: () => {} });
    // a page another machine has there
    await unlisted(join(dir, 'other'), 'b').publish(page(`${A}/sync-button`));
    setup.add({ manual: { url: entry().url, deploy: `${join(repo, 'deploy.ts')} {dir} ${dir}` } });
    for (let i = 0; i < 300 && setup.view().job?.running; i++) await Bun.sleep(10);
    expect(setup.view().job?.error).toBeUndefined();
    expect(setup.view().sites).toHaveLength(1);
  });
});

describe('setting up at GitHub', () => {
  /** gh's answers by the start of its arguments; every call recorded. */
  let calls: string[][];
  let answers: [string, { code: number; out: string; err?: string }][];
  const x: Exec = async (argv) => {
    calls.push(argv);
    if (argv[0] === 'git') return { code: 0, out: '', err: '' };
    const line = argv.slice(1).join(' ');
    const a = answers.find(([start]) => line.startsWith(start))?.[1] ?? { code: 0, out: '' };
    return { code: a.code, out: a.out, err: a.err ?? '' };
  };
  beforeEach(() => {
    calls = [];
    answers = [
      ['api user', { code: 0, out: JSON.stringify({ login: 'ada', plan: { name: 'pro' } }) }],
      ['api repos/ada/obeya-demos', { code: 1, out: '', err: 'Not Found (HTTP 404)' }],
      ['repo view', { code: 0, out: 'PRIVATE\n' }],
      ['auth token', { code: 0, out: 'gho_secret\n' }],
      ['api -X POST repos/ada/obeya-demos/pages', { code: 0, out: JSON.stringify({ html_url: 'https://ada.github.io/obeya-demos/' }) }],
    ];
  });
  const gh = () => calls.filter((c) => c[0] === 'gh').map((c) => c.slice(1).join(' '));

  test('an unlisted site lives in a private repository, created as private and checked to be', async () => {
    const r = await setupGithub({ name: 'obeya-demos', private: true, log: () => {}, x, wait: [] });
    expect(r).toEqual({ url: 'https://ada.github.io/obeya-demos/', project: 'ada/obeya-demos' });
    const create = calls.find((c) => c[1] === 'repo' && c[2] === 'create')!;
    expect(create).toContain('--private');
    expect(calls.flat()).not.toContain('--public');
    expect(gh()).toContain('repo view ada/obeya-demos --json visibility --jq .visibility');
  });

  test('a free account is refused before anything is created, with Cloudflare offered', async () => {
    answers[0] = ['api user', { code: 0, out: JSON.stringify({ login: 'ada', plan: { name: 'free' } }) }];
    const r = setupGithub({ name: 'obeya-demos', private: true, log: () => {}, x, wait: [] });
    await expect(r).rejects.toBeInstanceOf(SetupRefused);
    await expect(r).rejects.toMatchObject({ offer: 'cloudflare', message: expect.stringContaining('GitHub Pro') });
    expect(gh().some((c) => c.startsWith('repo create'))).toBe(false);
  });

  test('Pages refused for the private repository: the reason, and Cloudflare offered', async () => {
    answers[4] = ['api -X POST', { code: 1, out: '', err: 'gh: Your current plan does not support GitHub Pages for this repository. (HTTP 422)' }];
    answers[0] = ['api user', { code: 0, out: JSON.stringify({ login: 'ada' }) }];
    await expect(setupGithub({ name: 'obeya-demos', private: true, log: () => {}, x, wait: [] })).rejects.toMatchObject({ offer: 'cloudflare', message: expect.stringContaining('does not support GitHub Pages') });
  });

  test('a repository GitHub did not make private is not used', async () => {
    answers[2] = ['repo view', { code: 0, out: 'PUBLIC\n' }];
    await expect(setupGithub({ name: 'obeya-demos', private: true, log: () => {}, x, wait: [] })).rejects.toThrow('not private');
    expect(calls.some((c) => c[0] === 'git')).toBe(false);
  });

  test('a name taken gets a number, and is never reused', async () => {
    answers.splice(1, 1, ['api repos/ada/obeya-demos-2', { code: 1, out: '' }], ['api repos/ada/obeya-demos', { code: 0, out: '{}' }]);
    answers.push(['api -X POST repos/ada/obeya-demos-2/pages', { code: 0, out: JSON.stringify({ html_url: 'https://ada.github.io/obeya-demos-2/' }) }]);
    expect((await setupGithub({ name: 'obeya-demos', private: true, log: () => {}, x, wait: [] })).project).toBe('ada/obeya-demos-2');
  });

  test('a public repository, as chosen: any account, no check of the plan, a listed site', async () => {
    answers[0] = ['api user', { code: 0, out: JSON.stringify({ login: 'ada', plan: { name: 'free' } }) }];
    const setup = new SiteSetup({ home, changed: () => {}, x, wait: [], check: async () => null });
    setup.add({ host: 'github', public: true });
    for (let i = 0; i < 100 && setup.view().job?.running; i++) await Bun.sleep(5);
    expect(setup.view().sites[0]).toMatchObject({ host: 'github', listed: true });
    expect(calls.find((c) => c[2] === 'create')).toContain('--public');
    expect(readSites(home)[0]!.secret).toBeUndefined();
  });

  test('a site at GitHub without the public choice is private, and unlisted', async () => {
    const setup = new SiteSetup({ home, changed: () => {}, x, wait: [], check: async () => null });
    setup.add({ host: 'github' });
    for (let i = 0; i < 100 && setup.view().job?.running; i++) await Bun.sleep(5);
    expect(setup.view().sites[0]).toMatchObject({ host: 'github', url: 'https://ada.github.io/obeya-demos', listed: false });
    expect(calls.find((c) => c[2] === 'create')).toContain('--private');
    expect(readSites(home)[0]!.secret).toMatch(/^[a-z0-9]{25,}$/);
  });
});

test('the deploy of an unlisted site to GitHub Pages refuses a repository that is not private', async () => {
  const calls: string[][] = [];
  const x: Exec = async (argv) => {
    calls.push(argv);
    return argv.includes('view') ? { code: 0, out: 'PUBLIC\n', err: '' } : { code: 0, out: 'tok\n', err: '' };
  };
  await expect(githubPagesDeploy(join(dir, 'site'), 'ada/obeya-demos', join(dir, 'git'), x, { private: true })).rejects.toThrow('not private');
  expect(calls.some((c) => c[0] === 'git')).toBe(false);
});

test('the deploy to GitHub Pages pushes one commit without history, with gh’s token kept off the command line', async () => {
  const site = join(dir, 'site');
  mkdirSync(join(site, 'a/b'), { recursive: true });
  writeFileSync(join(site, 'index.html'), 'root');
  writeFileSync(join(site, 'a/b/demo.mp4'), 'video');
  // a machine's own git configuration that would leave files out: none of it applies
  writeFileSync(join(dir, 'ignore'), '*.mp4\n');
  const pushes: { argv: string[]; env: Record<string, string | undefined> }[] = [];
  const x: Exec = async (argv, o) => {
    if (argv[0] === 'gh') return { code: 0, out: 'gho_secret\n', err: '' };
    if (argv.includes('push')) {
      pushes.push({ argv, env: o?.env ?? {} });
      // what the commit holds
      const gitDir = argv.find((a) => a.startsWith('--git-dir='))!.slice('--git-dir='.length);
      const ls = await exec(['git', `--git-dir=${gitDir}`, 'ls-tree', '-r', '--name-only', 'HEAD']);
      const count = await exec(['git', `--git-dir=${gitDir}`, 'rev-list', '--count', 'HEAD']);
      return { code: 0, out: `${ls.out}commits ${count.out}`, err: '' };
    }
    return exec(argv, { ...o, env: { ...o?.env, GIT_CONFIG_GLOBAL: join(dir, 'gitconfig') } });
  };
  writeFileSync(join(dir, 'gitconfig'), `[core]\n\texcludesFile = ${join(dir, 'ignore')}\n[commit]\n\tgpgsign = true\n`);
  const said = await githubPagesDeploy(site, 'ada/obeya-demos', join(dir, 'git'), x);
  expect(said).toContain('a/b/demo.mp4');
  expect(said).toContain('.nojekyll');
  expect(said).toContain('commits 1');
  const [push] = pushes;
  expect(push!.argv.slice(-4)).toEqual(['--force', '--no-verify', 'https://github.com/ada/obeya-demos.git', 'HEAD:main']);
  expect(push!.argv.join(' ')).not.toContain('gho_secret');
  expect(push!.env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${Buffer.from('x-access-token:gho_secret').toString('base64')}`);
  // its repository is made afresh each time and goes afterwards
  expect(existsSync(join(dir, 'git'))).toBe(false);
  await expect(githubPagesDeploy(site, 'not a repository', join(dir, 'git'), x)).rejects.toThrow('expected <owner>/<repository>');
});

describe('setting up at Cloudflare', () => {
  let calls: string[][];
  // where wrangler ran: an empty directory, never the server's own (a command wrangler hands on to Workers uploads it)
  let cwds: string[];
  const x =
    (answer: (args: string) => { code: number; out: string }): Exec =>
    async (argv, o) => {
      calls.push(argv);
      cwds.push(o?.cwd ?? process.cwd());
      if (!argv.includes('deploy')) expect(readdirSync(o!.cwd!)).toEqual([]);
      return { ...answer(argv.slice(3).join(' ')), err: '' };
    };
  beforeEach(() => {
    calls = [];
    cwds = [];
  });
  afterEach(() => {
    expect(cwds.length).toBeGreaterThan(0);
    for (const c of cwds) {
      expect(c).not.toBe(process.cwd());
      expect(existsSync(c)).toBe(false);
    }
  });

  test('takes the account of a site this machine deploys to, as chosen, and a suffix where the name is taken', async () => {
    mkdirSync(join(home, 'sites/demos.example.dev'), { recursive: true });
    writeFileSync(join(home, 'sites/demos.example.dev/cloudflare.env'), 'CLOUDFLARE_API_TOKEN=tok\nCLOUDFLARE_ACCOUNT_ID=acc\n');
    // another site of the same account, and one of another
    mkdirSync(join(home, 'sites/more.example.dev'), { recursive: true });
    writeFileSync(join(home, 'sites/more.example.dev/cloudflare.env'), 'CLOUDFLARE_API_TOKEN=tok2\nCLOUDFLARE_ACCOUNT_ID=acc\n');
    mkdirSync(join(home, 'sites/work.example.dev'), { recursive: true });
    writeFileSync(join(home, 'sites/work.example.dev/cloudflare.env'), 'export CLOUDFLARE_API_TOKEN="w"\nCLOUDFLARE_ACCOUNT_ID=work\n');
    expect(cloudflareAccounts(home).map((a) => a.site)).toEqual(['demos.example.dev', 'work.example.dev']);
    let first = true;
    const r = await setupCloudflare({
      home,
      name: 'obeya-ada',
      account: 'demos.example.dev',
      wait: [],
      log: () => {},
      x: x((args) => {
        if (args.startsWith('pages project create') && first) {
          first = false;
          return { code: 1, out: 'A project with this name already exists. [code: 8000002]' };
        }
        return { code: 0, out: "✨ Successfully created the 'obeya-ada-x1y2' project. It will be available at https://obeya-ada-x1y2.pages.dev/ once you create your first deployment." };
      }),
    });
    expect(r).toMatchObject({ url: 'https://obeya-ada-x1y2.pages.dev', env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' } });
    expect(r.project).toMatch(/^obeya-ada-[a-z0-9]{1,4}$/);
    expect(calls.some((c) => c.includes('login'))).toBe(false);
  });

  test('another account by its API token: no login, the token for the new site', async () => {
    const r = await setupCloudflare({ home, name: 'obeya-ada', token: { CLOUDFLARE_API_TOKEN: 'another-token-0123456789' }, log: () => {}, wait: [], x: x(() => ({ code: 0, out: 'created https://obeya-ada.pages.dev/' })) });
    expect(calls.some((c) => c.includes('login') || c.includes('whoami'))).toBe(false);
    expect(r.env).toEqual({ CLOUDFLARE_API_TOKEN: 'another-token-0123456789' });
  });

  test('without one, logs in through the browser with wrangler', async () => {
    const r = await setupCloudflare({ home, name: 'obeya-ada', log: () => {}, wait: [], x: x((args) => (args === 'whoami' ? { code: 0, out: 'You are not authenticated. Please run `wrangler login`.' } : { code: 0, out: 'created https://obeya-ada.pages.dev/' })) });
    expect(calls.map((c) => c.slice(3, 7).join(' '))).toEqual(['whoami', 'login', 'pages project create obeya-ada', 'pages deploy ' + calls[3]![5] + ' --project-name']);
    expect(calls[2]).toContain('--force');
    expect(r).toEqual({ url: 'https://obeya-ada.pages.dev', project: 'obeya-ada' });
  });
});
