






import { type ReactNode, useEffect, useRef, useState } from 'react';
import { blockingProblems, type ConfigChecked, type ConfigView, type FilledClones, type ProjectConfig, restartsAgents, withClones } from '../../core/types';
import { api } from '../api';
import { getConfiguration, getSetting, saveConfiguration } from '../clients/seismic';
import { projectPath, goTo } from '../address';
import { Problem, ProjectBlock, SHEET_PROBLEMS } from '../config';
import { failText, t } from '../strings';
import { Button } from '../components/button';
import { ConfirmDialog } from '../components/dialog';
import { Tooltip } from '../components/tooltip';
import { statusClass } from '../setupClasses';
import { qmovesClass } from '../queue';
import { draftSession, onHandOverEntries } from '../draftSession';
import { configDraftKey, keepConfigDraft, keptConfigDraft } from '../configDraft';
import { holdLeaving, leave } from '../leaving';
import { entryDraft, type EntryDraft, mergedEntry, withEntry } from './entry';
import { showSettingsAt } from './focus';
import { cn } from 'cn';


interface Loaded {
  view: ConfigView;
  
  at: number;
  saved: ConfigChecked | null;
  
  entry: EntryDraft;
}

/**
 * The entry of the running project `project`, or of a new one (`null`), as a draft: read while `on`,
 * checked as it is edited, saved with the rest of the configuration as it is.
 */
function useProjectEntry(project: string | null, on: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [entry, setEntry] = useState<EntryDraft | null>(null);
  const [checked, setChecked] = useState<{ result: ConfigChecked; at: number } | null>(null);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [checkFailure, setCheckFailure] = useState<{ draft: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  
  const [checkedOf, setCheckedOf] = useState('');
  
  const filled = useRef<FilledClones>(new Map());
  const load = async () => {
    const view = await getConfiguration();
    if (project === null) {
      const defaults = await getSetting('projectDefaults');
      const entry = entryDraft({ ...structuredClone(defaults.defaults ?? {}), repos: [{ path: '' }] }, null);
      setLoaded({ view, at: view.projects.length, saved: null, entry });
      setEntry(entry);
      return;
    }
    const saved = await api.configCheck();
    const at = saved.resolved.findIndex((r) => r?.id === project);
    if (at < 0) return false;
    const original = saved.projects[at]!;
    const baseline = entryDraft(original);
    setLoaded({ view: { ...view, projects: saved.projects }, at, saved, entry: baseline });
    const kept = keptConfigDraft<ProjectConfig>(draftSession, `project:${project}`, baseline);
    setEntry(kept ? entryDraft(kept, original) : baseline);
  };
  const retryLoad = async () => {
    setLoadError('');
    try {
      if (await load() === false) setLoadError(t.projectSettings.notResolved);
    } catch (e) {
      setLoadError(failText(e));
    }
  };
  useEffect(() => {
    if (!on) return;
    setStatus('');
    setLoaded(null);
    setEntry(null);
    setChecked(null);
    setCheckedOf('');
    setCheckFailure(null);
    filled.current.clear();
    void retryLoad();
  }, [on, project]);

  const serialized = JSON.stringify(entry);
  const changed = !!loaded && !!entry && (project === null || serialized !== JSON.stringify(loaded.entry));
  const checkError = checkFailure?.draft === serialized ? checkFailure.message : '';
  const pending = changed && (checkedOf !== serialized || !!checkError);
  /** Read the latest entries and resolve the project index from the same configuration. */
  const fresh = async () => {
    if (project === null) {
      const { projects } = await getConfiguration();
      return { projects, at: projects.length };
    }
    const { projects, resolved } = await api.configCheck();
    const at = resolved.findIndex((r) => r?.id === project);
    return at < 0 ? null : { projects, at };
  };
  
  const seq = useRef(0);
  const check = async (draft: EntryDraft) => {
    const n = ++seq.current;
    const of = JSON.stringify(draft);
    setCheckedOf('');
    setCheckFailure(null);
    try {
      const now = await fresh();
      if (n !== seq.current) return;
      if (!now) {
        setCheckFailure({ draft: of, message: t.projectSettings.notResolved });
        return;
      }
      const candidate = mergedEntry(draft, now.projects[now.at]);
      const result = await api.checkConfig(withEntry(now.projects, now.at, candidate));
      if (n !== seq.current) return;
      setChecked({ result, at: now.at });
      setCheckedOf(of);
      
      const known = draft.repos.filter((r) => r.originalPath !== null);
      const next = withClones([candidate], [...now.projects, { repos: known }], [result.resolved[now.at] ?? null], filled.current);
      if (next) setEntry({ ...draft, repos: draft.repos.map((r, i) => r.originalPath === null ? { ...next[0]!.repos[i]!, originalPath: null } : r) });
    } catch (e) {
      if (n === seq.current) setCheckFailure({ draft: of, message: failText(e) });
    }
  };
  useEffect(() => {
    if (!on || !entry || !changed) return;
    const h = setTimeout(() => void check(entry), 300);
    return () => {
      clearTimeout(h);
      ++seq.current;
    };
  }, [on, serialized, loaded]);
  
  useEffect(() => {
    if (project !== null && loaded && entry) keepConfigDraft(draftSession, `project:${project}`, entry, loaded.entry);
  }, [JSON.stringify(entry), loaded]);
  useEffect(() => {
    const saved = loaded?.saved;
    if (!on || project === null || !saved) return;
    const name = `project:${project}` as const;
    return onHandOverEntries((keys) => {
      if (!keys.has(configDraftKey(name))) return;
      const kept = keptConfigDraft<ProjectConfig>(draftSession, name, loaded.entry);
      if (kept) setEntry(entryDraft(kept, saved.projects[loaded.at]));
    });
  }, [on, project, loaded]);
  const shown = changed ? (checked?.result ?? null) : (loaded?.saved ?? null);
  const at = (changed ? checked?.at : undefined) ?? loaded?.at ?? 0;
  const problems = shown?.problems ?? [];
  const blocking = shown ? blockingProblems(problems, (i) => i === at) : [];

  /** Saves the configuration with the entry; says whether it applies without a restart, and the id the project has. */
  const save = async (): Promise<{ id: string | null; restarting: boolean } | null> => {
    if (!entry || !loaded) return null;
    setBusy(true);
    setStatus('');
    let validating = true;
    try {
      const now = await fresh();
      if (!now) {
        setCheckFailure({ draft: serialized, message: t.projectSettings.notResolved });
        return null;
      }
      const list = withEntry(now.projects, now.at, mergedEntry(entry, now.projects[now.at]));
      
      const c = await api.checkConfig(list);
      validating = false;
      ++seq.current;
      setChecked({ result: c, at: now.at });
      setCheckedOf(JSON.stringify(entry));
      if (blockingProblems(c.problems, (i) => i === now.at).length) return null;
      const { saved: { restarting, applied } } = await saveConfiguration(list);
      
      
      if (project !== null) {
        keepConfigDraft(draftSession, `project:${project}`, null, null);
        if (!restarting) await load();
      }
      const s = t.config;
      setStatus(restarting ? s.saved : applied ? (restartsAgents(now.projects, list) ? s.savedRestarts : s.savedApplied) : s.savedOnly);
      const id = c.resolved[now.at]?.id ?? project;
      return { id, restarting };
    } catch (e) {
      if (validating) setCheckFailure({ draft: serialized, message: failText(e) });
      else setStatus(failText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  /** Moves the project one place up or down in the list of projects, saved at once. */
  const move = async (earlier: boolean) => {
    if (!loaded) return;
    setBusy(true);
    try {
      const now = await fresh();
      if (!now) return setStatus(t.projectSettings.notResolved);
      const list = [...now.projects];
      const to = earlier ? now.at - 1 : now.at + 1;
      if (to < 0 || to >= list.length) return;
      list.splice(to, 0, ...list.splice(now.at, 1));
      await saveConfiguration(list);
      await load();
    } catch (e) {
      setStatus(failText(e));
    } finally {
      setBusy(false);
    }
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
    pending,
    checkError,
    loadError,
    retryLoad,
    status,
    busy,
    save,
    move,
    reset: () => {
      setCheckFailure(null);
      if (loaded) setEntry(loaded.entry);
    },
    recheck: async () => {
      if (entry) await check(entry);
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
  type Question = { proceed: () => void; dismiss: (cancelled: boolean) => void };
  const [asking, setAsking] = useState<Question | null>(null);
  const current = useRef<Question | null>(null);
  const ask = (proceed: () => void, cancel = () => {}, signal?: AbortSignal) => {
    current.current?.dismiss(true);
    const abort = () => question.dismiss(true);
    const question: Question = {
      proceed,
      dismiss: (cancelled) => {
        if (current.current !== question) return;
        signal?.removeEventListener('abort', abort);
        current.current = null;
        setAsking(null);
        if (cancelled) cancel();
      },
    };
    current.current = question;
    signal?.addEventListener('abort', abort, { once: true });
    setAsking(question);
  };
  const held = useRef<(() => void) | null>(null);
  const release = () => {
    held.current?.();
    held.current = null;
  };
  useEffect(() => {
    if (!unsaved) return;
    held.current = holdLeaving((proceed, cancel, signal) => (ask(proceed, cancel, signal), true));
    return release;
  }, [unsaved]);
  useEffect(() => () => current.current?.dismiss(true), []);
  const l = t.projectSettings;
  const question = (
    <ConfirmDialog
      open={!!asking}
      onOpenChange={(o) => !o && asking?.dismiss(true)}
      title={l.unsavedTitle}
      className="cs-unsaved"
      confirm={{
        label: l.discardClose,
        variant: 'warning',
        className: 'cs-discard',
        keepOpen: true,
        onClick: () => {
          if (!asking || current.current !== asking) return;
          asking.dismiss(false);
          discard();
          
          release();
          asking.proceed();
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
function EntryFields({ e, pin, fresh, onShowProject, onNavigate }: { e: Entry; pin?: string;  fresh?: boolean; onShowProject?: ((id: string) => void) | undefined; onNavigate?: () => void }) {
  if (!e.loaded || !e.entry) return e.loadError
    ? <EntryCheckError message={t.projectSettings.loadFailed(e.loadError)} retry={e.retryLoad} />
    : <p className="hint">{t.config.loading}</p>;
  const { loaded, entry, at, shown, problems } = e;
  const nameOf = (n: number) => shown?.resolved[n]?.name ?? shown?.projects[n]?.name;
  const conflicts = problems.flatMap((p) => {
    
    
    if (p.code !== 'nameTaken' || p.ofProject !== at || p.project === undefined) return [];
    const name = nameOf(p.project);
    return name ? [{ ...p, project: at, of: name, ofProject: p.project }] : [];
  });
  return (
    <>
      <ProjectBlock
        n={at}
        project={entry}
        configure={fresh}
        checking={!shown && e.pending && !e.checkError}
        resolved={shown?.resolved[at] ?? null}
        running={loaded.view.running}
        {...(pin ? { pin } : {})}
        problems={[...problems.filter((p) => p.project === at && !SHEET_PROBLEMS.includes(p.code) && !(fresh && p.code === 'noPath')), ...conflicts]}
        onRecheck={e.recheck}
        onChange={e.setEntry}
        showProject={(n) => {
          const id = shown?.resolved[n]?.id ?? shown?.projects[n]?.id;
          if (!id || id === pin || !loaded.view.running.includes(id)) return undefined;
          return () => leave(() => {
            onNavigate?.();
            showSettingsAt({ project: id, section: 'project' });
            if (onShowProject) onShowProject(id);
            else goTo(projectPath(id));
          });
        }}
      />
      {e.checkError && <EntryCheckError message={t.projectSettings.checkFailed(e.checkError)} retry={e.recheck} />}
      {problems
        .filter((p) => e.changed && p.project === undefined)
        .map((p, k) => (
          <Problem key={k} problem={p} where="" />
        ))}
    </>
  );
}

function EntryCheckError({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <p role="alert" className="p-error m-0">{message}</p>
      <Button type="button" size="small" onClick={() => void retry()}>{t.projectSettings.retry}</Button>
    </div>
  );
}

/** "Configuration" in the project's settings sheet: its entry, saved with its button, and its place in the list of projects. */
export function ProjectEntrySection({ project, on, onShowProject }: { project: string; on: boolean; onShowProject?: ((id: string) => void) | undefined }) {
  const e = useProjectEntry(project, on);
  const [question] = useLeaveGuard(e.changed, () => {
    e.reset();
    keepConfigDraft(draftSession, `project:${project}`, null, null);
  });
  const l = t.projectSettings;
  const c = t.config;
  const n = e.loaded?.view.projects.length ?? 0;
  const at = e.loaded?.at ?? 0;
  return (
    <div className="cs-entry [&_.c-row]:block [&_.c-row>*]:max-w-full">
      <p className="hint mt-0 mb-2 text-sm leading-[1.45]">{l.entryHint}</p>
      <fieldset disabled={e.busy} className="m-0 min-w-0 border-0 p-0">
        <EntryFields e={e} pin={project} onShowProject={onShowProject} />
      </fieldset>
      {e.loaded && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" className="cs-entry-save" disabled={!e.changed || e.pending || e.busy || e.blocking.length > 0} onClick={() => void e.save()}>
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
                  <Button size="small" className="qmove" disabled={e.busy || (earlier ? at === 0 : at === n - 1)} aria-label={label} onClick={() => void e.move(earlier)}>
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
  
  const typed = open && !!e.entry && !!e.loaded && JSON.stringify(e.entry) !== JSON.stringify(e.loaded.entry);
  const [question, ask, release] = useLeaveGuard(typed, () => {});
  
  const ready = !!e.entry && e.entry.repos.some((r) => r.path.trim()) && !!e.shown && !e.pending && !e.blocking.length && !e.busy;
  const create = async () => {
    const made = await e.save();
    if (!made) return;
    
    release();
    onClose();
    if (!made.id) return;
    
    if (made.restarting) location.assign(projectPath(made.id));
    else goTo(projectPath(made.id));
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && (typed ? ask(onClose) : onClose())}
      title={l.newProject}
      className="cs-new-project flex h-[min(720px,calc(100dvh-48px))] w-[min(760px,100%)] flex-col [&>.cs-new-fields]:overflow-y-auto [&>div:last-child]:shrink-0 [&>div:last-child]:border-t [&>div:last-child]:border-border [&>div:last-child]:pt-4"
      confirm={{ label: l.create, className: 'cs-create', keepOpen: true, disabled: !ready, onClick: () => void create() }}
      cancel={l.cancel}
      busy={e.busy}
    >
      <fieldset disabled={e.busy} className="cs-new-fields m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 py-0 pr-2 pl-0">
        <p className="hint mt-0">{l.newProjectHint}</p>
        <EntryFields e={e} fresh onNavigate={onClose} />
        {e.status && <p className={`hint ${statusClass}`}>{e.status}</p>}
      </fieldset>
      {question}
    </ConfirmDialog>
  );
}
