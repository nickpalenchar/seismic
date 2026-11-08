// What a card waits for, and what waits for a card: each direct wait shows as a faint line at all
// times, and over every step while the pointer is on a card. A card in the queue waits for the cards
// the Koordinator holds it behind; a workstream not delivered yet also waits for the open workstreams
// it builds on, as the Koordinator read them from the plan doc, started or not; a card snoozed until
// another card gets somewhere waits for that card; and a card waits for those the owner drew an arrow
// from. A wait ends once the card waited for is finished.

import type { Bounds } from '../core/layout';
import { finished, type Item, snoozeOf } from '../core/types';

export interface Deps {
  /** The cards the hovered one waits for, directly or through others. */
  before: Set<string>;
  /** The cards waiting for the hovered one, directly or through others. */
  after: Set<string>;
  /** Each wait on the way, from the card waited for to the card waiting. */
  edges: [from: string, to: string][];
  /** Those of `edges` on the way to the hovered card (into it or into a card it waits for), as `from to`. */
  first: Set<string>;
}

const queued = (i: Item) => (i.queue && 'behind' in i.queue ? i.queue.behind : []);
const snoozedOn = (i: Item) => {
  const on = snoozeOf(i)?.on;
  return on ? [on.card] : [];
};

/** The cards among `byId` that `i` waits for directly. */
function waitsFor(i: Item, byId: Map<string, Item>): string[] {
  const open = (x: string) => byId.has(x) && !finished(byId.get(x)!.state);
  if (!open(i.id)) return [];
  return [...new Set([...queued(i), ...snoozedOn(i), ...(i.manualDependsOn ?? []), ...(i.buildsOn ?? [])])].filter(open);
}

/** Every direct wait among `items`, from the card waited for to the card waiting. */
export function waitsAmong(items: Item[]): [from: string, to: string][] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return items.flatMap((i) => waitsFor(i, byId).map((b): [string, string] => [b, i.id]));
}

/**
 * The dependencies whose prerequisite is finished, which hold nothing any more and so are no waits:
 * from the finished card to the one that builds on it or that the owner drew an arrow to. They stay
 * on the canvas as a dim green line.
 */
export function settledAmong(items: Item[]): { from: string; to: string }[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return items.flatMap((i) =>
    [...new Set([...queued(i), ...snoozedOn(i), ...(i.buildsOn ?? []), ...(i.manualDependsOn ?? [])])].flatMap((from) => {
      const f = byId.get(from);
      return f && finished(f.state) ? [{ from, to: i.id }] : [];
    }),
  );
}

/** The waits around `id` among `items`, both ways; undefined when there are none or `id` is gone
 *  (a card archived under the pointer stays hovered). */
export function depsOf(id: string, items: Item[]): Deps | undefined {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!byId.has(id)) return undefined;
  const behind = (i: Item) => waitsFor(i, byId);
  const waiters = new Map<string, string[]>();
  for (const i of items) for (const b of behind(i)) waiters.set(b, [...(waiters.get(b) ?? []), i.id]);
  const edges = new Map<string, [string, string]>();
  const first = new Set<string>();
  const walk = (next: (x: string) => string[], edge: (x: string, y: string) => [string, string], into?: Set<string>) => {
    const seen = new Set<string>();
    const todo = [id];
    while (todo.length) {
      const x = todo.pop()!;
      for (const y of next(x)) {
        const e = edge(x, y);
        edges.set(e.join(' '), e);
        into?.add(e.join(' '));
        if (y === id || seen.has(y)) continue;
        seen.add(y);
        todo.push(y);
      }
    }
    return seen;
  };
  const before = walk((x) => behind(byId.get(x)!), (x, y) => [y, x], first);
  const after = walk((x) => waiters.get(x) ?? [], (x, y) => [x, y]);
  if (!before.size && !after.size) return undefined;
  return { before, after, edges: [...edges.values()], first };
}

// ---------------------------------------------------------------- the dots an owner draws an arrow from

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** The middle of a card's edge, where its dot for that side sits. */
export function handleAt(b: Bounds, side: Side): { x: number; y: number } {
  if (side === 'top') return { x: b.x + b.w / 2, y: b.y };
  if (side === 'bottom') return { x: b.x + b.w / 2, y: b.y + b.h };
  if (side === 'left') return { x: b.x, y: b.y + b.h / 2 };
  return { x: b.x + b.w, y: b.y + b.h / 2 };
}

/** How far world point `at` is from the edge `side` of `b`, anywhere along it. */
function edgeDistance(b: Bounds, side: Side, at: { x: number; y: number }): number {
  const x = Math.max(b.x, Math.min(b.x + b.w, at.x));
  const y = Math.max(b.y, Math.min(b.y + b.h, at.y));
  if (side === 'top') return Math.hypot(at.x - x, at.y - b.y);
  if (side === 'bottom') return Math.hypot(at.x - x, at.y - (b.y + b.h));
  if (side === 'left') return Math.hypot(at.x - b.x, at.y - y);
  return Math.hypot(at.x - (b.x + b.w), at.y - y);
}

/**
 * The dot nearest to world point `at` within `reach` (world units), among the cards `cards`; null when none is that close.
 * With `edgeReach`, a dot also shows while the pointer is that close to any point of its edge.
 */
export function nearestHandle(cards: { id: string; b: Bounds }[], at: { x: number; y: number }, reach: number, edgeReach = 0): { id: string; side: Side } | null {
  let best: { id: string; side: Side } | null = null;
  let bestD = Infinity;
  const outer = Math.max(reach, edgeReach);
  for (const { id, b } of cards) {
    // a card whose edges all lie farther away has no dot in reach
    if (at.x < b.x - outer || at.x > b.x + b.w + outer || at.y < b.y - outer || at.y > b.y + b.h + outer) continue;
    for (const side of SIDES) {
      const h = handleAt(b, side);
      const toDot = Math.hypot(h.x - at.x, h.y - at.y);
      const d = toDot <= reach ? toDot : edgeReach > 0 && edgeDistance(b, side, at) <= edgeReach ? edgeDistance(b, side, at) : Infinity;
      if (d < bestD) {
        best = { id, side };
        bestD = d;
      }
    }
  }
  return best;
}

/** Unfinished prerequisites explicitly connected by the owner. */
export function manualPrerequisites(item: Item, items: Item[]): Item[] {
  return (item.manualDependsOn ?? []).flatMap((id) => {
    const prerequisite = items.find((i) => i.id === id) ?? item.manualArchived?.find((i) => i.id === id);
    return prerequisite && !finished(prerequisite.state) && (!prerequisite.archivedAt || item.manualArchived?.some((i) => i.id === id)) ? [prerequisite] : [];
  });
}
