// The Agent Feedback Log: a page of its own, opened from the performance dashboard, listing every
// response the owner gave on agents' work on every project, the newest first. It filters by the
// dashboard's filters and by whom a response credits and how it rated, and groups by configuration,
// plan, repository, project, week or month. Its filters and grouping stay in the address.

import { useEffect, useMemo, useState } from 'react';
import { creditOf, filtered, filterLog, givenAt, groupLog, LOG_GROUPS, logChoices, logQuery, type LogFilter, type LogGroup, type LogSection, type LogState, PERIODS, readLogQuery } from '../core/feedback-log';
import { filterChoices } from '../core/performance';
import type { ProjectInfo, Feedback } from '../core/types';
import { projectPath, cardPath, feedbackLogPath, switchTo } from './address';
import { api } from './api';
import { plain } from './markdown';
import { Choice, configText, harnessName, StarText } from './performance';
import { failText, t } from './strings';
import { Button, LinkButton } from './components/button';
import { Select, SelectItem } from './components/select';
import { cn } from 'cn';
import { aboutClass, barClass, choiceClass, clearClass, emptyClass, filtersClass, headClass, pageLinkClass, tableClass, titleClass } from './performanceClasses';

/** A filter's value for an unknown harness, model or effort (the empty string in the core), as a `<Select>` can hold it apart from "all". */
const UNKNOWN = '-';

/** A cell of the log: a line under each row, the text on its first line's baseline. */
const cell = 'py-2 px-2.5 border-b border-line text-left align-baseline';
/** A column's head: small and quiet on one line, standing at the top while the log scrolls under it. */
const headCell = cn(cell, 'text-[12px] font-semibold text-muted-foreground whitespace-nowrap sticky top-0 bg-panel z-1');

export function FeedbackLog({ projects, here }: { projects: ProjectInfo[]; here: string }) {
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
  const projectName = (id: string) => projects.find((c) => c.id === id)?.name ?? id;
  const ratings = shown.filter((f) => typeof f.answer.rating === 'number').length;
  // back to the dashboard on the project it was opened from, with the filters it shares
  const shared = logQuery({ filter: { project: filter.project, repo: filter.repo, plan: filter.plan, period: filter.period } });
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
      case 'project':
        return projectName(s.key);
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
      <div className={emptyClass}>
        <h2>{p.none}</h2>
        <p className="hint">{p.noneHint}</p>
      </div>
    );
  else if (!shown.length)
    body = (
      <div className={emptyClass}>
        <h2>{p.noMatch}</h2>
        <Button size="small" onClick={clear}>
          {p.clear}
        </Button>
      </div>
    );
  else
    body = (
      <table className={cn('flog-table', tableClass)} aria-labelledby="flog-title">
        <thead>
          <tr>
            <th scope="col" className={headCell}>
              {l.cols.when}
            </th>
            <th scope="col" className={headCell}>
              {l.cols.card}
            </th>
            <th scope="col" className={headCell}>
              {l.cols.stars}
            </th>
            <th scope="col" className={headCell}>
              {l.cols.comment}
            </th>
            {COLUMNS.filter((c) => c !== group).map((c) => (
              <th key={c} scope="col" className={headCell}>
                {l.cols[c]}
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((s) => (
          <tbody key={s.key}>
            {group !== 'none' && (
              <tr>
                <th scope="rowgroup" colSpan={4 + COLUMNS.filter((c) => c !== group).length} className={cn(cell, 'bg-[color-mix(in_srgb,var(--chip)_70%,transparent)] pt-3.5')}>
                  <span className="font-semibold mr-3">{sectionName(s)}</span>
                  <span className="font-normal text-[12.5px] text-muted-foreground">{l.sectionSummary(s.responses.length, s.ratings, s.mean)}</span>
                </th>
              </tr>
            )}
            {s.responses.map((f) => (
              <Row key={f.id} f={f} projectName={projectName} without={group} />
            ))}
          </tbody>
        ))}
      </table>
    );

  return (
    <div id="flog" className="fixed inset-0 overflow-y-auto bg-panel">
      <main className="flog-main max-w-[1500px] mx-auto pt-[22px] px-10 pb-12">
        <a className={cn('flog-back inline-block mb-3.5', pageLinkClass)} href={back}>
          ← {p.title}
        </a>
        <header className={headClass}>
          <h1 id="flog-title" className={titleClass}>
            {l.title}
          </h1>
          {all && all.length > 0 && <p className="hint m-0">{l.summary(shown.length, ratings, all.length)}</p>}
        </header>
        <p className={aboutClass}>{l.about}</p>
        {all && all.length > 0 && (
          <div className={barClass}>
            <div className={filtersClass}>
              {choices.projects.length > 1 && <Choice label={p.filters.project} value={filter.project} options={choices.projects.map((id) => ({ id, name: projectName(id) }))} onChange={(v) => set('project', v)} />}
              {choices.repos.length > 1 && <Choice label={p.filters.repo} value={filter.repo} options={choices.repos.map((id) => ({ id, name: id }))} onChange={(v) => set('repo', v)} />}
              {choices.plans.length > 0 && <Choice label={p.filters.plan} value={filter.plan} options={choices.plans.map(({ id, title }) => ({ id, name: plain(title) }))} onChange={(v) => set('plan', v)} />}
              <label className={choiceClass}>
                <span>{p.filters.period}</span>
                <Select value={filter.period ?? 'all'} onValueChange={(picked) => set('period', picked === 'all' ? undefined : picked)}>
                  {PERIODS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d === 'all' ? p.periods.all : p.periods.days(Number(d))}
                    </SelectItem>
                  ))}
                </Select>
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
                <LinkButton className={clearClass} onClick={clear}>
                  {p.clear}
                </LinkButton>
              )}
            </div>
            <label className={choiceClass}>
              <span>{l.groupBy}</span>
              <Select value={group} onValueChange={(picked) => setState((s) => ({ ...s, group: picked as LogGroup }))}>
                {LOG_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {l.groups[g]}
                  </SelectItem>
                ))}
              </Select>
            </label>
          </div>
        )}
        {body}
      </main>
    </div>
  );
}

/** The columns of what a response is filed under; grouped by one of them, its section heading says it instead. */
const COLUMNS = ['config', 'plan', 'repo', 'project'] as const;

const known = (v: string | undefined) => (v === '' ? UNKNOWN : v);
const unknown = (v: string | undefined) => (v === UNKNOWN ? '' : v);

/** One response: when, its card (a link back to it; a deleted card's title without), stars, comment, whom it credits, plan, repository and project. */
function Row({ f, projectName, without }: { f: Feedback; projectName: (id: string) => string; without: LogGroup }) {
  const p = t.performance;
  const code = f.short ?? f.cardId;
  const name = plain(f.title) || code;
  const c = creditOf(f);
  const config = c ? configText(c, true) : f.attribution === 'mixed' && f.configs.length ? `${p.mixed}: ${f.configs.map((x) => configText(x, true)).join(' + ')}` : p.missing;
  return (
    <tr>
      <td className={cn(cell, 'whitespace-nowrap')}>{p.when(new Date(givenAt(f)))}</td>
      <td className={cn(cell, 'min-w-[180px] max-w-[320px]')}>
        {f.deleted ? (
          <span>
            {name} <span className="hint">{p.deleted}</span>
          </span>
        ) : (
          <a className="link card-link" href={cardPath(f.projectId, code)} onClick={(e) => switchTo(e, cardPath(f.projectId, code))}>
            {name}
          </a>
        )}
      </td>
      <td className={cn(cell, 'whitespace-nowrap')}>
        <StarText rating={f.answer.rating} />
      </td>
      <td className={cn(cell, 'min-w-[220px] whitespace-pre-wrap')}>{f.answer.comment ? t.feedback.quoted(f.answer.comment) : ''}</td>
      {without !== 'config' && <td className={cn(cell, !c && 'italic')}>{config}</td>}
      {without !== 'plan' && <td className={cell}>{f.plan ? plain(f.plan.title) : ''}</td>}
      {without !== 'repo' && <td className={cell}>{f.repo ?? ''}</td>}
      {without !== 'project' && <td className={cell}>{projectName(f.projectId)}</td>}
    </tr>
  );
}
