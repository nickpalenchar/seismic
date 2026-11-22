// Leaving a view that holds an unsaved draft: what would close or replace it (another sheet in the
// dock, Back in the settings sheet, another project's page, the browser's own Back or Forward) asks
// first. A view with something unsaved holds the leaving and goes on with it once the owner
// discards it; without one, it goes on at once.

/** Holds the leaving where something is unsaved: says so (true) and calls `proceed` itself once the owner discards it. */
export type LeaveGuard = (proceed: () => void) => boolean;

const guards = new Set<LeaveGuard>();

/** Asks `guard` before anything leaves, until the returned function is called. */
export function holdLeaving(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => void guards.delete(guard);
}

/** Does `proceed`, once nothing unsaved holds it. */
export function leave(proceed: () => void) {
  for (const g of guards) if (g(proceed)) return;
  proceed();
}

/**
 * Whether going from the address `from` to `to` leaves the page a draft is on: another project's page
 * (or another page of the app, `/p/<project>/feedback`), or a page over it that the query names as a
 * bare flag (`?settings`, `?needs` on the phone) closed. A card opened or closed on the same project,
 * or a view switched over its canvas, stays on the page.
 */
export function leavesPage(from: string, to: string): boolean {
  const base = 'http://x';
  const a = new URL(from, base);
  const b = new URL(to, base);
  // the page is the path without the card open on it
  const page = (u: URL) => u.pathname.replace(/\/c\/[^/]+\/?$/, '').replace(/\/$/, '');
  if (page(a) !== page(b)) return true;
  for (const [k, v] of a.searchParams) if (v === '' && !b.searchParams.has(k)) return true;
  return false;
}

// A native traversal has already moved the history cursor by the time popstate runs. Restore
// that cursor before asking, then replay the same number of steps if the owner discards.
// Stamp app entries for browsers that do not expose the session history index.
if (typeof window !== 'undefined' && typeof history !== 'undefined') {
  const indexKey = '__seismicHistoryIndex';
  const nativeIndex = () => {
    const navigation = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation;
    const index = navigation?.currentEntry?.index ?? -1;
    return index >= 0 ? index : undefined;
  };
  const cursor = () => ({ href: location.href, native: nativeIndex(), app: history.state?.[indexKey] as number | undefined });
  type Cursor = ReturnType<typeof cursor>;
  const distance = (from: Cursor, to: Cursor) => {
    if (from.native !== undefined && to.native !== undefined) return to.native - from.native;
    if (from.app !== undefined && to.app !== undefined) return to.app - from.app;
    return undefined;
  };
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  if (history.state?.[indexKey] === undefined) replace({ ...history.state, [indexKey]: 0 }, '');
  let here = cursor();
  history.pushState = (state, unused, url) => {
    push({ ...state, [indexKey]: (here.app ?? 0) + 1 }, unused, url);
    here = cursor();
  };
  history.replaceState = (state, unused, url) => {
    replace({ ...state, [indexKey]: here.app ?? 0 }, unused, url);
    here = cursor();
  };

  let returning: { origin: Cursor; delta: number } | null = null;
  addEventListener('popstate', (e) => {
    const there = cursor();
    if (e.isTrusted && returning) {
      const back = distance(there, returning.origin);
      if (back !== undefined) {
        e.stopImmediatePropagation();
        if (back !== 0) return history.go(back);
        const { delta } = returning;
        returning = null;
        here = there;
        leave(() => history.go(delta));
        return;
      }
      returning = null;
    }
    const delta = distance(here, there);
    if (e.isTrusted && guards.size && delta && leavesPage(here.href, there.href)) {
      e.stopImmediatePropagation();
      returning = { origin: here, delta };
      history.go(-delta);
      return;
    }
    here = there;
  });
}
