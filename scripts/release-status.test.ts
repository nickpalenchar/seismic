import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draft, expectedAssets, type Gh, nextVersion, report, SECRETS, status } from './release-status';

// a repository with GitHub as a bare remote beside it; gh is a function that answers from a table
const tmp = mkdtempSync(join(tmpdir(), 'seismic-release-status-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function repo(name: string) {
  const dir = join(tmp, name);
  const origin = join(tmp, `${name}.git`);
  mkdirSync(dir);
  const git = (date: string, ...a: string[]) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], {
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const commit = (date: string, file: string, subject: string) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), subject);
    git(date, 'add', '.');
    git(date, 'commit', '-qm', subject);
  };
  git('', 'init', '-q', '-b', 'main');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git('', 'remote', 'add', 'origin', origin);
  return { dir, git, commit };
}

type Release = { tag_name: string; draft?: boolean; prerelease?: boolean; body?: string; assets?: { name: string }[] };

function gh(releases: Release[], { latest = 'v0.1.0', secrets = SECRETS, files = {} as Record<string, string> } = {}): Gh {
  return (args) => {
    const call = args.join(' ');
    if (call === 'api repos/{owner}/{repo}/releases') return JSON.stringify(releases.map((r) => ({ draft: false, prerelease: false, assets: [], ...r })));
    if (call === 'api repos/{owner}/{repo}/releases/latest --jq .tag_name') return latest;
    if (call.startsWith('secret list')) return secrets.join('\n');
    if (args[1] === 'download') return files[args[args.indexOf('--pattern') + 1]!] ?? null;
    return null;
  };
}

test('the next version is a minor bump', () => {
  expect(nextVersion('v0.1.0')).toBe('0.2.0');
  expect(nextVersion('0.9.3')).toBe('0.10.0');
  expect(nextVersion('v1.4.2')).toBe('1.5.0');
});

test('says what the release holds, whether its changelog is written and how far GitHub is behind; nothing in the way', () => {
  const { dir, git, commit } = repo('ready');
  commit('2026-10-08T10:00:00Z', 'package.json', JSON.stringify({ version: '0.1.0' }));
  git('', 'tag', 'v0.1.0');
  commit('2026-10-10T10:00:00Z', 'src/ui/project.tsx', 'Pin the cards to a wall');
  git('', 'push', '-q', 'origin', 'main');
  commit('2026-10-12T12:00:00Z', 'docs/design.md', 'Record the wall');
  commit('2026-10-12T13:00:00Z', 'src/ui/bar.tsx', 'Fit the bar');
  commit('2026-10-12T14:00:00Z', 'src/server/land.ts', 'Land faster');
  expect(status(dir, gh([{ tag_name: 'v0.1.0' }])).changelog).toBe(false);
  commit('2026-10-12T15:00:00Z', 'CHANGELOG.md', '# Changelog\n\n## 0.2.0 — 2026-10-12\n\n- Faster\n\n## 0.1.0\n\n- First\n');

  const s = status(dir, gh([{ tag_name: 'v0.1.0' }]));
  expect(s.problems).toEqual([]);
  expect(s.version).toBe('0.1.0');
  expect(s.tag?.name).toBe('v0.1.0');
  expect(s.propose).toBe('0.2.0');
  // the commits since the tag that change what runs, newest first; the docs commit counts only in all
  expect(s.changes.map((c) => c.subject)).toEqual(['Land faster', 'Fit the bar', 'Pin the cards to a wall']);
  expect(s.commits).toBe(5);
  expect(s.changelog).toBe(true);
  expect(s.github).toEqual({ behind: 4, ahead: 0 });
  expect(s.latest).toBe('v0.1.0');
  expect(s.missing).toEqual([]);

  const text = report(s);
  expect(text).toContain('Propose 0.2.0.');
  expect(text).toContain('CHANGELOG.md on main: has the section for 0.2.0.');
  expect(text).toContain('Since then: 5 commits on main, 3 of them change what runs');
  expect(text).toContain('GitHub: its main lacks 4 of ours.');
  expect(text).toContain('Releases: the latest is v0.1.0.');
  expect(text).toEndWith('Nothing in the way.');
});

test('release candidates since the last release leave it the last tag; the version proposed is the one they were for', () => {
  const { dir, git, commit } = repo('candidates');
  commit('2026-10-08T10:00:00Z', 'package.json', JSON.stringify({ version: '0.1.0' }));
  git('', 'tag', 'v0.1.0');
  commit('2026-10-10T10:00:00Z', 'src/ui/project.tsx', 'Pin the cards to a wall');
  commit('2026-10-10T11:00:00Z', 'package.json', JSON.stringify({ version: '0.2.0-rc.1' }));
  git('', 'tag', 'v0.2.0-rc.1');
  commit('2026-10-12T10:00:00Z', 'src/ui/bar.tsx', 'Fit the bar');

  const s = status(dir, gh([{ tag_name: 'v0.1.0' }, { tag_name: 'v0.2.0-rc.1', draft: true, prerelease: true }]));
  expect(s.tag?.name).toBe('v0.1.0');
  // a candidate's draft stays one, and is no draft left over
  expect(s.drafts).toEqual([]);
  expect(s.propose).toBe('0.2.0');
  // the candidate's own commits count toward the release, back to the last release
  expect(s.changes.map((c) => c.subject)).toEqual(['Fit the bar', JSON.stringify({ version: '0.2.0-rc.1' }), 'Pin the cards to a wall']);
});

test('names what stands in the way: a missing secret, GitHub ahead, a tag taken, a draft left over', () => {
  const { dir, git, commit } = repo('blocked');
  commit('2026-10-08T10:00:00Z', 'package.json', JSON.stringify({ version: '0.1.0' }));
  git('', 'tag', 'v0.1.0');
  commit('2026-10-09T10:00:00Z', 'src/a.ts', 'A');
  git('', 'push', '-q', 'origin', 'main');
  // GitHub's main moved on elsewhere, with a commit this repository never fetched
  const other = join(tmp, 'blocked-elsewhere');
  spawnSync('git', ['clone', '-q', join(tmp, 'blocked.git'), other]);
  spawnSync('git', ['-C', other, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'Elsewhere']);
  spawnSync('git', ['-C', other, 'push', '-q', 'origin', 'main']);
  // where someone tagged it already
  spawnSync('git', ['-C', other, 'tag', 'v0.3.0']);
  spawnSync('git', ['-C', other, 'push', '-q', 'origin', 'v0.3.0']);
  commit('2026-10-09T11:00:00Z', 'src/b.ts', 'B');
  // the version is bumped already
  commit('2026-10-09T12:00:00Z', 'package.json', JSON.stringify({ version: '0.3.0' }));

  const s = status(dir, gh([{ tag_name: 'v0.1.0' }, { tag_name: 'v0.2.0', draft: true }], { secrets: SECRETS.filter((n) => n !== 'APPLE_NOTARY_KEY') }));
  expect(s.propose).toBe('0.3.0');
  expect(s.github).toEqual({ behind: null, ahead: null });
  expect(s.missing).toEqual(['APPLE_NOTARY_KEY']);
  expect(s.drafts).toEqual(['v0.2.0']);
  expect(s.problems).toEqual([
    'The tag v0.3.0 exists already.',
    "GitHub's main has commits that main here lacks: fetch and see where they come from before pushing.",
    'Drafts left over: v0.2.0.',
    'Secrets missing: APPLE_NOTARY_KEY (docs/release.md).',
  ]);
  expect(report(s)).toContain("GitHub: its main has commits never fetched here.");
});

test('without gh it says that GitHub could not be read', () => {
  const { dir, git, commit } = repo('offline');
  commit('2026-10-08T10:00:00Z', 'package.json', JSON.stringify({ version: '0.1.0' }));
  git('', 'tag', 'v0.1.0');
  git('', 'push', '-q', 'origin', 'main');
  const s = status(dir, () => null);
  expect(s.problems).toEqual([
    'Nothing that runs changed since v0.1.0.',
    "GitHub's releases could not be read (gh login of the repository's owner?).",
    'The repository secrets could not be read.',
  ]);
});

const platforms = ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64', 'linux-x86_64', 'linux-aarch64'];
const manifest = (version: string, names = platforms) =>
  JSON.stringify({ version, pub_date: '2026-10-13T10:00:00Z', platforms: Object.fromEntries(names.map((p) => [p, { url: `https://x/${p}`, signature: 's' }])) });

test('a draft holding every file, and a latest.json of its version for every platform, is ready', () => {
  expect(expectedAssets()).toHaveLength(16);
  const assets = expectedAssets().map((name) => ({ name }));
  const d = draft('v0.2.0', gh([{ tag_name: 'v0.2.0', draft: true, body: '- Fit the bar', assets }], { files: { 'latest.json': manifest('0.2.0') } }));
  expect(d.problems).toEqual([]);
  expect(d.notes).toBe('- Fit the bar');
});

test('a draft with a file missing, or a latest.json without updates, is not', () => {
  const assets = expectedAssets().filter((n) => n !== 'Seismic-macOS-x64.dmg').map((name) => ({ name }));
  const d = draft('v0.2.0', gh([{ tag_name: 'v0.2.0', draft: true, assets }], { files: { 'latest.json': manifest('0.1.0', ['darwin-aarch64']) } }));
  expect(d.problems).toEqual([
    'Missing: Seismic-macOS-x64.dmg.',
    'latest.json says version 0.1.0, not v0.2.0.',
    'latest.json names no update for darwin-x86_64, windows-x86_64, linux-x86_64, linux-aarch64 (TAURI_SIGNING_PRIVATE_KEY?).',
  ]);
  expect(draft('v0.3.0', gh([])).problems).toEqual(['No release v0.3.0 (yet): has the build run finished?']);
});
