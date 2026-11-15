/**
 * Whether files are there, for code that builds a snapshot and cannot wait for the disk. A path is
 * looked at once, when it is first asked for; after that the answer comes from memory, and `refresh`
 * looks at every path asked for lately again, off the event loop, and says when an answer changed.
 * So a snapshot makes no file system call for a file it has seen.
 */

import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';

/** Whether a file is there. */
export type Present = (path: string) => boolean;

export class FilePresence {
  private known = new Map<string, boolean>();
  /** When each path was last asked for: one nobody asked for in a while is forgotten, so the paths of cards long gone do not pile up. */
  private asked = new Map<string, number>();
  private running: Promise<void> | null = null;
  /** The look that follows the running one, shared by every refresh asked for meanwhile. */
  private queued: Promise<void> | null = null;
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `flipped`: called once a refresh found a file that came or went; a path is forgotten once nobody asked for it for `forgetAfterMs`. */
  constructor(private flipped: () => void, private forgetAfterMs = 10 * 60_000) {}

  /** Whether the file is there, as last seen. */
  there: Present = (path) => {
    this.asked.set(path, Date.now());
    let is = this.known.get(path);
    if (is === undefined) {
      is = existsSync(path);
      this.known.set(path, is);
    }
    return is;
  };

  /** `refresh`, at most once in `gapMs`: for code that runs often (every change of a card), where a file may have come or gone with it. */
  refreshSoon(gapMs = 1000): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.last = Date.now();
      void this.refresh();
    }, Math.max(0, this.last + gapMs - Date.now()));
    this.timer.unref?.();
  }

  /**
   * Looks at the paths asked for again without blocking the server. One asked for while a look runs
   * is a look of its own after it, which every such ask shares and waits for: a file that came or
   * went during the running look is seen by the time it resolves.
   */
  refresh(): Promise<void> {
    if (this.queued) return this.queued;
    if (!this.running) return this.start();
    const queued = this.running.catch(() => {}).then(() => {
      this.queued = null;
      return this.start();
    });
    this.queued = queued;
    return queued;
  }

  private start(): Promise<void> {
    const run = this.check().finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private async check() {
    const stale = Date.now() - this.forgetAfterMs;
    for (const [p, at] of this.asked) {
      if (at >= stale) continue;
      this.asked.delete(p);
      this.known.delete(p);
    }
    const paths = [...this.known.keys()];
    const now = await Promise.all(paths.map((p) => access(p).then(() => true, () => false)));
    let changed = false;
    paths.forEach((p, i) => {
      // forgotten or looked at by `there` meanwhile: that answer stands
      if (this.known.get(p) === undefined || this.known.get(p) === now[i]) return;
      this.known.set(p, now[i]!);
      changed = true;
    });
    if (changed) this.flipped();
  }
}
