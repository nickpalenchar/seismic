// Trusting a repository's commands (design: Trusting a repository's commands): what of its own
// files Seismic runs or contacts without a click, or its agents' sessions run outside Claude Code's
// permission checks, counts only as the owner last confirmed it. A command new on the default
// branch, or changed there, is held until the owner confirms it in "Configuration".

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_PATHS, type SharedRead } from '../adapters';
import type { ClaudeFile, RepoCommands, RepoSettings, SharedSettings, TrustGroup } from '../core/types';

const GROUPS: TrustGroup[] = ['app', 'claude', 'codex'];

/** The commands of a repository's `.obeya/settings.json` and Claude Code and Codex settings as read; a group it has none of is left out. */
export function commandsOf(read: Pick<SharedRead, 'settings' | 'claude' | 'codex'> | undefined): RepoCommands {
  const out: RepoCommands = {};
  const { stop, keep } = read?.settings?.app ?? {};
  if (stop?.trim() || keep?.trim()) out.app = { ...(stop?.trim() ? { stop } : {}), ...(keep?.trim() ? { keep } : {}) };
  if (read?.claude && Object.keys(read.claude).length) out.claude = read.claude;
  if (read?.codex && Object.keys(read.codex).length) out.codex = read.codex;
  return out;
}

/** JSON with every object's keys in order, so that the same commands read the same however they were written down. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * The groups of `now` that do not count: each differs from what the owner confirmed (`trusted`;
 * nothing yet: every group is new), unless this machine's settings (`mine`) set all of it, which
 * then applies instead and needs no confirming.
 */
export function heldGroups(now: RepoCommands, trusted: RepoCommands | null, mine?: RepoSettings): TrustGroup[] {
  const covered = (g: TrustGroup) => (g === 'app' ? mine?.app?.stop !== undefined && mine.app.keep !== undefined : false);
  return GROUPS.filter((g) => now[g] !== undefined && !covered(g) && !same(now[g], trusted?.[g]));
}

/** What is trusted once the owner trusted the groups `held` of `now`, as the dialog showed them: those groups as they are now, the others as trusted before. */
export function trustHeld(trusted: RepoCommands | null, now: RepoCommands, held: TrustGroup[]): RepoCommands {
  const next: RepoCommands = { ...trusted };
  for (const g of held) (next as Record<TrustGroup, unknown>)[g] = now[g];
  return next;
}

/** The repository's settings without what `held` holds: those fields then come from this machine or the defaults. */
export function withoutHeld(s: SharedSettings | undefined, held: TrustGroup[]): SharedSettings | undefined {
  if (!s) return s;
  const out = { ...s };
  if (held.includes('app') && s.app) {
    const { stop: _, keep: __, ...app } = s.app;
    if (Object.keys(app).length) out.app = app;
    else delete out.app;
  }
  return out;
}

/**
 * The repository's `.obeya/settings.json` now holds this machine's values (`after`, taken over
 * for everyone, see `Config.takenOver`): a group of commands that holds only what the owner set
 * here (`mine`) or confirmed before is theirs and needs no confirming. Returns what is trusted then,
 * or null where that changes nothing.
 */
export function trustTakenOver(trusted: RepoCommands | null, after: SharedSettings, mine: RepoSettings | undefined): RepoCommands | null {
  const now = commandsOf({ settings: after });
  const own = commandsOf({ settings: { ...(mine?.app ? { app: mine.app } : {}), ...(mine?.demo ? { demo: mine.demo } : {}) } });
  const next: RepoCommands = { ...trusted };
  let changed = false;
  const app = now.app;
  // each of the two is the owner's or trusted; one that went, though trusted, needs confirming: a stop without its keep could stop what it kept
  const theirs = (f: 'stop' | 'keep') => (app?.[f] === undefined ? trusted?.app?.[f] === undefined : app[f] === own.app?.[f] || app[f] === trusted?.app?.[f]);
  if (app && !same(app, trusted?.app) && theirs('stop') && theirs('keep')) {
    next.app = app;
    changed = true;
  }
  return changed ? next : null;
}

/** A file's contents as git names them (its blob's object id; SHA-256 in a repository whose ids are that long), so that a workstation's file compares with one read from a commit. */
function blobId(bytes: Uint8Array, sha256: boolean): string {
  return new Bun.CryptoHasher(sha256 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * Whether the Codex configuration of the workstation `dir` (everything under its `.codex/`, as the
 * files are now, a change of the card's own included) is to the byte what the owner trusted
 * (`trusted`, by git object). None trusted, or none in the workstation, is no match: there is nothing
 * to load. Nor is one with a symbolic link: Codex reads the file it points to, which may lie where
 * the agent can write and which the owner never saw.
 */
export function codexAsTrusted(dir: string, trusted: Record<string, ClaudeFile> | undefined): boolean {
  if (!trusted || !Object.keys(trusted).length) return false;
  const sha256 = Object.values(trusted).some((f) => f.id.length === 64);
  const files = new Map<string, string>();
  const add = (rel: string) => {
    const abs = join(dir, rel);
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error(`${rel} is a symbolic link`);
    if (stat.isDirectory()) for (const name of readdirSync(abs)) add(`${rel}/${name}`);
    else files.set(rel, blobId(readFileSync(abs), sha256));
  };
  try {
    for (const p of CODEX_PATHS) add(p);
  } catch {
    return false;
  }
  const want = Object.entries(trusted);
  return files.size === want.length && want.every(([f, { id }]) => files.get(f) === id);
}
