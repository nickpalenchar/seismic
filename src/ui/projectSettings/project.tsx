// A project's entry in Seismic's configuration: its name and icon, old names, its repositories with
// their paths (and git set up in a folder without it), and its place in the list of projects. The
// settings sheet edits a running project's under "Configuration"; "+ New project" makes one in a
// pop-up. Unlike the sheet's other sections, the entry is a draft with a Save button: a new path or a
// repository added or removed starts or stops agents, so it applies once the owner says so. The whole
// configuration is checked (`POST /api/config/check`) and saved (`PUT /api/config`) with it.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { blockingProblems, type ConfigChecked, type ConfigView, type FilledClones, type ProjectConfig, restartsAgents, withClones } from '../../core/types';
import { api } from '../api';
import { projectPath, goTo } from '../address';
import { Problem, ProjectBlock, SHEET_PROBLEMS } from '../config';
import { failText, t } from '../strings';
import { Button } from '../components/button';
import { ConfirmDialog } from '../components/dialog';
import { Tooltip } from '../components/tooltip';
import { statusClass } from '../setupClasses';
import { qmovesClass } from '../queue';
import { keepConfigDraft, keptConfigDraft } from '../configDraft';
import { holdLeaving } from '../leaving';
import { cn } from 'cn';

type Checked = Pick<ConfigChecked, 'resolved' | 'problems'>;

/** What the entry is read from: the configuration as saved, the entry's place in it, and the check of it. */
interface Loaded {
  view: ConfigView;
  /** Its place among the projects; the length of the list for a new one. */
  at: number;
  saved: Checked | null;
  /** The entry as saved, or a new one with Project defaults. */
  entry: ProjectConfig;
}

/**
 * The entry of the running project `project`, or of a new one (`null`), as a draft: read while `on`,
 * checked as it is edited, saved with the rest of the configuration as it is.
 */
function useProjectEntry(project: string | null, on: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [entry, setEntry] = useState<ProjectConfig | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // a repository added here whose settings say clones gets as many as the first project's, until existing ones are listed
  const filled = useRef<FilledClones>(new Map());
  const load = async () => {
    const view = await api.config();
    if (project === null) {
      const defaults = await api.projectDefaults();
      const entry: ProjectConfig = { ...structuredClone(defaults.defaults ?? {}), repos: [{ path: '' }] };
      setLoaded({ view, at: view.projects.length, saved: null, entry });
      setEntry(entry);
      return;
    }
    const saved = await api.configCheck();
    const at = saved.resolved.findIndex((r) => r?.id === project);
    if (at < 0) return setStatus(t.projectSettings.notResolved);
    setLoaded({ view, at, saved, entry: view.projects[at]! });
    // an edit not saved yet comes back, after a reload too (Seismic's restart), while what it was made on is as saved
    setEntry(keptConfigDraft<ProjectConfig>(sessionStorage, `project:${project}`, view.projects[at]!) ?? view.projects[at]!);
  };
  useEffect(() => {
    if (!on) return;
    setStatus('');
    setChecked(null);
    filled.current.clear();
    load().catch((e) => setStatus(failText(e)));
  }, [on, project]);

  const all = loaded && entry ? (loaded.at < loaded.view.projects.length ? loaded.view.projects.map((p, i) => (i === loaded.at ? entry : p)) : [...loaded.view.projects, entry]) : null;
  const changed = !!loaded && !!entry && (project === null || JSON.stringify(entry) !== JSON.stringify(loaded.entry));
  // checked as it is edited; as saved, it has the check of the saved configuration
  const seq = useRef(0);
  const check = (projects: ProjectConfig[]) => {
    const n = ++seq.current;
    return api.checkConfig(projects).then((c) => {
      if (n !== seq.current || !loaded) return;
      setChecked(c);
      const next = withClones(projects, loaded.view.projects, c.resolved, filled.current);
      if (next) setEntry(next[loaded.at]!);
    }, console.error);
  };
  useEffect(() => {
    if (!all || !changed) return void ++seq.current;
    const h = setTimeout(() => void check(all), 300);
    return () => clearTimeout(h);
  }, [JSON.stringify(entry), loaded]);
  // the edit is written down as it changes, and forgotten once it is as saved
  useEffect(() => {
    if (project !== null && loaded && entry) keepConfigDraft(sessionStorage, `project:${project}`, entry, loaded.entry);
  }, [JSON.stringify(entry), loaded]);
  const shown = changed ? checked : (loaded?.saved ?? null);
  const at = loaded?.at ?? 0;
  const problems = shown?.problems ?? [];
  const blocking = shown ? blockingProblems(problems, (i) => i === at) : [];

  /** Saves the configuration with the entry; says whether it applies without a restart, and the id the project has. */
  const save = async (): Promise<{ id: string | null; restarting: boolean } | null> => {
    if (!all || !loaded) return null;
    setBusy(true);
    setStatus('');
    try {
      const { restarting, applied } = await api.saveConfig(all);
      const c = t.config;
      setStatus(restarting ? c.saved : applied ? (restartsAgents(loaded.view.projects, all) ? c.savedRestarts : c.savedApplied) : c.savedOnly);
      const id = checked?.resolved[at]?.id ?? project;
      if (!restarting && project !== null) await load();
      setBusy(false);
      return { id, restarting };
    } catch (e) {
      setStatus(failText(e));
      setBusy(false);
      return null;
    }
  };
  /** Moves the project one place up or down in the list of projects, saved at once. */
  const move = async (earlier: boolean) => {
    if (!loaded) return;
    const list = [...loaded.view.projects];
    const to = earlier ? at - 1 : at + 1;
    list.splice(to, 0, ...list.splice(at, 1));
    setBusy(true);
    try {
      await api.saveConfig(list);
      await load();
    } catch (e) {
      setStatus(failText(e));
    }
    setBusy(false);
  };
  return {
    loaded,
    entry,
    setEntry,
    shown,
    at,
    problems,
    blocking,
    changed,
    status,
    busy,
    save,
    move,
    reset: () => loaded && setEntry(loaded.entry),
    recheck: async () => {
      if (all) await check(all);
    },
  };
}

type Entry = ReturnType<typeof useProjectEntry>;

/**
 * While `unsaved`, whatever would leave the draft (Back, another sheet, another project) asks first:
 * "Stay" keeps it, "Discard and close" drops it (`discard`) and goes on. Returns the question, to render,
 * `ask`, for a leaving of the draft's own (its pop-up's Cancel), and `release`, once it is saved.
 */
function useLeaveGuard(unsaved: boolean, discard: () => void): [ReactNode, (proceed: () => void) => void, () => void] {
  const [asking, setAsking] = useState<(() => void) | null>(null);
  const ask = (proceed: () => void) => setAsking(() => proceed);
  const held = useRef<(() => void) | null>(null);
  const release = () => {
    held.current?.();
    held.current = null;
  };
  useEffect(() => {
    if (!unsaved) return;
    held.current = holdLeaving((proceed) => (ask(proceed), true));
    return release;
  }, [unsaved]);
  const l = t.projectSettings;
  const question = (
    <ConfirmDialog
      open={!!asking}
      onOpenChange={(o) => !o && setAsking(null)}
      title={l.unsavedTitle}
      className="cs-unsaved"
      confirm={{
        label: l.discardClose,
        variant: 'warning',
        className: 'cs-discard',
        onClick: () => {
          const go = asking;
          setAsking(null);
          discard();
          // discarded: what goes on asks nothing more of it
          release();
          go?.();
        },
      }}
      cancel={l.stay}
    >
      <p className="hint mt-0">{l.unsavedText}</p>
    </ConfirmDialog>
  );
  return [question, ask, release];
}

/** The entry's fields: its name, old names and repositories, with the problems of the project and of the configuration as a whole. */
function EntryFields({ e, pin, fresh }: { e: Entry; pin?: string; /** A new project: a path not typed yet is no problem to show, only one to fill in. */ fresh?: boolean }) {
  if (!e.loaded || !e.entry) return e.status ? null : <p className="hint">{t.config.loading}</p>;
  const { loaded, entry, at, shown, problems } = e;
  return (
    <>
      <ProjectBlock
        n={at}
        project={entry}
        checking={!shown}
        resolved={shown?.resolved[at] ?? null}
        running={loaded.view.running}
        {...(pin ? { pin } : {})}
        problems={problems.filter((p) => p.project === at && !SHEET_PROBLEMS.includes(p.code) && !(fresh && p.code === 'noPath'))}
        onRecheck={e.recheck}
        onChange={e.setEntry}
        onShow={() => {}}
      />
      {problems
        .filter((p) => p.project === undefined)
        .map((p, k) => (
          <Problem key={k} problem={p} where="" />
        ))}
    </>
  );
}

/** "Configuration" in the project's settings sheet: its entry, saved with its button, and its place in the list of projects. */
export function ProjectEntrySection({ project, on }: { project: string; on: boolean }) {
  const e = useProjectEntry(project, on);
  const [question] = useLeaveGuard(e.changed, () => {
    e.reset();
    keepConfigDraft(sessionStorage, `project:${project}`, null, null);
  });
  const l = t.projectSettings;
  const c = t.config;
  const n = e.loaded?.view.projects.length ?? 0;
  return (
    <div className="cs-entry [&_.c-row]:block [&_.c-row>*]:max-w-full">
      <p className="hint mt-0 mb-2 text-sm leading-[1.45]">{l.entryHint}</p>
      <EntryFields e={e} pin={project} />
      {e.loaded && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" className="cs-entry-save" disabled={!e.changed || e.busy || e.blocking.length > 0} onClick={() => void e.save()}>
            {c.saveOnly}
          </Button>
          {e.changed && (
            <Button disabled={e.busy} onClick={e.reset}>
              {c.reset}
            </Button>
          )}
          {n > 1 && !e.changed && (
            <span className={cn(qmovesClass, 'ml-auto items-center')}>
              <span className="mr-1 text-sm text-muted-foreground">{l.order}</span>
              {[true, false].map((earlier) => {
                const label = earlier ? c.moveUp : c.moveDown;
                return (
                  <Tooltip key={label} content={label}>
                    <Button size="small" className="qmove" disabled={e.busy || (earlier ? e.at === 0 : e.at === n - 1)} aria-label={label} onClick={() => void e.move(earlier)}>
                      {earlier ? '↑' : '↓'}
                    </Button>
                  </Tooltip>
                );
              })}
            </span>
          )}
        </div>
      )}
      {e.status && <p className={`hint ${statusClass}`}>{e.status}</p>}
      {question}
    </div>
  );
}

/** "+ New project": its name and first repository in a pop-up; once made, the page goes to it, and its settings sheet edits it further. */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const e = useProjectEntry(null, open);
  const l = t.projectSettings;
  // something typed in: closing the pop-up (Cancel, Esc) or leaving the page asks first
  const typed = open && !!e.entry && !!e.loaded && JSON.stringify(e.entry) !== JSON.stringify(e.loaded.entry);
  const [question, ask, release] = useLeaveGuard(typed, () => {});
  const ready = !!e.entry && e.entry.repos.some((r) => r.path.trim()) && !!e.shown && !e.blocking.length && !e.busy;
  const create = async () => {
    const made = await e.save();
    if (!made) return;
    // made: nothing is lost by going to it
    release();
    onClose();
    if (!made.id) return;
    // a restart reloads the page by itself; the new project's page is where it comes back
    if (made.restarting) location.assign(projectPath(made.id));
    else goTo(projectPath(made.id));
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && (typed ? ask(onClose) : onClose())}
      title={l.newProject}
      // as tall as with every line it can show (its address, the hints, a problem): it keeps its height as they come and go, the buttons at its foot
      className="cs-new-project flex w-[min(560px,100%)] min-h-[min(560px,calc(100dvh-48px))] flex-col [&_.c-row]:block [&_.c-row>*]:max-w-full [&>div:last-child]:mt-auto [&>div:last-child]:pt-4"
      confirm={{ label: l.create, className: 'cs-create', keepOpen: true, disabled: !ready, onClick: () => void create() }}
      cancel={l.cancel}
      busy={e.busy}
    >
      <p className="hint mt-0">{l.newProjectHint}</p>
      <EntryFields e={e} fresh />
      {e.status && <p className={`hint ${statusClass}`}>{e.status}</p>}
      {question}
    </ConfirmDialog>
  );
}
