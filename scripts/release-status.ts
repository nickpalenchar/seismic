
















import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { distributionPaused } from './distribution';
import { CHECKOUT, ghEnv } from './gh';
import { candidate, RELEASE, RUNS, section, type Latest } from './release';

const MAIN = 'main';

export const SECRETS = ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_NOTARY_KEY', 'APPLE_NOTARY_KEY_ID', 'TAURI_SIGNING_PRIVATE_KEY'];


export type Gh = (args: string[]) => string | null;

type Commit = { hash: string; date: string; subject: string };

export type Status = {
  
  version: string;
  
  tag?: { name: string; date: string };
  
  changes: Commit[];
  commits: number;
  
  propose: string;
  
  tagTaken: boolean;
  
  changelog: boolean;
  
  github: { behind: number | null; ahead: number | null } | null;
  
  latest: string | null;
  drafts: string[];
  
  missing: string[] | null;
  
  problems: string[];
};

const git = (cwd: string, ...args: string[]): string | null => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

const commits = (out: string | null): Commit[] =>
  (out ?? '').split('\n').filter(Boolean).map((l) => {
    const [hash, date, ...subject] = l.split('\t');
    return { hash: hash!, date: date!, subject: subject.join('\t') };
  });

/** The next minor version: 0.1.0 → 0.2.0 (while the version is 0.x a minor bump is a release). */
export function nextVersion(v: string): string {
  const [major, minor] = v.replace(/^v/, '').split('.').map(Number);
  return `${major}.${(minor ?? 0) + 1}.0`;
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, '').split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) > (y![i] ?? 0);
  return false;
};

type GhRelease = { tag_name: string; draft: boolean; prerelease: boolean; body?: string; assets: { name: string }[] };

function releases(gh: Gh): GhRelease[] | null {
  const out = gh(['api', 'repos/{owner}/{repo}/releases']);
  return out === null ? null : JSON.parse(out);
}

export function status(cwd: string, gh: Gh): Status {
  const problems: string[] = [];
  const off = distributionPaused('Releasing');
  if (off) problems.push(off);
  const version = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version as string;

  const tagName = git(cwd, 'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--exclude', 'v*-rc.*', MAIN);
  const tag = tagName ? { name: tagName, date: git(cwd, 'log', '-1', '--format=%cI', tagName)! } : undefined;
  const range = tagName ? `${tagName}..${MAIN}` : MAIN;
  const changes = commits(git(cwd, 'log', '--no-merges', '--format=%h%x09%cI%x09%s', range, '--', ...RUNS));
  const all = Number(git(cwd, 'rev-list', '--count', range) ?? 0);
  const released = candidate(version) ?? version;
  const propose = !tagName || newer(released, tagName) ? released : nextVersion(tagName);
  if (tagName && !changes.length) problems.push(`Nothing that runs changed since ${tagName}.`);

  const remoteTags = git(cwd, 'ls-remote', '--tags', 'origin', `refs/tags/v${propose}`);
  const tagTaken = git(cwd, 'rev-parse', '--verify', '--quiet', `refs/tags/v${propose}`) !== null || !!remoteTags;
  if (tagTaken) problems.push(`The tag v${propose} exists already.`);
  const log = git(cwd, 'show', `${MAIN}:CHANGELOG.md`);
  const changelog = !!log && section(log, propose) !== null;

  
  const theirs = git(cwd, 'ls-remote', 'origin', `refs/heads/${MAIN}`)?.split('\t')[0];
  let github: Status['github'] = null;
  if (!theirs) problems.push(`GitHub's ${MAIN} could not be read.`);
  else {
    const known = git(cwd, 'cat-file', '-e', `${theirs}^{commit}`) !== null;
    const behind = known ? Number(git(cwd, 'rev-list', '--count', `${theirs}..${MAIN}`)) : null;
    const ahead = known ? Number(git(cwd, 'rev-list', '--count', `${MAIN}..${theirs}`)) : null;
    github = { behind, ahead };
    if (ahead !== 0) problems.push(`GitHub's ${MAIN} has commits that ${MAIN} here lacks: fetch and see where they come from before pushing.`);
  }

  const list = releases(gh);
  const latest = list ? (gh(['api', 'repos/{owner}/{repo}/releases/latest', '--jq', '.tag_name']) ?? null) : null;
  const drafts = list?.filter((r) => r.draft && !candidate(r.tag_name)).map((r) => r.tag_name) ?? [];
  if (!list) problems.push(`GitHub's releases could not be read (gh login of the repository's owner?).`);
  if (drafts.length) problems.push(`Drafts left over: ${drafts.join(', ')}.`);

  const secrets = gh(['secret', 'list', '--json', 'name', '--jq', '.[].name']);
  const missing = secrets === null ? null : SECRETS.filter((s) => !secrets.split('\n').includes(s));
  if (missing === null) problems.push('The repository secrets could not be read.');
  else if (missing.length) problems.push(`Secrets missing: ${missing.join(', ')} (docs/release.md).`);

  return { version, tag, changes, commits: all, propose, tagTaken, changelog, github, latest, drafts, missing, problems };
}


const LISTED = 40;

/** A time in the local zone, git's and GitHub's (UTC) alike: 2026-10-12 11:16. */
const day = (iso?: string) => (iso ? new Date(iso).toLocaleString('sv-SE').slice(0, 16) : '?');

export function report(s: Status): string {
  const out: string[] = [];
  const bumped = s.propose === s.version ? ' (package.json has it)' : '';
  out.push(`Version: package.json ${s.version}, last tag ${s.tag ? `${s.tag.name} of ${day(s.tag.date)}` : 'none'}. Propose ${s.propose}${bumped}.`);
  out.push(`CHANGELOG.md on ${MAIN}: ${s.changelog ? `has the section for ${s.propose}` : `no section for ${s.propose} yet (write it from \`bun scripts/release.ts commits\`)`}.`);
  out.push(`Since then: ${s.commits} commits on ${MAIN}, ${s.changes.length} of them change what runs (listed under the changelog section in the notes):`);
  for (const c of s.changes.slice(0, LISTED)) out.push(`  ${c.hash} ${c.date.slice(0, 10)} ${c.subject}`);
  if (s.changes.length > LISTED) out.push(`  … and ${s.changes.length - LISTED} more (\`bun scripts/release.ts commits\` has them all, with their demos)`);
  if (s.github?.ahead === null) out.push(`GitHub: its ${MAIN} has commits never fetched here.`);
  else if (s.github) out.push(`GitHub: its ${MAIN} lacks ${s.github.behind} of ours${s.github.ahead ? `, and has ${s.github.ahead} that ${MAIN} here lacks` : ''}.`);
  out.push(`Releases: the latest is ${s.latest || 'none'}${s.drafts.length ? `; drafts ${s.drafts.join(', ')}` : ''}.`);
  if (s.missing) out.push(`Secrets: ${SECRETS.map((n) => `${n} ${s.missing!.includes(n) ? 'missing' : 'there'}`).join(', ')}.`);
  out.push(s.problems.length ? `\nIn the way:\n${s.problems.map((p) => `- ${p}`).join('\n')}` : '\nNothing in the way.');
  return out.join('\n');
}

/** Every file a release holds, as the build workflow makes it. */
export function expectedAssets(): string[] {
  const names = new Set<string>(['SHA256SUMS', 'latest.json']);
  for (const r of Object.values(RELEASE)) {
    for (const a of r.installers) names.add(a.name);
    names.add(r.update.name);
    names.add(`${r.update.name}.sig`);
  }
  return [...names].sort();
}

/** What the draft for `tag` holds, and what is missing or wrong in it. */
export function draft(tag: string, gh: Gh): { problems: string[]; notes: string; latest?: Latest } {
  const problems: string[] = [];
  const release = releases(gh)?.find((r) => r.tag_name === tag);
  if (!release) return { problems: [`No release ${tag} (yet): has the build run finished?`], notes: '' };
  if (!release.draft) problems.push(`${tag} is published already, not a draft.`);
  const have = release.assets.map((a) => a.name);
  const missing = expectedAssets().filter((n) => !have.includes(n));
  if (missing.length) problems.push(`Missing: ${missing.join(', ')}.`);
  let latest: Latest | undefined;
  const json = have.includes('latest.json') ? gh(['release', 'download', tag, '--pattern', 'latest.json', '--output', '-']) : null;
  if (json !== null) {
    latest = JSON.parse(json) as Latest;
    if (latest.version !== tag.replace(/^v/, '')) problems.push(`latest.json says version ${latest.version}, not ${tag}.`);
    const platforms = Object.values(RELEASE).map((r) => r.platform).filter((p) => !latest!.platforms[p]);
    if (platforms.length) problems.push(`latest.json names no update for ${platforms.join(', ')} (TAURI_SIGNING_PRIVATE_KEY?).`);
  } else if (have.includes('latest.json')) problems.push('latest.json could not be read.');
  return { problems, notes: release.body ?? '', latest };
}

/** gh on the checkout's origin as its owner, without switching the account gh has active (scripts/gh.ts). */
function ghAsOwner(cwd: string): Gh {
  let env: NodeJS.ProcessEnv;
  try {
    env = ghEnv(cwd).env;
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  return (args) => {
    const r = spawnSync('gh', args, { encoding: 'utf8', env, maxBuffer: 64 << 20 });
    return r.status === 0 ? r.stdout.trim() : null;
  };
}

if (import.meta.main) {
  const [command, tag] = process.argv.slice(2);
  const gh = ghAsOwner(CHECKOUT);
  if (command === 'draft' && tag) {
    const d = draft(tag, gh);
    if (d.latest) console.log(`latest.json: ${d.latest.version}, ${Object.keys(d.latest.platforms).join(', ') || 'no platform'}`);
    if (d.notes) console.log(`Notes:\n${d.notes}`);
    console.log(d.problems.length ? `\nIn the way:\n${d.problems.map((p) => `- ${p}`).join('\n')}` : `\nThe draft holds everything (${expectedAssets().length} files).`);
    process.exit(d.problems.length ? 1 : 0);
  } else if (!command) {
    const s = status(CHECKOUT, gh);
    console.log(report(s));
    process.exit(s.problems.length ? 1 : 0);
  } else {
    console.error('usage: bun scripts/release-status.ts [draft <tag>]');
    process.exit(2);
  }
}
