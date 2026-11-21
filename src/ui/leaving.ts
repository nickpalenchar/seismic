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

// The browser's own Back and Forward move the address before the page hears of it. While something
// is held, a step that leaves the page is taken back at once (the address as it was, put over the
// one the browser went to) and asked about; discarded, the step is taken again.
if (typeof window !== 'undefined' && typeof history !== 'undefined') {
  let here = { href: location.href, state: history.state as unknown };
  const settle = () => {
    here = { href: location.href, state: history.state };
  };
  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = history[m];
    history[m] = function (this: History, ...args: Parameters<History['pushState']>) {
      orig.apply(this, args);
      settle();
    };
  }
  addEventListener('popstate', (e) => {
    if (!e.isTrusted || !guards.size || !leavesPage(here.href, location.href)) return settle();
    // before anything else of the page follows the address
    e.stopImmediatePropagation();
    const { href, state } = here;
    history.pushState(state, '', href);
    leave(() => history.back());
  });
}
