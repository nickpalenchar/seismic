// The performance dashboard: the owner's responses on agents' work, on every project, grouped by the
// harness, model and effort that did it. The main view is a table with each row's spread of stars;
// the other draws each rating as a dot. Every row says how many ratings it rests on and is ordered by
// what it is, not how well it did; with too few ratings in all, the responses stand alone, without
// averages. A row opens to its responses, each linking back to its card.

import { ChevronDown, ChevronRight } from 'lucide-react';
import { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { logQuery, type LogFilter, type Period } from '../core/feedback-log';
import { ageStep, FEW, filterChoices, filterFeedback, performance, type PerformanceFilter, type PerformanceRow, scatter, stars, trend } from '../core/performance';
import type { ProjectInfo, Feedback, WorkConfig } from '../core/types';
import { cardPath, feedbackLogPath } from './address';
import { api } from './api';
import { plain } from './markdown';
import { failText, t } from './strings';
import { Button, CloseButton, LinkButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { SegmentedControl } from './components/segmented';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { Select, SelectItem } from './components/select';
import { cn } from 'cn';
import { aboutClass, barClass, choiceClass, clearClass, emptyClass, filtersClass, headClass, pageLinkClass, starsClass, tableClass, titleClass } from './performanceClasses';
import { cfgCloseClass } from './configClasses';

/** Opens the dashboard, where the page offers it (the project, not the phone view). */
export const OpenPerformance = createContext<(() => void) | null>(null);

type View = 'stars' | 'dots' | 'trend';
const VIEWS: View[] = ['stars', 'dots', 'trend'];
const VIEW_KEY = 'seismic.performance.view';

const DAY = 86_400_000;

/** A cell of the table: a line under each row. */
const cell = 'py-2 px-2 border-b border-border text-left align-middle';
/** A column's head: small and quiet, on one line. */
const headCell = cn(cell, 'text-xs font-semibold text-muted-foreground whitespace-nowrap');
/** A column of numbers: right-aligned figures of one width, as narrow as they allow. */
const num = 'text-right tabular-nums w-[1%] whitespace-nowrap';
/** The spread's or the dots' column takes the room the others leave. */
const wide = 'w-[45%]';
/** The last column, the comments, stands a little apart from the bar before it. */
const last = 'pl-4';
/** The heading of an empty dashboard. */
const emptyHeadClass = '[font-family:var(--font)] font-medium text-xl mt-0 mb-1.5';
/** The legend under the table and the chart. */
const legendClass = 'flex flex-wrap gap-x-3.5 gap-y-1.5 mt-2.5 mx-0 mb-0 text-xs text-muted-foreground';
/** A legend's key: a square in the ink of its stars (`--r`, `inkOf`). */
const keyClass = "before:content-[''] before:inline-block before:size-2.5 before:rounded-xs before:mr-1 before:align-[-1px] before:bg-(--r)";
/** A line's key in the chart's legend: a short stroke in its ink. */
const lineKeyClass = "before:content-[''] before:inline-block before:w-3.5 before:h-[3px] before:rounded-xs before:mr-1 before:align-[3px] before:bg-(--r)";
/** The chart's numbers and months. */
const axisTextClass = 'fill-muted-foreground text-xs';
/** What a response is about (its plan, repository, project, date) and whom it credits, under its card. */
const contextClass = 'text-muted-foreground text-sm';

/** The ink of a rating of 1 to 5 stars, as `--r`: from red through grey to green. */
const STAR_INKS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--approved)',
];
const inkOf = (stars: number) => ({ ['--r' as string]: STAR_INKS[stars - 1] });

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
  // the focus goes back to what had it when the dialog opened, unless a card opened from it
  const toCard = useRef(false);
  useEffect(() => {
    if (!on) return;
    toCard.current = false;
    setError('');
    api.allFeedback().then(setAll, (e) => setError(failText(e)));
  }, [on]);
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
      <div className={emptyClass}>
        <h3 className={emptyHeadClass}>{p.none}</h3>
        <p className="hint">{p.noneHint}</p>
      </div>
    );
  else if (!shown.length)
    body = (
      <div className={emptyClass}>
        <h3 className={emptyHeadClass}>{p.noMatch}</h3>
        <Button size="small" onClick={() => (setFilter({}), setPeriod('all'))}>
          {p.clear}
        </Button>
      </div>
    );
  else if (!comparable)
    body = (
      <>
        <p className="hint mt-0 mb-1.5">{p.tooFew(perf.ratings, FEW)}</p>
        <Responses list={[...shown].reverse()} link={link} projectName={projectName} withConfig />
      </>
    );
  else {
    let head = '';
    body = (
      <>
        {view === 'trend' && <Trend rows={perf.rows} />}
        <table className={cn('perf-table', tableClass)}>
          <thead>
            <tr>
              <th scope="col" className={headCell}>
                {p.cols.config}
              </th>
              <th scope="col" className={cn(headCell, num)}>
                {p.cols.ratings}
              </th>
              <th scope="col" className={cn(headCell, num)}>
                {p.cols.mean}
              </th>
              <th scope="col" className={cn(headCell, wide)}>
                {view !== 'dots' ? p.cols.spread : <DotScale />}
              </th>
              <th scope="col" className={cn(headCell, num, last)}>
                {p.cols.comments}
              </th>
            </tr>
          </thead>
          {perf.rows.map((r) => {
              const group = r.kind === 'config' ? harnessName(r.config!.harness) : p.uncreditedHead;
              const heading = group !== head;
              head = group;
              const expanded = open === r.key;
              return (
                <Collapsible key={r.key} asChild open={expanded} onOpenChange={(o) => setOpen(o ? r.key : null)}>
                  <tbody>
                  {heading && (
                    <tr className="perf-group">
                      <th scope="rowgroup" colSpan={5} className={cn(cell, 'font-semibold bg-muted/70 py-1.5')}>
                        {group}
                      </th>
                    </tr>
                  )}
                  <tr className={`perf-row${r.few ? ' few' : ''}${r.kind !== 'config' ? ' special' : ''}${expanded ? ' open' : ''}`}>
                    <th scope="row" className={cn(cell, 'font-normal')}>
                      <CollapsibleTrigger className={cn('perf-expand inline-flex items-center gap-1.5 py-0.5 px-0 hover:underline hover:underline-offset-[3px]', r.few ? 'text-muted-foreground' : 'text-foreground')}>
                        <span className="inline-flex align-middle w-3 text-muted-foreground text-2xs" aria-hidden>
                          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                        <RowName r={r} />
                      </CollapsibleTrigger>
                      {r.few && (
                        <span className="inline-block ml-2 py-0 px-2 border border-muted-foreground rounded-md text-2xs text-muted-foreground leading-4 align-[1px]" title={p.fewHint(FEW)}>
                          {p.few}
                        </span>
                      )}
                    </th>
                    <td className={cn(cell, num, r.few && 'text-muted-foreground')}>{r.ratings.length}</td>
                    <td className={cn(cell, num, r.few && 'text-muted-foreground')}>{r.mean === null ? '–' : r.mean.toFixed(1)}</td>
                    <td className={cn(cell, wide, r.few && 'text-muted-foreground')}>{view !== 'dots' ? <Spread r={r} /> : <Dots r={r} />}</td>
                    <td className={cn(cell, num, last, r.few && 'text-muted-foreground')}>{r.comments}</td>
                  </tr>
                  <CollapsibleContent asChild>
                    <tr className="perf-detail">
                      <td colSpan={5} className={cn(cell, 'bg-muted/35 pt-1 pr-2 pb-2.5 pl-4')}>
                        <Responses list={r.responses} link={link} projectName={projectName} withConfig={r.kind === 'mixed'} />
                      </td>
                    </tr>
                  </CollapsibleContent>
                  </tbody>
                </Collapsible>
              );
            })}
        </table>
        {view !== 'dots' ? (
          <p className={legendClass}>
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} className={keyClass} style={inkOf(s)}>
                {t.feedback.stars[s - 1]}
              </span>
            ))}
            <span>{p.fewHint(FEW)}</span>
          </p>
        ) : (
          <p className={legendClass}>
            <span>{p.dotsHint}</span>
            <DotSizes />
            <span>{p.fewHint(FEW)}</span>
          </p>
        )}
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent id="perf" glass className="flex-1 min-w-0 relative flex" layerClassName="z-55 items-stretch p-7 max-[700px]:p-2.5" onCloseAutoFocus={(e) => toCard.current && e.preventDefault()}>
        <CloseButton label={t.close} className={cfgCloseClass} onClick={onClose} />
        {/* the right padding keeps a lane for the close button, so nothing scrolls under it or stands beside it */}
        <div className="perf-main flex-1 overflow-y-auto pt-6 pr-16 pb-8 pl-10 [&>*]:max-w-[980px] max-[700px]:pt-5 max-[700px]:pr-14 max-[700px]:pb-6 max-[700px]:pl-4">
          <header className={headClass}>
            <DialogTitle asChild>
              <h2 className={titleClass}>{p.title}</h2>
            </DialogTitle>
            {all && all.length > 0 && <p className="hint m-0">{p.summary(perf.responses, perf.ratings, perf.uncredited)}</p>}
            <a className={cn('perf-to-log ml-auto', pageLinkClass)} href={`${feedbackLogPath(here)}${logQ}`} onClick={toLog}>
              {p.toLog} →
            </a>
          </header>
          <p className={aboutClass}>{p.about}</p>
          {all && all.length > 0 && (
            <div className={barClass}>
              <div className={filtersClass}>
                {choices.projects.length > 1 && (
                  <Choice label={p.filters.project} value={filter.project} options={choices.projects.map((id) => ({ id, name: projectName(id) }))} onChange={(project) => setFilter({ ...filter, project })} />
                )}
                {choices.repos.length > 1 && <Choice label={p.filters.repo} value={filter.repo} options={choices.repos.map((id) => ({ id, name: id }))} onChange={(repo) => setFilter({ ...filter, repo })} />}
                {choices.plans.length > 0 && (
                  <Choice label={p.filters.plan} value={filter.plan} options={choices.plans.map(({ id, title }) => ({ id, name: plain(title) }))} onChange={(plan) => setFilter({ ...filter, plan })} />
                )}
                <label className={choiceClass}>
                  <span>{p.filters.period}</span>
                  <Select value={period} onValueChange={(picked) => setPeriod(picked as Period)}>
                    <SelectItem value="all">{p.periods.all}</SelectItem>
                    <SelectItem value="90">{p.periods.days(90)}</SelectItem>
                    <SelectItem value="30">{p.periods.days(30)}</SelectItem>
                  </Select>
                </label>
                {filtered && (
                  <LinkButton className={clearClass} onClick={() => (setFilter({}), setPeriod('all'))}>
                    {p.clear}
                  </LinkButton>
                )}
              </div>
              {comparable && shown.length > 0 && (
                <SegmentedControl size="small" label={p.views.label} value={view} onValueChange={setView} options={VIEWS.map((v) => ({ value: v, label: p.views[v] }))} />
              )}
            </div>
          )}
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Choice({ label, value, options, onChange }: { label: string; value?: string; options: { id: string; name: string }[]; onChange: (v: string | undefined) => void }) {
  return (
    <label className={choiceClass}>
      <span>{label}</span>
      <Select value={value ?? ''} onValueChange={(picked) => onChange(picked || undefined)}>
        <SelectItem value="">{t.performance.filters.any}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </Select>
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
  if (r.kind === 'mixed') return <span className="italic">{p.mixed}</span>;
  if (r.kind === 'missing') return <span className="italic">{p.missing}</span>;
  const c = r.config!;
  return (
    <span>
      <span className={c.model ? 'font-mono text-sm' : 'italic'}>{c.model ?? p.unknownModel}</span> · {c.effort ?? p.unknownEffort}
    </span>
  );
}

/** The row's ratings split by stars, as one bar. */
function Spread({ r }: { r: PerformanceRow }) {
  const n = r.ratings.length;
  const label = t.performance.spreadLabel(r.counts);
  if (!n) return <span className="hint">{t.performance.noRatings}</span>;
  return (
    <span className={cn('flex w-full max-w-[260px] min-w-[120px] max-[700px]:min-w-[100px] h-3.5 rounded-xs overflow-hidden bg-border', r.few && 'opacity-60')} role="img" aria-label={label} title={label}>
      {r.counts.map((k, s) => (k ? <span key={s} className="block h-full bg-(--r)" style={{ ...inkOf(s + 1), width: `${(k / n) * 100}%` }} /> : null))}
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
    <span className="relative block min-w-[160px] max-[700px]:min-w-[100px] h-8 mx-6" role="img" aria-label={label} title={label}>
      <span className="absolute inset-x-0 top-1/2 [border-top:1px_dashed_var(--border)]" />
      {r.median !== null && <b className="absolute top-px bottom-px w-0.5 -ml-px bg-foreground opacity-55" style={{ left: at(r.median) }} />}
      {rated.map(({ f, v }) => {
        const [jx, jy] = scatter(f.id);
        const wide = Math.min(24, 7 + r.counts[v - 1]! * 2);
        const size = DOT_SIZE[ageStep(f, now)]!;
        return <i key={f.id} className={cn('absolute z-1 rounded-full opacity-70', r.few ? 'bg-muted-foreground' : 'bg-working')} style={{ left: `calc(${at(v)} + ${(jx * wide).toFixed(1)}px)`, top: `calc(50% + ${(jy * 10).toFixed(1)}px)`, width: size, height: size, margin: -size / 2 }} />;
      })}
    </span>
  );
}

/** The dots' sizes by age, for the legend. */
function DotSizes() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {DOT_SIZE.map((size, k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <i className="inline-block rounded-full bg-working opacity-70" style={{ width: size, height: size }} />
          {t.performance.ages[k]}
        </span>
      ))}
    </span>
  );
}

function DotScale() {
  return (
    <span className="relative block h-[1.2em] mx-6 font-normal" aria-label={t.performance.cols.each}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className="absolute [transform:translateX(-50%)]" style={{ left: `${((s - 1) / 4) * 100}%` }}>
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
    <span className={starsClass} role="img" aria-label={t.feedback.star(s, t.feedback.stars[s - 1]!)}>
      {'★'.repeat(s)}
      <span className="text-border">{'★'.repeat(5 - s)}</span>
    </span>
  );
}

/** Responses, each with its card (a link back to it), plan, repository, when, the rating and the comment. */
function Responses({ list, link, projectName, withConfig }: { list: Feedback[]; link: (f: Feedback) => React.ReactNode; projectName: (id: string) => string; withConfig?: boolean }) {
  const p = t.performance;
  const several = new Set(list.map((f) => f.projectId)).size > 1;
  return (
    <ul className="list-none m-0 p-0">
      {list.map((f) => (
        <li key={f.id} className="flex items-start justify-between gap-4 py-2 px-0 border-b border-border last:border-b-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            {link(f)}
            <span className={contextClass}>
              {[f.plan ? plain(f.plan.title) : '', f.repo ?? '', several ? projectName(f.projectId) : '', p.when(new Date(f.updatedAt ?? f.at))].filter(Boolean).join(' · ')}
            </span>
            {withConfig && <span className={contextClass}>{f.attribution === 'missing' || !f.configs.length ? p.missing : f.configs.map((c) => configText(c, true)).join(' + ')}</span>}
            {f.answer.comment && <p className="mt-0.5 mb-0 text-sm text-foreground whitespace-pre-wrap">{t.feedback.quoted(f.answer.comment)}</p>}
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
  const { unit, periods: months, series } = trend(rows.filter((r) => r.kind === 'config'));
  const W = 900, H = 200, L = 44, R = 16, T = 12, B = 30;
  const x = (m: string) => (months.length < 2 ? L + (W - L - R) / 2 : L + (months.indexOf(m) / (months.length - 1)) * (W - L - R));
  const y = (v: number) => T + ((5 - v) / 4) * (H - T - B);
  const named = new Map(rows.map((r) => [r.key, r]));
  const lines = series.map((s, k) => ({ ...s, ink: LINE_INKS[k % LINE_INKS.length]!, name: rowText(named.get(s.key)!) }));
  return (
    <figure className="mt-0 mx-0 mb-4">
      <svg className="block w-full h-auto overflow-visible" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.trendLabel(months.length, unit)}>
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className={axisTextClass}>
              {v}★
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className={axisTextClass}>
            {p.period(m, unit)}
          </text>
        ))}
        {lines.map((s) => (
          <g key={s.key} style={{ color: s.ink }}>
            <polyline fill="none" stroke="currentColor" strokeWidth={2} points={s.points.map((pt) => `${x(pt.period)},${y(pt.mean)}`).join(' ')} />
            {s.points.map((pt) => (
              <circle key={pt.period} cx={x(pt.period)} cy={y(pt.mean)} r={4.5} stroke="currentColor" strokeWidth={2} fill={pt.n < FEW ? 'var(--surface)' : 'currentColor'}>
                <title>{p.point(s.name, p.period(pt.period, unit), pt.mean, pt.n)}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className={legendClass}>
        {lines.map((s) => (
          <span key={s.key} className={lineKeyClass} style={{ ['--r' as string]: s.ink }}>
            {s.name}
          </span>
        ))}
        <span>{p.trendHint(FEW, unit)}</span>
      </figcaption>
    </figure>
  );
}
