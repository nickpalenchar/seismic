






import { CATEGORIES, type Category, type Complexity, PRIORITIES, type Priority } from '../../core/labels';
import { type Canvas, type CardState, type Group, type Item, offCanvas, type RepoRef, STATES } from '../../core/types';

export const COLUMNS = ['title', 'state', 'priority', 'canvas', 'plan', 'group', 'category', 'complexity', 'updated', 'repo'] as const;
export type ColumnId = (typeof COLUMNS)[number];


export interface Row {
  item: Item;
  title: string;
  state: CardState;
  priority?: Priority;
  
  canvas?: string;
  
  plan?: string;
  
  group?: string;
  category?: Category;
  complexity?: Complexity;
  
  updated?: string;
  
  repo?: string;
}


export const NO_PRIORITY = 'none';
export type PriorityOption = Priority | typeof NO_PRIORITY;

export interface Filters {
  title: string;
  state: CardState[];
  priority: PriorityOption[];
  
  canvas: string[];
}
export type Facet = 'state' | 'priority' | 'canvas';

export interface Sort {
  id: ColumnId;
  desc: boolean;
}


export interface Kept {
  sort: Sort;
  filters: Filters;
  hidden: ColumnId[];
}

export const NO_FILTERS: Filters = { title: '', state: [], priority: [], canvas: [] };
export const DEFAULT_KEPT: Kept = { sort: { id: 'updated', desc: true }, filters: NO_FILTERS, hidden: [] };

/** What was kept, with anything missing or no longer valid (a column since renamed) set back to its default. */
export function keptOf(v: unknown): Kept {
  const k = (v && typeof v === 'object' ? v : {}) as Partial<Kept>;
  const f = (k.filters && typeof k.filters === 'object' ? k.filters : {}) as Partial<Filters>;
  const list = <T>(x: unknown, ok: (y: unknown) => boolean) => (Array.isArray(x) ? (x.filter(ok) as T[]) : []);
  const column = (x: unknown): x is ColumnId => (COLUMNS as readonly unknown[]).includes(x);
  return {
    sort: k.sort && column(k.sort.id) ? { id: k.sort.id, desc: !!k.sort.desc } : DEFAULT_KEPT.sort,
    filters: {
      title: typeof f.title === 'string' ? f.title : '',
      state: list(f.state, (x) => (STATES as readonly unknown[]).includes(x)),
      priority: list(f.priority, (x) => x === NO_PRIORITY || (PRIORITIES as readonly unknown[]).includes(x)),
      canvas: list(f.canvas, (x) => typeof x === 'string'),
    },
    hidden: list(k.hidden, column),
  };
}

export const filtering = (f: Filters) => !!f.title.trim() || f.state.length > 0 || f.priority.length > 0 || f.canvas.length > 0;

/** The table's rows: the cards on the project's canvases and the plans' workstreams, in no particular order. */
export function tableRows(items: Item[], { canvases, groups, repos }: { canvases: Canvas[]; groups: Group[]; repos: RepoRef[] }): Row[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const repoName = new Map(repos.map((r) => [r.id, r.name]));
  const on = (i: Item) => i.canvasVisible && !i.archivedAt && !offCanvas(i);
  return items
    .filter((i) => on(i) && (!i.parent || (byId.has(i.parent) && on(byId.get(i.parent)!))))
    .map((i) => {
      const l = i.labels ?? {};
      return {
        item: i,
        title: i.title,
        state: i.state,
        priority: l.priority,
        canvas: i.canvas ?? canvases[0]?.id,
        plan: i.parent ? byId.get(i.parent)?.title : undefined,
        group: i.group ? groupName.get(i.group) : undefined,
        category: l.category,
        complexity: l.complexity,
        updated: i.updatedAt ?? i.createdAt,
        repo: repoName.get(i.repo) ?? i.repo,
      };
    });
}

/** Whether a row passes the filters, `except` one facet (whose options count what the others leave). */
export function passes(r: Row, f: Filters, except?: Facet): boolean {
  const q = f.title.trim().toLowerCase();
  if (q && !r.title.toLowerCase().includes(q)) return false;
  if (except !== 'state' && f.state.length && !f.state.includes(r.state)) return false;
  if (except !== 'priority' && f.priority.length && !f.priority.includes(r.priority ?? NO_PRIORITY)) return false;
  if (except !== 'canvas' && f.canvas.length && !(r.canvas && f.canvas.includes(r.canvas))) return false;
  return true;
}

export const filterRows = (rows: Row[], f: Filters) => rows.filter((r) => passes(r, f));

/** How many rows each option of a facet would show, given the other filters. */
export function facetCounts(rows: Row[], f: Filters, facet: Facet): Map<string, number> {
  const n = new Map<string, number>();
  for (const r of rows) {
    if (!passes(r, f, facet)) continue;
    const v = facet === 'priority' ? (r.priority ?? NO_PRIORITY) : r[facet];
    if (v !== undefined) n.set(v, (n.get(v) ?? 0) + 1);
  }
  return n;
}

type Value = string | number;
const rank = <T>(order: readonly T[]) => (v: T | undefined) => (v === undefined ? undefined : order.indexOf(v));
const compare = (a: Value, b: Value) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }));

/** What a column sorts a row by: a rank where the values have an order of their own, a number or a text otherwise; empty where the row has none. */
export function sortKeys(canvases: Canvas[]): Record<ColumnId, (r: Row) => Value | undefined> {
  const state = rank(STATES);
  const priority = rank(PRIORITIES);
  const category = rank(CATEGORIES);
  const canvas = rank(canvases.map((c) => c.id));
  return {
    title: (r) => r.title,
    state: (r) => state(r.state),
    priority: (r) => priority(r.priority),
    canvas: (r) => canvas(r.canvas),
    plan: (r) => r.plan,
    group: (r) => r.group,
    category: (r) => category(r.category),
    complexity: (r) => r.complexity,
    updated: (r) => (r.updated ? Date.parse(r.updated) : undefined),
    repo: (r) => r.repo,
  };
}

/** The rows in the order of `sort`, empty values last in either direction; rows that tie stay newest first. */
export function sortRows(rows: Row[], sort: Sort, canvases: Canvas[]): Row[] {
  const keys = sortKeys(canvases);
  const by = (key: (r: Row) => Value | undefined, desc: boolean) => (x: Row, y: Row) => {
    const a = key(x);
    const b = key(y);
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
    return desc ? compare(b, a) : compare(a, b);
  };
  const first = by(keys[sort.id], sort.desc);
  const newest = by(keys.updated, true);
  return [...rows].sort((x, y) => first(x, y) || newest(x, y));
}
