





export type LeaveGuard = (proceed: () => void, cancel: () => void, signal?: AbortSignal) => boolean;

const guards = new Map<LeaveGuard, boolean>();

/** Asks `guard` before leaving until released. `allRoutes` also guards in-page address changes. */
export function holdLeaving(guard: LeaveGuard, allRoutes = false): () => void {
  guards.set(guard, allRoutes);
  return () => void guards.delete(guard);
}

/** Does `proceed`, once nothing unsaved holds it. */
export function leave(proceed: () => void, to?: string, cancel = () => {}, signal?: AbortSignal) {
  const leaving = to === undefined || leavesPage(location.href, to);
  for (const [guard, allRoutes] of guards) if ((leaving || allRoutes) && guard(proceed, cancel, signal)) return;
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
  
  const page = (u: URL) => u.pathname.replace(/\/c\/[^/]+\/?$/, '').replace(/\/$/, '');
  if (page(a) !== page(b)) return true;
  for (const [k, v] of a.searchParams) if (v === '' && !b.searchParams.has(k)) return true;
  return false;
}






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
  
  let at = location.href;
  



  let unseen: string | null = null;
  history.pushState = (state, unused, url) => {
    push({ ...state, [indexKey]: (here.app ?? 0) + 1 }, unused, url);
    here = cursor();
    at = location.href;
    unseen = null;
  };
  history.replaceState = (state, unused, url) => {
    replace({ ...state, [indexKey]: here.app ?? 0 }, unused, url);
    here = cursor();
    at = location.href;
    unseen = null;
  };
  addEventListener('hashchange', (e: HashChangeEvent) => {
    if (e.newURL !== unseen) return;
    unseen = null;
    e.stopImmediatePropagation();
  });

  let returning: { origin: Cursor; delta: number; target: string } | null = null;
  addEventListener('popstate', (e) => {
    const there = cursor();
    const from = at;
    at = there.href;
    unseen = null;
    /** This step is the guard's: a hash it changes is no news for the page. */
    const hide = () => void (new URL(from).hash !== location.hash && (unseen = location.href));
    if (e.isTrusted && returning) {
      const back = distance(there, returning.origin);
      if (back !== undefined) {
        e.stopImmediatePropagation();
        hide();
        if (back !== 0) return history.go(back);
        const { delta, target } = returning;
        returning = null;
        here = there;
        leave(() => history.go(delta), target);
        return;
      }
      returning = null;
    }
    const delta = distance(here, there);
    if (e.isTrusted && guards.size && delta && (leavesPage(here.href, there.href) || [...guards.values()].some(Boolean))) {
      e.stopImmediatePropagation();
      hide();
      returning = { origin: here, delta, target: there.href };
      history.go(-delta);
      return;
    }
    here = there;
  });
}
