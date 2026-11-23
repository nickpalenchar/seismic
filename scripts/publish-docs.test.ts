import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishDocs, TAG } from './publish-docs';

// a checkout with GitHub as a bare remote beside it; every step is a git call, slow on a busy machine
const SLOW = 120_000;
const tmp = mkdtempSync(join(tmpdir(), 'seismic-publish-docs-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function repo(name: string) {
  const dir = join(tmp, name);
  const origin = join(tmp, `${name}.git`);
  mkdirSync(dir);
  const git = (...a: string[]) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const commit = (file: string, text: string) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
    git('add', '.');
    git('commit', '-qm', `${file}: ${text}`);
    return git('rev-parse', 'HEAD');
  };
  const remoteTag = () => spawnSync('git', ['-C', origin, 'rev-parse', '--verify', '--quiet', TAG], { encoding: 'utf8' }).stdout.trim();
  git('init', '-q', '-b', 'main');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git('remote', 'add', 'origin', origin);
  return { dir, git, commit, remoteTag };
}

test('tags GitHub main the first time, with every docs page as changed', () => {
  const r = repo('first');
  const head = r.commit('docs/site/index.md', 'one');
  r.git('push', '-q', 'origin', 'main');
  expect(publishDocs(r.dir)).toEqual({ kind: 'published', commit: head, from: null, changed: ['docs/site/index.md'] });
  expect(r.remoteTag()).toBe(head);
}, SLOW);

test('moves the tag only when docs/site/ changed, unless forced', () => {
  const r = repo('moves');
  const first = r.commit('docs/site/index.md', 'one');
  r.git('push', '-q', 'origin', 'main');
  publishDocs(r.dir);

  const code = r.commit('src/app.ts', 'code');
  r.git('push', '-q', 'origin', 'main');
  expect(publishDocs(r.dir)).toEqual({ kind: 'unchanged', commit: code, tagged: first });
  expect(r.remoteTag()).toBe(first);
  expect(publishDocs(r.dir, { force: true })).toEqual({ kind: 'published', commit: code, from: first, changed: [] });
  expect(r.remoteTag()).toBe(code);

  const docs = r.commit('docs/site/install.md', 'two');
  r.git('push', '-q', 'origin', 'main');
  expect(publishDocs(r.dir)).toEqual({ kind: 'published', commit: docs, from: code, changed: ['docs/site/install.md'] });
  expect(r.remoteTag()).toBe(docs);
}, SLOW);

test('refuses a commit GitHub main does not have, and one without docs/site/', () => {
  const r = repo('refuses');
  const bare = r.commit('README.md', 'no docs');
  r.git('push', '-q', 'origin', 'main');
  expect(publishDocs(r.dir).kind).toBe('refused');

  r.commit('docs/site/index.md', 'one');
  const local = publishDocs(r.dir, { commit: 'HEAD' });
  expect(local).toMatchObject({ kind: 'refused', reason: expect.stringContaining("not on origin's main") });
  expect(publishDocs(r.dir, { commit: bare })).toMatchObject({ kind: 'refused', reason: expect.stringContaining('has no docs/site/') });
  expect(r.remoteTag()).toBe('');
}, SLOW);
