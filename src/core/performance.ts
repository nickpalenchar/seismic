// The owner's responses on agents' work, grouped by whom they credit: harness, model and effort.
// Shared by the dashboard and its tests. Work by several configurations and work nobody recorded
// get rows of their own and are never counted for a model; rows are ordered by what they are, not
// by how well they did, and a row with few ratings says so rather than ranking.
import { AGENT_EFFORTS, type Feedback, type WorkConfig } from './types';

/** Fewer ratings than this in a row (or in all) are too few to compare. */
export const FEW = 5;

export interface PerformanceFilter {
  canvas?: string;
  repo?: string;
  /** A project's id. */
  project?: string;
  /** Only responses given since (ISO time). */
  since?: string;
}

export interface PerformanceRow {
  /** `harness|model|effort` of the credited configuration, `mixed` or `missing`. */
  key: string;
  kind: 'config' | 'mixed' | 'missing';
  config?: WorkConfig;
  responses: Feedback[];
  /** The ratings given, each rounded to a whole star from 1 to 5. */
  ratings: number[];
  /** How many ratings gave 1 to 5 stars, the first for 1. */
  counts: [number, number, number, number, number];
  mean: number | null;
  median: number | null;
  comments: number;
  /** Fewer than `FEW` ratings. */
  few: boolean;
}

export interface Performance {
  rows: PerformanceRow[];
  responses: number;
  ratings: number;
  /** Responses that credit no single configuration: by several, or by an unknown one. */
  uncredited: number;
}

/** The responses the filter lets through. */
export function filterFeedback(list: Feedback[], f: PerformanceFilter): Feedback[] {
  return list.filter(
    (x) =>
      (!f.canvas || x.canvasId === f.canvas) &&
      (!f.repo || x.repo === f.repo) &&
      (!f.project || x.project?.id === f.project) &&
      (!f.since || (x.updatedAt ?? x.at) >= f.since),
  );
}

/** A rating as a whole star from 1 to 5, or none. */
export const stars = (r: number | undefined): number | null => (typeof r === 'number' && Number.isFinite(r) ? Math.min(5, Math.max(1, Math.round(r))) : null);

export const configKey = (c: WorkConfig) => `${c.harness ?? ''}|${c.model ?? ''}|${c.effort ?? ''}`;

const HARNESS = ['claude', 'codex', 'agy'];
const rank = (list: readonly (string | null)[], v: string | null) => (v === null ? list.length + 1 : list.includes(v) ? list.indexOf(v) : list.length);

function order(a: PerformanceRow, b: PerformanceRow): number {
  const kinds = ['config', 'mixed', 'missing'];
  if (a.kind !== b.kind) return kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
  const x = a.config, y = b.config;
  if (!x || !y) return 0;
  return (
    rank(HARNESS, x.harness) - rank(HARNESS, y.harness) ||
    (x.model === null ? 1 : 0) - (y.model === null ? 1 : 0) ||
    (x.model ?? '').localeCompare(y.model ?? '') ||
    rank(AGENT_EFFORTS, x.effort) - rank(AGENT_EFFORTS, y.effort)
  );
}

/** The responses by whom they credit, each row with its count, spread, average and median. */
export function performance(list: Feedback[]): Performance {
  const rows = new Map<string, PerformanceRow>();
  for (const f of list) {
    const config = f.attribution === 'single' ? (f.credited ?? f.configs[0]) : undefined;
    const kind = config ? 'config' : f.attribution === 'mixed' ? 'mixed' : 'missing';
    const key = config ? configKey(config) : kind;
    let row = rows.get(key);
    if (!row) {
      row = { key, kind, ...(config ? { config: { harness: config.harness, model: config.model, effort: config.effort } } : {}), responses: [], ratings: [], counts: [0, 0, 0, 0, 0], mean: null, median: null, comments: 0, few: true };
      rows.set(key, row);
    }
    row.responses.push(f);
    const s = stars(f.answer.rating);
    if (s !== null) {
      row.ratings.push(s);
      row.counts[s - 1]!++;
    }
    if (f.answer.comment) row.comments++;
  }
  for (const row of rows.values()) {
    const r = [...row.ratings].sort((a, b) => a - b);
    row.mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
    row.median = r.length ? (r.length % 2 ? r[(r.length - 1) / 2]! : (r[r.length / 2 - 1]! + r[r.length / 2]!) / 2) : null;
    row.few = r.length < FEW;
    // the latest first, where a row lists its responses
    row.responses.sort((a, b) => (b.updatedAt ?? b.at).localeCompare(a.updatedAt ?? a.at));
  }
  const sorted = [...rows.values()].sort(order);
  return {
    rows: sorted,
    responses: list.length,
    ratings: sorted.reduce((n, r) => n + r.ratings.length, 0),
    uncredited: sorted.filter((r) => r.kind !== 'config').reduce((n, r) => n + r.responses.length, 0),
  };
}

/** What the filters can choose from: the canvases, repositories and projects responses were given in. */
export function filterChoices(list: Feedback[]) {
  const canvases = [...new Set(list.map((f) => f.canvasId))];
  const repos = [...new Set(list.flatMap((f) => (f.repo ? [f.repo] : [])))].sort();
  const projects = new Map<string, string>();
  for (const f of list) if (f.project) projects.set(f.project.id, f.project.title);
  return { canvases, repos, projects: [...projects].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)) };
}

export interface TrendPoint {
  /** The month, `2026-10`. */
  month: string;
  mean: number;
  n: number;
}

/** Each row's average rating per month (by when a response was last given), and the months from the first to the last with any. */
export function trend(rows: PerformanceRow[]): { months: string[]; series: { key: string; points: TrendPoint[] }[] } {
  const monthOf = (f: Feedback) => (f.updatedAt ?? f.at).slice(0, 7);
  const series = rows.map((r) => {
    const by = new Map<string, number[]>();
    for (const f of r.responses) {
      const s = stars(f.answer.rating);
      if (s === null) continue;
      const m = monthOf(f);
      by.set(m, [...(by.get(m) ?? []), s]);
    }
    const points = [...by].map(([month, v]) => ({ month, mean: v.reduce((a, b) => a + b, 0) / v.length, n: v.length })).sort((a, b) => a.month.localeCompare(b.month));
    return { key: r.key, points };
  });
  const all = series.flatMap((s) => s.points.map((p) => p.month)).sort();
  const months: string[] = [];
  if (all.length) {
    let [y, m] = all[0]!.split('-').map(Number) as [number, number];
    const last = all.at(-1)!;
    for (;;) {
      const at = `${y}-${String(m).padStart(2, '0')}`;
      months.push(at);
      if (at >= last) break;
      m++;
      if (m > 12) (m = 1), y++;
    }
  }
  return { months, series: series.filter((s) => s.points.length) };
}

const DAY = 86_400_000;
/** The upper bounds in days of the ages a dot's size tells apart, the newest first; older than the last is the smallest. */
export const AGES = [3, 7, 30, 60] as const;

/** How old a response is, as one of five steps: 0 up to 3 days, 1 up to a week, 2 up to a month, 3 up to two months, 4 older. */
export function ageStep(f: Feedback, now: number): number {
  const days = (now - Date.parse(f.updatedAt ?? f.at)) / DAY;
  const k = AGES.findIndex((d) => days <= d);
  return k === -1 ? AGES.length : k;
}

/** Two numbers in [-1, 1] that stay the same for the same seed: where a dot lies in its cloud, the same at every render. */
export function scatter(seed: number): [number, number] {
  let s = (seed * 0x9e3779b1) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  return [next(), next()];
}
