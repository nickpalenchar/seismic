// What a release holds, for the build workflow (.github/workflows/build.yml) and the release skill
// (.claude/skills/release/SKILL.md): each platform's build collects its installers, and the release
// job adds the checksums, the updater's latest.json and the notes, taken from CHANGELOG.md.
//
//   bun scripts/release.ts collect <target> <dir>
//       copies the installers of <target> (darwin-arm64, …, as in scripts/build.ts) from
//       desktop/target/release/bundle/ (scripts/build-app.ts) into <dir> under the release's fixed
//       names, with the update artifact and its signature when there is one.
//   bun scripts/release.ts commits [<tag>] [--since <date>]
//       prints the commits since the version tag before <tag> (without <tag>: since the last version
//       tag, up to HEAD) that change what runs, grouped by the demo their Demo-Video/Demo-Page
//       trailers link: the raw material a version's section in CHANGELOG.md is written from.
//       `--since` narrows them by date (the first release has the whole history before it).
//   bun scripts/release.ts check <tag>
//       fails unless <tag> is v<version of package.json> and CHANGELOG.md has a section for it (a
//       release candidate, v<x.y.z>-rc.<n>, needs none).
//   bun scripts/release.ts section <tag> <file>
//       writes the version's section of CHANGELOG.md (without its heading) into <file>; for a
//       release candidate without one, an empty file.
//   bun scripts/release.ts notes <tag> <owner/repo> <file>
//       writes the release's notes: the version's section of CHANGELOG.md, how to install the
//       unsigned downloads, and every commit since the version tag before, folded.
//   bun scripts/release.ts manifest <dir> <tag> <owner/repo> [<section>]
//       writes latest.json (the version, the start of the section for the bar's hover, and per
//       platform the update's URL in the tag's release and its signature) and SHA256SUMS over
//       everything in <dir>.
//
// The names carry no version: the README and the site link the newest release's installers through
// `releases/latest/download/<name>`. A release candidate goes out as a GitHub pre-release, which
// `releases/latest` skips: installed apps are not offered it, and the links keep pointing at the
// latest release. Without the updater's key (TAURI_SIGNING_PRIVATE_KEY at the
// build) there are no update artifacts, and latest.json names no platform.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INERT } from '../src/core/inert';

type Asset = { from: string; ends: string; name: string };
type Release = { platform: string; installers: Asset[]; update: Asset };

/** Per target: where Tauri puts each installer, the name it has in the release, and the update. */
export const RELEASE: Record<string, Release> = {
  'darwin-arm64': {
    platform: 'darwin-aarch64',
    installers: [{ from: 'dmg', ends: '.dmg', name: 'Seismic-macOS-arm64.dmg' }],
    update: { from: 'macos', ends: '.app.tar.gz', name: 'Seismic-macOS-arm64.app.tar.gz' },
  },
  'darwin-x64': {
    platform: 'darwin-x86_64',
    installers: [{ from: 'dmg', ends: '.dmg', name: 'Seismic-macOS-x64.dmg' }],
    update: { from: 'macos', ends: '.app.tar.gz', name: 'Seismic-macOS-x64.app.tar.gz' },
  },
  'windows-x64': {
    platform: 'windows-x86_64',
    installers: [{ from: 'nsis', ends: '-setup.exe', name: 'Seismic-Windows-x64-setup.exe' }],
    update: { from: 'nsis', ends: '-setup.exe', name: 'Seismic-Windows-x64-setup.exe' },
  },
  'linux-x64': {
    platform: 'linux-x86_64',
    installers: [
      { from: 'appimage', ends: '.AppImage', name: 'Seismic-Linux-x86_64.AppImage' },
      { from: 'deb', ends: '.deb', name: 'seismic_amd64.deb' },
    ],
    update: { from: 'appimage', ends: '.AppImage', name: 'Seismic-Linux-x86_64.AppImage' },
  },
  'linux-arm64': {
    platform: 'linux-aarch64',
    installers: [
      { from: 'appimage', ends: '.AppImage', name: 'Seismic-Linux-aarch64.AppImage' },
      { from: 'deb', ends: '.deb', name: 'seismic_arm64.deb' },
    ],
    update: { from: 'appimage', ends: '.AppImage', name: 'Seismic-Linux-aarch64.AppImage' },
  },
};

/** Copies the installers of `target` in `bundle` (Tauri's bundle directory) into `dir`; returns their names. */
export function collect(target: string, bundle: string, dir: string): string[] {
  const release = RELEASE[target];
  if (!release) throw new Error(`unknown target ${target} (known: ${Object.keys(RELEASE).join(', ')})`);
  mkdirSync(dir, { recursive: true });
  const copied: string[] = [];
  const find = (a: Asset) => {
    const sub = join(bundle, a.from);
    const f = existsSync(sub) ? readdirSync(sub).find((f) => f.endsWith(a.ends)) : undefined;
    return f && join(sub, f);
  };
  const put = (from: string, name: string) => {
    copyFileSync(from, join(dir, name));
    copied.push(name);
  };
  for (const a of release.installers) {
    const from = find(a);
    if (!from) throw new Error(`no ${a.ends} in ${join(bundle, a.from)}`);
    put(from, a.name);
  }
  const update = find(release.update);
  if (update && existsSync(`${update}.sig`)) {
    if (!copied.includes(release.update.name)) put(update, release.update.name);
    put(`${update}.sig`, `${release.update.name}.sig`);
  }
  return copied;
}

export type Latest = { version: string; notes?: string; pub_date: string; platforms: Record<string, { url: string; signature: string }> };

/** What the bar's hover shows of the notes at most, in lines. */
const NOTES_SHOWN = 12;

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(['git', '-C', cwd, ...args], { stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
};

/** The paths of the commits that change what runs, as `git log -- <these>` takes them: all but the inert ones. */
export const RUNS = ['.', ...INERT.dirs.map((d) => `:!${d}`), `:!*${INERT.ending}`];

export type Demo = { kind: 'video' | 'page'; url: string };
export type Commit = { hash: string; date: string; subject: string; demos: Demo[] };

/** A release candidate's tag: v0.2.0-rc.1. */
const CANDIDATE = /^v?(\d+\.\d+\.\d+)-rc\.(\d+)$/;

/** The version a release candidate's tag is a candidate for (v0.2.0-rc.1 → 0.2.0); null for any other tag. */
export function candidate(tag: string): string | null {
  return CANDIDATE.exec(tag)?.[1] ?? null;
}

/**
 * The version tag before `tag`, or without one the last version tag on HEAD. A release's is the
 * release before it, so its notes cover every release candidate in between; a release candidate's
 * is the tag before it of either kind. Other tags (`site-media`, which held the upstream site's
 * video) do not count.
 */
export function tagBefore(cwd: string, tag?: string): string | null {
  const releasesOnly = tag && candidate(tag) ? [] : ['--exclude', 'v*-rc.*'];
  return git(cwd, 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ...releasesOnly, tag ? `${tag}^` : 'HEAD');
}

/**
 * The commits since the version tag before `tag` (or the last one, up to HEAD) that change what runs,
 * newest first, each with the demos its trailers link. A trailer naming a file on the machine that
 * made the demo is no link and stays out.
 */
export function commits(cwd: string, tag?: string, since?: string): Commit[] {
  const before = tagBefore(cwd, tag);
  const to = tag ?? 'HEAD';
  const format = '%H%x1f%cs%x1f%s%x1f%(trailers:key=Demo-Video,key=Demo-Page,separator=%x1d)%x1e';
  const out = git(cwd, 'log', '--no-merges', `--format=${format}`, ...(since ? [`--since=${since}`] : []), before ? `${before}..${to}` : to, '--', ...RUNS) ?? '';
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [hash, date, subject, trailers] = r.split('\x1f') as [string, string, string, string?];
    const demos: Demo[] = [];
    for (const t of (trailers ?? '').split('\x1d')) {
      const m = /^Demo-(Video|Page):\s*(https?:\/\/\S+)/i.exec(t.trim());
      if (m && !demos.some((d) => d.url === m[2])) demos.push({ kind: m[1]!.toLowerCase() as Demo['kind'], url: m[2]! });
    }
    return { hash, date, subject, demos };
  });
}

/** What `commits` prints: the commits grouped by their demo, those without one after them. */
export function material(list: Commit[], range: string): string {
  const byDemo = new Map<string, { demo: Demo; commits: Commit[] }>();
  for (const c of list) for (const d of c.demos) {
    const entry = byDemo.get(d.url) ?? byDemo.set(d.url, { demo: d, commits: [] }).get(d.url)!;
    entry.commits.push(c);
  }
  const line = (c: Commit) => `  - ${c.date} ${c.hash.slice(0, 8)} ${c.subject}`;
  const out = [`# ${range}: ${list.length} commits that change what runs, ${byDemo.size} demos`, ''];
  out.push('## With a demo', '');
  for (const { demo, commits } of byDemo.values()) out.push(`- ${demo.kind} ${demo.url}`, ...commits.map(line));
  const without = list.filter((c) => !c.demos.length);
  out.push('', '## Without a demo', '', ...without.map((c) => line(c).slice(2)));
  return `${out.join('\n')}\n`;
}

/** The version of a tag or a version: v0.1.0 → 0.1.0. */
const version = (tag: string) => tag.replace(/^v/, '');

/**
 * The section of CHANGELOG.md for `tag`'s version, without its heading (`## 0.1.0 — 2026-11-17`),
 * up to the next version's; null when there is none.
 */
export function section(changelog: string, tag: string): string | null {
  const v = version(tag).replaceAll('.', '\\.');
  const m = new RegExp(`^## \\[?v?${v}\\]?(?![\\w.-]).*$`, 'm').exec(changelog);
  if (!m) return null;
  const rest = changelog.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  return body || null;
}

/**
 * Why `tag` makes no release, or null: it must be v<package.json's version>, with its section in
 * CHANGELOG.md; a release candidate (v<x.y.z>-rc.<n>) needs no section.
 */
export function check(cwd: string, tag: string): string | null {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version as string;
  if (!/^v\d+\.\d+\.\d+$/.test(tag) && !candidate(tag)) return `tag ${tag} is neither v<x.y.z> nor a release candidate v<x.y.z>-rc.<n>`;
  if (tag !== `v${pkg}`) return `tag ${tag}, but package.json says v${pkg}`;
  if (candidate(tag)) return null;
  const file = join(cwd, 'CHANGELOG.md');
  if (!existsSync(file) || !section(readFileSync(file, 'utf8'), tag)) return `CHANGELOG.md has no section "## ${pkg}" (docs/release.md)`;
  return null;
}

/** Goes under the changelog's section in every release. */
export const INSTALL =
  'The Mac apps are signed and notarised. The Windows installer and the Linux packages are not signed: ' +
  'SmartScreen warns about the installer ("More info", then "Run anyway"). Every file\'s SHA-256 is in ' +
  '`SHA256SUMS`: `sha256sum --check --ignore-missing SHA256SUMS` beside the download, or ' +
  '`Get-FileHash Seismic-Windows-x64-setup.exe` in PowerShell.';

/** How many commits the folded list names at most; GitHub takes 125,000 characters of notes. */
const COMMITS_LISTED = 300;

/**
 * The release's notes: the version's section of CHANGELOG.md, how to install, and the commits since
 * the version tag before that change what runs, folded, each linked with its demo. The first
 * release would fold the whole history, so it links it instead. A release candidate's start with
 * what it is, its section after that when CHANGELOG.md has one.
 */
export function notes(cwd: string, tag: string, repo: string, changelog: string): string {
  const text = section(changelog, tag);
  const target = candidate(tag);
  if (!text && !target) throw new Error(`CHANGELOG.md has no section for ${tag}`);
  const out = target
    ? [
        `Release candidate ${CANDIDATE.exec(tag)![2]} for Seismic ${target}, for trying it out before it is released. ` +
          'Installed apps are not offered it as an update; once installed, it updates to the next release.',
        ...(text ? ['', text] : []),
      ]
    : [text!];
  out.push('', '### Installing', '', INSTALL, '');
  const before = tagBefore(cwd, tag);
  if (!before) {
    out.push(`[All commits](https://github.com/${repo}/commits/${tag}) up to this first release.`);
    return `${out.join('\n')}\n`;
  }
  const list = commits(cwd, tag);
  const shown = list.slice(0, COMMITS_LISTED).map((c) => {
    const demo = c.demos[0] ? ` · [demo](${c.demos[0].url})` : '';
    return `- ${c.subject} ([${c.hash.slice(0, 7)}](https://github.com/${repo}/commit/${c.hash}))${demo}`;
  });
  const compare = `https://github.com/${repo}/compare/${before}...${tag}`;
  out.push('<details>', `<summary>All commits since ${before} (${list.length})</summary>`, '', ...shown);
  out.push('', list.length > COMMITS_LISTED ? `… and ${list.length - COMMITS_LISTED} more: [the full comparison](${compare}).` : `[The full comparison](${compare}).`);
  out.push('', '</details>');
  return `${out.join('\n')}\n`;
}

const item = (l: string) => /^\s*[-*] /.test(l);

/** The lines of Markdown with each paragraph and list entry on one, as it reads; blank lines go. */
function unwrap(text: string): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of text.trim().split('\n')) {
    const l = raw.trim();
    if (!l) open = false;
    else if (open && !item(l) && !l.startsWith('#')) out[out.length - 1] += ` ${l}`;
    else {
      out.push(item(raw) ? raw.trimEnd() : l);
      open = !l.startsWith('#');
    }
  }
  return out;
}

/** latest.json for Tauri's updater, from the signed update artifacts in `dir`, with the start of `changes` (the section) for the bar. */
export function latest(dir: string, tag: string, repo: string, now = new Date(), changes?: string): Latest {
  const platforms: Latest['platforms'] = {};
  for (const { platform, update } of Object.values(RELEASE)) {
    const sig = join(dir, `${update.name}.sig`);
    if (!existsSync(join(dir, update.name)) || !existsSync(sig)) continue;
    platforms[platform] = {
      url: `https://github.com/${repo}/releases/download/${tag}/${update.name}`,
      signature: readFileSync(sig, 'utf8').trim(),
    };
  }
  const lines = unwrap(changes ?? '');
  let shown = lines;
  if (lines.length > NOTES_SHOWN) {
    shown = lines.slice(0, NOTES_SHOWN - 1);
    // a heading cut off from its entries says nothing
    while (shown.length && /^#/.test(shown.at(-1)!)) shown.pop();
    const more = lines.slice(shown.length).filter(item).length;
    if (more) shown.push(`- … and ${more} more`);
  }
  return { version: version(tag), ...(shown.length ? { notes: shown.join('\n') } : {}), pub_date: now.toISOString().replace(/\.\d+Z$/, 'Z'), platforms };
}

/** SHA256SUMS as `sha256sum` writes it, over the files in `dir` (but itself). */
export function sums(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f !== 'SHA256SUMS')
    .sort()
    .map((f) => `${new Bun.CryptoHasher('sha256').update(readFileSync(join(dir, f))).digest('hex')}  ${f}\n`)
    .join('');
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = resolve(import.meta.dir, '..');
  const changelog = () => readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8');
  if (command === 'collect' && rest[1]) {
    const copied = collect(rest[0]!, join(cwd, 'desktop', 'target', 'release', 'bundle'), resolve(rest[1]));
    for (const f of copied) console.log(f);
  } else if (command === 'commits') {
    const at = rest.indexOf('--since');
    const since = at >= 0 ? rest[at + 1] : undefined;
    const tag = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--since');
    const before = tagBefore(cwd, tag);
    const range = `${before ? `Since ${before}` : 'The whole history'}${since ? ` (from ${since})` : ''} up to ${tag ?? 'HEAD'}`;
    process.stdout.write(material(commits(cwd, tag, since), range));
  } else if (command === 'check' && rest[0]) {
    const why = check(cwd, rest[0]);
    if (why) {
      console.error(`::error::${why}`);
      process.exit(1);
    }
    console.log(candidate(rest[0]) ? `${rest[0]} is package.json's version, a release candidate` : `${rest[0]} is package.json's version, with its section in CHANGELOG.md`);
  } else if (command === 'section' && rest[1]) {
    const text = section(changelog(), rest[0]!);
    if (!text && candidate(rest[0]!)) writeFileSync(rest[1], '');
    else if (!text) {
      console.error(`CHANGELOG.md has no section for ${rest[0]}`);
      process.exit(1);
    } else writeFileSync(rest[1], `${text}\n`);
  } else if (command === 'notes' && rest[2]) {
    writeFileSync(rest[2], notes(cwd, rest[0]!, rest[1]!, changelog()));
  } else if (command === 'manifest' && rest[2]) {
    const [dirArg, tag, repo, sectionFile] = rest as [string, string, string, string?];
    const dir = resolve(dirArg);
    const manifest = latest(dir, tag, repo, new Date(), sectionFile ? readFileSync(sectionFile, 'utf8') : undefined);
    writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(dir, 'SHA256SUMS'), sums(dir));
    const named = Object.keys(manifest.platforms);
    console.log(`latest.json: ${named.length ? named.join(', ') : 'no platform (the builds had no updater key)'}`);
  } else {
    console.error(
      'usage: bun scripts/release.ts collect <target> <dir> | commits [<tag>] [--since <date>] | check <tag> | section <tag> <file>\n' +
        '         | notes <tag> <owner/repo> <file> | manifest <dir> <tag> <owner/repo> [<section>]',
    );
    process.exit(2);
  }
}
