



import type { AppUpdate } from '../core/types';
import { BadRequest } from './board';


const RELEASES = 'https://github.com/nickpalenchar/seismic/releases/';




const UPDATES_ENABLED = true;


const FRESH_MS = 10_000;

export class AppUpdates {
  private last: AppUpdate | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();

  /** `enabled` is for the tests of the switch. */
  constructor(private enabled = UPDATES_ENABLED) {}

  report(input: unknown): AppUpdate | null {
    if (!this.enabled) return null;
    const u = (input ?? {}) as Partial<Record<keyof AppUpdate, unknown>>;
    const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
    const version = text(u.version);
    if (!version) throw new BadRequest('invalid', 'version expected');
    const update: AppUpdate = { version };
    const notes = text(u.notes);
    if (notes) update.notes = notes;
    if (typeof u.date === 'number' && Number.isFinite(u.date)) update.date = u.date;
    const download = text(u.download);
    
    if (download?.startsWith(RELEASES)) update.download = download;
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => this.set(null), FRESH_MS);
    this.expiry.unref?.();
    this.set(update);
    return update;
  }

  /** The update the shell has ready, while it reports one. */
  current(): AppUpdate | null {
    return this.last;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(update: AppUpdate | null) {
    if (JSON.stringify(update) === JSON.stringify(this.last)) return;
    this.last = update;
    for (const fn of this.listeners) fn();
  }
}


const HANDED_OVER_MS = 2 * 60_000;

/**
 * What the page in the app's window keeps across its shell starting again while the server runs
 * on (a new build of a shell installed from a checkout, desktop/src/update.rs). A reload keeps it in
 * the tab's session storage (keep.ts, draft.ts), which the new shell's webview starts without: the
 * page hands it over here first (`token`: which time the shell asked), and the page the new shell
 * opens reads it back. The copy stays until that page says it took it (`taken`): a read cut short
 * at startup leaves it for the next load of the page rather than losing it.
 */
export class HandOver {
  private kept = new Map<string, { token: string; entries: [string, string][]; at: number }>();

  give(scope: string, input: unknown) {
    const { token, entries } = (input ?? {}) as { token?: unknown; entries?: unknown };
    const pair = (e: unknown): e is [string, string] => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string';
    if (typeof token !== 'string' || !Array.isArray(entries) || !entries.every(pair)) throw new BadRequest('invalid', 'token and entries expected');
    const at = Date.now();
    for (const [key, saved] of this.kept) if (at - saved.at >= HANDED_OVER_MS) this.kept.delete(key);
    this.kept.set(scope, { token, entries, at });
  }

  /** Whether the page handed over when the shell asked with `token`. */
  has(scope: string, token: unknown): boolean {
    return typeof token === 'string' && this.kept.get(scope)?.token === token;
  }

  /** What the page handed over, while it is recent enough, with the token that names this copy. */
  read(scope: string, now = Date.now()): { token: string; entries: [string, string][] } | null {
    const kept = this.kept.get(scope);
    if (kept && now - kept.at < HANDED_OVER_MS) return { token: kept.token, entries: kept.entries };
    this.kept.delete(scope);
    return null;
  }

  /** The page of the new shell took the copy named `token`; a newer one stays. */
  taken(scope: string, token: unknown) {
    if (typeof token === 'string' && this.kept.get(scope)?.token === token) this.kept.delete(scope);
  }
}
