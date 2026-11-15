// The project's own settings, a docked sheet on the right like the inbox, opened from the sliders in the
// bar: a list of sections, each of which slides into a view of its own with a Back button (and Esc) to
// the list. Five of them hold settings of a repository, with a switcher of the project's repositories
// at the top where it has more than one; the others the project's own (models, code reviews,
// suggestions, the cards and plans). Each change saves at once: the project's into the configuration
// (`PUT /api/c/:project/settings`), a repository's into its entry there (`PUT /api/c/:project/repos`),
// shortly after the last key; what restarts a repository's agents waits for the owner's word. The rest
// of the project (name, old names, order, its repositories and removing it) is in the Configuration
// dialog, which the sheet's foot opens at this project.

import { ChevronLeft, ChevronRight, Sparkles, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { AgentRole, ConfigProblem, ConfigProblemCode, ProjectAgents, ProjectSettings, ProjectSettingsView } from '../../core/types';
import { SUGGEST_TOGGLES, suggestToggles, type SuggestToggle } from '../../core/labels';
import { api } from '../api';
import { AdapterSetup, CardArchiveField, Head, PlanBaselineField, ProjectSiteField, REPO_SETTING_GROUPS, RepoProblems, RepoSettingRows, repoName, repoSettingsAt, RightClickField, ShareSettings, type Takeover, workPlace, Workstations } from '../config';
import { cfgGroupClass, cfgGroupHeadClass, settingsSheetClass } from '../configClasses';
import { Docked, sheetTitleClass } from '../docked';
import { failText, t } from '../strings';
import { Button, LinkButton } from '../components/button';
import { Badge } from '../components/badge';
import { Callout, CalloutDescription } from '../components/callout';
import { CheckLabel } from '../components/check-label';
import { Checkbox } from '../components/checkbox';
import { SegmentedControl } from '../components/segmented';
import { Switch } from '../components/switch';
import { layerOpen } from '../components/ui';
import { pathClass, statusClass } from '../setupClasses';
import { AgentChoice, AgentModels, type Catalogs, chosen } from './models';
import { type ProjectRepos, useProjectRepos } from './repos';
import { cn } from 'cn';

/** The sheet's sections, in the order its list shows them. */
const SECTIONS = ['app', 'demos', 'agents', 'reviews', 'suggestions', 'repository', 'plans'] as const;
type Section = (typeof SECTIONS)[number];

/** Problems of where a repository's agents work: counted on "Agents and models"; every other one of a repository on "Repository". */
const PLACE_PROBLEMS: ConfigProblemCode[] = ['notClone', 'otherClone', 'hostRepo', 'hostName'];
const sectionOf = (p: ConfigProblem): Section => (PLACE_PROBLEMS.includes(p.code) ? 'agents' : 'repository');

/** The labels' checkboxes under "Suggest card labels", in the order they show. */
const LABEL_ORDER: SuggestToggle[] = ['priority', 'complexity', 'category'];

/** The sheet of the project `project`; read afresh each time it opens or the Configuration over it closes. */
export function ProjectSettingsSheet({ project, name, homePath, on, covered, problems, onConfig, onAddSite }: { project: string; name: string; /** The project's home repository, which proposing the demo site's tags reads. */ homePath?: string | undefined; /** Opens Configuration at the page that adds a demo site. */ onAddSite: () => void; on: boolean; /** The Configuration dialog is open over it: read afresh once it closes, as models may have changed there. */ covered: boolean; /** The configuration's problems, counted on the gear too. */ problems: number; onConfig: () => void }) {
  const [view, setView] = useState<ProjectSettingsView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogs, setCatalogs] = useState<Catalogs>({});
  const repos = useProjectRepos(project, on, covered);
  // the section open, and the one the list comes back to (focused, with the list sliding back in)
  const [open, setOpen] = useState<Section | null>(null);
  const [back, setBack] = useState<Section | null>(null);
  // the repository the per-repository views show, by its place on the project
  const [repoAt, setRepoAt] = useState(0);
  useEffect(() => {
    if (!on || covered) return;
    setStatus('');
    api.projectSettings(project).then(setView, (e) => setStatus(failText(e)));
  }, [on, covered, project]);
  useEffect(() => {
    if (!on) return;
    void Promise.all([api.codexModels(), api.agyModels()]).then(([codex, agy]) => setCatalogs({ codex, agy }), console.error);
  }, [on]);
  // another project starts at its list
  useEffect(() => {
    setOpen(null);
    setBack(null);
    setRepoAt(0);
  }, [project]);
  const l = t.projectSettings;
  const save = async (s: ProjectSettings) => {
    // shown at once; the server's answer, or the view before on a refusal, follows
    const before = view;
    setView((v) => v && { ...v, settings: { ...v.settings, ...s } as ProjectSettingsView['settings'] });
    setBusy(true);
    setStatus('');
    try {
      setView(await api.saveProjectSettings(project, s));
    } catch (e) {
      setView(before);
      setStatus(failText(e));
    }
    setBusy(false);
  };
  const choose = (role: AgentRole, change: Partial<ProjectAgents[AgentRole]> | null) => save({ agents: chosen(view!.settings.agents, role, change) });
  const shown = (s: Section | null) => {
    if (s === null) setBack(open);
    setOpen(s);
  };
  const said = status || repos.status;
  return (
    <Docked id="project-settings" on={on} label={l.title} className={settingsSheetClass}>
      {open && view ? (
        <SectionView key={open} section={open} onBack={() => shown(null)}>
          <SectionBody section={open} project={project} view={view} repos={repos} repoAt={Math.min(repoAt, Math.max(0, repos.repos.length - 1))} onRepo={setRepoAt} catalogs={catalogs} busy={busy} save={save} choose={choose} homePath={homePath} onAddSite={onAddSite} />
          {said && <p className={`hint ${statusClass}`}>{said}</p>}
        </SectionView>
      ) : (
        <div className={cn(back && 'animate-[push-back_.22s_ease-out]')}>
          <p className="cs-project mt-0 mr-10 mb-0.5 ml-0 text-xs text-muted-foreground">{name}</p>
          <h2 className={sheetTitleClass}>{l.title}</h2>
          <p className="text-muted-foreground text-sm leading-[1.45] mt-0 mx-0 mb-3">{l.hint}</p>
          {view && <SectionList view={view} repos={repos} focus={back} onOpen={shown} />}
          {said && <p className={`hint ${statusClass}`}>{said}</p>}
          <div className="cs-more mt-6 pt-3.5 border-t border-t-border flex flex-col items-start gap-1 text-sm">
            <span className="text-muted-foreground text-sm">{l.more}</span>
            <LinkButton type="button" onClick={onConfig}>
              {l.toConfig}
            </LinkButton>
            {problems > 0 && <Badge variant="count" className="bg-transparent p-0 text-warning text-sm">{t.config.problemCount(problems)}</Badge>}
          </div>
        </div>
      )}
    </Docked>
  );
}

/** The list of sections: each a row with its name, what it is set to, a count of its problems and a chevron. */
function SectionList({ view, repos, focus, onOpen }: { view: ProjectSettingsView; repos: ProjectRepos; focus: Section | null; onOpen: (s: Section) => void }) {
  const l = t.projectSettings;
  const list = useRef<HTMLUListElement>(null);
  // back from a view: its row has the focus again
  useEffect(() => {
    if (focus) list.current?.querySelector<HTMLButtonElement>(`[data-section="${focus}"]`)?.focus();
  }, [focus]);
  const problems = (s: Section) => (repos.view?.problems ?? []).filter((p) => p.repo !== undefined && sectionOf(p) === s).length;
  const resolved = repos.view?.resolved;
  const places = new Set(repos.repos.filter((r) => r.git !== false).map((r, i) => workPlace(r, resolved?.repos[i]).workIn));
  const home = repos.repos[0];
  const homeValues = resolved?.repos[0]?.values;
  const site = view.settings.demoSite?.url;
  const status: Partial<Record<Section, ReactNode>> = {
    demos: site ? hostOf(site) : undefined,
    agents: places.size > 1 ? l.workIn.mixed : places.size ? l.workIn[[...places][0]!] : undefined,
    reviews: view.settings.codeReviews.on ? <Badge className="bg-success-subtle text-success-strong">{l.enabled}</Badge> : undefined,
    repository:
      home && homeValues && home.git !== false
        ? (() => {
            const at = repoSettingsAt(home.settings, homeValues, () => {});
            return `${at.value<string>('branch')}${at.value('land') === 'pr' ? ` · ${l.viaPr}` : ''}`;
          })()
        : undefined,
  };
  return (
    <ul ref={list} className="cs-sections m-0 p-0 list-none rounded-lg border border-border divide-y divide-border overflow-hidden">
      {SECTIONS.map((s) => {
        const n = problems(s);
        const waits = s === 'agents' && repos.repos.some((_, i) => repos.restarts(i));
        return (
          <li key={s}>
            <button type="button" data-section={s} className="cs-section flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm bg-transparent cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" onClick={() => onOpen(s)}>
              <span className="min-w-0 flex-1 truncate">{t.projectSettings.sections[s]}</span>
              {waits && <span className="text-xs text-warning">{l.unsaved}</span>}
              {status[s] !== undefined && (typeof status[s] === 'string' ? <span className="max-w-[45%] truncate text-xs text-muted-foreground">{status[s]}</span> : status[s])}
              {n > 0 && (
                <Badge className="bg-warning-subtle py-0 text-warning-strong" title={l.problems(n)} aria-label={l.problems(n)}>
                  <TriangleAlert aria-hidden />
                  {n}
                </Badge>
              )}
              <ChevronRight size={16} strokeWidth={2} className="flex-none text-muted-foreground" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A site's address as the list shows it: its host. */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A section's own view, pushed in from the right: Back (and Esc) returns to the list, which has its row focused again. */
function SectionView({ section, onBack, children }: { section: Section; onBack: () => void; children: ReactNode }) {
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => backButton.current?.focus({ preventScroll: true }), []);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    // what opened over the view (a menu of a choice, in a portal) closes first
    if (e.key !== 'Escape' || layerOpen() || !e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    onBack();
  };
  return (
    <div data-esc-back className="cs-view animate-[push-in_.22s_ease-out]" onKeyDown={keys}>
      <Button ref={backButton} variant="ghost" size="small" className="cs-back -ml-2.5 mb-1 text-foreground" onClick={onBack}>
        <ChevronLeft aria-hidden />
        {t.projectSettings.back}
      </Button>
      <h2 className={cn(sheetTitleClass, 'mr-10')}>{t.projectSettings.sections[section]}</h2>
      {children}
    </div>
  );
}

interface BodyProps {
  section: Section;
  project: string;
  view: ProjectSettingsView;
  repos: ProjectRepos;
  repoAt: number;
  onRepo: (i: number) => void;
  catalogs: Catalogs;
  busy: boolean;
  save: (s: ProjectSettings) => Promise<void>;
  choose: (role: AgentRole, change: Partial<ProjectAgents[AgentRole]> | null) => void;
  homePath: string | undefined;
  onAddSite: () => void;
}

/** What a section's view holds: the repository's part first, under the switcher, then the project's. */
function SectionBody(p: BodyProps) {
  const { section, view, save } = p;
  const l = t.projectSettings;
  switch (section) {
    case 'app':
      return <RepoPart {...p} />;
    case 'demos':
      return (
        <>
          <RepoPart {...p} />
          <Head title={l.site} hint={t.config.projectSite.hint} sub />
          <ProjectSiteField bare project={p.project} value={view.settings.demoSite} {...(p.homePath ? { homePath: p.homePath } : {})} language={null} onAddSite={p.onAddSite} onChange={(demoSite) => save({ demoSite })} />
        </>
      );
    case 'agents':
      return (
        <>
          <RepoPart {...p} />
          <Head title={l.models} hint={l.modelsHint} sub />
          <AgentModels view={view} catalogs={p.catalogs} busy={p.busy} choose={p.choose} />
        </>
      );
    case 'reviews':
      return <Reviews {...p} />;
    case 'suggestions':
      return <Suggestions view={view} save={save} />;
    case 'repository':
      return <RepoPart {...p} />;
    case 'plans':
      return (
        <>
          <RepoPart {...p} />
          <Head title={l.cards} sub />
          <PlanBaselineField value={view.settings.planBaselines} onChange={(planBaselines) => save({ planBaselines })} />
          <CardArchiveField value={view.settings.archive} onChange={(archive) => save({ archive })} />
          <RightClickField value={view.settings.rightClick} onChange={(rightClick) => save({ rightClick })} />
        </>
      );
  }
}

/** The part of a per-repository view that is the repository's: the switcher, then its settings for the section. */
function RepoPart({ section, project, repos, repoAt, onRepo }: BodyProps) {
  const l = t.projectSettings;
  const v = repos.view;
  if (!v) return <p className="hint">{t.config.loading}</p>;
  const repo = repos.repos[repoAt];
  const resolved = v.resolved?.repos[repoAt];
  const problems = v.problems.filter((x) => x.repo === repoAt);
  const switcher = repos.repos.length > 1 && (
    <SegmentedControl
      className="cs-repos mb-2 w-full [&>*]:flex-1"
      label={l.repos}
      value={String(repoAt)}
      onValueChange={(x) => onRepo(Number(x))}
      options={repos.repos.map((r, i) => {
        const n = v.problems.filter((x) => x.repo === i && (section === 'repository' || sectionOf(x) === section)).length;
        return {
          value: String(i),
          label: (
            <>
              {repoName(r, v.resolved?.repos[i])}
              {n > 0 && <Badge className="ml-1.5 bg-warning-subtle py-0 text-warning-strong">{n}</Badge>}
            </>
          ),
        };
      })}
    />
  );
  if (!repo || !resolved || !v.resolved)
    return (
      <>
        {switcher}
        <p className="hint">{l.notResolved}</p>
        {v.problems.map((x, k) => <RepoProblemsOf key={k} problems={[x]} repos={repos} at={x.repo ?? 0} />)}
      </>
    );
  const folder = repo.git === false;
  const edit = (settings: typeof repo.settings) => {
    const { settings: _, ...rest } = repo;
    repos.edit(repoAt, settings ? { ...rest, settings } : rest);
  };
  const at = repoSettingsAt(repo.settings, resolved.values, edit);
  const takeover: Takeover = { saved: true, onReload: async () => repos.reload() };
  const name = repoName(repo, resolved);
  switch (section) {
    case 'app':
      return (
        <>
          {switcher}
          {!folder && <AdapterSetup stacked project={project} repo={resolved.id} takeover={takeover} icon={<Sparkles aria-hidden />} label={l.updateWithAgent} hint={l.updateWithAgentHint} />}
          <RepoSettingRows at={at} keys={folder ? REPO_SETTING_GROUPS.app : [...REPO_SETTING_GROUPS.app, 'softPaths']} />
        </>
      );
    case 'demos':
      return (
        <>
          {switcher}
          <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.demos} />
        </>
      );
    case 'agents':
      return (
        <>
          {switcher}
          <RepoProblemsOf problems={problems.filter((x) => sectionOf(x) === 'agents')} repos={repos} at={repoAt} />
          <Workstations repo={repo} resolved={resolved} onChange={(next) => repos.edit(repoAt, next)} />
          {repos.restarts(repoAt) && (
            <Callout kind="warn" className="cs-restart mt-3">
              <CalloutDescription>
                <p className="m-0">{l.restart(name)}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="small" variant="primary" disabled={repos.busy} onClick={() => repos.confirm(repoAt)}>
                    {l.restartSave}
                  </Button>
                  <Button size="small" disabled={repos.busy} onClick={() => repos.discard(repoAt)}>
                    {l.restartDiscard}
                  </Button>
                </div>
              </CalloutDescription>
            </Callout>
          )}
        </>
      );
    case 'repository':
      return (
        <>
          {switcher}
          <div className="cs-path py-2">
            <div className="text-muted-foreground text-sm">{l.path}</div>
            <code className={cn(pathClass, 'block py-1')}>{repo.path}</code>
            {(repoAt === 0 || folder) && <p className="hint m-0">{[...(repoAt === 0 ? [t.config.home] : []), ...(folder ? [t.config.folderMode] : [])].join(' · ')}</p>}
          </div>
          <RepoProblemsOf problems={problems} repos={repos} at={repoAt} />
          {!folder && (
            <>
              <div className={cfgGroupClass()}>
                <h5 className={cfgGroupHeadClass}>{t.config.groups.landing}</h5>
                <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.landing.filter((k) => k !== 'softPaths')} />
              </div>
              {/* its button's label is long for the sheet: it wraps */}
              <div className="mt-4 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:py-1.5 [&_[data-slot=button]]:whitespace-normal">
                <ShareSettings repo={repo} values={resolved.values} branch={at.value<string>('branch')} shareTo={resolved.shareTo} shareDirect={!!resolved.shareDirect} takeover={takeover} />
              </div>
            </>
          )}
        </>
      );
    case 'plans':
      return (
        <>
          {switcher}
          <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.plans} />
        </>
      );
    default:
      return null;
  }
}

/** Problems of the repository at `at`, each with what fixes it here (its commands to trust). */
function RepoProblemsOf({ problems, repos, at }: { problems: ConfigProblem[]; repos: ProjectRepos; at: number }) {
  const repo = repos.repos[at];
  if (!repo || !problems.length) return null;
  return <RepoProblems repo={repo} resolved={repos.view?.resolved?.repos[at]} problems={problems} where={t.config.repoAt(repo.path)} onRecheck={repos.reload} />;
}

/** A setting that is on or off: its name with the switch beside it, what it does below. */
function SwitchRow({ title, hint, checked, disabled, onChange, children }: { title: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  const id = useId();
  return (
    <div className="cs-switch py-2.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {title}
        </label>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
      {hint && <p className="hint mt-1 mb-0 text-sm leading-[1.45]">{hint}</p>}
      {children}
    </div>
  );
}

/** "Code reviews": the switch, then when they happen and the reviewer's model, the same choice as its row under "Agents and models". */
function Reviews({ view, save, catalogs, busy, choose }: BodyProps) {
  const l = t.projectSettings;
  const now = view.settings.codeReviews;
  return (
    <>
      <SwitchRow title={l.enableReviews} hint={l.enableReviewsHint} checked={now.on} onChange={(on) => save({ codeReviews: { ...now, on } })} />
      {!now.on ? (
        <Callout className="cs-reviews-off mt-2">
          <CalloutDescription>{l.reviewsOff}</CalloutDescription>
        </Callout>
      ) : (
        <>
          <div className="py-2">
            <div className="text-muted-foreground text-sm mb-1.5">{t.config.codeReviews.when}</div>
            <SegmentedControl className="w-full [&>*]:flex-1" label={t.config.codeReviews.when} value={now.mode} onValueChange={(mode) => save({ codeReviews: { ...now, mode } })} options={(['auto', 'manual'] as const).map((m) => ({ value: m, label: l.reviewsWhen[m] }))} />
            <p className="hint mt-1 mb-0 text-sm">{t.config.codeReviews.scope}</p>
          </div>
          <div className="py-2">
            <div className="text-muted-foreground text-sm mb-1.5">{l.reviewer}</div>
            <AgentChoice role="review" view={view} catalogs={catalogs} busy={busy} choose={choose} />
            <p className="hint mt-1 mb-0 text-sm">{l.reviewerHint}</p>
          </div>
        </>
      )}
    </>
  );
}

/** "Suggestions": new cards from the work retrospective, merges of duplicates, the labels Seismic chooses. */
function Suggestions({ view, save }: { view: ProjectSettingsView; save: (s: ProjectSettings) => Promise<void> }) {
  const l = t.projectSettings;
  const s = t.config.suggestions;
  const labels = suggestToggles(view.settings.suggest);
  const any = SUGGEST_TOGGLES.some((k) => labels[k]);
  const all = (on: boolean) => Object.fromEntries(SUGGEST_TOGGLES.map((k) => [k, on])) as Record<SuggestToggle, boolean>;
  return (
    <>
      <SwitchRow title={s.cards.title} hint={s.cards.hint} checked={view.settings.suggestCards} onChange={(suggestCards) => save({ suggestCards })} />
      <SwitchRow title={s.merges.title} hint={s.merges.hint} checked={view.settings.suggestMerges} onChange={(suggestMerges) => save({ suggestMerges })} />
      {/* on with none checked is off; turning it on checks them all */}
      <SwitchRow title={l.suggestLabels} hint={l.suggestLabelsHint} checked={any} onChange={(on) => save({ suggest: all(on) })}>
        <div className="cs-labels mt-1 pl-1">
          {LABEL_ORDER.map((k) => (
            <CheckLabel key={k}>
              <Checkbox checked={labels[k]} onCheckedChange={(v) => save({ suggest: { ...labels, [k]: v === true } })} />
              {t.config.suggest[k]}
            </CheckLabel>
          ))}
        </div>
      </SwitchRow>
    </>
  );
}
