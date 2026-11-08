import { serverExtensions as extensions } from '../extensions/server';
import { defaultBranchCommit } from '../server/read-tree';
import { onGitHub } from '../server/repo';
import { HANDOVER_ARTIFACTS } from '../../plugin/skills/demo/lib/artifacts.ts';
import { type ClaudeFile, type HandoverArtifact, isNested, SHARED_FIELDS, type NESTED_SETTINGS, type NestedSetting, type RepoSettings, type RepoValues, type SharedSettings } from '../core/types';
import { detectedBranch, type GitSteps, gitStepsSync, isFolder } from '../server/workstations';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generic } from './generic';
import { checkShared } from './schema';
import type { RepoAdapter, RepoInfo } from './types';
import { messageOf } from '../core/text';

/** Where a repository kept an adapter module before its settings said it all (`hasAdapterModule`). */
export const REPO_ADAPTER_DIR = '.obeya/adapter';

/** Seismic's defaults for the repository: what it runs on where its settings say nothing. */
export const defaultsFor = (repo: RepoInfo): RepoAdapter => ({ ...generic, land: detectedLand(repo) });

/**
 * How work lands where the settings do not say: through pull requests where `origin` is on GitHub
 * (`onGitHub`), else on the main branch of the checkout, since a pull request needs somewhere to go.
 */
export const detectedLand = (repo: RepoInfo): RepoAdapter['land'] => (repo.remote && onGitHub(repo.remote) ? 'pr' : 'main');

/** The fields of the settings read each time they are asked for: all but `workstations`. */
const LIVE = SHARED_FIELDS.filter((f) => f !== 'workstations');

/**
 * The repository's settings (`RepoSettings`: its `.obeya/settings.json` with this machine's in
 * front) in front of the defaults, each read from `settings` whenever it is asked for, so that a
 * changed value applies without a restart. `workstations` is read once: clones or worktrees are set
 * up when the canvas starts. Clones the configuration names (`clones`) go before the setting.
 */
export function withSettings(a: RepoAdapter, settings: () => RepoSettings | undefined, clones = false): RepoAdapter {
  const set = settings()?.workstations;
  const b: RepoAdapter = { ...a, workstations: clones ? 'clones' : (set ?? a.workstations) };
  for (const field of LIVE)
    Object.defineProperty(b, field, {
      enumerable: true,
      get: () => {
        const s = settings();
        if (isNested(field)) return s?.[field] || a[field] ? { ...a[field], ...s?.[field] } : undefined;
        return s?.[field] ?? a[field];
      },
    });
  for (const field of extensions.flatMap((e) => Object.keys(e.settings ?? {}))) {
    Object.defineProperty(b, field, { enumerable: true, get: () => (settings() as Record<string, unknown> | undefined)?.[field] });
  }
  return b;
}

/**
 * The repository's settings as they stand without this machine's, with where each comes from: its
 * `.obeya/settings.json` (`shared`), the clones the configuration names, detection, the defaults.
 */
export function repoValues(repo: RepoInfo, clones = false, shared: SharedSettings = {}, detected = detectedBranch(repo.path), artifacts: HandoverArtifact[] = [...HANDOVER_ARTIFACTS]): RepoValues {
  const a = defaultsFor(repo);
  const value = <K extends Exclude<keyof SharedSettings, NestedSetting>, T>(v: T, field: K) =>
    shared[field] !== undefined ? { value: shared[field] as T, source: 'repository' as const } : { value: v, source: field === 'land' ? ('detected' as const) : ('default' as const) };
  // a field of `app` or `demo` from the repository, else none
  const nested = <K extends NestedSetting, F extends (typeof NESTED_SETTINGS)[K][number], T>(k: K, f: F, none: T) => {
    const v = (shared[k] as Record<string, unknown> | undefined)?.[f];
    return v !== undefined ? { value: v as T, source: 'repository' as const } : { value: none, source: 'default' as const };
  };
  const extra = Object.fromEntries(extensions.flatMap((e) => Object.keys(e.settings ?? {})).flatMap((key) => {
    const v = (shared as Record<string, unknown>)[key];
    return v === undefined ? [] : [[key, { value: v, source: 'repository' as const }]];
  }));
  return {
    ...extra,
    branch: { value: detected, source: 'detected' },
    land: value(a.land, 'land'),
    direct: value(!!a.direct, 'direct'),
    autoMerge: value(a.autoMerge ?? true, 'autoMerge'),
    checks: value(a.checks ?? [], 'checks'),
    setup: value(a.setup ?? '', 'setup'),
    planDocs: value(a.planDocs, 'planDocs'),
    softPaths: value(a.softPaths, 'softPaths'),
    workstations: clones ? { value: 'clones', source: 'clones' } : value(a.workstations, 'workstations'),
    prNoise: value(a.prNoise ?? [], 'prNoise'),
    language: value(a.language, 'language'),
    app: { run: nested('app', 'run', ''), stop: nested('app', 'stop', ''), keep: nested('app', 'keep', '') },
    demo: { language: nested('demo', 'language', null), artifacts: nested('demo', 'artifacts', artifacts) },
  };
}

/** Where a repository keeps its settings for everyone (`SharedSettings`), like `.vscode/settings.json`. */
export const REPO_SETTINGS_FILE = '.obeya/settings.json';

/** A repository's `.obeya/settings.json` as read: its settings that count, the file's own object, and what does not count. */
export interface SharedRead {
  settings?: SharedSettings;
  /** The object the file holds, every field as it is; none where there is no file or it is no JSON object. */
  raw?: Record<string, unknown>;
  problems: string[];
  /** The repository's own Claude Code configuration on the default branch, by file (`CLAUDE_PATHS`); none where it has none. */
  claude?: Record<string, ClaudeFile>;
  /** The repository's own Codex configuration on the default branch, by file (`CODEX_PATHS`); none where it has none. */
  codex?: Record<string, ClaudeFile>;
  /** The git tree of `.obeya/` on the default branch, which its theme is read from (theme.ts); none where it has none, or the repository is a folder without git. */
  obeyaTree?: string;
}

/**
 * Where a repository keeps its own Claude Code configuration: an agent's session working in it reads
 * it and runs what it names outside the permission checks (the hooks, MCP servers and helpers of
 * `.claude/settings.json`; the hooks and MCP servers of its skills, commands and subagents; `.mcp.json`).
 */
export const CLAUDE_PATHS = ['.claude', '.mcp.json'];

/**
 * Where a repository keeps its own Codex configuration: a Codex session that loads it runs what it
 * names (its `config.toml`'s hooks and MCP servers, its rules) outside Codex's sandbox and approvals.
 */
export const CODEX_PATHS = ['.codex'];

/** The files of `files` (by path, sorted) as the configuration of each harness, those of none left out. */
function byHarness(files: [string, ClaudeFile][]): Pick<SharedRead, 'claude' | 'codex'> {
  const of = (paths: string[]) => files.filter(([f]) => paths.some((p) => f === p || f.startsWith(`${p}/`)));
  const claude = of(CLAUDE_PATHS);
  const codex = of(CODEX_PATHS);
  return { ...(claude.length ? { claude: Object.fromEntries(claude) } : {}), ...(codex.length ? { codex: Object.fromEntries(codex) } : {}) };
}

/** Reads the text of a `.obeya/settings.json`: a field that is unknown or of the wrong type does not count, the rest does. */
export function parseShared(text: string): SharedRead {
  let made: unknown;
  try {
    made = JSON.parse(text);
  } catch (e) {
    return { problems: [`${REPO_SETTINGS_FILE} is no JSON: ${messageOf(e)}`] };
  }
  if (!made || typeof made !== 'object' || Array.isArray(made)) return { problems: [`${REPO_SETTINGS_FILE} holds no JSON object`] };
  const raw = made as Record<string, unknown>;
  const { settings, problems } = checkShared(raw);
  return { settings, raw, problems: problems.map((p) => `${REPO_SETTINGS_FILE}, ${p}`) };
}

/**
 * The repository's `.obeya/settings.json` as its default branch has it at `commit` (by
 * `defaultBranchCommit`'s rule), not as the checkout has it, which is on a card's branch most of
 * the time; nothing where the default branch has no such file.
 */
export function readShared(repoPath: string, commit = defaultBranchCommit(repoPath).commit): SharedRead {
  if (isFolder(repoPath)) return readSharedFiles(repoPath);
  return gitStepsSync(repoPath, readingShared(commit));
}

/** `readShared` of a folder without git: its `.obeya/settings.json` and Claude Code and Codex configuration as the folder has them. */
export function readSharedFiles(dir: string): SharedRead {
  const file = join(dir, REPO_SETTINGS_FILE);
  const read: SharedRead = existsSync(file) ? parseShared(readFileSync(file, 'utf8')) : { problems: [] };
  const files: string[] = [];
  const add = (rel: string) => {
    const abs = join(dir, rel);
    try {
      if (statSync(abs).isDirectory()) for (const name of readdirSync(abs)) add(`${rel}/${name}`);
      else files.push(rel);
    } catch {}
  };
  for (const p of [...CLAUDE_PATHS, ...CODEX_PATHS]) add(p);
  if (!files.length) return read;
  return {
    ...read,
    ...byHarness(
      files.sort().map((f) => {
        const text = readFileSync(join(dir, f), 'utf8');
        return [f, { id: Bun.hash(text).toString(16), text }];
      }),
    ),
  };
}

/** `readShared` at `commit` as git steps, with the repository's Claude Code and Codex configuration beside it. */
export function* readingShared(commit: string): GitSteps<SharedRead> {
  const [text, listed, tree] = yield [
    ['cat-file', 'blob', `${commit}:${REPO_SETTINGS_FILE}`],
    ['ls-tree', '-r', '-z', commit, '--', ...CLAUDE_PATHS, ...CODEX_PATHS],
    ['rev-parse', '--verify', '-q', `${commit}:.obeya`],
  ];
  const read: SharedRead = { ...(text != null ? parseShared(text) : { problems: [] }), ...(tree ? { obeyaTree: tree } : {}) };
  // `<mode> <type> <object>\t<path>`: a blob's text is read (trimmed, for reading: its object tells
  // contents apart), a submodule's commit stands for what it holds
  const entries = (listed ?? '')
    .split('\0')
    .flatMap((e) => {
      const m = e.match(/^\S+ (\S+) (\S+)\t(.+)$/s);
      return m ? [{ type: m[1]!, id: m[2]!, file: m[3]! }] : [];
    })
    .sort((a, b) => (a.file < b.file ? -1 : 1));
  if (!entries.length) return read;
  const blobs = entries.filter((e) => e.type === 'blob');
  const texts = blobs.length ? yield blobs.map((e) => ['cat-file', 'blob', e.id]) : [];
  return { ...read, ...byHarness(entries.map((e) => [e.file, { id: e.id, text: e.type === 'blob' ? (texts[blobs.indexOf(e)] ?? '') : `(${e.type} ${e.id})` }])) };
}

/**
 * Whether the repository's main branch still has a `.obeya/adapter/index.ts`: a module that said
 * what its settings say now, which Seismic no longer reads (problem `adapterGone`).
 */
export function hasAdapterModule(repoPath: string, commit = defaultBranchCommit(repoPath).commit): boolean {
  if (isFolder(repoPath)) return false;
  return gitStepsSync(repoPath, readingAdapterModule(commit));
}

/** `hasAdapterModule` at `commit` as git steps. */
export function* readingAdapterModule(commit: string): GitSteps<boolean> {
  const [found] = yield [['cat-file', '-e', `${commit}:${REPO_ADAPTER_DIR}/index.ts`]];
  return found != null;
}
