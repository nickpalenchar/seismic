/** One repository's git operations, with the active operation at zero and waiters at 1, 2, … . */
export interface LandingTurn {
  position?: (position: number | undefined) => void;
  signal?: AbortSignal;
}

type Entry = { start: () => void; position?: LandingTurn['position']; cancel: () => void };

export class LandingQueue<K> {
  private queues = new Map<K, Entry[]>();

  run<T>(key: K, fn: () => Promise<T>, turn: LandingTurn = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (turn.signal?.aborted) return reject(turn.signal.reason);
      const queue = this.queues.get(key) ?? [];
      this.queues.set(key, queue);
      const positions = () => queue.forEach((e, n) => e.position?.(n));
      const remove = () => {
        turn.signal?.removeEventListener('abort', entry.cancel);
        queue.splice(queue.indexOf(entry), 1);
        entry.position?.(undefined);
        if (!queue.length) this.queues.delete(key);
        positions();
      };
      const entry: Entry = {
        position: turn.position,
        cancel: () => {
          // Once git starts it must finish; only a waiting approval can be withdrawn.
          if (queue[0] === entry) return;
          remove();
          reject(turn.signal?.reason);
        },
        start: () => {
          turn.signal?.removeEventListener('abort', entry.cancel);
          const done = () => { remove(); queue[0]?.start(); };
          void Promise.resolve().then(() => { turn.signal?.throwIfAborted(); return fn(); }).then(
            (result) => { done(); resolve(result); },
            (error) => { done(); reject(error); },
          );
        },
      };
      queue.push(entry);
      turn.signal?.addEventListener('abort', entry.cancel, { once: true });
      positions();
      if (queue.length === 1) entry.start();
    });
  }
}
