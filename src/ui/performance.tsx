// The performance dashboard: the owner's responses on agents' work, on every project, grouped by the
// harness, model and effort that did it. The main view is a table with each row's spread of stars;
// the other draws each rating as a dot. Every row says how many ratings it rests on and is ordered by
// what it is, not how well it did; with too few ratings in all, the responses stand alone, without
// averages. A row opens to its responses, each linking back to its card.

import { createContext, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { logQuery, type LogFilter, type Period } from '../core/feedback-log';
import { ageStep, FEW, filterChoices, filterFeedback, performance, type PerformanceFilter, type PerformanceRow, scatter, stars, trend } from '../core/performance';
import type { ProjectInfo, Feedback, WorkConfig } from '../core/types';
import { cardPath, feedbackLogPath } from './address';
import { api } from './api';
import { plain } from './markdown';
import { failText, t } from './strings';

/** Opens the dashboard, where the page offers it (the project, not the phone view). */
export const OpenPerformance = createContext<(() => void) | null>(null);

type View = 'stars' | 'dots' | 'trend';
const VIEWS: View[] = ['stars', 'dots', 'trend'];
const VIEW_KEY = 'obeya.performance.view';

const DAY = 86_400_000;

interface Props {
  on: boolean;
  onClose: () => void;
  projects: ProjectInfo[];
  /** The project the page shows: its cards open in place, another project's at their address. */
  here: string;
  onOpenCard: (code: string) => void;
  /** The filters it opens with: those the feedback log had, coming back from it. */
  initial?: LogFilter;
}

export function PerformanceDialog({ on, onClose, projects, here, onOpenCard, initial }: Props) {
  const p = t.performance;
  const [all, setAll] = useState<Feedback[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<PerformanceFilter>(() => ({ ...(initial?.project ? { project: initial.project } : {}), ...(initial?.repo ? { repo: initial.repo } : {}), ...(initial?.plan ? { plan: initial.plan } : {}) }));
  const [period, setPeriod] = useState<Period>(initial?.period ?? 'all');
  const [view, setViewState] = useState<View>(() => VIEWS.find((v) => v === localStorage.getItem(VIEW_KEY)) ?? 'stars');
  const setView = (v: View) => {
    localStorage.setItem(VIEW_KEY, v);
    setViewState(v);
  };
  const [open, setOpen] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // what had the focus when it opened gets it back when it closes, unless a card opened from it
  const opener = useRef<HTMLElement | null>(null);
  const toCard = useRef(false);
  useEffect(() => {
    if (!on) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    toCard.current = false;
    setError('');
    api.allFeedback().then(setAll, (e) => setError(failText(e)));
    requestAnimationFrame(() => close.current?.focus());
    return () => {
      if (!toCard.current && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, [on]);
  /** Tab stays within the dialog while it is open. */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, textarea')].filter((x) => x.offsetParent !== null);
    if (!all.length) return;
    const first = all[0]!, last = all.at(-1)!;
    if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  };
  const since = period === 'all' ? undefined : new Date(Date.now() - Number(period) * DAY).toISOString();
  const shown = useMemo(() => filterFeedback(all ?? [], { ...filter, ...(since ? { since } : {}) }), [all, filter, since?.slice(0, 10)]);
  const perf = useMemo(() => performance(shown), [shown]);
  const choices = useMemo(() => filterChoices(all ?? []), [all]);
  if (!on) return null;
  const projectName = (id: string) => projects.find((c) => c.id === id)?.name ?? id;
  const link = (f: Feedback) => {
    const code = f.short ?? f.cardId;
    if (f.deleted)
      return (
        <span>
          {plain(f.title) || code} <span className="hint">{p.deleted}</span>
        </span>
      );
    return (
      <a
        className="link card-link"
        href={cardPath(f.projectId, code)}
        onClick={(e) => {
          if (f.projectId !== here || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          toCard.current = true;
          onClose();
          onOpenCard(code);
        }}
      >
        {plain(f.title) || code}
      </a>
    );
  };
  const filtered = !!(filter.project || filter.repo || filter.plan || period !== 'all');
  // the log opens with the dashboard's filters; Back from it opens the dashboard again, with them
  const logFilter: LogFilter = { ...filter, period };
  const logQ = logQuery({ filter: logFilter });
  const toLog = () => history.replaceState(history.state, '', `${location.pathname}${logQ ? `${logQ}&` : '?'}performance`);
  const comparable = perf.ratings >= FEW;

  let body;
  if (error) body = <p className="p-error">{error}</p>;
  else if (!all) body = <p className="hint">{p.loading}</p>;
  else if (!all.length)
    body = (
      <div className="perf-empty">
        <h3>{p.none}</h3>
        <p className="hint">{p.noneHint}</p>
      </div>
    );
  else if (!shown.length)
    body = (
      <div className="perf-empty">
        <h3>{p.noMatch}</h3>
        <button className="btn small" onClick={() => (setFilter({}), setPeriod('all'))}>
          {p.clear}
        </button>
      </div>
    );
  else if (!comparable)
    body = (
      <>
        <p className="hint perf-few-note">{p.tooFew(perf.ratings, FEW)}</p>
        <Responses list={[...shown].reverse()} link={link} projectName={projectName} withConfig />
      </>
    );
  else {
    let head = '';
    body = (
      <>
        {view === 'trend' && <Trend rows={perf.rows} />}
        <table className="perf-table">
          <thead>
            <tr>
              <th scope="col">{p.cols.config}</th>
              <th scope="col" className="num">
                {p.cols.ratings}
              </th>
              <th scope="col" className="num">
                {p.cols.mean}
              </th>
              <th scope="col">{view !== 'dots' ? p.cols.spread : <DotScale />}</th>
              <th scope="col" className="num">
                {p.cols.comments}
              </th>
            </tr>
          </thead>
          <tbody>
            {perf.rows.map((r) => {
              const group = r.kind === 'config' ? harnessName(r.config!.harness) : p.uncreditedHead;
              const heading = group !== head;
              head = group;
              const expanded = open === r.key;
              return (
                <Fragment key={r.key}>
                  {heading && (
                    <tr className="perf-group">
                      <th scope="rowgroup" colSpan={5}>
                        {group}
                      </th>
                    </tr>
                  )}
                  <tr className={`perf-row${r.few ? ' few' : ''}${r.kind !== 'config' ? ' special' : ''}${expanded ? ' open' : ''}`}>
                    <th scope="row">
                      <button className="perf-expand" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.key)}>
                        <span className="perf-caret" aria-hidden>
                          {expanded ? '▾' : '▸'}
                        </span>
                        <RowName r={r} />
                      </button>
                      {r.few && (
                        <span className="perf-tag" title={p.fewHint(FEW)}>
                          {p.few}
                        </span>
                      )}
                    </th>
                    <td className="num">{r.ratings.length}</td>
                    <td className="num">{r.mean === null ? '–' : r.mean.toFixed(1)}</td>
                    <td>{view !== 'dots' ? <Spread r={r} /> : <Dots r={r} />}</td>
                    <td className="num">{r.comments}</td>
                  </tr>
                  {expanded && (
                    <tr className="perf-detail">
                      <td colSpan={5}>
                        <Responses list={r.responses} link={link} projectName={projectName} withConfig={r.kind === 'mixed'} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {view !== 'dots' ? (
          <p className="perf-legend">
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} className={`perf-key perf-r${s}`}>
                {t.feedback.stars[s - 1]}
              </span>
            ))}
            <span>{p.fewHint(FEW)}</span>
          </p>
        ) : (
          <p className="perf-legend">
            <span>{p.dotsHint}</span>
            <DotSizes />
            <span>{p.fewHint(FEW)}</span>
          </p>
        )}
      </>
    );
  }

  return (
    <div id="perf" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="perf-box" role="dialog" aria-modal="true" aria-labelledby="perf-title" onKeyDown={trap}>
        <button ref={close} className="cfg-close" title={t.close} aria-label={t.close} onClick={onClose}>
          ✕
        </button>
        <div className="perf-main">
          <header className="perf-head">
            <h2 id="perf-title">{p.title}</h2>
            {all && all.length > 0 && <p className="hint">{p.summary(perf.responses, perf.ratings, perf.uncredited)}</p>}
            <a className="link perf-to-log" href={`${feedbackLogPath(here)}${logQ}`} onClick={toLog}>
              {p.toLog} →
            </a>
          </header>
          <p className="hint perf-about">{p.about}</p>
          {all && all.length > 0 && (
            <div className="perf-bar">
              <div className="perf-filters">
                {choices.projects.length > 1 && (
                  <Choice label={p.filters.project} value={filter.project} options={choices.projects.map((id) => ({ id, name: projectName(id) }))} onChange={(project) => setFilter({ ...filter, project })} />
                )}
                {choices.repos.length > 1 && <Choice label={p.filters.repo} value={filter.repo} options={choices.repos.map((id) => ({ id, name: id }))} onChange={(repo) => setFilter({ ...filter, repo })} />}
                {choices.plans.length > 0 && (
                  <Choice label={p.filters.plan} value={filter.plan} options={choices.plans.map(({ id, title }) => ({ id, name: plain(title) }))} onChange={(plan) => setFilter({ ...filter, plan })} />
                )}
                <label className="perf-choice">
                  <span>{p.filters.period}</span>
                  <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                    <option value="all">{p.periods.all}</option>
                    <option value="90">{p.periods.days(90)}</option>
                    <option value="30">{p.periods.days(30)}</option>
                  </select>
                </label>
                {filtered && (
                  <button className="link perf-clear" onClick={() => (setFilter({}), setPeriod('all'))}>
                    {p.clear}
                  </button>
                )}
              </div>
              {comparable && shown.length > 0 && (
                <div className="perf-views" role="group" aria-label={p.views.label}>
                  {VIEWS.map((v) => (
                    <button key={v} className={view === v ? 'on' : undefined} aria-pressed={view === v} onClick={() => setView(v)}>
                      {p.views[v]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {body}
        </div>
      </div>
    </div>
  );
}

export function Choice({ label, value, options, onChange }: { label: string; value?: string; options: { id: string; name: string }[]; onChange: (v: string | undefined) => void }) {
  return (
    <label className="perf-choice">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{t.performance.filters.any}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export const harnessName = (h: WorkConfig['harness']) => (h === 'claude' ? 'Claude Code' : h === 'codex' ? 'Codex' : h === 'agy' ? 'Antigravity' : t.performance.unknownHarness);

/** A configuration as one line: its model and effort, each named unknown where it is. */
export function configText(c: WorkConfig, withHarness = false) {
  const p = t.performance;
  return [withHarness ? harnessName(c.harness) : '', c.model ?? p.unknownModel, c.effort ?? p.unknownEffort].filter(Boolean).join(' · ');
}

function RowName({ r }: { r: PerformanceRow }) {
  const p = t.performance;
  if (r.kind === 'mixed') return <span className="perf-special">{p.mixed}</span>;
  if (r.kind === 'missing') return <span className="perf-special">{p.missing}</span>;
  const c = r.config!;
  return (
    <span>
      <span className={c.model ? 'perf-model' : 'perf-special'}>{c.model ?? p.unknownModel}</span> · {c.effort ?? p.unknownEffort}
    </span>
  );
}

/** The row's ratings split by stars, as one bar. */
function Spread({ r }: { r: PerformanceRow }) {
  const n = r.ratings.length;
  const label = t.performance.spreadLabel(r.counts);
  if (!n) return <span className="hint">{t.performance.noRatings}</span>;
  return (
    <span className="perf-spread" role="img" aria-label={label} title={label}>
      {r.counts.map((k, s) => (k ? <span key={s} className={`perf-r${s + 1}`} style={{ width: `${(k / n) * 100}%` }} /> : null))}
    </span>
  );
}

/** Each of the row's ratings as a dot on the scale from 1 to 5 stars, the median as a line. */
/** The diameter of a dot by its age step (`ageStep`), the newest largest. */
const DOT_SIZE = [10, 8, 6, 4, 2.5];

/**
 * Each of the row's ratings as a dot on the scale from 1 to 5 stars, the median as a line. The dots
 * of one rating scatter in a cloud around its point that grows with their number, and the newer a
 * rating, the larger its dot.
 */
function Dots({ r }: { r: PerformanceRow }) {
  const label = t.performance.dotsLabel(r.ratings, r.median);
  if (!r.ratings.length) return <span className="hint">{t.performance.noRatings}</span>;
  const now = Date.now();
  const at = (v: number) => `${((v - 1) / 4) * 100}%`;
  const rated = r.responses.flatMap((f) => {
    const v = stars(f.answer.rating);
    return v === null ? [] : [{ f, v }];
  });
  // the oldest first, so newer dots lie on top
  rated.sort((a, b) => (a.f.updatedAt ?? a.f.at).localeCompare(b.f.updatedAt ?? b.f.at));
  return (
    <span className="perf-dots" role="img" aria-label={label} title={label}>
      <span className="perf-axis" />
      {r.median !== null && <b style={{ left: at(r.median) }} />}
      {rated.map(({ f, v }) => {
        const [jx, jy] = scatter(f.id);
        const wide = Math.min(24, 7 + r.counts[v - 1]! * 2);
        const size = DOT_SIZE[ageStep(f, now)]!;
        return <i key={f.id} style={{ left: `calc(${at(v)} + ${(jx * wide).toFixed(1)}px)`, top: `calc(50% + ${(jy * 10).toFixed(1)}px)`, width: size, height: size, margin: -size / 2 }} />;
      })}
    </span>
  );
}

/** The dots' sizes by age, for the legend. */
function DotSizes() {
  return (
    <span className="perf-sizes">
      {DOT_SIZE.map((size, k) => (
        <span key={k}>
          <i style={{ width: size, height: size }} />
          {t.performance.ages[k]}
        </span>
      ))}
    </span>
  );
}

function DotScale() {
  return (
    <span className="perf-scale" aria-label={t.performance.cols.each}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} style={{ left: `${((s - 1) / 4) * 100}%` }}>
          {s}★
        </span>
      ))}
    </span>
  );
}

export function StarText({ rating }: { rating: number | undefined }) {
  const s = stars(rating);
  if (s === null) return <span className="hint">{t.performance.noRating}</span>;
  return (
    <span className="perf-stars" role="img" aria-label={t.feedback.star(s, t.feedback.stars[s - 1]!)}>
      {'★'.repeat(s)}
      <span className="off">{'★'.repeat(5 - s)}</span>
    </span>
  );
}

/** Responses, each with its card (a link back to it), plan, repository, when, the rating and the comment. */
function Responses({ list, link, projectName, withConfig }: { list: Feedback[]; link: (f: Feedback) => React.ReactNode; projectName: (id: string) => string; withConfig?: boolean }) {
  const p = t.performance;
  const several = new Set(list.map((f) => f.projectId)).size > 1;
  return (
    <ul className="perf-responses">
      {list.map((f) => (
        <li key={f.id}>
          <div className="perf-r-main">
            {link(f)}
            <span className="hint perf-r-ctx">
              {[f.plan ? plain(f.plan.title) : '', f.repo ?? '', several ? projectName(f.projectId) : '', p.when(new Date(f.updatedAt ?? f.at))].filter(Boolean).join(' · ')}
            </span>
            {withConfig && <span className="hint perf-r-config">{f.attribution === 'missing' || !f.configs.length ? p.missing : f.configs.map((c) => configText(c, true)).join(' + ')}</span>}
            {f.answer.comment && <p className="perf-r-comment">{t.feedback.quoted(f.answer.comment)}</p>}
          </div>
          <StarText rating={f.answer.rating} />
        </li>
      ))}
    </ul>
  );
}

/** Inks for the lines over time, one per row, in the rows' order. */
const LINE_INKS = ['var(--working)', 'var(--approved)', 'var(--waiting)', 'var(--proposal)', 'var(--inPr)', 'var(--idea)', 'var(--question)', 'var(--planned)'];

/** A row's name as plain text, for the chart's legend and labels. */
function rowText(r: PerformanceRow) {
  const p = t.performance;
  return r.kind === 'mixed' ? p.mixed : r.kind === 'missing' ? p.missing : configText(r.config!, true);
}

/** Each model and effort's average per month as a line; a month of fewer than `FEW` ratings is a hollow point. */
function Trend({ rows }: { rows: PerformanceRow[] }) {
  const p = t.performance;
  // the lines are the models': work credited to none of them has no line of its own
  const { months, series } = trend(rows.filter((r) => r.kind === 'config'));
  const W = 900, H = 200, L = 44, R = 16, T = 12, B = 30;
  const x = (m: string) => (months.length < 2 ? L + (W - L - R) / 2 : L + (months.indexOf(m) / (months.length - 1)) * (W - L - R));
  const y = (v: number) => T + ((5 - v) / 4) * (H - T - B);
  const named = new Map(rows.map((r) => [r.key, r]));
  const lines = series.map((s, k) => ({ ...s, ink: LINE_INKS[k % LINE_INKS.length]!, name: rowText(named.get(s.key)!) }));
  return (
    <figure className="perf-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.trendLabel(months.length)}>
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="perf-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="perf-axis-text">
              {v}★
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="perf-axis-text">
            {p.month(m)}
          </text>
        ))}
        {lines.map((s) => (
          <g key={s.key} style={{ color: s.ink }}>
            <polyline fill="none" stroke="currentColor" strokeWidth={2} points={s.points.map((pt) => `${x(pt.month)},${y(pt.mean)}`).join(' ')} />
            {s.points.map((pt) => (
              <circle key={pt.month} cx={x(pt.month)} cy={y(pt.mean)} r={4.5} stroke="currentColor" strokeWidth={2} fill={pt.n < FEW ? 'var(--panel)' : 'currentColor'}>
                <title>{p.point(s.name, p.month(pt.month), pt.mean, pt.n)}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="perf-legend">
        {lines.map((s) => (
          <span key={s.key} className="perf-line-key" style={{ ['--r' as string]: s.ink }}>
            {s.name}
          </span>
        ))}
        <span>{p.trendHint(FEW)}</span>
      </figcaption>
    </figure>
  );
}
