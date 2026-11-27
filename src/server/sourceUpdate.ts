







import { inert } from '../core/inert';
import type { SourceUpdate } from '../core/types';
import { BadRequest } from './board';
import { spawnOutput } from './spawn';
import { GIT } from './workstations';


export const FETCH_EVERY_MS = 60 * 60_000;

const FETCH_TIMEOUT_MS = 60_000;

const SHOWN = 10;

type Git = (...args: string[]) => Promise<{ ok: boolean; out: string }>;

export class SourceUpdates {
  private last: SourceUpdate | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking: Promise<void> | null = null;
  private pulling = false;
  private readonly git: Git;

  constructor(
    readonly checkout: string,
    private o: { fetchEveryMs?: number } = {},
  ) {
    this.git = async (...args) => {
      const r = await spawnOutput([GIT, '-C', checkout, ...args], {
        stdin: 'ignore',
        
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: FETCH_TIMEOUT_MS,
      });
      return { ok: r.code === 0, out: (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim() };
    };
  }

  /** Looks now, and again every hour; returns what stops it. */
  start(): () => void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.o.fetchEveryMs ?? FETCH_EVERY_MS);
    this.timer.unref?.();
    return () => clearInterval(this.timer);
  }

  /** The new commits there are to pull, while there are. */
  current(): SourceUpdate | null {
    return this.last;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fetches the upstream (unless `fetch` is false) and works out what waits there; one check at a time. */
  check(fetch = true): Promise<void> {
    this.checking ??= this.look(fetch).finally(() => (this.checking = null));
    return this.checking;
  }

  /**
   * The owner's "git pull": fetches once more and fast-forwards the checkout to its upstream. What
   * git refuses stays on the update (`error`) for the bar to show; nothing there to pull, or a pull
   * that cannot be a fast-forward, is refused.
   */
  async pull(): Promise<void> {
    if (this.pulling) return;
    await this.check();
    const u = this.last;
    if (!u) throw new BadRequest('invalid', 'nothing to pull');
    if (u.blocked) throw new BadRequest('invalid', `${u.upstream} cannot be pulled by Seismic: ${u.blocked.why}`);
    this.pulling = true;
    try {
      const r = await this.git('merge', '--ff-only', '--quiet', '@{upstream}');
      if (!r.ok) return this.set({ ...u, error: r.out || 'git merge --ff-only failed' });
      console.log(`Seismic: pulled ${u.count} ${u.count === 1 ? 'commit' : 'commits'} from ${u.upstream} into ${this.checkout}`);
      await this.check(false);
    } finally {
      this.pulling = false;
    }
  }

  private async look(fetch: boolean) {
    const upstream = await this.git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
    
    if (!upstream.ok) return this.set(null);
    if (fetch) await this.fetch();
    const count = Number((await this.git('rev-list', '--count', 'HEAD..@{upstream}')).out) || 0;
    if (!count) return this.set(null);
    
    const changed = (await this.git('-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD...@{upstream}')).out.split('\n').filter(Boolean);
    if (!changed.some((f) => !inert(f))) return this.set(null);
    const log = await this.git('log', `-n${SHOWN}`, '--format=%ct%x09%s', 'HEAD..@{upstream}');
    const commits = log.out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        return { subject: line.slice(tab + 1), date: Number(line.slice(0, tab)) * 1000 };
      });
    const update: SourceUpdate = { upstream: upstream.out, checkout: this.checkout, count, commits };
    const blocked = await this.blocked();
    if (blocked) update.blocked = blocked;
    
    if (this.last?.error && this.last.count === count && JSON.stringify(this.last.blocked) === JSON.stringify(blocked)) update.error = this.last.error;
    this.set(update);
  }

  /** Why a fast-forward to the upstream would not go, if it would not. */
  private async blocked(): Promise<SourceUpdate['blocked'] | undefined> {
    if (!(await this.git('merge-base', '--is-ancestor', 'HEAD', '@{upstream}')).ok) return { why: 'diverged' };
    const theirs = new Set((await this.git('-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD', '@{upstream}')).out.split('\n').filter(Boolean));
    
    const mine = (await this.git('-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD')).out.split('\n').filter(Boolean);
    const files = mine.filter((f) => theirs.has(f));
    return files.length ? { why: 'local', files } : undefined;
  }

  /** Fetches the branch the upstream is (`refs/remotes/<remote>/<branch>`) and nothing else, without FETCH_HEAD, as the read checkout does. */
  private async fetch() {
    const branch = (await this.git('symbolic-ref', '--quiet', '--short', 'HEAD')).out;
    const remote = (await this.git('config', `branch.${branch}.remote`)).out;
    const merge = (await this.git('config', `branch.${branch}.merge`)).out;
    const tracking = (await this.git('rev-parse', '--symbolic-full-name', '@{upstream}')).out;
    
    if (!remote || remote === '.' || !merge || !tracking.startsWith('refs/remotes/')) return;
    const r = await this.git('fetch', '--quiet', '--no-write-fetch-head', remote, `+${merge}:${tracking}`);
    if (!r.ok) console.error(`Seismic: git fetch ${remote} in ${this.checkout}: ${r.out}`);
  }

  private set(update: SourceUpdate | null) {
    if (JSON.stringify(update) === JSON.stringify(this.last)) return;
    this.last = update;
    for (const fn of this.listeners) fn();
  }
}
