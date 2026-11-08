// The Agent Feedback Log: every response the owner gave on agents' work, by time, the newest first,
// filtered by the dashboard's filters and by whom a response credits and how it rated, and grouped
// by configuration, plan, repository, project, week or month. Its state lives in the page's query,
// so the dashboard can open it with its own filters and a reload keeps it.
import { configKey, filterFeedback, type PerformanceFilter, stars } from './performance';
import { AGENT_EFFORTS, type Feedback, type WorkConfig } from './types';

export type Period = 'all' | '30' | '90';
export const PERIODS: Period[] = ['all', '90', '30'];

export interface LogFilter extends Omit<PerformanceFilter, 'since'> {
  period?: Period;
  /** Of the credited configuration: work credited to no one configuration matches none of these. */
  harness?: string;
  model?: string;
  effort?: string;
  /** Whole stars from 1 to 5, or `none` for a response with a comment only. */
  rating?: string;
}

export type LogGroup = 'none' | 'config' | 'plan' | 'repo' | 'project' | 'week' | 'month';
export const LOG_GROUPS: LogGroup[] = ['none', 'config', 'plan', 'repo', 'project', 'week', 'month'];

export interface LogState {
  filter: LogFilter;
  group: LogGroup;
}

const DAY = 86_400_000;
/** When a response was last given. */
export const givenAt = (f: Feedback) => f.updatedAt ?? f.at;

/** The configuration a response credits, where one alone did the work. */
export const creditOf = (f: Feedback): WorkConfig | undefined => (f.attribution === 'single' ? (f.credited ?? f.configs[0]) : undefined);

/** The responses the log's filter lets through, the newest first; `now` sets where the period starts. */
export function filterLog(list: Feedback[], f: LogFilter, now = Date.now()): Feedback[] {
  const since = f.period && f.period !== 'all' ? new Date(now - Number(f.period) * DAY).toISOString() : undefined;
  const config = f.harness !== undefined || f.model !== undefined || f.effort !== undefined;
  return filterFeedback(list, { project: f.project, repo: f.repo, plan: f.plan, ...(since ? { since } : {}) })
    .filter((x) => {
      if (config) {
        const c = creditOf(x);
        if (!c) return false;
        if (f.harness !== undefined && (c.harness ?? '') !== f.harness) return false;
        if (f.model !== undefined && (c.model ?? '') !== f.model) return false;
        if (f.effort !== undefined && (c.effort ?? '') !== f.effort) return false;
      }
      if (f.rating !== undefined) {
        const s = stars(x.answer.rating);
        if (f.rating === 'none' ? s !== null : s !== Number(f.rating)) return false;
      }
      return true;
    })
    .sort((a, b) => givenAt(b).localeCompare(givenAt(a)) || b.id - a.id);
}

/** Whether any filter is set. */
export const filtered = (f: LogFilter) => Object.entries(f).some(([k, v]) => v !== undefined && !(k === 'period' && v === 'all'));

/** What the log's filters of credited configurations can choose from; an unknown value is the empty string. */
export function logChoices(list: Feedback[]) {
  const credits = list.flatMap((f) => {
    const c = creditOf(f);
    return c ? [c] : [];
  });
  const of = (k: keyof WorkConfig) => [...new Set(credits.map((c) => c[k] ?? ''))];
  const known = (v: string) => (v === '' ? 1 : 0);
  return {
    harnesses: of('harness').sort((a, b) => known(a) - known(b) || a.localeCompare(b)),
    models: of('model').sort((a, b) => known(a) - known(b) || a.localeCompare(b)),
    efforts: of('effort').sort((a, b) => effortRank(a) - effortRank(b)),
  };
}

const effortRank = (e: string) => (e === '' ? AGENT_EFFORTS.length + 1 : AGENT_EFFORTS.includes(e as never) ? AGENT_EFFORTS.indexOf(e as never) : AGENT_EFFORTS.length);

/** The Monday a time falls in the week of (UTC), `2026-11-02`. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export interface LogSection {
  /** What the responses share: a configuration's key (`harness|model|effort`, `mixed`, `missing`), a plan's id, a repository, a project, a week's Monday or a month (`2026-11`); empty where they have none. */
  key: string;
  /** The credited configuration, in a section by configuration. */
  config?: WorkConfig;
  /** The plan's title as it was, in a section by plan. */
  title?: string;
  responses: Feedback[];
  ratings: number;
  mean: number | null;
}

function keyOf(f: Feedback, by: LogGroup): string {
  switch (by) {
    case 'config': {
      const c = creditOf(f);
      return c ? configKey(c) : f.attribution === 'mixed' ? 'mixed' : 'missing';
    }
    case 'plan':
      return f.plan?.id ?? '';
    case 'repo':
      return f.repo ?? '';
    case 'project':
      return f.projectId;
    case 'week':
      return weekOf(givenAt(f));
    case 'month':
      return givenAt(f).slice(0, 7);
    default:
      return '';
  }
}

const HARNESS = ['claude', 'codex'];
const rank = (list: readonly string[], v: string | null | undefined) => (v === null || v === undefined ? list.length + 1 : list.includes(v) ? list.indexOf(v) : list.length);

/**
 * The responses (the newest first, as `filterLog` gives them) in sections: by time the newest
 * first; by configuration in the dashboard's order (harness, model, effort; work credited to no
 * one configuration last); else by name, those without one last. Ungrouped, one section holds all.
 */
export function groupLog(list: Feedback[], by: LogGroup): LogSection[] {
  const sections = new Map<string, LogSection>();
  for (const f of list) {
    const key = keyOf(f, by);
    let s = sections.get(key);
    if (!s) {
      const c = by === 'config' ? creditOf(f) : undefined;
      s = { key, ...(c ? { config: { harness: c.harness, model: c.model, effort: c.effort } } : {}), ...(by === 'plan' && f.plan ? { title: f.plan.title } : {}), responses: [], ratings: 0, mean: null };
      sections.set(key, s);
    }
    s.responses.push(f);
  }
  for (const s of sections.values()) {
    const r = s.responses.flatMap((f) => {
      const v = stars(f.answer.rating);
      return v === null ? [] : [v];
    });
    s.ratings = r.length;
    s.mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
  }
  const all = [...sections.values()];
  const none = (s: LogSection) => (s.key === '' ? 1 : 0);
  const name = (s: LogSection) => s.title ?? s.key;
  if (by === 'week' || by === 'month') return all.sort((a, b) => b.key.localeCompare(a.key));
  if (by === 'config') {
    const kind = (s: LogSection) => (s.config ? 0 : s.key === 'mixed' ? 1 : 2);
    return all.sort((a, b) => {
      if (kind(a) !== kind(b)) return kind(a) - kind(b);
      const x = a.config, y = b.config;
      if (!x || !y) return 0;
      return (
        rank(HARNESS, x.harness) - rank(HARNESS, y.harness) ||
        (x.model === null ? 1 : 0) - (y.model === null ? 1 : 0) ||
        (x.model ?? '').localeCompare(y.model ?? '') ||
        rank(AGENT_EFFORTS, x.effort) - rank(AGENT_EFFORTS, y.effort)
      );
    });
  }
  if (by === 'none') return all;
  return all.sort((a, b) => none(a) - none(b) || name(a).localeCompare(name(b)));
}

const FILTER_KEYS = ['project', 'repo', 'plan', 'period', 'harness', 'model', 'effort', 'rating'] as const;
/** The names the log's state takes in a query, and `performance`, which opens the dashboard with them. */
export const LOG_KEYS = [...FILTER_KEYS, 'canvas', 'group', 'performance'];

/** The log's state from its query (`?plan=…&group=month`); what it does not know it leaves out. */
export function readLogQuery(search: string): LogState {
  const q = new URLSearchParams(search);
  const filter: LogFilter = {};
  for (const k of FILTER_KEYS) {
    const v = q.get(k) ?? (k === 'project' ? q.get('canvas') : null);
    if (v === null) continue;
    if (k === 'period') {
      if (PERIODS.includes(v as Period)) filter.period = v as Period;
    } else if (k === 'rating') {
      if (v === 'none' || /^[1-5]$/.test(v)) filter.rating = v;
    } else if (k === 'harness' || k === 'model' || k === 'effort') filter[k] = v;
    else if (v) filter[k] = v;
  }
  const g = q.get('group');
  return { filter, group: LOG_GROUPS.includes(g as LogGroup) ? (g as LogGroup) : 'none' };
}

/** The query for a log's state (`?…`, or empty): only what is set, so the address stays short. */
export function logQuery({ filter, group }: Partial<LogState>): string {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = filter?.[k];
    if (v === undefined || (k === 'period' && v === 'all')) continue;
    q.set(k, v);
  }
  if (group && group !== 'none') q.set('group', group);
  const s = q.toString();
  return s ? `?${s}` : '';
}
