// Leaving a view that holds an unsaved draft: what would close or replace it (another sheet in the
// dock, Back in the settings sheet, another project's page) asks first. A view with something
// unsaved holds the leaving and goes on with it once the owner discards it; without one, it goes on
// at once.

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
