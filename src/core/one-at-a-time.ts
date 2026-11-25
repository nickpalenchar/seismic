


/**
 * Runs `fn` once what runs under `key` in `running` has settled, whether it failed or not; at once
 * when nothing does. Returns what `fn` comes to.
 */
export function oneAtATime<K, T>(running: Map<K, Promise<unknown>>, key: K, fn: () => Promise<T>): Promise<T> {
  const before = running.get(key);
  const next = before ? before.then(fn) : fn();
  const settled = next.catch(() => {});
  running.set(key, settled);
  void settled.then(() => running.get(key) === settled && running.delete(key));
  return next;
}
