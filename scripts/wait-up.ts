




export type Up = { up: true } | { up: false; exit: number | null; waited: number };

export async function waitUp(
  url: string,
  o: { exited: () => number | null; limit: number; slowAfter?: number; onSlow?: () => void; headers?: Record<string, string> },
): Promise<Up> {
  const start = Date.now();
  let warned = false;
  for (;;) {
    if (await answers(url, o.headers)) return { up: true };
    const waited = Date.now() - start;
    const exit = o.exited();
    if (exit !== null) return { up: false, exit, waited };
    if (waited >= o.limit) return { up: false, exit: null, waited };
    if (!warned && o.onSlow && waited >= (o.slowAfter ?? Infinity)) {
      warned = true;
      o.onSlow();
    }
    await Bun.sleep(250);
  }
}

/** Whether `url` answers 2xx; Seismic's API only with the owner's key (`headers`, owner.ts). */
export async function answers(url: string, headers: Record<string, string> = {}) {
  try {
    return (await fetch(url, { headers, signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}
