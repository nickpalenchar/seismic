import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, collect, commits, latest, material, notes, section, sums } from './release';

const tmp = mkdtempSync(join(tmpdir(), 'seismic-release-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function files(dir: string, names: Record<string, string>) {
  for (const [name, content] of Object.entries(names)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
}

test('collects the installers under the names the site links, with the signed update', () => {
  const bundle = join(tmp, 'bundle-linux');
  files(bundle, {
    'appimage/Seismic_0.4.0_amd64.AppImage': 'image',
    'appimage/Seismic_0.4.0_amd64.AppImage.sig': 'sig',
    'appimage/Seismic.AppDir/AppRun': 'run',
    'deb/Seismic_0.4.0_amd64.deb': 'deb',
  });
  const out = join(tmp, 'collected-linux');
  collect('linux-x64', bundle, out);
  expect(readdirSync(out).sort()).toEqual(['Seismic-Linux-x86_64.AppImage', 'Seismic-Linux-x86_64.AppImage.sig', 'seismic_amd64.deb']);
});

test('the Mac update is the app packed beside the DMG; without its signature it stays out', () => {
  const bundle = join(tmp, 'bundle-mac');
  files(bundle, { 'dmg/Seismic_0.4.0_aarch64.dmg': 'dmg', 'dmg/bundle_dmg.sh': 'script', 'macos/Seismic.app.tar.gz': 'app' });
  const out = join(tmp, 'collected-mac');
  collect('darwin-arm64', bundle, out);
  expect(readdirSync(out)).toEqual(['Seismic-macOS-arm64.dmg']);
  files(bundle, { 'macos/Seismic.app.tar.gz.sig': 'sig' });
  collect('darwin-arm64', bundle, out);
  expect(readdirSync(out).sort()).toEqual(['Seismic-macOS-arm64.app.tar.gz', 'Seismic-macOS-arm64.app.tar.gz.sig', 'Seismic-macOS-arm64.dmg']);
});

test('a missing installer stops the collection', () => {
  expect(() => collect('windows-x64', join(tmp, 'nothing'), join(tmp, 'collected-win'))).toThrow('-setup.exe');
});

test('latest.json names each platform with a signed update, at its URL in the release', () => {
  const dir = join(tmp, 'release');
  files(dir, {
    'Seismic-macOS-arm64.app.tar.gz': 'a',
    'Seismic-macOS-arm64.app.tar.gz.sig': 'SIG-MAC\n',
    'Seismic-macOS-arm64.dmg': 'd',
    'Seismic-Windows-x64-setup.exe': 'w',
    'Seismic-Windows-x64-setup.exe.sig': 'SIG-WIN',
    'Seismic-Linux-aarch64.AppImage': 'unsigned',
    'seismic_arm64.deb': 'deb',
  });
  expect(latest(dir, 'v0.4.0', 'someone/seismic', new Date('2026-10-08T12:00:00.123Z'))).toEqual({
    version: '0.4.0',
    pub_date: '2026-10-08T12:00:00Z',
    platforms: {
      'darwin-aarch64': { url: 'https://github.com/someone/seismic/releases/download/v0.4.0/Seismic-macOS-arm64.app.tar.gz', signature: 'SIG-MAC' },
      'windows-x86_64': { url: 'https://github.com/someone/seismic/releases/download/v0.4.0/Seismic-Windows-x64-setup.exe', signature: 'SIG-WIN' },
    },
  });
});

test('the checksums read as sha256sum writes them', () => {
  const dir = join(tmp, 'sums');
  files(dir, { 'b.deb': 'b', 'a.dmg': 'a', SHA256SUMS: 'old' });
  expect(sums(dir)).toBe(
    'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.dmg\n' +
      '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b.deb\n',
  );
});

const CHANGELOG = `# Changelog

## 0.2.0 — 2026-10-20

Quits cleanly now.

### Fixed

- Quitting leaves no server behind ([demo](https://demos.example/quit/))

## 0.1.0 — 2026-10-08

The first release.
`;

// made once: git calls are what makes these tests slow
let made: string | undefined;
function history() {
  return (made ??= makeHistory());
}

function makeHistory() {
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  const git = (...a: string[]) => Bun.spawnSync(['git', '-C', repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { stderr: 'pipe' });
  const commit = (file: string, message: string) => {
    files(repo, { [file]: message });
    git('add', '.');
    git('commit', '-qm', message);
  };
  git('init', '-q', '-b', 'main');
  commit('src/a.ts', 'First');
  git('tag', 'v0.1.0');
  commit('src/b.ts', 'Faster project\n\nDemo-Video: https://demos.example/faster/\nCo-Authored-By: T <t@example.com>');
  git('tag', 'site-media');
  commit('docs/design.md', 'Record the plan\n\nDemo-Page: https://demos.example/plan/');
  commit('README.md', 'Reword the README');
  commit('desktop/src/main.rs', 'Quit cleanly\n\nDemo-Video: /Users/someone/demos/quit/demo.mp4\nDemo-Video: https://demos.example/quit/');
  commit('src/c.ts', 'Quit faster\n\nDemo-Page: https://demos.example/quit/');
  git('tag', 'v0.2.0');
  commit('src/d.ts', 'Unreleased');
  files(repo, { 'package.json': JSON.stringify({ version: '0.2.0' }), 'CHANGELOG.md': CHANGELOG });
  return repo;
}

test('the commits since the version tag before that change what runs, with the demos their trailers link', () => {
  const repo = history();
  const since = commits(repo, 'v0.2.0');
  expect(since.map((c) => [c.subject, c.demos])).toEqual([
    ['Quit faster', [{ kind: 'page', url: 'https://demos.example/quit/' }]],
    // a demo on the machine that made it is no link
    ['Quit cleanly', [{ kind: 'video', url: 'https://demos.example/quit/' }]],
    ['Faster project', [{ kind: 'video', url: 'https://demos.example/faster/' }]],
  ]);
  // without a tag: since the last version tag, up to HEAD
  expect(commits(repo).map((c) => c.subject)).toEqual(['Unreleased']);
  // the first release has the whole history
  expect(commits(repo, 'v0.1.0').map((c) => c.subject)).toEqual(['First']);

  const text = material(since, 'Since v0.1.0 up to v0.2.0');
  expect(text).toStartWith('# Since v0.1.0 up to v0.2.0: 3 commits that change what runs, 2 demos\n');
  // a demo behind two commits names both under it
  expect(text).toMatch(/- page https:\/\/demos\.example\/quit\/\n {2}- \S+ \w{8} Quit faster\n {2}- \S+ \w{8} Quit cleanly\n- video https:\/\/demos\.example\/faster\//);
});

test('a version’s section of the changelog, up to the next version', () => {
  expect(section(CHANGELOG, 'v0.2.0')).toBe('Quits cleanly now.\n\n### Fixed\n\n- Quitting leaves no server behind ([demo](https://demos.example/quit/))');
  expect(section(CHANGELOG, '0.1.0')).toBe('The first release.');
  expect(section(CHANGELOG, 'v0.1.1')).toBeNull();
  expect(section(CHANGELOG, 'v0.2')).toBeNull();
  expect(section('## [0.3.0] - 2026-11-01\n\n- A\n', 'v0.3.0')).toBe('- A');
  expect(section('## 0.3.0\n\n## 0.2.0\n\n- B\n', 'v0.3.0')).toBeNull();
});

test('a tag makes a release only as package.json’s version, with its section in the changelog', () => {
  const repo = history();
  expect(check(repo, 'v0.2.0')).toBeNull();
  expect(check(repo, 'v0.3.0')).toBe('tag v0.3.0, but package.json says v0.2.0');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  expect(check(repo, 'v0.3.0')).toBe('CHANGELOG.md has no section "## 0.3.0" (docs/release.md)');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '0.2.0' }));
});

test('the notes are the changelog’s section, how to install, and every commit since the tag before, folded', () => {
  const repo = history();
  const text = notes(repo, 'v0.2.0', 'someone/seismic', CHANGELOG);
  const lines = text.split('\n');
  expect(text).toStartWith(`${section(CHANGELOG, 'v0.2.0')}\n\n### Installing\n\nThe Mac apps are signed and notarised.`);
  expect(lines).toContain('<summary>All commits since v0.1.0 (3)</summary>');
  expect(lines.filter((l) => l.startsWith('- Quit cleanly'))[0]).toMatch(/^- Quit cleanly \(\[\w{7}\]\(https:\/\/github\.com\/someone\/seismic\/commit\/\w{40}\)\) · \[demo\]\(https:\/\/demos\.example\/quit\/\)$/);
  expect(lines).toContain('[The full comparison](https://github.com/someone/seismic/compare/v0.1.0...v0.2.0).');
  expect(text).toEndWith('</details>\n');
  // the first release links the history instead of folding it
  expect(notes(repo, 'v0.1.0', 'someone/seismic', CHANGELOG)).toEndWith('\n[All commits](https://github.com/someone/seismic/commits/v0.1.0) up to this first release.\n');
  expect(() => notes(repo, 'v0.3.0', 'someone/seismic', CHANGELOG)).toThrow('no section for v0.3.0');
});

test('the bar gets the start of the section, without a heading cut off from its entries', () => {
  const dir = join(tmp, 'empty-release');
  mkdirSync(dir);
  const many = ['Twenty changes.', '### New', ...Array.from({ length: 8 }, (_, i) => `- New ${i + 1}`), '', '### Fixed', ...Array.from({ length: 12 }, (_, i) => `- Fix ${i + 1}`)].join('\n');
  const shown = latest(dir, 'v0.2.0', 'someone/seismic', new Date(), many).notes!.split('\n');
  expect(shown).toEqual(['Twenty changes.', '### New', ...Array.from({ length: 8 }, (_, i) => `- New ${i + 1}`), '- … and 12 more']);
  // a paragraph or an entry wrapped over lines is one line
  expect(latest(dir, 'v0.2.0', 'someone/seismic', new Date(), 'What it\nbrings.\n\n### New\n- One,\n  wrapped\n- Two').notes).toBe('What it brings.\n### New\n- One, wrapped\n- Two');
  expect(latest(dir, 'v0.2.0', 'someone/seismic', new Date())).not.toHaveProperty('notes');
});
