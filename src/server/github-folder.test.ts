import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DemoSite } from '../adapters/types';
import { MESSAGES } from '../core/messages';
import { folderAddress, listRepos, pushCheck, repoView } from './github-folder';
import type { SharePage } from './share';
import { siteTarget } from './site';
import { SiteSetup } from './site-setup';
import { type Exec, exec } from './site-hosts';

// the folder's tests run real git: a busy machine takes seconds for them
setDefaultTimeout(60_000);

describe('where a folder is served', () => {
  const pages = (path: string, branch = 'main') => ({ url: 'https://ada.github.io/docs', branch, path, workflow: false });

  test('under the address Pages has, relative to the folder it serves from', () => {
    expect(folderAddress('ada/docs', 'main', pages('/'), 'docs/demos')).toEqual({ address: 'https://ada.github.io/docs/docs/demos' });
    expect(folderAddress('ada/docs', 'main', pages('/docs'), 'docs/demos')).toEqual({ address: 'https://ada.github.io/docs/demos' });
  });

  test('a folder outside what Pages serves says why', () => {
    expect(folderAddress('ada/docs', 'main', pages('/docs'), 'demos')).toMatchObject({ address: null, outside: expect.stringContaining('/docs') });
    expect(folderAddress('ada/docs', 'main', pages('/', 'gh-pages'), 'demos')).toMatchObject({ address: null, outside: expect.stringContaining('gh-pages') });
    expect(folderAddress('ada/docs', 'main', pages('/docs'), 'docs').address).toBeNull();
  });

  test('with Pages off, the address GitHub will give it; built by a workflow, the folder as it lies', () => {
    expect(folderAddress('Ada/notes', 'main', null, 'demos')).toEqual({ address: 'https://ada.github.io/notes/demos' });
    expect(folderAddress('ada/ada.github.io', 'main', null, 'demos')).toEqual({ address: 'https://ada.github.io/demos' });
    expect(folderAddress('ada/docs', 'main', { ...pages('/docs'), workflow: true }, 'site/demos')).toEqual({ address: 'https://ada.github.io/docs/site/demos' });
  });
});

/** The path a gh api call reads, without its query. */
const pathOf = (argv: string[]) => (argv.find((a) => a.startsWith('repos/')) ?? '').replace(/\?.*/, '');

describe('the push check', () => {
  const gh =
    (answers: Record<string, unknown>): Exec =>
    async (argv) => {
      const path = pathOf(argv);
      if (!(path in answers)) return { code: 1, out: '', err: 'gh: Not Found (HTTP 404)' };
      return { code: 0, out: JSON.stringify(argv.includes('--slurp') ? [answers[path]] : answers[path]), err: '' };
    };

  test('a ruleset that requires a pull request blocks, and links that ruleset', async () => {
    const x = gh({ 'repos/acme/docs/rules/branches/main': [{ type: 'deletion', ruleset_id: 3 }, { type: 'pull_request', ruleset_id: 42 }] });
    expect(await pushCheck(x, 'acme/docs', 'main', { push: true, admin: true })).toEqual({ allowed: false, admin: true, settings: 'https://github.com/acme/docs/settings/rules/42' });
  });

  test('classic protection blocks where it holds for the login, and links the branch settings', async () => {
    const protectedBranch = { 'repos/acme/docs/rules/branches/main': [], 'repos/acme/docs/branches/main': { protected: true } };
    // not an admin: the protection cannot be read, so it counts
    expect(await pushCheck(gh(protectedBranch), 'acme/docs', 'main', { push: true, admin: false })).toEqual({ allowed: false, admin: false, settings: 'https://github.com/acme/docs/settings/branches' });
    // an admin passes it unless it includes administrators
    const reviews = { required_pull_request_reviews: {}, enforce_admins: { enabled: false } };
    expect((await pushCheck(gh({ ...protectedBranch, 'repos/acme/docs/branches/main/protection': reviews }), 'acme/docs', 'main', { push: true, admin: true })).allowed).toBe(true);
    const strict = { ...reviews, enforce_admins: { enabled: true } };
    expect((await pushCheck(gh({ ...protectedBranch, 'repos/acme/docs/branches/main/protection': strict }), 'acme/docs', 'main', { push: true, admin: true })).allowed).toBe(false);
  });

  test('failed and malformed rule or branch reads never authorize direct publishing', async () => {
    for (const answers of [{}, { 'repos/acme/docs/rules/branches/main': [] }, { 'repos/acme/docs/rules/branches/main': {} }, { 'repos/acme/docs/rules/branches/main': [], 'repos/acme/docs/branches/main': {} }]) {
      await expect(pushCheck(gh(answers), 'acme/docs', 'main', { push: true, admin: true })).rejects.toThrow();
    }
  });

  test('timeouts and permission errors on either rules or branch reads fail closed', async () => {
    for (const path of ['rules/branches/main', 'branches/main']) {
      for (const error of ['HTTP 403', 'HTTP 500', 'request timed out']) {
        const x: Exec = async (args) => pathOf(args) === `repos/acme/docs/${path}`
          ? { code: 1, out: '', err: error }
          : { code: 0, out: '[]', err: '' };
        await expect(pushCheck(x, 'acme/docs', 'main', { push: true, admin: true })).rejects.toThrow(error);
      }
    }
  });

  test('repository pages are parsed as complete pretty-printed JSON', async () => {
    const row = (name: string, push = true) => ({ full_name: name, owner: { login: name.split('/')[0] }, private: false, permissions: { push } });
    const x: Exec = async (args) => ({ code: 0, err: '', out: JSON.stringify(args.includes('user') ? { login: 'ada' } : [[row('org/docs'), row('org/hidden', false)], [row('ada/site')]], null, 2) });
    expect((await listRepos(x)).repos.map((r) => r.repo)).toEqual(['ada/site', 'org/docs']);
  });

  test('a blocking rule on a later page of the branch’s rules blocks too', async () => {
    const x: Exec = async (argv) =>
      pathOf(argv) === 'repos/acme/docs/rules/branches/main'
        ? { code: 0, out: JSON.stringify(argv.includes('--paginate') ? [[{ type: 'deletion' }], [{ type: 'pull_request', ruleset_id: 5 }]] : [{ type: 'deletion' }]), err: '' }
        : { code: 0, out: JSON.stringify({ protected: false }), err: '' };
    expect(await pushCheck(x, 'acme/docs', 'main', { push: true, admin: false })).toEqual({ allowed: false, admin: false, settings: 'https://github.com/acme/docs/settings/rules/5' });
  });

  test('an open branch and push rights: allowed', async () => {
    expect(await pushCheck(gh({ 'repos/acme/docs/rules/branches/main': [], 'repos/acme/docs/branches/main': { protected: false } }), 'acme/docs', 'main', { push: true, admin: false })).toEqual({ allowed: true, admin: false });
  });

  test('a repository read for a folder: its branch, Pages, the address, the check and its size', async () => {
    const x = gh({
      'repos/acme/docs/rules/branches/trunk': [],
      'repos/acme/docs/branches/trunk': { protected: false },
      'repos/acme/docs': { private: false, default_branch: 'trunk', size: 2048, permissions: { push: true, admin: false } },
      'repos/acme/docs/pages': { html_url: 'https://acme.github.io/docs/', build_type: 'legacy', source: { branch: 'trunk', path: '/' } },
    });
    expect(await repoView('acme/docs', 'docs/demos', x)).toEqual({
      repo: 'acme/docs',
      private: false,
      branch: 'trunk',
      size: 2048 * 1024,
      pages: { url: 'https://acme.github.io/docs', branch: 'trunk', path: '/', workflow: false },
      address: 'https://acme.github.io/docs/docs/demos',
      push: { allowed: true, admin: false },
    });
  });
});

describe('a site in a folder of an existing repository', () => {
  let dir: string;
  let remote: string;
  let demo: string;
  /** What gh is asked, and the pull requests it says are open. */
  let gh: string[][];
  let open: { url: string; number: number; mergeable?: string; body?: string; headRefOid?: string; base?: string }[];
  /** The repository's default branch and its Pages as GitHub says now (null: off). */
  let defaultBranch: string;
  let pages: { source: { branch: string; path: string } } | null | 'default';
  let state: string;
  let failCreate: boolean;
  let failEdit: boolean;
  /** The pull requests GitHub has besides the open one, newest first. */
  let history: { headRefOid: string; state: string }[];
  let failRollback: boolean;
  /** Runs once right before the next push: another machine's commit coming in between. */
  let beforePush: (() => Promise<void>) | null;
  const x: Exec = async (argv, o) => {
    if (argv[0] === 'gh') {
      gh.push(argv.slice(1));
      const line = argv.slice(1).join(' ');
      if (line === 'auth token') return { code: 0, out: 'gho_secret\n', err: '' };
      if (line === 'api repos/acme/docs') return { code: 0, out: JSON.stringify({ default_branch: defaultBranch }), err: '' };
      if (line === 'api repos/acme/docs/pages') return pages ? { code: 0, out: JSON.stringify(pages === 'default' ? { source: { branch: defaultBranch, path: '/' } } : pages), err: '' } : { code: 1, out: '', err: 'gh: Not Found (HTTP 404)' };
      // GitHub's list of the branch's pull requests, two to a page, the open one first
      const pulls = /^api --paginate --slurp repos\/acme\/docs\/pulls\?state=(open|all)&head=acme%3Aseismic%2Fdemos&per_page=100$/.exec(line);
      if (pulls) {
        const list = [...open, ...(pulls[1] === 'all' ? history : [])].map((p) => ({ html_url: 'url' in p ? p.url : '', number: 'number' in p ? p.number : 0, body: 'body' in p ? p.body : null, head: { sha: p.headRefOid ?? '' }, base: { ref: 'base' in p && p.base ? p.base : 'main' } }));
        return { code: 0, out: JSON.stringify(list.length ? Array.from({ length: Math.ceil(list.length / 2) }, (_, i) => list.slice(i * 2, i * 2 + 2)) : [[]]), err: '' };
      }
      if (line.startsWith('pr view') && argv.includes('mergeable')) return { code: 0, out: `${open.find((p) => String(p.number) === argv[3])?.mergeable ?? 'UNKNOWN'}\n`, err: '' };
      if (line.startsWith('pr create')) {
        if (failCreate) return { code: 1, out: '', err: 'service unavailable' };
        open = [{ url: 'https://github.com/acme/docs/pull/7', number: 7, mergeable: 'MERGEABLE', body: argv.at(-1), base: argv[argv.indexOf('--base') + 1] }];
        return { code: 0, out: 'https://github.com/acme/docs/pull/7\n', err: '' };
      }
      if (line.startsWith('pr edit')) {
        if (failEdit) return { code: 1, out: '', err: 'service unavailable' };
        if (open[0]) open[0].body = argv.at(-1);
        if (open[0] && argv.includes('--base')) open[0].base = argv[argv.indexOf('--base') + 1];
        return { code: 0, out: '', err: '' };
      }
      if (line.startsWith('pr view')) return { code: 0, out: `${state}\n`, err: '' };
      // GitHub's compare, as git tells it of the remote
      const compare = /^api repos\/acme\/docs\/compare\/(\w+)\.\.\.(\w+)/.exec(line);
      if (compare) {
        const [, a, b] = compare as unknown as [string, string, string];
        const on = async (x: string, y: string) => (await exec(['git', '-C', remote, 'merge-base', '--is-ancestor', x, y])).code === 0;
        const status = a === b ? 'identical' : (await on(a, b)) ? 'ahead' : (await on(b, a)) ? 'behind' : 'diverged';
        if (!argv.at(-1)!.includes('ahead_by')) return { code: 0, out: `${status}\n`, err: '' };
        // the commits the second has beyond the first, and whether each is Seismic's
        const messages = (await exec(['git', '-C', remote, 'log', '--format=%s', `${a}..${b}`])).out.split('\n').filter(Boolean);
        return { code: 0, out: JSON.stringify({ status, ahead_by: messages.length, demos: messages.map((m) => m.startsWith('Demos:')) }), err: '' };
      }
      return { code: 0, out: '', err: '' };
    }
    // a rollback deletes the branch or puts back its tip from before, never pushes HEAD
    if (failRollback && argv.some((a) => a.endsWith(':refs/heads/seismic/demos') && !a.startsWith('HEAD:') && !a.startsWith('--'))) return { code: 1, out: '', err: 'cannot restore branch' };
    if (argv.includes('push') && beforePush) {
      const run = beforePush;
      beforePush = null;
      await run();
    }
    return exec(argv, o);
  };
  const git = async (cwd: string, ...args: string[]) => {
    const r = await exec(['git', '-C', cwd, '-c', 'user.name=Other', '-c', 'user.email=o@x', '-c', 'commit.gpgsign=false', ...args]);
    if (r.code !== 0) throw new Error(r.err);
    return r.out.trim();
  };
  const site = (mode: 'direct' | 'pr'): DemoSite => ({ title: 'Docs demos', url: 'https://acme.github.io/docs/docs/demos', deploy: 'obeya:github-folder acme/docs', git: { branch: 'main', folder: 'docs/demos', mode } });
  const make = (mode: 'direct' | 'pr', home = join(dir, 'home'), machine = 'a') => siteTarget(site(mode), join(dir, 'repo'), home, MESSAGES.en.share, { machine, language: 'en', by: 'Ada', x, gitRemote: `file://${remote}` });
  const page = (slug: string, shared: string[] = []): SharePage => ({ slug, title: `Title ${slug}`, text: 'A sentence. Another.', kind: 'video', chapters: [], pr: null, language: 'en', dir: demo, shared });
  /** A fresh look at the remote's branch. */
  const look = async (ref = 'main') => {
    const at = join(dir, `look-${Math.random().toString(36).slice(2)}`);
    await git(dir, 'clone', '-q', '--branch', ref, remote, at);
    return at;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'obeya-folder-'));
    remote = join(dir, 'remote.git');
    const seed = join(dir, 'seed');
    mkdirSync(join(seed, 'docs'), { recursive: true });
    writeFileSync(join(seed, 'README.md'), 'the owner’s\n');
    writeFileSync(join(seed, 'docs', 'index.md'), '---\ntitle: Docs\n---\n');
    await exec(['git', 'init', '-q', '-b', 'main', seed]);
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-qm', 'seed');
    await exec(['git', 'clone', '-q', '--bare', seed, remote]);
    mkdirSync(join(dir, 'repo'));
    demo = join(dir, 'demo');
    mkdirSync(demo);
    writeFileSync(join(demo, 'demo.mp4'), 'video');
    writeFileSync(join(demo, 'captions.vtt'), 'WEBVTT\n');
    gh = [];
    open = [];
    state = 'OPEN';
    failCreate = false;
    failEdit = false;
    failRollback = false;
    history = [];
    beforePush = null;
    defaultBranch = 'main';
    // served from the default branch's root, whichever it is
    pages = 'default';
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('a share adds one commit under the folder, touching nothing else, without .nojekyll or _headers', async () => {
    const r = await make('direct').publish(page('first'));
    expect(r).toMatchObject({ url: 'https://acme.github.io/docs/docs/demos/first/' });
    expect('merge' in r).toBe(false);
    const at = await look();
    expect(await git(at, 'log', '--format=%s')).toBe('Demos: Title first\nseed');
    expect(readFileSync(join(at, 'README.md'), 'utf8')).toBe('the owner’s\n');
    expect(existsSync(join(at, 'docs/index.md'))).toBe(true);
    expect(existsSync(join(at, 'docs/demos/first/demo.mp4'))).toBe(true);
    expect(existsSync(join(at, 'docs/demos/obeya-site.json'))).toBe(true);
    for (const f of ['.nojekyll', 'docs/demos/.nojekyll', 'docs/demos/_headers']) expect(existsSync(join(at, f))).toBe(false);
    // gh's token stays off the command line
    expect(gh.flat()).not.toContain('gho_secret');
    // a withdrawal is one more commit
    expect((await make('direct').withdraw('first', [])).why).toBeUndefined();
    const again = await look();
    expect((await git(again, 'log', '--format=%s')).split('\n')[0]).toBe('Demos: withdraw Title first');
    expect(existsSync(join(again, 'docs/demos/first'))).toBe(false);
  });

  test('assets the repository ignores are published too, at the setup and on later shares', async () => {
    const seed = join(dir, 'seed');
    writeFileSync(join(seed, 'docs', '.gitignore'), '*.mp4\n*.vtt\n*.jpg\ndemos/\n');
    await git(seed, 'add', '-A');
    await git(seed, 'commit', '-qm', 'ignore');
    await exec(['git', '-C', seed, 'push', '-q', remote, 'main']);
    writeFileSync(join(demo, 'poster.jpg'), 'png');
    await make('direct').publish(page('first'));
    const at = await look();
    for (const f of ['demo.mp4', 'poster.jpg', 'captions.vtt']) expect(existsSync(join(at, 'docs/demos/first', f))).toBe(true);
    await make('direct').publish(page('second'));
    const later = await look();
    for (const n of ['first', 'second']) for (const f of ['demo.mp4', 'poster.jpg', 'captions.vtt']) expect(existsSync(join(later, 'docs/demos', n, f))).toBe(true);
    expect(readFileSync(join(later, 'README.md'), 'utf8')).toBe('the owner’s\n');
  });

  test('two machines merge through git: a push rejected because the other pushed is made once more', async () => {
    const other = make('direct', join(dir, 'home-b'), 'b');
    expect(await other.publish(page('theirs'))).toHaveProperty('url');
    // the other machine shares again right before this one's push
    beforePush = async () => void (await other.publish(page('later')));
    expect(await make('direct').publish(page('mine'))).toHaveProperty('url');
    const at = await look();
    for (const slug of ['theirs', 'later', 'mine']) expect(existsSync(join(at, 'docs/demos', slug, 'index.html'))).toBe(true);
    expect(await git(at, 'rev-list', '--count', 'HEAD')).toBe('4');
  });

  test('in pull-request mode, shares collect on one branch and pull request until it is merged', async () => {
    const r = await make('pr').publish(page('one'));
    expect(r).toMatchObject({ merge: 'https://github.com/acme/docs/pull/7' });
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(1);
    // the default branch is as it was; the branch holds the page
    expect(await git(await look(), 'log', '--format=%s')).toBe('seed');
    expect(existsSync(join(await look('seismic/demos'), 'docs/demos/one/demo.mp4'))).toBe(true);
    // the next share goes onto the same branch, and the pull request lists both pages
    expect(await make('pr').publish(page('two', ['one']))).toMatchObject({ merge: 'https://github.com/acme/docs/pull/7' });
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(1);
    const edit = gh.filter((c) => c[0] === 'pr' && c[1] === 'edit').at(-1)!;
    expect(edit.at(-1)).toContain('[Title one](https://acme.github.io/docs/docs/demos/one/)');
    expect(edit.at(-1)).toContain('[Title two]');
    expect(await git(await look('seismic/demos'), 'log', '--format=%s')).toBe('Demos: Title two\nDemos: Title one\nseed');
    expect(await make('pr').prState!('https://github.com/acme/docs/pull/7')).toBe('open');
    // merged at GitHub (squashed): the next share starts the branch afresh from the default branch
    const merged = await look();
    await git(merged, 'checkout', '-q', 'origin/seismic/demos', '--', 'docs/demos');
    await git(merged, 'commit', '-qm', 'Demos (#7)');
    await git(merged, 'push', '-q', 'origin', 'main');
    history = [{ headRefOid: await git(remote, 'rev-parse', 'seismic/demos'), state: 'MERGED' }];
    open = [];
    expect(await make('pr').publish(page('three', ['one', 'two']))).toMatchObject({ merge: 'https://github.com/acme/docs/pull/7' });
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(2);
    expect(await git(await look('seismic/demos'), 'log', '--format=%s')).toBe('Demos: Title three\nDemos (#7)\nseed');
  });

  test('auditing a closed proposal does not recreate its pages or PR', async () => {
    await make('pr').publish(page('one'));
    history = [{ headRefOid: await git(remote, 'rev-parse', 'seismic/demos'), state: 'CLOSED' }];
    open = [];
    state = 'CLOSED';
    const count = gh.filter((c) => c[0] === 'pr' && c[1] === 'create').length;
    for (let i = 0; i < 2; i++) expect(await make('pr').audit(['one'])).toEqual({ gone: [], missing: [] });
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(count);
    expect(existsSync(join(await look(), 'docs/demos/one'))).toBe(false);
    expect(await make('pr').publish(page('two', ['one']))).toHaveProperty('merge');
    expect(existsSync(join(await look('seismic/demos'), 'docs/demos/one/demo.mp4'))).toBe(true);
  });

  /** Closes the open pull request without a merge; its branch's tip as it was. */
  const close = async () => {
    const head = await git(remote, 'rev-parse', 'seismic/demos');
    history = [{ headRefOid: head, state: 'CLOSED' }];
    open = [];
    state = 'CLOSED';
    return head;
  };
  /** Pushes a commit of someone else's onto the rolling branch, or resets it to `to`. */
  const onBranch = async (to?: string) => {
    if (to) return void (await git(remote, 'update-ref', 'refs/heads/seismic/demos', to));
    const at = await look('seismic/demos');
    writeFileSync(join(at, 'docs/demos/late.txt'), 'after the close\n');
    await git(at, 'add', '-A');
    await git(at, 'commit', '-qm', 'late');
    await git(at, 'push', '-q', 'origin', 'seismic/demos');
  };

  test('commits on a closed proposal’s branch do not carry it into the next one', async () => {
    await make('pr').publish(page('one'));
    await close();
    await onBranch();
    expect(await make('pr', join(dir, 'home-b'), 'b').publish(page('two'))).toHaveProperty('merge');
    const at = await look('seismic/demos');
    expect(await git(at, 'log', '--format=%s')).toBe('Demos: Title two\nseed');
    for (const f of ['docs/demos/one', 'docs/demos/late.txt']) expect(existsSync(join(at, f))).toBe(false);
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(2);
  });

  test('a closed proposal counts however many pull requests came after it', async () => {
    await make('pr').publish(page('one'));
    await close();
    // six later proposals, merged: the closed one is on GitHub's fourth page
    history = [...Array.from({ length: 6 }, (_, i) => ({ headRefOid: String(i).repeat(40), state: 'MERGED' })), ...history];
    await onBranch();
    expect(await make('pr', join(dir, 'home-b'), 'b').publish(page('two'))).toHaveProperty('merge');
    expect(await git(await look('seismic/demos'), 'log', '--format=%s')).toBe('Demos: Title two\nseed');
  });

  test('a closed proposal’s branch reset to an earlier commit of it starts afresh too', async () => {
    await make('pr').publish(page('one'));
    const first = await git(remote, 'rev-parse', 'seismic/demos');
    await make('pr').publish(page('two', ['one']));
    await close();
    await onBranch(first);
    expect(await make('pr', join(dir, 'home-b'), 'b').publish(page('three'))).toHaveProperty('merge');
    const at = await look('seismic/demos');
    expect(await git(at, 'log', '--format=%s')).toBe('Demos: Title three\nseed');
    expect(existsSync(join(at, 'docs/demos/one'))).toBe(false);
  });

  test('switching to direct publishing never lets the audit publish a proposal, closed or open', async () => {
    await make('pr').publish(page('one'));
    // open, then closed: the default branch never gets the page from the minute check
    for (const closed of [false, true]) {
      if (closed) await close();
      for (let i = 0; i < 2; i++) expect(await make('direct').audit(['one'])).toEqual({ gone: [], missing: [] });
      expect(await git(await look(), 'log', '--format=%s')).toBe('seed');
    }
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(1);
  });

  test('site audits retry a failed PR list update after restart, including withdrawals', async () => {
    await make('pr').publish(page('one'));
    failEdit = true;
    expect(await make('pr').publish(page('two', ['one']))).toHaveProperty('merge');
    expect(open[0]!.body).not.toContain('Title two');
    failEdit = false;
    await make('pr').audit(['one', 'two']);
    expect(open[0]!.body).toContain('Title two');
    failEdit = true;
    expect((await make('pr').withdraw('one', ['two'])).why).toBeUndefined();
    expect(open[0]!.body).not.toContain('withdrawn');
    failEdit = false;
    await make('pr').audit(['two']);
    expect(open[0]!.body).toContain('withdrawn: `one`');
    const edits = gh.filter((c) => c[0] === 'pr' && c[1] === 'edit').length;
    await make('pr').audit(['two']);
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'edit')).toHaveLength(edits);
  });

  test('failed PR creation removes its pushed branch and a retry succeeds', async () => {
    failCreate = true;
    const result = await make('pr').publish(page('one'));
    expect(JSON.stringify(result)).toContain('rolled back');
    expect(await git(remote, 'branch', '--list', 'seismic/demos')).toBe('');
    expect(await git(await look(), 'log', '--format=%s')).toBe('seed');
    failCreate = false;
    expect(await make('pr').publish(page('one'))).toMatchObject({ merge: 'https://github.com/acme/docs/pull/7' });
  });

  test('a failed rollback preserves the orphan branch for another machine retrying', async () => {
    failCreate = true;
    failRollback = true;
    expect(JSON.stringify(await make('pr').publish(page('one')))).toContain('rollback failed');
    failCreate = false;
    expect(await make('pr', join(dir, 'other-home'), 'b').publish(page('two'))).toHaveProperty('merge');
    const at = await look('seismic/demos');
    for (const slug of ['one', 'two']) expect(existsSync(join(at, 'docs/demos', slug, 'demo.mp4'))).toBe(true);
  });

  test('an orphan branch goes on after an earlier proposal was merged with a merge commit', async () => {
    await make('pr').publish(page('zero'));
    // merged at GitHub with a merge commit: its head is in the default branch's history
    const merged = await look();
    await git(merged, 'merge', '-q', '--no-ff', '-m', 'Merge #7', 'origin/seismic/demos');
    await git(merged, 'push', '-q', 'origin', 'main');
    history = [{ headRefOid: await git(remote, 'rev-parse', 'seismic/demos'), state: 'MERGED' }];
    open = [];
    failCreate = true;
    failRollback = true;
    expect(JSON.stringify(await make('pr').publish(page('one', ['zero'])))).toContain('rollback failed');
    failCreate = false;
    expect(await make('pr', join(dir, 'other-home'), 'b').publish(page('two'))).toHaveProperty('merge');
    const at = await look('seismic/demos');
    for (const slug of ['zero', 'one', 'two']) expect(existsSync(join(at, 'docs/demos', slug, 'demo.mp4'))).toBe(true);
  });

  test('failed creation restores a pre-existing closed PR branch', async () => {
    await make('pr').publish(page('one'));
    const tip = await git(remote, 'rev-parse', 'seismic/demos');
    history = [{ headRefOid: tip, state: 'CLOSED' }];
    open = [];
    failCreate = true;
    expect(JSON.stringify(await make('pr').publish(page('two')))).toContain('rolled back');
    expect(await git(remote, 'rev-parse', 'seismic/demos')).toBe(tip);
  });

  /** Makes `trunk` the repository's default branch: main's history and a commit of its own. */
  const toTrunk = async () => {
    const at = await look();
    await git(at, 'checkout', '-q', '-b', 'trunk');
    writeFileSync(join(at, 'TRUNK.md'), 'the new default\n');
    await git(at, 'add', '-A');
    await git(at, 'commit', '-qm', 'trunk');
    await git(at, 'push', '-q', 'origin', 'trunk');
    defaultBranch = 'trunk';
  };

  test('shares follow a default branch changed after the setup, straight to it', async () => {
    await make('direct').publish(page('one'));
    await toTrunk();
    expect(await make('direct').publish(page('two', ['one']))).toHaveProperty('url');
    const trunk = await look('trunk');
    expect(await git(trunk, 'log', '--format=%s')).toBe('Demos: Title two\ntrunk\nDemos: Title one\nseed');
    for (const slug of ['one', 'two']) expect(existsSync(join(trunk, 'docs/demos', slug, 'index.html'))).toBe(true);
    // the earlier default branch is left as it was
    expect(await git(await look(), 'log', '--format=%s')).toBe('Demos: Title one\nseed');
  });

  test('the rolling pull request moves to a changed default branch with the next share, or with a site check after a failed move', async () => {
    await make('pr').publish(page('one'));
    expect(open[0]!.base).toBe('main');
    await toTrunk();
    failEdit = true;
    expect(JSON.stringify(await make('pr').publish(page('two', ['one'])))).toContain('brought up to date on the next site check');
    // its branch is built afresh on trunk, in the same pull request
    expect(await git(await look('seismic/demos'), 'log', '--format=%s')).toBe('Demos: Title two\ntrunk\nseed');
    expect(gh.filter((c) => c[0] === 'pr' && c[1] === 'create')).toHaveLength(1);
    expect(open[0]!.base).toBe('main');
    failEdit = false;
    await make('pr').audit(['one', 'two']);
    expect(open[0]!.base).toBe('trunk');
    expect(open[0]!.body).toContain('[Title two]');
  });

  test('a share is refused where Pages no longer serve the folder from the default branch, or are off', async () => {
    await make('direct').publish(page('one'));
    await toTrunk();
    pages = { source: { branch: 'main', path: '/' } };
    const r = await make('direct').publish(page('two', ['one']));
    expect('why' in r && r.why).toContain('not on its GitHub Pages any more: GitHub Pages serves the branch main, not trunk.');
    pages = null;
    const off = await make('direct').publish(page('two', ['one']));
    expect('why' in off && off.why).toContain('GitHub Pages is off for acme/docs');
    expect(await git(await look('trunk'), 'log', '--format=%s')).toBe('trunk\nDemos: Title one\nseed');
  });

  test('a site check moves the pull request only once its branch holds demos alone on the new default branch', async () => {
    // the new default branch is an older point of the earlier one: the proposal's branch is built on it, with main's own commit between
    const at = await look();
    writeFileSync(join(at, 'MAIN.md'), 'after the fork\n');
    await git(at, 'add', '-A');
    await git(at, 'commit', '-qm', 'main only');
    await git(at, 'push', '-q', 'origin', 'HEAD~1:refs/heads/trunk', 'main');
    await make('pr').publish(page('one'));
    defaultBranch = 'trunk';
    await make('pr').audit(['one']);
    expect(open[0]!.base).toBe('main');
  });

  test('a branch that no longer merges is built afresh from the default branch, with this machine’s pages', async () => {
    await make('pr').publish(page('one'));
    open = [{ url: 'https://github.com/acme/docs/pull/7', number: 7, mergeable: 'CONFLICTING' }];
    expect(await make('pr').publish(page('two', ['one']))).toHaveProperty('url');
    const at = await look('seismic/demos');
    expect(await git(at, 'log', '--format=%s')).toBe('Demos: Title two\nseed');
    expect(existsSync(join(at, 'docs/demos/one/index.html'))).toBe(true);
    expect(existsSync(join(at, 'docs/demos/two/index.html'))).toBe(true);
  });
});

describe('initializing a site in an existing repository', () => {
  let home: string;
  const calls: string[] = [];
  const answers: Record<string, unknown> = {};
  const x: Exec = async (argv) => {
    const line = argv.slice(1).join(' ');
    calls.push(line);
    if (line.startsWith('api -X POST')) return { code: 0, out: '{}', err: '' };
    const path = pathOf(argv);
    if (!(path in answers)) return { code: 1, out: '', err: 'gh: Not Found (HTTP 404)' };
    return { code: 0, out: JSON.stringify(argv.includes('--slurp') ? [answers[path]] : answers[path]), err: '' };
  };
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'obeya-folder-setup-'));
    calls.length = 0;
    for (const k of Object.keys(answers)) delete answers[k];
    answers['repos/acme/notes/branches/main'] = { protected: false };
    answers['repos/acme/notes'] = { private: true, default_branch: 'main', size: 10, permissions: { push: true, admin: true } };
    answers['repos/acme/notes/rules/branches/main'] = [{ type: 'pull_request', ruleset_id: 9 }];
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const done = async (setup: SiteSetup) => {
    for (let i = 0; i < 200 && setup.view().job?.running; i++) await Bun.sleep(5);
    return setup.view();
  };

  test('Pages turned on where it is off, the site on the list in the mode chosen, unlisted for a private repository', async () => {
    const setup = new SiteSetup({ home, changed: () => {}, x, wait: [], check: async () => null });
    setup.add({ host: 'github', repo: 'acme/notes', folder: '/docs/demos/', via: 'pr' });
    const v = await done(setup);
    expect(v.job?.error).toBeUndefined();
    expect(calls).toContain('api -X POST repos/acme/notes/pages -f source[branch]=main -f source[path]=/');
    expect(v.sites[0]).toMatchObject({ url: 'https://acme.github.io/notes/docs/demos', host: 'github', project: 'acme/notes', listed: false, git: { branch: 'main', folder: 'docs/demos', mode: 'pr' } });
    // a push straight to main does not go through: refused as the mode
    await expect(setup.mode({ url: v.sites[0]!.url, mode: 'direct' })).rejects.toThrow('does not go through');
    answers['repos/acme/notes/rules/branches/main'] = [];
    expect((await setup.mode({ url: v.sites[0]!.url, mode: 'direct' })).sites[0]!.git?.mode).toBe('direct');
  });

  test('a push the rules refuse is not offered, and a folder outside Pages is refused', async () => {
    const setup = new SiteSetup({ home, changed: () => {}, x, wait: [], check: async () => null });
    setup.add({ host: 'github', repo: 'acme/notes', folder: 'demos', via: 'push' });
    expect((await done(setup)).job?.error).toContain('does not go through');
    answers['repos/acme/notes/pages'] = { html_url: 'https://acme.github.io/notes/', source: { branch: 'main', path: '/docs' } };
    setup.add({ host: 'github', repo: 'acme/notes', folder: 'demos', via: 'pr' });
    expect((await done(setup)).job?.error).toContain('/docs');
    expect(() => setup.add({ host: 'github', repo: 'acme/notes', folder: '_site', via: 'pr' })).toThrow();
  });
});
