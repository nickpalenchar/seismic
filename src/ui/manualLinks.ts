import type { Bounds } from '../core/layout';
import type { EdgeSide, ManualAnchor } from '../core/types';

type Point = { x: number; y: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const normal: Record<EdgeSide, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/** Closest point on the target's edges, including when the pointer is inside the card. */
export function nearestEdge(b: Bounds, p: Point): { side: EdgeSide; offset: number } {
  const x = clamp((p.x - b.x) / b.w), y = clamp((p.y - b.y) / b.h);
  const candidates: { side: EdgeSide; offset: number; point: Point }[] = [
    { side: 'top', offset: x, point: { x: b.x + x * b.w, y: b.y } },
    { side: 'right', offset: y, point: { x: b.x + b.w, y: b.y + y * b.h } },
    { side: 'bottom', offset: x, point: { x: b.x + x * b.w, y: b.y + b.h } },
    { side: 'left', offset: y, point: { x: b.x, y: b.y + y * b.h } },
  ];
  return candidates.sort((a, z) => Math.hypot(a.point.x - p.x, a.point.y - p.y) - Math.hypot(z.point.x - p.x, z.point.y - p.y))[0]!;
}

export function edgePoint(b: Bounds, side: EdgeSide, offset = 0.5): Point {
  const t = clamp(offset);
  if (side === 'top') return { x: b.x + b.w * t, y: b.y };
  if (side === 'bottom') return { x: b.x + b.w * t, y: b.y + b.h };
  if (side === 'left') return { x: b.x, y: b.y + b.h * t };
  return { x: b.x + b.w, y: b.y + b.h * t };
}

/**
 * A rounded route outside both cards, and its centre for the remove button. With `head`, it stops
 * that far before the target's edge, where an arrow head drawn on its end points onto the card.
 */
export function anchoredPath(a: Bounds, b: Bounds, anchor: ManualAnchor, head = 0): { path: string; mid: Point } {
  const start = edgePoint(a, anchor.fromSide), edge = edgePoint(b, anchor.toSide, anchor.offset);
  const from = normal[anchor.fromSide], to = normal[anchor.toSide];
  const end = { x: edge.x + to.x * head, y: edge.y + to.y * head };
  const gap = 12 + head;
  const out = { x: start.x + from.x * gap, y: start.y + from.y * gap };
  const into = { x: end.x + to.x * gap, y: end.y + to.y * gap };
  const boxes = [a, b].map((r) => ({ left: r.x - gap, right: r.x + r.w + gap, top: r.y - gap, bottom: r.y + r.h + gap }));
  const xs = [...new Set([out.x, into.x, ...boxes.flatMap((r) => [r.left, r.right])])].sort((x, y) => x - y);
  const ys = [...new Set([out.y, into.y, ...boxes.flatMap((r) => [r.top, r.bottom])])].sort((x, y) => x - y);
  const points = xs.flatMap((x) => ys.map((y) => ({ x, y })));
  const inside = (p: Point) => boxes.some((r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom);
  const clear = (p: Point, q: Point) => !boxes.some((r) =>
    p.y === q.y ? p.y > r.top && p.y < r.bottom && Math.max(p.x, q.x) > r.left && Math.min(p.x, q.x) < r.right :
      p.x > r.left && p.x < r.right && Math.max(p.y, q.y) > r.top && Math.min(p.y, q.y) < r.bottom,
  );
  const source = points.findIndex((p) => p.x === out.x && p.y === out.y);
  const target = points.findIndex((p) => p.x === into.x && p.y === into.y);
  const distance = points.map(() => Infinity), previous = points.map(() => -1), visited = new Set<number>();
  distance[source] = 0;
  while (visited.size < points.length) {
    let at = -1;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && (at < 0 || distance[i]! < distance[at]!)) at = i;
    if (at < 0 || !Number.isFinite(distance[at]!) || at === target) break;
    visited.add(at);
    const p = points[at]!;
    for (let i = 0; i < points.length; i++) {
      const q = points[i]!;
      if (i === at || visited.has(i) || inside(q) || (p.x !== q.x && p.y !== q.y) || !clear(p, q)) continue;
      const length = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if (distance[at]! + length < distance[i]!) { distance[i] = distance[at]! + length; previous[i] = at; }
    }
  }
  const route: Point[] = [];
  if (Number.isFinite(distance[target]!)) {
    for (let i = target; i !== -1; i = previous[i]!) route.unshift(points[i]!);
  } else route.push(out, into); 
  const raw = [start, ...route, end].filter((p, i, all) => !i || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y);
  const path: string[] = [`M${raw[0]!.x},${raw[0]!.y}`];
  for (let i = 1; i < raw.length - 1; i++) {
    const p = raw[i - 1]!, q = raw[i]!, r = raw[i + 1]!;
    const before = Math.hypot(q.x - p.x, q.y - p.y), after = Math.hypot(r.x - q.x, r.y - q.y);
    const radius = Math.min(10, before / 2, after / 2);
    if (!radius || (p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y)) { path.push(`L${q.x},${q.y}`); continue; }
    const u = { x: q.x + (p.x - q.x) * radius / before, y: q.y + (p.y - q.y) * radius / before };
    const v = { x: q.x + (r.x - q.x) * radius / after, y: q.y + (r.y - q.y) * radius / after };
    path.push(`L${u.x},${u.y} Q${q.x},${q.y} ${v.x},${v.y}`);
  }
  path.push(`L${end.x},${end.y}`);
  const lengths = raw.slice(1).map((p, i) => Math.hypot(p.x - raw[i]!.x, p.y - raw[i]!.y));
  let halfway = lengths.reduce((sum, n) => sum + n, 0) / 2, mid = start;
  for (let i = 0; i < lengths.length; i++) {
    if (halfway <= lengths[i]!) { const t = lengths[i] ? halfway / lengths[i]! : 0; mid = { x: raw[i]!.x + (raw[i + 1]!.x - raw[i]!.x) * t, y: raw[i]!.y + (raw[i + 1]!.y - raw[i]!.y) * t }; break; }
    halfway -= lengths[i]!;
  }
  return { path: path.join(' '), mid };
}
