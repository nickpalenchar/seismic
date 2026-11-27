/** One server-side clock wakes every agent whose account reset is due, without asking a model. */
export class LimitWatch {
  private waiting = new Map<object, { at: number; wake: () => void }>();
  private timer?: ReturnType<typeof setTimeout>;

  wait(key: object, at: number, wake: () => void) {
    this.waiting.set(key, { at, wake });
    this.arm();
  }

  cancel(key: object) {
    this.waiting.delete(key);
    this.arm();
  }

  check(now = Date.now()) {
    for (const [key, w] of this.waiting) {
      if (w.at > now) continue;
      this.waiting.delete(key);
      w.wake();
    }
    this.arm();
  }

  private arm() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.waiting.size) return;
    const at = Math.min(...[...this.waiting.values()].map((w) => w.at));
    this.timer = setTimeout(() => this.check(), Math.min(60_000, Math.max(0, at - Date.now())));
    this.timer.unref?.();
  }
}

export const limitWatch = new LimitWatch();

/** Three consecutive refused turns exhaust retries. A future reset is evidence to wake again. */
export class LimitAttempts {
  count = 0;

  hit(limit: { resetsAt?: number }, margin: number, now = Date.now()): number | null {
    this.count++;
    const reset = limit.resetsAt;
    if (reset && reset > now) return reset + margin;
    if (this.count >= 3) return null;
    return now + (reset ? 60_000 : 15 * 60_000);
  }
}
