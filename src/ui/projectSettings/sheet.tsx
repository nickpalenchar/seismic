












import { Archive, Bot, Cog, BrickWall, ChevronLeft, ChevronRight, CircleX, Film, GitPullRequest, Laptop, Lock, type LucideIcon, MessageSquareCode, Sparkle, Sparkles, Star, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import type { AgentRole, ConfigProblem, ConfigProblemCode, ProjectAgents, ProjectSettings, ProjectSettingsView } from '../../core/types';
import { SUGGEST_TOGGLES, suggestToggles, type SuggestToggle } from '../../core/labels';
import { api } from '../api';
import { getAgentModels } from '../clients/seismic';
import { AdapterSetup, CardArchiveField, Head, ModelFeedbackDocs, PlanBaselineField, ProjectSiteField, REPO_SETTING_GROUPS, RepoProblems, RepoSettingRows, repoName, repoSettingsAt, RightClickField, ShareSettings, type Takeover, workPlace, Workstations } from '../config';
import { cfgGroupClass, cfgGroupHeadClass, settingsSheetClass } from '../configClasses';
import { Docked, sheetTitleClass } from '../docked';
import { OpenPerformance } from '../performance';
import { failText, t } from '../strings';
import { Button, LinkButton } from '../components/button';
import { ConfirmDialog } from '../components/dialog';
import { Separator } from '../components/separator';
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
import { ProjectEntrySection } from './project';
import { leave } from '../leaving';
import { onSettingsFocus, SECTIONS, type Section, type SettingsFocus, takeSettingsFocus } from './focus';
import { cn } from 'cn';


const ICONS: Record<Section, LucideIcon> = { project: Cog, commands: BrickWall, agents: Bot, suggestions: Sparkle, environment: Laptop, reviews: MessageSquareCode, feedback: Star, git: GitPullRequest, archiving: Archive, demos: Film };





const PLACE_PROBLEMS: ConfigProblemCode[] = ['notClone', 'otherClone', 'hostRepo', 'hostName'];
const sectionOf = (p: ConfigProblem): Section => (p.code === 'untrusted' ? 'commands' : PLACE_PROBLEMS.includes(p.code) ? 'agents' : 'git');


const LABEL_ORDER: SuggestToggle[] = ['priority', 'complexity', 'category'];

interface SettingsProps {
  project: string;
  name: string;
  
  homePath?: string | undefined;
  
  onAddSite: () => void;
  on: boolean;
  
  covered: boolean;
  
  onShowProject?: (id: string) => void;
}

/** The sheet of the project `project`, docked on the right; read afresh each time it opens or the Configuration over it closes. */
export function ProjectSettingsSheet(p: SettingsProps) {
  return (
    <Docked id="project-settings" on={p.on} label={t.projectSettings.title} className={settingsSheetClass}>
      <ProjectSettingsBody {...p} />
    </Docked>
  );
}

/**
 * The list of sections and the view open, in the docked sheet or on the phone's page of its own
 * (`phone`: under the page's bar, which names it).
 */
export function ProjectSettingsBody({ project, name, homePath, on, covered, onAddSite, onShowProject, phone }: SettingsProps & { phone?: boolean }) {
  const [view, setView] = useState<ProjectSettingsView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogs, setCatalogs] = useState<Catalogs>({});
  const repos = useProjectRepos(project, on, covered);
  
  const [open, setOpen] = useState<Section | null>(null);
  const [back, setBack] = useState<Section | null>(null);
  
  const [repoAt, setRepoAt] = useState(0);
  useEffect(() => {
    if (!on || covered) return;
    setStatus('');
    api.projectSettings(project).then(setView, (e) => setStatus(failText(e)));
  }, [on, covered, project]);
  useEffect(() => {
    if (!on || covered) return;
    let active = true;
    setCatalogs({});
    void api.harnessAvailability().then((connected) => {
      if (!active) return;
      setCatalogs({ connected });
      for (const harness of ['codex', 'agy'] as const) {
        if (!connected.configured.includes(harness)) continue;
        void getAgentModels(harness, { fresh: true }).then((models) => {
          if (active) setCatalogs((current) => ({ ...current, [harness]: models }));
        }, console.error);
      }
    }, console.error);
    return () => { active = false; };
  }, [on, covered]);
  
  useEffect(() => {
    setOpen(null);
    setBack(null);
    setRepoAt(0);
  }, [project]);
  
  const [jump, setJump] = useState<SettingsFocus | null>(null);
  const [mark, setMark] = useState<SettingsFocus | null>(null);
  useEffect(() => {
    if (!on) return;
    const take = () => {
      const f = takeSettingsFocus(project);
      if (f) setJump(f);
    };
    take();
    return onSettingsFocus(take);
  }, [on, project]);
  useEffect(() => {
    if (!on || !jump || jump.project !== project || !view) return;
    const resolved = repos.view?.resolved;
    if (jump.repo && (!resolved || resolved.id !== project)) return;
    setJump(null);
    leave(() => {
      if (jump.repo) {
        const i = resolved?.repos.findIndex((r) => r?.id === jump.repo) ?? -1;
        if (i >= 0) setRepoAt(i);
      }
      setOpen(jump.section ?? null);
      setMark(jump.field ? jump : null);
    });
  }, [on, jump, repos.view, project, view]);
  useEffect(() => {
    if (!mark) return;
    const h = setTimeout(() => setMark(null), 2400);
    return () => clearTimeout(h);
  }, [mark]);
  useEffect(() => {
    if (!on) setMark(null);
  }, [on]);
  const l = t.projectSettings;
  const save = async (s: ProjectSettings) => {
    
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
  
  const shown = (s: Section | null) =>
    leave(() => {
      if (s === null) setBack(open);
      if (open === 'project' && s !== 'project') void repos.reload();
      setOpen(s);
      setMark(null);
    });
  const said = status || repos.status;
  return (
    <>
      {open && view ? (
        <SectionView key={open} section={open} onBack={() => shown(null)}>
          { }
          <Said status={said} failed={repos.failed} />
          <SectionBody section={open} project={project} view={view} repos={repos} repoAt={Math.min(repoAt, Math.max(0, repos.repos.length - 1))} onRepo={(i) => { setMark(null); setRepoAt(i); }} catalogs={catalogs} busy={busy} save={save} choose={choose} homePath={homePath} onAddSite={onAddSite} onShowProject={onShowProject} mark={mark?.project === project ? mark : null} />
        </SectionView>
      ) : (
        <div className={cn(back && 'animate-[push-back_.22s_ease-out]')}>
          {!phone && (
            <>
              <p className="cs-project mt-0 mr-10 mb-0.5 ml-0 text-xs text-muted-foreground">{name}</p>
              <h2 className={sheetTitleClass}>{l.title}</h2>
            </>
          )}
          {view && <SectionList view={view} repos={repos} focus={back} onOpen={shown} />}
          <Said status={said} failed={repos.failed} />
          {repos.view && (
            <>
              <Separator className="my-2" />
              <ArchiveProject project={project} name={name} last={repos.view.projects < 2} />
            </>
          )}
        </div>
      )}
    </>
  );
}


const rowClass = 'cs-section -mx-5.5 h-auto w-[calc(100%+2.75rem)] justify-start gap-3 rounded-none px-5.5 py-2.5 text-left text-base font-normal text-foreground [&_svg:not([class*=size-])]:size-[18px]';

/** The list of sections: Allowed commands, then the others, each with what it is set to and a count of what needs the owner. */
function SectionList({ view, repos, focus, onOpen }: { view: ProjectSettingsView; repos: ProjectRepos; focus: Section | null; onOpen: (s: Section) => void }) {
  const l = t.projectSettings;
  const list = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (focus) list.current?.querySelector<HTMLButtonElement>(`[data-section="${focus}"]`)?.focus();
  }, [focus]);
  const problems = (s: Section) => (repos.view?.problems ?? []).filter((p) => (p.repo === undefined ? 'project' : sectionOf(p)) === s).length;
  const resolved = repos.view?.resolved;
  const places = new Set(repos.repos.flatMap((r, i) => (r.git === false ? [] : [workPlace(r, resolved?.repos[i]).workIn])));
  const home = repos.repos[0];
  const homeValues = resolved?.repos[0]?.values;
  const site = view.settings.demoSite?.url;
  const status: Partial<Record<Section, ReactNode>> = {
    demos: site ? hostOf(site) : undefined,
    agents: places.size > 1 ? l.workIn.mixed : places.size ? l.workIn[[...places][0]!] : undefined,
    reviews: view.settings.codeReviews.on ? <Badge className="bg-success-subtle py-0 text-success-strong">{l.enabled}</Badge> : undefined,
    feedback: view.settings.modelFeedback ? <Badge className="bg-success-subtle py-0 text-success-strong">{l.enabled}</Badge> : undefined,
    git:
      home && homeValues && home.git !== false
        ? (() => {
            const at = repoSettingsAt(home.settings, homeValues, () => {});
            return `${at.value<string>('branch')}${at.value('land') === 'pr' ? ` · ${l.viaPr}` : ''}`;
          })()
        : undefined,
  };
  const row = (s: Section) => {
    const n = problems(s);
    const waits = s === 'agents' && repos.repos.some((_, i) => repos.restarts(i));
    const Icon = ICONS[s];
    const error = s === 'commands' || s === 'git';
    const said = s === 'commands' ? l.toTrust(n) : l.problems(n);
    return (
      <Button key={s} variant="ghost" data-section={s} className={rowClass} onClick={() => onOpen(s)}>
        <Icon aria-hidden className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{l.sections[s]}</span>
        {waits && <span className="text-xs text-warning">{l.unsaved}</span>}
        {status[s] !== undefined && (typeof status[s] === 'string' ? <span className="max-w-[40%] truncate text-xs text-muted-foreground">{status[s]}</span> : status[s])}
        {n > 0 && (
          <Badge variant={error ? 'destructive' : 'default'} className={cn('py-0', !error && 'bg-warning-subtle text-warning-strong')} title={said} aria-label={said}>
            {s === 'git' ? <CircleX aria-hidden /> : s !== 'commands' && <TriangleAlert aria-hidden />}
            {n}
          </Badge>
        )}
        <ChevronRight aria-hidden className="text-muted-foreground" />
      </Button>
    );
  };
  return (
    <div ref={list} className="cs-sections flex flex-col">
      {row('project')}
      {row('commands')}
      <Separator className="my-2" />
      {SECTIONS.filter((s) => s !== 'project' && s !== 'commands').map(row)}
    </div>
  );
}

/** "Archive project" at the foot of the list, after a confirm: the project leaves Seismic, its cards kept. */
function ArchiveProject({ project, name, last }: { project: string; name: string;  last: boolean }) {
  const l = t.projectSettings;
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const archive = async () => {
    setError('');
    try {
      await api.archiveProject(project);
      
      location.assign('/');
    } catch (e) {
      setError(failText(e));
    }
  };
  return (
    <>
      <Button variant="ghost" className={cn(rowClass, 'cs-archive text-destructive hover:not-disabled:text-destructive')} disabled={last} title={last ? l.archiveLast : undefined} onClick={() => setAsking(true)}>
        <Lock aria-hidden />
        <span className="min-w-0 flex-1 truncate">{l.archiveProject}</span>
      </Button>
      {error && <p className="p-error">{error}</p>}
      <ConfirmDialog
        open={asking}
        onOpenChange={(o) => !o && setAsking(false)}
        title={l.archiveTitle(name)}
        confirm={{ label: l.archiveConfirm, variant: 'destructive', className: 'cs-archive-confirm', onClick: () => void archive() }}
        cancel={l.archiveBack}
      >
        <p className="hint mt-0 mb-4">{l.archiveText}</p>
      </ConfirmDialog>
    </>
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
  const box = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!box.current?.contains(document.activeElement)) backButton.current?.focus({ preventScroll: true });
  }, []);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    
    if (e.key !== 'Escape' || layerOpen() || !e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    onBack();
  };
  return (
    <div ref={box} data-esc-back className="cs-view animate-[push-in_.22s_ease-out]" onKeyDown={keys}>
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
  
  mark: SettingsFocus | null;
  onShowProject: SettingsProps['onShowProject'];
}

/** What a section's view holds: the repository's part first, under the switcher, then the project's. */
function SectionBody(p: BodyProps) {
  const { section, view, save } = p;
  const l = t.projectSettings;
  switch (section) {
    case 'project':
      return <ProjectEntrySection project={p.project} on onShowProject={p.onShowProject} />;
    case 'commands':
      return <AllowedCommands repos={p.repos} />;
    case 'environment':
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
    case 'feedback':
      return <ModelFeedback view={view} save={save} />;
    case 'git':
      return <RepoPart {...p} />;
    case 'archiving':
      return (
        <>
          <CardArchiveField value={view.settings.archive} onChange={(archive) => save({ archive })} />
          <RightClickField value={view.settings.rightClick} onChange={(rightClick) => save({ rightClick })} />
        </>
      );
  }
}

/**
 * "Allowed commands": each repository's commands that wait for the owner's trust, with what they do
 * and their lines against those trusted before, and the button that trusts them.
 */
function AllowedCommands({ repos }: { repos: ProjectRepos }) {
  const l = t.projectSettings;
  const v = repos.view;
  if (!v) return <p className="hint">{t.config.loading}</p>;
  return (
    <>
      <p className="hint mt-0 mb-2 text-sm leading-[1.45]">{l.commandsHint}</p>
      {repos.repos.map((r, i) => {
        const held = v.problems.filter((x) => x.repo === i && x.code === 'untrusted');
        return (
          <div key={r.path} className={cfgGroupClass()}>
            <h5 className={cfgGroupHeadClass}>{repoName(r, v.resolved?.repos[i])}</h5>
            {held.length ? <RepoProblemsOf problems={held} repos={repos} at={i} /> : <p className="hint mt-1 mb-0 text-sm">{l.allTrusted}</p>}
          </div>
        );
      })}
    </>
  );
}

/** The part of a per-repository view that is the repository's: the switcher, then its settings for the section. */
function RepoPart({ section, project, view, save, repos, repoAt, onRepo, mark }: BodyProps) {
  const l = t.projectSettings;
  const v = repos.view;
  const box = useRef<HTMLDivElement>(null);
  const key = mark?.field;
  const place = key === 'clones' || key === 'slots';
  useEffect(() => {
    if (!key || !box.current) return;
    const field = box.current.querySelector<HTMLElement>(place ? (key === 'slots' ? '.cfg-slots' : '.cfg-clone-count') : `[data-setting="${key}"]`);
    if (!field) return;
    const controls = field.querySelector('.cfg-control');
    const control = controls?.querySelector<HTMLElement>('[data-slot="toggle-group-item"][data-state="on"]:enabled')
      ?? controls?.querySelector<HTMLElement>('input:enabled, textarea:enabled, select:enabled, button:enabled');
    const before = document.activeElement;
    const take = () => {
      field.scrollIntoView({ block: 'center' });
      control?.focus({ preventScroll: true });
    };
    take();
    
    const h = setTimeout(() => {
      if (control !== document.activeElement && (document.activeElement === before || document.activeElement?.matches('.cs-back'))) take();
    }, 450);
    return () => clearTimeout(h);
  }, [mark, repoAt, !!v?.resolved]);
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
        const n = v.problems.filter((x) => x.repo === i && sectionOf(x) === section).length;
        return {
          value: String(i),
          label: (
            <>
              {repoName(r, v.resolved?.repos[i])}
              {n > 0 && (
                <Badge variant={section === 'git' ? 'destructive' : 'default'} className={cn('ml-1.5 py-0', section !== 'git' && 'bg-warning-subtle text-warning-strong')}>
                  {n}
                </Badge>
              )}
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
  const at = repoSettingsAt(repo.settings, resolved.values, edit, place ? null : key);
  
  const takeover: Takeover = { saved: !repos.unsaved(repoAt) && !repos.busy, onReload: async () => repos.reload(), prepare: () => repos.settle(repoAt) };
  const name = repoName(repo, resolved);
  switch (section) {
    case 'environment':
      return (
        <>
          {switcher}
          {!folder && <AdapterSetup stacked project={project} repo={resolved.id} takeover={takeover} icon={<Sparkles aria-hidden />} label={l.updateWithAgent} hint={l.updateWithAgentHint} />}
          <div ref={box}>
            <RepoSettingRows at={at} keys={folder ? REPO_SETTING_GROUPS.app : [...REPO_SETTING_GROUPS.app, 'softPaths']} />
          </div>
        </>
      );
    case 'demos':
      return (
        <>
          {switcher}
          <div ref={box}>
            <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.demos} />
          </div>
        </>
      );
    case 'agents':
      return (
        <>
          {switcher}
          <RepoProblemsOf problems={problems.filter((x) => sectionOf(x) === 'agents')} repos={repos} at={repoAt} />
          <Workstations ref={box} flash={place} repo={repo} resolved={resolved} onChange={(next) => repos.edit(repoAt, next)} />
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
    case 'git':
      return (
        <div ref={box}>
          {switcher}
          <div className="cs-path py-2">
            <div className="text-muted-foreground text-sm">{l.path}</div>
            <code className={cn(pathClass, 'block py-1')}>{repo.path}</code>
            {(repoAt === 0 || folder) && <p className="hint m-0">{[...(repoAt === 0 ? [t.config.home] : []), ...(folder ? [t.config.folderMode] : [])].join(' · ')}</p>}
          </div>
          <RepoProblemsOf problems={problems.filter((x) => sectionOf(x) === 'git')} repos={repos} at={repoAt} />
          {folder && <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.plans} />}
          {folder && <PlanBaselineField value={view.settings.planBaselines} onChange={(planBaselines) => save({ planBaselines })} />}
          {!folder && (
            <>
              <div className={cfgGroupClass()}>
                <h5 className={cfgGroupHeadClass}>{t.config.groups.landing}</h5>
                <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.landing.filter((k) => k !== 'softPaths')} />
              </div>
              <div className={cfgGroupClass()}>
                <h5 className={cfgGroupHeadClass}>{l.plans}</h5>
                <RepoSettingRows at={at} keys={REPO_SETTING_GROUPS.plans} />
                <PlanBaselineField value={view.settings.planBaselines} onChange={(planBaselines) => save({ planBaselines })} />
              </div>
              { }
              <div className="mt-4 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:py-1.5 [&_[data-slot=button]]:whitespace-normal">
                <ShareSettings repo={repo} values={resolved.values} branch={at.value<string>('branch')} shareTo={resolved.shareTo} shareDirect={!!resolved.shareDirect} settingsFile={resolved.settingsFile} takeover={takeover} />
              </div>
            </>
          )}
        </div>
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
function SwitchRow({ title, hint, checked, disabled, onChange, children }: { title: ReactNode; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
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

/** "Model feedback": whether approving an agent's work asks for a rating, and the ratings compared, where it is on. */
function ModelFeedback({ view, save }: { view: ProjectSettingsView; save: (s: ProjectSettings) => Promise<void> }) {
  const l = t.feedback.setting;
  const openPerformance = useContext(OpenPerformance);
  const on = view.settings.modelFeedback;
  const title = (
    <span className="inline-flex items-center gap-2">
      {l.title}
      <Badge variant="secondary">{l.beta}</Badge>
    </span>
  );
  return (
    <SwitchRow title={title} hint={<>{l.hint} <ModelFeedbackDocs /></>} checked={on} onChange={(modelFeedback) => save({ modelFeedback })}>
      {on && openPerformance && (
        <Button size="small" className="cs-perf mt-2.5" title={t.performance.openHint} onClick={openPerformance}>
          {t.performance.open}
        </Button>
      )}
    </SwitchRow>
  );
}

/** "Suggestions": new cards from the work retrospective, merges of duplicates, the labels Seismic chooses. */
function Suggestions({ view, save }: { view: ProjectSettingsView; save: (s: ProjectSettings) => Promise<void> }) {
  const l = t.projectSettings;
  const s = t.config.suggestions;
  const labels = suggestToggles(view.settings.suggest);
  const any = SUGGEST_TOGGLES.some((k) => labels[k]);
  const on = view.settings.suggestLabels;
  const all = Object.fromEntries(SUGGEST_TOGGLES.map((k) => [k, true])) as Record<SuggestToggle, boolean>;
  return (
    <>
      <SwitchRow title={s.cards.title} hint={s.cards.hint} checked={view.settings.suggestCards} onChange={(suggestCards) => save({ suggestCards })} />
      <SwitchRow title={s.merges.title} hint={s.merges.hint} checked={view.settings.suggestMerges} onChange={(suggestMerges) => save({ suggestMerges })} />
      { }
      <SwitchRow title={l.suggestLabels} hint={l.suggestLabelsHint} checked={on} onChange={(suggestLabels) => save(suggestLabels && !any ? { suggestLabels, suggest: all } : { suggestLabels })}>
        <div className="cs-labels mt-1 pl-1">
          {LABEL_ORDER.map((k) => (
            <CheckLabel key={k}>
              <Checkbox checked={labels[k]} disabled={!on} onCheckedChange={(v) => save({ suggest: { ...labels, [k]: v === true } })} />
              {t.config.suggest[k]}
            </CheckLabel>
          ))}
        </div>
      </SwitchRow>
    </>
  );
}

/** What the last change came to: a refusal, and a repository's save that was refused, with "Try again". */
function Said({ status, failed }: { status: string; failed: ProjectRepos['failed'] }) {
  const l = t.projectSettings;
  return (
    <>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
      {failed && (
        <p className={cn('hint cs-failed text-warning', statusClass)}>
          {failed.status}{' '}
          <LinkButton type="button" onClick={failed.retry}>
            {l.retry}
          </LinkButton>
        </p>
      )}
    </>
  );
}
