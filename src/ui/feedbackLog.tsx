// The Agent Feedback Log: a page of its own, opened from the performance dashboard, listing every
// response the owner gave on agents' work on every canvas, the newest first. It filters by the
// dashboard's filters and by whom a response credits and how it rated, and groups by configuration,
// plan, repository, canvas, week or month. Its filters and grouping stay in the address.

import { useEffect, useMemo, useState } from 'react';
import { creditOf, filtered, filterLog, givenAt, groupLog, LOG_GROUPS, logChoices, logQuery, type LogFilter, type LogGroup, type LogSection, type LogState, PERIODS, readLogQuery } from '../core/feedback-log';
import { filterChoices } from '../core/performance';
import type { CanvasInfo, Feedback } from '../core/types';
import { projectPath, cardPath, feedbackLogPath } from './address';
import { api } from './api';
import { plain } from './markdown';
import { Choice, configText, harnessName, StarText } from './performance';
import { failText, t } from './strings';

/** A filter's value for an unknown harness, model or effort (the empty string in the core), as a `<select>` can hold it apart from "all". */
const UNKNOWN = '-';

export function FeedbackLog({ canvases, here }: { canvases: CanvasInfo[]; here: string }) {
  const p = t.performance;
  const l = t.feedbackLog;
  const [all, setAll] = useState<Feedback[] | null>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<LogState>(() => readLogQuery(location.search));
  const { filter, group } = state;
  useEffect(() => {
    document.title = `${l.title} · Seismic`;
    api.allFeedback().then(setAll, (e) => setError(failText(e)));
  }, []);
  // the address keeps the filters and grouping: a reload or a link shows the same
  useEffect(() => history.replaceState(history.state, '', `${feedbackLogPath(here)}${logQuery(state)}`), [state]);
  const setFilter = (f: LogFilter) => setState((s) => ({ ...s, filter: f }));
  const set = (k: keyof LogFilter, v: string | undefined) => {
    const f = { ...filter };
    if (v === undefined) delete f[k];
    else (f as Record<string, string>)[k] = v;
    setFilter(f);
  };
  const shown = useMemo(() => filterLog(all ?? [], filter), [all, filter]);
  const sections = useMemo(() => groupLog(shown, group), [shown, group]);
  const choices = useMemo(() => filterChoices(all ?? []), [all]);
  const credits = useMemo(() => logChoices(all ?? []), [all]);
  const canvasName = (id: string) => canvases.find((c) => c.id === id)?.name ?? id;
  const ratings = shown.filter((f) => typeof f.answer.rating === 'number').length;
  // back to the dashboard on the canvas it was opened from, with the filters it shares
  const shared = logQuery({ filter: { canvas: filter.canvas, repo: filter.repo, plan: filter.plan, period: filter.period } });
  const back = `${projectPath(here)}${shared ? `${shared}&` : '?'}performance`;
  const clear = () => setFilter({});

  const sectionName = (s: LogSection) => {
    switch (group) {
      case 'config':
        return s.config ? configText(s.config, true) : s.key === 'mixed' ? p.mixed : p.missing;
      case 'plan':
        return s.title ? plain(s.title) : l.noPlan;
      case 'repo':
        return s.key || l.noRepo;
      case 'canvas':
        return canvasName(s.key);
      case 'week':
        return l.week(s.key);
      case 'month':
        return l.month(s.key);
      default:
        return '';
    }
  };

  let body;
  if (error) body = <p className="p-error">{error}</p>;
  else if (!all) body = <p className="hint">{p.loading}</p>;
  else if (!all.length)
    body = (
      <div className="perf-empty">
        <h2>{p.none}</h2>
        <p className="hint">{p.noneHint}</p>
      </div>
    );
  else if (!shown.length)
    body = (
      <div className="perf-empty">
        <h2>{p.noMatch}</h2>
        <button className="btn small" onClick={clear}>
          {p.clear}
        </button>
      </div>
    );
  else
    body = (
      <table className="flog-table" aria-labelledby="flog-title">
        <thead>
          <tr>
            <th scope="col">{l.cols.when}</th>
            <th scope="col">{l.cols.card}</th>
            <th scope="col">{l.cols.stars}</th>
            <th scope="col">{l.cols.comment}</th>
            {COLUMNS.filter((c) => c !== group).map((c) => (
              <th key={c} scope="col">
                {l.cols[c]}
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.key}>
            {group !== 'none' && (
              <tr className="flog-group">
                <th scope="rowgroup" colSpan={4 + COLUMNS.filter((c) => c !== group).length}>
                  <span className="flog-group-name">{sectionName(s)}</span>
                  <span className="hint">{l.sectionSummary(s.responses.length, s.ratings, s.mean)}</span>
                </th>
              </tr>
            )}
            {s.responses.map((f) => (
              <Row key={f.id} f={f} canvasName={canvasName} without={group} />
            ))}
          </tbody>
        ))}
      </table>
    );

  return (
    <div id="flog">
      <main className="flog-main">
        <a className="link flog-back" href={back}>
          ← {p.title}
        </a>
        <header className="perf-head">
          <h1 id="flog-title">
            {l.title}
          </h1>
          {all && all.length > 0 && <p className="hint">{l.summary(shown.length, ratings, all.length)}</p>}
        </header>
        <p className="hint perf-about">{l.about}</p>
        {all && all.length > 0 && (
          <div className="perf-bar">
            <div className="perf-filters">
              {choices.canvases.length > 1 && <Choice label={p.filters.canvas} value={filter.canvas} options={choices.canvases.map((id) => ({ id, name: canvasName(id) }))} onChange={(v) => set('canvas', v)} />}
              {choices.repos.length > 1 && <Choice label={p.filters.repo} value={filter.repo} options={choices.repos.map((id) => ({ id, name: id }))} onChange={(v) => set('repo', v)} />}
              {choices.plans.length > 0 && <Choice label={p.filters.plan} value={filter.plan} options={choices.plans.map(({ id, title }) => ({ id, name: plain(title) }))} onChange={(v) => set('plan', v)} />}
              <label className="perf-choice">
                <span>{p.filters.period}</span>
                <select value={filter.period ?? 'all'} onChange={(e) => set('period', e.target.value === 'all' ? undefined : e.target.value)}>
                  {PERIODS.map((d) => (
                    <option key={d} value={d}>
                      {d === 'all' ? p.periods.all : p.periods.days(Number(d))}
                    </option>
                  ))}
                </select>
              </label>
              {credits.harnesses.length > 1 && <Choice label={l.filters.harness} value={known(filter.harness)} options={credits.harnesses.map((h) => ({ id: h || UNKNOWN, name: harnessName((h || null) as never) }))} onChange={(v) => set('harness', unknown(v))} />}
              {credits.models.length > 1 && <Choice label={l.filters.model} value={known(filter.model)} options={credits.models.map((m) => ({ id: m || UNKNOWN, name: m || p.unknownModel }))} onChange={(v) => set('model', unknown(v))} />}
              {credits.efforts.length > 1 && <Choice label={l.filters.effort} value={known(filter.effort)} options={credits.efforts.map((e) => ({ id: e || UNKNOWN, name: e || p.unknownEffort }))} onChange={(v) => set('effort', unknown(v))} />}
              <Choice
                label={l.filters.rating}
                value={filter.rating}
                options={[...[5, 4, 3, 2, 1].map((s) => ({ id: String(s), name: l.stars(s) })), { id: 'none', name: p.noRating }]}
                onChange={(v) => set('rating', v)}
              />
              {filtered(filter) && (
                <button className="link perf-clear" onClick={clear}>
                  {p.clear}
                </button>
              )}
            </div>
            <label className="perf-choice">
              <span>{l.groupBy}</span>
              <select value={group} onChange={(e) => setState((s) => ({ ...s, group: e.target.value as LogGroup }))}>
                {LOG_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {l.groups[g]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {body}
      </main>
    </div>
  );
}

/** The columns of what a response is filed under; grouped by one of them, its section heading says it instead. */
const COLUMNS = ['config', 'plan', 'repo', 'canvas'] as const;

const known = (v: string | undefined) => (v === '' ? UNKNOWN : v);
const unknown = (v: string | undefined) => (v === UNKNOWN ? '' : v);

/** One response: when, its card (a link back to it; a deleted card's title without), stars, comment, whom it credits, plan, repository and canvas. */
function Row({ f, canvasName, without }: { f: Feedback; canvasName: (id: string) => string; without: LogGroup }) {
  const p = t.performance;
  const code = f.short ?? f.cardId;
  const name = plain(f.title) || code;
  const c = creditOf(f);
  const config = c ? configText(c, true) : f.attribution === 'mixed' && f.configs.length ? `${p.mixed}: ${f.configs.map((x) => configText(x, true)).join(' + ')}` : p.missing;
  return (
    <tr>
      <td className="flog-when">{p.when(new Date(givenAt(f)))}</td>
      <td className="flog-card">
        {f.deleted ? (
          <span>
            {name} <span className="hint">{p.deleted}</span>
          </span>
        ) : (
          <a className="link card-link" href={cardPath(f.canvasId, code)}>
            {name}
          </a>
        )}
      </td>
      <td className="flog-stars">
        <StarText rating={f.answer.rating} />
      </td>
      <td className="flog-comment">{f.answer.comment ? t.feedback.quoted(f.answer.comment) : ''}</td>
      {without !== 'config' && <td className={c ? undefined : 'perf-special'}>{config}</td>}
      {without !== 'plan' && <td>{f.plan ? plain(f.plan.title) : ''}</td>}
      {without !== 'repo' && <td>{f.repo ?? ''}</td>}
      {without !== 'canvas' && <td>{canvasName(f.canvasId)}</td>}
    </tr>
  );
}
